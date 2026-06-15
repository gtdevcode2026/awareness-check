// All-templates translation coverage guard.
//
// The per-fragment translator (js/ui/translation.js) is template-agnostic: it walks
// the rendered HTML's text nodes and translates each substantive one. "Substantive"
// is defined by the runtime work-item gate (translation.js:392-396) =
// TranslationMetrics.countsTowardCoverageProgress = hasTranslatableLetters && letterCore>=4.
// Sub-4-letter tokens (reference codes IND-01/T-00, timestamps 09:17Z, quiz-option
// letters A/B/C/D, severity chips, stat figures, month abbreviations) are intentionally
// left in English so they stay stable across locales.
//
// This test builds EVERY registered template, runs it through the translator under the
// deterministic E2E segment hook (each translated node comes back marked "⟨e2e⟩"), and
// asserts the real guarantee for all of them:
//   1. the template builds to non-empty HTML,
//   2. translation does not throw,
//   3. ZERO substantive (letterCore>=4) text segments are left untranslated — i.e. no
//      meaningful English leaks. The only English left is the deliberately-skipped
//      short tokens, and curated [data-nl-i18n] chrome is swapped, not leaked,
//   4. coverage clears the runtime gates (something translated, ratio >= 0.5).
//
// It enumerates templates from getTemplateCatalog(), so a newly-registered template is
// covered automatically — if its rendered text doesn't translate, this fails.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadContext() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = window.App || {};
  const sandbox = {
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer,
    NodeFilter: window.NodeFilter, Node: window.Node,
    console, URL, Blob, App: window.App, setTimeout, clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // Builders first (bank_page.js also registers App.TemplateI18n chrome strings).
  for (const f of ["js/utils.js", "js/translation_metrics.js", "js/newsletter_builder.js",
    "js/newsletter/bank_page.js", "js/newsletter/core_templates.js"]) {
    vm.runInContext(readFileSync(path.join(rootDir, f), "utf8"), ctx);
  }
  // Minimal App.UI surface the translator reads (mirrors translation-i18n-swap.test.js).
  window.App.UI = { _state: { translationPendingLang: null, translationCache: {} }, _internals: {} };
  window.App.UI._internals.getLanguageLabel = (id) =>
    ({ es: "Spanish", de: "German", fr: "French", "pt-BR": "Portuguese" }[id] || id);
  window.App.UI._internals.fetchWithTranslationRetry = async () => { throw new Error("must not fetch under the E2E hook"); };
  window.App.UI._internals.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "es" }, { id: "de" }, { id: "fr" }];
  window.App.UI._internals.recordTranslationFailure = () => {};
  vm.runInContext(readFileSync(path.join(rootDir, "js/ui/translation.js"), "utf8"), ctx);
  return { ctx, window };
}

const { ctx, window: win } = loadContext();
win.__AWARENESS_E2E_SEG_TRANSLATE = "1";
const NB = ctx.App.NewsletterBuilder;
const TR = ctx.App.UITranslation;
const TM = ctx.App.TranslationMetrics;
const MARK = "⟨e2e⟩"; // ⟨e2e⟩

const cfg = { org: "ACME Corp", soc: "soc-support@ab-inbev.com", freq: "Weekly", portal: "https://portal.example", pname: "Security Awareness Portal" };
const arts = [
  { type: "Phishing", title: "Fake invoice scam hits finance teams", summary: "Attackers send a forged invoice that looks like it is from a known vendor and pressure staff to wire payment urgently.", source: "Threat Desk", url: "https://example.com/a", pubDate: "2026-06-04", threatLevel: 3 },
  { type: "Malware", title: "Malicious browser extension steals logins", summary: "A popular-looking extension quietly captures passwords typed into banking and email sites.", source: "Research Lab", url: "https://example.com/b", pubDate: "2026-06-03", threatLevel: 4 },
  { type: "Ransomware", title: "Locked files demand a crypto payment", summary: "A staff laptop was encrypted after someone opened a booby-trapped attachment; clean backups saved the day.", source: "Incident Team", url: "https://example.com/c", pubDate: "2026-06-02", threatLevel: 5 },
];
const opts = { useLinks: false, usePoster: false, useQR: false, useIllus: false };

// Substantive = the runtime work-item gate. A node is expected to be translated iff
// countsTowardCoverageProgress(original) is true (hasTranslatableLetters && letterCore>=4).
const isSubstantive = (text) => TM.countsTowardCoverageProgress(String(text || "").split(MARK).join(""));

function analyze(outHtml) {
  const doc = new win.DOMParser().parseFromString(`<div id="r">${outHtml}</div>`, "text/html");
  const root = doc.getElementById("r");
  const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT, null);
  let segments = 0, translated = 0, i18n = 0;
  const leaks = [];
  let node;
  while ((node = walker.nextNode())) {
    const v = node.nodeValue;
    if (!v || !v.trim()) continue;
    const pt = node.parentElement && node.parentElement.tagName;
    if (pt === "STYLE" || pt === "SCRIPT") continue;
    // Explicitly-locked proper nouns (company/brand/publication/article-source names):
    // intentionally preserved verbatim, so they're neither a segment nor a leak.
    if (node.parentElement && node.parentElement.closest('[data-nl-keep], [translate="no"]')) continue;
    if (!isSubstantive(v)) continue; // short codes/labels: intentionally untranslated
    segments += 1;
    if (v.includes(MARK)) translated += 1;
    else if (node.parentElement && node.parentElement.closest("[data-nl-unit]")) i18n += 1; // designed phrase translated as a whole unit
    else leaks.push(v.trim().slice(0, 80));
  }
  return { segments, translated, i18n, leaks };
}

const TEMPLATE_IDS = NB.getTemplateCatalog().map((t) => t.id);

test("getTemplateCatalog exposes the full registered template set", () => {
  assert.ok(TEMPLATE_IDS.length >= 25, `expected >=25 templates, got ${TEMPLATE_IDS.length}`);
  assert.ok(TEMPLATE_IDS.includes("poster") && TEMPLATE_IDS.includes("phishingbrief"));
});

for (const id of TEMPLATE_IDS) {
  for (const lang of ["es", "de"]) {
    test(`${id} → ${lang}: every substantive segment translates (no English leaks)`, async () => {
      const built = NB.build(id, cfg, arts, opts);
      assert.equal(typeof built, "string");
      assert.ok(built.trim().length > 0, "template built to non-empty HTML");

      const out = await TR.translateHtmlWithAI(built, lang, "openai", "test-key");
      const { segments, translated, i18n, leaks } = analyze(out);

      assert.equal(leaks.length, 0,
        `${id}/${lang}: ${leaks.length} substantive segment(s) left in English:\n  ` + leaks.join("\n  "));
      assert.ok(segments > 0, `${id}/${lang}: expected at least one substantive segment`);
      assert.ok(translated > 0, `${id}/${lang}: nothing went through the AI walk`);
      const ratio = (translated + i18n) / segments;
      assert.ok(ratio >= 0.5, `${id}/${lang}: coverage ${translated + i18n}/${segments} below the 0.5 runtime gate`);
    });
  }
}
