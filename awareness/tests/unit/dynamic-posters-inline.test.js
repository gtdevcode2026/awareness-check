// gen_wifi_safety / gen_horizontal_brief / gen_security_digest were static-replica
// posters rendered inside an <iframe srcdoc>. An iframe's content is a separate
// document, so the per-fragment translator (and the editor) could never reach the
// poster text, and iframes don't survive .eml export. They are now AI-wired and
// rendered INLINE: the builder fills the #nl-* hooks with article-driven copy, then
// drops the replica's <body> (a self-contained, inline-styled email table) straight
// into the document — so the text lives in the main DOM (translatable + editable).
//
// This needs a real DOMParser, so it runs under jsdom (the Node unit env has none,
// where the builder intentionally leaves the HTML untouched).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function build(id, cfg, arts) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = { Utils: { log() {}, stripTags: (v) => String(v || ""), normalizeWebUrl: (v) => String(v || "") }, Graphics: {} };
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, URL, Date, console,
    App: window.App, setTimeout, clearTimeout,
    fetch: () => Promise.reject(new Error("no fetch in test")),
  });
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), "utf8"), ctx, { filename: rel });
  load("js/newsletter_builder.js");
  load("js/newsletter/bank_page.js");
  load("js/newsletter/core_templates.js");
  load("js/newsletter/static_replicas_data.js");
  load("js/newsletter/static_replicas.js");
  return ctx.App.NewsletterBuilder.build(id, cfg, arts || [], { useLinks: true, usePoster: false, useQR: false, useIllus: false });
}

const CASES = [
  { id: "gen_security_digest", cfg: { nlSdHeading: "ZZHEADINGZZ", nlSdIntro: "ZZINTROZZ", nlSdPoints: ["ZZP1ZZ", "ZZP2ZZ", "ZZP3ZZ", "ZZP4ZZ"] } },
  { id: "gen_wifi_safety", cfg: { nlWifiHeading: "ZZHEADINGZZ", nlWifiIntro: "ZZINTROZZ", nlWifiTips: ["ZZP1ZZ", "ZZP2ZZ", "ZZP3ZZ", "ZZP4ZZ", "ZZP5ZZ"] } },
  { id: "gen_horizontal_brief", cfg: { nlHbHeading: "ZZHEADINGZZ", nlHbIntro: "ZZINTROZZ", nlHbTips: ["ZZP1ZZ", "ZZP2ZZ", "ZZP3ZZ", "ZZP4ZZ"] } },
];

for (const { id, cfg } of CASES) {
  test(`${id} renders inline (no iframe) so its text is in the main DOM`, () => {
    const html = build(id, cfg);
    assert.ok(!html.includes("<iframe"), "must NOT be wrapped in an iframe");
    assert.ok(!html.includes("srcdoc"), "no srcdoc — the poster is inline, translatable text");
    assert.ok(html.includes("<table"), "the email-safe poster table renders inline");
    assert.ok(!html.includes("Loading static template"), "renders synchronously, no loading placeholder");
  });

  test(`${id} injects the AI-wired copy into its inline hooks`, () => {
    const html = build(id, cfg);
    assert.ok(html.includes("ZZHEADINGZZ"), "AI heading injected");
    assert.ok(html.includes("ZZINTROZZ"), "AI intro injected");
    assert.ok(html.includes("ZZP1ZZ") && html.includes("ZZP4ZZ"), "AI points/tips injected");
  });
}

test("an inline poster's article/source links open in a NEW tab (not the app's own tab)", () => {
  // Rendered inline, these anchors live in the main app document — without a new-tab
  // target a click would navigate the whole app away. inlineBody() must force every
  // link to target="_blank" rel="noopener noreferrer".
  const html = build("gen_wifi_safety",
    { nlWifiHeading: "H", nlWifiTips: ["t1", "t2", "t3", "t4", "t5"] },
    [{ source: "KrebsOnSecurity", url: "https://krebsonsecurity.com/example" }]);
  assert.ok(!html.includes("<iframe"), "precondition: poster is inline, not iframed");
  assert.ok(html.includes("krebsonsecurity.com/example"), "the source link is present");
  // Every anchor that carries an href must also carry target="_blank".
  const anchors = html.match(/<a\s[^>]*href=/gi) || [];
  const newTab = html.match(/<a\s[^>]*target="_blank"/gi) || [];
  assert.ok(anchors.length > 0, "the inline poster has at least one link");
  assert.equal(newTab.length, anchors.length, "every inline link opens in a new tab");
});

test("the verbatim static posters still render inside an isolated iframe", () => {
  const html = build("gen_phonescam", { portal: "" });
  assert.ok(html.includes("<iframe") && html.includes("srcdoc"), "gen_phonescam stays iframed (no AI text, design isolation)");
});

// ── End-to-end: build an inline poster, then translate it. The poster text must
//    actually get translated now that it lives in the main DOM (it never did while
//    it was inside an iframe srcdoc). Mock provider returns «source». ──
function buildAndTranslate(id, cfg) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = { UI: { _state: { translationPendingLang: null, translationCache: {} }, _internals: {} }, Graphics: {} };
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, URL, Blob, console,
    App: window.App, setTimeout, clearTimeout, NodeFilter: window.NodeFilter, Node: window.Node,
    fetch: () => Promise.reject(new Error("no fetch in test")),
  });
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), "utf8"), ctx, { filename: rel });
  load("js/utils.js");
  load("js/translation_metrics.js");
  load("js/newsletter_builder.js");
  load("js/newsletter/bank_page.js");
  load("js/newsletter/core_templates.js");
  load("js/newsletter/static_replicas_data.js");
  load("js/newsletter/static_replicas.js");
  const _in = window.App.UI._internals;
  _in.getLanguageLabel = (lid) => ({ fr: "French" }[lid] || lid);
  _in.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "fr" }];
  _in.recordTranslationFailure = () => {};
  _in.describeTranslationHttpError = async (r) => `provider error (status ${r.status})`;
  _in.fetchWithTranslationRetry = async (url, options) => {
    const body = JSON.parse(options.body);
    const msg = body.messages ? body.messages[body.messages.length - 1].content : "";
    const e = msg.indexOf("</source>");
    const s = e >= 0 ? msg.lastIndexOf("<source>", e) : -1;
    const src = s >= 0 ? msg.slice(s + "<source>".length, e).trim() : "";
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: `«${src}»` } }] }) };
  };
  load("js/ui/translation.js");
  const built = window.App.NewsletterBuilder.build(id, cfg, [], { useLinks: false, usePoster: false, useQR: false, useIllus: false });
  return { built, translate: (html) => window.App.UITranslation.translateHtmlWithAI(html, "fr", "openai", "key") };
}

test("gen_security_digest poster text is reachable by the translator (was unreachable in an iframe)", async () => {
  const { built, translate } = buildAndTranslate("gen_security_digest", {
    nlSdHeading: "Phishing on the rise this week",
    nlSdIntro: "Attackers are sending fake invoices to finance teams across the company.",
    nlSdPoints: ["Verify any payment change by phone", "Report odd invoices to the SOC", "Never reuse a breached password", "Enable multi-factor everywhere"],
  });
  assert.ok(!built.includes("<iframe"), "precondition: poster is inline, not iframed");
  const out = await translate(built);
  assert.ok(out.includes("«Phishing on the rise this week»"), "the AI heading was translated");
  assert.ok(out.includes("«Verify any payment change by phone»"), "a digest point was translated");
  assert.ok(!out.includes(">Phishing on the rise this week<"), "no English heading survives");
});
