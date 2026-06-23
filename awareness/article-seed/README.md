# article-seed

Committed **starter article set** for the curate/build flow. Lives in its own
top-level folder (not under `assets/`).

## How it works

`articles.js` sets `window.App.ArticleSeed = [ … ]` and is loaded via a plain
`<script>` (in `index.html`, right after `db.js`). On first launch the home page
seeds those articles into the user's IndexedDB via `App.DB.saveArticles(list, {seeded:true})`
— `App.UI.init()` awaits `App.seedArticleLibrary()` before the first DB read, so the
articles render with **zero action** (no button, no fetch).

- **Zero action for end users** — anyone who pulls the repo and opens `index.html`
  gets the same articles, no fetch, works offline / `file://`.
- **Idempotent** — `saveArticles` dedups by `urlHash`; a `localStorage` marker
  (`awareness_article_seed_applied_v1` = seed length) skips re-seeding until the
  committed set grows.
- **Permanent** — seeded rows carry `seeded:true` and are exempt from the 90-day
  `cleanup()`, so they never age out of a user's DB.

## How to (re)generate the seed — ONE-TIME author step

The articles live only in the author's browser IndexedDB, so they must be copied
into this file once:

1. Open the app, open DevTools console.
2. Run:
   ```js
   App.Utils.downloadHTML('articles.js', await App.DB.exportArticleSeed())
   ```
   (downloads `articles.js` — the exact file content).
3. Replace `article-seed/articles.js` with the downloaded file.
4. Commit + push. Every user who pulls now gets the set on next launch.

> `articles.js` is generated — do not hand-edit. Re-run the export to refresh it.
