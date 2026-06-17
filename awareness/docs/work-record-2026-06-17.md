# Work record — 2026-06-17

Two changes requested: (1) fix the Qualys advisory feed so it works like Tenable,
and (2) send **advisories** by email the way the standalone `nessus_advisory` /
`cve_alert` tools do — one email per advisory. (An earlier misread that emailed the
newsletter as a ZIP was reverted; see §2.)

---

## 1. Qualys advisory feed — now yields advisories like Tenable

### Root cause
`App.AdvisorySources` builds one advisory per CVE by extracting CVE ids from feed
items. Tenable's feed (`/cve/feeds`) names the CVE in the item **title**, so it
works. Qualys points at `blog.qualys.com/feed`, a general blog whose items name
the CVE only in the **full post body** (`<content:encoded>`), never the title or
the short `<description>`. `parseOneRss` only scanned title+description, so every
Qualys item was dropped for "no CVE id" → Qualys returned nothing.

### Fix — `js/advisory_sources.js`
- Added `contentEncodedText(el)` — reads `<content:encoded>` (qualified-name
  lookup via `getElementsByTagName`, with a `localName === 'encoded'` fallback).
- `parseOneRss` now also scans the full body (`content:encoded` for RSS, `content`
  for Atom) for the CVE id **and** for severity detection. Description falls back
  to a trimmed body excerpt when the short `<description>` is empty.
- `rss2JsonToItems` now scans **both** `description` and `content` (rss2json
  returns the full body in `content`).
- `parseRssLenient` wrapper now declares the `content`/`dc` XML namespaces so a
  per-item block containing `<content:encoded>` still parses (an undeclared prefix
  is a hard XML error that would otherwise void the item).
- Qualys feed config: kept `https://blog.qualys.com/feed` as primary and added
  `https://threatprotect.qualys.com/feed/` (vuln/CVE-dense) as a fallback.

### Tests — `tests/unit/advisory-sources.test.js`
- New `QUALYS_BLOG_RSS` fixture (CVE only in `<content:encoded>`): asserts both
  CVE-bearing posts are kept with severity read from the body, and the marketing
  post (no CVE anywhere) is dropped.
- New `QUALYS_RSS2JSON` fixture: asserts the CVE is extracted from the `content`
  field when `description` omits it.

---

## 2. Send advisories the nessus way — a standalone Python sender, NO relay

> History: this started as a relay-based per-email send (`sendAdvisoriesIndividually`
> → one `callRelay` POST per CVE). The user then asked to drop the relay entirely
> and "make it completely like the nessus advisory zip… run it like the script…
> I just enter the sender email and recipients, no relay endpoint whatsoever."
> So the relay path for advisories was replaced with the standalone-script method
> below. (Two prior reverts also stand: the misread newsletter "Send as ZIP" was
> fully reverted earlier; both relay servers remain at their original state.)

### Why a downloaded script (the constraint)
A browser page **cannot open an SMTP socket** — that is the entire reason a relay
existed. To honour "no relay endpoint whatsoever" while still mailing one-per-advisory,
the **Build Advisory Sender** button generates a **self-contained `send_advisories.py`**
and downloads it. The user runs `python send_advisories.py`, enters the sender +
recipients when prompted, and it sends straight over SMTP — exactly the
`nessus_advisory.py` model. No server, no relay URL, nothing to host.

> Reference: the sender to replicate is **`nessus_advisory.py`** (env-var creds),
> NOT `cve_alert.py` (which is the RSS feed-puller). Subject + send loop already
> matched `nessus_advisory.py`; the credential method was switched to its env vars.

