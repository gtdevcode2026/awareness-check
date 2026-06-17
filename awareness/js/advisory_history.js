/* ═══════════════════════════════════════════════════════════
   advisory_history.js — App.AdvisoryHistory
   Separate dedup history for generated CVE advisories. Mirrors the Python
   tool's sent_cache.json: every generated advisory is persisted so a re-generate
   of the same CVE can warn "already generated this before" (Regenerate / Cancel).

   Persistence: localStorage key `awareness_advisory_history_v1` — a plain
   { [CVE_ID]: record } map (no IndexedDB schema bump). Records are saved under
   the name format "Advisory : {Severity} {Title}".

   This module is pure storage. The UI (App.AdvisoryUI) calls record() after a
   build and checks has()/get() before generating. Stamp generatedAt at the
   caller (Date isn't reachable inside the deterministic unit-test sandbox).
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.AdvisoryHistory = (() => {
  'use strict';
  const STORAGE_KEY = 'awareness_advisory_history_v1';

  function safeStore() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (_e) { /* access can throw in locked-down contexts */ }
    return null;
  }

  // Normalize a CVE (object or string) to its uppercase id, the map key.
  function key(cve) {
    if (typeof cve === 'string') return cve.trim().toUpperCase();
    const id = (cve && (cve.cveId || cve.key)) || '';
    return String(id).trim().toUpperCase();
  }

  function recordName(severity, title) {
    return `Advisory : ${String(severity || '').trim()} ${String(title || '').trim()}`.trim();
  }

  function loadAll() {
    const store = safeStore();
    if (!store) return {};
    try {
      const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '{}');
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (_e) { return {}; }
  }

  function saveAll(map) {
    const store = safeStore();
    if (!store) return;
    try { store.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (_e) { /* quota/full */ }
  }

  function has(cve) {
    const k = key(cve);
    if (!k) return false;
    return Object.prototype.hasOwnProperty.call(loadAll(), k);
  }

  function get(cve) {
    const k = key(cve);
    if (!k) return null;
    return loadAll()[k] || null;
  }

  // Persist a generated advisory. `generatedAt` is an ISO timestamp supplied by
  // the caller. Re-recording the same CVE id overwrites (the Regenerate path).
  function record(cve, generatedAt) {
    const k = key(cve);
    if (!k) return null;
    const severity = (cve && cve.severity) || '';
    const title = (cve && cve.title) || '';
    const rec = {
      key: k,
      name: recordName(severity, title),
      cveId: (cve && cve.cveId) || k,
      severity: String(severity).trim(),
      title: String(title).trim(),
      source: (cve && cve.source) || '',
      pubDate: (cve && cve.pubDate) || '',
      generatedAt: generatedAt || ''
    };
    const map = loadAll();
    map[k] = rec;
    saveAll(map);
    return rec;
  }

  // All records, newest generatedAt first.
  function list() {
    return Object.values(loadAll())
      .sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
  }

  function remove(cve) {
    const k = key(cve);
    if (!k) return false;
    const map = loadAll();
    if (!Object.prototype.hasOwnProperty.call(map, k)) return false;
    delete map[k];
    saveAll(map);
    return true;
  }

  function clear() {
    saveAll({});
  }

  return { STORAGE_KEY, key, recordName, has, get, record, list, remove, clear };
})();
