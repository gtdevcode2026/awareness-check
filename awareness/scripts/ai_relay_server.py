#!/usr/bin/env python3
"""
ai_relay_server.py
Minimal local HTTP relay for the **custom OpenAI-compatible AI provider**.

Why this exists
---------------
The Awareness app is a static, browser-only app: it calls the AI endpoint with
the browser's `fetch()`. A browser CANNOT disable TLS certificate verification —
there is no equivalent of the client's:

    client = OpenAI(http_client=httpx.Client(verify=False),
                    api_key=os.getenv("OPENAI_API_KEY"),
                    base_url=os.getenv("OPENAI_BASE_URL"))

So when the custom AI endpoint uses a self-signed / internal-CA certificate, a
browser fetch fails on the cert and there is no JS-side override. This relay is
the bridge (same idea as scripts/smtp_relay_server.py for email): the browser
POSTs chat-completions to this loopback server (and GETs the model list from
.../models), and the relay forwards the request to the real endpoint, then
returns the upstream JSON. The real base URL + API key stay here (read from
env), not in the browser.

TLS: secure by default
-----------------------
This relay VERIFIES the upstream TLS certificate by default. For an internal /
self-signed endpoint you have two choices, in order of preference:

  1. RECOMMENDED — trust your internal CA:
        AI_RELAY_CA_BUNDLE="/path/to/internal-ca.pem"
     Verification stays ON, just against your CA. No MITM exposure.

  2. LAST RESORT — reproduce the client's `verify=False` (no verification):
        AI_RELAY_INSECURE_SKIP_VERIFY=1
     This disables certificate checking entirely and is vulnerable to
     man-in-the-middle. Use only on a trusted network when you cannot obtain the
     CA file, and prefer option 1.

Run
---
    OPENAI_BASE_URL="https://your-internal-endpoint/v1" \
    OPENAI_API_KEY="sk-..." \
    AI_RELAY_CA_BUNDLE="/path/to/internal-ca.pem" \
    python scripts/ai_relay_server.py
    (or:  npm run relay:ai)

Then in the app's Config page (AI provider = "Custom OpenAI-compatible") set:
    Base URL : http://127.0.0.1:8799/v1
    Model    : <your model name, e.g. gpt-4o-mini / llama3.1 / your-deploy-id>
    API key  : (leave blank — the relay injects OPENAI_API_KEY itself)

Environment variables
----------------------
    OPENAI_BASE_URL              (required) the REAL upstream base, e.g.
                                 "https://host/v1" or "https://host" — normalized
                                 to a chat/completions URL like the app does.
    OPENAI_API_KEY               (optional) Bearer key sent upstream. If unset,
                                 the relay passes through any Authorization the
                                 app sends.
    AI_RELAY_PORT                (optional) loopback port, default 8799.
    AI_RELAY_CA_BUNDLE           (optional, RECOMMENDED for internal certs) path
                                 to a CA cert/bundle to trust. Verification stays on.
    AI_RELAY_INSECURE_SKIP_VERIFY (optional, NOT recommended) "1" to disable TLS
                                 verification entirely — the literal verify=False.

The relay binds to loopback only (127.0.0.1) and never writes secrets to disk.
"""

import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("AI_RELAY_PORT", "8799"))

UPSTREAM_BASE = os.environ.get("OPENAI_BASE_URL", "").strip()
UPSTREAM_KEY = os.environ.get("OPENAI_API_KEY", "").strip()


def _allowed_origin(origin):
    """Loopback-only CORS. The previous '*' let any website the user visited
    drive this relay cross-origin — and, since the relay injects OPENAI_API_KEY
    upstream, abuse the user's key/quota. Reflect only same-machine origins (any
    port) and file:// (Origin: null); a concrete remote origin gets no header."""
    if not origin:
        return None
    if origin == "null":
        return "null"
    try:
        if urllib.parse.urlparse(origin).hostname in ("127.0.0.1", "localhost", "::1"):
            return origin
    except Exception:
        pass
    return None


