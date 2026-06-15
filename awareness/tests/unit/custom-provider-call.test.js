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

// Builds a context with a recording fetch that always returns a valid
// OpenAI-shaped chat-completion. Returns { App, calls } where `calls` records
// every request as { url, init }.
function loadWithRecordingFetch() {
  const calls = [];
  const aiContent = JSON.stringify({
    summary: "Attackers send fake invoices and demand fast payment.",
    threatLevel: 3,
    category: "Scam & Fraud",
    confidence: 0.9,
    watchouts: ["Verify payment requests through a known contact"],
  });
  const context = {
    window: {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: aiContent } }] }),
      };
    },
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
  return { App: context.App, calls };
}

test("custom provider with no key POSTs to the normalized URL with no Authorization header", async () => {
  const { App, calls } = loadWithRecordingFetch();
  App.AISummarizer.configure({
    provider: "custom",
    customBaseUrl: "http://localhost:11434",
    customModel: "llama3.1",
    customKey: "",
  });

  const result = await App.AISummarizer.summarizeArticle(
    { title: "Fake invoice scam", description: "Attackers email fake invoices.", type: "Scam & Fraud" },
    { mode: "balanced" }
  );

  // The AI path was taken (not the local fallback).
  assert.equal(result.fallbackUsed, false);
  assert.ok(calls.length >= 1, "expected at least one fetch call");

  const first = calls[0];
  assert.equal(first.url, "http://localhost:11434/v1/chat/completions");
  // Keyless: no Authorization header at all.
  assert.equal(first.init.headers.Authorization, undefined);
  // The custom model name is sent in the request body.
  const body = JSON.parse(first.init.body);
  assert.equal(body.model, "llama3.1");
});

test("custom provider with a key sends Authorization: Bearer <key>", async () => {
  const { App, calls } = loadWithRecordingFetch();
  App.AISummarizer.configure({
    provider: "custom",
    customBaseUrl: "https://openrouter.ai/api/v1",
    customModel: "mistralai/mistral-7b-instruct",
    customKey: "or-secret",
  });

  await App.AISummarizer.summarizeArticle(
    { title: "Phishing wave", description: "Credential harvesting emails.", type: "Phishing" },
    { mode: "balanced" }
  );

  const first = calls[0];
  assert.equal(first.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(first.init.headers.Authorization, "Bearer or-secret");
});
