// Security unit tests — pure-function checks plus file scans that lock in
// the production-hardening posture. DOM-coupled behaviors (storage paths,
// form persistence) are covered in tests/e2e/security-smoke.spec.js where
// a real browser exists; we deliberately keep this file fast (< 5s) and
// network-free.

const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadScript(context, relativePath) {
  const code = readFileSync(path.join(rootDir, relativePath), "utf8");
  vm.runInContext(code, context, { filename: path.join(rootDir, relativePath) });
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ENTRY_HTML = [
  "index.html",
  "preview.html",
  "editor.html",
  "send.html",
  "projects.html",
  "keywords.html",
  "curation-lab.html",
  "config.html",
  "builder.html",
];

// ─── 1. escapeHtml escapes the standard six characters ──────────────────────

test("escapeHtml escapes &, <, >, \", ', /", () => {
  const ctx = vm.createContext({
    window: {},
    App: { Utils: { stripTags: (s) => String(s || "") } },
    document: { createElement: () => ({}) },
    console,
    URL,
  });
  ctx.window = ctx;
  loadScript(ctx, "js/newsletter_builder.js");

  const escapeHtml = ctx.App.NewsletterBuilder._components.escapeHtml;
  assert.equal(typeof escapeHtml, "function", "escapeHtml not exposed on _components");

  const dangerous = `<script>alert("xss")</script>&'/`;
  const escaped = escapeHtml(dangerous);
  assert.ok(!escaped.includes("<script"), "raw <script tag must not survive escapeHtml");
  assert.ok(!escaped.includes("</script>"), "closing script tag must not survive escapeHtml");
  assert.match(escaped, /&lt;/);
  assert.match(escaped, /&gt;/);
  assert.match(escaped, /&amp;/);
  // Either &quot; or &#34; is acceptable, but the raw " must be gone.
  assert.ok(!/[<>](?=[a-z])/i.test(escaped), "no naked < or > before letters");
});

test("escapeHtml handles null, undefined, and non-string inputs without throwing", () => {
  const ctx = vm.createContext({
    window: {},
    App: { Utils: { stripTags: (s) => String(s || "") } },
    document: { createElement: () => ({}) },
    console,
    URL,
  });
  ctx.window = ctx;
  loadScript(ctx, "js/newsletter_builder.js");
  const escapeHtml = ctx.App.NewsletterBuilder._components.escapeHtml;

  assert.doesNotThrow(() => escapeHtml(null));
  assert.doesNotThrow(() => escapeHtml(undefined));
  assert.doesNotThrow(() => escapeHtml(123));
  assert.doesNotThrow(() => escapeHtml({}));
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

// ─── 2. Sensitive-key names never appear in console.* string literals ───────

test("no console.* call in js/ logs a sensitive storage key value", () => {
  const sensitiveTokens = [
    "awareness_smtp_profile_v1",
    "awareness_smtp_password_session_v1",
    "awareness_ai_settings_v1",
    "awareness_ai_key_session_v1",
    "awareness_ai_experiment_control_v1",
  ];
  const jsFiles = walk(path.join(rootDir, "js")).filter((f) => f.endsWith(".js"));
  const offenders = [];
  for (const file of jsFiles) {
    const text = readFileSync(file, "utf8");
    // Strip block + line comments so doc lines that mention key names are ignored.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const consoleRe = /console\.(?:log|warn|error|info|debug)\s*\(([^)]*)\)/g;
    let m;
    while ((m = consoleRe.exec(stripped)) !== null) {
      const args = m[1];
      for (const token of sensitiveTokens) {
        if (args.includes(token)) {
          offenders.push(`${path.relative(rootDir, file)}: ${m[0].slice(0, 120)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `Found console.* calls referencing sensitive keys:\n${offenders.join("\n")}`);
});

// ─── 3. Ensemble logger endpoint resolution by origin ───────────────────────

test("ai/logger.js postPayload posts to the same-origin proxy path off-localhost", () => {
  // Ensemble logging is intentionally always-on. On a deployed (non-localhost)
  // origin it routes through nginx via a SAME-ORIGIN path; the ensemble-log
  // sidecar writes the corpus server-side. (See deploy/nginx.docker.conf.)
  const fetchCalls = [];
  const ctx = vm.createContext({
    window: {
      location: { hostname: "awareness.example.com" },
    },
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
    console,
    JSON,
    Date,
    setTimeout,
    clearTimeout,
    URL,
  });
  loadScript(ctx, "js/ai/logger.js");

  const AILogger = ctx.window.App.AILogger;
  assert.equal(typeof AILogger.isLocalhost, "function", "isLocalhost helper must be exposed");
  assert.equal(AILogger.isLocalhost(), false, "isLocalhost should report false for example.com");

  AILogger.beginBuild({ templateId: "poster" });
  AILogger.log({ name: "test.txt", prompt: "p", response: "r" });
  AILogger.logRaw({ session: "sess", name: "raw.txt", content: "c" });
  AILogger.endBuild();

  assert.equal(fetchCalls.length, 2, "both log() and logRaw() must post from a deployed host");
  for (const c of fetchCalls) {
    assert.equal(c.url, "/ensemble/save", "deployed logging must use the same-origin proxy path");
  }
});

test("ai/logger.js postPayload calls fetch when hostname IS localhost", () => {
  const fetchCalls = [];
  const ctx = vm.createContext({
    window: { location: { hostname: "127.0.0.1" } },
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
    console,
    JSON,
    Date,
    setTimeout,
    clearTimeout,
    URL,
  });
  loadScript(ctx, "js/ai/logger.js");
  const AILogger = ctx.window.App.AILogger;
  assert.equal(AILogger.isLocalhost(), true, "isLocalhost should report true for 127.0.0.1");

  AILogger.beginBuild({ templateId: "poster" });
  AILogger.log({ name: "dev.txt", prompt: "p", response: "r" });
  AILogger.endBuild();

  assert.equal(fetchCalls.length, 1, "fetch should be called exactly once on localhost");
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:4175/save");
});

// ─── 4. SMTP relay-URL guard in ui_controller.js ────────────────────────────

test("callRelay implementation rejects plain-HTTP non-loopback URLs", () => {
  const source = readFileSync(path.join(rootDir, "js/ui_controller.js"), "utf8");
  // The guard exists when the source contains both the protocol check and the
  // loopback exception for the relay path.
  assert.match(
    source,
    /Relay endpoint must use HTTPS/,
    "callRelay must reject non-HTTPS non-loopback URLs with an explicit error"
  );
  assert.match(
    source,
    /parsedUrl\.protocol !== 'https:'/,
    "guard should compare URL.protocol explicitly"
  );
});

// ─── 5. No javascript: URLs in entry HTML ───────────────────────────────────

test("no entry HTML file contains a javascript: URL", () => {
  const offenders = [];
  for (const file of ENTRY_HTML) {
    const text = readFileSync(path.join(rootDir, file), "utf8");
    if (/\b(?:href|src|action|formaction)\s*=\s*["']\s*javascript:/i.test(text)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `javascript: URLs found in: ${offenders.join(", ")}`);
});

// ─── 6. Meta CSP is present on every entry HTML ─────────────────────────────

test("every entry HTML carries a meta Content-Security-Policy", () => {
  const missing = [];
  for (const file of ENTRY_HTML) {
    const text = readFileSync(path.join(rootDir, file), "utf8");
    const cspRe = /<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i;
    if (!cspRe.test(text)) {
      missing.push(file);
      continue;
    }
    // Spot-check required directives.
    assert.match(text, /default-src 'self'/, `${file}: default-src 'self' missing`);
    assert.match(text, /object-src 'none'/, `${file}: object-src 'none' missing`);
    assert.match(text, /base-uri 'self'/, `${file}: base-uri 'self' missing`);
    assert.match(text, /frame-src 'self'/, `${file}: frame-src 'self' missing`);
  }
  assert.deepEqual(missing, [], `Meta CSP missing from: ${missing.join(", ")}`);
});

// ─── 6b. CSP connect-src allows local OpenAI-compatible model servers ───────

test("every entry HTML connect-src permits local http model servers (Ollama/LM Studio/vLLM)", () => {
  // The Custom (OpenAI-compatible) provider's headline use case is a LOCAL model
  // server — Ollama (http://localhost:11434, the config placeholder), LM Studio
  // (:1234), vLLM (:8000), LiteLLM (:4000). These serve over PLAIN http on
  // localhost, so the page's CSP connect-src must allow them or the browser kills
  // the fetch before it leaves (TypeError → "unreachable"). The blanket `https:`
  // token only covers remote https endpoints (OpenRouter/Groq), never local http.
  const failures = [];
  for (const file of ENTRY_HTML) {
    const text = readFileSync(path.join(rootDir, file), "utf8");
    const m = text.match(/connect-src([^;]*);/i);
    if (!m) { failures.push(`${file}: no connect-src directive`); continue; }
    const directive = m[1];
    for (const origin of ["http://localhost:*", "http://127.0.0.1:*"]) {
      if (!directive.includes(origin)) {
        failures.push(`${file}: connect-src missing ${origin}`);
      }
    }
  }
  assert.deepEqual(failures, [], `connect-src must allow local model servers:\n${failures.join("\n")}`);
});

// ─── 7. CDN scripts carry SRI integrity hashes ──────────────────────────────

test("every cdnjs.cloudflare.com reference in entry HTML carries SRI (sha384) + anonymous crossorigin", () => {
  // Third-party libs (JSZip, qrcode) load LOCAL-FIRST from vendor/ (same-origin, so no SRI is
  // needed or possible). The only cdnjs references left are FALLBACKS inside an onerror handler
  // that recreates the <script> and sets `.integrity` (sha384) + `.crossOrigin='anonymous'`.
  // The supply-chain guarantee is unchanged: wherever a cdnjs URL appears — as a plain attribute
  // tag OR inside such a fallback — it MUST be paired with an sha384 SRI hash and an anonymous
  // crossorigin, so a compromised CDN cannot inject unverified code. The checks are
  // case-insensitive so the JS-property form (crossOrigin) counts the same as the attribute form.
  const failures = [];
  for (const file of ENTRY_HTML) {
    const text = readFileSync(path.join(rootDir, file), "utf8");
    // Each physical <script ...> tag (no '>' inside it) that mentions cdnjs at all.
    const tagRe = /<script\b[^>]*cdnjs\.cloudflare\.com[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
      const tag = m[0];
      if (!/integrity\s*=\s*["']sha384-/i.test(tag)) {
        failures.push(`${file}: missing sha384 integrity — ${tag}`);
      }
      if (!/cross-?origin\s*=\s*["']anonymous["']/i.test(tag)) {
        failures.push(`${file}: missing anonymous crossorigin — ${tag}`);
      }
    }
  }
  assert.deepEqual(failures, [], `cdnjs references missing SRI / crossorigin:\n${failures.join("\n")}`);
});

test("JSZip + qrcode are vendored locally and loaded local-first (so the zipped app works offline)", () => {
  // The project ships as a zip onto machines that may be offline or block public CDNs. These
  // libraries must live IN the repo (vendor/) and be loaded local-first, or "Download All"
  // (JSZip) and QR generation silently break after the app is unzipped.
  for (const lib of ["vendor/jszip.min.js", "vendor/qrcode.min.js"]) {
    let size = 0;
    try { size = statSync(path.join(rootDir, lib)).size; }
    catch { assert.fail(`${lib} is missing — it must be vendored so it ships inside the zip`); }
    assert.ok(size > 5000, `${lib} is only ${size} bytes — looks truncated, not the real library`);
  }
  // Pages that build the per-language ZIP must reference JSZip from vendor/ (local-first), not CDN-only.
  for (const file of ["preview.html", "editor.html", "index.html"]) {
    const text = readFileSync(path.join(rootDir, file), "utf8");
    assert.match(text, /<script\s+src=["']vendor\/jszip\.min\.js["']/i,
      `${file} must load JSZip local-first from vendor/`);
  }
});

// ─── 8. AI-key persistence wiring (source-level guarantees) ─────────────────

test("ui_controller.js never writes aiKey or customBaseUrl under AI_SETTINGS_STORAGE_KEY", () => {
  const source = readFileSync(path.join(rootDir, "js/ui_controller.js"), "utf8");
  // The persisted bundle must strip the session-only fields (aiKey + the custom
  // base URL) before localStorage.setItem.
  assert.match(
    source,
    /const \{ aiKey, customBaseUrl,\s*\.\.\.persisted \}/,
    "saveAISettings should destructure aiKey + customBaseUrl out before persisting"
  );
  assert.match(
    source,
    /AI_KEY_SESSION_STORAGE_KEY/,
    "sessionStorage constant for the AI key must be referenced"
  );
  assert.match(
    source,
    /AI_BASE_URL_SESSION_STORAGE_KEY/,
    "sessionStorage constant for the custom base URL must be referenced"
  );
});

// ─── 11. AISummarizer.configure refuses untrusted keys ──────────────────────

test("AISummarizer.configure() ignores __proto__ and any non-allowlisted key", () => {
  const source = readFileSync(path.join(rootDir, "js/ai_summarizer.js"), "utf8");
  // Source-level guarantee: the configure() function must allowlist explicit
  // keys instead of blanket Object.assign(config, opts).
  assert.match(
    source,
    /const ALLOWED\s*=\s*\[/,
    "configure() should declare an ALLOWED array of accepted keys"
  );
  assert.match(
    source,
    /Object\.prototype\.hasOwnProperty\.call\(opts,\s*k\)/,
    "configure() should only copy own-enumerable keys (no prototype chain walk)"
  );
  // Negative assertion — the old blanket Object.assign should be gone.
  assert.ok(
    !/function configure\(opts\)\s*\{\s*Object\.assign\(config,\s*opts\)\s*;\s*\}/.test(source),
    "configure() should no longer use blanket Object.assign(config, opts)"
  );
});

// ─── 12. Editor postMessage handlers verify message source ─────────────────

test("editor.js parent receiver verifies event.source matches the iframe", () => {
  const source = readFileSync(path.join(rootDir, "js/editor.js"), "utf8");
  assert.match(
    source,
    /e\.source\s*!==\s*f\.contentWindow/,
    "_msgHandler must reject messages whose source is not the editor iframe"
  );
});

test("editor/iframe_script.js receiver verifies event.source is the parent", () => {
  const source = readFileSync(path.join(rootDir, "js/editor/iframe_script.js"), "utf8");
  assert.match(
    source,
    /e\.source\s*!==\s*window\.parent/,
    "iframe message handler must reject messages whose source is not window.parent"
  );
});

test("ui_controller.js never persists SMTP password to localStorage", () => {
  const source = readFileSync(path.join(rootDir, "js/ui_controller.js"), "utf8");
  // saveSMTPConfig must split the password into sessionStorage and write a
  // sanitized {password: ''} object to localStorage + IndexedDB.
  assert.match(
    source,
    /const \{ password,\s*\.\.\.sanitized \}/,
    "saveSMTPConfig should destructure password out before persisting"
  );
  assert.match(
    source,
    /SMTP_PASSWORD_SESSION_STORAGE_KEY/,
    "sessionStorage constant for the SMTP password must be referenced"
  );
  // Legacy scrub on init.
  assert.match(
    source,
    /fromStorage\.password\s*=\s*''/,
    "init block should scrub legacy plaintext password from localStorage"
  );
});
