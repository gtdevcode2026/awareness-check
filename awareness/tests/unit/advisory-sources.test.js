// Advisory source normalizers (js/advisory_sources.js → App.AdvisorySources).
//
// The network call (fetchAdvisories) is integration-only; this guards the PURE
// normalizers that turn a source payload into the advisory shape the builder
// consumes: { cveId, cvss, severity, title, description, references[], pubDate, source }.
//   - normalizeNvd(json)      — structured NVD 2.0 JSON (best source)
//   - normalizeRssItems(xml)  — Tenable/Qualys RSS/Atom (severity from text/CVSS)
// Both apply the Critical+High default filter, the max-10 cap, and optional
// single-CVE targeting. No DOM is needed for NVD; the RSS test injects jsdom's
// DOMParser into the sandbox (the browser global the module uses).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const rootDir = path.resolve(__dirname, "../..");

function loadSourcesWithFetch(fetchImpl) {
  const dom = new JSDOM("<!DOCTYPE html><html></html>", { url: "https://example.test/" });
  const context = {
    window: {},
    console,
    DOMParser: dom.window.DOMParser,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: fetchImpl || (async () => { throw new Error("no network in unit test"); }),
  };
  context.window = context;
  context.App = {};
  const ctx = vm.createContext(context);
  vm.runInContext(readFileSync(path.join(rootDir, "js/advisory_sources.js"), "utf8"), ctx, {
    filename: path.join(rootDir, "js/advisory_sources.js"),
  });
  return ctx.App.AdvisorySources;
}

function loadSources() {
  return loadSourcesWithFetch();
}

function nvdVuln(id, score, sev, desc) {
  return {
    cve: {
      id,
      published: "2026-06-10T08:00:00.000",
      lastModified: "2026-06-11T08:00:00.000",
      descriptions: [{ lang: "en", value: desc }],
      metrics: { cvssMetricV31: [{ type: "Primary", cvssData: { baseScore: score, baseSeverity: sev } }] },
      references: [{ url: `https://nvd.example/${id}` }],
    },
  };
}

const NVD_JSON = {
  vulnerabilities: [
    nvdVuln("CVE-2026-0001", 9.8, "CRITICAL", "Critical remote code execution in widget parser."),
    nvdVuln("CVE-2026-0002", 7.5, "HIGH", "High severity SQL injection in admin console."),
    nvdVuln("CVE-2026-0003", 5.4, "MEDIUM", "Medium severity reflected XSS."),
    nvdVuln("CVE-2026-0004", 2.1, "LOW", "Low severity information disclosure."),
  ],
};

test.describe("normalizeNvd", () => {
  test("maps NVD 2.0 JSON to the advisory shape with exact published time", () => {
    const AS = loadSources();
    const out = AS.normalizeNvd(NVD_JSON, { severities: ["Critical", "High"] });
    assert.equal(out.length, 2, "only Critical + High kept by default");
    const crit = out.find((x) => x.cveId === "CVE-2026-0001");
    assert.equal(crit.severity, "Critical");
    assert.equal(crit.cvss, "9.8");
    assert.equal(crit.pubDate, "2026-06-10T08:00:00.000", "uses the CVE published timestamp, not today");
    assert.ok(crit.description.includes("remote code execution"));
    assert.ok(Array.isArray(crit.references) && crit.references[0].includes("CVE-2026-0001"));
    assert.equal(crit.source, "NVD");
  });

  test("severity filter is configurable (Critical only)", () => {
    const AS = loadSources();
    const out = AS.normalizeNvd(NVD_JSON, { severities: ["Critical"] });
    // Spread into a test-realm array before comparing (out is built in the vm realm).
    assert.deepEqual([...out].map((x) => x.cveId), ["CVE-2026-0001"]);
  });

  test("cveCode targeting returns that CVE regardless of severity", () => {
    const AS = loadSources();
    const out = AS.normalizeNvd(NVD_JSON, { severities: ["Critical", "High"], cveCode: "CVE-2026-0003" });
    assert.equal(out.length, 1);
    assert.equal(out[0].cveId, "CVE-2026-0003");
    assert.equal(out[0].severity, "Medium");
  });

  test("caps the result at 25 per run", () => {
    const AS = loadSources();
    const many = { vulnerabilities: Array.from({ length: 30 }, (_, i) =>
      nvdVuln(`CVE-2026-1${String(i).padStart(3, "0")}`, 9.5, "CRITICAL", `Critical issue ${i}`)) };
    const out = AS.normalizeNvd(many, { severities: ["Critical"] });
    assert.equal(out.length, 25);
  });
});

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Tenable Advisory CVE-2026-1111: critical flaw</title>
    <description>Critical remote code execution vulnerability.</description>
    <category>Critical</category>
    <link>https://www.tenable.com/security/tns-2026-01</link>
    <pubDate>Mon, 09 Jun 2026 12:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Advisory for CVE-2026-2222</title>
    <description>Issue rated CVSS 7.8 affecting the agent.</description>
    <link>https://www.tenable.com/security/tns-2026-02</link>
    <pubDate>Sun, 08 Jun 2026 09:30:00 +0000</pubDate>
  </item>
  <item>
    <title>General product announcement (no CVE)</title>
    <description>Marketing post with no vulnerability id.</description>
    <link>https://www.tenable.com/blog/x</link>
    <pubDate>Sat, 07 Jun 2026 09:30:00 +0000</pubDate>
  </item>
  <item>
    <title>Minor note CVE-2026-3333</title>
    <description>Low severity informational item.</description>
    <category>Low</category>
    <link>https://www.tenable.com/security/tns-2026-03</link>
    <pubDate>Fri, 06 Jun 2026 09:30:00 +0000</pubDate>
  </item>
