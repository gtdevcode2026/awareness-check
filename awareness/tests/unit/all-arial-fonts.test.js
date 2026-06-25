// Brand requirement: every generated deliverable — newsletters, posters, AND
// advisory — must render in Arial only. No serif (Georgia / Times), Courier, or
// monospace may survive in any template builder or in the SVG illustration engine
// whose graphics are embedded into the posters.
//
// Two guards:
//   1. Source guard — no generated-output source file declares a non-Arial
//      font-family (so a stray Georgia/Courier literal can't be reintroduced,
//      even inside a ternary like `font-family:${hot ? "'Courier New'…" : …}`).
//   2. Build guard — the whole template catalog renders with zero non-Arial
//      font-family in the produced HTML.
//
// NB: the app's own chrome (index/editor/config use DM Sans / DM Serif / JetBrains
// Mono) is intentionally out of scope — that is the tool's UI, not a deliverable.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

// `sans-serif` is the only legitimate generic. Neutralise it, then any remaining
// serif/mono/named-serif family is a violation.
function nonArialHits(blob) {
  const cleaned = String(blob).replace(/sans-serif/gi, 'sans');
  return cleaned.match(/georgia|times new roman|\bcourier\b|monospace|dm serif|serif/gi) || [];
}

// The source files that produce generated deliverables (templates + the SVG
// graphics embedded in them). Advisory + static replicas already ship Arial-only;
// they are included so a regression there is caught too.
const OUTPUT_SOURCES = [
  'js/newsletter_builder.js',
  'js/newsletter/core_templates.js',
  'js/newsletter/bank_page.js',
  'js/newsletter/static_replicas_data.js',
  'js/graphics_engine.js',
];

function scanForNonArial(rel, text, offenders) {
  // Inspect a window after each `font-family` token so ternaries and SVG
  // attribute forms are both covered.
  const re = /font-family/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const win = text.slice(m.index, m.index + 80);
    const hits = nonArialHits(win);
    if (hits.length) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line} → ${hits.join(', ')}  «${win.slice(0, 60)}…»`);
    }
  }
}

test('no generated-output source declares a non-Arial font (source guard)', () => {
  const offenders = [];
  for (const rel of OUTPUT_SOURCES) {
    scanForNonArial(rel, readFileSync(path.join(rootDir, rel), 'utf8'), offenders);
  }
  assert.deepEqual(offenders, [], `non-Arial fonts must be removed:\n${offenders.join('\n')}`);
});

// The editor's Add-panel ELEMS/SECTIONS preset blocks are inserted INTO the
// newsletter and exported, so they must be Arial too. (The editor's own chrome —
// e.g. the Replace-image modal — intentionally keeps its DM Sans/DM Serif UI font
// and is excluded by scanning only the two preset-block array literals.)
test('editor Add-panel preset blocks are Arial-only', () => {
  const src = readFileSync(path.join(rootDir, 'js/editor.js'), 'utf8');
  const offenders = [];
  for (const name of ['ELEMS', 'SECTIONS']) {
    const start = src.indexOf(`const ${name} = [`);
    assert.ok(start >= 0, `editor.js must still define ${name} (preset blocks)`);
    const block = src.slice(start, src.indexOf('];', start));
    scanForNonArial(`js/editor.js (${name})`, block, offenders);
  }
  assert.deepEqual(offenders, [], `editor preset blocks must be Arial:\n${offenders.join('\n')}`);
});

// ── Build guard: render the whole catalog and scan the HTML ──
function createContext() {
  const context = {
    window: {}, URL, Date, console, setTimeout, clearTimeout,
    navigator: { hardwareConcurrency: 4 }, performance: { now: () => 0 },
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {}, fmtDate(v) { return v || ''; },
      stripTags(v) { return String(v || '').replace(/<[^>]*>/g, ''); },
      truncate(v, n) { return String(v || '').slice(0, n); },
      normalizeWebUrl(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
        return `https://${s.replace(/^\/+/, '')}`;
      },
    },
    // Real SVG engine so the illustration fonts are scanned in context.
    Graphics: {},
  };
  return vm.createContext(context);
}

function buildEveryTemplate() {
  const context = createContext();
  const load = (rel) => vm.runInContext(readFileSync(path.join(rootDir, rel), 'utf8'), context, { filename: rel });
  load('js/graphics_engine.js');
  // Backfill any helper a template calls that the real engine doesn't expose, so
  // no template silently throws and gets skipped.
  context.App.Graphics = new Proxy(context.App.Graphics, { get: (t, p) => (p in t ? t[p] : () => '<svg/>') });
  load('js/feed_scoring.js');
  load('js/rss_fetcher.js');
  load('js/newsletter_builder.js');
  load('js/newsletter/bank_page.js');
  load('js/newsletter/core_templates.js');
  const NB = context.App.NewsletterBuilder;
  const cfg = { org: 'ACME', soc: 'soc@acme.test', freq: 'Weekly', portal: 'https://portal.example', pname: 'Portal' };
  const arts = [{ type: 'Phishing', title: 'T', summary: 'S', source: 'X', url: 'https://x/s', pubDate: '2026-05-23', threatLevel: 3 }];
  const opts = { useLinks: false, usePoster: false, useQR: true, useIllus: true };
  return NB.getTemplateCatalog().map((t) => {
    let html = '';
    try { html = NB.build(t.id, cfg, arts, opts); } catch (e) { html = `BUILD_ERROR: ${e.message}`; }
    return { id: t.id, html };
  });
}

test.describe('every template renders Arial-only (build guard)', () => {
  for (const { id, html } of buildEveryTemplate()) {
    if (html.startsWith('BUILD_ERROR')) {
      test(`${id} builds without error`, () => assert.fail(`${id} failed to build: ${html}`));
      continue;
    }
    test(`${id} has no non-Arial font-family in its rendered HTML`, () => {
      const fams = (html.match(/font-family\s*[:=]\s*("[^"]*"|'[^']*'|[^;">]+)/gi) || []);
      const bad = fams.filter((f) => nonArialHits(f).length);
      assert.deepEqual(bad, [], `${id} rendered non-Arial fonts: ${bad.join(' | ')}`);
    });
  }
});
