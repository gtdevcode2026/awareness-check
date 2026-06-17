// Advisory template builder (build('advisory', cfg, cves) in core_templates.js).
//
// Ports the Python tool's template.html token-fill into the app: ONE advisory per
// CVE, deterministic placeholder replacement (no AI for content), black/gold
// email-safe layout, and the feed's exact pubDate (not today). The Report-to-SOC
// CTA and the portal/QR footer are intentionally omitted from advisory pages.
// Guards the port's severity→colour map and the impact-keyword statements.

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

function builderContext() {
  const context = {
    window: {}, URL, Date, console, setTimeout, clearTimeout,
    navigator: { hardwareConcurrency: 4 },
    performance: { now: () => 0 },
  };
  context.window = context;
  context.App = {
    Utils: {
      log() {},
      fmtDate(v) { return v || ""; },
      stripTags(v) { return String(v || "").replace(/<[^>]*>/g, ""); },
      truncate(v, n) { return String(v || "").slice(0, n); },
      normalizeWebUrl(v) {
        const s = String(v || "").trim();
        if (!s) return "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
        return `https://${s.replace(/^\/+/, "")}`;
      },
    },
  };
  return vm.createContext(context);
}

function loadBuilder(context) {
  loadScript(context, "js/feed_scoring.js");
  loadScript(context, "js/rss_fetcher.js");
  loadScript(context, "js/newsletter_builder.js");
  loadScript(context, "js/newsletter/bank_page.js");
  loadScript(context, "js/newsletter/core_templates.js");
  return context.App.NewsletterBuilder;
}

const CVES = [
  {
    cveId: "CVE-2026-0001", cveIds: ["CVE-2026-0001"], cvss: "9.8", severity: "Critical",
    title: "Critical flaw in build tool",
    description: "A remote code execution issue lets attackers run code on affected hosts.",
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2026-0001"],
    pubDate: "2024-01-02T03:04:00Z", source: "NVD",
  },
  {
    cveId: "CVE-2026-0002", cveIds: ["CVE-2026-0002"], cvss: "7.5", severity: "High",
    title: "High issue <script>alert(1)</script>",
    description: "An authentication bypass affecting the admin console.",
    references: ["https://www.tenable.com/security/tns-2026-02"],
    pubDate: "Mon, 09 Jun 2026 12:00:00 +0000", source: "Tenable",
  },
];

const CFG = { org: "ACME", soc: "soc@acme.test", portal: "portal.acme.test" };
const OPTS = { useLinks: false, usePoster: false, useQR: false, useIllus: false };

test.describe("advisory builder output", () => {
  test("renders one advisory per CVE with id, severity colour, all five sections, feed date; no SOC CTA or footer", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("advisory", CFG, CVES, OPTS);

    assert.ok(html.includes('data-template-id="advisory"'), "template id stamped");
    assert.ok(html.includes('alt="ABInBev"'), "ABI logo present");

    // One advisory per CVE → two 950px unit containers.
    const units = html.split('width="950"').length - 1;
    assert.equal(units, 2, "one advisory unit per CVE");

    // Both CVE ids surface.
    assert.ok(html.includes("CVE-2026-0001") && html.includes("CVE-2026-0002"), "both CVE ids present");

    // Severity → colour port (cve_alert.py SEVERITY_COLORS).
    assert.ok(html.includes("#800000"), "Critical maroon present");
    assert.ok(html.includes("#cc0000"), "High red present");
    assert.ok(html.includes("Critical") && html.includes("High"), "severity labels present");

    // All five content sections (labels from template.html).
    for (const label of ["Overview", "Summary", "Potential", "Impact", "Recommendations", "References"]) {
      assert.ok(html.includes(label), `section label present: ${label}`);
    }

    // Exact feed publish time, not today.
    assert.ok(html.includes("02 Jan 2024"), "uses CVE-1's feed pubDate (2024), not today");
    assert.ok(html.includes("09 Jun 2026"), "uses CVE-2's feed pubDate");

    // Advisory ticket number ABSOC####.
    assert.ok(/ABSOC\d{4}/.test(html), "ABSOC#### ticket generated");

    // SOC CTA and portal/QR footer are intentionally omitted from advisory pages.
    assert.ok(!html.includes("Report to SOC Now"), "no hardcoded SOC CTA");
    assert.ok(!html.includes("Visit Portal"), "no portal footer block");
  });

  test("impact statement comes from the keyword map (no AI)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("advisory", CFG, [CVES[0]], OPTS);
    assert.ok(html.includes("an attacker could run arbitrary code"),
      "remote-code-execution keyword maps to its impact statement");
  });

  test("escapes interpolated CVE text (no raw markup injection)", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("advisory", CFG, [CVES[1]], OPTS);
    assert.ok(html.includes("&lt;script&gt;"), "angle brackets escaped");
    assert.ok(!html.includes("<script>alert(1)"), "no raw script tag from the title");
  });

  test("empty CVE list still builds without crashing", () => {
    const NB = loadBuilder(builderContext());
    const html = NB.build("advisory", CFG, [], OPTS);
    assert.equal(typeof html, "string");
    assert.ok(html.includes("Cyber Security Advisory"), "renders a placeholder advisory");
    assert.ok(!html.includes("Report to SOC Now"), "no SOC CTA on the placeholder advisory");
    assert.ok(!html.includes("Visit Portal"), "no footer on the placeholder advisory");
  });
});
