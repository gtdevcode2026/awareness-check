// Editor "Image Size" control seam. Selecting an <img> and dragging the Image
// Size slider posts an 'imgSize' message; the iframe resizes the image
// PROPORTIONALLY (keeps aspect ratio from the natural dimensions) and stays
// email-safe by writing BOTH the inline style and the width/height attributes
// (Outlook honours the attributes, ignores style width). This guards both halves
// of the parent <-> iframe contract so a refactor can't silently drop either.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');

function iframeSrc() {
  const ctx = { window: {}, console };
  ctx.window = ctx;
  ctx.App = {};
  vm.createContext(ctx);
  vm.runInContext(
    readFileSync(path.join(rootDir, 'js/editor/iframe_script.js'), 'utf8'),
    ctx,
    { filename: 'js/editor/iframe_script.js' }
  );
  return ctx.App.EditorIframeScript.fn.toString();
}

test('iframe handles the imgSize message and resizes proportionally + email-safe', () => {
  const src = iframeSrc();
  assert.ok(src.includes("case 'imgSize'"), "iframe must handle the 'imgSize' message");
  // Aspect ratio derived from the image's natural dimensions.
  assert.ok(/naturalWidth/.test(src) && /naturalHeight/.test(src), 'derives height from the natural aspect ratio');
  // Email-safe: write the width AND height attributes, not just the style.
  assert.ok(/setAttribute\(\s*['"]width['"]/.test(src), 'writes the width attribute (Outlook honours it)');
  assert.ok(/setAttribute\(\s*['"]height['"]/.test(src), 'writes the height attribute (Outlook honours it)');
});

test('imgSize resizes the selected image proportionally + email-safe (real handler in jsdom)', async () => {
  const fnSrc = readFileSync(path.join(rootDir, 'js/editor/iframe_script.js'), 'utf8');
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><img id="t" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="200" height="100"></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true }
  );
  const { window } = dom;
  // Mount the REAL iframe controller in the jsdom window — its bare globals
  // (document/window/parent/getComputedStyle) resolve to this window.
  const s = window.document.createElement('script');
  s.textContent = fnSrc + '\n;(window.App.EditorIframeScript.fn)();';
  window.document.body.appendChild(s);

  const img = window.document.getElementById('t');
  // jsdom doesn't decode images, so stub the intrinsic 2:1 ratio.
  Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });

  // Select the image (the iframe's click handler sets its internal _sel).
  img.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // Drive the resize. Parent → iframe envelope is { _nlEd, cmd, v }, accepted
  // only when e.source === window.parent (in a jsdom top window, parent === window).
  // jsdom's window.postMessage drops source to null, so dispatch the event with
  // source set explicitly — exactly what the real parent→iframe post delivers.
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { _nlEd: true, cmd: 'imgSize', v: 120 },
    source: window,
  }));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.equal(img.getAttribute('width'), '120', 'width attribute set to the target width');
  assert.equal(img.getAttribute('height'), '60', 'height attribute keeps the 2:1 aspect ratio (no squish)');
  assert.equal(img.style.width, '120px', 'inline style width set');
  assert.equal(img.style.height, '60px', 'inline style height set proportionally');
});

test('editor parent wires the Image Size control to the imgSize command', () => {
  const editorSrc = readFileSync(path.join(rootDir, 'js/editor.js'), 'utf8');
  assert.ok(editorSrc.includes("_post('imgSize'"), 'parent posts the imgSize command');
  assert.ok(editorSrc.includes('id="ed-prop-imgsize"'), 'panel renders the Image Size block');
  assert.ok(editorSrc.includes('App.Editor._setImgWidth'), 'the slider/number call _setImgWidth');
  // _setImgWidth must be on the public API object the inline handlers reach.
  assert.ok(/\b_setImgWidth\b[\s\S]{0,4000}return\s*\{[\s\S]*_setImgWidth/.test(editorSrc)
    || /return\s*\{[\s\S]*_setImgWidth/.test(editorSrc), 'parent exposes _setImgWidth on App.Editor');
});
