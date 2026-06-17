// Pure helpers behind the "saved advisories in Projects" feature:
//   - App.AdvisoryDB.buildAdvisoryRecord(workspace, items, stampISO)
//   - App.ProjectStore.classifyKind(record)  →  'advisory' | 'poster' | 'newsletter'
// The IndexedDB CRUD in advisory_db.js is exercised by the functional/E2E path,
// not here; these tests cover the deterministic projections only.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function loadModule(relativePath) {
  const context = { console };
  context.window = context;
  context.App = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(rootDir, relativePath), "utf8"), context, {
    filename: path.join(rootDir, relativePath),
  });
  return context.App;
}

test.describe("AdvisoryDB.buildAdvisoryRecord", () => {
  const WORKSPACE = { format: "advisory", variants: { en: { html: "<p>hi</p>" } } };
  const ITEMS = [
    { cveId: "CVE-2026-0001", severity: "Critical", source: "NVD", title: "Critical RCE" },
    { cveId: "CVE-2026-0002", severity: "High", source: "Tenable", title: "High bypass" },
    { cveId: "CVE-2026-0001", severity: "Critical", source: "NVD", title: "dup id" },
  ];

  test("derives unique cveIds / severities / sources and a multi-CVE title", () => {
    const App = loadModule("js/advisory_db.js");
    const rec = App.AdvisoryDB.buildAdvisoryRecord(WORKSPACE, ITEMS, "2026-06-15T10:00:00.000Z");
    assert.equal(rec.kind, "advisory");
    assert.deepEqual([...rec.cveIds], ["CVE-2026-0001", "CVE-2026-0002"], "deduped, order-preserved");
    assert.deepEqual([...rec.severities], ["Critical", "High"]);
    assert.deepEqual([...rec.sources], ["NVD", "Tenable"]);
    assert.equal(rec.title, "CVE-2026-0001 +1 more", "title summarises the run");
    assert.equal(rec.createdAt, "2026-06-15T10:00:00.000Z");
    assert.equal(rec.updatedAt, "2026-06-15T10:00:00.000Z");
  });

  test("uses the single CVE's own title when only one advisory", () => {
    const App = loadModule("js/advisory_db.js");
    const rec = App.AdvisoryDB.buildAdvisoryRecord(WORKSPACE, [ITEMS[0]], "2026-06-15T10:00:00.000Z");
    assert.equal(rec.title, "Critical RCE");
    assert.deepEqual([...rec.cveIds], ["CVE-2026-0001"]);
  });

  test("deep-clones the workspace (no shared reference)", () => {
    const App = loadModule("js/advisory_db.js");
    const rec = App.AdvisoryDB.buildAdvisoryRecord(WORKSPACE, [ITEMS[0]], "2026-06-15T10:00:00.000Z");
    assert.notEqual(rec.workspace, WORKSPACE, "cloned, not the same object");
    assert.equal(rec.workspace.variants.en.html, "<p>hi</p>");
  });
});

test.describe("ProjectStore.classifyKind", () => {
  const withFormat = (fmt) => ({ snapshots: [{ version: 1, workspace: { format: fmt } }] });

  test("an explicit kind wins (advisory records)", () => {
    const App = loadModule("js/project_store.js");
    assert.equal(App.ProjectStore.classifyKind({ kind: "advisory" }), "advisory");
  });

  test("derives 'advisory' from a legacy snapshot format", () => {
    const App = loadModule("js/project_store.js");
    assert.equal(App.ProjectStore.classifyKind(withFormat("advisory")), "advisory");
  });

  test("classifies poster template ids and gen_* posters as 'poster'", () => {
    const App = loadModule("js/project_store.js");
    assert.equal(App.ProjectStore.classifyKind(withFormat("poster")), "poster");
    assert.equal(App.ProjectStore.classifyKind(withFormat("poster3")), "poster");
    assert.equal(App.ProjectStore.classifyKind(withFormat("gen_vishing")), "poster");
    assert.equal(App.ProjectStore.classifyKind(withFormat("redflags")), "poster");
  });

  test("everything else is a 'newsletter'", () => {
    const App = loadModule("js/project_store.js");
    assert.equal(App.ProjectStore.classifyKind(withFormat("people")), "newsletter");
    assert.equal(App.ProjectStore.classifyKind(withFormat("knowbe4")), "newsletter");
    assert.equal(App.ProjectStore.classifyKind({ snapshots: [] }), "newsletter");
  });

  test("uses the latest snapshot's format", () => {
    const App = loadModule("js/project_store.js");
    const rec = { snapshots: [
      { version: 1, workspace: { format: "people" } },
      { version: 2, workspace: { format: "poster1" } },
    ] };
    assert.equal(App.ProjectStore.classifyKind(rec), "poster");
  });
});
