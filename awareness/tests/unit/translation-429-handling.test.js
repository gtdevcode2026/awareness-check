// Guards the translation 429 hardening in ui_controller.js:
//   - fetchWithTranslationRetry: retries 429/5xx, honors Retry-After (capped), gives up
//   - describeTranslationHttpError: turns a bare 429 into a specific, actionable message
//     (insufficient_quota vs rate limit) so users know whether to add credits or slow down.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadInternals() {
  const ctx = {
    window: {},
    localStorage: { _v: new Map(), getItem(k){ return this._v.has(k)?this._v.get(k):null; }, setItem(k,v){ this._v.set(k,String(v)); }, removeItem(k){ this._v.delete(k); }, clear(){ this._v.clear(); } },
    URL, Date, console, setTimeout, clearTimeout,
    __fetch: () => Promise.reject(new Error("fetch not set for this test")),
    fetch: (...a) => ctx.__fetch(...a),
    document: {
      getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
      body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}
    },
    addEventListener() {}, removeEventListener() {},
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["js/utils.js", "js/translation_metrics.js", "js/ui_controller.js"]) {
    vm.runInContext(readFileSync(path.join(rootDir, f), "utf8"), ctx, { filename: f });
  }
  const internals = ctx.App && ctx.App.UI && ctx.App.UI._internals;
  assert.ok(internals && internals.fetchWithTranslationRetry && internals.describeTranslationHttpError,
    "ui_controller did not expose the 429 helpers on _internals");
  return { ctx, internals };
}

const resp = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
});

// ── describeTranslationHttpError ────────────────────────────────────────────

test("describeTranslationHttpError: 429 insufficient_quota → quota message, no bare 429", async () => {
  const { internals } = loadInternals();
  const msg = await internals.describeTranslationHttpError(
    resp(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } }),
    "openai");
  assert.match(msg, /OpenAI/);
  assert.match(msg, /insufficient_quota/);
  assert.match(msg, /credit|billing/i);
  assert.ok(!/\(429/.test(msg), "quota message must not read as a rate-limit 429 (keeps failure classification correct)");
});

test("describeTranslationHttpError: 429 rate_limit → rate limit message with 429", async () => {
  const { internals } = loadInternals();
  const msg = await internals.describeTranslationHttpError(
    resp(429, { error: { code: "rate_limit_exceeded", message: "Rate limit reached for gpt-4o-mini" } }),
    "openai");
  assert.match(msg, /rate limit/i);
  assert.match(msg, /429/);
  assert.match(msg, /rate_limit_exceeded/);
});

test("describeTranslationHttpError: 401 → API key message; provider label respected", async () => {
  const { internals } = loadInternals();
  const msg = await internals.describeTranslationHttpError(resp(401, { error: { message: "bad key" } }), "claude");
  assert.match(msg, /Claude/);
  assert.match(msg, /key/i);
  assert.match(msg, /401/);
});

test("describeTranslationHttpError: other status falls back to status + provider message", async () => {
  const { internals } = loadInternals();
  const msg = await internals.describeTranslationHttpError(resp(500, { error: { message: "internal server error" } }), "openai");
  assert.match(msg, /500/);
  assert.match(msg, /internal server error/);
});

// ── fetchWithTranslationRetry ───────────────────────────────────────────────

test("fetchWithTranslationRetry: retries 429 then returns the first ok response", async () => {
  const { ctx, internals } = loadInternals();
  let calls = 0;
  const seq = [resp(429, {}), resp(429, {}), resp(200, { ok: 1 })];
  ctx.__fetch = async () => { calls += 1; return seq[calls - 1]; };
  const r = await internals.fetchWithTranslationRetry("u", {}, { attempts: 4, baseMs: 1, maxBackoffMs: 5 });
  assert.equal(r.ok, true);
  assert.equal(calls, 3, "should have retried twice before success");
});

test("fetchWithTranslationRetry: gives up after exhausting attempts and returns the 429", async () => {
  const { ctx, internals } = loadInternals();
  let calls = 0;
  ctx.__fetch = async () => { calls += 1; return resp(429, {}); };
  const r = await internals.fetchWithTranslationRetry("u", {}, { attempts: 4, baseMs: 1, maxBackoffMs: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
  assert.equal(calls, 4, "should have tried exactly `attempts` times");
});

test("fetchWithTranslationRetry: honors Retry-After but caps it (no multi-second hang)", async () => {
  const { ctx, internals } = loadInternals();
  let calls = 0;
  const seq = [resp(429, {}, { "retry-after": "3600" }), resp(200, { ok: 1 })]; // 1 hour header
  ctx.__fetch = async () => { calls += 1; return seq[calls - 1]; };
  const t0 = Date.now();
  const r = await internals.fetchWithTranslationRetry("u", {}, { attempts: 4, baseMs: 1, maxBackoffMs: 20 });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.ok(elapsed < 500, `Retry-After must be capped by maxBackoffMs; waited ${elapsed}ms`);
});

test("fetchWithTranslationRetry: does not retry a non-retryable 400", async () => {
  const { ctx, internals } = loadInternals();
  let calls = 0;
  ctx.__fetch = async () => { calls += 1; return resp(400, { error: { message: "bad request" } }); };
  const r = await internals.fetchWithTranslationRetry("u", {}, { attempts: 4, baseMs: 1 });
  assert.equal(r.status, 400);
  assert.equal(calls, 1, "4xx (except 429) must not be retried");
});
