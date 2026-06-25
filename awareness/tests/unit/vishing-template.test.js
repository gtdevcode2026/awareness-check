// gen_vishing is now a DYNAMIC, email-safe template (was a static SVG poster).
// The user selects one vishing article; the AI pipeline fills c.nlVishingIntro +
// c.nlVishingTips (4 tips, one per fixed symbol theme: take-your-time, emotional
// manipulation, verify legitimacy, context & tone). The builder recreates the
// poster as Outlook-safe tables, with the 4 tips each using the mascot character
// as a raster <img> (inline SVG is dropped by Outlook/Gmail), the ABI masthead,
// phone illustration, and the hardcoded Report-to-SOC CTA.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function build(cfg, arts) {
  const ctx = {
    window: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelectorAll: () => [] },
    console, navigator: {},
  };
  ctx.window.document = ctx.document; ctx.window.navigator = ctx.navigator;
  ctx.window.App = ctx.window.App || {}; ctx.App = ctx.window.App;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/utils.js');
  // NB: template_assets.js is intentionally NOT loaded — assetSrc then falls back
  // to readable relative paths ('assets/vishing_ico_time.png') so the icon-source
  // assertions can see the filenames (the bundle would inline opaque data URIs).
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  return ctx.window.App.NewsletterBuilder.build('gen_vishing', cfg, arts, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
}

// Same as build(), but DOES load the asset bundle (assets/template_assets.js) so
// assetSrc inlines images as data URIs — exactly how the app generates the HTML a
// user downloads. Used to prove the downloaded/standalone (file://) output has no
// relative `assets/X.png` srcs left to break once the HTML leaves the project folder.
function buildWithBundle(cfg, arts) {
  const ctx = {
    window: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelectorAll: () => [] },
    console, navigator: {},
  };
  ctx.window.document = ctx.document; ctx.window.navigator = ctx.navigator;
  ctx.window.App = ctx.window.App || {}; ctx.App = ctx.window.App;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/utils.js');
  load('assets/template_assets.js');
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  return ctx.window.App.NewsletterBuilder.build('gen_vishing', cfg, arts, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
}

const ART = [{ title: 'Fake bank fraud team calls staff to extract OTPs', type: 'Social Engineering', summary: 'Caller poses as the bank fraud desk and pressures victims to read a one-time code.' }];

test('gen_vishing builds its own template (not a poster fallback)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('data-template-id="gen_vishing"'), 'stamps its own template id');
  assert.ok(html.includes('Social Engineering'), 'heading changes to article type');
  assert.ok(html.includes('How to Spot'), 'shows "How to Spot" section label');
});

test('the 4 symbol icons render as raster <img> (Outlook/Gmail drop inline SVG)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  const mascotCount = (html.match(/Masco_character_pose2/g) || []).length;
  assert.equal(mascotCount, 4, 'mascot image appears 4 times (once per tip)');
  assert.ok(!/<svg/i.test(html), 'no inline <svg> in the email body');
});

test('AI-filled tips + intro are used when provided', () => {
  const tips = ['Do not be rushed by a caller claiming to be the bank', 'Urgency and authority are manipulation cues', 'Hang up and call the bank back on its official number', 'A panicked or scripted tone is a red flag'];
  const html = build({ portal: 'https://p.example.com', nlVishingIntro: 'A caller impersonating the bank fraud desk tries to extract your one-time codes.', nlVishingTips: tips }, ART);
  for (const t of tips) assert.ok(html.includes(t), `tip "${t.slice(0, 24)}…" is rendered`);
  assert.ok(html.includes('A caller impersonating the bank fraud desk'), 'AI intro is rendered');
});

test('falls back to sensible default tips + intro when no AI slots are present', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('take your time'), 'default tip 1 (take your time)');
  assert.ok(html.includes('emotional manipulation'), 'default tip 2 (emotional manipulation)');
  assert.ok(html.includes('verify the legitimacy'), 'default tip 3 (verify legitimacy)');
  assert.ok(html.includes('context and tone'), 'default tip 4 (context & tone)');
  assert.ok(/Voice Phishing/i.test(html), 'default vishing intro');
});

test('carries the hardcoded Report-to-SOC CTA and is Outlook-safe', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('mailto:soc-support@ab-inbev.com'), 'SOC mailto CTA present');
  assert.ok(html.includes('Report to SOC'), 'SOC CTA label present');
  assert.ok(!html.includes('background:rgba('), 'no rgba backgrounds (Word drops them)');
  assert.ok(!/border:\dpx solid rgba\(/.test(html), 'no rgba borders');
});

test('every image inlines as a data URI when the asset bundle is loaded (no broken images in a downloaded zip)', () => {
  const html = buildWithBundle({ portal: 'https://p.example.com' }, ART);
  // Any surviving relative `assets/X.png` src breaks once the standalone HTML is
  // opened outside the project folder (the symptom: the 4 tip icons not loading).
  const relative = html.match(/src="assets\/[^"]*"/g) || [];
  assert.deepEqual(relative, [], `all template images must be bundled as data URIs; missing from assets/template_assets.js: ${relative.join(', ')}`);
  // And the tip-icon image specifically is present and inlined.
  assert.ok(/src="data:image\/png;base64,/.test(html), 'tip icons render as inlined PNG data URIs');
});
