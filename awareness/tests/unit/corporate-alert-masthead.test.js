// Corporate Alert (template id 'poster', buildCorporateAlert) must carry the shared
// ABInBev masthead — the gold gradient rule + black bar with the ABI.png logo (left) and
// the awareness tagline (right) — like the other ABInBev bulletins/posters. Guards that
// the brand masthead is present AND the existing dark "Stay Safe Online" hero survives.

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

function builderContext() {
  const context = {
    window: {}, URL, Date, console, setTimeout, clearTimeout,
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

const CFG = { org: "ACME", soc: "soc@acme.test", portal: "portal.acme.test", freq: "Weekly" };
const ARTS = [
  {
    type: "Phishing", title: "Suspicious login email", threatLevel: "High",
    description: "Attackers sent a fake login page to harvest credentials.",
    summary: "A fake login page tried to harvest credentials.",
    watchouts: ["Verify the sender on a second channel"],
    url: "https://example.test/a", source: "Test Source",
  },
];
const OPTS = { useLinks: true, usePoster: false, useQR: false, useIllus: true };

test.describe("Corporate Alert (poster) ABInBev masthead", () => {
  test("carries the ABInBev masthead (ABI.png logo + gold rule) without losing the hero header", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("poster", CFG, ARTS, OPTS);

    assert.ok(html.includes('data-template-id="poster"'), "template id stamped");
    assert.ok(html.includes('alt="ABInBev"'), "ABInBev logo present in the masthead");
    assert.ok(html.includes("ABI.png"), "uses the shared ABI.png asset");
    // The brand tagline that rides alongside the logo.
    assert.ok(/Security\s*&amp;\s*Compliance Awareness/.test(html), "masthead tagline present");
    // The gold gradient rule that tops the masthead.
    assert.ok(html.includes("linear-gradient(135deg,#C09010,#D4A420)"), "gold gradient rule present");
    // No regression: the existing dark hero header is still there.
    assert.ok(html.includes("Stay Safe"), "existing 'Stay Safe Online' hero header preserved");
  });
});
