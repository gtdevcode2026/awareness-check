// Advisory dedup history store (js/advisory_history.js → App.AdvisoryHistory).
//
// Mirrors the Python tool's sent_cache.json: every generated advisory is
// persisted separately so a re-generate of the same CVE can warn "already
// generated this before" (Regenerate / Cancel). Records are keyed by CVE id and
// saved under the name format "Advisory : {Severity} {Title}".
//
// This guards the pure persistence API (key/has/get/record/list/remove) against
// a stubbed localStorage — no DOM, no network.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function makeLocalStorage() {
  const mem = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
    _mem: mem,
  };
}

function loadHistory() {
  const localStorage = makeLocalStorage();
  const context = { window: {}, localStorage, console };
  context.window = context;
  context.App = {};
  const ctx = vm.createContext(context);
  vm.runInContext(readFileSync(path.join(rootDir, "js/advisory_history.js"), "utf8"), ctx, {
    filename: path.join(rootDir, "js/advisory_history.js"),
  });
  return { AH: ctx.App.AdvisoryHistory, localStorage };
}

const CVE_A = {
  cveId: "CVE-2026-31431",
  severity: "Critical",
  title: "Copy-Paste RCE in Build Tool",
  source: "NVD",
  pubDate: "2026-06-10T08:00:00Z",
};

test.describe("AdvisoryHistory persistence API", () => {
  test("record() stores under name 'Advisory : {Severity} {Title}' and persists to localStorage", () => {
    const { AH, localStorage } = loadHistory();
    const rec = AH.record(CVE_A, "2026-06-15T09:00:00Z");
    assert.equal(rec.name, "Advisory : Critical Copy-Paste RCE in Build Tool");
    assert.equal(rec.cveId, "CVE-2026-31431");
    assert.equal(rec.severity, "Critical");
    assert.equal(rec.generatedAt, "2026-06-15T09:00:00Z");
    // Persisted under the documented localStorage key as JSON.
    const raw = localStorage.getItem("awareness_advisory_history_v1");
    assert.ok(raw && raw.includes("CVE-2026-31431"), "persisted to localStorage");
  });

  test("has()/get() detect a previously generated CVE (case-insensitive id)", () => {
    const { AH } = loadHistory();
    assert.equal(AH.has(CVE_A), false, "unknown CVE not in history");
    AH.record(CVE_A, "2026-06-15T09:00:00Z");
    assert.equal(AH.has(CVE_A), true, "known CVE detected");
    assert.equal(AH.has("cve-2026-31431"), true, "lookup by lowercase string id");
    const got = AH.get("CVE-2026-31431");
    assert.equal(got.title, "Copy-Paste RCE in Build Tool");
  });

  test("list() returns all records; remove() deletes one", () => {
    const { AH } = loadHistory();
    AH.record(CVE_A, "2026-06-15T09:00:00Z");
    AH.record({ cveId: "CVE-2026-0001", severity: "High", title: "Second", source: "Tenable", pubDate: "2026-06-09" }, "2026-06-15T10:00:00Z");
    assert.equal(AH.list().length, 2);
    assert.equal(AH.remove("CVE-2026-0001"), true);
    assert.equal(AH.list().length, 1);
    assert.equal(AH.remove("CVE-2026-0001"), false, "removing again is a no-op");
    assert.equal(AH.has(CVE_A), true, "other record untouched");
  });

  test("re-record() of the same CVE overwrites (Regenerate), not duplicates", () => {
    const { AH } = loadHistory();
    AH.record(CVE_A, "2026-06-15T09:00:00Z");
    AH.record({ ...CVE_A, title: "Renamed" }, "2026-06-16T09:00:00Z");
    assert.equal(AH.list().length, 1, "same CVE id stays a single record");
    assert.equal(AH.get(CVE_A).name, "Advisory : Critical Renamed");
    assert.equal(AH.get(CVE_A).generatedAt, "2026-06-16T09:00:00Z");
  });

  test("blank/invalid CVE id is ignored (no crash, no record)", () => {
    const { AH } = loadHistory();
    assert.equal(AH.record({ severity: "Critical", title: "No id" }, "2026-06-15"), null);
    assert.equal(AH.has(""), false);
    assert.equal(AH.list().length, 0);
  });
});
