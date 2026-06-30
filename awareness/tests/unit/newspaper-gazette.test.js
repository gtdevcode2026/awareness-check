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
    assert.ok(html.includes("Report to SOC &rarr; soc-support@ab-inbev.com"), "hardcoded Report-to-SOC CTA before the footer");
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

  test("lead incident uses genhts; later incidents use feelnoways", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    const imgCount = (html.match(/<img\b/g) || []).length;
    assert.ok(imgCount >= 3, `expected at least 3 image slots, found ${imgCount}`);
    // Incident 1 (lead) → genhts; incidents 2 & 3 → feelnoways.
    assert.ok(html.includes("genhts.jpeg"), "lead incident → genhts");
    assert.equal((html.match(/feelnoways\.jpeg/g) || []).length, 2, "later incidents → feelnoways");
    assert.ok(!html.includes("temp_img.jpeg"), "old temp_img default no longer used");
  });

  test("incident hero images render without the black framing border", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    // The 232px incident hero images must not carry a near-black 1px border box.
    assert.ok(!/border:1px solid #0A0A0A/i.test(html), "no black framing border around incident images");
  });

  test('the Report-to-SOC button drops "Now" and the footer is compact', () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", portal: "p.example", pname: "ACME Portal" }, ARTS3, OPTS);
    assert.ok(html.includes("Report to SOC &rarr; soc-support@ab-inbev.com"), 'SOC button reads "Report to SOC" (no "Now")');
    assert.ok(!/Report to SOC Now/.test(html), 'the word "Now" is gone from the SOC button');
    // Footer shrunk: cell padding + portal-name font reduced.
    assert.ok(html.includes("padding:16px 30px 14px"), "footer cell padding reduced");
    assert.ok(/font-size:16px;color:#D4A420;font-weight:700;/.test(html), "portal name font reduced to 16px");
    assert.ok(!/padding:28px 36px 22px/.test(html), "old large footer padding is gone");
  });

  test("compactGazetteFooter heals a previously generated gazette, gated to the gazette only", () => {
    const ctx = vm.createContext({ window: {}, URL, Date, console, navigator: {} });
    ctx.window = ctx; ctx.App = ctx.window.App = {};
    loadScript(ctx, "js/utils.js");
    const U = ctx.App.Utils;
    const frozen = '<table data-template-id="newspaper"><tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A;padding:28px 36px 22px;">'
      + '<p style="font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#D4A420;font-weight:700;">Portal</p>'
      + '<a href="mailto:x">Report to SOC Now &rarr; x</a>'
      + '<td width="200" valign="top" align="center" style="padding-left:24px;"><table style="border:4px solid #C09010;background-color:#FFFFFF;"><tr><td style="padding:8px;" id="nl-qr" data-qr-size="90">'
      + '<img src="data:image/png;base64,QQ==" alt="QR code" width="90" height="90" style="display:block;width:90px;height:90px;"></td></tr></table></td>'
      + '</td></tr></table>';
    const out = U.compactGazetteFooter(frozen);
    assert.ok(!/Report to SOC Now/.test(out), '"Now" removed from a saved gazette');
    assert.ok(out.includes("padding:16px 30px 14px"), "footer padding shrunk in a saved gazette");
    assert.ok(out.includes("font-size:16px;color:#D4A420;font-weight:700;"), "portal name shrunk in a saved gazette");
    // QR shrunk to the compact box (was the big 90px box in saved gazettes).
    assert.ok(out.includes('data-qr-size="70"') && !/data-qr-size="90"/.test(out), "QR pixel size shrunk 90 -> 70");
    assert.ok(out.includes('width="150" valign="top" align="center"'), "QR cell width shrunk 200 -> 150");
    assert.ok(out.includes("border:3px solid #C09010"), "QR border thinned 4px -> 3px");
    assert.ok(out.includes('padding:6px;" id="nl-qr"'), "QR inner padding shrunk 8px -> 6px");
    // The baked-in 90px QR image is stripped so the EXPORT regenerates it at 70px.
    assert.ok(!/width="90" height="90"/.test(out), "frozen 90px QR <img> removed");
    assert.ok(/id="nl-qr" data-qr-size="70"><\/td>/.test(out), "#nl-qr emptied so the export rebuilds the QR at the compact size");
    // Other templates are untouched.
    const nonGz = frozen.replace('data-template-id="newspaper"', 'data-template-id="poster"');
    assert.equal(U.compactGazetteFooter(nonGz), nonGz, "non-gazette HTML is left unchanged");
  });

  test("the gap above the Report-to-SOC button is tightened", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.ok(html.includes("padding:6px 30px 24px;background-color:#FFFFFF"), "CTA cell top padding reduced to 6px");
    assert.ok(html.includes("padding:20px 28px 8px;background-color:#FCFBF7"), "precautionary-measures cell bottom padding reduced to 8px");
    assert.ok(!/padding:22px 30px 24px;background-color:#FFFFFF/.test(html), "old large CTA top padding is gone");
  });

  test("tightenGazetteCtaGap tightens the button gap in a saved gazette, gated to the gazette only", () => {
    const ctx = vm.createContext({ window: {}, URL, Date, console, navigator: {} });
    ctx.window = ctx; ctx.App = ctx.window.App = {};
    loadScript(ctx, "js/utils.js");
    const U = ctx.App.Utils;
    const frozen = '<table data-template-id="newspaper"><tr>'
      + '<td bgcolor="#FCFBF7" style="padding:20px 28px;background-color:#FCFBF7;border-top:1px solid #E4E2DC;">measures</td></tr><tr>'
      + '<td align="center" bgcolor="#FFFFFF" style="padding:22px 30px 24px;background-color:#FFFFFF;">Report to SOC</td></tr></table>';
    const out = U.tightenGazetteCtaGap(frozen);
    assert.ok(out.includes("padding:6px 30px 24px;background-color:#FFFFFF"), "CTA cell top padding shrunk in a saved gazette");
    assert.ok(out.includes("padding:20px 28px 8px;background-color:#FCFBF7"), "measures cell bottom padding shrunk in a saved gazette");
    assert.ok(!/padding:22px 30px 24px;background-color:#FFFFFF/.test(out), "old CTA padding gone in a saved gazette");
    // Other templates are untouched.
    const nonGz = frozen.replace('data-template-id="newspaper"', 'data-template-id="poster"');
    assert.equal(U.tightenGazetteCtaGap(nonGz), nonGz, "non-gazette HTML is left unchanged");
  });

  test("stackGazetteMastheadSubline wraps 'Monthly Bulletin' on its own line with spacing above", () => {
    const ctx = vm.createContext({ window: {}, URL, Date, console, navigator: {} });
    ctx.window = ctx; ctx.App = ctx.window.App = {};
    loadScript(ctx, "js/utils.js");
    const U = ctx.App.Utils;
    const frozen = '<table data-template-id="newspaper"><tr><td align="right">'
      + '<div style="color:#D4A420;">Security &amp; Compliance Awareness Monthly Bulletin</div></td></tr></table>';
    const out = U.stackGazetteMastheadSubline(frozen);
    assert.ok(out.includes('Security &amp; Compliance Awareness<div data-nl-subline="1" style="margin-top:6px;">Monthly Bulletin</div>'),
      "tagline split onto its own line with a margin-top gap above");
    // Idempotent: a second pass changes nothing (the data-nl-subline marker short-circuits).
    assert.equal(U.stackGazetteMastheadSubline(out), out, "second pass is a no-op");
    // Gated to the gazette.
    const nonGz = frozen.replace('data-template-id="newspaper"', 'data-template-id="poster"');
    assert.equal(U.stackGazetteMastheadSubline(nonGz), nonGz, "non-gazette HTML is left unchanged");
  });

  test("stackGazetteMastheadSubline upgrades an earlier bare-<br> heal to the spaced line without doubling the break", () => {
    const ctx = vm.createContext({ window: {}, URL, Date, console, navigator: {} });
    ctx.window = ctx; ctx.App = ctx.window.App = {};
    loadScript(ctx, "js/utils.js");
    const U = ctx.App.Utils;
    const bareBr = '<table data-template-id="newspaper"><div style="color:#D4A420;">Security &amp; Compliance Awareness<br>Monthly Bulletin</div></table>';
    const out = U.stackGazetteMastheadSubline(bareBr);
    assert.ok(out.includes('Security &amp; Compliance Awareness<div data-nl-subline="1" style="margin-top:6px;">Monthly Bulletin</div>'),
      "bare <br> upgraded to the spaced sub-line");
    assert.ok(!/<br\s*\/?>\s*<div data-nl-subline/.test(out), "the old <br> is consumed, not left dangling before the wrap");
  });

  test("stackGazetteMastheadSubline wraps 'Monthly Bulletin' whatever the markup (inline spans), gated by gazette content", () => {
    const ctx = vm.createContext({ window: {}, URL, Date, console, navigator: {} });
    ctx.window = ctx; ctx.App = ctx.window.App = {};
    loadScript(ctx, "js/utils.js");
    const U = ctx.App.Utils;
    // Inline-span tagline that wraps as one run — and NO data-template-id stamp, so the
    // heal must fall back to the "Incidents from Around The World" gazette marker.
    const frozen = '<div>Incidents from Around The World</div><table><tr><td align="right">'
      + '<span style="color:#D4A420;">Security &amp; Compliance Awareness</span> '
      + '<span style="color:#888888;">Monthly Bulletin</span></td></tr></table>';
    const out = U.stackGazetteMastheadSubline(frozen);
    assert.ok(out.includes('<div data-nl-subline="1" style="margin-top:6px;">Monthly Bulletin</div>'),
      "Monthly Bulletin wrapped on its own spaced line via the gazette-content gate");
    // Idempotent.
    assert.equal(U.stackGazetteMastheadSubline(out), out, "second pass is a no-op");
    // A non-gazette bulletin (gen_* with its own "Monthly Bulletin" block) is untouched.
    const genBulletin = '<div>Phishing Maestro</div><div>Monthly Bulletin</div>';
    assert.equal(U.stackGazetteMastheadSubline(genBulletin), genBulletin, "non-gazette 'Monthly Bulletin' left unchanged");
  });

  test("the masthead, the section nameplate, and numbered incident kickers all render", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test" }, ARTS3, OPTS);
    assert.ok(html.includes("The Cyber Gazette"), "ABI masthead kept");
    assert.ok(html.includes("Incidents from Around The World"), "section nameplate added above the stories");
    assert.ok(html.includes("Incident 01") && html.includes("Incident 02") && html.includes("Incident 03"),
      "each story carries its numbered INCIDENT 0N kicker");
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
    assert.ok(html.includes("feelnoways.jpeg"), "third article (no own image) falls back to the feelnoways default");
  });

  test("QR cell renders at the compact 70px size when useQR is on", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("newspaper", { org: "ACME", soc: "soc@acme.test", portal: "https://p" }, ARTS3, { ...OPTS, useQR: true });
    assert.ok(html.includes('id="nl-qr" data-qr-size="70"'), "QR cell present at the reduced size");
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
