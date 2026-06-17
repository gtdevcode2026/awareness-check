// AI provider dropdown options — locks which providers config.html offers.
// The Custom (OpenAI-compatible) provider was removed from the picker; this
// guards against it silently reappearing.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "../..");

function aiProviderSelect(html) {
  const m = html.match(/<select id="ai-provider">([\s\S]*?)<\/select>/i);
  assert.ok(m, "config.html must contain the #ai-provider <select>");
  return m[1];
}

test("config.html AI provider dropdown offers claude + openai but NOT custom", () => {
  const html = readFileSync(path.join(rootDir, "config.html"), "utf8");
  const options = aiProviderSelect(html);
  assert.match(options, /value="claude"/, "claude option must remain");
  assert.match(options, /value="openai"/, "openai option must remain");
  assert.ok(
    !/value="custom"/.test(options),
    "custom provider option must NOT be selectable from config"
  );
});
