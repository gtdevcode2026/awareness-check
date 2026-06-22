/* ═══════════════════════════════════════════════════════════
   editor/iframe_script.js — IFRAME INJECTED SCRIPT
   Serialised via .toString() — executes inside the editor iframe.
   No outer-scope references; communicates with the parent via
   postMessage. Loaded before js/editor.js, which reads the function
   off App.EditorIframeScript.fn and serialises it into the iframe srcdoc.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  W.App = W.App || {};

  const fn = function () {
    var _sel = null, _edEl = null, _dragEl = null, _dropLine = null, _hoverEl = null, _insideTarget = null;
    // Extra wrappers (shift-multi) that should land beside _dragEl on drop.
    var _dragEntourage = [];
    var _selSet = new Set();

    function post(t, d) {
      try { parent.postMessage(Object.assign({ _nlEd: true, type: t }, d || {}), '*'); } catch (e) {}
      // Selection changed → refresh the Excel-style image resize handles. Single
      // chokepoint: every select/deselect routes through post(), so the overlay
      // tracks the current <img> without instrumenting each selection path.
      if (t === 'select' || t === 'deselect') { try { updateResizeHandles(); } catch (e) {} }
    }

    function rgb2hex(s) {
      if (!s || s === 'transparent' || s.indexOf('rgba(0, 0, 0, 0)') !== -1) return '';
      var m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return s.charAt(0) === '#' ? s : '';
      return '#' + [m[1], m[2], m[3]].map(function (v) { return (+v).toString(16).padStart(2, '0'); }).join('');
    }

    function getProps(el) {
      if (!el) return {};
      var cs = window.getComputedStyle(el);
      var fw = el.style.fontWeight || cs.fontWeight;
      var rect = el.getBoundingClientRect();
      var fullText = el.textContent || '';
      // For <img>, also report intrinsic dimensions so the parent can decide
      // whether the Replace-image button should be enabled (hero-image threshold).
      var imgWidth = 0, imgHeight = 0;
      if (el.tagName === 'IMG') {
        imgWidth = el.naturalWidth || el.clientWidth || parseInt(el.getAttribute('width'), 10) || 0;
        imgHeight = el.naturalHeight || el.clientHeight || parseInt(el.getAttribute('height'), 10) || 0;
      }
      return {
        tag: el.tagName,
        text: fullText.replace(/\s+/g, ' ').trim().slice(0, 100),
        textFull: fullText,
        color: el.style.color || rgb2hex(cs.color) || '',
        bgColor: el.style.backgroundColor || rgb2hex(cs.backgroundColor) || '',
        fontSize: parseInt(el.style.fontSize || cs.fontSize) || 14,
        bold: fw === 'bold' || fw === '700' || +fw >= 600,
        italic: (el.style.fontStyle || cs.fontStyle) === 'italic',
        underline: (el.style.textDecoration || cs.textDecoration || '').indexOf('underline') !== -1,
        align: el.style.textAlign || cs.textAlign || 'left',
        width: parseInt(el.style.width) || 0,
        padding: parseInt(el.style.padding) || 0,
        imgWidth: imgWidth,
        imgHeight: imgHeight,
        rectTop: rect.top, rectLeft: rect.left, rectWidth: rect.width, rectHeight: rect.height
      };
    }

    var _hl = document.createElement('style');
    // Visual contract:
    //   - SELECTION (single or multi) = bold solid gold outline + faint gold bg.
    //     Single and multi look the same so the user can trust "anything gold-
    //     boxed will be acted on" — the right panel shows the count.
    //   - HOVER = thin grey/white solid outline, NO gold, NO dashes. Removed
    //     the dashed-gold style that used to collide visually with selection.
    //   - Drop-inside, lock, contenteditable: unchanged.
    _hl.textContent =
      '[data-nl-sel="1"]{outline:2.5px solid #D4A420!important;outline-offset:3px!important;background:rgba(212,164,32,.08)!important;border-radius:2px}' +
      '[data-nl-multisel="1"]{outline:2.5px solid #D4A420!important;outline-offset:3px!important;background:rgba(212,164,32,.08)!important;border-radius:2px}' +
      '[data-nl-hover="1"]{outline:1px solid rgba(255,255,255,.32)!important;outline-offset:1px!important;background:rgba(255,255,255,.02)!important}' +
      '[data-nl-drop-inside="1"]{box-shadow:inset 0 0 0 2px rgba(212,164,32,.6)!important}' +
      '[contenteditable="true"]{outline:2px solid rgba(212,164,32,.9)!important;caret-color:#D4A420}' +
      '.nl-drag-ghost{opacity:.35!important;pointer-events:none}';
    // Tag as editor-injected so the export/save CSS collectors
    // (style:not([data-nl-ed-inject])) never ship these edit-only outline rules
    // into the downloaded HTML.
    _hl.setAttribute('data-nl-ed-inject', '1');
    document.head.appendChild(_hl);

    // Unlock everything: this editor honours no "locked asset". Strip the lock
    // markers from the content so every block can be selected, edited, moved and
    // dragged. Runs at load and again whenever the parent replaces body content.
    function unlockAll() {
      try {
        var lk = document.querySelectorAll('[data-nl-lock]');
        for (var i = 0; i < lk.length; i++) lk[i].removeAttribute('data-nl-lock');
      } catch (e) {}
    }
    unlockAll();

    function setHl(el, on) {
      if (!el) return;
      if (on) el.setAttribute('data-nl-sel', '1');
      else el.removeAttribute('data-nl-sel');
    }

    /* ────────────────────────────────────────────────────────
       IMAGE RESIZE HANDLES (Excel-style drag-to-resize)
       An 8-handle overlay drawn over the selected <img>. It lives in the iframe
       so the geometry is simple — image and handles share one viewport and
       scroll together. Every node is tagged data-nl-ed-ui, so getCleanHtml
       (export) and the parent's _iframeHtml (undo) strip it: the overlay never
       reaches the saved or exported newsletter. Corner handles keep the aspect
       ratio; edge handles resize one axis.
       ──────────────────────────────────────────────────────── */
    var _rsBox = null, _rsDrag = null;
    var _RS_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    // Apply an explicit pixel size to an <img>, email-safe: write BOTH the inline
    // style and the width/height ATTRIBUTES, because Outlook sizes images off the
    // attributes and ignores CSS width. Shared by the slider command + drag.
    function applyImgSize(el, w, h) {
      if (!el) return;
      w = Math.max(8, Math.round(w));
      el.style.width = w + 'px';
      el.style.maxWidth = '100%';
      el.setAttribute('width', String(w));
      if (h && h > 0) { h = Math.round(h); el.style.height = h + 'px'; el.setAttribute('height', String(h)); }
      else { el.style.height = 'auto'; el.removeAttribute('height'); }
    }

    function _rsCursor(dir) {
      if (dir === 'nw' || dir === 'se') return 'nwse-resize';
      if (dir === 'ne' || dir === 'sw') return 'nesw-resize';
      if (dir === 'n' || dir === 's') return 'ns-resize';
      return 'ew-resize';
    }
    function _rsStyleHandle(h, dir) {
      h.style.cssText = 'position:absolute;width:11px;height:11px;box-sizing:border-box;'
        + 'background:#fff;border:1.5px solid #D4A420;border-radius:2px;'
        + 'box-shadow:0 1px 2px rgba(0,0,0,.45);pointer-events:auto;cursor:' + _rsCursor(dir) + ';';
      var mid = 'calc(50% - 5.5px)', neg = '-6px';
      if (dir.indexOf('n') !== -1) h.style.top = neg; else if (dir.indexOf('s') !== -1) h.style.bottom = neg; else h.style.top = mid;
      if (dir.indexOf('w') !== -1) h.style.left = neg; else if (dir.indexOf('e') !== -1) h.style.right = neg; else h.style.left = mid;
    }
    function ensureResizeBox() {
      if (_rsBox) return _rsBox;
      _rsBox = document.createElement('div');
      _rsBox.setAttribute('data-nl-ed-ui', '1');
      _rsBox.style.cssText = 'position:absolute;display:none;z-index:2147483600;pointer-events:none;'
        + 'border:1px solid rgba(212,164,32,.9);box-sizing:border-box;';
      _RS_DIRS.forEach(function (dir) {
        var h = document.createElement('div');
        h.setAttribute('data-nl-ed-ui', '1');
        h.setAttribute('data-rs-dir', dir);
        _rsStyleHandle(h, dir);
        h.addEventListener('mousedown', onRsHandleDown, true);
        _rsBox.appendChild(h);
      });
      document.body.appendChild(_rsBox);
      return _rsBox;
    }
    function positionResizeBox() {
      if (!_rsBox || !_sel) return;
      var r = _sel.getBoundingClientRect();
      var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
      _rsBox.style.left = (r.left + sx) + 'px';
      _rsBox.style.top = (r.top + sy) + 'px';
      _rsBox.style.width = r.width + 'px';
      _rsBox.style.height = r.height + 'px';
    }
    function updateResizeHandles() {
      var show = _sel && _sel.tagName === 'IMG' && _selSet.size <= 1;
      if (!show) { if (_rsBox) _rsBox.style.display = 'none'; return; }
      ensureResizeBox();
      positionResizeBox();
      _rsBox.style.display = 'block';
    }
    function onRsHandleDown(e) {
      if (!_sel || _sel.tagName !== 'IMG') return;
      e.preventDefault(); e.stopPropagation();
      var r = _sel.getBoundingClientRect();
      _rsDrag = {
        dir: e.currentTarget.getAttribute('data-rs-dir'),
        x: e.clientX, y: e.clientY,
        w: Math.round(r.width), h: Math.round(r.height),
        ratio: r.height ? (r.width / r.height) : 1
      };
      post('imgResizeStart'); // parent snapshots one undo step for the whole drag
      document.addEventListener('mousemove', onRsHandleMove, true);
      document.addEventListener('mouseup', onRsHandleUp, true);
    }
    function onRsHandleMove(e) {
      if (!_rsDrag || !_sel) return;
      e.preventDefault();
      var d = _rsDrag, dir = d.dir;
      var sX = dir.indexOf('e') !== -1 ? 1 : (dir.indexOf('w') !== -1 ? -1 : 0);
      var sY = dir.indexOf('s') !== -1 ? 1 : (dir.indexOf('n') !== -1 ? -1 : 0);
      var nw = d.w, nh = d.h;
      if (dir.length === 2) {            // corner → keep aspect ratio
        nw = Math.max(16, d.w + sX * (e.clientX - d.x));
        nh = Math.round(nw / d.ratio);
      } else if (sX) {                   // left/right edge → width only
        nw = Math.max(16, d.w + sX * (e.clientX - d.x));
      } else {                           // top/bottom edge → height only
        nh = Math.max(16, d.h + sY * (e.clientY - d.y));
      }
      applyImgSize(_sel, nw, nh);
      positionResizeBox();
      reportHeight();
      post('select', getProps(_sel)); // live size readout in the right panel
    }
    function onRsHandleUp() {
      document.removeEventListener('mousemove', onRsHandleMove, true);
      document.removeEventListener('mouseup', onRsHandleUp, true);
      if (_rsDrag) { _rsDrag = null; post('imgResizeEnd'); reportHeight(); }
      updateResizeHandles();
    }

    function computeDomPathForEl(localEl) {
      if (!localEl || localEl === document.body) return { path: null, relPath: null, locked: false };
      var path = [];
      var n = localEl;
      while (n && n !== document.body) {
        var p = n.parentElement;
        if (!p) { path = null; break; }
        path.unshift(Array.prototype.indexOf.call(p.children, n));
        n = p;
      }
      var tplRoot = document.querySelector('[data-template-id]');
      var relPath = null;
      if (tplRoot && tplRoot !== localEl && tplRoot.contains(localEl)) {
        relPath = [];
        n = localEl;
        while (n && n !== tplRoot) {
          p = n.parentElement;
          if (!p) { relPath = null; break; }
          relPath.unshift(Array.prototype.indexOf.call(p.children, n));
          n = p;
        }
      }
      return { path: path, relPath: relPath, locked: false };
    }

    function setMulti(el, on) {
      if (!el) return;
      if (on) el.setAttribute('data-nl-multisel', '1');
      else el.removeAttribute('data-nl-multisel');
    }

    function clearMultiSet() {
      _selSet.forEach(function (el) { setMulti(el, false); });
      _selSet.clear();
    }

    function isSelectable(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      return true;
    }

    function isGoldDotCell(td) {
      if (!td || td.tagName !== 'TD') return false;
      if (td.children.length !== 1) return false;
      var c = td.children[0];
      if (c.tagName !== 'DIV') return false;
      var st = c.getAttribute('style') || '';
      if (/border-radius:\s*50%/i.test(st)) return true;
      // Current templates draw the marker as a small gold bullet glyph (e.g. &bull;)
      // instead of a CSS round dot; treat a single-glyph div as a dot cell too, so
      // findBulletWrapper still resolves the whole bullet row for select/delete.
      var txt = (c.textContent || '').replace(/\s+/g, '');
      return /^[•·●∙‣⁃]$/.test(txt);
    }

    function findBulletWrapper(el) {
      if (!el || el === document.body) return el;
      var tr = el;
      while (tr && tr !== document.body && tr.tagName !== 'TR') tr = tr.parentElement;
      if (!tr || tr === document.body) return el;
      var directTds = [];
      for (var i = 0; i < tr.children.length; i++) {
        if (tr.children[i].tagName === 'TD') directTds.push(tr.children[i]);
      }
      if (directTds.length !== 2) return el;
      var dotCell = null, textCell = null;
      if (isGoldDotCell(directTds[0])) { dotCell = directTds[0]; textCell = directTds[1]; }
      else if (isGoldDotCell(directTds[1])) { dotCell = directTds[1]; textCell = directTds[0]; }
      if (!dotCell || !textCell) return el;
      if (textCell !== el && !textCell.contains(el) && dotCell !== el && !dotCell.contains(el)) return el;
      var innerTable = tr.parentElement;
      if (innerTable && innerTable.tagName === 'TABLE') {
        var tdWrap = innerTable.parentElement;
        if (tdWrap && tdWrap.tagName === 'TD' && tdWrap.children.length === 1) {
          var outerTr = tdWrap.parentElement;
          if (outerTr && outerTr.tagName === 'TR') {
            var outerTds = [];
            for (var j = 0; j < outerTr.children.length; j++) {
              if (outerTr.children[j].tagName === 'TD') outerTds.push(outerTr.children[j]);
            }
            if (outerTds.length === 1 && outerTds[0] === tdWrap) return outerTr;
          }
        }
      }
      return tr;
    }

    function doSelect(el, additive) {
      if (!additive) {
        if (_selSet.size) clearMultiSet();
        if (_sel === el) {
          if (_sel) { setHl(_sel, true); _selSet.add(_sel); }
          if (_sel) post('select', Object.assign(getProps(_sel), { multiCount: 1 }));
          return;
        }
        setHl(_sel, false); _sel = el; setHl(_sel, true);
        if (_sel) {
          _selSet.add(_sel);
          post('select', Object.assign(getProps(_sel), { multiCount: 1 }));
        } else {
          post('deselect');
        }
        return;
      }
      if (!isSelectable(el)) return;
      if (_selSet.has(el)) {
        if (el === _sel) {
          setHl(_sel, false);
          _selSet.delete(el);
          var remaining = Array.from(_selSet);
          _sel = remaining.length ? remaining[remaining.length - 1] : null;
          if (_sel) { setMulti(_sel, false); setHl(_sel, true); }
        } else {
          setMulti(el, false);
          _selSet.delete(el);
        }
      } else {
        if (_sel) { setHl(_sel, false); setMulti(_sel, true); }
        _sel = el; setHl(_sel, true);
        _selSet.add(el);
      }
      if (_sel) {
        post('select', Object.assign(getProps(_sel), { multiCount: _selSet.size }));
      } else {
        post('deselect');
      }
    }

    function startEdit(el) {
      if (!el || el === document.body) return;
      if (_edEl && _edEl !== el) { _edEl.removeAttribute('contenteditable'); _edEl.style.cursor = ''; }
      _edEl = el; el.contentEditable = 'true'; el.style.cursor = 'text'; el.focus();
      disarmDrag();   // editing → the block must not be draggable (don't hijack the caret)
      try {
        var r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (e) {}
      post('editing', { tag: el.tagName });
    }

    function stopEdit() {
      if (!_edEl) return;
      var el = _edEl;
      _edEl.removeAttribute('contenteditable'); _edEl.style.cursor = ''; _edEl = null;
      var dp = computeDomPathForEl(el);
      post('editDone', {
        path: dp.path,
        relPath: dp.relPath,
        locked: dp.locked,
        textFull: el.textContent || ''
      });
      if (_sel) post('select', getProps(_sel));
      armDirectDrag();   // re-arm grab-drag once text editing ends
    }

    // After removing a node, walk UP and prune any ancestor that became
    // structurally empty (no meaningful content left). Stops before BODY and
    // never touches locked elements. Catches the common case where deleting
    // all bullets in a section leaves an outer card TABLE/TD with padding +
    // border that still reserves vertical space.
    function pruneEmptyAncestors(parent) {
      var node = parent;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.getAttribute && node.getAttribute('data-nl-lock') === '1') break;
        // Has any non-whitespace text? Keep.
        if ((node.textContent || '').replace(/\s+/g, '') !== '') break;
        // Has any meaningful element children (img/hr/br/input)? Keep.
        var keep = false;
        var kids = node.children || [];
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          var tn = k.tagName;
          if (tn === 'IMG' || tn === 'HR' || tn === 'INPUT' || tn === 'SVG' || tn === 'CANVAS' || tn === 'VIDEO') { keep = true; break; }
        }
        if (keep) break;
        var up = node.parentElement;
        try { node.remove(); } catch (e) { break; }
        node = up;
      }
    }

    function doDelete() {
      if (!_sel || _sel === document.body || _sel === document.documentElement) {
        if (!_selSet.size) return;
      }
      stopEdit();
      var seen = new Set();
      var targets = [];
      function pushTarget(el) {
        if (!isSelectable(el)) return;
        var wrap = findBulletWrapper(el);
        if (!isSelectable(wrap) || seen.has(wrap)) return;
        seen.add(wrap); targets.push(wrap);
      }
      if (_sel) pushTarget(_sel);
      _selSet.forEach(function (el) { if (el !== _sel) pushTarget(el); });
      if (!targets.length) { post('locked', {}); return; }
      var parents = [];
      targets.forEach(function (el) {
        var p = el.parentElement;
        try { setMulti(el, false); el.remove(); parents.push(p); } catch (e) {}
      });
      // Dedupe and prune.
      var seenParents = new Set();
      parents.forEach(function (p) {
        if (!p || seenParents.has(p)) return;
        seenParents.add(p);
        try { pruneEmptyAncestors(p); } catch (e) {}
      });
      _selSet.clear(); _sel = null;
      post('deleted', { count: targets.length }); reportHeight();
    }

    // Resolve the actual block-level target for move/drag/duplicate. _sel is
    // often the inner text element (TD/SPAN/P); we need the bullet row wrapper
    // (TR) so siblings exist at the right structural level.
    function resolveBlockTarget() {
      if (!_sel || _sel === document.body || _sel === document.documentElement) return null;
      var t = findBulletWrapper(_sel);
      if (!t || t === document.body) t = _sel;
      return t;
    }

    // Collect distinct block-level wrappers for every currently selected
    // element (primary + shift-selected). Filters out locked, sorts in
    // document order. Returns [] if no usable targets.
    function collectBlockTargets() {
      var seen = new Set();
      var out = [];
      function push(el) {
        if (!el || el === document.body || el === document.documentElement) return;
        var w = findBulletWrapper(el);
        if (!w || w === document.body) w = el;
        if (!w || seen.has(w)) return;
        seen.add(w); out.push(w);
      }
      if (_sel) push(_sel);
      _selSet.forEach(function (el) { if (el !== _sel) push(el); });
      // Sort in document order so shift-style multi-move works predictably.
      out.sort(function (a, b) {
        if (a === b) return 0;
        var p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      return out;
    }

    function stripUiMarkers(root) {
      if (!root) return;
      try {
        root.removeAttribute('data-nl-ed-sel');
        root.removeAttribute('data-nl-ed-multi');
        root.removeAttribute('data-nl-hover');
        root.removeAttribute('data-nl-regen-pending');
        root.querySelectorAll('[data-nl-ed-sel],[data-nl-ed-multi],[data-nl-hover],[data-nl-regen-pending]').forEach(function (n) {
          n.removeAttribute('data-nl-ed-sel');
          n.removeAttribute('data-nl-ed-multi');
          n.removeAttribute('data-nl-hover');
          n.removeAttribute('data-nl-regen-pending');
        });
      } catch (e) {}
    }

    // ── Reorder target resolution ────────────────────────────────────────────
    // The block a Move/Drag acts on is resolved from the selection at WHATEVER
    // granularity the user clicked: climb the TR/LI ladder and return the
    // INNERMOST level that has a real (non-spacer) sibling of the same tag. That
    // yields the bullet ROW when a bullet is clicked, and the SECTION band when
    // section-level text is clicked — no separate mode needed. A horizontal
    // "card" (a TD in a row of 3+ cells) is the fallback when no TR/LI level is
    // reorderable. Returns null only when nothing around the selection can move.
    function isSpacerBlock(el) {
      if (!el) return true;
      if ((el.textContent || '').replace(/\s+/g, '') !== '') return false;
      return !el.querySelector('img,input,hr,svg,canvas,video');
    }
    function hasContentSibling(n) {
      var tag = n.tagName, s;
      for (s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === tag && !isSpacerBlock(s)) return true;
      for (s = n.nextElementSibling; s; s = s.nextElementSibling) if (s.tagName === tag && !isSpacerBlock(s)) return true;
      return false;
    }
    function cellCount(tr) {
      var c = 0; for (var i = 0; i < tr.children.length; i++) if (tr.children[i].tagName === 'TD') c++; return c;
    }
    function resolveMovableBlock(sel) {
      if (!sel || sel === document.body || sel === document.documentElement) return null;
      var card = null;
      var firstRow = null;
      var n = sel;
      while (n && n !== document.body && n !== document.documentElement) {
        if (n.tagName === 'TR' || n.tagName === 'LI') {
          if (hasContentSibling(n)) return n;
          if (!firstRow) firstRow = n;   // relaxed: remember a sibling-less row too
        } else if (n.tagName === 'TD' && !card) {
          var tr = n.parentElement;
          if (tr && tr.tagName === 'TR' && cellCount(tr) >= 3 && hasContentSibling(n)) card = n;
        }
        n = n.parentElement;
      }
      // Everything is pickup-able (Wix-style): if no sibling'd row/card was found,
      // fall back to the nearest row/list-item so a structurally-alone block (a
      // masthead or footer band) can still be grabbed and dragged to reorder.
      return card || firstRow;
    }
    function collectMovableBlocks() {
      var seen = new Set(), out = [];
      function push(el) {
        var b = resolveMovableBlock(el);
        if (!b || seen.has(b)) return;
        seen.add(b); out.push(b);
      }
      if (_sel) push(_sel);
      _selSet.forEach(function (el) { if (el !== _sel) push(el); });
      out.sort(function (a, b) {
        if (a === b) return 0;
        var p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      return out;
    }

    // Direct grab-drag (Wix-style): when a block is selected, arm it as draggable
    // so the user can just grab and drag it to reorder — no separate "Drag" button
    // needed. Only the resolved movable block is armed, and arming is skipped while
    // editing text so a drag can never hijack the contenteditable caret/selection.
    function disarmDrag() {
      if (_dragEl) { try { _dragEl.removeAttribute('draggable'); _dragEl.classList.remove('nl-drag-ghost'); } catch (e) {} }
      _dragEntourage.forEach(function (n) { try { n.classList.remove('nl-drag-ghost'); } catch (e) {} });
      _dragEntourage = [];
      _dragEl = null;
    }
    function armDirectDrag() {
      disarmDrag();
      if (_edEl) return;                                  // never arm mid text-edit
      var blocks = collectMovableBlocks();                // primary + any multi-selected
      if (!blocks.length) return;
      _dragEl = blocks[0];
      _dragEntourage = blocks.slice(1);                   // towed after the primary on drop
      try { _dragEl.setAttribute('draggable', 'true'); } catch (e) {}
    }
    // Nearest same-tag sibling that isn't an invisible spacer, walking `dir`.
    function adjacentContentSibling(n, dir) {
      var s = dir === 'up' ? n.previousElementSibling : n.nextElementSibling;
      while (s && (s.tagName !== n.tagName || isSpacerBlock(s))) {
        s = dir === 'up' ? s.previousElementSibling : s.nextElementSibling;
      }
      return s;
    }

    function doMove(dir) {
      var targets = collectMovableBlocks();
      if (!targets.length) return;  // nothing reorderable under the selection
      var anyMoved = false;
      // Up: process top→bottom; Down: bottom→top, so a multi-selection leapfrogs cleanly.
      var seq = dir === 'down' ? targets.slice().reverse() : targets;
      for (var i = 0; i < seq.length; i++) {
        var t = seq[i];
        var sib = adjacentContentSibling(t, dir);
        if (!sib) continue;  // already at the edge — stay silent
        if (dir === 'up') t.parentNode.insertBefore(t, sib);
        else t.parentNode.insertBefore(sib, t);
        anyMoved = true;
      }
      if (!anyMoved) return;  // every target already at its edge — silent
      try { targets[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
      reportHeight(); post('moved', {});
    }

    function doDuplicate() {
      var targets = collectBlockTargets();
      if (!targets.length) { post('locked', {}); return; }
      // Clone each in document order, insert directly after the original. Then
      // clear current selection and re-select all clones so shift-style group
      // operations stay coherent.
      var clones = [];
      targets.forEach(function (t) {
        var copy = t.cloneNode(true);
        stripUiMarkers(copy);
        t.parentNode.insertBefore(copy, t.nextSibling);
        clones.push(copy);
      });
      if (clones.length) {
        clearMultiSet();
        setHl(_sel, false);
        _sel = clones[0];
        setHl(_sel, true);
        _selSet.add(_sel);
        for (var j = 1; j < clones.length; j++) {
          setMulti(clones[j], true);
          _selSet.add(clones[j]);
        }
        try { _sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
        post('select', Object.assign(getProps(_sel), { multiCount: _selSet.size }));
      }
      reportHeight(); post('added', {});
    }

    function doAddEl(html) {
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var newEl = tmp.firstElementChild || tmp;
      if (_sel && _sel.parentNode) _sel.parentNode.insertBefore(newEl, _sel.nextSibling || null);
      else { var root = document.body.firstElementChild || document.body; root.appendChild(newEl); }
      doSelect(newEl);
      newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reportHeight(); post('added', {});
    }

    function doAddSec(html) {
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var newEl = tmp.firstElementChild || tmp;
      var root = document.body.firstElementChild || document.body;
      root.appendChild(newEl);
      doSelect(newEl);
      newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reportHeight(); post('added', {});
    }

    function setTextPreservingInlineMarkup(el, nextText) {
      if (!el) return;
      var text = String(nextText == null ? '' : nextText);
      if (!el.children || !el.children.length) {
        el.textContent = text;
        return;
      }
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      if (!textNodes.length) {
        el.textContent = text;
        return;
      }
      var remaining = text;
      for (var i = 0; i < textNodes.length; i += 1) {
        var n = textNodes[i];
        if (i === textNodes.length - 1) {
          n.nodeValue = remaining;
          remaining = '';
        } else {
          var curLen = (n.nodeValue || '').length;
          n.nodeValue = remaining.slice(0, curLen);
          remaining = remaining.slice(curLen);
        }
      }
    }

    _dropLine = document.createElement('div');
    _dropLine.style.cssText = 'height:3px;background:#D4A420;border-radius:2px;pointer-events:none;display:none;margin:1px 0;box-shadow:0 0 6px rgba(212,164,32,.5)';
    // Editor-only chrome: tag so getCleanHtml / _iframeHtml strip it from exports.
    _dropLine.setAttribute('data-nl-ed-ui', '1');
    document.body.appendChild(_dropLine);

    document.addEventListener('dragstart', function (e) {
      if (e.target !== _dragEl) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '1');
      setTimeout(function () { if (_dragEl) _dragEl.classList.add('nl-drag-ghost'); }, 0);
      _dropLine.style.display = '';
    });

    document.addEventListener('dragover', function (e) {
      if (!_dragEl) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      var t = e.target;
      while (t && t !== document.body && t === _dragEl) t = t.parentNode;
      if (t && t !== _dragEl && !_dragEl.contains(t)) {
        if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
        var rect = t.getBoundingClientRect();
        var zoneTop = rect.top + rect.height * 0.25;
        var zoneBottom = rect.top + rect.height * 0.75;
        if (e.clientY >= zoneTop && e.clientY <= zoneBottom && t !== document.body) {
          _insideTarget = t;
          t.setAttribute('data-nl-drop-inside', '1');
          _dropLine.style.display = 'none';
        } else {
          _insideTarget = null;
          _dropLine.style.display = '';
          if (e.clientY < rect.top + rect.height / 2) t.parentNode.insertBefore(_dropLine, t);
          else t.parentNode.insertBefore(_dropLine, t.nextSibling);
        }
      }
    });

    document.addEventListener('drop', function (e) {
      if (!_dragEl) return;
      e.preventDefault();
      if (_insideTarget && _insideTarget !== _dragEl && !_dragEl.contains(_insideTarget)) {
        _insideTarget.appendChild(_dragEl);
      } else if (_dropLine.parentNode) {
        _dropLine.parentNode.insertBefore(_dragEl, _dropLine);
      }
      // Tow the rest of the multi-selection in document order directly after
      // the dropped primary so a shift-drag keeps the group contiguous.
      var anchor = _dragEl;
      _dragEntourage.forEach(function (n) {
        try {
          if (n === anchor || anchor.contains(n)) return;
          n.classList.remove('nl-drag-ghost');
          anchor.parentNode.insertBefore(n, anchor.nextSibling);
          anchor = n;
        } catch (err) {}
      });
      _dragEntourage = [];
      if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
      _insideTarget = null;
      _dragEl.classList.remove('nl-drag-ghost');
      _dragEl.removeAttribute('draggable');
      _dragEl = null; _dropLine.style.display = 'none';
      reportHeight(); post('moved', {});
    });

    document.addEventListener('dragend', function () {
      if (_dragEl) { _dragEl.classList.remove('nl-drag-ghost'); _dragEl.removeAttribute('draggable'); _dragEl = null; }
      _dragEntourage.forEach(function (n) { n.classList.remove('nl-drag-ghost'); });
      _dragEntourage = [];
      if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
      _insideTarget = null;
      _dropLine.style.display = 'none';
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-nl-ed-ui')) return; // resize handle / editor chrome
      if (!t || t === document.body || t === document.documentElement) { stopEdit(); doSelect(null); disarmDrag(); return; }
      if (_edEl && _edEl.contains(t)) return;
      if (_edEl && !_edEl.contains(t)) stopEdit();
      doSelect(t, !!(e.ctrlKey || e.metaKey)); // Ctrl (Win/Linux) / Cmd (Mac) = additive multi-select
      armDirectDrag();   // arm the just-selected block for grab-drag (Wix-style)
    }, true);

    document.addEventListener('dblclick', function (e) {
      var t = e.target;
      if (!t || t === document.body) return;
      e.preventDefault();
      if (_selSet.size > 1) clearMultiSet();
      doSelect(t, false);
      startEdit(t);
    }, true);

    document.addEventListener('mousemove', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-nl-ed-ui')) return; // don't hover-highlight resize handles
      if (_hoverEl && _hoverEl !== _sel) _hoverEl.removeAttribute('data-nl-hover');
      if (t && t !== document.body && t !== _sel) { t.setAttribute('data-nl-hover', '1'); _hoverEl = t; }
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (_edEl) stopEdit(); else doSelect(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && _sel && !_edEl &&
          document.activeElement === document.body) { e.preventDefault(); doDelete(); }
    });

    document.addEventListener('input', function () {
      if (!_sel) return;
      var p = getProps(_sel);
      // Tag input-driven updates so the parent can fold a typing burst into
      // one undo entry instead of one-per-keystroke.
      p.fromTyping = true;
      post('update', p);
    });

    function reportHeight() {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight);
      post('height', { h: h });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { reportHeight(); }).observe(document.body);
    window.addEventListener('load', reportHeight);
    setTimeout(reportHeight, 300); setTimeout(reportHeight, 1200); setTimeout(reportHeight, 3000);

    function getActiveRangeInside(el) {
      if (!el) return null;
      var sel = (el.ownerDocument || document).getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var range = sel.getRangeAt(0);
      if (range.collapsed) return null;
      if (!el.contains(range.commonAncestorContainer)) return null;
      return range;
    }
    function wrapRangeWithStyle(range, styles) {
      if (!range) return null;
      var doc = range.startContainer.ownerDocument || document;
      var span = doc.createElement('span');
      Object.keys(styles).forEach(function (k) {
        var v = styles[k];
        if (v !== undefined && v !== null && v !== '') span.style[k] = v;
      });
      try { range.surroundContents(span); }
      catch (err) {
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      var newRange = doc.createRange();
      newRange.selectNodeContents(span);
      var sel2 = doc.getSelection();
      if (sel2) { sel2.removeAllRanges(); sel2.addRange(newRange); }
      return span;
    }

    window.addEventListener('message', function (e) {
      // Only accept commands from the embedding parent window. The srcdoc
      // iframe and the parent share origin; source-identity is the most
      // reliable check (event.origin can be "null" for srcdoc iframes).
      if (e.source !== window.parent) return;
      var d = e.data; if (!d || !d._nlEd) return;
      switch (d.cmd) {
        case 'color':
          if (_sel) {
            var rngC = getActiveRangeInside(_sel);
            if (rngC) wrapRangeWithStyle(rngC, { color: d.v });
            else _sel.style.color = d.v;
            post('select', getProps(_sel));
          }
          break;
        case 'bg':       if (_sel) { _sel.style.backgroundColor = d.v || ''; post('select', getProps(_sel)); } break;
        case 'size':
          if (_sel) {
            var rngS = getActiveRangeInside(_sel);
            if (rngS) {
              // Enlarging a sub-selection (e.g. a drop-cap first letter) must NOT
              // add any spacing. line-height:0 makes the wrapper contribute zero
              // height to the line box, so the line never grows — the big glyph
              // simply overflows upward instead of pushing the lines apart.
              wrapRangeWithStyle(rngS, { fontSize: d.v + 'px', lineHeight: '0' });
            } else {
              _sel.style.fontSize = d.v + 'px';
            }
            post('select', getProps(_sel));
          }
          break;
        case 'bold':
          if (_sel) {
            var rngB = getActiveRangeInside(_sel);
            if (rngB) wrapRangeWithStyle(rngB, { fontWeight: 'bold' });
            else _sel.style.fontWeight = (_sel.style.fontWeight === 'bold' || _sel.style.fontWeight === '700') ? '' : 'bold';
            post('select', getProps(_sel));
          }
          break;
        case 'italic':
          if (_sel) {
            var rngI = getActiveRangeInside(_sel);
            if (rngI) wrapRangeWithStyle(rngI, { fontStyle: 'italic' });
            else _sel.style.fontStyle = _sel.style.fontStyle === 'italic' ? '' : 'italic';
            post('select', getProps(_sel));
          }
          break;
        case 'underline':
          if (_sel) {
            var rngU = getActiveRangeInside(_sel);
            if (rngU) wrapRangeWithStyle(rngU, { textDecoration: 'underline' });
            else { var td = _sel.style.textDecoration || ''; _sel.style.textDecoration = td.indexOf('underline') !== -1 ? td.replace('underline', '').trim() : (td ? td + ' underline' : 'underline'); }
            post('select', getProps(_sel));
          }
          break;
        case 'align':    if (_sel) { _sel.style.textAlign = d.v; post('select', getProps(_sel)); } break;
        case 'text':     if (_sel) { setTextPreservingInlineMarkup(_sel, d.v); post('select', getProps(_sel)); reportHeight(); } break;
        case 'width':    if (_sel) { _sel.style.width = d.v ? d.v + 'px' : ''; post('select', getProps(_sel)); reportHeight(); } break;
        case 'imgSize':
          // Resize the selected <img>. A plain number (from the panel slider)
          // resizes PROPORTIONALLY — height derived from the natural aspect ratio
          // so the image never squishes. An { w, h } object applies exact dims
          // (used by single-axis edge drags). applyImgSize writes the width/height
          // ATTRIBUTES too, because Outlook sizes images off the attributes.
          if (_sel && _sel.tagName === 'IMG') {
            var iw, ih;
            if (d.v && typeof d.v === 'object') {
              iw = parseInt(d.v.w, 10) || 0;
              ih = parseInt(d.v.h, 10) || 0;
            } else {
              iw = Math.max(8, parseInt(d.v, 10) || 0);
              var inw = _sel.naturalWidth || parseInt(_sel.getAttribute('width'), 10) || _sel.clientWidth || 0;
              var inh = _sel.naturalHeight || parseInt(_sel.getAttribute('height'), 10) || _sel.clientHeight || 0;
              ih = (inw && inh) ? Math.round(iw * inh / inw) : 0;
            }
            applyImgSize(_sel, iw, ih);
            post('select', getProps(_sel));
            reportHeight();
          }
          break;
        case 'padding':  if (_sel) { _sel.style.padding = d.v ? d.v + 'px' : ''; post('select', getProps(_sel)); reportHeight(); } break;
        case 'delete':   doDelete(); break;
        case 'moveUp':   doMove('up'); break;
        case 'moveDown': doMove('down'); break;
        case 'duplicate': doDuplicate(); break;
        case 'replaceImageSrc': {
          // Swap the selected <img>'s src. Used by the editor's "Replace image"
          // modal. The parent owns the data URI (computed from a Blob); the
          // iframe just applies it to _sel.
          if (!_sel || _sel.tagName !== 'IMG') break;
          var newSrc = (d.v && typeof d.v.dataUri === 'string') ? d.v.dataUri : '';
          if (!newSrc) break;
          _sel.setAttribute('src', newSrc);
          // Re-emit selection so the parent picks up the new naturalWidth/Height
          // once the image loads. setTimeout 0 to let the browser resolve the src.
          setTimeout(function () { post('select', getProps(_sel)); reportHeight(); }, 0);
          break;
        }
        case 'addEl':    doAddEl(d.v); break;
        case 'addSec':   doAddSec(d.v); break;
        case 'preset':
          if (_sel) {
            if (d.v === 'heading') { _sel.style.fontFamily = "'DM Serif Display', Georgia, serif"; _sel.style.fontWeight = '700'; _sel.style.fontSize = '28px'; _sel.style.lineHeight = '1.2'; }
            if (d.v === 'body') { _sel.style.fontFamily = "'DM Sans', sans-serif"; _sel.style.fontWeight = '400'; _sel.style.fontSize = '14px'; _sel.style.lineHeight = '1.6'; _sel.style.color = '#333333'; }
            if (d.v === 'cta') { _sel.style.background = 'linear-gradient(135deg,#C09010,#A07808)'; _sel.style.color = '#ffffff'; _sel.style.padding = '10px 20px'; _sel.style.borderRadius = '6px'; _sel.style.display = 'inline-block'; _sel.style.fontWeight = '700'; }
            if (d.v === 'accent') { _sel.style.backgroundColor = '#FEF3E0'; _sel.style.borderLeft = '4px solid #D4A420'; _sel.style.padding = '14px'; _sel.style.borderRadius = '4px'; }
            post('select', getProps(_sel));
          }
          break;
        case 'enableDrag': {
          var dragTargets = collectMovableBlocks();
          if (dragTargets.length) {
            _dragEl = dragTargets[0];
            _dragEntourage = dragTargets.slice(1);
            _dragEl.setAttribute('draggable', 'true');
            _dragEntourage.forEach(function (n) { n.classList.add('nl-drag-ghost'); });
            post('dragReady', {});
          }
          break;
        }
        case 'deselect': stopEdit(); doSelect(null); break;
        case 'getDomPath': {
          if (!_sel || _sel === document.body) { post('domPath', { path: null, relPath: null }); break; }
          var wrapSel = findBulletWrapper(_sel);
          var dp = computeDomPathForEl(wrapSel);
          if (dp.locked) { post('domPath', { path: null, relPath: null, locked: true }); break; }
          post('domPath', { path: dp.path, relPath: dp.relPath });
          break;
        }
        case 'getDomPaths': {
          var seenWrap = new Set();
          var items = [];
          function addPath(el) {
            if (!isSelectable(el)) return;
            var w = findBulletWrapper(el);
            if (!isSelectable(w) || seenWrap.has(w)) return;
            seenWrap.add(w);
            var dpX = computeDomPathForEl(w);
            if (!dpX.locked && dpX.path) items.push({ path: dpX.path, relPath: dpX.relPath, locked: false });
          }
          if (_sel) addPath(_sel);
          _selSet.forEach(function (el) { if (el !== _sel) addPath(el); });
          post('domPaths', { items: items });
          break;
        }
        case 'getCleanHtml': {
          // Serialise from a CLONE so the live editor is never mutated, and scrub
          // every edit affordance: resize-handle chrome, live QR canvases, stray
          // contenteditable (which renders as an editable text-box), and the
          // hover/selection/drop markers. This is what stops the exported or saved
          // HTML from showing outline boxes on hover, or editable text-boxes, once
          // it is opened on its own.
          var _clone = document.body.cloneNode(true);
          _clone.querySelectorAll('[data-nl-ed-ui]').forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
          // Drop the injected editor + QR <script> tags. They live in the iframe
          // <body>, so without this they serialise into the export and RE-RUN when
          // the downloaded file is opened — re-adding hover outlines and editable
          // text-boxes. A finished newsletter is static, so no script should ship.
          _clone.querySelectorAll('script').forEach(function (n) { n.remove(); });
          _clone.querySelectorAll('#nl-qr canvas').forEach(function (n) { n.remove(); });
          var _STRIP = ['contenteditable', 'data-nl-sel', 'data-nl-multisel', 'data-nl-hover', 'data-nl-drop-inside', 'data-nl-regen-pending', 'draggable'];
          Array.prototype.slice.call(_clone.querySelectorAll('*')).forEach(function (el) {
            _STRIP.forEach(function (a) { el.removeAttribute(a); });
            if (el.style && el.style.cursor === 'text') el.style.cursor = '';
          });
          post('cleanHtml', { html: _clone.innerHTML });
          break;
        }
        case 'getSelectionTexts': {
          // Collect plain text of the current selection (single or multi) in
          // document order. Tag each target with data-nl-regen-pending="<idx>"
          // so applySelectionTexts can find them again without path math.
          //
          // IMPORTANT: regenerate walks DOWN to the deepest text-bearing leaf
          // (skipping gold-bullet sibling cells), unlike delete which climbs
          // UP via findBulletWrapper. Otherwise replacing textContent on a
          // bullet row would wipe the gold dot and reset inline color styles.
          document.querySelectorAll('[data-nl-regen-pending]').forEach(function (el) {
            el.removeAttribute('data-nl-regen-pending');
          });
          function findRegenTarget(start) {
            var node = start;
            while (node && node.children && node.children.length > 0) {
              // Bullet-row pattern: TR (or container) with 2 TD children, one
              // is the gold dot. Pick the text TD so regen leaves the dot alone.
              if (node.children.length === 2 &&
                  node.children[0].tagName === 'TD' && node.children[1].tagName === 'TD') {
                if (isGoldDotCell(node.children[0])) { node = node.children[1]; continue; }
                if (isGoldDotCell(node.children[1])) { node = node.children[0]; continue; }
              }
              // Otherwise descend into the child with the most text content so
              // we land on whichever element actually carries the styled copy.
              var bestChild = null;
              var bestLen = -1;
              for (var i = 0; i < node.children.length; i++) {
                var c = node.children[i];
                if (c.tagName === 'BR' || c.tagName === 'IMG' || c.tagName === 'HR') continue;
                var t = (c.textContent || '').trim().length;
                if (t > bestLen) { bestLen = t; bestChild = c; }
              }
              if (!bestChild || bestLen <= 0) break;
              node = bestChild;
            }
            return node;
          }
          var targets = [];
          var seen = new Set();
          function pushTarget(el) {
            if (!isSelectable(el)) return;
            var leaf = findRegenTarget(el);
            if (!leaf || seen.has(leaf)) return;
            seen.add(leaf); targets.push(leaf);
          }
          if (_sel) pushTarget(_sel);
          _selSet.forEach(function (el) { if (el !== _sel) pushTarget(el); });
          // Document order so multi-select (which builds in click order) lines up
          // with how the user reads them — important for the AI to keep flow.
          targets.sort(function (a, b) {
            if (a === b) return 0;
            var pos = a.compareDocumentPosition(b);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            return 0;
          });
          var regenItems = targets.map(function (el, idx) {
            el.setAttribute('data-nl-regen-pending', String(idx));
            // path/relPath let the parent update the SAME element in a sibling
            // language variant (used by the "all languages" regen flow).
            var dp = computeDomPathForEl(el);
            // Snapshot the effective text colour BEFORE regen. We force-set it
            // as inline style after replacing textContent so the new text
            // looks identical to the old one even if the colour was carried
            // by a child <span> that gets wiped on textContent assignment.
            var snapshotColor = '';
            try {
              var cs = window.getComputedStyle(el);
              snapshotColor = (el.style && el.style.color) || (cs && cs.color) || '';
            } catch (e) {}
            return {
              idx: idx,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
              path: Array.isArray(dp.path) ? dp.path : null,
              relPath: Array.isArray(dp.relPath) ? dp.relPath : null,
              locked: !!dp.locked,
              color: snapshotColor
            };
          });
          post('selectionTexts', { items: regenItems });
          break;
        }
        case 'applySelectionTexts': {
          var incoming = (d.v && Array.isArray(d.v.items)) ? d.v.items : [];
          var applied = 0;
          incoming.forEach(function (item) {
            if (!item || typeof item.idx !== 'number') return;
            var el = document.querySelector('[data-nl-regen-pending="' + item.idx + '"]');
            if (!el) return;
            // Capture effective colour BEFORE we wipe child elements via
            // textContent. If the colour was carried by an inner <span>, that
            // span is about to disappear — we want the new text to look the
            // same gold/whatever it was, so we force the inline colour back
            // onto the leaf after the swap.
            var preserveColor = '';
            try {
              var cs = window.getComputedStyle(el);
              preserveColor = (el.style && el.style.color) || (cs && cs.color) || '';
            } catch (e) {}
            el.textContent = String(item.text == null ? '' : item.text);
            if (preserveColor && !el.style.color) {
              el.style.color = preserveColor;
            }
            el.removeAttribute('data-nl-regen-pending');
            applied += 1;
          });
          // Belt-and-braces: any leftover markers should be cleared so the next
          // getCleanHtml call doesn't ship them into the saved workspace.
          document.querySelectorAll('[data-nl-regen-pending]').forEach(function (el) {
            el.removeAttribute('data-nl-regen-pending');
          });
          reportHeight();
          post('selectionApplied', { applied: applied });
          break;
        }
        case 'clearRegenPending': {
          document.querySelectorAll('[data-nl-regen-pending]').forEach(function (el) {
            el.removeAttribute('data-nl-regen-pending');
          });
          break;
        }
      }
    });

    post('ready'); reportHeight();
  };

  W.App.EditorIframeScript = { fn };
})();
