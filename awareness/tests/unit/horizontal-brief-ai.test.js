// gen_horizontal_brief is a landscape static design replica whose BODY text is
// AI-wired (mirrors gen_wifi_safety): fillNewsletterTextSlots('gen_horizontal_brief', …)
// returns article-driven copy (heading + intro + 4 tips) when an AI key is present,
// which static_replicas.js injects into the #nl-hb-* hooks. The design never changes.
// With NO AI it returns {} so the authored replica renders byte-identical. These tests
// lock: the no-AI contract, the injection hooks in the replica HTML + the inlined bundle,
// and that the "PUBLIC" classification line was removed from EVERY pipeline replica.

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const pipelineDir = path.join(rootDir, "templates/reference/pipeline");

function loadScript(context, relativePath) {
  vm.runInContext(readFileSync(path.join(rootDir, relativePath), "utf8"), context, {
    filename: path.join(rootDir, relativePath),
  });
}

function aiContext() {
  const context = {
    window: {},
    fetch: async () => ({ ok: false }),
    TextDecoder, TextEncoder, Uint8Array,
    console, setTimeout, clearTimeout,
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {},
      truncate(v, n) { return String(v || "").slice(0, n); },
      wait(ms) { return new Promise((r) => setTimeout(r, ms)); },
    },
  };
  return vm.createContext(context);
}

function loadAISummarizer(context) {
  loadScript(context, "js/ai/prompts.js");
  loadScript(context, "js/ai/local_fallbacks.js");
  loadScript(context, "js/ai_summarizer.js");
  return context.App.AISummarizer;
}

const ARTS = [{
  title: "Spear-phishing wave impersonates the IT helpdesk to harvest logins",
  type: "Phishing",
  summary: "Targeted emails spoof the internal helpdesk and ask staff to 'verify' their password on a look-alike portal.",
}];

test("gen_horizontal_brief with no AI surfaces the article's own headline as the poster heading", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_horizontal_brief", ARTS, { forceLocal: true });
  // Heading comes from the article title (no AI needed). Intro + tips stay authored, so the
  // ONLY slot returned is the heading.
  assert.deepEqual(Object.keys(slots), ["nlHbHeading"], "no-AI sets only the heading");
  assert.ok(
    String(slots.nlHbHeading).startsWith("Spear-phishing wave impersonates"),
    "heading is the selected article's own title, not an AI-invented topic"
  );
});

test("gen_horizontal_brief with no AI and no article returns {} (authored design unchanged)", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_horizontal_brief", [], { forceLocal: true });
  assert.equal(Object.keys(slots).length, 0, "no article → no slots → authored static poster renders byte-identical");
});

test("the Horizontal Brief replica HTML carries the injection hooks (heading + intro + 4 tips + source)", () => {
  const html = readFileSync(path.join(pipelineDir, "horizontal_brief_replica.html"), "utf8");
  assert.ok(html.includes('id="nl-hb-heading"'), "heading hook present (topic derived from the article)");
  assert.ok(html.includes('id="nl-hb-intro"'), "intro hook present");
  for (let i = 1; i <= 4; i++) {
    assert.ok(html.includes(`id="nl-hb-tip${i}"`), `tip${i} hook present`);
  }
  assert.ok(html.includes('id="nl-hb-source-row"'), "source-attribution row hook present");
  assert.ok(html.includes('id="nl-hb-source-name"'), "source-name hook present");
  assert.ok(html.includes('id="nl-hb-source-link"'), "source-link hook present");
});

test("the inlined static-replica bundle carries the Horizontal Brief hooks (runtime injection works)", () => {
  const bundle = readFileSync(path.join(rootDir, "js/newsletter/static_replicas_data.js"), "utf8");
  assert.ok(bundle.includes("nl-hb-heading"), "bundle has the heading hook (regenerated after the HTML edit)");
  assert.ok(bundle.includes("nl-hb-intro"), "bundle has the intro hook");
  assert.ok(bundle.includes("nl-hb-tip4"), "bundle has the tip hooks");
  assert.ok(bundle.includes("nl-hb-source-row"), "bundle has the source-row hook");
});

test('the "PUBLIC" classification line is removed from every pipeline replica + the bundle', () => {
  const htmlFiles = readdirSync(pipelineDir).filter((f) => f.endsWith(".html"));
  assert.ok(htmlFiles.length > 0, "found pipeline replica HTML files");
  for (const f of htmlFiles) {
    const html = readFileSync(path.join(pipelineDir, f), "utf8");
    assert.ok(!html.includes("PUBLIC classification"), `${f} must not keep the PUBLIC classification comment`);
    assert.ok(!html.includes(">Public</td>"), `${f} must not render the PUBLIC classification cell`);
  }
  const bundle = readFileSync(path.join(rootDir, "js/newsletter/static_replicas_data.js"), "utf8");
  assert.ok(!bundle.includes("PUBLIC classification"), "the inlined bundle must not carry the PUBLIC classification either");
  assert.ok(!bundle.includes(">Public</td>"), "the inlined bundle must not render the PUBLIC classification cell");
});
