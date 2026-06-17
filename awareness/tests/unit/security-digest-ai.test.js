// gen_security_digest is a static "design replica" (weekly_security_report_replica.html)
// whose BODY text is AI-wired: fillNewsletterTextSlots('gen_security_digest', …) returns
// article-driven copy (topic heading + intro + 4 points) when an AI key is present, which
// static_replicas.js injects into the #nl-sd-* hooks. The authored design never changes.
// With NO AI it returns {} so the authored digest renders byte-identical. Mirrors
// wifi-safety-ai.test.js.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
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
  title: "Fake job-application emails drop GoldenEye ransomware on HR teams",
  type: "Phishing",
  summary: "Attackers email HR staff a CV that, when opened, encrypts the device and demands payment.",
}];

test("gen_security_digest with no AI returns {} so the authored digest renders unchanged", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_security_digest", ARTS, { forceLocal: true });
  assert.ok(slots && typeof slots === "object", "returns an object");
  assert.equal(Object.keys(slots).length, 0, "no-AI must return no slots → the authored digest keeps its design + copy");
});

test("the Security Digest replica HTML carries the injection hooks (heading + intro + 4 points)", () => {
  const html = readFileSync(path.join(pipelineDir, "weekly_security_report_replica.html"), "utf8");
  assert.ok(html.includes('id="nl-sd-heading"'), "heading hook present (topic derived from the article)");
  assert.ok(html.includes('id="nl-sd-intro"'), "intro hook present");
  for (let i = 1; i <= 4; i++) {
    assert.ok(html.includes(`id="nl-sd-point${i}"`), `point${i} hook present`);
  }
});

test("the inlined static-replica bundle carries the Security Digest hooks (runtime injection works)", () => {
  const bundle = readFileSync(path.join(rootDir, "js/newsletter/static_replicas_data.js"), "utf8");
  assert.ok(bundle.includes("nl-sd-heading"), "bundle has the heading hook (regenerated after the HTML edit)");
  assert.ok(bundle.includes("nl-sd-intro"), "bundle has the intro hook");
  assert.ok(bundle.includes("nl-sd-point4"), "bundle has the point hooks");
});
