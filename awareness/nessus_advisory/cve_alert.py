"""
cve_alert.py
Pulls the Tenable security advisory RSS feed, generates an HTML CVE Alert
email from template.html, and sends it via Gmail SMTP.

Usage:
    python cve_alert.py

Credentials are prompted at runtime and never written to disk.
"""

import base64
import getpass
import json
import random
import re
import smtplib
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path


# =============================================================================
# RSS FEED SOURCES
# Add or swap URLs here if Tenable changes their feed location.
# Each URL is fetched on every run.
# =============================================================================
RSS_FEED_URLS = [
    "https://www.tenable.com/security/feed",           # Tenable Product Security Advisories
    # "https://www.tenable.com/security/research/feed", # Tenable Research Advisories
    # "https://www.tenable.com/blog/cyber-exposure-alerts/feed",  # Cyber Exposure Alerts
    # "https://www.tenable.com/blog/feed",              # Tenable Blog
]

# #############################################################################
# ██████████████████████████████████████████████████████████████████████████████
# ██                                                                          ██
# ██   >>>  SEVERITY FILTER  —  EDIT THE LIST ON THE LINE BELOW  <<<         ██
# ██                                                                          ██
# ██   Only advisories whose detected severity matches one of these values   ██
# ██   will be emailed.  Everything else is silently skipped.                ██
# ██                                                                          ██
# ██   Valid values:  'Critical'  'High'  'Medium'  'Low'  'Advisory'        ██
# ██   To send EVERYTHING (no filter):  ['ALL']                              ██
# ██                                                                          ██
# ██   Examples:                                                              ██
# ██       Critical only   →   ['Critical']                                  ██
# ██       Crit + High     →   ['Critical', 'High']         ← DEFAULT        ██
# ██       Add Medium      →   ['Critical', 'High', 'Medium']                ██
# ██       All alerts      →   ['ALL']                                       ██
# ██                                                                          ██
# ██████████████████████████████████████████████████████████████████████████████

ALLOWED_SEVERITIES = ['Critical', 'High', 'Medium', 'Low']

# ██████████████████████████████████████████████████████████████████████████████
# ██                       END OF SEVERITY FILTER                             ██
# ██████████████████████████████████████████████████████████████████████████████
# #############################################################################

# Max items pulled from each feed per run.
# Prevents a flood of emails on the very first run of a new feed.
MAX_ITEMS_PER_FEED = 10

# Tracks which advisory GUIDs have already been emailed so re-runs don't
# send duplicates.  Delete this file to reset and re-send everything.
SENT_CACHE_FILE  = Path(__file__).parent / "sent_cache.json"
RSS_SAVE_FILE    = Path(__file__).parent / "rss_feeds_raw.json"

# ── Internal constants ────────────────────────────────────────────────────────

SCRIPT_DIR    = Path(__file__).parent
TEMPLATE_PATH = SCRIPT_DIR / "template.html"
LOGO_PATH     = SCRIPT_DIR / "logo.txt"   # base64-encoded logo image
SMTP_HOST     = "smtp.gmail.com"
SMTP_PORT     = 587

SEVERITY_COLORS = {
    "Critical": "#800000",   # maroon
    "High":     "#cc0000",   # red
    "Medium":   "#ffa000",   # amber
    "Low":      "#27ae60",   # green
    "Advisory": "#aaaaaa",   # grey
}

# Ordered from highest to lowest so the first match wins
SEVERITY_KEYWORDS = [
    ("critical", "Critical"),
    ("high",     "High"),
    ("medium",   "Medium"),
    ("moderate", "Medium"),
    ("low",      "Low"),
]

CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)

# Keywords scanned in title+description to produce a meaningful impact statement
IMPACT_KEYWORDS = [
    ("remote code execution",  "Remote code execution — an attacker could run arbitrary code on affected systems without authentication."),
    ("arbitrary code",         "Arbitrary code execution — an attacker could execute unauthorized commands on affected systems."),
    ("privilege escalation",   "Privilege escalation — a low-privileged attacker could gain elevated or root-level system access."),
    ("sql injection",          "SQL injection — an attacker could read, modify, or delete database contents."),
    ("cross-site scripting",   "Cross-site scripting (XSS) — an attacker could inject malicious scripts into affected web interfaces."),
    ("denial of service",      "Denial of service — an attacker could crash or make affected services unavailable."),
    ("information disclosure", "Information disclosure — sensitive data may be exposed to unauthorized parties."),
    ("authentication bypass",  "Authentication bypass — an attacker could access protected resources without valid credentials."),
    ("file deletion",          "Unauthorized file deletion — an attacker could delete arbitrary files on affected systems."),
    ("buffer overflow",        "Buffer overflow — an attacker could crash the service or execute arbitrary code via memory corruption."),
    ("path traversal",         "Path traversal — an attacker could read or write files outside the intended directory."),
    ("command injection",      "Command injection — an attacker could execute arbitrary OS commands on the host."),
]

