"""
nessus_advisory.py
Parses a Tenable Nessus CSV export, populates an HTML Security Advisory
from template.html, and emails each advisory via Gmail SMTP.

Usage:
    python nessus_advisory.py path\\to\\scan.csv
"""

# =============================================================================
# STEP 1 — SET ENVIRONMENT VARIABLES IN POWERSHELL
# ─────────────────────────────────────────────────────────────────────────────
# Open PowerShell and paste all three lines below, then run this script in
# the SAME PowerShell window.  Variables disappear when the window closes.
#
#   $env:GMAIL_SENDER   = "your.address@gmail.com"
#   $env:GMAIL_PASSWORD = "xxxx xxxx xxxx xxxx"   # Gmail App Password
#   $env:EMAIL_TO       = "recipient@example.com"
#
# HOW TO CREATE A GMAIL APP PASSWORD (your normal password will NOT work):
#   1. Go to  myaccount.google.com
#   2. Security  →  2-Step Verification  (must be enabled first)
#   3. App passwords  →  create one, name it "Nessus Advisory Script"
#   4. Copy the 16-character code into the $env:GMAIL_PASSWORD line above
# =============================================================================

import csv
import os
import random
import smtplib
import sys
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path


# #############################################################################
# ██████████████████████████████████████████████████████████████████████████████
# ██                                                                          ██
# ██   >>>  SEVERITY FILTER  —  EDIT THE LIST ON THE LINE BELOW  <<<         ██
# ██                                                                          ██
# ██   Only rows whose "Risk" column matches one of these values will be     ██
# ██   processed and emailed.  Everything else is silently skipped.          ██
# ██                                                                          ██
# ██   Valid values (capitalisation must match exactly):                     ██
# ██       'Critical'   'High'   'Medium'   'Low'   'None'                   ██
# ██                                                                          ██
# ██   Examples:                                                              ██
# ██       Critical only   →   ['Critical']                                  ██
# ██       Crit + High     →   ['Critical', 'High']         ← DEFAULT        ██
# ██       Add Medium      →   ['Critical', 'High', 'Medium']                ██
# ██       All severities  →   ['Critical', 'High', 'Medium', 'Low']         ██
# ██                                                                          ██
# ██████████████████████████████████████████████████████████████████████████████

ALLOWED_SEVERITIES = ['Critical', 'High']

# ██████████████████████████████████████████████████████████████████████████████
# ██                       END OF SEVERITY FILTER                             ██
# ██████████████████████████████████████████████████████████████████████████████
# #############################################################################


# ── Constants ─────────────────────────────────────────────────────────────────

SCRIPT_DIR    = Path(__file__).parent
TEMPLATE_PATH = SCRIPT_DIR / "template.html"
SMTP_HOST     = "smtp.gmail.com"
SMTP_PORT     = 587

SEVERITY_COLORS = {
    "Critical": "#6c1b8f",
    "High":     "#c0392b",
    "Medium":   "#d35400",
    "Low":      "#2471a3",
    "None":     "#555555",
}

# Nessus CSV columns this script reads
REQUIRED_COLUMNS = {
    "Risk",
    "CVE",
    "CVSS v3.0 Base Score",
    "Synopsis",
    "Description",
    "Solution",
    "See Also",
}


# ── Template & ticket helpers ─────────────────────────────────────────────────

def load_template():
    if not TEMPLATE_PATH.exists():
        sys.exit(
            f"\n[ERROR] template.html not found.\n"
            f"Expected: {TEMPLATE_PATH}\n"
            "Place template.html in the same folder as this script.\n"
        )
    return TEMPLATE_PATH.read_text(encoding="utf-8")


def generate_ticket():
    return f"ABSOC{random.randint(1000, 9999)}"


def today_str():
    return datetime.today().strftime("%d-%b-%y")


# ── HTML section builders ─────────────────────────────────────────────────────

def build_summary_html(cve, cvss, description):
    parts = []
    if cve.strip():
        parts.append(f"<p><strong>CVE:</strong> {cve.strip()}</p>")
    if cvss.strip():
        parts.append(f"<p><strong>CVSS v3.0 Base Score:</strong> {cvss.strip()}</p>")
    desc = description.strip().replace("\n", "<br>")
    if desc:
        parts.append(f"<p>{desc}</p>")
    return "\n".join(parts) if parts else "<p>No summary available.</p>"


def build_recommendations_html(solution):
    lines = [l.strip() for l in solution.splitlines() if l.strip()]
    if not lines:
        lines = [solution.strip()] if solution.strip() else ["No solution provided."]

    bullets = "\n".join(f"        <li>{line}</li>" for line in lines)
    final_bullet = (
        "        <li>The scan reports will be shared with the zones shortly and we request "
        "all zones to prioritize their remediation efforts effectively. Should you have any "
        "questions or concerns, reach out to <strong>@SOC-VMS</strong></li>"
    )
    return (
        "<p>ABI Global Security team recommends the following:</p>\n"
        "    <ul>\n"
        f"{bullets}\n"
        f"{final_bullet}\n"
        "    </ul>"
    )


