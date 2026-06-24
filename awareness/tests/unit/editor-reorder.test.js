// Editor reorder seam. The Up / Down / Drag controls must move the block the
// user actually selected — at WHATEVER granularity they clicked:
//   - an individual bullet row (gold-dot OR icon-based) moves among its siblings,
//   - a horizontal "card" (a TD in a multi-cell row) shifts among its cells,
//   - a whole SECTION band moves when section-level text is selected.
// The old resolver only handled the narrow gold-dot bullet row; every other
// structure silently no-op'd. This guards the fixed resolution end-to-end by
// running the REAL iframe controller in jsdom and driving the move messages.
//
// It also guards that the "lock" feature is gone: no LOCKED badge, no lockToggle.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');
const fnSrc = readFileSync(path.join(rootDir, 'js/editor/iframe_script.js'), 'utf8');

// Mount the real iframe controller in a jsdom window, select #selectId, send the
// move command, and return the document order of [data-row] markers before/after.
function runMove(bodyHtml, selectId, cmd) {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = fnSrc + '\n;(window.App.EditorIframeScript.fn)();';
  window.document.body.appendChild(s);
  const order = () => Array.from(window.document.querySelectorAll('[data-row]'))
    .map((n) => n.getAttribute('data-row')).join(',');
  const before = order();
  window.document.getElementById(selectId).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  window.dispatchEvent(new window.MessageEvent('message', { data: { _nlEd: true, cmd }, source: window }));
  return { before, after: order() };
}

test('moveUp reorders an ICON-based bullet row among its siblings', () => {
  const html = '<table><tbody>'
    + '<tr data-row="A"><td><img src="x"></td><td><div id="a">Red flag A</div></td></tr>'
    + '<tr data-row="B"><td><img src="x"></td><td><div id="b">Red flag B</div></td></tr>'
    + '<tr data-row="C"><td><img src="x"></td><td><div id="c">Red flag C</div></td></tr>'
    + '</tbody></table>';
  const { before, after } = runMove(html, 'b', 'moveUp');
  assert.equal(before, 'A,B,C');
  assert.equal(after, 'B,A,C', 'icon bullet row B should move above A');
});

test('gold-dot bullet rows still reorder (no regression)', () => {
  const html = '<table><tbody>'
    + '<tr data-row="A"><td><div>&bull;</div></td><td><div id="a">Item A</div></td></tr>'
    + '<tr data-row="B"><td><div>&bull;</div></td><td><div id="b">Item B</div></td></tr>'
    + '<tr data-row="C"><td><div>&bull;</div></td><td><div id="c">Item C</div></td></tr>'
    + '</tbody></table>';
  const { after } = runMove(html, 'b', 'moveUp');
  assert.equal(after, 'B,A,C');
});

test('moveDown reorders a SECTION band when nested section text is selected', () => {
  const html = '<table><tbody>'
    + '<tr data-row="HERO"><td><div id="hero">Hero headline</div></td></tr>'
    + '<tr data-row="BODY"><td><table><tbody><tr><td><div id="body">Body section text</div></td></tr></tbody></table></td></tr>'
    + '<tr data-row="FOOT"><td><div id="foot">Footer</div></td></tr>'
    + '</tbody></table>';
  const { before, after } = runMove(html, 'body', 'moveDown');
  assert.equal(before, 'HERO,BODY,FOOT');
  assert.equal(after, 'HERO,FOOT,BODY', 'the whole BODY section band should move below FOOT');
});

test('moveUp shifts a horizontal CARD among its cells', () => {
  const html = '<table><tbody><tr>'
    + '<td data-row="T1"><div id="t1">Tip 1</div></td>'
    + '<td data-row="T2"><div id="t2">Tip 2</div></td>'
    + '<td data-row="T3"><div id="t3">Tip 3</div></td>'
    + '</tr></tbody></table>';
  const { after } = runMove(html, 't2', 'moveUp');
  assert.equal(after, 'T2,T1,T3', 'card T2 should shift before T1');
});

test('reorder skips invisible spacer rows between sections', () => {
  const html = '<table><tbody>'
    + '<tr data-row="ONE"><td><div id="one">Section one</div></td></tr>'
    + '<tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>'
    + '<tr data-row="TWO"><td><div id="two">Section two</div></td></tr>'
    + '</tbody></table>';
  const { after } = runMove(html, 'one', 'moveDown');
  assert.equal(after, 'TWO,ONE', 'section ONE should leapfrog the spacer and land below TWO');
});

// A spacer row creates the GAP between two sections. When the content row
// leapfrogs it, the spacer must stay between the two sections — it must NOT
// strand against the section's top/bottom edge, which renders as extra
// padding once a block reaches the edge. The spacer carries data-row="SP" so
// the order signature exposes exactly where it lands.
test('moveDown keeps the spacer BETWEEN sections, not stranded at the bottom edge', () => {
  const html = '<table><tbody>'
    + '<tr data-row="ONE"><td><div id="one">Section one</div></td></tr>'
    + '<tr data-row="SP"><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>'
    + '<tr data-row="TWO"><td><div id="two">Section two</div></td></tr>'
    + '</tbody></table>';
  const { after } = runMove(html, 'one', 'moveDown');
  assert.equal(after, 'TWO,SP,ONE', 'the spacer must stay between TWO and ONE, not strand below ONE');
});