</channel></rss>`;

test.describe("normalizeRssItems", () => {
  test("parses RSS, detects severity from category/CVSS, keeps the exact pubDate", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(RSS_XML, "Tenable", { severities: ["Critical", "High"] });
    assert.equal(out.length, 2, "Critical + High kept; no-CVE and Low dropped");
    const crit = out.find((x) => x.cveId === "CVE-2026-1111");
    assert.equal(crit.severity, "Critical");
    assert.equal(crit.pubDate, "Mon, 09 Jun 2026 12:00:00 +0000", "exact feed pubDate preserved");
    assert.equal(crit.references[0], "https://www.tenable.com/security/tns-2026-01");
    assert.equal(crit.source, "Tenable");
    const high = out.find((x) => x.cveId === "CVE-2026-2222");
    assert.equal(high.severity, "High", "severity derived from CVSS 7.8 in the description");
  });

  test("items without a CVE id are dropped (one advisory per CVE)", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(RSS_XML, "Tenable", { severities: ["Critical", "High", "Medium", "Low"] });
    assert.ok(out.every((x) => /^CVE-\d{4}-\d+$/.test(x.cveId)), "every item carries a CVE id");
    assert.ok(!out.some((x) => x.title.includes("no CVE")));
  });
});

test.describe("severity helpers", () => {
  test("severityFromScore maps CVSS bands", () => {
    const AS = loadSources();
    assert.equal(AS.severityFromScore(9.1), "Critical");
    assert.equal(AS.severityFromScore(7.0), "High");
    assert.equal(AS.severityFromScore(4.0), "Medium");
    assert.equal(AS.severityFromScore(1.5), "Low");
    assert.equal(AS.severityFromScore(0), "");
  });
});

// A CVE-bearing item whose feed text states no severity. The Tenable CVE feed
// (title = CVE id) sometimes omits a severity word; rather than drop it at parse
// (which is why Tenable returned nothing), we keep it with a blank severity so
// the network path can enrich it from NVD before filtering.
const NO_SEV_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>CVE-2026-9999</title>
    <description>A vulnerability in the parser with no rating stated here.</description>
    <link>https://www.tenable.com/cve/CVE-2026-9999</link>
    <pubDate>Mon, 09 Jun 2026 12:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

test.describe("normalizeRssItems — severity relaxation", () => {
  test("keeps a CVE item with no parseable severity when targeted by cveCode", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(NO_SEV_XML, "Tenable", { cveCode: "CVE-2026-9999" });
    assert.equal(out.length, 1, "CVE item survives parse even without a severity word");
    assert.equal(out[0].cveId, "CVE-2026-9999");
    assert.equal(out[0].severity, "", "severity left blank for later NVD enrichment");
  });

  test("a blank-severity item is still filtered out under a Critical+High filter", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(NO_SEV_XML, "Tenable", { severities: ["Critical", "High"] });
    assert.equal(out.length, 0, "blank severity matches no allowed band until enriched");
  });
});

// A feed where one item has a stray "]]>" in char data — invalid XML that makes
// the browser DOMParser reject the WHOLE document (exactly what Tenable's live CVE
// feed does). Lenient per-item recovery must salvage the well-formed items.
const MALFORMED_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>CVE-2026-7001</title>
    <description>Critical remote code execution vulnerability.</description>
    <link>https://www.tenable.com/cve/CVE-2026-7001</link>
  </item>
  <item>
    <title>CVE-2026-7002</title>
    <description>Broken item with a stray ]]> in char data.</description>
    <link>https://www.tenable.com/cve/CVE-2026-7002</link>
  </item>
  <item>
    <title>CVE-2026-7003</title>
    <description>High severity flaw affecting the agent.</description>
    <link>https://www.tenable.com/cve/CVE-2026-7003</link>
  </item>
</channel></rss>`;

