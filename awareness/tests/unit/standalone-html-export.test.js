// Guards the "Download All" ZIP export:
//   - toStandaloneHtml must re-inject the variant's stylesheet (variant.css) so the
//     downloaded .html renders styled (the preview splits CSS out of the body into
//     variant.css; without re-injecting it the file looked like unstyled plain text).
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadInternals() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer,
    URL: window.URL, Blob: window.Blob, Date, console, setTimeout, clearTimeout,
    NodeFilter: window.NodeFilter, Node: window.Node,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    fetch: () => Promise.reject(new Error("no network in test")),
    addEventListener() {}, removeEventListener() {},
  });
  ctx.window.App = ctx.window.App || {};
  ctx.App = ctx.window.App;
  for (const f of ["js/utils.js", "js/translation_metrics.js", "js/ui_controller.js"]) {
    vm.runInContext(readFileSync(path.join(rootDir, f), "utf8"), ctx);
  }
  const internals = ctx.App && ctx.App.UI && ctx.App.UI._internals;
  assert.ok(internals && internals.toStandaloneHtml,
    "ui_controller did not expose toStandaloneHtml on _internals");
  return internals;
}

const headOf = (html) => html.slice(0, html.search(/<body[\s>]/i));

test("toStandaloneHtml re-injects variant.css into the document head (so the file is styled, not plain text)", () => {
  const internals = loadInternals();
  const out = internals.toStandaloneHtml(
    { html: '<table><tr><td>Hello world</td></tr></table>', css: '.brand{color:#D4A420}' }, "fr");
  assert.match(out, /^\s*<!DOCTYPE html>/i, "is a complete document");
  assert.match(out, /<html lang="fr"/i, "carries the language");
  assert.ok(out.includes(".brand{color:#D4A420}"), "variant CSS is present in the export");
  assert.ok(headOf(out).includes(".brand{color:#D4A420}"), "variant CSS lives in <head>, before <body>");
  assert.match(out, /<style\b[^>]*data-nl-variant-style/i, "CSS is wrapped in a style tag");
  assert.ok(out.includes("[if !mso]"),
    "screen CSS is wrapped in a downlevel-revealed MSO conditional comment — browsers render it, Outlook (the shared email path) skips it");
  assert.ok(out.includes("Hello world"), "body content is preserved");
});

test("toStandaloneHtml re-injects CSS into a full-document template's existing <head>", () => {
  const internals = loadInternals();
  const fullDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body><p>Hi there</p></body></html>';
  const out = internals.toStandaloneHtml({ html: fullDoc, css: ".y{color:#123456}" }, "en");
  assert.ok(out.includes(".y{color:#123456}"), "CSS present for a full-document template");
  assert.ok(headOf(out).includes(".y{color:#123456}"), "CSS injected into the existing <head>");
  assert.equal((out.match(/<html[\s>]/gi) || []).length, 1, "no nested/duplicate <html>");
  assert.ok(out.includes("Hi there"), "body preserved");
});

test("toStandaloneHtml with no variant CSS is still a valid document and adds no empty style tag", () => {
  const internals = loadInternals();
  const out = internals.toStandaloneHtml({ html: "<p>Plain body</p>", css: "" }, "de");
  assert.match(out, /^\s*<!DOCTYPE html>/i);
  assert.ok(!out.includes("data-nl-variant-style"), "no empty <style> when there is no CSS");
  assert.ok(out.includes("Plain body"));
});

