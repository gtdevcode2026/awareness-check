// The static-replica posters (gen_wifi_safety, gen_horizontal_brief, …) shipped
// the footer "Visit Portal" button as a dead <a href="#"> — the per-user portal
// URL was never wired in, so the button did nothing. App.Utils.wireVisitPortalCta
// repoints that dead anchor at the configured portal, both at build time (new
// renders) and when healing variant HTML frozen in a previously saved project.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');

// ── App.Utils.wireVisitPortalCta (pure helper) ──
function loadUtils() {
  const ctx = { window: {}, URL, Date, console, navigator: {} };
  ctx.window = ctx;
  ctx.App = ctx.window.App = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(rootDir, 'js/utils.js'), 'utf8'), ctx, { filename: 'js/utils.js' });
  return ctx.App.Utils;
}

const DEAD_CTA = '<a href="#" style="color:#D4A420; text-decoration:none;">Visit Portal</a>';

test('wireVisitPortalCta repoints a dead Visit Portal anchor at the portal URL, in a new tab', () => {
  const U = loadUtils();
  const out = U.wireVisitPortalCta(DEAD_CTA, 'https://portal.example');
  assert.ok(!/href="#"/.test(out), 'the dead href="#" is gone');
  assert.ok(out.includes('href="https://portal.example"'), 'href now points at the portal');
  assert.ok(/target="_blank"/.test(out), 'opens in a new tab');
  assert.ok(/rel="noopener noreferrer"/.test(out), 'carries safe rel');
  assert.ok(out.includes('>Visit Portal</a>'), 'the label is preserved');
  assert.ok(out.includes('color:#D4A420'), 'the existing styling is preserved');
});

test('wireVisitPortalCta is a safe no-op without a usable href', () => {
  const U = loadUtils();
  assert.equal(U.wireVisitPortalCta(DEAD_CTA, ''), DEAD_CTA, 'no href → unchanged');
  assert.equal(U.wireVisitPortalCta(DEAD_CTA, '#'), DEAD_CTA, '"#" → unchanged');
  assert.equal(U.wireVisitPortalCta('', 'https://x'), '', 'empty html → unchanged');
});

test('wireVisitPortalCta does not touch other dead anchors (e.g. the source link)', () => {
  const U = loadUtils();
  const sourceLink = '<a id="nl-wifi-source-link" href="#" style="color:#C09010;">Read article &rarr;</a>';
  assert.equal(U.wireVisitPortalCta(sourceLink, 'https://portal.example'), sourceLink, 'only the Visit Portal CTA is wired');
});

test('wireVisitPortalCta falls back to a mailto href and escapes attribute chars', () => {
  const U = loadUtils();
  const out = U.wireVisitPortalCta(DEAD_CTA, 'https://p.example/?a=1&b=2');
  assert.ok(out.includes('href="https://p.example/?a=1&amp;b=2"'), '& is escaped in the attribute');
});

// ── Build-time wiring: a freshly built gen_wifi_safety poster ──
function buildReplica(id, cfg, arts) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.test/' });
  const { window } = dom;
  window.App = { Graphics: {} };
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, URL, Date, console,
    App: window.App, setTimeout, clearTimeout,
    fetch: () => Promise.reject(new Error('no fetch in test')),
  });
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/utils.js');
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  load('js/newsletter/static_replicas_data.js');
  load('js/newsletter/static_replicas.js');
  return ctx.App.NewsletterBuilder.build(id, cfg, arts || [], { useLinks: true, usePoster: false, useQR: false, useIllus: false });
}

test('a freshly built gen_wifi_safety wires its Visit Portal button to the configured portal', () => {
  const html = buildReplica('gen_wifi_safety', { portal: 'companyportal.example/security' });
  assert.ok(html.includes('>Visit Portal</a>'), 'the Visit Portal button is present');
  // The dead href="#" on the Visit Portal CTA must be gone (the source link is separate).
  assert.ok(!/href="#"[^>]*>\s*Visit Portal/.test(html), 'Visit Portal no longer has a dead href');
  assert.ok(/href="https:\/\/companyportal\.example\/security"[^>]*>\s*Visit Portal/.test(html)
    || /href="https:\/\/companyportal\.example\/security"[^>]*target="_blank"/.test(html),
    'Visit Portal points at the normalized portal URL');
});

// ── Heal scenario: variant HTML frozen in a previously saved project ──
test('a saved project frozen with the dead button is repaired by the same helper', () => {
  const U = loadUtils();
  // Simulate the frozen footer of an old gen_wifi_safety render.
  const frozen = '<table><tr><td>' + DEAD_CTA + '</td></tr></table>';
  const healed = U.wireVisitPortalCta(frozen, U.normalizeWebUrl('myportal.example'));
  assert.ok(healed.includes('href="https://myportal.example"'), 'restored project button now points at the portal');
  assert.ok(/target="_blank"/.test(healed), 'and opens in a new tab');
});

test('healing an inline-rendered frozen anchor (already has target) does not duplicate attributes', () => {
  const U = loadUtils();
  // After inlineBody, the stored anchor already carries target/rel but a dead href.
  const frozenInline = '<a href="#" style="color:#D4A420; text-decoration:none;" target="_blank" rel="noopener noreferrer">Visit Portal</a>';
  const healed = U.wireVisitPortalCta(frozenInline, 'https://portal.example');
  assert.ok(healed.includes('href="https://portal.example"'), 'href is fixed');
  assert.ok(!/href="#"/.test(healed), 'no dead href remains');
  assert.equal((healed.match(/target=/g) || []).length, 1, 'target appears exactly once');
  assert.equal((healed.match(/\brel=/g) || []).length, 1, 'rel appears exactly once');
});
