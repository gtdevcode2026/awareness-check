// gen_wifi_safety is a static design replica whose BODY text is now AI-wired:
// fillNewsletterTextSlots('gen_wifi_safety', …) returns article-driven Wi-Fi copy
// (intro + 5 tips) when an AI key is present, which static_replicas.js injects into
// the #nl-wifi-* hooks. The design never changes. Critically, with NO AI it returns
// {} so the authored replica renders byte-identical — these tests lock both ends:
// the no-AI contract, and the presence of the injection hooks in the replica HTML.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

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
  title: "Rogue public Wi-Fi hotspots used to harvest staff logins",
  type: "Phishing",
  summary: "Attackers stand up look-alike hotspots in cafes to capture credentials over unsecured Wi-Fi.",
}];

test("gen_wifi_safety with no AI returns {} so the authored replica renders unchanged", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_wifi_safety", ARTS, { forceLocal: true });
  // (Object is created inside the VM realm, so compare own-keys rather than deepEqual to {}.)
  assert.ok(slots && typeof slots === "object", "returns an object");
  assert.equal(Object.keys(slots).length, 0, "no-AI must return no slots → the static Wi-Fi poster keeps its authored design + copy");
});

test("gen_wifi_safety: the poster flip-form theme becomes the Wi-Fi heading verbatim (like How to Spot Shield)", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_wifi_safety", ARTS, { forceLocal: true, tipTheme: "Public Wi-Fi Risks" });
  assert.equal(slots.nlWifiHeading, "Public Wi-Fi Risks", "the chosen flip-form theme drives the heading verbatim");
  // With AI off and a theme chosen, ONLY the heading is injected — the rest of the
  // authored poster (intro + tips) stays untouched.
  assert.deepEqual(Object.keys(slots).sort(), ["nlWifiHeading"], "no other slots are added with AI off");
});

test("gen_wifi_safety with no AI and NO theme still returns {} (byte-identical design preserved)", async () => {
  const AIS = loadAISummarizer(aiContext());
  const slots = await AIS.fillNewsletterTextSlots("gen_wifi_safety", ARTS, { forceLocal: true });
  assert.equal(Object.keys(slots).length, 0, "no theme + no AI → no slots, so the authored poster is unchanged");
});

// The 5 tips render as a 3-up row + a 2-up row. Those rows previously lived in
// separate tables with DIFFERENT cell padding (top row 0 9px 26px, bottom row
// 0 16px 18px), so the bottom two tips were spaced wider apart and gapped
// differently than the top three — uneven spacing between tips. All five tip
// cells must share one padding.
function wifiTipPaddings() {
  const html = readFileSync(path.join(rootDir, "templates/reference/pipeline/wifi_safety_replica.html"), "utf8");
  const pads = [];
  for (let n = 1; n <= 5; n++) {
    const idx = html.indexOf(`id="nl-wifi-tip${n}"`);
    const tdStart = html.lastIndexOf("<td", idx);
    const tdTag = html.slice(tdStart, html.indexOf(">", tdStart));
    const m = tdTag.match(/padding:([^;"]+)/);
    pads.push(m ? m[1].trim() : null);
  }
  return pads;
}

test("all 5 Wi-Fi tip cells share one padding so spacing between tips is even", () => {
  const pads = wifiTipPaddings();
  assert.equal(new Set(pads).size, 1, `tip cell paddings must be uniform; got ${JSON.stringify(pads)}`);
});

test("the Wi-Fi replica HTML carries the injection hooks (heading + intro + 5 tips)", () => {
  const html = readFileSync(path.join(rootDir, "templates/reference/pipeline/wifi_safety_replica.html"), "utf8");
  assert.ok(html.includes('id="nl-wifi-heading"'), "heading hook present (topic derived from the article)");
  assert.ok(html.includes('id="nl-wifi-intro"'), "intro hook present");
  for (let i = 1; i <= 5; i++) {
    assert.ok(html.includes(`id="nl-wifi-tip${i}"`), `tip${i} hook present`);
  }
  assert.ok(html.includes('id="nl-wifi-source-row"'), "source-attribution row hook present");
  assert.ok(html.includes('id="nl-wifi-source-name"'), "source-name hook present");
  assert.ok(html.includes('id="nl-wifi-source-link"'), "source-link hook present");
});

test("the inlined static-replica bundle carries the hooks too (so runtime injection works)", () => {
  const bundle = readFileSync(path.join(rootDir, "js/newsletter/static_replicas_data.js"), "utf8");
  assert.ok(bundle.includes("nl-wifi-heading"), "bundle has the heading hook (regenerated after the HTML edit)");
  assert.ok(bundle.includes("nl-wifi-intro"), "bundle has the intro hook");
  assert.ok(bundle.includes("nl-wifi-tip5"), "bundle has the tip hooks");
});