test("toStandaloneHtml scrubs editor chrome baked into a pre-existing project (scripts, contenteditable, data-nl-*, chrome CSS)", () => {
  const internals = loadInternals();
  // Mirrors how an OLD draft/project snapshot was saved before the editor export
  // path was hardened: the injected editor + QR <script> tags, stale
  // contenteditable / data-nl-* attributes, and the edit-chrome outline CSS.
  const polluted = {
    html:
      '<table><tr><td><p contenteditable="true" data-nl-hover="1">Lead copy</p></td>' +
      '<td data-nl-sel="1" draggable="true">More text</td></tr></table>' +
      '<div id="nl-qr"></div>' +
      '<script>(function(){document.addEventListener("mousemove",function(){});})();</script>' +
      '<script>/* qr runtime */</script>',
    css:
      'p{color:#222}' +
      '[data-nl-sel="1"]{outline:2.5px solid #D4A420!important}' +
      '[data-nl-hover="1"]{outline:1px solid rgba(255,255,255,.32)!important}' +
      '[contenteditable="true"]{outline:2px solid rgba(212,164,32,.9)!important;caret-color:#D4A420}' +
      '.nl-drag-ghost{opacity:.35!important}' +
      'td{padding:8px}',
  };
  const out = internals.toStandaloneHtml(polluted, "en");
  // No edit affordance survives → the downloaded file is inert on hover.
  assert.ok(!/<script/i.test(out), "no <script> survives the export");
  assert.ok(!/contenteditable/i.test(out), "no contenteditable attribute survives");
  assert.ok(!/data-nl-(sel|multisel|hover|drop-inside|regen-pending)/i.test(out), "no editor data-nl-* attribute survives");
  assert.ok(!/\sdraggable\s*=/i.test(out), "no draggable attribute survives");
  assert.ok(!/\[data-nl-hover|\[data-nl-sel|\[contenteditable|nl-drag-ghost/i.test(out), "no edit-chrome CSS rule survives");
  // Real content + real styling are preserved.
  assert.ok(out.includes("Lead copy") && out.includes("More text"), "newsletter copy is preserved");
  assert.ok(out.includes("p{color:#222}") && out.includes("td{padding:8px}"), "legitimate CSS is preserved");
});

test("toStandaloneHtml leaves clean content untouched (no false stripping)", () => {
  const internals = loadInternals();
  const out = internals.toStandaloneHtml(
    { html: '<table><tr><td>Plain editorial copy</td></tr></table>', css: '.brand{color:#D4A420}' }, "en");
  assert.ok(out.includes("Plain editorial copy"), "content preserved");
  assert.ok(out.includes(".brand{color:#D4A420}"), "CSS preserved");
});

// The emailed document must scale-to-fit on a phone WITHOUT reflow: a fluid
// "width:100%;max-width:Npx" content table that wraps fixed-width inner artwork
// overflows in mobile mail, so we anchor it back to its fixed Npx design width.
// The full-bleed background band (width="100%" attribute, no max-width) stays fluid.
test("toStandaloneHtml anchors hybrid width:100%+max-width to a fixed width (phone scale-to-fit, no reflow)", () => {
  const internals = loadInternals();
  const out = internals.toStandaloneHtml(
    { html:
        '<table width="100%"><tr><td align="center">' +
        '<table width="640" style="width:100%;max-width:640px;background:#fff"><tr><td>Body copy</td></tr></table>' +
        '</td></tr></table>',
      css: "" }, "en");
  assert.match(out, /width:640px;\s*max-width:640px/i,
    "the content table's fluid width is anchored to its fixed 640px design width");
  assert.ok(/width="100%"/i.test(out),
    "the full-bleed background band stays width=100% (so the page background still fills the screen)");
  assert.ok(out.includes("Body copy"), "content preserved");
});

test("toStandaloneHtml stamps text-size-adjust on a full-doc body (stops iOS Mail inflating text → overflow)", () => {
  const internals = loadInternals();
  const out = internals.toStandaloneHtml(
    { html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Hi there</p></body></html>', css: "" }, "en");
  assert.match(out, /text-size-adjust:\s*100%/i, "body carries -webkit-text-size-adjust:100%");
  assert.ok(out.includes("Hi there"), "body preserved");
});

// The bundled index.html viewer and "HOW TO OPEN" guide were removed from the ZIP
// export, so their builders (buildLanguageIndexHtml / buildOpenHelpText) no longer
// exist and are no longer tested.
