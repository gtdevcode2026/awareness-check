// Unit tests for App.Utils.buildEmlMime — assembles a send-ready .eml
// (multipart/related, X-Unsent:1) from cid-rewritten HTML + inline attachments.
// Opening the .eml in classic Outlook gives an editable draft with images inline.

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
  const context = vm.createContext({
    window,
    document: window.document,
    navigator: window.navigator,
    DOMParser: window.DOMParser,
    XMLSerializer: window.XMLSerializer,
    console,
    URL,
    Blob,
    App: window.App,
  });
  vm.runInContext(readFileSync(path.join(rootDir, "js/utils.js"), "utf8"), context);
  return context.App.Utils;
}

// Pull the base64 body of the text/html MIME part and decode it back to HTML.
function decodeHtmlPart(eml) {
  const m = eml.match(/Content-Type: text\/html[^]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|\r\n*$)/);
  if (!m) return null;
  return Buffer.from(m[1].replace(/[\r\n]/g, ""), "base64").toString("utf8");
}

test("buildEmlMime is exported on App.Utils", () => {
  const { buildEmlMime } = loadUtils();
  assert.equal(typeof buildEmlMime, "function");
});

test("with attachments: multipart/related, X-Unsent draft, inline CID image", () => {
  const { buildEmlMime } = loadUtils();
  const html = '<html><body><img src="cid:aw-inline-1"></body></html>';
  const atts = [
    { contentId: "aw-inline-1", contentType: "image/png", base64: "AAAA", filename: "inline-1.png" },
  ];
  const eml = buildEmlMime(html, atts, { subject: "Weekly Bulletin" });

  assert.match(eml, /^MIME-Version: 1\.0\r\n/);
  assert.ok(eml.includes("X-Unsent: 1"), "X-Unsent makes Outlook open an editable draft");
  assert.ok(eml.includes("Subject: Weekly Bulletin"));
  assert.ok(eml.includes("multipart/related"));
  assert.ok(eml.includes("Content-ID: <aw-inline-1>"));
  assert.ok(eml.includes("Content-Disposition: inline; filename=\"inline-1.png\""));
  assert.ok(eml.includes("Content-Type: image/png"));
  assert.equal(decodeHtmlPart(eml), html, "the HTML part round-trips");
});

test("without attachments: single text/html part, no multipart", () => {
  const { buildEmlMime } = loadUtils();
  const html = "<p>hi &amp; bye</p>";
  const eml = buildEmlMime(html, [], { subject: "X" });
  assert.ok(eml.includes("X-Unsent: 1"));
  assert.ok(!eml.includes("multipart/related"));
  assert.ok(eml.includes("Content-Type: text/html"));
  assert.equal(decodeHtmlPart(eml), html);
});

test("non-ASCII subject is RFC 2047 encoded", () => {
  const { buildEmlMime } = loadUtils();
  const eml = buildEmlMime("<p>x</p>", [], { subject: "Sécurité" });
  assert.match(eml, /Subject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=/);
});

test("skips attachments missing contentId/base64", () => {
  const { buildEmlMime } = loadUtils();
  const html = '<img src="cid:ok">';
  const atts = [
    { contentId: "ok", contentType: "image/png", base64: "AAAA", filename: "a.png" },
    { contentId: "", base64: "BBBB" },
    { contentId: "nob64", contentType: "image/png" },
  ];
  const eml = buildEmlMime(html, atts, {});
  assert.ok(eml.includes("Content-ID: <ok>"));
  assert.ok(!eml.includes("Content-ID: <nob64>"));
});

// ── To/From headers (used by the advisory → .eml export to prefill the draft) ──

test("buildEmlMime emits From then To after Subject when provided", () => {
  const { buildEmlMime } = loadUtils();
  const eml = buildEmlMime("<p>x</p>", [], { subject: "S", to: "a@b.com", from: "Team <t@b.com>" });
  assert.ok(eml.includes("\r\nFrom: Team <t@b.com>\r\n"));
  assert.ok(eml.includes("\r\nTo: a@b.com\r\n"));
  // order must be Subject -> From -> To -> Content-Type
  assert.match(eml, /Subject: S\r\nFrom: Team <t@b\.com>\r\nTo: a@b\.com\r\nContent-Type:/);
});

test("buildEmlMime omits To/From when not provided (newsletter path unchanged)", () => {
  const { buildEmlMime } = loadUtils();
  const eml = buildEmlMime("<p>x</p>", [], { subject: "S" });
  assert.ok(!/\r\nTo:/.test(eml), "no To header");
  assert.ok(!/\r\nFrom:/.test(eml), "no From header");
});

test("buildEmlMime encodes a non-ASCII From display name but keeps the address literal", () => {
  const { buildEmlMime } = loadUtils();
  const eml = buildEmlMime("<p>x</p>", [], { subject: "S", from: "Sécurité <s@b.com>" });
  assert.match(eml, /From: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?= <s@b\.com>/);
  // a bare address (no display name) passes straight through
  const eml2 = buildEmlMime("<p>x</p>", [], { subject: "S", from: "s@b.com" });
  assert.ok(eml2.includes("\r\nFrom: s@b.com\r\n"));
});

// ── combineHtmlBodies (stacks selected advisories into one combined .eml body) ──

test("combineHtmlBodies stacks multiple advisory bodies into one document", () => {
  const { combineHtmlBodies } = loadUtils();
  const a = '<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body bgcolor="#000"><table><tr><td>ALPHA</td></tr></table></body></html>';
  const b = '<!DOCTYPE html><html><head></head><body bgcolor="#111"><table><tr><td>BETA</td></tr></table></body></html>';
  const out = combineHtmlBodies([a, b], {});
  assert.match(out, /^<!DOCTYPE html>/i);
  assert.equal((out.match(/<body[\s>]/gi) || []).length, 1, "exactly one <body>");
  assert.equal((out.match(/<\/html>/gi) || []).length, 1, "exactly one </html>");
  assert.ok(out.includes("ALPHA") && out.includes("BETA"), "both advisory bodies present");
  assert.ok(out.includes(".x{color:red}"), "head <style> from the first doc is preserved");
  assert.ok(/bgcolor="#000"/.test(out), "first doc's <body> attributes carried onto the combined body");
  assert.equal((out.match(/advisory-break/g) || []).length, 1, "one separator between two advisories");
});

test("combineHtmlBodies with a single doc preserves its body and adds no separator", () => {
  const { combineHtmlBodies } = loadUtils();
  const out = combineHtmlBodies(['<!DOCTYPE html><html><body><p>SOLO</p></body></html>'], {});
  assert.ok(out.includes("SOLO"));
  assert.equal((out.match(/<body[\s>]/gi) || []).length, 1);
  assert.equal((out.match(/advisory-break/g) || []).length, 0);
});

// ── emlFileName (per-advisory filename, sanitized) ──

test("emlFileName sanitizes input and falls back when empty", () => {
  const { emlFileName } = loadUtils();
  assert.equal(emlFileName("CVE-2026-0001", 1), "advisory-CVE-2026-0001.eml");
  const messy = emlFileName("[High] a/b c", 1);
  assert.ok(!/[/[\]\s]/.test(messy), "no slashes, brackets, or spaces: " + messy);
  assert.match(messy, /^advisory-.*\.eml$/);
  assert.equal(emlFileName("", 3), "advisory-advisory-3.eml");
  const long = emlFileName("x".repeat(200), 1);
  const stem = long.replace(/^advisory-/, "").replace(/\.eml$/, "");
  assert.ok(stem.length <= 80, "stem capped at 80 chars, got " + stem.length);
});