def insecure_skip_verify():
    """True only when explicitly opted in — verification is ON by default."""
    return os.environ.get("AI_RELAY_INSECURE_SKIP_VERIFY", "").strip().lower() in ("1", "true", "yes", "on")


def normalize_chat_url(base):
    """Mirror the app's normalizeChatCompletionsUrl(): accept a bare host, a
    '/v1' base, or a full chat/completions URL."""
    t = (base or "").strip().rstrip("/")
    if not t:
        return ""
    if t.endswith("/chat/completions"):
        return t
    if re.search(r"/v\d+$", t):
        return t + "/chat/completions"
    return t + "/v1/chat/completions"


def normalize_models_url(base):
    """Mirror the app's resolveModelsUrl(): derive <base>/models from a bare
    host, a '/v1' (or '/api/v2') base, or a full chat/completions URL."""
    t = (base or "").strip().rstrip("/")
    if not t:
        return ""
    if t.endswith("/models"):
        return t
    if t.endswith("/chat/completions"):
        t = t[: -len("/chat/completions")]
    if re.search(r"/v\d+$", t):
        return t + "/models"
    return t + "/v1/models"


def make_ssl_context():
    """Verify the upstream cert by default (optionally against AI_RELAY_CA_BUNDLE).
    Only when AI_RELAY_INSECURE_SKIP_VERIFY is set do we reproduce verify=False."""
    if insecure_skip_verify():
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    ca = os.environ.get("AI_RELAY_CA_BUNDLE", "").strip()
    return ssl.create_default_context(cafile=ca or None)


def forward_chat(body_bytes, incoming_auth):
    """Forward the chat-completions request body upstream and return
    (status, raw_response_bytes, content_type)."""
    url = normalize_chat_url(UPSTREAM_BASE)
    if not url:
        raise ValueError("OPENAI_BASE_URL is not set. Start the relay with the real endpoint, e.g. "
                         'OPENAI_BASE_URL="https://host/v1".')

    req = urllib.request.Request(url, data=body_bytes, method="POST")
    req.add_header("Content-Type", "application/json")
    if UPSTREAM_KEY:
        req.add_header("Authorization", f"Bearer {UPSTREAM_KEY}")
    elif incoming_auth:
        req.add_header("Authorization", incoming_auth)

    ctx = make_ssl_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
            ctype = resp.headers.get("Content-Type", "application/json")
            return resp.status, resp.read(), ctype
    except urllib.error.HTTPError as exc:
        # Reachable but errored (bad model, bad key, …) — forward the upstream
        # status + body so the app shows the real reason.
        ctype = exc.headers.get_content_type() if exc.headers else "application/json"
        return exc.code, exc.read(), ctype


def forward_models(incoming_auth):
    """Forward a GET <upstream>/models request and return
    (status, raw_response_bytes, content_type)."""
    url = normalize_models_url(UPSTREAM_BASE)
    if not url:
        raise ValueError("OPENAI_BASE_URL is not set. Start the relay with the real endpoint, e.g. "
                         'OPENAI_BASE_URL="https://host/v1".')

    req = urllib.request.Request(url, method="GET")
    if UPSTREAM_KEY:
        req.add_header("Authorization", f"Bearer {UPSTREAM_KEY}")
    elif incoming_auth:
        req.add_header("Authorization", incoming_auth)

    ctx = make_ssl_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            ctype = resp.headers.get("Content-Type", "application/json")
            return resp.status, resp.read(), ctype
    except urllib.error.HTTPError as exc:
        ctype = exc.headers.get_content_type() if exc.headers else "application/json"
        return exc.code, exc.read(), ctype


