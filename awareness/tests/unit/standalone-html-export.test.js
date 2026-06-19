// Guards the "Download All" ZIP export:
//   - toStandaloneHtml must re-inject the variant's stylesheet (variant.css) so the
//     downloaded .html renders styled (the preview splits CSS out of the body into
//     variant.css; without re-injecting it the file looked like unstyled plain text).
//   - buildLanguageIndexHtml produces a viewer landing page linking every language file.
//   - buildOpenHelpText is the plain-text guide bundled in the ZIP that tells the user how to
//     clear Windows' Mark-of-the-Web block ("Your Internet security settings prevented one or
//     more files from being opened") on the downloaded archive.
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
  assert.ok(internals && internals.toStandaloneHtml && internals.buildLanguageIndexHtml
    && internals.buildOpenHelpText,
    "ui_controller did not expose toStandaloneHtml/buildLanguageIndexHtml/buildOpenHelpText on _internals");
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

test("buildLanguageIndexHtml produces a viewer linking every language file", () => {
  const internals = loadInternals();
  const entries = [
    { id: "en", label: "English", file: "newsletter-en.html" },
    { id: "fr", label: "French", file: "newsletter-fr.html" },
    { id: "ko", label: "Korean", file: "newsletter-ko.html" },
  ];
  const idx = internals.buildLanguageIndexHtml(entries, "Weekly Security Brief");
  assert.match(idx, /^\s*<!DOCTYPE html>/i, "index is a complete document");
  for (const e of entries) {
    assert.ok(idx.includes(`href="./${e.file}"`), `links ${e.file}`);
    assert.ok(idx.includes(`>${e.label}<`), `shows label ${e.label}`);
  }
  assert.ok(idx.includes("Weekly Security Brief"), "shows the newsletter title");
  assert.ok(idx.includes("3 languages"), "shows the language count");
});

test("buildLanguageIndexHtml escapes a malicious title/label (no HTML injection)", () => {
  const internals = loadInternals();
  const idx = internals.buildLanguageIndexHtml(
    [{ id: "en", label: "<img src=x onerror=alert(1)>", file: "newsletter-en.html" }],
    "<script>bad()</script>");
  assert.ok(!idx.includes("<script>bad()"), "title is escaped");
  assert.ok(!idx.includes("<img src=x onerror"), "label is escaped");
  assert.ok(idx.includes("&lt;script&gt;") || idx.includes("&lt;img"), "dangerous markup is entity-encoded");
});

test("buildOpenHelpText gives the Mark-of-the-Web unblock steps, with CRLF for Notepad", () => {
  const internals = loadInternals();
  const txt = internals.buildOpenHelpText("Weekly Security Brief");
  assert.ok(txt.includes("Weekly Security Brief"), "names the newsletter");
  assert.match(txt, /Internet security settings prevented one or more files/i,
    "quotes the exact Windows message so the user recognizes it");
  assert.match(txt, /right-click[\s\S]*Properties/i, "tells them to right-click -> Properties");
  assert.match(txt, /\bUnblock\b/, 'tells them to tick "Unblock"');
  assert.match(txt, /7-Zip|WinRAR/i, "offers the extract-with-a-real-tool alternative");
  assert.ok(txt.includes("\r\n"), "uses CRLF line endings so Windows Notepad renders the guide");
});

test("buildOpenHelpText falls back to a sensible title when none is given", () => {
  const internals = loadInternals();
  const txt = internals.buildOpenHelpText("");
  assert.ok(txt.includes("Security Awareness Newsletter"), "has a default name");
  assert.match(txt, /HOW TO OPEN/i, "still carries the heading");
});
