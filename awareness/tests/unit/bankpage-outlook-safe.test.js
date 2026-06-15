// Outlook (Word engine) regression guard for the bank-page templates.
// The delivered email — not the compose-side draft — is rendered by Word, which
// drops several CSS features the on-screen preview honors. Each assertion here
// pins a construct that broke in classic Outlook on send:
//   - thin gold separators inflating to a full line box (need mso-line-height-rule:exactly)
//   - bullet dots vanishing (empty <div> sized via width/height/border-radius)
//   - the "Report to SOC" button collapsing (padding on an inner <div> Word ignores)
//   - serif text where Arial was intended (font-family:Georgia survives enforceEmailFont)

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function buildBankPages() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = window.App || {};
  const sandbox = {
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer,
    console, URL, Blob, App: window.App, setTimeout, clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of ["js/utils.js", "js/newsletter_builder.js", "js/newsletter/bank_page.js", "js/newsletter/core_templates.js"]) {
    vm.runInContext(readFileSync(path.join(rootDir, f), "utf8"), ctx);
  }
  const NB = ctx.App.NewsletterBuilder;
  const cfg = { org: "ACME", soc: "soc-support@ab-inbev.com", freq: "Weekly", portal: "https://p.example", pname: "Portal" };
  const arts = [
    { type: "Phishing", title: "Test article one", summary: "x.", source: "Src", url: "https://x.com", pubDate: "2026-06-04", threatLevel: 3 },
    { type: "Malware", title: "Test article two", summary: "y.", source: "Src2", url: "https://y.com", pubDate: "2026-06-03", threatLevel: 4 },
  ];
  const opts = { useLinks: false, usePoster: false, useQR: false, useIllus: false };
  return {
    phishingbrief: NB.build("phishingbrief", cfg, arts, opts),
    dynamic: NB.build("bankpage1_dynamic", cfg, arts, opts),
    static: NB.build("bankpage1_static", cfg, arts, opts),
  };
}

const pages = buildBankPages();

for (const [name, html] of Object.entries(pages)) {
  test(`${name}: no gold separator sits inside a margin-bearing table (Word fills the margin gold)`, () => {
    // Classic Outlook/Word paints a <table>'s margin area with the cell's
    // background, so a margin on a table wrapping a gold cell becomes a thick
    // gold block. Spacing must live on a <td> padding instead.
    const bad = new RegExp(
      '<table[^>]*style="[^"]*margin:[^"]*"[^>]*>\\s*<tr>\\s*<td[^>]*background:#C09010',
      "i",
    );
    assert.ok(!bad.test(html), "a gold separator cell is wrapped by a margin-bearing table");
  });

  test(`${name}: thin gold separators pin an exact line height for Word`, () => {
    // Any gold cell that relies on a tiny height must also carry the mso rule,
    // otherwise classic Outlook inflates it to a full default line box.
    const thinGoldCells = html.match(/<td[^>]*background:#C09010[^>]*line-height:\dpx[^>]*>/gi) || [];
    assert.ok(thinGoldCells.length > 0, "expected thin gold separator cells to exist");
    for (const cell of thinGoldCells) {
      assert.match(cell, /mso-line-height-rule:\s*exactly/i, `separator missing exact line-height rule: ${cell}`);
    }
  });

  test(`${name}: bullet markers are real glyphs, not empty sized divs`, () => {
    assert.ok(!/border-radius:50%/.test(html), "empty border-radius div dots vanish in Word");
    assert.ok(/&bull;|•/.test(html), "expected a real bullet glyph");
  });

  test(`${name}: Report-to-SOC button pads the <td>, not an inner div`, () => {
    assert.ok(html.includes("Report to SOC"), "SOC CTA present");
    // Word ignores padding on a <div>; it must live on the gold <td> instead.
    assert.ok(!/<div[^>]*display:block;\s*padding:\d/.test(html),
      "button padding still on an inner div");
    assert.match(html, /<td[^>]*background:#D4A420[^>]*padding:\d/i,
      "gold button <td> should carry the padding");
  });

  test(`${name}: SOC address is an explicit mailto link, not auto-linked text`, () => {
    assert.match(html, /<a[^>]+href="mailto:soc-support@ab-inbev\.com"/i,
      "SOC email should be a styled mailto anchor so Word does not auto-link it");
  });

  test(`${name}: no serif font survives where Arial is intended`, () => {
    assert.ok(!/font-family:\s*Georgia/i.test(html), "Georgia serif should be replaced with Arial");
  });

  test(`${name}: bullet markers stay editor-detectable (single bullet-glyph div)`, () => {
    // The editor's isGoldDotCell (js/editor/iframe_script.js) resolves the whole
    // bullet ROW for Remove / Remove-in-all-languages by detecting the marker cell
    // as a <div> holding a single bullet glyph. If the marker changes shape, Remove
    // targets the wrong node (or the whole body). Keep it a single-glyph div.
    const markers = html.match(/<div[^>]*>&bull;<\/div>/gi) || [];
    assert.ok(markers.length >= 8, `expected bullet-glyph div markers, found ${markers.length}`);
  });

  test(`${name}: bullet cells drop the dot-era padding-top so glyphs align with text`, () => {
    // The 6px padding-top was tuned for the old 6px dot box; a text glyph must
    // sit on the text line instead, or bullets render below their text in Word.
    assert.ok(!/vertical-align:top;padding-top:6px;"><div[^>]*>&bull;/.test(html),
      "bullet marker cell still carries the stale dot-era padding-top");
  });
}

test("dynamic: two article cards fit the body content width (no Word overflow/wrap)", () => {
  const html = pages.dynamic;
  // Body content width = 640 outer - 2*36 padding = 568px. Two fixed-width
  // cards plus the gap column must not exceed it, or Word wraps card 2.
  assert.ok(!/width="282"/.test(html), "card width 282 + 8 gap + 282 overflows 568px");
  const cardWidths = (html.match(/<td width="(\d+)" valign="top" style="width:\1px/g) || [])
    .map((m) => parseInt(m.match(/width="(\d+)"/)[1], 10));
  assert.equal(cardWidths.length, 2, "expected exactly two fixed-width article cards");
  const gap = 8;
  assert.ok(cardWidths[0] + gap + cardWidths[1] <= 568,
    `cards (${cardWidths.join("+")}) + ${gap} gap exceed 568px body width`);
});
