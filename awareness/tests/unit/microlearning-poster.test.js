// The Microlearning Benefits poster (id: gen_microlearning) is an ABI-branded,
// email-safe, AI-wired awareness poster onboarded to the Beta tier. This guards:
//   1. the AI/local slot-fill (title + 5 benefit cards),
//   2. the builder output (ABI masthead, 5 benefits, hardcoded SOC CTA, NO
//      CyberPilot branding), and
//   3. catalog placement (Beta, not Ready).

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

// ── Harness B: NewsletterBuilder (build('gen_microlearning', ...)) ──
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

const ARTS = [
  { type: "Phishing", title: "Invoice fraud hits finance teams", summary: "Attackers impersonate vendors and swap bank details mid-thread." },
  { type: "Ransomware", title: "Crews steal before they encrypt", summary: "Double extortion means backups no longer end the story." },
];

const OPTS = { useLinks: false, usePoster: false, useQR: false, useIllus: false };

const DEFAULT_HEADINGS = [
  "Continuous learning",
  "Better retention",
  "Time-flexible",
  "More engaging",
  "Better outcomes",
];

test.describe("gen_microlearning AI/local slots", () => {
  test("local fill returns a title + exactly 5 benefit cards (heading + body)", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_microlearning", ARTS, { forceLocal: true, mode: "balanced", skipCoherenceCheck: true });
    assert.equal(typeof slots.nlMicroTitle, "string");
    assert.ok(slots.nlMicroTitle.length > 0, "title is non-empty");
    assert.ok(Array.isArray(slots.nlMicroBenefits), "benefits is an array");
    assert.equal(slots.nlMicroBenefits.length, 5, "exactly 5 benefit cards");
    for (const b of slots.nlMicroBenefits) {
      assert.ok(b && typeof b.heading === "string" && b.heading.length > 0, "each card has a heading");
      assert.ok(b && typeof b.body === "string" && b.body.length > 0, "each card has a body");
    }
  });

  test("empty article set still yields a title + 5 benefits (defaults, no crash)", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("gen_microlearning", [], { forceLocal: true });
    assert.ok(slots.nlMicroTitle.length > 0);
    assert.equal(slots.nlMicroBenefits.length, 5);
  });
});

test.describe("gen_microlearning builder output", () => {
  test("renders ABI masthead, figure, title + 5 bubbles, hardcoded SOC CTA, no CyberPilot", () => {
    const NB = loadBuilder(builderContext());
    const cfg = { org: "ACME", soc: "soc@acme.test", portal: "portal.acme.test" };
    const html = NB.build("gen_microlearning", cfg, ARTS, OPTS);

    assert.ok(html.includes('data-template-id="gen_microlearning"'), "template id stamped");
    assert.ok(html.includes('alt="ABInBev"'), "ABI masthead logo present");
    assert.ok(html.includes("Awareness Series"), "masthead subtitle present");
    assert.ok(html.includes("microlearning_figure"), "central figure image referenced");
    assert.ok(/Benefits of Microlearning/i.test(html), "default title rendered");
    for (const h of DEFAULT_HEADINGS) {
      assert.ok(html.includes(h), `benefit bubble rendered: ${h}`);
    }
    // Mandatory hardcoded SOC CTA.
    assert.ok(html.includes("Report to SOC Now &rarr; soc-support@ab-inbev.com"), "hardcoded SOC CTA present");
    // CyberPilot branding from the reference must be gone.
    assert.ok(!/cyberpilot/i.test(html), "no CyberPilot branding");
  });

  test("AI-filled slots are rendered verbatim (title + custom benefit bubbles)", () => {
    const NB = loadBuilder(builderContext());
    const cfg = {
      org: "ACME",
      soc: "soc@acme.test",
      nlMicroTitle: "Why Microlearning Wins",
      nlMicroBenefits: [
        { heading: "Sticks Better", body: "Short bursts beat long sessions for recall." },
        { heading: "Fits Your Day", body: "Five minutes between meetings is enough." },
      ],
    };
    const html = NB.build("gen_microlearning", cfg, ARTS, OPTS);
    assert.ok(html.includes("Why Microlearning Wins"), "custom title rendered");
    assert.ok(html.includes("Sticks Better"), "custom heading rendered");
    assert.ok(html.includes("Short bursts beat long sessions for recall."), "custom body rendered");
    assert.ok(html.includes("Fits Your Day"), "second custom heading rendered");
  });
});

test.describe("gen_microlearning catalog placement (Beta)", () => {
  test("is in the catalog, marked Beta, and NOT in the Ready set", () => {
    const NB = loadBuilder(builderContext());
    const catalog = NB.getTemplateCatalog();
    const micro = catalog.find((t) => t.id === "gen_microlearning");
    assert.ok(micro, "gen_microlearning is in the catalog");
    assert.equal(micro.status, "beta", "marked Beta (not Ready)");
    // Beta slider = everything not ready and not testing.
    const beta = catalog.filter((t) => t.status !== "ready" && t.status !== "testing");
    assert.ok(beta.some((t) => t.id === "gen_microlearning"), "appears in the Beta slider");
    const ready = catalog.filter((t) => t.status === "ready");
    assert.ok(!ready.some((t) => t.id === "gen_microlearning"), "not in the Ready tier");
  });
});
