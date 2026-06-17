/* ═══════════════════════════════════════════════════════════
   advisory_ui.js — App.AdvisoryUI
   Drives the Advisory generator flow (home page → "Advisory" section):
     1. Generator modal  — pick source (NVD/Qualys/Tenable), severity, optional CVE.
     2. Selection modal  — checkbox list of fetched CVEs; the user picks which to make.
     3. Duplicate modal  — if any picked CVE is in the dedup history, offer
                           Regenerate (all) or Cancel (skip the duplicates).
   Generated advisories are pushed into the app's EXISTING preview/workspace path
   so the existing relay-send + download + translate controls all apply (a static
   no-backend app can't send Gmail SMTP directly). Content is deterministic — the
   builder fills the template; AI is used only by the existing translation pass.

   Depends on: App.AdvisorySources, App.AdvisoryHistory, App.NewsletterBuilder,
   App.UI (_state + _internals), App.Utils.showToast.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.AdvisoryUI = (() => {
  'use strict';

  const toast = (m, e) => {
    try { (App.Utils && App.Utils.showToast) ? App.Utils.showToast(m, !!e) : console.log(m); }
    catch (_e) { /* no-op */ }
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let _fetched = [];  // last fetched advisories
  let _pending = [];  // CVEs selected, awaiting dup resolution / generate

  const MODALS = ['adv-gen-modal', 'adv-select-modal', 'adv-dup-modal'];
  function openModal(id) { const m = $(id); if (m) m.classList.add('active'); }
  function closeModal(id) { const m = $(id); if (m) m.classList.remove('active'); }
  function closeAll() { MODALS.forEach(closeModal); }

  function openGenerator() {
    closeAll();
    const s = $('adv-gen-status'); if (s) s.textContent = '';
    openModal('adv-gen-modal');
  }
  function close() { closeAll(); }
  function backToGenerator() { closeModal('adv-select-modal'); openModal('adv-gen-modal'); }

  function getSource() {
    const el = document.querySelector('input[name="adv-source"]:checked');
    return el ? el.value : 'nvd';
  }
  function getSeverities() {
    return [...document.querySelectorAll('input[name="adv-sev"]:checked')].map(x => x.value);
  }

  async function fetch() {
    if (!(App.AdvisorySources && typeof App.AdvisorySources.fetchAdvisories === 'function')) {
      toast('Advisory sources unavailable.', true); return;
    }
    const source = getSource();
    const severities = getSeverities();
    const cveCode = ($('adv-cve-code') ? $('adv-cve-code').value : '').trim();
    if (!severities.length && !cveCode) {
      toast('Pick at least one severity (or enter a CVE code).', true); return;
    }
    const btn = $('adv-fetch-btn');
    const status = $('adv-gen-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = `Fetching from ${source.toUpperCase()}…`;
    try {
      const items = await App.AdvisorySources.fetchAdvisories({ source, severities, cveCode });
      if (!items || !items.length) {
        if (status) status.textContent = '';
        toast(`No matching advisories found from ${source.toUpperCase()}.`, true);
        return;
      }
      _fetched = items;
      renderSelectList(items);
      closeModal('adv-gen-modal');
      openModal('adv-select-modal');
      if (status) status.textContent = '';
    } catch (e) {
      if (status) status.textContent = '';
      toast(`Fetch failed: ${(e && e.message) || 'network error'}.`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderSelectList(items) {
    const wrap = $('adv-select-list');
    if (!wrap) return;
    const AH = App.AdvisoryHistory;
    wrap.innerHTML = items.map((it, i) => {
      const dupe = (AH && AH.has) ? AH.has(it) : false;
      const date = esc(it.pubDate || '');
      return `<label class="adv-pick${dupe ? ' dupe' : ''}">`
        + `<input type="checkbox" name="adv-pick" value="${i}"> `
        + `<span class="adv-sev">${esc(it.severity)}</span> · ${esc(it.cveId)} `
        + (dupe ? '<span class="adv-note" style="display:inline">(already generated)</span>' : '')
        + `<br><span style="color:var(--wh,#eee)">${esc(it.title)}</span>`
        + (date ? `<br><span class="adv-note" style="display:inline">${date}</span>` : '')
        + `</label>`;
    }).join('');
    const note = $('adv-select-note');
    if (note) note.textContent = `${items.length} advisor${items.length === 1 ? 'y' : 'ies'} found. Tick the CVEs to generate (one advisory each).`;
  }

  function selectedItems() {
    return [...document.querySelectorAll('input[name="adv-pick"]:checked')]
      .map(x => _fetched[Number(x.value)]).filter(Boolean);
  }

  function generateSelected() {
    const items = selectedItems();
    if (!items.length) { toast('Select at least one advisory.', true); return; }
    _pending = items;
    const AH = App.AdvisoryHistory;
    const dupes = (AH && AH.has) ? items.filter(it => AH.has(it)) : [];
    if (dupes.length) {
      renderDupList(dupes);
      closeModal('adv-select-modal');
      openModal('adv-dup-modal');
      return;
    }
    runGenerate(items);
  }

  function renderDupList(dupes) {
    const wrap = $('adv-dup-list');
    if (!wrap) return;
    wrap.innerHTML = dupes.map(it =>
      `<div class="adv-pick dupe"><span class="adv-sev">${esc(it.severity)}</span> · ${esc(it.cveId)}`
      + `<br><span style="color:var(--wh,#eee)">${esc(it.title)}</span></div>`
    ).join('');
  }

  function confirmRegenerate() {
    closeModal('adv-dup-modal');
    runGenerate(_pending); // regenerate everything selected (incl. duplicates)
  }

  function cancelDuplicates() {
    const AH = App.AdvisoryHistory;
    const fresh = (AH && AH.has) ? _pending.filter(it => !AH.has(it)) : _pending;
    closeModal('adv-dup-modal');
    if (!fresh.length) {
      toast('All selected advisories were duplicates — nothing generated.');
      openModal('adv-select-modal');
      return;
    }
    runGenerate(fresh);
  }

  // Persist the generated advisory to App.AdvisoryDB so it shows up in the
  // Projects page (Type → Advisories) and can be re-opened later. Silent-fail:
  // renderToPreview already persisted the live workspace to localStorage, so a
  // storage error here must never block the generate flow.
  function saveToAdvisoryDb(items, stamp) {
    try {
      const ADB = App.AdvisoryDB;
      const UI = App.UI;
      if (!ADB || typeof ADB.saveAdvisory !== 'function' || !UI || !UI._state) return;
      const ws = UI._state.newsletterWorkspace;
      if (!ws) return;
      const rec = ADB.buildAdvisoryRecord(ws, items, stamp);
      Promise.resolve(ADB.saveAdvisory(rec)).catch(() => {});
    } catch (_e) { /* never block generation */ }
  }

  function runGenerate(items) {
    try {
      if (!renderToPreview(items)) return;
      const stamp = new Date().toISOString();
      const AH = App.AdvisoryHistory;
      if (AH && AH.record) items.forEach(it => AH.record(it, stamp));
      saveToAdvisoryDb(items, stamp);
      closeAll();
      toast(`Generated ${items.length} advisor${items.length === 1 ? 'y' : 'ies'}.`);
    } catch (e) {
      toast(`Generate failed: ${(e && e.message) || 'unknown error'}.`, true);
    }
  }

  // Build the advisory HTML and seed the existing newsletter workspace so the
  // app's preview panel (with its relay-send + download + translate controls)
  // renders it — same path buildAndPreview uses, minus the AI article pipeline.
  function renderToPreview(items) {
    const UI = App.UI;
    if (!UI || !UI._internals || !UI._state || !App.NewsletterBuilder) {
      toast('Preview pipeline unavailable.', true); return false;
    }
    const I = UI._internals;
    const state = UI._state;
    const cfg = { ...I.getConfig(), ...I.getMetadata() };
    const opts = (typeof I.getOptions === 'function') ? I.getOptions() : {};
    const html = App.NewsletterBuilder.build('advisory', cfg, items, opts);

    const variants = {};
    I.NEWSLETTER_LANGUAGES.forEach(l => {
      variants[l.id] = (l.id === 'en')
        ? I.makeVariant(html, '', { translatedFrom: null })
        : I.makeVariant('', '', { translatedFrom: 'en' });
    });

    state.activeProjectId = null;
    state.projectSnapshotVersion = null;
    state.activeDraftId = null;
    state.translationCache = {};
    state.selectedFormat = 'advisory';
    state.currentPreviewLanguage = 'en';
    state.newsletterWorkspace = {
      id: `nw_${Date.now()}`,
      createdAt: new Date().toISOString(),
      format: 'advisory',
      cfg, opts,
      articles: items,
      variants,
      currentLanguage: 'en',
      workflow: I.normalizeWorkflow(null)
    };
    try { I.persistWorkspace(); } catch (_e) {}
    try { I.refreshLanguageControls(); } catch (_e) {}
    try { I.renderWorkflowControls(); } catch (_e) {}
    const panel = $('preview-panel');
    if (panel) panel.classList.add('active');
    I.renderPreviewForLanguage('en');
    return true;
  }

  return {
    openGenerator, close, fetch, backToGenerator,
    generateSelected, confirmRegenerate, cancelDuplicates
  };
})();
