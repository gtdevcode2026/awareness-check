// The 7 static "design replica" posters used to fetch() their HTML from a
// sibling file. fetch() of a local file is blocked under the file:// protocol,
// so opening the app by double-clicking index.html from a zip left every static
// poster stuck on the "Loading static template…" notice. The fix inlines the
// HTML into js/newsletter/static_replicas_data.js and seeds the builder cache
// from it, so build() renders the poster synchronously with no network.
//
// This test proves the render path works WITHOUT a successful fetch — the fetch
// stub below always rejects, exactly like a browser under file://.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function buildStaticReplica(id) {
  const ctx = {
    window: {}, URL, Date, console,
    navigator: { hardwareConcurrency: 4 },
    // Simulate file://: every local fetch is blocked. The poster must still render.
    fetch: () => Promise.reject(new Error('file:// blocks local fetch')),
  };
  ctx.window = ctx;
  ctx.App = {
    Utils: { log() {}, stripTags: (v) => String(v || ''), normalizeWebUrl: (v) => String(v || '') },
    Graphics: {},
  };
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  load('js/newsletter/static_replicas_data.js'); // inlined poster HTML (no fetch)
  load('js/newsletter/static_replicas.js');
  return ctx.App.NewsletterBuilder.build(
    id,
    { portal: 'https://portal.example.com' },
    [],
    { useLinks: false, usePoster: false, useQR: false, useIllus: false }
  );
}

test('a static replica renders inline (no fetch) — works from a zip via file://', () => {
  const html = buildStaticReplica('gen_phonescam');
  assert.ok(!html.includes('Loading static template'), 'must NOT fall back to the loading placeholder');
  assert.ok(html.includes('<iframe'), 'poster renders inside an isolated iframe');
  assert.ok(html.includes('srcdoc='), 'iframe carries the inlined poster as srcdoc');
});

test('all 5 static replicas are inlined and render without fetch', () => {
  const ids = [
    'gen_phonescam', 'gen_right_message',
    'gen_spear_phishing', 'gen_weakest_link', 'gen_wifi_safety',
  ];
  for (const id of ids) {
    const html = buildStaticReplica(id);
    assert.ok(!html.includes('Loading static template'), `"${id}" must render inline, not the loading placeholder`);
    assert.ok(html.includes(`data-template-id="${id}"`), `"${id}" stamps its own template id`);
  }
});
