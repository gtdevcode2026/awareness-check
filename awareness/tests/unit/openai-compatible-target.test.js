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

function createContext() {
  const context = {
    window: {},
    fetch: async () => ({ ok: false }),
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
      wait(ms) {
        return new Promise((r) => setTimeout(r, ms));
      },
    },
  };
  return vm.createContext(context);
}

function loadSummarizer() {
  const context = createContext();
  loadScript(context, "js/ai/prompts.js");
  loadScript(context, "js/ai/local_fallbacks.js");
  loadScript(context, "js/ai_summarizer.js");
  return context.App.AISummarizer;
}

test("isOpenAICompatible is true for openai and custom, false for claude", () => {
  const { isOpenAICompatible } = loadSummarizer();
  assert.equal(isOpenAICompatible("openai"), true);
  assert.equal(isOpenAICompatible("custom"), true);
  assert.equal(isOpenAICompatible("claude"), false);
  assert.equal(isOpenAICompatible("local"), false);
  assert.equal(isOpenAICompatible(undefined), false);
});

test("normalizeChatCompletionsUrl appends /v1/chat/completions to a bare host", () => {
  const { normalizeChatCompletionsUrl } = loadSummarizer();
  assert.equal(
    normalizeChatCompletionsUrl("http://localhost:11434"),
    "http://localhost:11434/v1/chat/completions"
  );
});

test("normalizeChatCompletionsUrl strips a trailing slash before appending", () => {
  const { normalizeChatCompletionsUrl } = loadSummarizer();
  assert.equal(
    normalizeChatCompletionsUrl("http://localhost:11434/"),
    "http://localhost:11434/v1/chat/completions"
  );
});

test("normalizeChatCompletionsUrl appends /chat/completions to a /v1 base", () => {
  const { normalizeChatCompletionsUrl } = loadSummarizer();
  assert.equal(
    normalizeChatCompletionsUrl("https://openrouter.ai/api/v1"),
    "https://openrouter.ai/api/v1/chat/completions"
  );
  assert.equal(
    normalizeChatCompletionsUrl("https://openrouter.ai/api/v1/"),
    "https://openrouter.ai/api/v1/chat/completions"
  );
});

test("normalizeChatCompletionsUrl leaves a full chat-completions URL unchanged", () => {
  const { normalizeChatCompletionsUrl } = loadSummarizer();
  assert.equal(
    normalizeChatCompletionsUrl("https://host/v1/chat/completions"),
    "https://host/v1/chat/completions"
  );
});

test("normalizeChatCompletionsUrl returns empty string for blank input", () => {
  const { normalizeChatCompletionsUrl } = loadSummarizer();
  assert.equal(normalizeChatCompletionsUrl(""), "");
  assert.equal(normalizeChatCompletionsUrl("   "), "");
  assert.equal(normalizeChatCompletionsUrl(null), "");
});

test("resolveOpenAITarget returns the OpenAI endpoint for the openai provider", () => {
  const { resolveOpenAITarget } = loadSummarizer();
  const target = resolveOpenAITarget({
    provider: "openai",
    openaiKey: "sk-test",
    openaiModel: "gpt-4o-mini",
  });
  assert.equal(target.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(target.key, "sk-test");
  assert.equal(target.model, "gpt-4o-mini");
});

test("resolveOpenAITarget returns the normalized custom endpoint for the custom provider", () => {
  const { resolveOpenAITarget } = loadSummarizer();
  const target = resolveOpenAITarget({
    provider: "custom",
    customBaseUrl: "http://localhost:11434",
    customModel: "llama3.1",
    customKey: "",
  });
  assert.equal(target.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(target.key, "");
  assert.equal(target.model, "llama3.1");
});

test("hasUsableTarget requires a key for openai", () => {
  const { hasUsableTarget } = loadSummarizer();
  assert.equal(hasUsableTarget({ provider: "openai", openaiKey: "sk-x" }), true);
  assert.equal(hasUsableTarget({ provider: "openai", openaiKey: "" }), false);
});

test("hasUsableTarget needs only a base URL for custom (key optional)", () => {
  const { hasUsableTarget } = loadSummarizer();
  assert.equal(
    hasUsableTarget({ provider: "custom", customBaseUrl: "http://localhost:11434", customKey: "" }),
    true
  );
  assert.equal(hasUsableTarget({ provider: "custom", customBaseUrl: "", customKey: "" }), false);
});

test("hasUsableTarget is false for non-OpenAI-compatible providers", () => {
  const { hasUsableTarget } = loadSummarizer();
  assert.equal(hasUsableTarget({ provider: "claude", claudeKey: "sk-ant" }), false);
});