test('moveUp keeps the spacer BETWEEN sections, not stranded at the top edge', () => {
  const html = '<table><tbody>'
    + '<tr data-row="ONE"><td><div id="one">Section one</div></td></tr>'
    + '<tr data-row="SP"><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>'
    + '<tr data-row="TWO"><td><div id="two">Section two</div></td></tr>'
    + '</tbody></table>';
  const { after } = runMove(html, 'two', 'moveUp');
  assert.equal(after, 'TWO,SP,ONE', 'TWO moves up past the spacer; the spacer stays between TWO and ONE');
});

// Bank-page bullet lists DON'T use spacer rows — each bullet carries its
// vertical spacing on its own cell: 6px between bullets, 24px on the LAST
// bullet to gap off the next section. That trailing gap belongs to the SLOT,
// not the row. Reordering a bullet must not drag the 24px into the middle of
// the list (which renders as the "extra padding" the user reported). The real
// row shape is reproduced: outer <tr> → padded <td> → nested bullet table.
function runBulletMove(rows, selectId, cmd) {
  const body = '<table><tbody>' + rows.map((r) =>
    `<tr data-row="${r.id}"><td style="padding:0 0 ${r.pad};">`
    + `<table><tbody><tr><td><div style="color:#D4A420">&bull;</div></td>`
    + `<td><div id="${r.id}">Bullet ${r.id}</div></td></tr></tbody></table>`
    + `</td></tr>`).join('') + '</tbody></table>';
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + body + '</body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = fnSrc + '\n;(window.App.EditorIframeScript.fn)();';
  window.document.body.appendChild(s);
  window.document.getElementById(selectId).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  window.dispatchEvent(new window.MessageEvent('message', { data: { _nlEd: true, cmd }, source: window }));
  return Array.from(window.document.querySelectorAll('[data-row]')).map((tr) =>
    ({ id: tr.getAttribute('data-row'), pad: tr.firstElementChild.style.paddingBottom }));
}

test('moving the LAST bullet up keeps the 24px section gap on the bottom row', () => {
  const after = runBulletMove(
    [{ id: 'one', pad: '6px' }, { id: 'two', pad: '6px' }, { id: 'three', pad: '6px' }, { id: 'four', pad: '24px' }],
    'four', 'moveUp');
  assert.deepEqual(after.map((r) => r.id), ['one', 'two', 'four', 'three'], 'bullet four leapfrogs three');
  assert.deepEqual(after.map((r) => r.pad), ['6px', '6px', '6px', '24px'],
    'the section-gap padding stays on the bottom row — no 24px stranded mid-list');
});

test('moving a bullet down to the bottom keeps the 24px section gap on the bottom row', () => {
  const after = runBulletMove(
    [{ id: 'one', pad: '6px' }, { id: 'two', pad: '6px' }, { id: 'three', pad: '6px' }, { id: 'four', pad: '24px' }],
    'three', 'moveDown');
  assert.deepEqual(after.map((r) => r.id), ['one', 'two', 'four', 'three'], 'bullet three moves below four');
  assert.deepEqual(after.map((r) => r.pad), ['6px', '6px', '6px', '24px'],
    'padding is positional: the bottom row keeps 24px even though three is now last');
});

// Whole-section move (Hybrid). A bank-page "section" is a gold heading <p> plus
// the bullets <table> that follows it — two loose siblings in the content cell,
// no wrapper. Ctrl-selecting the heading + its points and pressing Up/Down must
// move the ENTIRE section and swap it with the adjacent section. The fixture
// mirrors the real DOM: content cell → [image table, <p>, bullets table, <p>,
// bullets table], each bullet an outer <tr> → padded <td> → nested dot+text.
// Shared fixture: content cell → [image table, heading, bullets table, heading,
// bullets table], each bullet a real outer <tr> → padded <td> → nested dot+text.
function sectionedBody() {
  const bullet = (id, pad) =>
    `<tr><td style="padding:0 0 ${pad};"><table><tbody><tr>`
    + `<td><div>&bull;</div></td><td><div id="${id}">${id}</div></td>`
    + `</tr></tbody></table></td></tr>`;
  return '<table><tbody><tr><td id="content">'
    + '<table data-sec="IMG"><tbody><tr><td><img src="x"></td></tr></tbody></table>'
    + '<p id="h1" style="font-weight:700">How to spot</p>'
    + `<table data-sec="SEC1"><tbody>${bullet('a1', '6px') + bullet('a2', '6px') + bullet('a3', '24px')}</tbody></table>`
    + '<p id="h2" style="font-weight:700">Impact</p>'
    + `<table data-sec="SEC2"><tbody>${bullet('b1', '6px') + bullet('b2', '24px')}</tbody></table>`
    + '</td></tr></tbody></table>';
}

