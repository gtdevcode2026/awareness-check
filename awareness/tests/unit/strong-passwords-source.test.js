// gen_strong_passwords poster — a source line sits directly under the heading
// (the article title). It shows "Source: <article source>", linked to the article
// URL when links are enabled, and is omitted entirely when the article has no
// source. These tests render the template and assert that behaviour + placement.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function build(cfg, arts, opts) {
  const ctx = {
    window: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelectorAll: () => [] },
    console, navigator: {},
  };
  ctx.window.document = ctx.document; ctx.window.navigator = ctx.navigator;
  ctx.window.App = ctx.window.App || {}; ctx.App = ctx.window.App;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/utils.js');
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  const o = Object.assign({ useLinks: false, usePoster: false, useQR: false, useIllus: false }, opts || {});
  return ctx.window.App.NewsletterBuilder.build('gen_strong_passwords', cfg, arts, o);
}

const ART = [{
  title: 'Create a strong, unique password for every account',
  type: 'Password & MFA',
  source: 'KnowBe4 Blog',
  url: 'https://blog.knowbe4.com/strong-passwords',
  summary: 'Reused passwords let one breach unlock many accounts.',
}];

test('shows the article source under the heading (plain text when links are off)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART, { useLinks: false });
  assert.ok(html.includes('Source: KnowBe4 Blog'), 'renders "Source: <source>"');
  assert.ok(!html.includes('href="https://blog.knowbe4.com/strong-passwords"'), 'no link when links are off');
});

test('links the source to the article URL when links are on', () => {
  const html = build({ portal: 'https://p.example.com' }, ART, { useLinks: true });
  assert.ok(html.includes('href="https://blog.knowbe4.com/strong-passwords"'), 'source links to the article');
  assert.ok(html.includes('>KnowBe4 Blog</a>'), 'the source label is the link text');
});

test('the source line sits below the heading and above the hero image', () => {
  const html = build({ portal: 'https://p.example.com' }, ART, { useLinks: false });
  const iHeading = html.indexOf('Create a strong, unique password for every account');
  const iSource = html.indexOf('Source: KnowBe4 Blog');
  const iHero = html.indexOf('strong_passwords_hero');
  assert.ok(iHeading >= 0 && iSource > iHeading, 'source appears after the heading');
  assert.ok(iHero > iSource, 'source appears above the hero image');
});

test('every anchor in the poster declares the Arial font (uniform font across the template, incl. Outlook which resets anchors to serif)', () => {
  const html = build({ portal: 'https://p.example.com' }, ART, { useLinks: true });
  const anchors = html.match(/<a\b[^>]*>/gi) || [];
  assert.ok(anchors.length >= 3, 'has the source, CTA, and Visit Portal anchors');
  for (const a of anchors) {
    assert.ok(/font-family\s*:\s*Arial/i.test(a), `anchor missing Arial font-family: ${a}`);
  }
});

test('omits the source line entirely when the article has no source', () => {
  const html = build({ portal: 'https://p.example.com' }, [{ title: 'Strong passwords matter', type: 'Password & MFA' }], { useLinks: true });
  assert.ok(!html.includes('Source:'), 'no "Source:" label when the article has no source');
});
