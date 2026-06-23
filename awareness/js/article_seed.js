/* ═══════════════════════════════════════════════════════════
   article_seed.js — seed the committed starter article set
   (article-seed/articles.js → window.App.ArticleSeed) into the user's
   IndexedDB on first launch, so anyone who opens the app has the same library
   with ZERO action. Best-effort: a seed failure never blocks the app.

   Idempotent: App.DB.saveArticles dedups by urlHash, AND a localStorage marker
   (set to the seed's length) skips the pass once applied — re-running when the
   committed seed grows. Rows are saved with { seeded:true } so the 90-day
   cleanup never prunes them.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

(function () {
  'use strict';
  const MARKER = 'awareness_article_seed_applied_v1';

  async function seedArticleLibrary() {
    try {
      const list = Array.isArray(window.App.ArticleSeed) ? window.App.ArticleSeed : [];
      if (!list.length) return;                       // nothing committed yet
      if (!window.App.DB || typeof window.App.DB.saveArticles !== 'function') return;
      let applied = '';
      try { applied = localStorage.getItem(MARKER) || ''; } catch (_e) { applied = ''; }
      if (applied === String(list.length)) return;    // already seeded this set
      await window.App.DB.saveArticles(list, { seeded: true });
      try { localStorage.setItem(MARKER, String(list.length)); } catch (_e) { /* private mode */ }
    } catch (_e) {
      /* never block the page on a seed failure */
    }
  }

  // Exposed for the home-page boot path: App.UI.init() awaits this right after
  // App.DB.open() and before the first loadFromDB(), so the seed lands before the
  // first render (no race) and there's a single, ordered driver (no double-seed).
  window.App.seedArticleLibrary = seedArticleLibrary;
})();
