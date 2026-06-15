// gen_strong_passwords poster — the closing ADVISORY line (SECTION3_BULLET1) is
// AI-generated, NOT hardcoded into the template. fillNewsletterTextSlots returns
// a `nlStrongPwAdvisory` slot: AI-filled when a key is present, otherwise a calm
// local fallback derived from the lead article's type. These tests exercise the
// deterministic local path (forceLocal) and the finalise rules (short, crisp,
// no trailing punctuation), mirroring the cybershield-slots harness.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadScript(context, relativePath) {
  vm.runInContext(readFileSync(path.join(rootDir, relativePath), "utf8"), context, {
    filename: path.join(rootDir, relativePath),
  });
}

function aiContext() {
  const context = {
    window: {},
    fetch: async () => ({ ok: false }),
    TextDecoder, TextEncoder, Uint8Array,
    console, setTimeout, clearTimeout,
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {},
      truncate(v, n) { return String(v || "").slice(0, n); },
      wait(ms) { return new Promise((r) => setTimeout(r, ms)); },
    },
  };
  return vm.createContext(context);
}

function loadAISummarizer(context) {
  loadScript(context, "js/ai/prompts.js");
  loadScript(context, "js/ai/local_fallbacks.js");
  loadScript(context, "js/ai_summarizer.js");
  return context.App.AISummarizer;
}

const PHISHING_ARTS = [{
  title: "New phishing scam impersonates the IT helpdesk to harvest passwords",
  type: "Phishing",
  summary: "Staff receive an email asking them to verify their login on a fake portal.",
}];

test("fillNewsletterTextSlots(gen_strong_passwords, local) returns a non-empty nlStrongPwAdvisory", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", PHISHING_ARTS, { forceLocal: true, mode: "balanced" });
  assert.ok(slots && typeof slots.nlStrongPwAdvisory === "string", "must return a nlStrongPwAdvisory string");
  assert.ok(slots.nlStrongPwAdvisory.length > 0, "advisory must be non-empty");
});

test("the advisory is short and crisp with no trailing punctuation", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", PHISHING_ARTS, { forceLocal: true });
  const line = slots.nlStrongPwAdvisory;
  assert.ok(line.length <= 48, `advisory must be <= 48 chars, got ${line.length}: "${line}"`);
  assert.ok(!/[.!?;:,]$/.test(line), `advisory must not end with punctuation: "${line}"`);
  assert.ok(!/["'“”]/.test(line), `advisory must not contain quotes: "${line}"`);
});

test("the local advisory is theme-aware (a phishing story yields a click-caution line)", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", PHISHING_ARTS, { forceLocal: true });
  assert.match(slots.nlStrongPwAdvisory, /click/i, "phishing → a 'Think Before You Click'-style advisory");
});

test("with no articles it falls back to a calm default advisory", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", [], { forceLocal: true });
  assert.ok(slots.nlStrongPwAdvisory && slots.nlStrongPwAdvisory.length > 0, "must still produce a default advisory");
  assert.match(slots.nlStrongPwAdvisory, /safe|secure/i, "default reads as a generic safety advisory");
});