function runSectionMove(selectIds, cmd) {
  const body = sectionedBody();
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + body + '</body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = fnSrc + '\n;(window.App.EditorIframeScript.fn)();';
  window.document.body.appendChild(s);
  // First id is a plain click; the rest are Ctrl-clicks (additive multi-select).
  selectIds.forEach((id, i) => {
    window.document.getElementById(id).dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, ctrlKey: i > 0 }));
  });
  window.dispatchEvent(new window.MessageEvent('message', { data: { _nlEd: true, cmd }, source: window }));
  const content = window.document.getElementById('content');
  return Array.from(content.children).map((el) =>
    (el.tagName === 'P' ? el.id : el.getAttribute('data-sec')));
}

test('Ctrl-selecting a section (heading + points) + Down swaps it with the section below', () => {
  const order = runSectionMove(['h1', 'a1', 'a2', 'a3'], 'moveDown');
  assert.deepEqual(order, ['IMG', 'h2', 'SEC2', 'h1', 'SEC1'],
    'the whole How-to-spot section moves below the Impact section');
});

test('Ctrl-selecting a section + Up swaps it with the section above', () => {
  const order = runSectionMove(['h2', 'b1', 'b2'], 'moveUp');
  assert.deepEqual(order, ['IMG', 'h2', 'SEC2', 'h1', 'SEC1'],
    'the whole Impact section moves above How-to-spot');
});

test('section move still works when points were removed (only some selected)', () => {
  const order = runSectionMove(['h1', 'a1'], 'moveDown');
  assert.deepEqual(order, ['IMG', 'h2', 'SEC2', 'h1', 'SEC1'],
    'a section with fewer selected points still swaps as a whole');
});

test('top section + Up is a silent no-op (no section above the hero image)', () => {
  const order = runSectionMove(['h1', 'a1', 'a2', 'a3'], 'moveUp');
  assert.deepEqual(order, ['IMG', 'h1', 'SEC1', 'h2', 'SEC2'], 'nothing moves above the image');
});

test('Ctrl-selecting two bullets (no heading) does NOT trigger a section move', () => {
  const order = runSectionMove(['a1', 'a2'], 'moveDown');
  assert.deepEqual(order, ['IMG', 'h1', 'SEC1', 'h2', 'SEC2'],
    'a homogeneous bullet selection falls through to per-block; section order unchanged');
});

// Single-selecting a heading (no Ctrl) and pressing Up/Down must NOT move it —
// moving just the heading would tear it off its points and mangle the layout.
// Instead the iframe posts a 'sectionHint' so the parent alerts the user to
// Ctrl-select the heading + its points to move the whole section.
function runSingleSelectMove(selectId, cmd) {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + sectionedBody() + '</body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = fnSrc + '\n;(window.App.EditorIframeScript.fn)();';
  window.document.body.appendChild(s);
  const posts = [];
  window.postMessage = (data) => { posts.push(data); };  // capture parent.postMessage synchronously
  window.document.getElementById(selectId).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  window.dispatchEvent(new window.MessageEvent('message', { data: { _nlEd: true, cmd }, source: window }));
  const content = window.document.getElementById('content');
  const order = Array.from(content.children).map((el) =>
    (el.tagName === 'P' ? el.id : el.getAttribute('data-sec')));
  return { order, posts };
}

test('single-clicking a heading + Up leaves the template untouched and hints to use Ctrl', () => {
  const { order, posts } = runSingleSelectMove('h1', 'moveUp');
  assert.deepEqual(order, ['IMG', 'h1', 'SEC1', 'h2', 'SEC2'], 'no section/band is moved');
  assert.ok(posts.some((p) => p && p.type === 'sectionHint'), 'a hint to use Ctrl is posted');
});

test('single-clicking a heading + Down also hints instead of mangling the layout', () => {
  const { order, posts } = runSingleSelectMove('h1', 'moveDown');
  assert.deepEqual(order, ['IMG', 'h1', 'SEC1', 'h2', 'SEC2'], 'no section/band is moved');
  assert.ok(posts.some((p) => p && p.type === 'sectionHint'), 'a hint to use Ctrl is posted');
});

test('single-clicking a normal block (a bullet) still moves it, with no hint', () => {
  const { posts } = runSingleSelectMove('a1', 'moveDown');
  assert.ok(!posts.some((p) => p && p.type === 'sectionHint'), 'no hint for an ordinary block move');
});

test('the lock feature is removed (no LOCKED badge, no lockToggle case)', () => {
  assert.ok(!/LOCKED/.test(fnSrc), 'iframe script must not render a LOCKED badge');
  assert.ok(!/lockToggle/.test(fnSrc), "iframe script must not handle a 'lockToggle' message");
  const editorSrc = readFileSync(path.join(rootDir, 'js/editor.js'), 'utf8');
  assert.ok(!/_lockToggle/.test(editorSrc), 'editor.js must not expose a lock toggle');
  assert.ok(!/Lock or unlock/.test(editorSrc), 'editor.js must not render the Lock button');
});
