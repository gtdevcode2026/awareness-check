// Phase 2: org-configurable CORS proxy (App.RSSFetcher.getConfiguredProxy /
// buildConfiguredProxyUrl). Restricted/corporate networks often block the public
// proxies; an org can point the app at a proxy their network allows, persisted in
// localStorage under `awareness_cors_proxy_url_v1`. These guard the pure URL contract
// and the http(s) gate. rss_fetcher.js only needs App.Utils.log at load time.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");
const KEY = "awareness_cors_proxy_url_v1";

function makeLocalStorage(init) {
  const store = { ...(init || {}) };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

function loadRSSFetcher(localStorageImpl) {
  const dom = new JSDOM("<!DOCTYPE html><html></html>", { url: "https://example.test/" });
  const context = {
    window: {},
    console,
    DOMParser: dom.window.DOMParser,
    setTimeout,
    clearTimeout,
    AbortController,
    localStorage: localStorageImpl || makeLocalStorage(),
    fetch: async () => { throw new Error("no network in unit test"); },
    performance: { now: () => 0 },
    navigator: { hardwareConcurrency: 4 },
  };
  context.window = context;
  context.App = { Utils: { log: () => {} } };
  const ctx = vm.createContext(context);
  vm.runInContext(readFileSync(path.join(rootDir, "js/rss_fetcher.js"), "utf8"), ctx, {
    filename: path.join(rootDir, "js/rss_fetcher.js"),
  });
  return ctx.App.RSSFetcher;
}

test("buildConfiguredProxyUrl substitutes {url} or appends the encoded target", () => {
  const RF = loadRSSFetcher();
  const target = "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-0001";
  const enc = encodeURIComponent(target);
  assert.equal(RF.buildConfiguredProxyUrl("https://p.ex/?url={url}", target), `https://p.ex/?url=${enc}`,
    "{url} placeholder is replaced with the encoded target");
  assert.equal(RF.buildConfiguredProxyUrl("https://p.ex/?url=", target), `https://p.ex/?url=${enc}`,
    "without a placeholder the encoded target is appended");
});

test("getConfiguredProxy is null unless a valid http(s) proxy is configured", () => {
  assert.equal(loadRSSFetcher(makeLocalStorage()).getConfiguredProxy(), null,
    "unset → null (public pool used)");
  assert.equal(loadRSSFetcher(makeLocalStorage({ [KEY]: "   " })).getConfiguredProxy(), null,
    "blank → null");
  assert.equal(loadRSSFetcher(makeLocalStorage({ [KEY]: "ftp://nope/?url=" })).getConfiguredProxy(), null,
    "non-http(s) scheme is ignored");
});

test("getConfiguredProxy returns a builder that proxies the target when configured", () => {
  const RF = loadRSSFetcher(makeLocalStorage({ [KEY]: "https://p.ex/?url={url}" }));
  const mk = RF.getConfiguredProxy();
  assert.equal(typeof mk, "function");
  const target = "https://t.ex/a?b=c";
  assert.equal(mk(target), `https://p.ex/?url=${encodeURIComponent(target)}`);
});
