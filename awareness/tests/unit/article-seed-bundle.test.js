// App.DB.buildArticleSeedBundle — pure serializer that turns an article array into the
// exact text of article-seed/articles.js (the committed starter set seeded into
// every user's DB on first launch). Guards: only saveArticles-consumed fields survive,
// derived/internal fields (id, *Hash, fetchedAt, seeded) are dropped, output is a
// loadable `window.App.ArticleSeed = [...]` bundle. No IndexedDB needed (pure).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadDB() {
  const context = { window: {}, console };
  context.window = context;
  context.App = {};
  const ctx = vm.createContext(context);
  vm.runInContext(readFileSync(path.join(rootDir, "js/db.js"), "utf8"), ctx, {
    filename: path.join(rootDir, "js/db.js"),
  });
  return ctx.App.DB;
}

function arrayFromBundle(bundle) {
  const m = bundle.match(/window\.App\.ArticleSeed = (\[[\s\S]*\]);\s*$/);
  assert.ok(m, "bundle assigns window.App.ArticleSeed to a JSON array");
  return JSON.parse(m[1]);
}

const RECORD = {
  // fields saveArticles consumes
  title: "Phishing wave hits finance teams", source: "Test Source", sourceId: "test",
  url: "https://example.test/a", description: "desc", summary: "sum",
  watchouts: ["verify sender"], pubDate: "2024-01-02T03:04:00Z", type: "Phishing",
  threatLevel: "High", relevanceScore: 12, tier: 2, aiProcessed: true,
  // derived/internal fields that must NOT ship in the seed
  id: 5, urlHash: "abc", titleHash: "def", seeded: true, fetchedAt: "2026-06-23T00:00:00Z",
};

test("buildArticleSeedBundle emits a loadable window.App.ArticleSeed bundle", () => {
  const DB = loadDB();
  const bundle = DB.buildArticleSeedBundle([RECORD]);
  assert.match(bundle, /^\/\/ AUTO-GENERATED/, "carries the do-not-edit header");
  assert.match(bundle, /window\.App = window\.App \|\| \{\};/, "is self-contained (defines App)");
  const arr = arrayFromBundle(bundle);
  assert.equal(arr.length, 1);
  const a = arr[0];
  // saveArticles-consumed fields survive
  assert.equal(a.title, RECORD.title);
  assert.equal(a.url, RECORD.url);
  assert.deepEqual(a.watchouts, RECORD.watchouts);
  assert.equal(a.tier, 2);
  assert.equal(a.aiProcessed, true);
  // derived/internal fields are dropped
  for (const k of ["id", "urlHash", "titleHash", "seeded", "fetchedAt"]) {
    assert.ok(!(k in a), `seed must not carry internal field: ${k}`);
  }
});

test("buildArticleSeedBundle on empty / non-array input yields an empty seed", () => {
  const DB = loadDB();
  assert.match(DB.buildArticleSeedBundle([]), /window\.App\.ArticleSeed = \[\];/);
  assert.match(DB.buildArticleSeedBundle(undefined), /window\.App\.ArticleSeed = \[\];/);
});

// Secret shapes that must never reach a committed, public seed file.
const SECRET_RE = /(?:sk|pk|rk)-(?:proj-|live-|test-)?[A-Za-z0-9_-]{40,}|gh[posu]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,}/;
const FAKE_KEY = "sk-proj-" + "A1b2C3d4".repeat(20); // 168 chars, key-shaped

test("buildArticleSeedBundle coerces aiProcessed to a boolean (never a leaked key)", () => {
  const DB = loadDB();
  // Regression: a past data bug wrote the API key into aiProcessed; the export
  // must serialize a boolean, never the key string.
  const bundle = DB.buildArticleSeedBundle([{ ...RECORD, aiProcessed: FAKE_KEY }]);
  assert.doesNotMatch(bundle, SECRET_RE, "no API-key shape survives in the bundle");
  const a = arrayFromBundle(bundle)[0];
  assert.equal(typeof a.aiProcessed, "boolean", "aiProcessed is a boolean");
  assert.equal(a.aiProcessed, true, "a present (truthy) value means it was processed");
  // false / empty / null collapse to false; an explicit boolean is preserved
  assert.equal(arrayFromBundle(DB.buildArticleSeedBundle([{ ...RECORD, aiProcessed: "false" }]))[0].aiProcessed, false);
  assert.equal(arrayFromBundle(DB.buildArticleSeedBundle([{ ...RECORD, aiProcessed: "" }]))[0].aiProcessed, false);
});

test("buildArticleSeedBundle scrubs key-shaped strings from any field", () => {
  const DB = loadDB();
  const bundle = DB.buildArticleSeedBundle([{
    ...RECORD,
    description: `leaked ${FAKE_KEY} here`,
    summary: FAKE_KEY,
    watchouts: [`token ${FAKE_KEY}`],
  }]);
  assert.doesNotMatch(bundle, SECRET_RE, "no secret survives in any field");
  assert.match(bundle, /\[REDACTED\]/, "matches are redacted, not silently dropped");
  // A short "sk-…"-style URL slug is NOT a secret and must be preserved verbatim.
  const slug = "https://example.test/sk-breach-exposes-dev-pipeline-risk";
  const kept = arrayFromBundle(DB.buildArticleSeedBundle([{ ...RECORD, url: slug }]))[0];
  assert.equal(kept.url, slug, "legitimate sk-… slugs are not touched");
});

test("the committed article-seed/articles.js contains no secrets", () => {
  // Guards the real shipped file (public repo) — the actual leak that triggered this.
  const seed = readFileSync(path.join(rootDir, "article-seed/articles.js"), "utf8");
  const m = seed.match(new RegExp(SECRET_RE, "g"));
  assert.equal(m, null, `committed seed must not contain secrets, found: ${m && m.length}`);
});
