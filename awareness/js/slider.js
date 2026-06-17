/* ═══════════════════════════════════════════════════════════
   slider.js — App.Slider
   A dependency-free "voyage"-style carousel: the current item is centred
   and enlarged, its neighbours are angled at the sides, everything else is
   parked off-stage. Generalised from a fixed 3-slide demo to N slides via an
   offset-from-current model (data-current / data-next / data-previous /
   data-hidden states drive the CSS transforms).

   The module knows nothing about posters or templates — callers inject slide
   content and selection behaviour through callbacks, so it stays reusable and
   testable:

     App.Slider.create(mountEl, {
       items:        [{ id, title, subtitle, description }, …],
       renderSlide:  (wrapperEl, item, index) => void,   // lazily, 3 at a time
       onSelect:     (item) => void,                      // "Use this template"
       onPreview:    (item) => void,                      // optional 👁 button
       startId:      'poster'                             // optional initial centre
     }) → instance ({ next, prev, goTo, goToId, getCurrent, refit, currentIndex })

   App.Slider.goToId(id) centres whichever instance owns that id (deep-link/tests).
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.Slider = (() => {
  'use strict';

  const ARROW_PREV = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const ARROW_NEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  const instances = [];

  function el(tag, cls, attrs) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function create(mountEl, opts = {}) {
    const items = Array.isArray(opts.items) ? opts.items : [];
    if (!mountEl || !items.length) return null;

    const renderSlide = typeof opts.renderSlide === 'function' ? opts.renderSlide : () => {};
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : () => {};
    const onPreview = typeof opts.onPreview === 'function' ? opts.onPreview : null;
    // Opt-in flip: when both are provided, clicking the centred card flips it to a
    // caller-rendered back face instead of selecting. renderBack(backEl, item,
    // { close, index }) returns truthy if this item is flippable; a falsy return
    // means the item selects normally (so a slider can mix flip + non-flip cards).
    const renderBack = typeof opts.renderBack === 'function' ? opts.renderBack : null;
    const flipEnabled = !!opts.flipOnSelect && !!renderBack;

    // ── Build DOM ──
    const root = el('div', `tpl-slider${flipEnabled ? ' tpl-slider--flip' : ''}`, { tabindex: '0', role: 'group', 'aria-roledescription': 'carousel' });
    const prevBtn = el('button', 'slider--btn slider--btn__prev', { type: 'button', 'aria-label': 'Previous template' });
    const nextBtn = el('button', 'slider--btn slider--btn__next', { type: 'button', 'aria-label': 'Next template' });
    prevBtn.innerHTML = ARROW_PREV;
    nextBtn.innerHTML = ARROW_NEXT;

    const wrapper = el('div', 'slides__wrapper');
    const slides = el('div', 'slides');
    const infos = el('div', 'slides--infos');
    wrapper.append(slides, infos);
    root.append(prevBtn, wrapper, nextBtn);

    const slideNodes = [];
    const infoNodes = [];
    // Per-slide flip bookkeeping: { rendered, flippable } decided lazily on first
    // click of the centred card.
    const backState = [];
    // Track swipe so a drag doesn't also register as a select-click.
    let dragX = null;
    let swiped = false;

    items.forEach((item, i) => {
      const slide = el('div', 'slide', { 'data-id': item.id });
      const frontInner =
        '<div class="slide--image__wrapper"><div class="slide--placeholder">…</div></div>' +
        '<span class="slide--selected-badge">✓ Selected</span>';
      slide.innerHTML = flipEnabled
        ? '<div class="slide__inner">'
            + '<div class="slide__face slide__front">' + frontInner + '</div>'
            + '<div class="slide__face slide__back"></div>'
          + '</div>'
        : '<div class="slide__inner">' + frontInner + '</div>';

      const info = el('div', 'slide-info', { 'data-id': item.id });
      const title = (item.title || item.id || '');
      const subtitle = (item.subtitle || '');
      const description = (item.description || '');
      info.innerHTML =
        '<div class="slide-info__inner"><div class="slide-info--text__wrapper">' +
          '<div data-title class="slide-info--text"><span></span></div>' +
          '<div data-subtitle class="slide-info--text"><span></span></div>' +
          '<div data-description class="slide-info--text"><span></span></div>' +
          '<div class="slide-info--actions">' +
            (onPreview ? '<button type="button" class="slide-info--btn preview">👁 Preview</button>' : '') +
          '</div>' +
        '</div></div>';
      // textContent (not innerHTML) for catalog strings — avoids injection.
      info.querySelector('[data-title] span').textContent = title;
      info.querySelector('[data-subtitle] span').textContent = subtitle;
      info.querySelector('[data-description] span').textContent = description;

      if (onPreview) info.querySelector('.slide-info--btn.preview').addEventListener('click', () => onPreview(item));

      // Left-click anywhere on the poster selects that template for generation
      // (a real swipe sets `swiped`, which suppresses the trailing click).
      // In flip mode: a side card centres first; the centred card flips to its
      // back face (lazily rendered) when flippable, else selects normally.
      slide.addEventListener('click', () => {
        if (swiped) return;
        if (flipEnabled) {
          if (i !== currentIndex) { goTo(i); return; }
          if (!backState[i] || !backState[i].rendered) {
            const backEl = slide.querySelector('.slide__back');
            let flippable = false;
            try {
              flippable = backEl
                ? !!renderBack(backEl, item, { close: () => slide.classList.remove('is-flipped'), index: i })
                : false;
            } catch (_e) { flippable = false; }
            backState[i] = { rendered: true, flippable };
          }
          if (backState[i].flippable) { slide.classList.toggle('is-flipped'); return; }
        }
        onSelect(item);
      });

      slides.appendChild(slide);
      infos.appendChild(info);
      slideNodes.push(slide);
      infoNodes.push(info);
    });

    mountEl.innerHTML = '';
    mountEl.appendChild(root);

    // ── State ──
    const N = items.length;
    const rendered = new Set();
    let currentIndex = 0;
    if (opts.startId) {
      const i = items.findIndex((it) => it.id === opts.startId);
      if (i >= 0) currentIndex = i;
    }

    function ensureRendered(i) {
      if (i < 0 || i >= N || rendered.has(i)) return;
      rendered.add(i);
      const wrap = slideNodes[i].querySelector('.slide--image__wrapper');
      renderSlide(wrap, items[i], i);
    }

    function setSlideState(node, off) {
      node.removeAttribute('data-current');
      node.removeAttribute('data-next');
      node.removeAttribute('data-previous');
      node.removeAttribute('data-hidden');
      node.style.setProperty('--dir', off === 0 ? 0 : (off > 0 ? 1 : -1));
      if (off === 0) { node.setAttribute('data-current', ''); node.style.zIndex = '20'; }
      else if (off === 1) { node.setAttribute('data-next', ''); node.style.zIndex = '10'; }
      else if (off === -1) { node.setAttribute('data-previous', ''); node.style.zIndex = '10'; }
      else { node.setAttribute('data-hidden', ''); node.style.zIndex = '1'; }
    }

    function layout() {
      slideNodes.forEach((sl, i) => setSlideState(sl, i - currentIndex));
      infoNodes.forEach((inf, i) => {
        if (i === currentIndex) inf.setAttribute('data-current', '');
        else inf.removeAttribute('data-current');
      });
      [currentIndex - 1, currentIndex, currentIndex + 1].forEach(ensureRendered);
      prevBtn.disabled = currentIndex <= 0;
      nextBtn.disabled = currentIndex >= N - 1;
      root.setAttribute('aria-label', `Template ${currentIndex + 1} of ${N}: ${items[currentIndex].title || items[currentIndex].id}`);
    }

    function goTo(i) {
      const next = Math.max(0, Math.min(N - 1, i));
      if (next === currentIndex) return;
      // Never leave a card flipped once it scrolls off-centre.
      if (flipEnabled) slideNodes.forEach((s) => s.classList.remove('is-flipped'));
      currentIndex = next;
      layout();
    }
    const next = () => goTo(currentIndex + 1);
    const prev = () => goTo(currentIndex - 1);
    function goToId(id) {
      const i = items.findIndex((it) => it.id === id);
      if (i < 0) return false;
      goTo(i);
      return true;
    }

    // ── Controls ──
    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { prev(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { next(); e.preventDefault(); }
    });

    // Basic horizontal swipe. Mark `swiped` so the trailing click doesn't select.
    wrapper.addEventListener('pointerdown', (e) => { dragX = e.clientX; swiped = false; });
    wrapper.addEventListener('pointerup', (e) => {
      if (dragX === null) return;
      const dx = e.clientX - dragX;
      dragX = null;
      if (Math.abs(dx) > 40) { swiped = true; if (dx < 0) next(); else prev(); setTimeout(() => { swiped = false; }, 0); }
    });

    layout();

    const instance = {
      root, items, next, prev, goTo, goToId,
      getCurrent: () => items[currentIndex],
      get currentIndex() { return currentIndex; },
      // Re-run renderSlide's fit for visible slides (e.g. after the section
      // unfolds from a collapsed <details>). Callers fit via ResizeObserver,
      // so this just nudges a relayout.
      refit: () => layout()
    };
    instances.push(instance);
    return instance;
  }

  // Centre whichever instance owns `id`. Returns true if found.
  function goToId(id) {
    for (const inst of instances) {
      if (inst.items.some((it) => it.id === id)) return inst.goToId(id);
    }
    return false;
  }

  return { create, goToId, instances };
})();
