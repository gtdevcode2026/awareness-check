// Regression guard for "Remove / Remove in all languages deletes the entire body".
// removeNewsletterNodeByMirrorPath must never collapse onto the whole-newsletter
// wrapper (data-nl-import-body / data-template-id) — e.g. when the maxPathSkip flex
// drops leading indices and a drifted path would otherwise resolve to the root.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadUtils() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = window.App || {};
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, console, URL, Blob, App: window.App,
  });
  vm.runInContext(readFileSync(path.join(rootDir, "js/utils.js"), "utf8"), ctx);
  return ctx.App.Utils;
}

test("refuses to delete the data-nl-import-body wrapper", () => {
  const U = loadUtils();
  const html = '<div data-nl-import-body="1"><p>a</p><p>b</p></div>';
  const r = U.removeNewsletterNodeByMirrorPath(html, [0], null, 5);
  assert.equal(r.removed, false, "wrapper must not be removable");
  assert.ok(r.html.includes("data-nl-import-body"), "wrapper still present");
  assert.ok(r.html.includes(">a<") && r.html.includes(">b<"), "body content untouched");
});

test("refuses to delete a data-template-id root", () => {
  const U = loadUtils();
  const html = '<div data-template-id="poster"><p>x</p></div>';
  const r = U.removeNewsletterNodeByMirrorPath(html, [0], null, 5);
  assert.equal(r.removed, false);
  assert.ok(r.html.includes("data-template-id"));
});

test("still removes a real child node addressed inside the wrapper", () => {
  const U = loadUtils();
  const html = '<div data-nl-import-body="1"><p>a</p><p id="b">b</p></div>';
  const r = U.removeNewsletterNodeByMirrorPath(html, [0, 1], null, 5);
  assert.equal(r.removed, true, "a real child is still deletable");
  assert.ok(!r.html.includes('id="b"'), "target removed");
  assert.ok(r.html.includes(">a<"), "sibling content remains (moves up)");
});

test("removes one bullet row and leaves its siblings (content moves up)", () => {
  const U = loadUtils();
  const html =
    '<div data-nl-import-body="1"><table><tr><td>' +
    '<table><tr><td><div>•</div></td><td>one</td></tr></table></td></tr>' +
    '<tr><td><table><tr><td><div>•</div></td><td>two</td></tr></table></td></tr></table></div>';
  // path to the FIRST bullet's group <tr>: body[0]=wrapper, [0]=table, [0]=tbody
  // (auto-inserted by the parser), [0]=first <tr>.
  const r = U.removeNewsletterNodeByMirrorPath(html, [0, 0, 0, 0], null, 5);
  assert.equal(r.removed, true);
  assert.ok(!r.html.includes(">one<"), "removed bullet gone");
  assert.ok(r.html.includes(">two<"), "sibling bullet remains");
  assert.ok(r.html.includes("data-nl-import-body"), "body wrapper intact");
});
