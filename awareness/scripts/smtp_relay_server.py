#!/usr/bin/env python3
"""
smtp_relay_server.py
Minimal local HTTP relay: accepts the POST JSON the Awareness app sends and
delivers it via SMTP (Gmail or any SMTP host). This is the bridge that lets the
static, no-backend app "send" email — a browser cannot open an SMTP socket, so
the app POSTs to this loopback relay, which does the actual SMTP send.

Run:
    python scripts/smtp_relay_server.py
    (or:  npm run relay:smtp)

Then in the app's Config page set:
    Delivery method   : SMTP
    Relay endpoint URL: http://127.0.0.1:8788/
    SMTP host         : smtp.gmail.com
    SMTP port         : 587            (STARTTLS)  — or 465 for SSL
    Username          : your.address@gmail.com
    Password          : a Gmail APP PASSWORD (16 chars, not your login password)
    From address      : your.address@gmail.com
    From name         : e.g. ABI Global SOC

Gmail App Password (your normal password will NOT work):
    myaccount.google.com -> Security -> 2-Step Verification (enable) -> App passwords

Credentials are sent by the app inside each request and used for that send only;
this relay never writes them to disk. Bind is loopback-only (127.0.0.1).

Request body shape (from the Awareness app):
    {
      "mode": "test" | "send",
      "delivery": { "type": "smtp" },
      "smtp": { "host", "port", "secure", "username", "password",
                "fromAddress", "fromName" },
      "to": ["a@example.com", ...],
      "subject": "...",
      "html": "...",          # send mode
      "text": "...",          # test mode
      "attachments": [ { "filename", "contentId", "base64", "contentType" } ]
    }
"""

import json
import os
import random
import smtplib
import sys
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8788"))


def _allowed_origin(origin):
    """Loopback-only CORS. The previous '*' let any website the user visited
    POST to this relay. Reflect only same-machine origins (any port) and
    file:// (Origin: null); a concrete remote origin gets no header -> blocked."""
    if not origin:
        return None
    if origin == "null":
        return "null"
    try:
        if urlparse(origin).hostname in ("127.0.0.1", "localhost", "::1"):
            return origin
    except Exception:
        pass
    return None


def _str(v):
    return "" if v is None else str(v)


def build_message(payload):
    """Turn the relay payload into a MIME message (multipart/related with inline
    CID images), mirroring nessus_advisory/cve_alert.py's structure."""
    smtp = payload.get("smtp") or {}
    to = [a for a in (payload.get("to") or []) if _str(a).strip()]
    if not to:
        raise ValueError("No recipients (to[]) provided.")

    from_address = _str(smtp.get("fromAddress")).strip() or _str(smtp.get("username")).strip()
    if not from_address:
        raise ValueError("No From address / username configured.")
    from_name = _str(smtp.get("fromName")).strip()
    subject = _str(payload.get("subject")).strip() or "(no subject)"
    html = _str(payload.get("html"))
    text = _str(payload.get("text"))
    attachments = payload.get("attachments") or []

    # multipart/related wraps the HTML body + inline images.
    related = MIMEMultipart("related")
    related["Subject"] = subject
    related["From"] = f"{from_name} <{from_address}>" if from_name else from_address
    related["To"] = ", ".join(to)
    related["Date"] = formatdate(localtime=True)
    related["Message-ID"] = f"<awareness-{random.randint(10**9, 10**10)}.{from_address}>"
    related["X-Mailer"] = "Awareness-SMTP-Relay/1.0"

    # multipart/alternative: plain-text fallback first, then HTML.
    alternative = MIMEMultipart("alternative")
    plain = text or "This message requires an HTML-capable email client."
    alternative.attach(MIMEText(plain, "plain", "utf-8"))
    if html:
        alternative.attach(MIMEText(html, "html", "utf-8"))
    related.attach(alternative)

    # Inline CID images: the app rewrites <img src="assets/.."> / data: URIs to
    # cid: refs and ships the bytes here as base64 (see prepareImagesForRelay).
    import base64 as _b64
    for att in attachments:
        cid = _str(att.get("contentId")).strip()
        b64 = _str(att.get("base64")).strip()
        if not cid or not b64:
            continue
        try:
            raw = _b64.b64decode(b64)
        except Exception:
            continue
        ctype = _str(att.get("contentType")) or "image/png"
        subtype = ctype.split("/", 1)[1] if "/" in ctype else "png"
        img = MIMEImage(raw, _subtype=subtype)
        img.add_header("Content-ID", f"<{cid}>")
        img.add_header("Content-Disposition", "inline",
                       filename=_str(att.get("filename")) or f"{cid}.{subtype}")
        related.attach(img)

    return from_address, to, related


def send_via_smtp(payload):
    smtp = payload.get("smtp") or {}
    host = _str(smtp.get("host")).strip()
    if not host:
        raise ValueError("SMTP host is required (e.g. smtp.gmail.com).")
    port = int(smtp.get("port") or 587)
    secure = bool(smtp.get("secure"))
    username = _str(smtp.get("username")).strip()
    password = _str(smtp.get("password"))

    from_address, to, message = build_message(payload)

    # Port 465 (or the explicit "secure" toggle) = implicit TLS; otherwise
    # STARTTLS on 587 (Gmail's default).
    use_ssl = secure or port == 465
    if use_ssl:
        server = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
    try:
        server.ehlo()
        if not use_ssl:
            server.starttls()
            server.ehlo()
        if username:
            server.login(username, password)
        server.sendmail(from_address, to, message.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass

    return message["Message-ID"]


class RelayHandler(BaseHTTPRequestHandler):
    def _cors(self):
        allow = _allowed_origin(self.headers.get("Origin"))
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return self._json(400, {"ok": False, "error": "Invalid JSON body."})

        delivery = payload.get("delivery") or {}
        if delivery.get("type") not in (None, "smtp"):
            return self._json(400, {
                "ok": False,
                "error": 'This relay only handles SMTP delivery. Set delivery method to "SMTP" in the app.'
            })

        try:
            message_id = send_via_smtp(payload)
            print(f"  [SENT] {', '.join(payload.get('to') or [])}  |  {payload.get('subject', '')}")
            return self._json(200, {"ok": True, "messageId": message_id})
        except smtplib.SMTPAuthenticationError:
            return self._json(502, {
                "ok": False,
                "error": ("SMTP authentication failed. For Gmail you must use a 16-character "
                          "App Password (not your normal password), with 2-Step Verification enabled.")
            })
        except Exception as exc:  # noqa: BLE001 — report any send failure to the app
            print(f"  [ERROR] {exc}", file=sys.stderr)
            return self._json(502, {"ok": False, "error": str(exc)})

    def log_message(self, *args):
        # Quieter console — we already print SENT/ERROR lines explicitly.
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), RelayHandler)
    print(f"SMTP relay listening on http://{HOST}:{PORT}/")
    print("Configure the app's Relay endpoint URL to this address (Delivery method: SMTP).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down SMTP relay.")
        server.shutdown()


if __name__ == "__main__":
    main()