SEVERITY_IMPACTS = {
    "Critical": "Critical severity — successful exploitation could lead to full system compromise, data loss, or complete service disruption with no user interaction required.",
    "High":     "High severity — successful exploitation could result in significant data breach, service disruption, or unauthorized privileged access.",
    "Medium":   "Medium severity — successful exploitation could lead to partial compromise of affected systems or limited data exposure.",
    "Low":      "Low severity — limited impact if exploited; may assist in information gathering or enable minor unauthorized access.",
    "Advisory": "Review the referenced advisory to assess the potential impact on systems in your environment.",
}


# ── Logo loader ──────────────────────────────────────────────────────────────

def load_logo_data():
    """Return (image_bytes, subtype) from logo.txt, or (None, None) if unavailable.

    Accepts logo.txt in any of these formats:
      1. Full <img src="data:image/png;base64,..."> tag
      2. Bare data URI:  data:image/png;base64,...
      3. Bare base64 string
    Returns raw bytes + subtype (e.g. 'png') for use as a MIME inline attachment.
    """
    if not LOGO_PATH.exists():
        return None, None
    raw = LOGO_PATH.read_text(encoding="utf-8").strip()
    if not raw:
        return None, None

    # Extract data URI from <img> tag if present
    m = re.search(r"""src=["']([^"']+)["']""", raw)
    data_uri = m.group(1) if m else raw

    # Ensure we have a data URI
    if not data_uri.startswith("data:image/"):
        data_uri = f"data:image/png;base64,{data_uri}"

    # Parse  data:image/<subtype>;base64,<b64data>
    match = re.match(r"data:image/(\w+);base64,(.+)", data_uri, re.DOTALL)
    if not match:
        return None, None

    subtype  = match.group(1)          # png / jpeg / gif / bmp
    img_bytes = base64.b64decode(match.group(2))
    return img_bytes, subtype


# ── Interactive credential prompts ────────────────────────────────────────────

def prompt_credentials():
    """Ask for all Gmail details at runtime. Nothing is stored."""
    print()
    print("=" * 62)
    print("  CVE ALERT SETUP")
    print("  Enter Gmail details below.")
    print("  Credentials are used this session ONLY — never saved to disk.")
    print("=" * 62)
    print()
    print("  TIP: Gmail requires an App Password, not your normal password.")
    print("  Generate one: myaccount.google.com → Security → App passwords")
    print()

    sender_name   = input("  Sender display name   (e.g. ABI Global SOC)  : ").strip()
    sender_email  = input("  Sender Gmail address                          : ").strip()
    app_password  = getpass.getpass(
                    "  Gmail App Password    (16 chars, hidden input): "
                    )
    recipient_raw = input(
                    "  Recipient address(es) (comma-separate multiple): "
                    ).strip()
    recipients    = [r.strip() for r in recipient_raw.split(",") if r.strip()]

    print()

    missing = []
    if not sender_name:  missing.append("Sender display name")
    if not sender_email: missing.append("Sender Gmail address")
    if not app_password: missing.append("Gmail App Password")
    if not recipients:   missing.append("Recipient address(es)")

    if missing:
        sys.exit(f"[ERROR] Missing required fields: {', '.join(missing)}\n")

    if "@gmail.com" not in sender_email.lower():
        print("[WARNING] Sender address doesn't look like @gmail.com.")
        print("          Gmail SMTP (smtp.gmail.com) requires a Gmail account.\n")

    return sender_name, sender_email, app_password, recipients


# ── Sent-items cache ──────────────────────────────────────────────────────────