test.describe("normalizeRssItems — lenient recovery for malformed feeds", () => {
  test("salvages well-formed items when a stray ]]> would void the whole document", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(MALFORMED_RSS, "Tenable", { severities: ["Critical", "High", "Medium", "Low"] });
    const ids = [...out].map((x) => x.cveId).sort();
    assert.deepEqual(ids, ["CVE-2026-7001", "CVE-2026-7003"], "clean items survive; only the malformed one is skipped");
  });
});

test.describe("mergeNvdSeverity", () => {
  test("fills a blank severity/cvss from the NVD map and preserves existing ones", () => {
    const AS = loadSources();
    const items = [
      { cveId: "CVE-2026-1000", severity: "", cvss: "" },
      { cveId: "CVE-2026-2000", severity: "High", cvss: "7.8" },
    ];
    const map = { "CVE-2026-1000": { severity: "Critical", cvss: "9.8" } };
    const out = AS.mergeNvdSeverity(items, map);
    const a = out.find((x) => x.cveId === "CVE-2026-1000");
    const b = out.find((x) => x.cveId === "CVE-2026-2000");
    assert.equal(a.severity, "Critical", "blank severity filled from NVD");
    assert.equal(a.cvss, "9.8", "blank cvss filled from NVD");
    assert.equal(b.severity, "High", "existing severity left untouched");
  });

  test("labels a still-blank severity 'Unknown' when the CVE is absent from the map", () => {
    const AS = loadSources();
    const items = [{ cveId: "CVE-2026-3000", severity: "", cvss: "" }];
    const out = AS.mergeNvdSeverity(items, {});
    assert.equal(out[0].severity, "Unknown");
  });
});

const RSS2JSON = {
  status: "ok",
  items: [
    { title: "CVE-2026-1111", description: "Critical remote code execution vulnerability.", link: "https://www.tenable.com/cve/CVE-2026-1111", pubDate: "2026-06-09 12:00:00" },
    { title: "CVE-2026-2222", description: "Issue rated CVSS 7.8 affecting the agent.", link: "https://www.tenable.com/cve/CVE-2026-2222", pubDate: "2026-06-08 09:30:00" },
    { title: "Marketing post (no CVE)", description: "No vulnerability id here.", link: "https://www.tenable.com/blog/x", pubDate: "2026-06-07 09:30:00" },
  ],
};

test.describe("normalizeRss2JsonItems", () => {
  test("parses an rss2json payload, drops no-CVE items, detects severity, and filters", () => {
    const AS = loadSources();
    const out = AS.normalizeRss2JsonItems(RSS2JSON, "Tenable", { severities: ["Critical", "High"] });
    assert.equal(out.length, 2, "Critical + High kept; the no-CVE marketing item dropped");
    const crit = out.find((x) => x.cveId === "CVE-2026-1111");
    assert.equal(crit.severity, "Critical");
    assert.equal(crit.references[0], "https://www.tenable.com/cve/CVE-2026-1111");
    assert.equal(crit.source, "Tenable");
    const high = out.find((x) => x.cveId === "CVE-2026-2222");
    assert.equal(high.severity, "High", "severity derived from CVSS 7.8 in the description");
  });
});