### What the generated script does (replicates `nessus_advisory.py`)
- **Credentials via the same environment variables as `nessus_advisory.py`** —
  `GMAIL_SENDER`, `GMAIL_PASSWORD`, `EMAIL_TO` (set in PowerShell, run the script;
  `SMTP_HOST`/`SMTP_PORT` optionally override Gmail). A fully-env run is
  **non-interactive**, exactly like the original. Anything *not* set in the
  environment is asked for at the prompt (so you can "just enter sender +
  recipients"), pre-filled from the app's delivery config. `GMAIL_PASSWORD` may be
  unset/blank for an internal relay that needs no login. The **password is never
  embedded**; credentials are used for that run only and never written to disk.
- Sends **ONE EMAIL PER ADVISORY** via `server.sendmail(...)` in a loop
  (`587` STARTTLS / `465` SSL).
- MIME structure `multipart/mixed → related → alternative(plain + html) → inline
  cid: images` (so logos/QRs render inline in Outlook + Gmail), with a tag-stripped
  plain-text fallback.
- Subject `[<TICKET>] Security Advisory — <Severity>: <title (≤70)>`, the ticket
  taken from the built HTML so subject and the body's "Advisory Number" agree.
- Console output is ASCII-sanitised so it never raises `UnicodeEncodeError` on a
  legacy Windows console code page.

### New module — `js/advisory_send_script.js` → `App.AdvisorySendScript`
- Pure `render(advisories, defaults)` → Python source string.
- Advisories (`{subject, html, attachments[]}`) + suggested defaults are embedded
  as **base64(JSON)** so the advisory HTML (with its inline `cid:` images) never
  has to be escaped into Python literals.
- The Python template is held with **`String.raw`** so regex backslashes
  (`\1`, `\s`, `\n`) survive JS escape processing; a dependency-free UTF-8→base64
  encoder keeps the module working identically in the browser and the Node vm test.

### Client — `js/ui_controller.js`
- `sendAdvisoriesIndividually()` (relay loop) **replaced by**
  `buildAdvisorySenderScript()`:
  - Guard: only acts when `state.newsletterWorkspace.format === 'advisory'`.
  - Per item: `App.NewsletterBuilder.build('advisory', cfg, [item], opts)` →
    `toStandaloneHtml(...)` → `prepareImagesForRelay(...)` (images → `cid:` +
    attachments) → `{subject, html, attachments}`.
  - Calls `App.AdvisorySendScript.render(...)` and downloads `send_advisories.py`
    via `downloadBlob`. **No relay, no preflight, no delivery-log writes** — the
    script does the sending.
- Export line: `sendAdvisoriesIndividually` → `buildAdvisorySenderScript`.

### UI — `send.html`
- Button now **"Build Advisory Sender (.py)"** → `App.UI.buildAdvisorySenderScript()`,
  with a hint line explaining the `python send_advisories.py` step.
- Added `<script src="js/advisory_send_script.js"></script>` (after
  `delivery_helpers.js`).

---

## 3. Advisory → combined `.eml` (Outlook draft) — second no-relay option

Added **alongside** the `.py` sender (does not replace it). Directly answers the
"without an app password / relay" ask: an `.eml` with `X-Unsent: 1` opens in Outlook
as an **editable draft** (images inline) and Outlook sends it **as the logged-in
user** — no relay, no Python, no SMTP credentials.

### Packaging — ONE combined `.eml` (corporate-safest)
The whole selection (one advisory **or** a cluster) is stacked into a **single**
`.eml`/draft. Chosen over a ZIP-of-`.eml` because corporate AV/EDR commonly
quarantines archives containing `.eml`/`.msg` (nested-message phishing pattern) and
Windows Mark-of-the-Web blocks files extracted from a downloaded zip. One file → none
of that, and **no JSZip dependency**.

### `js/utils.js`
- `buildEmlMime(html, attachments, opts)` extended with **optional `to`/`from`**
  headers (emitted only when provided, so the subject-only newsletter caller is
  byte-for-byte unchanged). New private `_encodeMimeAddress()` RFC 2047-encodes the
  display name but leaves `<addr@domain>` literal so Outlook parses the address.
- New pure, exported `combineHtmlBodies(docs, opts)` — lifts each standalone doc's
  `<body>` inner, keeps the first doc's `<body>` attributes + `<head>` `<style>`,
  joins with an invisible email-safe spacer (`advisory-break` marker), returns one
  combined standalone document. Combining **before** image inlining keeps CIDs
  globally unique/deduped (image→cid runs once).
- New pure, exported `emlFileName(cveOrTicket, fallbackIndex)` — sanitized
  `advisory-<id>.eml` (single-advisory filename).

### `js/ui_controller.js`
- New `downloadAdvisoryEml()` — forks the `buildAdvisorySenderScript()` loop, but
  combines the per-advisory standalone docs (`combineHtmlBodies` for a cluster, the
  single doc as-is for one), runs `prepareImagesForRelay` once, prefills `To` from
  `#smtp-send-to` and `From` from the SMTP profile (both optional), and downloads one
  `.eml` via `buildEmlMime`. Subject `[TICKET] Security Advisory — …` for one, or
  `Security Advisories — N alerts (date)` for a cluster. Exported on `App.UI`.

### `send.html`
- New **"Advisory → EML (Outlook)"** button next to the `.py` button; the help text
  now describes both no-relay options. **No JSZip tag, no CSP change.**

---

## 4. NVD advisories fixed — proxy resilience (no API key)

### Root cause
NVD itself was healthy (a direct call returns HTTP 200), but `fetchNvd` reached it
through **one** hard-coded CORS proxy with **no fallback and no retry**
(`proxied()` → `api.allorigins.win/raw` only). When that proxy is down/rate-limited
(observed live: 520/522/408), every NVD query failed — and the errors were swallowed
(`if (!resp.ok) continue` / `catch {}`), so Home showed "No advisories found" with no
real reason. The Tenable/Qualys RSS feeds kept working because they race **three**
proxies with retries (`App.RSSFetcher.fetchXmlViaProxies`); NVD had none of that.

### Fix — `js/advisory_sources.js` (no API key)
- New `JSON_PROXIES` pool + `fetchNvdJson(url, retries, timeout)` — races the pool
  with `Promise.allSettled`, first **valid NVD payload** wins (rejects proxy
  HTML/error pages by requiring `vulnerabilities`/`totalResults`), retries, and uses
  an `AbortController` timeout (guarded so it still runs in the no-AbortController
  unit sandbox). Mirrors the RSS path's resilience. allorigins `/get` `{contents}`
  wrapper is unwrapped.
- `fetchNvd` now tracks `reached`: **throws a clear error** when every proxy fails on
  every attempt (so the UI toasts a real reason) vs returning `[]` only when the
  proxies genuinely returned no matches.
- `enrichSeveritiesFromNvd` (RSS severity backfill) uses a `fast` lookup (1 try,
  6 s) and **early-aborts after 2 consecutive failures** so a down NVD never hangs
  the already-succeeded RSS fetch.

### Tests — `tests/unit/advisory-sources.test.js`
- `loadSourcesWithFetch(fetchImpl)` lets tests stub `fetch` per proxy URL. New cases:
  falls back to a working proxy when the first is down; ignores non-NVD proxy error
  pages; throws a clear reason when every proxy fails.

---

## Verification
- `npm run test:unit` → **497 passed, 0 failed** (494 prior + 3 new NVD proxy-
  resilience tests; the 6 EML tests; the 8 advisory-sender tests; the Qualys tests).
- **NVD diagnosis (live):** direct NVD call = HTTP 200 (healthy); `api.allorigins.win`
  = 520/522/408 (the single proxy the old code used). Unit tests prove the new pool
  falls back to a working proxy and throws a clear reason when all fail. (A live pool
  success isn't reproducible from this sandbox — its egress to the proxy hosts is
  blocked and allorigins is mid-outage — but the user's browser reaches the same
  proxies the working RSS feeds use.)
- `npx eslint js/utils.js js/ui_controller.js js/advisory_send_script.js …` →
  **0 errors** (pre-existing warnings only).
- **Python end-to-end** (`send_advisories.py`): `py_compile` passes; embedded
  base64 payload decodes (2 advisories, `port`→`465`); env-var creds
  (`GMAIL_SENDER`/`GMAIL_PASSWORD`/`EMAIL_TO`) resolve **non-interactively**;
  `build_message(...)` builds `multipart/mixed`+`related`+`alternative` with inline
  `Content-ID` logo + both recipients; `plain_text_from_html` strips `<script>`.
- **EML end-to-end** (combine two advisory docs → `buildEmlMime`): valid RFC822 with
  `X-Unsent: 1`, one `multipart/related`, prefilled `From`/`To`, inline
  `Content-ID: <aw-abi-png>`, both advisories + their `ABSOC####` tickets, exactly
  one `<body>`, one separator, first doc's `<head>` `<style>` preserved.

## Files touched (net)
- `js/advisory_send_script.js` — **new** standalone Python-sender generator (§2).
- `tests/unit/advisory-send-script.test.js` — **new** (8 tests, §2).
- `js/ui_controller.js` — `buildAdvisorySenderScript()` (§2, replaces
  `sendAdvisoriesIndividually`) **and** `downloadAdvisoryEml()` (§3); both exported.
- `js/utils.js` — `buildEmlMime` To/From + new `combineHtmlBodies` / `emlFileName` (§3).
- `tests/unit/build-eml-mime.test.js` — +6 tests (To/From, combine, filename, §3).
- `send.html` — "Build Advisory Sender (.py)" + "Advisory → EML (Outlook)" buttons,
  `advisory_send_script.js` script tag, hint text.
- `js/advisory_sources.js` — Qualys body-scan fix (§1) **and** NVD proxy
  resilience: `JSON_PROXIES`/`fetchNvdJson`, `fetchNvd` throws-on-all-fail,
  fast/early-abort enrichment (§4).
- `tests/unit/advisory-sources.test.js` — Qualys tests (§1) + 3 NVD
  proxy-resilience tests and `loadSourcesWithFetch` (§4).

## Notes / follow-ups
- This is a genuine no-backend path: the app only **generates** the sender; the
  user runs it. Defaults are pre-filled from the app's delivery config, but the
  app's relay/workflow preflight no longer gates advisory sending.
- Single `.py` (not a zip): nothing to unzip and no Windows "Mark-of-the-Web"
  block on extracted HTML. If a literal multi-file zip bundle is ever wanted, the
  same `render()` payload can be split into files + a loader.
- Live Qualys fetching depends on the public CORS proxies (unchanged); the parsing
  fix is what makes blog-style feeds yield advisories. If `blog.qualys.com/feed`
  returns no CVE-bearing posts, the `threatprotect.qualys.com` fallback is tried.
