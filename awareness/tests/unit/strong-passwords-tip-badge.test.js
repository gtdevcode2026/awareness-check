// gen_strong_passwords: the three gold tip tiles are sibling cells of one table
// row, so they equalize to the tallest — uniform in every client and in every
// translated language. Each tile carries a small dark "Tip N" badge at the top of
// its gold cell. The badge must render and be email-safe: a solid bgcolor cell,
// inline styles, NO position:absolute / float / background-image, so it delivers
// inside an .eml. Tile text is also stripped of any "…" clamp artifact.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function buildStrongPasswords() {
  const ctx = {
    window: {},
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelectorAll: () => [] },
    console, navigator: {},
  };
  ctx.window.document = ctx.document;
  ctx.window.navigator = ctx.navigator;
  ctx.window.App = ctx.window.App || {};
  ctx.App = ctx.window.App;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/utils.js');
  load('assets/template_assets.js');
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  return ctx.window.App.NewsletterBuilder.build(
    'gen_strong_passwords',
    { title: 'Portal', portal: 'https://p.example.com' },
    [{ title: 'A breach exposes accounts', watchouts: ['Change passwords for affected services and reused logins', 'Turn on MFA where the service still allows it', 'Watch bank and work accounts for odd activity'] }]
  );
}

test('each tip tile renders a solid dark "Tip N" badge', () => {
  const html = buildStrongPasswords();
  for (const label of ['Tip 1', 'Tip 2', 'Tip 3']) {
    assert.ok(html.includes('>' + label + '<'), `${label} badge text must be present`);
  }
  // Three badges, each with a solid dark background so they read as a box even
  // when overlap (position/margin) is stripped by Outlook.
  const darkBadges = (html.match(/background-color:#0A0A0A/g) || []).length;
  assert.ok(darkBadges >= 3, `expected >= 3 solid dark badge backgrounds, got ${darkBadges}`);
});

test('tip badges are email-safe (no position:absolute, float, or background-image)', () => {
  const html = buildStrongPasswords();
  assert.ok(!/position\s*:\s*absolute/i.test(html), 'must not use position:absolute (Outlook-hostile)');
  assert.ok(!/float\s*:/i.test(html), 'must not use float in the email body');
  assert.ok(!/background-image\s*:/i.test(html), 'badge must not rely on a background image');
});

test('"Tip N" badge fill is on a bgcolor cell, not a <span> (Word ignores span backgrounds)', () => {
  const html = buildStrongPasswords();
  assert.ok(!/<span style="display:inline-block;background:#0A0A0A/.test(html), 'badge no longer relies on a <span> background');
  const badgeCells = (html.match(/<td bgcolor="#0A0A0A" style="background-color:#0A0A0A;border:1px solid #C09010;border-radius:12px/g) || []).length;
  assert.equal(badgeCells, 3, 'three badge cells carry bgcolor + the badge styling');
});

test('headline font is reduced from 38px', () => {
  const html = buildStrongPasswords();
  assert.ok(!html.includes('font-size:38px'), 'old 38px headline size is gone');
  assert.ok(html.includes('font-size:28px;line-height:1.18'), 'headline reduced to 28px');
});

test('Report to SOC is a gold filled button matching the chase casing (email-safe)', () => {
  const html = buildStrongPasswords();
  assert.ok(html.includes('<a href="mailto:soc-support@ab-inbev.com" style="display:inline-block;padding:13px 26px;'), 'SOC CTA is a padded button-link');
  assert.ok(html.includes('bgcolor="#D4A420"'), 'SOC button cell carries a bgcolor Word honours');
  assert.ok(!html.includes('<a href="mailto:soc-support@ab-inbev.com" style="color:#0A0A0A;text-decoration:none;">'), 'old plain-text SOC link is gone');
});

test('template is email-safe: no rgba() in backgrounds, borders, or text', () => {
  const html = buildStrongPasswords();
  // (The only rgba is the browser-only drop shadow on the email-card wrapper,
  //  which Word ignores harmlessly — so we check the forms Word mis-handles.)
  assert.ok(!html.includes('background:rgba('), 'no rgba backgrounds');
  assert.ok(!html.includes('background-color:rgba('), 'no rgba background-color');
  assert.ok(!/border:\dpx solid rgba\(/.test(html), 'no rgba borders');
  assert.ok(!html.includes('color:rgba('), 'no rgba text colors');
});

test('tip tiles never show a mid-word "…" truncation artifact', () => {
  const rootDir2 = path.resolve(__dirname, '../..');
  const ctx = {
    window: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelectorAll: () => [] },
    console, navigator: {},
  };
  ctx.window.document = ctx.document; ctx.window.navigator = ctx.navigator; ctx.window.App = ctx.window.App || {}; ctx.App = ctx.window.App;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir2, rel), 'utf8'), ctx, { filename: rel });
  ['js/utils.js', 'assets/template_assets.js', 'js/newsletter_builder.js', 'js/newsletter/bank_page.js', 'js/newsletter/core_templates.js'].forEach(load);
  const html = ctx.window.App.NewsletterBuilder.build(
    'gen_strong_passwords',
    { title: 'Portal', portal: 'https://p.example.com' },
    // Watchouts as generateTips emits them — the long one is already clamped with "…".
    [{ title: 'Supply chain attack', watchouts: ['Verify dependency updates and lockfiles before production d…', 'Short tip two', 'Short tip three'] }]
  );
  assert.ok(!html.includes('…'), 'the ellipsis truncation artifact is stripped from the tiles');
  assert.ok(html.includes('Verify dependency updates and lockfiles before production'), 'clean text (sans dangling partial word) remains');
});

test('tip tiles are equal-height: gold sits on the row cells, no per-tile fixed box height', () => {
  const html = buildStrongPasswords();
  // The 3 gold tiles are sibling cells in one row (so they auto-equalize to the
  // tallest, in every client and any language) — not independent nested boxes.
  const goldCells = (html.match(/bgcolor="#D4A420"[^>]*border-radius:8px/g) || []).length;
  assert.equal(goldCells, 3, 'three gold tile cells carry the rounded background');
  assert.ok(!html.includes('height:96px'), 'no per-tile fixed 96px box height (which made them uneven)');
});
