/* ═══════════════════════════════════════════════════════════
   ui/sidebar_manager.js — sidebar feeds + keywords UI
   Extracted from ui_controller.js. Owns:
     - Sidebar feed list rendering
     - Sidebar keyword chip manager (critical / context / noise)
     - Add / remove keyword for each tier + reset to defaults
     - Add / remove custom feed source (used by both sidebar + config page)
   Reads UI._state for feedStats and UI._internals.{renderFeedStats,
   renderFeedDashboard} for cross-cluster nudges that still live in main.
   Exposes window.App.UISidebar with the public surface. Main keeps thin
   wrappers so HTML onclick handlers (`App.UI.addSidebarCriticalKeyword(...)`)
   keep working.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const UI = window.App && window.App.UI;
  if (!UI || !UI._state || !UI._internals) {
    console.error('[ui/sidebar_manager] App.UI._state and _internals are unavailable; check script load order.');
    return;
  }
  const state = UI._state;
  const I = UI._internals;
  const Utils = (window.App && window.App.Utils) || {};
  const escapeHtml = Utils.escapeHtml || ((s) => String(s == null ? '' : s));
  const showToast = Utils.showToast || (() => {});

  // Cross-cluster nudges: these stay in main because they're called from many
  // non-sidebar code paths. Read them live so they pick up later additions.
  function _renderFeedStats() {
    if (typeof I.renderFeedStats === 'function') I.renderFeedStats();
  }
  function _renderFeedDashboard() {
    if (typeof I.renderFeedDashboard === 'function') I.renderFeedDashboard();
  }

  function renderSidebarFeeds() {
    const el = document.getElementById('sb-feeds-list');
    if (!el) return;
    const feeds = window.App.RSSFetcher.getFeeds();
    const tiers = { 1: 'Government & Standards', 2: 'Enterprise Vendors', 3: 'Journalism & Awareness', 4: 'Custom Sources' };
    const grouped = { 1: [], 2: [], 3: [], 4: [] };
    feeds.forEach(f => {
      const bucket = f.custom ? 4 : f.tier;
      if (grouped[bucket]) grouped[bucket].push(f);
    });
    const hasFetched = Object.keys(state.feedStats).length > 0;
    const okCount = Object.values(state.feedStats).filter(s => s.ok).length;
    const total = feeds.length;
    let html = hasFetched
      ? `<div style="font-size:.55rem;color:var(--gray);padding:.25rem 0 .35rem;display:flex;gap:.4rem;flex-wrap:wrap"><span style="color:#4CAF7D">● ${okCount} live</span><span style="color:#E74C3C">● ${total - okCount} down</span><span>/ ${total} total</span></div>`
      : `<div style="font-size:.55rem;color:var(--gray);padding:.25rem 0 .35rem">Fetch news to check live status</div>`;
    for (const [tier, label] of Object.entries(tiers)) {
      const arr = grouped[tier];
      if (!arr.length) continue;
      html += `<div class="sb-feed-tier">${label} (${arr.length})</div>`;
      arr.forEach(f => {
        const s = state.feedStats[f.id];
        const dotClass = !s ? 'waiting' : (s.ok ? 'live' : 'dead');
        const cnt = s?.ok ? s.count : '';
        html += `<div class="sb-feed-item" title="${escapeHtml(f.site)}"><div class="sb-feed-dot ${dotClass}"></div><span class="sb-feed-icon">${f.icon}</span><span class="sb-feed-name">${escapeHtml(f.name)}</span>${cnt ? `<span class="sb-feed-cnt">${cnt}</span>` : ''}</div>`;
      });
    }
    el.innerHTML = html;
  }

  function renderSidebarKeywordManager() {
    const KS = window.App.KeywordStore;
    if (!KS) return;
    const critEl = document.getElementById('sb-critical-keyword-list');
    const ctxEl = document.getElementById('sb-context-keyword-list');
    const noiseEl = document.getElementById('sb-noise-keyword-list');
    if (!critEl || !ctxEl || !noiseEl) return;
    // Build chips with DOM APIs (textContent + addEventListener) instead of an
    // innerHTML string: a keyword is user input, and the previous markup put it
    // raw in the chip text and only single-quote-escaped in an inline onclick —
    // both XSS sinks (e.g. a keyword of `<img src=x onerror=…>` or `'+alert(1)+'`).
    // Behaviour is identical: each × removes its keyword.
    const fillChips = (el, keywords, remove) => {
      el.textContent = '';
      keywords.slice(0, 120).forEach((k) => {
        const chip = document.createElement('span');
        chip.className = 'sb-kword-chip';
        chip.appendChild(document.createTextNode(k));
        const btn = document.createElement('button');
        btn.textContent = '×';
        btn.addEventListener('click', () => remove(k));
        chip.appendChild(btn);
        el.appendChild(chip);
      });
    };
    fillChips(critEl, KS.getCriticalKeywords(), (k) => window.App.UI.removeSidebarCriticalKeyword(k));
    fillChips(ctxEl, KS.getContextKeywords(), (k) => window.App.UI.removeSidebarContextKeyword(k));
    fillChips(noiseEl, KS.getNoiseKeywords(), (k) => window.App.UI.removeSidebarNoiseKeyword(k));
  }

  function addSidebarCriticalKeyword() {
    const inp = document.getElementById('sb-critical-keyword-input');
    if (!inp) return;
    window.App.KeywordStore?.addKeyword?.('critical', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Critical keyword added.');
  }

  function addSidebarContextKeyword() {
    const inp = document.getElementById('sb-context-keyword-input');
    if (!inp) return;
    window.App.KeywordStore?.addKeyword?.('context', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Context keyword added.');
  }

  function addSidebarNoiseKeyword() {
    const inp = document.getElementById('sb-noise-keyword-input');
    if (!inp) return;
    window.App.KeywordStore?.addKeyword?.('noise', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Noise keyword added.');
  }

  function removeSidebarCriticalKeyword(keyword) {
    window.App.KeywordStore?.removeKeyword?.('critical', keyword);
    renderSidebarKeywordManager();
  }

  function removeSidebarContextKeyword(keyword) {
    window.App.KeywordStore?.removeKeyword?.('context', keyword);
    renderSidebarKeywordManager();
  }

  function removeSidebarNoiseKeyword(keyword) {
    window.App.KeywordStore?.removeKeyword?.('noise', keyword);
    renderSidebarKeywordManager();
  }

  function resetSidebarKeywords() {
    if (!confirm('Reset keywords to defaults?')) return;
    window.App.KeywordStore?.resetDefaults?.();
    renderSidebarKeywordManager();
    showToast('Keywords reset.');
  }

  function addFeedSource() {
    const nameEl = document.getElementById('feed-source-name');
    const urlEl = document.getElementById('feed-source-url');
    if (!nameEl || !urlEl || !window.App.RSSFetcher?.addCustomFeed) return;
    try {
      window.App.RSSFetcher.addCustomFeed({ name: nameEl.value, url: urlEl.value });
      nameEl.value = '';
      urlEl.value = '';
      _renderFeedStats();
      _renderFeedDashboard();
      renderSidebarFeeds();
      showToast('Feed source added.');
    } catch (e) {
      showToast(e?.message || 'Could not add source.', true);
    }
  }

  function removeFeedSource(feedId) {
    if (!feedId || !window.App.RSSFetcher?.removeCustomFeed) return;
    if (!confirm('Remove this custom feed source?')) return;
    const removed = window.App.RSSFetcher.removeCustomFeed(feedId);
    if (!removed) { showToast('Source not found.', true); return; }
    delete state.feedStats[feedId];
    _renderFeedStats();
    _renderFeedDashboard();
    renderSidebarFeeds();
    showToast('Feed source removed.');
  }

  window.App = window.App || {};
  window.App.UISidebar = {
    renderSidebarFeeds,
    renderSidebarKeywordManager,
    addSidebarCriticalKeyword,
    addSidebarContextKeyword,
    addSidebarNoiseKeyword,
    removeSidebarCriticalKeyword,
    removeSidebarContextKeyword,
    removeSidebarNoiseKeyword,
    resetSidebarKeywords,
    addFeedSource,
    removeFeedSource
  };
})();
