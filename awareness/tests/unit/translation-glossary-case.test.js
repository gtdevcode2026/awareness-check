// Guards the glossary lock's casing behavior. It keeps security terms spelled consistently but
// must PRESERVE the leading-letter case the translator chose, so it never overrides correct
// target-language orthography. German and Dutch capitalise these loanword nouns ("Phishing"); the
// old unconditional lowercasing was forcing them back to lowercase (a reported CISO QA defect).
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadTR() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = { UI: { _state: { translationPendingLang: null, translationCache: {} }, _internals: {} } };
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, console, URL, Blob,
    App: window.App, setTimeout, clearTimeout, NodeFilter: window.NodeFilter, Node: window.Node,
  });
  vm.runInContext(readFileSync(path.join(rootDir, "js/utils.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(path.join(rootDir, "js/translation_metrics.js"), "utf8"), ctx);
  ctx.App.UI._internals.getLanguageLabel = (id) => id;
  ctx.App.UI._internals.fetchWithTranslationRetry = async () => { throw new Error("no fetch"); };
  ctx.App.UI._internals.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "de" }];
  ctx.App.UI._internals.recordTranslationFailure = () => {};
  vm.runInContext(readFileSync(path.join(rootDir, "js/ui/translation.js"), "utf8"), ctx);
  return ctx.App.UITranslation;
}

test("preserves the model's capitalization — German 'Phishing' is NOT forced to lowercase", () => {
  const TR = loadTR();
  assert.equal(TR.applyGlossaryLock("Schützen Sie sich vor Phishing-Angriffen."),
    "Schützen Sie sich vor Phishing-Angriffen.", "German capital P preserved");
  assert.equal(TR.applyGlossaryLock("Vorsicht vor Smishing und Vishing."),
    "Vorsicht vor Smishing und Vishing.", "other capitalised loanword nouns preserved");
});

test("keeps the English lowercase form when the model wrote it lowercase", () => {
  const TR = loadTR();
  assert.equal(TR.applyGlossaryLock("beware of phishing emails"), "beware of phishing emails");
});

test("normalises odd casing to a sensible leading-capital / canonical form", () => {
  const TR = loadTR();
  assert.match(TR.applyGlossaryLock("a PHISHING attack"), /a Phishing attack/, "ALL-CAPS → leading capital");
  assert.match(TR.applyGlossaryLock("enable mfa today"), /enable MFA today/, "acronym normalised to MFA");
  assert.match(TR.applyGlossaryLock("Enable MFA today"), /Enable MFA today/, "MFA stays MFA");
});
