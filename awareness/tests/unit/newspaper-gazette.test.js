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

// ── Harness B: NewsletterBuilder (build('newspaper', ...)) ──
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

const ARTS3 = [
  { type: "Phishing", title: "Invoice fraud hits finance teams", summary: "Attackers impersonate vendors and swap bank details mid-thread.", watchouts: ["Verify bank-detail changes by phone using a known number", "Treat urgent pay-now requests as suspect", "Forward odd invoices to security before paying"] },
  { type: "Ransomware", title: "Crews steal before they encrypt", summary: "Double extortion means backups no longer end the story.", watchouts: ["Keep offline backups of critical data", "Report a suspected infection immediately"] },
  { type: "Password & MFA", title: "MFA-fatigue attacks climb", summary: "One reflex approval tap can surrender an account.", watchouts: ["Deny any login prompt you did not start", "Use a unique password for every account"] },
];

const OPTS = { useLinks: false, usePoster: false, useQR: false, useIllus: false };

test.describe("newspaper (Cyber Gazette) precaution slots", () => {
  test("fillNewsletterTextSlots(local) returns 3 lead bullets + 4 checklist measures drawn from the articles", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("newspaper", ARTS3, { forceLocal: true, mode: "balanced", skipCoherenceCheck: true });
    assert.ok(Array.isArray(slots.nlNewspaperLeadBullets), "lead bullets is an array");
    assert.equal(slots.nlNewspaperLeadBullets.length, 3, "exactly 3 lead bullets");
    assert.ok(Array.isArray(slots.nlNewspaperMeasures), "measures is an array");
    assert.equal(slots.nlNewspaperMeasures.length, 4, "exactly 4 checklist measures");
    // Lead bullets come from the lead article (arts[0]).
    assert.match(slots.nlNewspaperLeadBullets.join(" "), /bank|invoice|pay/i, "lead bullets reflect the lead story");
    // Checklist cycles [art0, art1, art2, art0]: a ransomware and an MFA term must appear.
    const measuresText = slots.nlNewspaperMeasures.join(" ");
    assert.match(measuresText, /backup|infection/i, "measure drawn from the ransomware article");
    assert.match(measuresText, /login|password|account/i, "measure drawn from the MFA article");
  });

  test("empty article set still yields 3 bullets + 4 measures (defaults, no crash)", async () => {
    const AIS = loadAISummarizer(aiContext());
    const slots = await AIS.fillNewsletterTextSlots("newspaper", [], { forceLocal: true });
    assert.equal(slots.nlNewspaperLeadBullets.length, 3);
    assert.equal(slots.nlNewspaperMeasures.length, 4);
    assert.ok(slots.nlNewspaperLeadBullets.every((b) => typeof b === "string" && b.length > 0));
    assert.ok(slots.nlNewspaperMeasures.every((m) => typeof m === "string" && m.length > 0));
  });
});

test.describe("Cyber Gazette catalog placement", () => {
  test("is onboarded to Ready and leads the Ready newsletter slider", () => {
    const NB = loadBuilder(builderContext());
    const catalog = NB.getTemplateCatalog();
    const gazette = catalog.find((t) => t.id === "newspaper");
    assert.ok(gazette, "newspaper is in the catalog");
    assert.equal(gazette.status, "ready", "newspaper is in the Ready tier");
    assert.ok(!(Array.isArray(gazette.tags) && gazette.tags.includes("poster")), "no 'poster' tag → newsletter slider, not poster slider");
    // Mirror index.html's slider split: Ready, non-poster = newsletter slider.
    const ready = catalog.filter((t) => t.status === "ready");
    const readyNewsletter = ready.filter((t) => !(Array.isArray(t.tags) && t.tags.includes("poster")));
    assert.ok(readyNewsletter.some((t) => t.id === "newspaper"), "Cyber Gazette is in the Ready newsletter slider");
    assert.equal(readyNewsletter[0].id, "poster", "poster stays the default first slide");
    assert.equal(readyNewsletter[1].id, "newspaper", "Cyber Gazette leads right after the default poster");
    // It is no longer in the Beta group.
    const beta = catalog.filter((t) => t.status !== "ready" && t.status !== "testing");
    assert.ok(!beta.some((t) => t.id === "newspaper"), "Cyber Gazette is no longer in Beta");
  });
});

