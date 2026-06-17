/* ═══════════════════════════════════════════════════════════
   advisory_db.js — App.AdvisoryDB
   A standalone IndexedDB database (separate from `SecurityAwareness`) that
   persists generated CVE advisories so they can be browsed later from the
   Projects page (Type → Advisories) and re-opened in the preview.

   Why separate: advisories are a distinct artefact from the newsletter/poster
   projects, with their own lifecycle. The Projects page READ-MERGES this store
   with the projects store rather than duplicating rows.

   Record shape (one saved advisory document = one generation run):
     { id, kind:'advisory', title, cveIds[], severities[], sources[],
       createdAt, updatedAt, workspace }
   `workspace` is a full newsletter-workspace snapshot (format:'advisory',
   variants with the rendered HTML) so re-opening reuses the existing preview /
   send / download / translate path verbatim.

   buildAdvisoryRecord() is pure (no Date / no IndexedDB) so it is unit-tested;
   the CRUD methods are thin IndexedDB wrappers mirroring App.DB's style.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.AdvisoryDB = (() => {
  'use strict';

  const DB_NAME = 'SecurityAdvisories';
  const DB_VERSION = 1;
  const STORE = 'advisories';

  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(new Error('AdvisoryDB: ' + (e.target.error)));
    });
  }

  // Pure: derive a saved-advisory record from a workspace + the advisory items.
  // `stampISO` is supplied by the caller (Date isn't reachable in the
  // deterministic unit-test sandbox). No id is assigned here — saveAdvisory mints
  // one — so the function stays a pure projection of its inputs.
  function buildAdvisoryRecord(workspace, items, stampISO) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const cveIds = [];
    const severities = [];
    const sources = [];
    for (const it of list) {
      const id = String((it && it.cveId) || '').trim();
      if (id && !cveIds.includes(id)) cveIds.push(id);
      const sev = String((it && it.severity) || '').trim();
      if (sev && !severities.includes(sev)) severities.push(sev);
      const src = String((it && it.source) || '').trim();
      if (src && !sources.includes(src)) sources.push(src);
    }
    const stamp = stampISO || '';
    const firstId = cveIds[0] || 'Advisory';
    const title = cveIds.length > 1
      ? `${firstId} +${cveIds.length - 1} more`
      : (String((list[0] && list[0].title) || '').trim() || firstId);
    return {
      kind: 'advisory',
      title,
      cveIds,
      severities,
      sources,
      createdAt: stamp,
      updatedAt: stamp,
      workspace: workspace ? JSON.parse(JSON.stringify(workspace)) : null
    };
  }

  async function saveAdvisory(record) {
    const d = await open();
    const now = new Date().toISOString();
    const rec = {
      ...record,
      id: (record && record.id) || `adv_${Date.now()}`,
      kind: 'advisory',
      createdAt: (record && record.createdAt) || now,
      updatedAt: now
    };
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve(rec);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllAdvisories() {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAdvisoryById(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteAdvisory(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    DB_NAME, STORE,
    open, buildAdvisoryRecord,
    saveAdvisory, getAllAdvisories, getAdvisoryById, deleteAdvisory
  };
})();
