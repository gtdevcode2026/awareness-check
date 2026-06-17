// The poster flip-to-tip-theme feature: clicking a centred poster card in the
// home picker flips it to a small form where the user picks/types a tip THEME,
// which steers the AI tip copy at build time. index.html's renderPosterTipForm
// flips a card iff `item.tipSlots` is truthy, and that value comes straight from
// the catalog (js/newsletter_builder.js) — so the catalog's `tipSlots` field is
// the single source of truth for "this poster flips".
//
// This guards that invariant so the flip set can't silently drift: a poster that
// consumes the tip theme but loses its tipSlots would stop flipping (the original
// gen_security_digest bug), and a static replica that gained tipSlots would start
// showing a no-op theme form. Both are caught here.

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
  return Array.from(ctx.App.NewsletterBuilder.getTemplateCatalog(), (t) => ({
    id: t.id,
    status: t.status,
    tags: Array.isArray(t.tags) ? t.tags.slice() : [],
    tipSlots: t.tipSlots,
  }));
}

// Every poster onboarded to the poster sections that consumes the flip-form tip
// theme at build time (see fillNewsletterTextSlots in js/ai_summarizer.js), with
// its tip-box count. Keep this in lockstep with the catalog: onboard a flippable
// poster by adding tipSlots:N to its entry AND listing it here.
const EXPECTED_FLIP_SLOTS = {
  gen_strong_passwords: 3,
  gen_vishing: 4,
  gen_social_engineering: 3,
  gen_wifi_safety: 5,
  gen_horizontal_brief: 4,
  gen_security_digest: 4,
};

test('the flippable poster set (catalog tipSlots) is exactly the theme-consuming posters', () => {
  const withSlots = Object.fromEntries(
    catalog().filter((t) => t.tipSlots != null).map((t) => [t.id, t.tipSlots])
  );
  assert.deepEqual(withSlots, EXPECTED_FLIP_SLOTS);
});

test('every flippable poster is poster-tagged with a positive integer tipSlots', () => {
  const byId = new Map(catalog().map((t) => [t.id, t]));
  for (const [id, count] of Object.entries(EXPECTED_FLIP_SLOTS)) {
    const t = byId.get(id);
    assert.ok(t, `flippable poster "${id}" must exist in the catalog`);
    assert.ok(t.tags.includes('poster'), `"${id}" must carry the 'poster' tag to live in a poster section`);
    assert.ok(Number.isInteger(t.tipSlots) && t.tipSlots > 0, `"${id}" tipSlots must be a positive integer`);
  }
});

test('static design-replica posters do not flip (no tipSlots — theme is a no-op for them)', () => {
  // Static replicas render as-is and ignore the tip theme, so a flip form would
  // mislead. They must select normally instead of flipping.
  for (const t of catalog()) {
    if (t.tags.includes('poster') && t.tags.includes('static')) {
      assert.equal(t.tipSlots, undefined, `static replica "${t.id}" must not declare tipSlots`);
    }
  }
});