// Qualys publishes vulnerability research as blog posts: the CVE id and severity
// live in the full post body (<content:encoded>), NOT the title or short
// <description>. Before the fix, parseOneRss only scanned title+description, so
// every Qualys item was dropped (no CVE id) — which is why Qualys returned nothing
// while Tenable (CVE-titled items) worked. parseOneRss now also scans the body.
const QUALYS_BLOG_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <item>
    <title>Qualys Research: A Critical Flaw in Popular Server Software</title>
    <description>Our team analysed a newly disclosed vulnerability and its impact.</description>
    <link>https://blog.qualys.com/vulnerabilities-threat-research/2026/06/10/critical-flaw</link>
    <pubDate>Tue, 10 Jun 2026 10:00:00 +0000</pubDate>
    <content:encoded><![CDATA[<p>This post covers <strong>CVE-2026-4242</strong>, a critical remote code execution issue (CVSS 9.8) affecting widely deployed servers.</p>]]></content:encoded>
  </item>
  <item>
    <title>Monthly Patch Roundup</title>
    <description>A summary of this month's patches, no specific CVE in the summary.</description>
    <link>https://blog.qualys.com/vulnerabilities-threat-research/2026/06/09/patch</link>
    <pubDate>Mon, 09 Jun 2026 10:00:00 +0000</pubDate>
    <content:encoded><![CDATA[<p>Highlights include <strong>CVE-2026-5353</strong>, rated high severity in the mail component.</p>]]></content:encoded>
  </item>
  <item>
    <title>Company News: Qualys Wins an Award</title>
    <description>A marketing post with no vulnerability id anywhere.</description>
    <link>https://blog.qualys.com/news/2026/06/08/award</link>
    <pubDate>Sun, 08 Jun 2026 10:00:00 +0000</pubDate>
    <content:encoded><![CDATA[<p>We are proud to announce an industry award. No CVEs here.</p>]]></content:encoded>
  </item>