def load_sent_cache():
    if SENT_CACHE_FILE.exists():
        try:
            return set(json.loads(SENT_CACHE_FILE.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def save_sent_cache(cache):
    try:
        SENT_CACHE_FILE.write_text(
            json.dumps(sorted(cache), indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"[WARNING] Could not save sent cache: {exc}")


# ── RSS fetch ─────────────────────────────────────────────────────────────────

def fetch_feed(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (CVE-Alert/1.0; +security-ops)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        print(f"  [WARN] HTTP {exc.code} fetching {url}")
    except urllib.error.URLError as exc:
        print(f"  [WARN] Cannot reach {url}: {exc.reason}")
    except Exception as exc:
        print(f"  [WARN] Fetch error for {url}: {exc}")
    return None


# ── RSS parse (RSS 2.0 + Atom) ────────────────────────────────────────────────

def _el_text(parent, tag, ns=None):
    """Return stripped text of first matching child, or empty string."""
    el = parent.find(tag, ns) if ns else parent.find(tag)
    return (el.text or "").strip() if el is not None else ""


def _parse_rss2(root):
    channel = root.find("channel") or root
    items = []
    for el in channel.findall("item")[:MAX_ITEMS_PER_FEED]:
        cats = [c.text.strip() for c in el.findall("category") if c.text]
        items.append({
            "title":       _el_text(el, "title"),
            "link":        _el_text(el, "link"),
            "description": _el_text(el, "description"),
            "pubdate":     _el_text(el, "pubDate"),
            "categories":  cats,
            "guid":        _el_text(el, "guid") or _el_text(el, "link"),
        })
    return items


def _parse_atom(root):
    ns = {"a": "http://www.w3.org/2005/Atom"}
    items = []
    # Try namespaced entries first, fall back to bare tags
    entries = root.findall("a:entry", ns) or root.findall("entry")
    for el in entries[:MAX_ITEMS_PER_FEED]:
        link_el = (el.find("a:link[@rel='alternate']", ns)
                   or el.find("a:link", ns)
                   or el.find("link"))
        link = link_el.get("href", "") if link_el is not None else ""
        cats = [
            c.get("term", "") for c in (el.findall("a:category", ns) or el.findall("category"))
        ]
        desc = (_el_text(el, "a:summary", ns) or _el_text(el, "a:content", ns)
                or _el_text(el, "summary") or _el_text(el, "content"))
        items.append({
            "title":       _el_text(el, "a:title", ns) or _el_text(el, "title"),
            "link":        link,
            "description": desc,
            "pubdate":     (_el_text(el, "a:published", ns) or _el_text(el, "a:updated", ns)
                            or _el_text(el, "published") or _el_text(el, "updated")),
            "categories":  cats,
            "guid":        (_el_text(el, "a:id", ns) or _el_text(el, "id")) or link,
        })
    return items


def parse_feed(xml_bytes):
    # Defense-in-depth: xml.etree.ElementTree expands internal entities, so a
    # hostile/compromised feed could mount a "billion laughs" expansion DoS.
    # Legitimate RSS/Atom never declares a DOCTYPE or <!ENTITY>, so reject any
    # feed that does before parsing. (No external dep like defusedxml needed.)
    head = xml_bytes[:4096].lower() if isinstance(xml_bytes, (bytes, bytearray)) else b""
    if b"<!doctype" in head or b"<!entity" in head:
        print("  [WARN] Feed contains a DOCTYPE/ENTITY declaration — refusing to parse (possible XML entity-expansion attack).")
        return []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        print(f"  [WARN] XML parse error: {exc}")
        return []

    # Strip namespace prefix from root tag for comparison
    bare_tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag

    if bare_tag == "rss":
        return _parse_rss2(root)
    elif bare_tag == "feed":
        return _parse_atom(root)
    else:
        print(f"  [WARN] Unrecognised feed root element: <{root.tag}>")
        return []


# ── Severity detection ────────────────────────────────────────────────────────

_advisory_severity_cache = {}   # URL → severity, lives for this run only

def _fetch_advisory_severity(url):
    """Fetch the Tenable advisory page and extract severity via Risk Factor or CVSS score."""
    if url in _advisory_severity_cache:
        return _advisory_severity_cache[url]
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (CVE-Alert/1.0; +security-ops)"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        _advisory_severity_cache[url] = None
        return None

    # Primary: "Risk Factor: High" (most Tenable advisory pages)
    m = re.search(r"Risk\s+Factor\s*[:\s]+\s*(Critical|High|Medium|Low)", html, re.IGNORECASE)
    if m:
        result = m.group(1).capitalize()
        _advisory_severity_cache[url] = result
        return result

    # Fallback: derive from highest CVSSv3 base score on the page
    scores = re.findall(r"CVSSv3 Base\s*/\s*Temporal Score:\s*([\d.]+)", html)
    if scores:
        top = max(float(s) for s in scores)
        if top >= 9.0:   result = "Critical"
        elif top >= 7.0: result = "High"
        elif top >= 4.0: result = "Medium"
        else:            result = "Low"
        _advisory_severity_cache[url] = result
        return result

    _advisory_severity_cache[url] = None
    return None


def detect_severity(item):
    # 1. Category tags (fastest, no HTTP call)
    for cat in item.get("categories", []):
        for keyword, level in SEVERITY_KEYWORDS:
            if keyword in cat.lower():
                return level

    # 2. Title + description keywords
    blob = (item.get("title", "") + " " + item.get("description", "")).lower()
    for keyword, level in SEVERITY_KEYWORDS:
        if keyword in blob:
            return level

    # 3. Fetch the linked advisory page — Tenable stores severity there, not in the RSS
    link = item.get("link", "")
    if link:
        fetched = _fetch_advisory_severity(link)
        if fetched:
            return fetched

    return "Advisory"


# ── HTML section builders ─────────────────────────────────────────────────────

_W = "color:#ffffff;font-family:Arial;font-size:10px;line-height:1.6;"


def _sanitize_rss_html(html_str):
    """Strip inline color and font-size from RSS HTML so the template styles win.
    Parent <td> enforces color:#ffffff and font-size:10px — no override allowed."""
    html_str = re.sub(r'(?i)\bcolor\s*:\s*[^;}"\']+;?',     '', html_str)
    html_str = re.sub(r'(?i)\bfont-size\s*:\s*[^;}"\']+;?', '', html_str)
    html_str = re.sub(r'(?i)\bfont-family\s*:\s*[^;}"\']+;?','', html_str)
    return html_str


def build_summary_html(item):
    desc    = _sanitize_rss_html(item.get("description", "").strip())
    pubdate = item.get("pubdate", "").strip()

    raw_cves = CVE_RE.findall(item.get("title", "") + " " + desc)
    cves = ", ".join(sorted(set(c.upper() for c in raw_cves)))

    parts = []
    if cves:
        parts.append(
            f'<p style="{_W}margin:0 0 6px 0;">'
            f'<strong>CVE(s) Identified:</strong> {cves}</p>'
        )
    if pubdate:
        parts.append(
            f'<p style="{_W}margin:0 0 6px 0;">'
            f'<strong>Advisory Published:</strong> {pubdate}</p>'
        )
    if desc:
        parts.append(f'<div style="{_W}margin-top:8px;">{desc}</div>')

    return (
        "\n".join(parts)
        if parts
        else f'<p style="{_W}margin:0;">See advisory link for full details.</p>'
    )


def build_recommendations_html():
    bullets = [
        "Review the linked Tenable advisory and apply all vendor-recommended patches or mitigations immediately.",
        "Prioritise assets exposed to the internet and those in critical or high-value network segments.",
        "Validate patched systems using an authenticated Nessus scan before closing the ticket.",
        (
            "The scan reports will be shared with the zones shortly and we request all zones to "
            "prioritize their remediation efforts effectively. Should you have any questions or "
            "concerns, reach out to <strong>@SOC-VMS</strong>"
        ),
    ]
    li_style = f"style='{_W}margin-bottom:6px;list-style-type:circle;'"
    items_html = "\n".join(f'<li {li_style}>{b}</li>' for b in bullets)
    return (
        f'<p style="{_W}margin:0 0 8px 0;">ABI Global Security team recommends the following:</p>\n'
        f'<ul style="padding-left:20px;margin:0;">\n'
        f'{items_html}\n'
        f'</ul>'
    )


def build_impact_html(item, severity):
    blob = (item.get("title", "") + " " + item.get("description", "")).lower()
    for keyword, statement in IMPACT_KEYWORDS:
        if keyword in blob:
            return statement
    return SEVERITY_IMPACTS.get(severity, SEVERITY_IMPACTS["Advisory"])


def build_references_html(item):
    link = item.get("link", "").strip()
    if not link:
        return f'<p style="{_W}margin:0;">No reference link available.</p>'
    return (
        f'<a href="{link}" target="_blank" '
        f'style="color:#ffffff;text-decoration:underline;word-break:break-all;'
        f'font-family:Arial;font-size:10px;">'
        f'{link}</a>'
    )


# ── Template population ───────────────────────────────────────────────────────

def generate_ticket():
    return f"ABSOC{random.randint(1000, 9999)}"


def today_str():
    return datetime.today().strftime("%d-%b-%y")


def populate_template(template, item, severity):
    ticket = generate_ticket()
    title  = item.get("title", "Security Advisory").strip()

    replacements = {
        "{{LOGO_SRC}}":         "cid:company_logo",
        "{{SEQUENCE_NUMBER}}":  ticket,
        "{{DATE}}":             today_str(),
        "{{TITLE}}":            title,
        "{{OVERVIEW}}":         title,
        "{{SEVERITY}}":         severity,
        "{{SEVERITY_COLOR}}":   SEVERITY_COLORS.get(severity, "#eab308"),
        "{{SUMMARY}}":          build_summary_html(item),
        "{{POTENTIAL_IMPACT}}": build_impact_html(item, severity),
        "{{RECOMMENDATIONS}}":  build_recommendations_html(),
        "{{REFERENCES}}":       build_references_html(item),
    }

    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, value)
    return html, ticket


# ── Plain-text fallback (required for deliverability) ─────────────────────────

def build_plain_text(item, severity, ticket):
    title   = item.get("title", "Security Advisory")
    link    = item.get("link", "")
    pubdate = item.get("pubdate", "")
    # Strip HTML tags from description for plain-text version
    raw_desc = re.sub(r"<[^>]+>", " ", item.get("description", ""))
    raw_desc = re.sub(r"\s+", " ", raw_desc).strip()
    cves = ", ".join(sorted(set(CVE_RE.findall(title + " " + raw_desc))))

    lines = [
        "CYBER SECURITY ADVISORY — ABI Global Security Operations Center",
        "=" * 64,
        f"Advisory Number : {ticket}",
        f"Date Issued     : {today_str()}",
        f"Severity        : {severity}",
        "",
        "TITLE",
        title,
        "",
    ]
    if cves:
        lines += [f"CVE(s) Identified : {cves}", ""]
    if pubdate:
        lines += [f"Advisory Published : {pubdate}", ""]
    if raw_desc:
        lines += ["SUMMARY", raw_desc[:800], ""]
    lines += [
        "POTENTIAL IMPACT",
        build_impact_html(item, severity),  # plain text — no HTML tags in those strings
        "",
        "RECOMMENDATIONS",
        "ABI Global Security team recommends the following:",
        "  - Apply all vendor-recommended patches or mitigations immediately.",
        "  - Prioritise internet-exposed and critical network segment assets.",
        "  - Validate patched systems via an authenticated Nessus scan.",
        "  - Contact @SOC-VMS with questions or concerns.",
        "",
        "REFERENCES",
        link if link else "See Tenable advisory for details.",
        "",
        "-" * 64,
        "ABI Global SOC Vulnerability Management System",
        "Do not reply to this email. Contact @SOC-VMS for questions.",
    ]
    return "\n".join(lines)


# ── Email sender ──────────────────────────────────────────────────────────────

def send_email(html_body, plain_text, subject, sender_name, sender_email, app_password, recipients):
    """
    MIME structure:
      multipart/mixed                  ← outer envelope
        multipart/related              ← HTML + inline image bound together
          multipart/alternative        ← plain-text fallback + HTML body
            text/plain
            text/html                  ← references cid:company_logo
          image/<subtype>              ← logo as inline attachment (CID)
    """
    logo_bytes, logo_subtype = load_logo_data()

    # Headers on the outermost part
    outer = MIMEMultipart("mixed")
    outer["Subject"]    = subject
    outer["From"]       = f"{sender_name} <{sender_email}>"
    outer["To"]         = ", ".join(recipients)
    outer["Date"]       = datetime.now().strftime("%a, %d %b %Y %H:%M:%S +0000")
    outer["Message-ID"] = f"<absoc-{random.randint(10**9, 10**10)}.{sender_email}>"
    outer["X-Mailer"]   = "ABI-SOC-CVE-Alert/1.0"

    # multipart/related wraps HTML body + inline image
    related = MIMEMultipart("related")

    # multipart/alternative: plain text first, then HTML
    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(plain_text, "plain", "utf-8"))
    alternative.attach(MIMEText(html_body,  "html",  "utf-8"))
    related.attach(alternative)

    # Attach logo as inline image with Content-ID so HTML can reference it
    if logo_bytes:
        img_part = MIMEImage(logo_bytes, _subtype=logo_subtype or "png")
        img_part.add_header("Content-ID", "<company_logo>")
        img_part.add_header("Content-Disposition", "inline",
                            filename=f"logo.{logo_subtype or 'png'}")
        related.attach(img_part)

    outer.attach(related)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender_email, app_password)
        server.sendmail(sender_email, recipients, outer.as_string())


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # 1. Collect credentials interactively
    sender_name, sender_email, app_password, recipients = prompt_credentials()

    # 2. Load template
    if not TEMPLATE_PATH.exists():
        sys.exit(
            f"\n[ERROR] template.html not found at: {TEMPLATE_PATH}\n"
            "Place template.html in the same folder as this script.\n"
        )
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    # 3. Load dedup cache
    sent_cache = load_sent_cache()
    cache_was = len(sent_cache)

    # 4. Fetch all feeds
    print(f"Fetching {len(RSS_FEED_URLS)} feed(s)...")
    all_items = []
    for url in RSS_FEED_URLS:
        print(f"  ← {url}")
        raw = fetch_feed(url)
        if raw:
            parsed = parse_feed(raw)
            print(f"     {len(parsed)} item(s) retrieved")
            all_items.extend(parsed)

    # 4b. Save raw feed items to JSON for review
    try:
        RSS_SAVE_FILE.write_text(
            json.dumps(all_items, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"  → Raw feed saved: {RSS_SAVE_FILE}")
    except OSError as exc:
        print(f"  [WARNING] Could not save RSS JSON: {exc}")

    if not all_items:
        print(
            "\n[INFO] No items retrieved.\n"
            "Check that RSS_FEED_URLS are correct and you have internet access.\n"
        )
        return

    # 5. Process items
    print(f"\nFilter: {ALLOWED_SEVERITIES}")
    print(f"Sending to: {', '.join(recipients)}\n")
    print("-" * 66)

    sent = skipped_dup = skipped_sev = errors = 0

    for item in all_items:
        guid  = item.get("guid") or item.get("link", "")
        title = item.get("title", "No Title").strip()

        # Skip already-sent items
        if guid and guid in sent_cache:
            skipped_dup += 1
            continue

        print(f"  Checking severity: {title[:55]}...", end="\r")
        severity = detect_severity(item)

        # Hard block: only the four recognised severities are ever sent.
        # Items with no detectable severity ("Advisory") are always dropped.
        if severity not in ("Critical", "High", "Medium", "Low"):
            skipped_sev += 1
            continue

        # Soft filter: user-configured ALLOWED_SEVERITIES list
        if "ALL" not in ALLOWED_SEVERITIES and severity not in ALLOWED_SEVERITIES:
            skipped_sev += 1
            continue

        html_body, ticket = populate_template(template, item, severity)
        plain_text = build_plain_text(item, severity, ticket)
        subject = f"[{ticket}] CVE Alert — {severity}: {title[:68]}"

        try:
            send_email(html_body, plain_text, subject, sender_name, sender_email,
                       app_password, recipients)
            print(f"  [SENT]    {ticket}  |  {severity:<10}  |  {title[:48]}")
            if guid:
                sent_cache.add(guid)
            sent += 1

        except smtplib.SMTPAuthenticationError:
            sys.exit(
                "\n[FATAL] Gmail authentication failed.\n"
                "Make sure you entered a Gmail App Password, not your normal password.\n"
                "Generate one: myaccount.google.com → Security → App passwords\n"
            )
        except Exception as exc:
            print(
                f"  [ERROR]   {ticket}  |  {severity:<10}  |  {title[:48]}\n"
                f"            {exc}"
            )
            errors += 1

    # 6. Save updated cache
    if len(sent_cache) > cache_was:
        save_sent_cache(sent_cache)

    print("-" * 66)
    print(f"  Sent          : {sent}")
    print(f"  Already sent  : {skipped_dup}  (in sent_cache.json — delete to resend)")
    print(f"  Severity skip : {skipped_sev}  (not in ALLOWED_SEVERITIES)")
    print(f"  Errors        : {errors}")
    print("-" * 66)


if __name__ == "__main__":
    main()
