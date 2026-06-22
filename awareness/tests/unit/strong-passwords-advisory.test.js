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

// The three precaution tiles are now a BUILD-TIME slot (nlStrongPwTips) so they
// no longer depend on the article being AI-curated at fetch time. The local
// path derives them from the lead article's watchouts, padded with defaults.
test("fillNewsletterTextSlots(gen_strong_passwords, local) returns three non-empty nlStrongPwTips", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", PHISHING_ARTS, { forceLocal: true, mode: "balanced" });
  assert.ok(Array.isArray(slots.nlStrongPwTips), "must return a nlStrongPwTips array");
  assert.equal(slots.nlStrongPwTips.length, 3, "exactly three tiles");
  assert.ok(slots.nlStrongPwTips.every((t) => typeof t === "string" && t.trim().length > 0), "every tile non-empty");
});

test("local nlStrongPwTips use the lead article's watchouts when present", async () => {
  const AIS = loadAISummarizer(aiContext());
  const arts = [{ title: "X", type: "Phishing", summary: "y", watchouts: ["Hover links before clicking", "Confirm the sender by phone", "Forward odd emails to the SOC"] }];
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", arts, { forceLocal: true });
  // Compare element-by-element: the array comes from the vm realm, so a strict
  // deepEqual would fail on cross-realm Array.prototype identity, not on value.
  assert.equal(slots.nlStrongPwTips[0], "Hover links before clicking");
  assert.equal(slots.nlStrongPwTips[1], "Confirm the sender by phone");
  assert.equal(slots.nlStrongPwTips[2], "Forward odd emails to the SOC");
});

test("with no articles, nlStrongPwTips fall back to three generic precautions", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_strong_passwords", [], { forceLocal: true });
  assert.equal(slots.nlStrongPwTips.length, 3);
  assert.ok(slots.nlStrongPwTips.every((t) => t && t.length > 0), "every default tile non-empty");
});

// tipThemeClause is the additive steer appended to poster tip prompts when the
// user enters a theme via the poster flip form. It must be a no-op without a
// theme (so the original generation is byte-identical) and carry the theme when set.
test.describe("tipThemeClause (poster tip-theme steer)", () => {
  test("is empty for missing / blank themes (original prompts unchanged)", () => {
    const AIS = loadAISummarizer(aiContext());
    assert.equal(AIS.tipThemeClause(""), "");
    assert.equal(AIS.tipThemeClause("   "), "");
    assert.equal(AIS.tipThemeClause(undefined), "");
    assert.equal(AIS.tipThemeClause(null), "");
  });

  test("appends an instruction carrying the theme when provided", () => {
    const AIS = loadAISummarizer(aiContext());
    const clause = AIS.tipThemeClause("how to spot");
    assert.match(clause, /how to spot/, "theme text present");
    assert.match(clause, /theme/i, "framed as a theme instruction");
    assert.match(clause, /grounded in the article/i, "preserves the article-driven rule");
    assert.ok(clause.startsWith("\n"), "appended as a trailing clause, not inline");
  });

  test("caps an overly long theme at 120 chars", () => {
    const AIS = loadAISummarizer(aiContext());
    const clause = AIS.tipThemeClause("x".repeat(500));
    assert.ok(clause.includes("x".repeat(120)), "keeps up to 120 theme chars");
    assert.ok(!clause.includes("x".repeat(121)), "drops anything beyond 120");
  });
});

// gen_vishing carries a visible "How to Spot" heading above its four tip cards.
// When the user picks a theme on the poster flip form, that heading must become
// the picked text verbatim; with no theme it must stay unset so the template
// keeps its hardcoded "How to Spot" default (build output byte-identical).
test.describe("vishing tips heading (poster flip-form theme → 'How to Spot' label)", () => {
  test("no theme leaves the heading slot unset (template default preserved)", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_vishing", PHISHING_ARTS, { forceLocal: true });
    assert.equal(slots.nlVishingTipsHeading, undefined, "no theme must not override the heading");
  });

  test("a picked theme becomes the heading verbatim", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_vishing", PHISHING_ARTS, { forceLocal: true, tipTheme: "Impact" });
    assert.equal(slots.nlVishingTipsHeading, "Impact", "heading must equal the picked theme exactly");
  });

  test("a custom typed theme is carried verbatim (trimmed)", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_vishing", PHISHING_ARTS, { forceLocal: true, tipTheme: "  Why it matters here  " });
    assert.equal(slots.nlVishingTipsHeading, "Why it matters here", "surrounding whitespace is trimmed, text otherwise verbatim");
  });
});
