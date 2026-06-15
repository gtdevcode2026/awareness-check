// gen_social_engineering is now a DYNAMIC, email-safe template (was a static
// replica). The user selects one article; the social-engineering ensemble fills
// c.nlSocEngIntro (the black-hero threat intro) and c.nlSocEngRedFlags (3 "red
// flags of this attack"). The builder recreates the black-hero poster as
// Outlook-safe tables: attack-type headline from article.type, the line-art hero
// figure, three raster red-flag rows, the hardcoded Report-to-SOC CTA, and the
// config-driven portal/QR footer (data-qr-size="90").

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
  // to readable relative paths ('assets/redflag_ico.png') so the icon-source
  // assertions can see the filenames (the bundle would inline opaque data URIs).
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  return ctx.window.App.NewsletterBuilder.build('gen_social_engineering', cfg, arts, { useLinks: false, usePoster: false, useQR: false, useIllus: false });
}

const ART = [{ title: 'Attackers impersonate IT to talk staff out of MFA codes', type: 'Phishing', summary: 'A caller posing as the helpdesk pressures employees to read back one-time codes.' }];

test('gen_social_engineering builds its own template (not a poster fallback)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('data-template-id="gen_social_engineering"'), 'stamps its own template id');
  assert.ok(html.includes('>Phishing<'), 'headline becomes the article attack type');
  assert.ok(html.includes('assets/social_engineering_hero.png'), 'renders the line-art hero figure');
});

test('the headline falls back to "Scams & Social Engineering" when the article has no type', () => {
  const html = build({ portal: 'https://p.example.com' }, [{ title: 'Untyped story', summary: 'No type set.' }]);
  assert.ok(html.includes('Scams &amp; Social Engineering'), 'fallback headline present');
});

test('the 3 red-flag icons render as raster <img> (Outlook/Gmail drop inline SVG)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  const iconCount = (html.match(/redflag_ico\.png/g) || []).length;
  assert.equal(iconCount, 3, 'red-flag icon appears 3 times (once per row)');
  assert.ok(!/<svg/i.test(html), 'no inline <svg> in the email body');
});

test('AI-filled intro + 3 red flags are used when provided', () => {
  const flags = [
    'A caller claiming to be IT who wants your one-time code right now.',
    'Pressure to act before you can verify who is really calling.',
    'A request for access or codes that bypasses the normal helpdesk process.'
  ];
  const html = build({ portal: 'https://p.example.com', nlSocEngIntro: 'Attackers phone staff pretending to be IT support to talk them out of their login codes.', nlSocEngRedFlags: flags }, ART);
  for (const f of flags) assert.ok(html.includes(f), `red flag "${f.slice(0, 24)}…" is rendered`);
  assert.ok(html.includes('Attackers phone staff pretending to be IT support'), 'AI intro is rendered');
});

test('falls back to sensible default intro + red flags when no AI slots are present', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('Unfortunately, social engineering is used to craft clever scams'), 'default intro');
  assert.ok(html.includes('Pressure built on urgency, authority, or secrecy'), 'default red flag 1');
  assert.ok(html.includes('access you would not normally hand over'), 'default red flag 2');
  assert.ok(html.includes('Contact you were not expecting'), 'default red flag 3');
});

test('footer reads portal from config and the QR cell is sized 90x90', () => {
  const html = build({ portal: 'https://portal.example.com', pname: 'ACME Security Hub' }, ART);
  assert.ok(html.includes('ACME Security Hub'), 'portal name pulled from cfg.pname');
  assert.ok(html.includes('href="https://portal.example.com"'), 'Visit Portal link pulled from cfg.portal');
  assert.ok(html.includes('id="nl-qr" data-qr-size="90"'), 'QR cell carries data-qr-size=90');
});

test('carries the hardcoded Report-to-SOC CTA and is Outlook-safe', () => {
  const html = build({ portal: 'https://p.example.com' }, ART);
  assert.ok(html.includes('mailto:soc-support@ab-inbev.com'), 'SOC mailto CTA present');
  assert.ok(html.includes('Report to SOC'), 'SOC CTA label present');
  assert.ok(!html.includes('background:rgba('), 'no rgba backgrounds (Word drops them)');
  assert.ok(!/border:\dpx solid rgba\(/.test(html), 'no rgba borders');
});
