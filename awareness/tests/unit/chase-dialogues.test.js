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

// ── Harness A: AISummarizer (fillNewsletterTextSlots + local slot helpers) ──
function aiContext() {
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

// ── Harness B: NewsletterBuilder (build('gen_chase_email', ...)) ──
function builderContext() {
  const context = {
    window: {},
    URL,
    Date,
    console,
    setTimeout,
    clearTimeout,
    navigator: { hardwareConcurrency: 4 },
    performance: { now: () => 0 },
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {},
      fmtDate(v) { return v || ""; },
      stripTags(v) { return String(v || "").replace(/<[^>]*>/g, ""); },
      truncate(v, n) { return String(v || "").slice(0, n); },
      normalizeWebUrl(v) {
        const s = String(v || "").trim();
        if (!s) return "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
        return `https://${s.replace(/^\/+/, "")}`;
      },
    },
    Graphics: {
      phishEmailCompact: () => "<svg/>", shieldLockCompact: () => "<svg/>", smishingCompact: () => "<svg/>",
      vishingCompact: () => "<svg/>", dataLeakCompact: () => "<svg/>", mfaCompact: () => "<svg/>",
      peopleCompact: () => "<svg/>", warningCompact: () => "<svg/>", fakeSiteCompact: () => "<svg/>",
    },
  };
  return vm.createContext(context);
}

function loadBuilder(context) {
  loadScript(context, "js/feed_scoring.js");
  loadScript(context, "js/rss_fetcher.js");
  loadScript(context, "js/newsletter_builder.js");
  loadScript(context, "js/newsletter/bank_page.js");
  loadScript(context, "js/newsletter/core_templates.js");
  return context.App.NewsletterBuilder;
}

const CHASE_DIALOGUE_MAX_CHARS = 130;

const MIXED_ARTS = [
  { type: "Phishing", title: "QR phishing harvests payroll credentials", description: "Spoofed login pages steal passwords.", source: "Bleeping Computer", url: "https://x/phish" },
  { type: "Smishing", title: "Fake missed delivery text messages target staff", description: "Smishing on the rise; SMS links steal logins.", source: "The Hacker News", url: "https://y/smish" },
];

test.describe("gen_chase_email first-person victim dialogues (slots)", () => {
  test("fillNewsletterTextSlots(local) returns one dialogue per article and keeps precautions", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_chase_email", MIXED_ARTS, { forceLocal: true, mode: "balanced" });
    assert.ok(Array.isArray(slots.nlChaseDialogues), "dialogues should be an array");
    assert.equal(slots.nlChaseDialogues.length, MIXED_ARTS.length, "one dialogue per article");
    for (const d of slots.nlChaseDialogues) {
      assert.equal(typeof d, "string");
      assert.ok(d.length > 0, "dialogue is non-empty");
      assert.ok(d.length <= CHASE_DIALOGUE_MAX_CHARS, `dialogue within ${CHASE_DIALOGUE_MAX_CHARS} chars (was ${d.length})`);
    }
    // Regression: the precautions slot wasn't dropped by the merge.
    assert.ok(Array.isArray(slots.nlChasePrecautions) && slots.nlChasePrecautions.length === 3, "precautions still produced");
  });

  test("local dialogues adapt to each article's attack type", async () => {
    const AIS = loadAISummarizer(aiContext());
    const lines = AIS.localChaseDialoguesFromArticles(MIXED_ARTS);
    assert.equal(lines.length, 2);
    // First person voice.
    assert.match(lines[0], /^I\b|^The\b|^My\b/);
    // Phishing → clicking a link / entering a password.
    assert.match(lines[0], /link|login|password/i, "phishing dialogue is link/credential flavoured");
    // Smishing → a text-message flavour.
    assert.match(lines[1], /text|tapped|message/i, "smishing dialogue is text-message flavoured");
  });

  test("empty article set yields a single default dialogue", async () => {
    const AIS = loadAISummarizer(aiContext());
    const lines = AIS.localChaseDialoguesFromArticles([]);
    assert.ok(Array.isArray(lines) && lines.length === 1 && lines[0].length > 0);
  });
});

test.describe("buildGenChaseEmail renders dialogues in place of titles", () => {
  test("renders the provided dialogues, drops the raw headline, keeps source + read link", () => {
    const NB = loadBuilder(builderContext());
    const cfg = {
      org: "ACME", soc: "soc@acme.test", portal: "https://portal.example", pname: "Awareness Portal",
      nlChaseDialogues: ["CUSTOM VICTIM STORY ONE about a link.", "CUSTOM VICTIM STORY TWO about a text."],
    };
    const html = NB.build("gen_chase_email", cfg, MIXED_ARTS, { useLinks: true, usePoster: false, useQR: false, useIllus: false });
    assert.ok(html.includes('data-template-id="gen_chase_email"'), "correct template built");
    // Dialogues rendered.
    assert.ok(html.includes("CUSTOM VICTIM STORY ONE about a link."), "card 1 dialogue rendered");
    assert.ok(html.includes("CUSTOM VICTIM STORY TWO about a text."), "card 2 dialogue rendered");
    // Raw headlines are no longer shown.
    assert.ok(!html.includes(MIXED_ARTS[0].title), "card 1 raw title not rendered");
    assert.ok(!html.includes(MIXED_ARTS[1].title), "card 2 raw title not rendered");
    // Link to each article preserved.
    assert.ok(html.includes("Read article"), "read-article anchor preserved");
    assert.ok(html.includes(MIXED_ARTS[0].url), "card 1 article url preserved");
    assert.ok(html.includes(MIXED_ARTS[1].url), "card 2 article url preserved");
    // Source labels preserved.
    assert.ok(html.includes(MIXED_ARTS[0].source) && html.includes(MIXED_ARTS[1].source), "sources preserved");
  });

  test("falls back to hardcoded first-person defaults when no dialogues in cfg", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", { org: "ACME", soc: "soc@acme.test" }, MIXED_ARTS, { useLinks: true, usePoster: false, useQR: false, useIllus: false });
    // Default dialogue text appears (no empty card), in first person.
    assert.match(html, /I clicked the link in the email/, "card 1 default dialogue rendered");
    assert.match(html, /I got a text about a missed delivery/, "card 2 default dialogue rendered");
  });
});
