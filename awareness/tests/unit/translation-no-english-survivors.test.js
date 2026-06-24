// Production-quality guard: NO substantive fragment may ship in English.
//
// The per-fragment translator calls the AI once per text node. Two real-world paths
// previously left a fragment in English and shipped it (only a >=50% coverage gate
// stood in the way, so partial failures slipped through):
//   1. The provider errored on that call (rate limit / transient) → worker catch put the
//      English original back. No re-attempt. (footer + scattered blocks, worse on later
//      languages where rate limits accumulate.)
//   2. isBadTranslationOutput rejected a perfectly good SHORT heading because its target
//      translation expanded past 3x the source length (no absolute floor) → threw → English.
//
// This exercises the REAL translateOne path (prompt build, validator, retry) against a
// MOCK provider (stubbed fetchWithTranslationRetry) — no live AI — so the recovery and the
// validator floor are deterministically verified.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

// scenario(source, callNumber) → { fail:true, status } | { content } | null(default translate)
function loadTranslation(scenario) {
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
  const _in = ctx.App.UI._internals;
  _in.getLanguageLabel = (id) => ({ fr: "French", ko: "Korean", de: "German" }[id] || id);
  _in.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "fr" }, { id: "ko" }];
  _in.recordTranslationFailure = () => {};
  _in.describeTranslationHttpError = async (resp) => `provider error (status ${resp.status})`;
  const calls = {};
  _in.fetchWithTranslationRetry = async (url, options) => {
    const body = JSON.parse(options.body);
    const userMsg = body.messages ? body.messages[body.messages.length - 1].content : "";
    // The prompt mentions "<source>" in its instructions and trailing line too; the REAL
    // fragment is the one wrapped by the single </source>. Anchor on </source>, then take
    // the <source> immediately before it.
    const end = userMsg.indexOf("</source>");
    const start = end >= 0 ? userMsg.lastIndexOf("<source>", end) : -1;
    const source = start >= 0 ? userMsg.slice(start + "<source>".length, end).trim() : "";
    calls[source] = (calls[source] || 0) + 1;
    const rule = scenario(source, calls[source]) || {};
    if (rule.fail) return { ok: false, status: rule.status || 429, json: async () => ({ error: { message: "rate limit" } }) };
    const content = rule.content != null ? rule.content : `«${source}»`; // default: a real change
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  vm.runInContext(readFileSync(path.join(rootDir, "js/ui/translation.js"), "utf8"), ctx);
  return { ctx, window, calls };
}

const visibleText = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("recovers a fragment whose first provider call fails — no English survivor ships", async () => {
  // The footer 429s on its first call, then succeeds. Other fragments translate fine.
  const footer = "Forward suspicious emails to the security team and report incidents promptly.";
  const frFooter = "Transférez les e-mails suspects à l’équipe de sécurité et signalez vite.";
  const { ctx } = loadTranslation((source, n) => {
    if (source.startsWith("Forward suspicious")) return n === 1 ? { fail: true, status: 429 } : { content: frFooter };
    return null;
  });
  const html = `<h1>Stay alert this week</h1><p>${footer}</p><p>Another body sentence to translate.</p>`;
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "fr", "openai", "key");

  assert.ok(!visibleText(out).includes(footer),
    "footer must NOT remain in English after a transient first-call failure");
  assert.ok(out.includes(frFooter), "footer must be recovered (re-translated) on a later pass");
});

test("does not reject a short heading whose translation naturally expands past 3x", async () => {
  // "Report" (6 chars) → a 24-char French rendering is >3x but is a valid translation.
  const { ctx } = loadTranslation((source) => {
    if (/^Report$/i.test(source)) return { content: "Signalez cela immédiatement." };
    return null;
  });
  const html = "<h2>Report</h2><p>A longer body sentence that clearly translates fine.</p>";
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "fr", "openai", "key");

  assert.ok(out.includes("Signalez cela imm"), "short heading must be translated, not rejected for length");
  assert.ok(!/>Report<\/h2>/.test(out), "the English heading must be gone");
});

test("normal documents still translate every fragment (sanity)", async () => {
  const { ctx } = loadTranslation(() => null); // everything translates to «source»
  const html = "<h1>Weekly security brief</h1><p>Watch out for fake invoices.</p>";
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "fr", "openai", "key");
  assert.ok(out.includes("«Weekly security brief»"));
  assert.ok(out.includes("«Watch out for fake invoices.»"));
});

test("inline markup (bold/colour) split text nodes keep their separating spaces", async () => {
  // Reported bug: bolding/colouring a word splits one text node into "foo " | "bar" |
  // " baz". Each fragment was translated then written back TRIMMED, dropping the edge
  // spaces, so the words joined: "«foo»«bar»«baz»". Each node's leading/trailing
  // whitespace must be re-attached so the words stay separated.
  const { ctx, window } = loadTranslation(() => null); // returns «source» (mock trims it)
  const html = '<p>Verify suspicious <span style="font-weight:bold">invoices</span> before paying anyone</p>';
  const out = await ctx.App.UITranslation.translateHtmlWithAI(html, "fr", "openai", "key");
  const div = window.document.createElement("div");
  div.innerHTML = out;
  assert.equal(div.textContent, "«Verify suspicious» «invoices» «before paying anyone»",
    `bold/colour-split words must not join after translation; got ${JSON.stringify(div.textContent)}`);
});