class RelayHandler(BaseHTTPRequestHandler):
    def _cors(self):
        allow = _allowed_origin(self.headers.get("Origin"))
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _passthrough(self, status, raw, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype or "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # A request to <something>/models is forwarded upstream so the app can
        # list available models; any other GET is the loopback health check.
        if self.path.rstrip("/").endswith("/models"):
            try:
                status, raw, ctype = forward_models(self.headers.get("Authorization"))
                print(f"  [AI] {status}  ->  {normalize_models_url(UPSTREAM_BASE)}")
                return self._passthrough(status, raw, ctype)
            except urllib.error.URLError as exc:
                hint = ""
                if isinstance(getattr(exc, "reason", None), ssl.SSLError):
                    hint = (" (TLS verification failed — point AI_RELAY_CA_BUNDLE at your internal CA, "
                            "or set AI_RELAY_INSECURE_SKIP_VERIFY=1 as a last resort)")
                print(f"  [ERROR] {exc}{hint}", file=sys.stderr)
                return self._json(502, {"error": {"message": f"Could not reach upstream AI endpoint: {exc.reason}{hint}"}})
            except Exception as exc:  # noqa: BLE001 — surface any failure to the app
                print(f"  [ERROR] {exc}", file=sys.stderr)
                return self._json(502, {"error": {"message": str(exc)}})
        # Tiny health check so you can confirm the relay is up in a browser.
        self._json(200, {
            "ok": True,
            "service": "ai_relay_server",
            "upstream": normalize_chat_url(UPSTREAM_BASE) or None,
            "tlsVerify": not insecure_skip_verify(),
            "hasKey": bool(UPSTREAM_KEY),
        })

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b"{}"
        except Exception:
            return self._json(400, {"error": {"message": "Invalid request body."}})

        try:
            status, raw, ctype = forward_chat(body, self.headers.get("Authorization"))
            print(f"  [AI] {status}  ->  {normalize_chat_url(UPSTREAM_BASE)}")
            return self._passthrough(status, raw, ctype)
        except urllib.error.URLError as exc:
            # Connection refused / DNS / TLS handshake failure.
            hint = ""
            if isinstance(getattr(exc, "reason", None), ssl.SSLError):
                hint = (" (TLS verification failed — point AI_RELAY_CA_BUNDLE at your internal CA, "
                        "or set AI_RELAY_INSECURE_SKIP_VERIFY=1 as a last resort)")
            print(f"  [ERROR] {exc}{hint}", file=sys.stderr)
            return self._json(502, {"error": {"message": f"Could not reach upstream AI endpoint: {exc.reason}{hint}"}})
        except Exception as exc:  # noqa: BLE001 — surface any failure to the app
            print(f"  [ERROR] {exc}", file=sys.stderr)
            return self._json(502, {"error": {"message": str(exc)}})

    def log_message(self, *args):
        return


def main():
    if not UPSTREAM_BASE:
        print("  [WARN] OPENAI_BASE_URL is not set — set it to your real AI endpoint, e.g.")
        print('         OPENAI_BASE_URL="https://your-host/v1" OPENAI_API_KEY="sk-..." python scripts/ai_relay_server.py')
    server = ThreadingHTTPServer((HOST, PORT), RelayHandler)
    print(f"AI relay listening on http://{HOST}:{PORT}/")
    print(f"  upstream    : {normalize_chat_url(UPSTREAM_BASE) or '(set OPENAI_BASE_URL)'}")
    if insecure_skip_verify():
        print("  TLS verify  : OFF  [!] INSECURE — certificate not checked (MITM-exposed). "
              "Prefer AI_RELAY_CA_BUNDLE.")
    else:
        ca = os.environ.get("AI_RELAY_CA_BUNDLE", "").strip()
        print(f"  TLS verify  : ON{f' (CA bundle: {ca})' if ca else ' (system trust store)'}")
    print(f"  API key     : {'set (injected upstream)' if UPSTREAM_KEY else 'none (pass-through)'}")
    print("  In the app (Custom OpenAI-compatible) set Base URL to "
          f"http://{HOST}:{PORT}/v1 and leave the API key blank.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down AI relay.")
        server.shutdown()


if __name__ == "__main__":
    main()
