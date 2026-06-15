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

test('the lock feature is removed (no LOCKED badge, no lockToggle case)', () => {
  assert.ok(!/LOCKED/.test(fnSrc), 'iframe script must not render a LOCKED badge');
  assert.ok(!/lockToggle/.test(fnSrc), "iframe script must not handle a 'lockToggle' message");
  const editorSrc = readFileSync(path.join(rootDir, 'js/editor.js'), 'utf8');
  assert.ok(!/_lockToggle/.test(editorSrc), 'editor.js must not expose a lock toggle');
  assert.ok(!/Lock or unlock/.test(editorSrc), 'editor.js must not render the Lock button');
});
