/* ═══════════════════════════════════════════════════════════
   advisory_sources.js — App.AdvisorySources
   Fetches per-CVE vulnerability advisories from a chosen source (NVD / Tenable /
   Qualys) and normalizes them into the shape the `advisory` template builder
   consumes. Mirrors the Python tool's RSS pull + severity detection, but in the
   browser via the same CORS proxies the RSS fetcher uses.

   Output item shape:
     { cveId, cveIds[], cvss, severity, title, description, references[], pubDate, source }
   - One advisory per CVE: RSS items with no CVE id are dropped.
   - Default filter: Critical + High. Cap: 10 per run.
   - pubDate is the feed/CVE publish time verbatim (NOT today) — exact-time rule.

   The normalizers (normalizeNvd / normalizeRssItems) are pure and unit-tested.
   fetchAdvisories() is the network entry point used by App.AdvisoryUI.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.AdvisorySources = (() => {
  'use strict';

  const SOURCES = ['nvd', 'tenable', 'qualys'];
  const CVE_RE = /CVE-\d{4}-\d{4,7}/ig;
  const MAX_PER_RUN = 25;

  const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
  // Each source lists a primary feed plus fallback URLs tried in order. Tenable's
  // CVE feed (title = the CVE id, description states the severity word) is the
  // best fit for the one-advisory-per-CVE model; the product-advisories feed is
  // a fallback. The bare blog feeds rarely carry a CVE id in the title, which is
  // why they used to return nothing.
  const SOURCE_FEEDS = {
    tenable: {
      url: 'https://www.tenable.com/cve/feeds?sort=newest',
      urlAlternatives: ['https://www.tenable.com/security/feed']
    },
    qualys: {
      // Qualys publishes vulnerability research as blog posts: the CVE id lives in
      // the full post body, not the title or short <description>. parseOneRss now
      // scans <content:encoded>, so these blog feeds yield one-advisory-per-CVE the
      // same way Tenable's CVE feed does. ThreatPROTECT is the most CVE-dense and is
      // tried as a fallback if the main blog feed yields nothing this run.
      url: 'https://blog.qualys.com/feed',
      urlAlternatives: ['https://threatprotect.qualys.com/feed/']
    }
  };

  // Ordered keyword → severity for RSS text/category detection (script parity).
  const SEVERITY_KEYWORDS = [
    ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'],
    ['moderate', 'Medium'], ['low', 'Low']
  ];

  // ── small helpers ──
  function cap(s) {
    const t = String(s || '').trim().toLowerCase();
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  }
  function truncate(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
  }
  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function capSource(s) {
    return ({ nvd: 'NVD', tenable: 'Tenable', qualys: 'Qualys' })[String(s || '').toLowerCase()] || s;
  }

  // Map a CVSS v3 base score to a severity label (NVD's own bands).
  function severityFromScore(score) {
    const s = Number(score);
    if (!isFinite(s)) return '';
    if (s >= 9.0) return 'Critical';
    if (s >= 7.0) return 'High';
    if (s >= 4.0) return 'Medium';
    if (s > 0) return 'Low';
    return '';
  }

  function extractCves(text) {
    const found = String(text || '').match(CVE_RE) || [];
    return [...new Set(found.map(c => c.toUpperCase()))];
  }

  // Detect severity from free text: prefer an explicit CVSS score, else keywords.
  function detectSeverityFromText(text) {
    const blob = String(text || '').toLowerCase();
    const m = blob.match(/cvss[^\d]{0,12}(\d{1,2}(?:\.\d)?)/);
    if (m) {
      const sev = severityFromScore(m[1]);
      if (sev) return sev;
    }
    for (const [kw, level] of SEVERITY_KEYWORDS) {
      if (blob.includes(kw)) return level;
    }
    return '';
  }

  // Filter to the chosen severities (default Critical+High), or to a single CVE
  // when cveCode is given (severity ignored — an explicit ask wins), capped.
  function applyFilter(items, opts = {}) {
    const { severities, cveCode, max = MAX_PER_RUN } = opts;
    let out = items.filter(it => it && it.cveId);
    const code = String(cveCode || '').trim().toUpperCase();
    if (code) {
      out = out.filter(it =>
        it.cveId.toUpperCase() === code ||
        (Array.isArray(it.cveIds) && it.cveIds.map(x => x.toUpperCase()).includes(code)));
      return out.slice(0, max);
    }
    const allow = (Array.isArray(severities) && severities.length)
      ? new Set(severities.map(s => String(s).trim()))
      : new Set(['Critical', 'High']);
    out = out.filter(it => allow.has(it.severity));
    return out.slice(0, max);
  }

  function dedupCap(items, max = MAX_PER_RUN) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const k = String(it.cveId || '').toUpperCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= max) break;
    }
    return out;
  }

  // ── NVD JSON → normalized advisories ──
  function normalizeNvd(json, opts = {}) {
    const vulns = (json && Array.isArray(json.vulnerabilities)) ? json.vulnerabilities : [];
    const items = [];
    for (const v of vulns) {
      const cve = v && v.cve;
      if (!cve || !cve.id) continue;
      const cveId = String(cve.id).toUpperCase();
      const descs = Array.isArray(cve.descriptions) ? cve.descriptions : [];
      const en = descs.find(d => d && d.lang === 'en') || descs[0] || {};
      const description = String(en.value || '').trim();
      const metrics = cve.metrics || {};
      const m3 = metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV3 || [];
      const primary = (Array.isArray(m3) && (m3.find(x => x && x.type === 'Primary') || m3[0])) || null;
      const data = (primary && primary.cvssData) ? primary.cvssData : {};
      const cvss = (data.baseScore != null) ? String(data.baseScore) : '';
      const severity = (data.baseSeverity ? cap(data.baseSeverity) : '') || severityFromScore(cvss);
      const refs = Array.isArray(cve.references) ? cve.references.map(r => r && r.url).filter(Boolean) : [];
      items.push({
        cveId,
        cveIds: [cveId],
        cvss,
        severity,
        title: cveId + (description ? ' — ' + truncate(description, 90) : ''),
        description,
        references: refs.length ? refs : [`https://nvd.nist.gov/vuln/detail/${cveId}`],
        pubDate: String(cve.published || cve.lastModified || '').trim(),
        source: 'NVD'
      });
    }
    return applyFilter(items, opts);
  }

  // ── RSS/Atom → normalized advisories ──
  function txt(el, tag) { const c = el.querySelector(tag); return c ? (c.textContent || '').trim() : ''; }

  // Read <content:encoded> (the full post body in many RSS feeds).
  // getElementsByTagName matches the qualified name in an XML document — where the
  // feed declares the content namespace — and we fall back to a localName scan for
  // parsers that drop the prefix. Used so blog-style feeds (Qualys) that only name
  // the CVE in the body still yield advisories.
  function contentEncodedText(el) {
    if (!el || typeof el.getElementsByTagName !== 'function') return '';
    const byQName = el.getElementsByTagName('content:encoded');
    if (byQName && byQName.length) return (byQName[0].textContent || '').trim();
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      if ((node.localName || node.nodeName) === 'encoded') return (node.textContent || '').trim();
    }
    return '';
  }

  function parseOneRss(el, type, source) {
    const title = txt(el, 'title');
    const cats = [...el.querySelectorAll('category')]
      .map(c => (c.getAttribute('term') || c.textContent || '').trim())
      .filter(Boolean);
    let link, description, pubDate, fullBody = '';
    if (type === 'atom') {
      const le = el.querySelector('link[rel="alternate"], link[href]');
      link = le ? (le.getAttribute('href') || '') : '';
      description = txt(el, 'summary') || txt(el, 'content');
      fullBody = txt(el, 'content');
      pubDate = txt(el, 'published') || txt(el, 'updated');
    } else {
      link = txt(el, 'link');
      description = txt(el, 'description');
      // Blog-style feeds (Qualys) put the CVE id in the full post body, not the
      // title or the short <description>. Scan <content:encoded> too so those feeds
      // yield one-advisory-per-CVE the same way Tenable's CVE feed does.
      fullBody = contentEncodedText(el);
      pubDate = txt(el, 'pubDate');
    }
    const cleanDesc = stripTags(description);
    const cleanBody = stripTags(fullBody);
    const cveIds = extractCves(`${title} ${cleanDesc} ${cleanBody}`);
    const cveId = cveIds[0] || '';
    if (!cveId) return null; // one advisory per CVE — drop items with no CVE id
    // Severity may be absent from the feed text (e.g. a CVE-feed entry that only
    // links out). Keep the item with a blank severity; the network path enriches
    // it from NVD before filtering. applyFilter still drops a blank severity when
    // the user filters by band, so normalizeRssItems' output is unchanged there.
    const severity = detectSeverityFromText(`${cats.join(' ')} ${title} ${cleanDesc} ${cleanBody}`);
    return {
      cveId,
      cveIds,
      cvss: '',
      severity,
      title: title || cveId,
      // Prefer the short description; fall back to a trimmed body excerpt for
      // blog feeds whose <description> is empty.
      description: cleanDesc || truncate(cleanBody, 400),
      references: link ? [link] : [],
      pubDate: pubDate || '',
      source: source || 'RSS'
    };
  }

  // Fallback for technically-malformed feeds (Tenable's CVE feed has a stray
  // "]]>" in char data, which makes a strict DOMParser reject the ENTIRE document
  // → zero items). We coarse-split the raw XML into <item>/<entry> blocks and
  // reparse each one in isolation, so a single bad item is skipped instead of
  // voiding all ~500. Field extraction still goes through DOMParser + parseOneRss,
  // so CDATA/entities are handled correctly.
  function parseRssLenient(xmlString, source) {
    if (typeof DOMParser === 'undefined') return [];
    const str = String(xmlString || '');
    let type = 'rss';
    let blocks = str.match(/<item\b[\s\S]*?<\/item>/gi);
    if (!blocks || !blocks.length) {
      blocks = str.match(/<entry\b[\s\S]*?<\/entry>/gi);
      type = 'atom';
    }
    if (!blocks || !blocks.length) return [];
    const wrap = (type === 'atom')
      ? (b) => `<feed xmlns="http://www.w3.org/2005/Atom">${b}</feed>`
      // Declare the content/dc namespaces so a per-item block carrying
      // <content:encoded> still parses (an undeclared prefix is a hard XML error).
      : (b) => `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>${b}</channel></rss>`;
    const out = [];
    for (const block of blocks) {
      let doc;
      try { doc = new DOMParser().parseFromString(wrap(block), 'text/xml'); }
      catch (_e) { continue; }
      if (!doc || doc.querySelector('parsererror')) continue;
      const el = doc.querySelector(type === 'atom' ? 'entry' : 'item');
      if (!el) continue;
      const item = parseOneRss(el, type, source);
      if (item) out.push(item);
    }
    return out;
  }

  function parseRssToItems(xmlString, source) {
    if (typeof DOMParser === 'undefined') return [];
    let doc;
    try { doc = new DOMParser().parseFromString(String(xmlString || ''), 'text/xml'); }
    catch (_e) { return parseRssLenient(xmlString, source); }
    // A strict parse failure (or a feed the parser rejected wholesale) drops to
    // the per-item lenient recovery rather than returning nothing.
    if (!doc || doc.querySelector('parsererror')) return parseRssLenient(xmlString, source);
    let nodes = [...doc.querySelectorAll('item')];
    let type = 'rss';
    if (!nodes.length) { nodes = [...doc.querySelectorAll('entry')]; type = 'atom'; }
    const out = [];
    for (const el of nodes) {
      const item = parseOneRss(el, type, source);
      if (item) out.push(item);
    }
    return out;
  }

  function normalizeRssItems(xmlString, source, opts = {}) {
    return applyFilter(parseRssToItems(xmlString, source), opts);
  }

  // ── rss2json fallback shape → normalized advisories ──
  // The rss2json proxy returns parsed items ({ title, description/content, link,
  // pubDate, categories[] }) instead of XML, so it gets its own parser. Same
  // rules as parseOneRss: one advisory per CVE, severity detected from the text.
  function rss2JsonToItems(data, source) {
    const list = (data && Array.isArray(data.items)) ? data.items : [];
    const out = [];
    for (const it of list) {
      const title = String((it && it.title) || '').trim();
      // Scan BOTH the short description and the full content field — blog feeds
      // (Qualys) name the CVE only in the full body, which rss2json returns as
      // `content`.
      const cleanDesc = stripTags((it && it.description) || '');
      const cleanBody = stripTags((it && it.content) || '');
      const cveIds = extractCves(`${title} ${cleanDesc} ${cleanBody}`);
      const cveId = cveIds[0] || '';
      if (!cveId) continue;
      const cats = Array.isArray(it && it.categories) ? it.categories : [];
      const severity = detectSeverityFromText(`${cats.join(' ')} ${title} ${cleanDesc} ${cleanBody}`);
      const link = String((it && it.link) || '').trim();
      out.push({
        cveId,
        cveIds,
        cvss: '',
        severity,
        title: title || cveId,
        description: cleanDesc || truncate(cleanBody, 400),
        references: link ? [link] : [],
        pubDate: (it && it.pubDate) || '',
        source: source || 'RSS'
      });
    }
    return out;
  }

  function normalizeRss2JsonItems(data, source, opts = {}) {
    return applyFilter(rss2JsonToItems(data, source), opts);
  }

  // Pure: fill any blank severity (and cvss) from an { CVE_ID: {severity, cvss} }
  // lookup map. A CVE that the map doesn't cover falls back to 'Unknown' so it is
  // never silently dropped before the user's filter runs. Mutates + returns items.
  function mergeNvdSeverity(items, nvdMap) {
    const map = nvdMap || {};
    for (const it of items) {
      if (!it || it.severity) continue;
      const hit = map[String(it.cveId || '').toUpperCase()];
      if (hit && hit.severity) {
        it.severity = hit.severity;
        if (!it.cvss && hit.cvss) it.cvss = hit.cvss;
      } else {
        it.severity = 'Unknown';
      }
    }
    return items;
  }

  // ── Network ──
  // NVD is a JSON REST API a browser can't call directly (CORS), so requests go
  // through public CORS proxies. The old path used ONE proxy with no fallback, so a
  // single proxy outage took NVD fully offline (while the RSS feeds, which race
  // several proxies, kept working). We now race a small pool and retry — same
  // resilience as App.RSSFetcher.fetchXmlViaProxies — with NO API key.
  const JSON_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
  ];

  // allorigins' /get endpoint wraps the upstream body as { contents: "..." }.
  function unwrapProxyBody(text) {
    const t = String(text || '').trim();
    if (t.startsWith('{') && t.includes('"contents"')) {
      try {
        const w = JSON.parse(t);
        if (typeof w.contents === 'string') return w.contents;
      } catch (_e) { /* not a wrapper — use as-is */ }
    }
    return text;
  }

  // Fetch NVD JSON through the proxy pool: race them, first VALID NVD payload wins,
  // retried a couple of times. Throws only when every proxy fails on every attempt,
  // so the caller can tell "proxies down" apart from "genuinely no results".
  async function fetchNvdJson(url, maxRetries = 2, timeoutMs = 10000) {
    const hasAbort = typeof AbortController !== 'undefined';
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const settled = await Promise.allSettled(JSON_PROXIES.map(async (mk) => {
        const ctrl = hasAbort ? new AbortController() : null;
        const tid = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        const opts = { headers: { Accept: 'application/json' } };
        if (ctrl) opts.signal = ctrl.signal;
        try {
          const resp = await fetch(mk(url), opts);
          if (!resp || !resp.ok) throw new Error(`HTTP ${resp && resp.status}`);
          const json = JSON.parse(unwrapProxyBody(await resp.text()));
          // Reject proxy error/HTML pages: a real NVD payload carries these keys.
          if (!json || (json.vulnerabilities === undefined && json.totalResults === undefined)) {
            throw new Error('Not an NVD payload');
          }
          return json;
        } finally {
          if (tid) clearTimeout(tid);
        }
      }));
      const ok = settled.find((r) => r.status === 'fulfilled');
      if (ok) return ok.value;
      lastErr = (settled.find((r) => r.status === 'rejected') || {}).reason || lastErr;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 250 * attempt));
    }
    throw new Error('NVD unreachable: every CORS proxy failed' +
      (lastErr && lastErr.message ? ` (${lastErr.message})` : '') +
      ' — the public proxy may be down; try again shortly.');
  }

  async function fetchNvd({ severities, cveCode, fast } = {}) {
    const code = String(cveCode || '').trim();
    const sevs = (Array.isArray(severities) && severities.length) ? severities : ['Critical', 'High'];
    const queries = [];
    if (code) {
      queries.push(`${NVD_API}?cveId=${encodeURIComponent(code.toUpperCase())}`);
    } else {
      for (const sev of sevs) {
        queries.push(`${NVD_API}?cvssV3Severity=${encodeURIComponent(String(sev).toUpperCase())}&resultsPerPage=${MAX_PER_RUN}`);
      }
    }
    const all = [];
    let reached = false;
    let lastErr = null;
    for (const q of queries) {
      try {
        // Enrichment lookups (fast) fail quickly so they never hold up the RSS path.
        const json = await fetchNvdJson(q, fast ? 1 : 2, fast ? 6000 : 10000);
        reached = true;
        all.push(...normalizeNvd(json, { severities, cveCode, max: MAX_PER_RUN }));
      } catch (e) { lastErr = e; }
    }
    // Distinguish "proxies worked, genuinely no matches" ([]) from "every proxy
    // failed" (throw) so the UI shows a real reason instead of "No advisories found".
    if (!reached) throw lastErr || new Error('NVD unreachable.');
    return dedupCap(all, MAX_PER_RUN);
  }

  // Resolve a CVE id → { severity, cvss } via NVD for items whose feed text gave
  // no severity. Best-effort and capped: a lookup failure leaves the blank, which
  // mergeNvdSeverity then labels 'Unknown'. Sequential to stay gentle on NVD's
  // keyless rate limit (~5 requests / 30s); enrichment only fires for items the
  // feed text didn't already classify, so the common case makes no extra calls.
  async function enrichSeveritiesFromNvd(items) {
    const missing = items.filter(it => it && !it.severity).slice(0, MAX_PER_RUN);
    if (!missing.length) return items;
    const map = {};
    let consecutiveFail = 0;
    for (const it of missing) {
      try {
        const hits = await fetchNvd({ cveCode: it.cveId, fast: true });
        consecutiveFail = 0;
        const found = hits.find(x => String(x.cveId).toUpperCase() === String(it.cveId).toUpperCase());
        if (found && found.severity) {
          map[String(it.cveId).toUpperCase()] = { severity: found.severity, cvss: found.cvss };
        }
      } catch (_e) {
        // Best-effort: a miss leaves the blank ('Unknown'). If NVD's proxies are
        // clearly down, stop after a couple of failures so the RSS fetch (already
        // succeeded) isn't held hostage by NVD being unreachable.
        if (++consecutiveFail >= 2) break;
      }
    }
    return mergeNvdSeverity(items, map);
  }

  async function fetchRssSource(source, opts) {
    const feed = SOURCE_FEEDS[source];
    if (!feed) return [];
    const RF = window.App && window.App.RSSFetcher;
    const fetchXml = RF && RF.fetchXmlViaProxies;
    const fetchJson = RF && RF.fetchRss2Json;
    if (typeof fetchXml !== 'function') {
      throw new Error('RSS fetch unavailable (App.RSSFetcher.fetchXmlViaProxies missing)');
    }
    const urls = [feed.url, ...(Array.isArray(feed.urlAlternatives) ? feed.urlAlternatives : [])];
    const label = capSource(source);
    let items = null; // null = never reached a feed; [] = reached but empty
    let lastErr = null;
    for (const url of urls) {
      try {
        const parsed = parseRssToItems(await fetchXml(url), label);
        if (parsed.length) { items = parsed; break; }
        if (items === null) items = parsed;
      } catch (e) { lastErr = e; }
      if (typeof fetchJson === 'function') {
        try {
          const parsed = rss2JsonToItems(await fetchJson(url), label);
          if (parsed.length) { items = parsed; break; }
          if (items === null) items = parsed;
        } catch (e) { lastErr = e; }
      }
    }
    if (items === null) throw lastErr || new Error('Feed unreachable');
    return applyFilter(await enrichSeveritiesFromNvd(items), opts);
  }

  async function fetchAdvisories({ source, severities, cveCode } = {}) {
    const src = String(source || 'nvd').toLowerCase();
    if (src === 'nvd') return fetchNvd({ severities, cveCode });
    return fetchRssSource(src, { severities, cveCode });
  }

  return {
    SOURCES,
    fetchAdvisories,
    normalizeNvd,
    normalizeRssItems,
    normalizeRss2JsonItems,
    mergeNvdSeverity,
    detectSeverityFromText,
    severityFromScore,
    extractCves
  };
})();