def build_references_html(see_also):
    urls = [u.strip() for u in see_also.splitlines() if u.strip()]
    if not urls:
        return "<p>No references available.</p>"
    items = "\n".join(
        f'        <li><a href="{url}" target="_blank" '
        f'style="color:#1a5276;word-break:break-all;">{url}</a></li>'
        for url in urls
    )
    return f"    <ul>\n{items}\n    </ul>"


# ── Template population ───────────────────────────────────────────────────────

def populate_template(template, row):
    ticket   = generate_ticket()
    risk     = row.get("Risk", "Unknown").strip()
    synopsis = row.get("Synopsis", "").strip()

    replacements = {
        "{{SEQUENCE_NUMBER}}": ticket,
        "{{DATE}}":            today_str(),
        "{{TITLE}}":           synopsis,
        "{{OVERVIEW}}":        synopsis,
        "{{SEVERITY}}":        risk,
        "{{SEVERITY_COLOR}}":  SEVERITY_COLORS.get(risk, "#555555"),
        "{{SUMMARY}}":         build_summary_html(
                                   row.get("CVE", ""),
                                   row.get("CVSS v3.0 Base Score", ""),
                                   row.get("Description", ""),
                               ),
        "{{RECOMMENDATIONS}}": build_recommendations_html(row.get("Solution", "")),
        "{{REFERENCES}}":      build_references_html(row.get("See Also", "")),
    }

    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, value)
    return html, ticket


# ── Email sender ──────────────────────────────────────────────────────────────

def send_email(html_body, subject, sender, password, recipient):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = sender
    msg["To"]      = recipient
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender, password)
        server.sendmail(sender, recipient, msg.as_string())


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        sys.exit(
            "\nUsage:   python nessus_advisory.py path\\to\\scan.csv\n"
            "Example: python nessus_advisory.py C:\\Users\\GT\\Downloads\\scan.csv\n"
        )

    csv_path = Path(sys.argv[1])
    if not csv_path.exists():
        sys.exit(f"\n[ERROR] File not found: {csv_path}\n")

    sender    = os.environ.get("GMAIL_SENDER")
    password  = os.environ.get("GMAIL_PASSWORD")
    recipient = os.environ.get("EMAIL_TO")

    missing_vars = [
        name for name, val in [
            ("GMAIL_SENDER",   sender),
            ("GMAIL_PASSWORD", password),
            ("EMAIL_TO",       recipient),
        ]
        if not val
    ]
    if missing_vars:
        sys.exit(
            f"\n[ERROR] Missing environment variable(s): {', '.join(missing_vars)}\n"
            "Set them in PowerShell before running (see instructions at top of script).\n"
        )

    template = load_template()
    sent = skipped = errors = 0

    print(f"\nCSV file  : {csv_path.name}")
    print(f"Filter    : {ALLOWED_SEVERITIES}")
    print(f"Recipient : {recipient}")
    print("-" * 64)

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames:
            missing_cols = REQUIRED_COLUMNS - set(reader.fieldnames)
            if missing_cols:
                print(f"[WARNING] CSV is missing columns: {missing_cols}")
                print("          Affected fields will appear blank in the advisory.\n")

        for row in reader:
            risk = row.get("Risk", "").strip()

            if risk not in ALLOWED_SEVERITIES:
                skipped += 1
                continue

            html_body, ticket = populate_template(template, row)
            synopsis = row.get("Synopsis", "No Title").strip()
            subject  = f"[{ticket}] Security Advisory — {risk}: {synopsis[:70]}"

            try:
                send_email(html_body, subject, sender, password, recipient)
                print(f"  [SENT]   {ticket}  |  {risk:<8}  |  {synopsis[:55]}")
                sent += 1
            except smtplib.SMTPAuthenticationError:
                sys.exit(
                    "\n[FATAL] Gmail authentication failed.\n"
                    "Verify GMAIL_SENDER and GMAIL_PASSWORD are correct.\n"
                    "You must use a Gmail App Password, not your normal password.\n"
                )
            except Exception as exc:
                print(
                    f"  [ERROR]  {ticket}  |  {risk:<8}  |  {synopsis[:55]}\n"
                    f"           {exc}"
                )
                errors += 1

    print("-" * 64)
    print(f"  Sent    : {sent}")
    print(f"  Skipped : {skipped}  (severity not in filter)")
    print(f"  Errors  : {errors}")
    print("-" * 64)


if __name__ == "__main__":
    main()
