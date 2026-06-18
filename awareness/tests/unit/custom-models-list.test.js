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

// Build an AISummarizer whose fetch behaves as the test dictates (mirrors the
// helper in custom-endpoint-check.test.js).
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
      truncate(value, limit) { return String(value || "").slice(0, limit); },
      wait() { return Promise.resolve(); },
    },
  };
  vm.createContext(context);
  loadScript(context, "js/ai/prompts.js");
  loadScript(context, "js/ai/local_fallbacks.js");
  loadScript(context, "js/ai_summarizer.js");
  return context.App.AISummarizer;
}

const NOOP_FETCH = async () => ({ ok: true, status: 200, text: async () => "{}" });

// ── resolveModelsUrl: derive <base>/models like normalizeChatCompletionsUrl ──

test("resolveModelsUrl: bare host gets /v1/models", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl("http://localhost:11434"), "http://localhost:11434/v1/models");
});

test("resolveModelsUrl: a /api/v2 base appends /models directly", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(
    AIS.resolveModelsUrl("https://abi-apim-internal.ab-inbev.com/asimov_stg_ghq/api/v2"),
    "https://abi-apim-internal.ab-inbev.com/asimov_stg_ghq/api/v2/models"
  );
});

test("resolveModelsUrl: the loopback relay /v1 base maps to /v1/models", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl("http://127.0.0.1:8799/v1"), "http://127.0.0.1:8799/v1/models");
});

test("resolveModelsUrl: a full chat/completions URL becomes the sibling /models", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl("https://host/v1/chat/completions"), "https://host/v1/models");
});

test("resolveModelsUrl: an already-/models URL is left unchanged", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl("https://host/api/v2/models"), "https://host/api/v2/models");
});

test("resolveModelsUrl: trailing slashes are trimmed", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl("http://localhost:11434/"), "http://localhost:11434/v1/models");
});

test("resolveModelsUrl: empty / nullish input returns ''", () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  assert.equal(AIS.resolveModelsUrl(""), "");
  assert.equal(AIS.resolveModelsUrl(null), "");
  assert.equal(AIS.resolveModelsUrl(undefined), "");
});

// ── listModels: GET the endpoint and normalize the model list ──

const CUSTOM_CFG = {
  provider: "custom",
  customBaseUrl: "http://127.0.0.1:8799/v1",
  customKey: "",
};

test("listModels: parses the OpenAI {data:[{id}]} shape", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ object: "list", data: [{ id: "openai/gpt-4o-mini" }, { id: "openai/gpt-4o" }] }),
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.ok, true);
  // Compare by value: arrays cross the VM realm boundary so deepStrictEqual
  // would reject them on prototype identity despite identical contents.
  assert.equal(result.models.join(","), "openai/gpt-4o-mini,openai/gpt-4o");
});

test("listModels: parses a bare array of strings", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify(["m1", "m2"]),
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.models.join(","), "m1,m2");
});

test("listModels: parses a {models:[...]} wrapper and id/name/model item keys", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ models: [{ name: "n1" }, { model: "m1" }, { id: "i1" }, "s1"] }),
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.models.join(","), "n1,m1,i1,s1");
});

test("listModels: dedupes and drops blank ids while preserving order", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: [{ id: "a" }, { id: "a" }, { id: "" }, { id: "b" }] }),
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.models.join(","), "a,b");
});

test("listModels: an HTTP error is reported with kind 'http' and the status", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: false, status: 401, text: async () => '{"error":"unauthorized"}',
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "http");
  assert.equal(result.status, 401);
  assert.equal(result.models.length, 0);
});

test("listModels: a thrown fetch is reported as 'unreachable' (CORS / down)", async () => {
  const AIS = loadSummarizerWithFetch(async () => { throw new TypeError("Failed to fetch"); });
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unreachable");
});

test("listModels: a non-JSON body is reported as kind 'parse'", async () => {
  const AIS = loadSummarizerWithFetch(async () => ({
    ok: true, status: 200, text: async () => "<html>not json</html>",
  }));
  const result = await AIS.listModels(CUSTOM_CFG);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "parse");
});

test("listModels: a missing base URL is reported as kind 'config'", async () => {
  const AIS = loadSummarizerWithFetch(NOOP_FETCH);
  const result = await AIS.listModels({ provider: "custom", customBaseUrl: "" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "config");
});

test("listModels: GETs the /models URL and never leaks the key", async () => {
  let seenUrl = "", seenOpts = null;
  const AIS = loadSummarizerWithFetch(async (url, opts) => {
    seenUrl = url; seenOpts = opts;
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "a" }] }) };
  });
  const result = await AIS.listModels({ ...CUSTOM_CFG, customKey: "sk-secret-value" });
  assert.equal(seenOpts.method, "GET");
  assert.match(seenUrl, /\/models$/);
  assert.equal(result.request.method, "GET");
  assert.match(result.request.url, /\/models$/);
  assert.equal(result.request.hasKey, true);
  // The key value must never appear anywhere in the returned debug data.
  assert.doesNotMatch(JSON.stringify(result), /sk-secret-value/);
});