test.describe("buildCyberGazette renders the broadsheet from up to 3 articles", () => {
  test("AI-filled checklist measures render verbatim (lead bullets no longer shown)", () => {
    const NB = loadBuilder(builderContext());
    const cfg = {
      org: "ACME", soc: "soc@acme.test", portal: "https://portal.example", pname: "Security Portal",
      nlNewspaperLeadBullets: ["LEAD ALPHA precaution", "LEAD BRAVO precaution", "LEAD CHARLIE precaution"],
      nlNewspaperMeasures: ["MEASURE ONE", "MEASURE TWO", "MEASURE THREE", "MEASURE FOUR"],
    };
    const html = NB.build("newspaper", cfg, ARTS3, OPTS);
    assert.ok(html.includes('data-template-id="newspaper"'), "template id stamped by the engine");
    for (const m of cfg.nlNewspaperMeasures) assert.ok(html.includes(m), `checklist measure rendered: ${m}`);
    // The "What it means for you" block was removed, so the lead bullets are not rendered.
    for (const b of cfg.nlNewspaperLeadBullets) assert.ok(!html.includes(b), `lead bullet not rendered: ${b}`);
  });

  test("without AI slots, precautions fall back to the articles' watchouts", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.ok(html.includes("Verify bank-detail changes by phone using a known number"), "lead watchout used as a precaution");
    assert.ok(html.includes("Keep offline backups of critical data"), "ransomware watchout reaches the checklist");
  });

  test("layout markers and headlines from the three selected articles are present", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.ok(html.includes('alt="ABInBev"') && html.includes("The Cyber Gazette"), "ABI masthead (logo + publication name)");
    assert.ok(html.includes("Security &amp; Compliance Awareness"), "ABI awareness tagline");
    assert.ok(!html.includes("What it means for you"), "the what-it-means block is removed");
    assert.ok(html.includes("PRECAUTIONARY MEASURES"), "checklist section");
    assert.ok(html.includes("Invoice fraud hits finance teams"), "lead headline (arts[0])");
    assert.ok(html.includes("Crews steal before they encrypt"), "secondary headline (arts[1])");
    assert.ok(html.includes("MFA-fatigue attacks climb"), "secondary headline (arts[2])");
    // Attack-type category labels are removed from articles and the checklist
    // (the type "Ransomware" only ever appeared as an uppercase badge).
    assert.ok(!html.includes("RANSOMWARE"), "no attack-type category label");
    assert.ok(html.includes("Report to SOC Now &rarr; soc-support@ab-inbev.com"), "hardcoded Report-to-SOC CTA before the footer");
    assert.ok(!html.includes("SEE SOMETHING SUSPICIOUS"), "old SEE SOMETHING SUSPICIOUS strip removed");
    assert.ok(!html.includes("EDITOR'S PICK"), "no leftover digest layout");
  });

  test("byline shows the article source linked to its URL instead of the in-house desk", () => {
    const NB = loadBuilder(builderContext());
    const arts = [
      { ...ARTS3[0], source: "AU10TIX", url: "https://au10tix.example/report" },
      { ...ARTS3[1], source: "BleepingComputer", url: "https://bleeping.example/ransom" },
      { ...ARTS3[2], source: "KrebsOnSecurity", url: "https://krebs.example/mfa" },
    ];
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, arts, { ...OPTS, useLinks: true });
    assert.ok(html.includes('href="https://au10tix.example/report"'), "lead byline links to the article");
    assert.ok(html.includes("AU10TIX"), "lead source name shown");
    assert.ok(html.includes('href="https://bleeping.example/ransom"'), "secondary byline links to the article");
    assert.ok(!html.includes("Security Desk"), "no in-house desk byline when sources exist");
  });

  test("byline falls back to the in-house desk line when an article has no source", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.ok(html.includes("By the ACME Security Desk"), "falls back to the desk line without a source");
  });

  test("each byline shows the article's OWN publish date, not one shared issue date", () => {
    const NB = loadBuilder(builderContext());
    const arts = [
      { ...ARTS3[0], pubDate: "2026-06-04" },
      { ...ARTS3[1], pubDate: "2026-05-02" },
      { ...ARTS3[2], pubDate: "2026-04-09" },
    ];
    // issueDate is a DIFFERENT month: it must NOT drive the per-article bylines.
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", issueDate: "2026-07-15" }, arts, OPTS);
    assert.match(html, /JUNE 2026/, "lead byline shows its own June date");
    assert.match(html, /MAY 2026/, "secondary byline shows its own May date");
    assert.match(html, /APRIL 2026/, "third byline shows its own April date");
    assert.ok(!html.includes("JULY 2026"), "the shared issue-date month must not appear when articles carry their own dates");
  });

  test("a byline falls back to the issue date when its article has no pubDate", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", issueDate: "2026-07-15" }, ARTS3, OPTS);
    assert.match(html, /JULY 2026/, "no article pubDate → byline uses the issue date");
  });

  test("the 'What it means for you' blocks are removed from every story", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.equal((html.match(/What it means for you/g) || []).length, 0, "no what-it-means blocks remain");
  });

  test("big lead image uses genhts; small secondary windows use temp_img", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    const imgCount = (html.match(/<img\b/g) || []).length;
    assert.ok(imgCount >= 3, `expected at least 3 image slots, found ${imgCount}`);
    // Lead (big) image is genhts; both secondary (small window) images are temp_img.
    assert.ok(html.includes("genhts.jpeg"), "big lead image → genhts");
    assert.equal((html.match(/temp_img\.jpeg/g) || []).length, 2, "both small windows → temp_img");
  });

  test("an article's own image URL fills its slot instead of the default", () => {
    const NB = loadBuilder(builderContext());
    const arts = [
      { ...ARTS3[0], image: "https://cdn.example/lead.jpg" },
      { ...ARTS3[1], imageUrl: "https://cdn.example/two.png" },
      ARTS3[2],
    ];
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, arts, OPTS);
    assert.ok(html.includes('src="https://cdn.example/lead.jpg"'), "lead uses its own image");
    assert.ok(html.includes('src="https://cdn.example/two.png"'), "secondary uses its own imageUrl");
    assert.ok(html.includes("temp_img.jpeg"), "third article (no own image) falls back to the temp_img default");
  });

  test("QR cell renders at 90x90 when useQR is on", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", portal: "https://p" }, ARTS3, { ...OPTS, useQR: true });
    assert.ok(html.includes('id="nl-qr" data-qr-size="90"'), "QR cell present");
    assert.ok(html.includes("Scan for Portal"), "QR caption present");
  });

  test("footer is the gold portal block, fully driven by config", () => {
    const NB = loadBuilder(builderContext());
    const cfg = {
      org: "ACME", soc: "soc@acme.test",
      pname: "ACME Awareness Hub",
      portal: "intra.acme.test/security",
      portalBlurb: "Modules, policies, and the latest advisories.",
    };
    const html = NB.build("newspaper", cfg, ARTS3, { ...OPTS, useQR: true });
    assert.ok(html.includes("ACME Awareness Hub"), "portal name from c.pname");
    assert.ok(html.includes("Modules, policies, and the latest advisories."), "blurb from c.portalBlurb");
    assert.ok(html.includes(">Visit Portal<"), "Visit Portal button present");
    assert.ok(html.includes('href="https://intra.acme.test/security"'), "Visit Portal link normalized from c.portal");
    // The old foot() org/contact line is gone from the Cyber Gazette footer.
    assert.ok(!html.includes("ACME · Security Awareness ·"), "no legacy org/contact footer line");
  });

  test("footer falls back to a mailto:SOC link when no portal URL is set", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", pname: "Hub" }, ARTS3, OPTS);
    assert.ok(html.includes('href="mailto:soc@acme.test"'), "Visit Portal falls back to mailto:SOC");
  });

  test("gracefully collapses to a single story when only one article is selected", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, [ARTS3[0]], OPTS);
    assert.ok(html.includes("The Cyber Gazette") && html.includes("PRECAUTIONARY MEASURES"), "masthead + checklist still render");
    assert.ok(html.includes("Invoice fraud hits finance teams"), "the single article becomes the lead");
    assert.ok(!html.includes("Crews steal before they encrypt"), "no phantom secondary story");
  });

  test("renders two stories (lead + one secondary) when two articles are selected", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3.slice(0, 2), OPTS);
    assert.ok(html.includes("Invoice fraud hits finance teams"), "lead present");
    assert.ok(html.includes("Crews steal before they encrypt"), "one secondary present");
    assert.ok(!html.includes("MFA-fatigue attacks climb"), "no third story");
  });
});
