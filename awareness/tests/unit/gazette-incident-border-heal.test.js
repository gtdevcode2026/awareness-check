// The Cyber Gazette incident hero images used to ship a near-black 1px framing
// border (border:1px solid #0A0A0A). NEW builds drop it, but variant HTML frozen
// in a previously saved project keeps the black box until regenerated.
// App.Utils.stripGazetteIncidentImageBorder removes that exact border from stored
// HTML so restored Gazette projects lose the box too. The string is unique to that
// image style (no other template emits it), so the strip is safe to run globally.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');

function loadUtils() {
  const ctx = { window: {}, URL, Date, console, navigator: {} };
  ctx.window = ctx;
  ctx.App = ctx.window.App = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(rootDir, 'js/utils.js'), 'utf8'), ctx, { filename: 'js/utils.js' });
  return ctx.App.Utils;
}

// A realistic frozen incident <img> from an old Gazette render.
const FROZEN_IMG = '<img src="data:image/jpeg;base64,AAAA" alt="USB worm — image" width="232" style="display:block;width:232px;max-width:100%;height:auto;border:1px solid #0A0A0A;">';

test('stripGazetteIncidentImageBorder removes the black framing border from a frozen incident image', () => {
  const U = loadUtils();
  const out = U.stripGazetteIncidentImageBorder(FROZEN_IMG);
  assert.ok(!/border:1px solid #0A0A0A/i.test(out), 'the black border declaration is gone');
  assert.ok(out.includes('width:232px;max-width:100%;height:auto;'), 'the rest of the image style is preserved');
  assert.ok(out.includes('<img'), 'the image itself is preserved');
  assert.ok(!/;;/.test(out.replace(/data:[^"]*/, '')), 'no doubled semicolons left behind');
});

test('stripGazetteIncidentImageBorder is a safe no-op when there is no such border', () => {
  const U = loadUtils();
  const clean = '<img src="x" width="232" style="display:block;width:232px;max-width:100%;height:auto;">';
  assert.equal(U.stripGazetteIncidentImageBorder(clean), clean, 'already-clean HTML is unchanged');
  assert.equal(U.stripGazetteIncidentImageBorder(''), '', 'empty input unchanged');
});

test('stripGazetteIncidentImageBorder leaves other 1px borders alone', () => {
  const U = loadUtils();
  // A different border colour (used elsewhere) must survive — only the #0A0A0A box goes.
  const other = '<table style="border:1px solid #E8E3D8;"><tr><td>x</td></tr></table>';
  assert.equal(U.stripGazetteIncidentImageBorder(other), other, 'unrelated borders untouched');
});

test('stripGazetteIncidentImageBorder heals every incident image in one variant', () => {
  const U = loadUtils();
  const threeImgs = FROZEN_IMG + '\n' + FROZEN_IMG + '\n' + FROZEN_IMG;
  const out = U.stripGazetteIncidentImageBorder(threeImgs);
  assert.equal((out.match(/border:1px solid #0A0A0A/gi) || []).length, 0, 'all three incident borders removed');
});