// End-to-end lock for the exact reported bug: a real bank-page build, translated through a
// provider that fails the FIRST call for every fragment (the rate-limit storm), must still
// ship ZERO English — the footer from the screenshot must not survive.
function loadWithBuilders(scenario) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  window.App = { UI: { _state: { translationPendingLang: null, translationCache: {} }, _internals: {} } };
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, console, URL, Blob,
    App: window.App, setTimeout, clearTimeout, NodeFilter: window.NodeFilter, Node: window.Node,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  });
  for (const f of ["js/utils.js", "js/translation_metrics.js", "js/newsletter_builder.js",
    "js/newsletter/bank_page.js", "js/newsletter/core_templates.js"]) {
    vm.runInContext(readFileSync(path.join(rootDir, f), "utf8"), ctx);
  }
  const _in = ctx.App.UI._internals;
  _in.getLanguageLabel = (id) => ({ fr: "French", ko: "Korean" }[id] || id);
  _in.NEWSLETTER_LANGUAGES = [{ id: "en" }, { id: "fr" }, { id: "ko" }];
  _in.recordTranslationFailure = () => {};
  _in.describeTranslationHttpError = async (resp) => `provider error (status ${resp.status})`;
  const calls = {};
  _in.fetchWithTranslationRetry = async (url, options) => {
    const body = JSON.parse(options.body);
    const userMsg = body.messages ? body.messages[body.messages.length - 1].content : "";
    const e = userMsg.indexOf("</source>");
    const s = e >= 0 ? userMsg.lastIndexOf("<source>", e) : -1;
    const source = s >= 0 ? userMsg.slice(s + 8, e).trim() : "";
    calls[source] = (calls[source] || 0) + 1;
    const rule = scenario(source, calls[source]) || {};
    if (rule.fail) return { ok: false, status: 429, json: async () => ({ error: { message: "rate limit" } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: rule.content != null ? rule.content : `«${source}»` } }] }) };
  };
  vm.runInContext(readFileSync(path.join(rootDir, "js/ui/translation.js"), "utf8"), ctx);
  return { ctx, window };
}

test("the 'Disclaimer: The above content is curated and created with AI' footer credit is translated, never shipped in English", async () => {
  // Success returns an UPPERCASED rendering so a translated fragment can't accidentally
  // contain its mixed-case English source as a substring.
  const { ctx } = loadWithBuilders((source) => ({ content: "FR:" + source.toUpperCase() }));
  const cfg = { org: "ACME", soc: "soc@acme.test", freq: "Weekly", portal: "https://p.example", pname: "Portal" };
  const arts = [{ type: "Phishing", title: "Fake invoice scam", summary: "A forged invoice asks staff to wire payment.", source: "BleepingComputer", url: "https://x.test/a", pubDate: "2026-06-04", threatLevel: 3 }];
  // "poster" exercises the shared foot(); the bank-page templates carry their own footer.
  for (const id of ["poster", "bankpage1_dynamic", "phishingbrief"]) {
    const built = ctx.App.NewsletterBuilder.build(id, cfg, arts, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
    assert.ok(built.includes("Disclaimer: The above content is curated and created with AI"), `precondition: ${id} build carries the credit`);
    const out = await ctx.App.UITranslation.translateHtmlWithAI(built, "fr", "openai", "key");
    const visible = out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    assert.ok(!visible.includes("Disclaimer: The above content is curated and created with AI"), `${id}: English credit must NOT survive translation`);
    assert.ok(out.includes("FR:DISCLAIMER: THE ABOVE CONTENT IS CURATED AND CREATED WITH AI"), `${id}: credit must be translated`);
  }
});

test("real bank-page build ships no English footer even when every fragment 429s on its first call", async () => {
  // Fail the first call for EVERY fragment (worst-case rate-limit storm); succeed on retry.
  // Success returns an UPPERCASED rendering so a recovered fragment cannot accidentally
  // contain its mixed-case English source as a substring.
  const { ctx, window } = loadWithBuilders((source, n) => (n === 1 ? { fail: true } : { content: "FR:" + source.toUpperCase() }));
  const cfg = { org: "ACME", soc: "soc-support@ab-inbev.com", freq: "Weekly", portal: "https://p.example", pname: "Portal" };
  const arts = [
    { type: "Phishing", title: "Fake invoice scam hits finance teams", summary: "A forged invoice asks staff to wire payment urgently.", source: "BleepingComputer", url: "https://x.test/a", pubDate: "2026-06-04", threatLevel: 3 },
    { type: "Malware", title: "Malicious extension steals logins", summary: "A popular-looking extension captures passwords.", source: "The Hacker News", url: "https://x.test/b", pubDate: "2026-06-03", threatLevel: 4 },
  ];
  const built = ctx.App.NewsletterBuilder.build("bankpage1_dynamic", cfg, arts, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
  const footer = "Forward suspicious emails to the security team. Every report helps protect the entire organisation and enables the SOC to act faster.";
  assert.ok(built.includes(footer), "precondition: the English footer is in the build");

  const out = await ctx.App.UITranslation.translateHtmlWithAI(built, "fr", "openai", "key");

  const visible = out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.ok(!visible.includes(footer), "the English footer must NOT survive after the recovery passes");
  assert.ok(out.includes("FR:FORWARD SUSPICIOUS EMAILS"), "footer was recovered (re-translated), not left English");
  // The locked publication name is intentionally preserved verbatim (not a survivor).
  assert.ok(out.includes("BleepingComputer"), "data-nl-keep source name stays verbatim");
});
