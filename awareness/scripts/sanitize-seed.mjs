// One-off: re-emit article-seed/articles.js through the hardened
// App.DB.buildArticleSeedBundle so any leaked secret (API key written into
// aiProcessed) is stripped. Safe to re-run; deterministic output.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Load db.js exactly like the unit test (browser IIFE → window.App.DB).
const dbCtx = { console };
dbCtx.window = dbCtx;
dbCtx.App = {};
vm.runInContext(readFileSync(path.join(root, "js/db.js"), "utf8"), vm.createContext(dbCtx), {
  filename: path.join(root, "js/db.js"),
});
const DB = dbCtx.App.DB;

// Load the current seed bundle to recover the article array.
const seedCtx = { console };
seedCtx.window = seedCtx;
seedCtx.App = {};
const seedPath = path.join(root, "article-seed/articles.js");
vm.runInContext(readFileSync(seedPath, "utf8"), vm.createContext(seedCtx), { filename: seedPath });
const articles = seedCtx.App.ArticleSeed || [];

const before = JSON.stringify(articles);
const SECRET = /(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{40,}/g;
const leaksBefore = (before.match(SECRET) || []).length;

const sanitized = DB.buildArticleSeedBundle(articles);
const leaksAfter = (sanitized.match(SECRET) || []).length;

writeFileSync(seedPath, sanitized);
console.log(`articles: ${articles.length}, key-shaped strings before: ${leaksBefore}, after: ${leaksAfter}`);
if (leaksAfter !== 0) { console.error("FAILED: secrets still present"); process.exit(1); }
