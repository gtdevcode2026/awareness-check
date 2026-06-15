// Guards the whole-phrase UNIT translation in translateHtmlWithAI: elements tagged
// [data-nl-unit] (the hero headline, the "Pause → Don't engage → Report" action strip) have
// their FULL inner phrase translated in ONE AI call — giving the model full context for grammar,
// parallel imperatives, casing, and keeping the inline gold styling — instead of being split
// text-node by text-node. Nothing is hardcoded; the AI produces the translation. The '1' E2E hook
// makes a translated fragment return "⟨e2e⟩"+text, so a single ⟨e2e⟩ inside a unit proves the whole
// phrase went through ONE call, not one-per-word. Also guards [data-nl-keep]/translate="no".
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadTranslation() {
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
  ctx.App.UI._internals.getLanguageLabel = (id) => ({ es: "Spanish", de: "German" }[id] || id);
  ctx.App.UI._internals.fetchWithTranslationRetry = async () => { throw new Error("must not fetch under E2E hook"); };
  ctx.App.UI._internals.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "es" }, { id: "de" }];
  ctx.App.UI._internals.recordTranslationFailure = () => {};
  vm.runInContext(readFileSync(path.join(rootDir, "js/ui/translation.js"), "utf8"), ctx);
  return { ctx, window };
}

const unitInnerOf = (html) => (html.match(/<div data-nl-unit[^>]*>([\s\S]*?)<\/div>/) || ["", ""])[1];

test("translates a [data-nl-unit] designed phrase as ONE whole-phrase call, keeping inline styling", async () => {
  const { ctx, window } = loadTranslation();
  window.__AWARENESS_E2E_SEG_TRANSLATE = "1";
  const html =
    '<div data-nl-unit>Think before <em style="color:#D4A420;">you click.</em></div>' +
    "<p>Stay alert today.</p>";
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "de", "openai", "key");

  assert.match(out, /data-nl-unit[^>]*>⟨e2e⟩Think before <em[^>]*>you click\.<\/em>/,
    "the whole phrase (with its inner <em>) went through one call");
  assert.ok(out.includes("#D4A420"), "gold styling preserved");
  assert.equal((unitInnerOf(out).match(/⟨e2e⟩/g) || []).length, 1,
    "exactly ONE whole-phrase call — not split word-by-word");
  assert.match(out, /⟨e2e⟩Stay alert today\./, "body text outside the unit still translates per-fragment");
});

test("[data-nl-unit] inner text nodes are excluded from the per-fragment walk (no double translation)", async () => {
  const { ctx, window } = loadTranslation();
  window.__AWARENESS_E2E_SEG_TRANSLATE = "1";
  // "Report" alone would mistranslate to a noun; as part of the whole strip the model gets context.
  const html = '<div data-nl-unit>Pause <span style="color:#D4A420;">&rarr;</span> Don\'t engage <span style="color:#D4A420;">&rarr;</span> Report</div>';
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "de", "openai", "key");
  assert.equal((unitInnerOf(out).match(/⟨e2e⟩/g) || []).length, 1,
    "the 3-part strip was translated as one unit, not three separate words");
  assert.ok(out.includes("&rarr;") || out.includes("→"), "the gold arrow separators are preserved");
});

test("a document whose only translatable text is a [data-nl-unit] still translates (unit-only doc)", async () => {
  const { ctx, window } = loadTranslation();
  window.__AWARENESS_E2E_SEG_TRANSLATE = "1";
  const html = '<div data-nl-unit>Think before you click.</div>';
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "es", "openai", "key");
  assert.match(out, /data-nl-unit[^>]*>⟨e2e⟩Think before you click\./,
    "unit-only document is not skipped by the empty-nodes early return");
});

// ── [data-nl-keep] / translate="no": never translate a marked proper noun ─────
// Company / brand / publication / article-source names are wrapped in [data-nl-keep]
// by the templates so the translator leaves them verbatim, while the surrounding
// label ("Source:", "Read more —") still translates. translate="no" (HTML standard)
// is honored too.

test("never sends a [data-nl-keep] source name through the AI walk, but translates the label around it", async () => {
  const { ctx, window } = loadTranslation();
  window.__AWARENESS_E2E_SEG_TRANSLATE = "1";
  const html = '<div>Source: <span data-nl-keep>BleepingComputer</span></div><p>Stay alert today.</p>';
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "es", "openai", "key");

  assert.match(out, /<span data-nl-keep[^>]*>BleepingComputer<\/span>/, "publication name kept verbatim inside its span");
  assert.ok(!out.includes("⟨e2e⟩BleepingComputer"), "publication name did NOT go through the AI walk");
  assert.match(out, /⟨e2e⟩Source:/, "the 'Source:' label still translates");
  assert.match(out, /⟨e2e⟩Stay alert today\./, "other body text still translates");
});

test('honors the HTML-standard translate="no" attribute as well', async () => {
  const { ctx, window } = loadTranslation();
  window.__AWARENESS_E2E_SEG_TRANSLATE = "1";
  const html = '<p>Read more — <a href="https://x.test" translate="no">The Hacker News</a></p>';
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "de", "openai", "key");
  assert.ok(out.includes(">The Hacker News<"), "outlet name kept verbatim");
  assert.ok(!out.includes("⟨e2e⟩The Hacker News"), 'translate="no" excluded the name from the AI walk');
  assert.match(out, /⟨e2e⟩Read more/, "the 'Read more —' label still translates");
});
