// The home picker (index.html) groups templates by `status`: 'ready' templates
// fill the Newsletter/Poster sliders up front; everything else is tucked behind
// the collapsible Beta slider. The single source of truth is READY_TEMPLATE_IDS
// in js/newsletter_builder.js. This guards the onboarded Ready set so a future
// edit can't silently demote a shipped template back into Beta.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function catalog() {
  const ctx = { window: {}, URL, Date, console, navigator: { hardwareConcurrency: 4 } };
  ctx.window = ctx;
  ctx.App = { Utils: { log() {}, stripTags: (v) => String(v || '') }, Graphics: {} };
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), ctx, { filename: rel });
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  // Array.from rehomes the vm-realm catalog into host-realm objects so
  // deepStrictEqual compares by value, not by cross-realm prototype identity.
  return Array.from(ctx.App.NewsletterBuilder.getTemplateCatalog(), (t) => ({ id: t.id, status: t.status }));
}

// The full onboarded Ready set: the 3 originals + the newly promoted bulletins
// + the Cyber Gazette broadsheet + the Advisory template type.
const READY_IDS = [
  'poster', 'bankpage1_static', 'bankpage1_dynamic',
  'newspaper',
  'gen_chase_email', 'gen_cybershield', 'gen_strong_passwords', 'gen_vishing',
  'gen_social_engineering',
  'gen_wifi_safety',
  'gen_horizontal_brief',
  'gen_security_digest',
  'advisory',
];

test('every onboarded template is marked status:"ready"', () => {
  const byId = new Map(catalog().map((t) => [t.id, t]));
  for (const id of READY_IDS) {
    const t = byId.get(id);
    assert.ok(t, `template "${id}" must exist in the catalog`);
    assert.equal(t.status, 'ready', `template "${id}" must be Ready (shown up front in the picker)`);
  }
});

test('the Ready set is exactly these — no accidental extras', () => {
  const ready = catalog().filter((t) => t.status === 'ready').map((t) => t.id).sort();
  assert.deepEqual(ready, READY_IDS.slice().sort());
});

test('chase, Phishing Maestro, and Strong Passwords are no longer Beta', () => {
  const byId = new Map(catalog().map((t) => [t.id, t]));
  for (const id of ['gen_chase_email', 'gen_cybershield', 'gen_strong_passwords']) {
    assert.notEqual(byId.get(id).status, 'beta', `"${id}" must not be Beta anymore`);
  }
});