</channel>
</rss>`;

test.describe("normalizeRssItems — blog feeds (Qualys content:encoded)", () => {
  test("extracts the CVE + severity from the post body when absent from title/description", () => {
    const AS = loadSources();
    const out = AS.normalizeRssItems(QUALYS_BLOG_RSS, "Qualys", { severities: ["Critical", "High"] });
    const ids = [...out].map((x) => x.cveId).sort();
    assert.deepEqual(ids, ["CVE-2026-4242", "CVE-2026-5353"], "both CVE-bearing posts kept; marketing post dropped");
    const crit = out.find((x) => x.cveId === "CVE-2026-4242");
    assert.equal(crit.severity, "Critical", "severity (CVSS 9.8) read from the body");
    assert.equal(crit.source, "Qualys");
    assert.equal(crit.pubDate, "Tue, 10 Jun 2026 10:00:00 +0000", "exact feed pubDate preserved");
    const high = out.find((x) => x.cveId === "CVE-2026-5353");
    assert.equal(high.severity, "High", "high severity read from the body");
  });
});

// rss2json returns the full post body in `content` (the short excerpt in
// `description`). Blog feeds therefore need BOTH scanned for the CVE id.
const QUALYS_RSS2JSON = {
  status: "ok",
  items: [
    { title: "Critical Flaw Roundup", description: "Summary without a CVE id.", content: "Full analysis of CVE-2026-7777, a critical remote code execution flaw.", link: "https://blog.qualys.com/x", pubDate: "2026-06-10 10:00:00" },
    { title: "General Company News", description: "No CVE here.", content: "Just company news, nothing to patch.", link: "https://blog.qualys.com/y", pubDate: "2026-06-09 10:00:00" },
  ],
};

test.describe("normalizeRss2JsonItems — blog feeds (content field)", () => {
  test("extracts the CVE from the full content field when the description omits it", () => {
    const AS = loadSources();
    const out = AS.normalizeRss2JsonItems(QUALYS_RSS2JSON, "Qualys", { severities: ["Critical", "High"] });
    assert.equal(out.length, 1, "only the CVE-bearing post kept");
    assert.equal(out[0].cveId, "CVE-2026-7777");
    assert.equal(out[0].severity, "Critical");
    assert.equal(out[0].source, "Qualys");
  });
});

// ── NVD network resilience: multi-proxy fallback + clear failure (no API key) ──
// fetchNvd routes the NVD REST API through a pool of public CORS proxies, racing
// them with a retry (mirroring the RSS path) instead of the old single proxy that
// took NVD offline whenever it was down. These tests stub `fetch` per proxy URL.

function nvdResponse(json) {
  return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json };
}

test.describe("fetchNvd proxy resilience", () => {
  const ONE = { vulnerabilities: [nvdVuln("CVE-2026-0001", 9.8, "CRITICAL", "Critical RCE in widget parser.")] };

  test("falls back to a working proxy when the first proxy is down", async () => {
    // allorigins (the first proxy) throws; only codetabs returns valid NVD JSON.
    const AS = loadSourcesWithFetch(async (proxyUrl) => {
      if (String(proxyUrl).includes("codetabs")) return nvdResponse(ONE);
      throw new Error("proxy down");
    });
    const items = await AS.fetchAdvisories({ source: "nvd", cveCode: "CVE-2026-0001" });
    assert.equal(items.length, 1);
    assert.equal(items[0].cveId, "CVE-2026-0001");
    assert.equal(items[0].severity, "Critical");
  });

  test("ignores proxy error pages that are not an NVD payload", async () => {
    // allorigins returns HTML (a Cloudflare error page); codetabs returns real JSON.
    const AS = loadSourcesWithFetch(async (proxyUrl) => {
      if (String(proxyUrl).includes("codetabs")) return nvdResponse(ONE);
      return { ok: true, status: 200, text: async () => "<!DOCTYPE html><html>520 error</html>" };
    });
    const items = await AS.fetchAdvisories({ source: "nvd", cveCode: "CVE-2026-0001" });
    assert.equal(items.length, 1);
    assert.equal(items[0].cveId, "CVE-2026-0001");
  });

  test("throws a clear reason when every proxy fails (not a silent empty)", async () => {
    const AS = loadSourcesWithFetch(async () => { throw new Error("network"); });
    await assert.rejects(
      () => AS.fetchAdvisories({ source: "nvd", cveCode: "CVE-2026-0001" }),
      /unreachable|proxy/i
    );
  });

  // NVD's REST API sends `access-control-allow-origin: *`, so the browser can fetch it
  // DIRECTLY (verified; works from file:// too). Direct-first removes the dependency on
  // public CORS proxies, which restricted/corporate networks often block — the symptom
  // that took NVD offline at a client site while it worked on a home laptop.
  test("fetches NVD directly first (NVD sends CORS) — no proxy when the direct call works", async () => {
    const calls = [];
    const AS = loadSourcesWithFetch(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("https://services.nvd.nist.gov/")) return nvdResponse(ONE);
      throw new Error("proxy should not be needed when the direct call works");
    });
    const items = await AS.fetchAdvisories({ source: "nvd", cveCode: "CVE-2026-0001" });
    assert.equal(items.length, 1);
    assert.equal(items[0].cveId, "CVE-2026-0001");
    assert.ok(calls[0] && calls[0].startsWith("https://services.nvd.nist.gov/"),
      `first network call must be the direct NVD URL, got: ${calls[0]}`);
    assert.ok(!calls.some((u) => /allorigins|codetabs|corsproxy/.test(u)),
      "no CORS proxy is contacted when the direct call succeeds");
  });

  test("falls back to proxies when the direct NVD call is blocked", async () => {
    // Direct call hangs/blocked (throws); only a proxy returns valid NVD JSON.
    const AS = loadSourcesWithFetch(async (url) => {
      if (String(url).startsWith("https://services.nvd.nist.gov/")) throw new Error("blocked");
      if (String(url).includes("codetabs")) return nvdResponse(ONE);
      throw new Error("proxy down");
    });
    const items = await AS.fetchAdvisories({ source: "nvd", cveCode: "CVE-2026-0001" });
    assert.equal(items.length, 1);
    assert.equal(items[0].cveId, "CVE-2026-0001");
  });
});
