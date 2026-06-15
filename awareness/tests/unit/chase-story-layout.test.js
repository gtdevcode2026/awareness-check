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

// NewsletterBuilder harness — mirrors tests/unit/cybershield-slots.test.js.
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

const ARTS = [
  { type: "Phishing", title: "Login-page clone harvests staff passwords", description: "Spoofed portal.", source: "Bleeping Computer", url: "https://x/1" },
  { type: "Smishing", title: "Fake delivery text steals details", description: "SMS link.", source: "The Hacker News", url: "https://y/2" },
];

// Distinct, regex-safe dialogue markers so each card's text is unambiguously findable.
const CFG = {
  org: "ACME", soc: "soc@acme.test", portal: "https://portal.example",
  nlChaseDialogues: ["ALPHADIALOGUEONE victim quote", "BRAVODIALOGUETWO victim quote"],
};

const ICON = "mascot_mug.png";
const GLOW = "box-shadow:0 0 18px rgba(201,168,76,0.45)";

test.describe("gen_chase_email story-card layout", () => {
  test("cards zigzag: card 1 icon-left, card 2 icon-right", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });

    const icon1 = html.indexOf(ICON);
    const icon2 = html.indexOf(ICON, icon1 + 1);
    const text1 = html.indexOf("ALPHADIALOGUEONE");
    const text2 = html.indexOf("BRAVODIALOGUETWO");

    assert.ok(icon1 > -1 && icon2 > -1, "both story-card icons render");
    assert.ok(text1 > -1 && text2 > -1, "both dialogue slots render");

    // Card 1: icon before text → icon on the LEFT.
    assert.ok(icon1 < text1, "card 1 keeps the icon on the left (icon before dialogue)");
    // Card 2: text before icon → icon on the RIGHT (the zigzag).
    assert.ok(text2 < icon2, "card 2 flips the icon to the right (dialogue before icon)");
  });

  test("stories sit flat in the newsletter body — no card panel, border, or glow", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });

    assert.ok(!html.includes(GLOW), "no box-shadow glow (stories are flat)");
    assert.ok(!html.includes("background:#151515"), "no elevated #151515 panel background");
    assert.ok(!html.includes("border:1px solid #6E5A28"), "no card border");
    // The story content still renders inline in the body.
    assert.ok(html.includes("ALPHADIALOGUEONE"), "story 1 dialogue present");
    assert.ok(html.includes("BRAVODIALOGUETWO"), "story 2 dialogue present");
  });

  test("footer + pills are Outlook-safe: no rgba backgrounds, borders, or white text (Word drops rgba)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });

    assert.ok(!html.includes("background:rgba("), "pill backgrounds are solid hex + bgcolor");
    assert.ok(!html.includes("border:1px solid rgba("), "pill/button borders are solid hex");
    assert.ok(!html.includes("color:rgba(255,255,255"), "dim footer text is solid hex");
  });

  test("pills center their text in the eml (Word-safe align attributes + text-align)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });

    // All 3 chase pills ("How it can happen", "Precautionary Measures", "Key takeaways")
    // use a centered cell — align/valign attributes (Word honours) + text-align style.
    const centered = html.split("border-radius:20px; padding:6px 14px; text-align:center;").length - 1;
    assert.equal(centered, 3, "all 3 chase pills center their text");
    assert.ok(html.includes('<td align="center" valign="middle" bgcolor="#231d0d"'), "pill cell carries align/valign attributes Word honours");
  });

  test("dialogue is enlarged + bold, and the ARTICLE labels are removed", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });

    // Dialogue quote restyled: bigger and bold (was 15px / weight 400).
    assert.ok(html.includes("font-size:18px; font-weight:700; font-style:italic; color:#dddddd"), "dialogue is 18px and bold");
    assert.ok(!html.includes("font-size:15px; font-weight:400; font-style:italic; color:#dddddd"), "old 15px/normal dialogue style is gone");

    // The "ARTICLE 1" / "ARTICLE 2" eyebrow labels are removed from both cards.
    assert.ok(!html.includes(">Article 1<"), "Article 1 label removed");
    assert.ok(!html.includes(">Article 2<"), "Article 2 label removed");
  });

  // Outlook Classic renders email with Microsoft Word's engine, which honours the
  // `bgcolor` attribute / `background-color` longhand but drops the `background:`
  // shorthand and rgba() values. The footer CTAs were authored with the dropped
  // forms, so they lost their fill/border in Outlook. These lock in the safe forms.
  test("SOC CTA is a real filled button Outlook will render (bgcolor attribute, padded cell)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
    assert.ok(html.includes('bgcolor="#D4A420"'), "SOC button cell carries a bgcolor attribute");
    assert.ok(!html.includes("background:#D4A420; border-radius:6px"), "no style-only shorthand background (Word drops it)");
  });

  test("Visit Portal button uses a solid-hex border, not rgba (Word drops rgba)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("gen_chase_email", CFG, ARTS, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
    assert.ok(!html.includes("border:1px solid rgba(212,164,32,.5)"), "portal border is solid hex, not rgba");
  });
});
