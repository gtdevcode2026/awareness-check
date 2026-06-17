const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadScript(context, relativePath) {
  const filename = path.join(rootDir, relativePath);
  const code = readFileSync(filename, "utf8");
  vm.runInContext(code, context, { filename });
}

// Build an AISummarizer whose fetch behaves as the test dictates.
function loadSummarizerWithFetch(fetchImpl) {
  const context = {
    window: {},
    fetch: fetchImpl,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {},
      truncate(value, limit) {
        return String(value || "").slice(0, limit);
      },
      wait() {
        return Promise.resolve();
      },
    },
  };
  vm.createContext(context);
  loadScript(context, "js/ai/prompts.js");
  loadScript(context, "js/ai/local_fallbacks.js");
  loadScript(context, "js/ai_summarizer.js");
  return context.App.AISummarizer;
}

const CUSTOM_CFG = {
  provider: "custom",
  customBaseUrl: "http://localhost:11434",
  customModel: "llama3.1",
  customKey: "",
};

test("checkCustomEndpoint returns ok when the server responds 2xx", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  const result = await AIS.checkCustomEndpoint(CUSTOM_CFG);
  assert.equal(result.ok, true);
});

test("checkCustomEndpoint reports 'unreachable' when fetch throws (CORS / server down)", async () => {
  const AIS = loadSummarizerWithFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  const result = await AIS.checkCustomEndpoint(CUSTOM_CFG);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unreachable");
});

test("checkCustomEndpoint reports an http error with the status code", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  const result = await AIS.checkCustomEndpoint(CUSTOM_CFG);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "http");
  assert.equal(result.status, 404);
});

test("checkCustomEndpoint reports a config error when base URL or model is missing", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  const noUrl = await AIS.checkCustomEndpoint({ provider: "custom", customBaseUrl: "", customModel: "llama3.1" });
  assert.equal(noUrl.ok, false);
  assert.equal(noUrl.kind, "config");
  const noModel = await AIS.checkCustomEndpoint({ provider: "custom", customBaseUrl: "http://localhost:11434", customModel: "" });
  assert.equal(noModel.ok, false);
  assert.equal(noModel.kind, "config");
});

test("checkCustomEndpoint returns a request preview (url, model, body) without the key", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: true, status: 200, text: async () => "{}" }));
  const result = await AIS.checkCustomEndpoint({ ...CUSTOM_CFG, customKey: "sk-secret-value" });
  assert.ok(result.request, "request preview present");
  assert.match(result.request.url, /\/chat\/completions$/);
  assert.equal(result.request.model, "llama3.1");
  assert.equal(result.request.body.model, "llama3.1");
  assert.equal(result.request.body.max_tokens, 1);
  assert.equal(result.request.hasKey, true);
  // The key value must never appear anywhere in the returned debug data.
  assert.doesNotMatch(JSON.stringify(result), /sk-secret-value/);
});

test("checkCustomEndpoint captures the raw response body for debugging", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => '{"error":"model not found"}',
  }));
  const result = await AIS.checkCustomEndpoint(CUSTOM_CFG);
  assert.equal(result.kind, "http");
  assert.equal(result.status, 404);
  assert.match(result.responseText, /model not found/);
});

test("checkCustomEndpoint config error still includes the request preview", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: true, status: 200, text: async () => "{}" }));
  const result = await AIS.checkCustomEndpoint({ provider: "custom", customBaseUrl: "", customModel: "llama3.1" });
  assert.equal(result.kind, "config");
  assert.ok(result.request, "request preview present even when not sent");
  assert.equal(result.request.hasKey, false);
});

test("describeCustomEndpointResult: unreachable message names the URL and OLLAMA_ORIGINS", () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: false }));
  const msg = AIS.describeCustomEndpointResult({ ok: false, kind: "unreachable" }, "http://localhost:11434/v1/chat/completions");
  assert.match(msg, /http:\/\/localhost:11434/);
  assert.match(msg, /OLLAMA_ORIGINS/);
  assert.match(msg, /reach/i);
});

test("describeCustomEndpointResult: http 404 points at the model name", () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: false }));
  const msg = AIS.describeCustomEndpointResult({ ok: false, kind: "http", status: 404 }, "x");
  assert.match(msg, /404/);
  assert.match(msg, /model/i);
});

test("describeCustomEndpointResult: http 401 points at the key", () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: false }));
  const msg = AIS.describeCustomEndpointResult({ ok: false, kind: "http", status: 401 }, "x");
  assert.match(msg, /401/);
  assert.match(msg, /key/i);
});

test("describeCustomEndpointResult: ok message is positive", () => {
  const AIS = loadSummarizerWithFetch(async () => ({ ok: true }));
  const msg = AIS.describeCustomEndpointResult({ ok: true }, "http://localhost:11434/v1/chat/completions");
  assert.match(msg, /connect|reachable|success/i);
});
