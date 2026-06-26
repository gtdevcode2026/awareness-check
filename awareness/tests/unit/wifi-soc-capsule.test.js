// The Wi-Fi Safety poster gains a Phishing-Maestro-style "See something suspicious"
// capsule (dark pill, gold border + gold uppercase text) directly above its
// Report-to-SOC button. NEW builds carry it; App.Utils.injectWifiSocCapsule adds it
// to Wi-Fi variant HTML frozen in a previously saved project. The capsule is scoped
// to Wi-Fi only (gated on the nl-wifi markers) and idempotent (data-soc-capsule).

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');

function loadUtils() {
  const ctx = { window: {}, URL, Date, console, navigator: {} };
  ctx.window = ctx;
  ctx.App = ctx.window.App = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(rootDir, 'js/utils.js'), 'utf8'), ctx, { filename: 'js/utils.js' });
  return ctx.App.Utils;
}

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
  ['js/utils.js', 'js/newsletter_builder.js', 'js/newsletter/bank_page.js', 'js/newsletter/core_templates.js',
    'js/newsletter/static_replicas_data.js', 'js/newsletter/static_replicas.js'].forEach(load);
  return ctx.App.NewsletterBuilder.build(id, cfg, arts || [], { useLinks: true, usePoster: false, useQR: false, useIllus: false });
}

function loadUiInternals() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.test/' });
  const { window } = dom;
  const ctx = vm.createContext({
    window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer,
    URL: window.URL, Blob: window.Blob, Date, console, setTimeout, clearTimeout,
    NodeFilter: window.NodeFilter, Node: window.Node,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no network in test')),
    addEventListener() {}, removeEventListener() {},
  });
  ctx.window.App = ctx.window.App || {};
  ctx.App = ctx.window.App;
  for (const f of ['js/utils.js', 'js/translation_metrics.js', 'js/ui_controller.js']) {
    vm.runInContext(readFileSync(path.join(rootDir, f), 'utf8'), ctx);
  }
  return ctx.App.UI._internals;
}

// A realistic frozen Wi-Fi report section (button only, no capsule), as a previously
// saved project would have stored it, plus a wifi marker so the heal recognises it.
const FROZEN_WIFI = '<div id="nl-wifi-tip1">x</div>'
  + '<td align="center" style="padding:14px 30px 20px;background:#FFFFFF;">'
  + '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;margin:0 auto;"><tr>'
  + '<td align="center" bgcolor="#D4A420" style="background:#D4A420;border-radius:6px;padding:13px 26px;">'
  + '<a href="mailto:soc-support@ab-inbev.com" style="color:#0A0A0A;">Report to SOC Now &rarr; soc-support@ab-inbev.com</a>'
  + '</td></tr></table></td>';

test('built gen_wifi_safety shows the See-something-suspicious capsule above the Report-to-SOC button', () => {
  // Strip HTML comments so the section comment ("<!-- Report to SOC ... -->") can't
  // fool the order check below.
  const html = buildReplica('gen_wifi_safety', { portal: 'p.example' }).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(html.includes('See something suspicious'), 'capsule label present');
  assert.ok(/data-soc-capsule/.test(html), 'capsule carries the idempotency marker');
  // Phishing-Maestro pill styling.
  assert.ok(/#231d0d/i.test(html) && /border-radius:20px/.test(html), 'dark pill with 20px radius (Phishing Maestro style)');
  // The capsule appears exactly once and BEFORE the Report-to-SOC button.
  assert.equal((html.match(/See something suspicious/g) || []).length, 1, 'exactly one capsule');
  const capIdx = html.indexOf('data-soc-capsule');
  const btnIdx = html.indexOf('mailto:soc-support@ab-inbev.com');
  assert.ok(capIdx >= 0 && btnIdx >= 0 && capIdx < btnIdx, 'capsule sits above the button');
});

test('the article source line is left-aligned, and the capsule has breathing room above the button', () => {
  const html = buildReplica('gen_wifi_safety', { portal: 'p.example' },
    [{ source: 'Bleeping Computer', url: 'https://example.test/a', title: 'USB worm' }]);
  // Article source/attribution row is left-aligned (was centered).
  const srcIdx = html.indexOf('nl-wifi-source-name');
  const cellStart = html.lastIndexOf('<td', srcIdx);
  const cell = html.slice(cellStart, srcIdx);
  assert.ok(/align="left"/.test(cell), 'the article source cell is left-aligned');
  assert.ok(!/align="center"/.test(cell), 'the source cell is no longer centered');
  // Extra space between the capsule heading and the SOC button.
  assert.ok(/data-soc-capsule[^>]*margin:0 auto 24px/.test(html), 'capsule has a 24px gap before the button');
});

test('injectWifiSocCapsule adds the capsule to frozen Wi-Fi HTML, above the button', () => {
  const U = loadUtils();
  const out = U.injectWifiSocCapsule(FROZEN_WIFI);
  assert.ok(out.includes('See something suspicious'), 'capsule injected');
  assert.ok(out.indexOf('See something suspicious') < out.indexOf('Report to SOC'), 'injected above the button');
});

test('injectWifiSocCapsule is idempotent and Wi-Fi-scoped', () => {
  const U = loadUtils();
  const once = U.injectWifiSocCapsule(FROZEN_WIFI);
  const twice = U.injectWifiSocCapsule(once);
  assert.equal((twice.match(/See something suspicious/g) || []).length, 1, 'never doubles the capsule');
  // Non–Wi-Fi HTML (no nl-wifi marker) is untouched, even with the same SOC button.
  const nonWifi = FROZEN_WIFI.replace('id="nl-wifi-tip1"', 'id="nl-other"');
  assert.equal(U.injectWifiSocCapsule(nonWifi), nonWifi, 'other templates are not touched');
});

test('normalizeVariant adds the capsule to a frozen saved Wi-Fi variant', () => {
  const internals = loadUiInternals();
  const out = internals.normalizeVariant({ html: FROZEN_WIFI, css: '' });
  assert.ok(out.html.includes('See something suspicious'), 'saved Wi-Fi project gets the capsule on load');
});
