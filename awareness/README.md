# Phishing & Security Awareness — Newsletter Generator

Turn **live security news** into **employee-ready awareness content** in minutes. No server required: open the page in a browser, fetch curated feeds, pick stories, and export polished HTML for email or your intranet.

---

## Prerequisites

Pick **one** way to run it — full details in [`REQUIREMENTS.txt`](REQUIREMENTS.txt):

- **Docker** *(recommended for hosting)* — Docker Desktop (Engine 20.10+ with Compose v2). The production build runs **inside the image** — nothing else to install.  
- **nginx 1.18+** *(bare-metal hosting, no Docker)* — serve the static app with the bundled [`deploy/nginx.conf.example`](deploy/nginx.conf.example).

AI summaries need an API key (entered in the app); email sending needs an SMTP/Graph relay; RSS needs nothing.

---

## Quick start

**Simplest — no install:** open **`index.html`** in a modern browser, then click **Fetch Live News** (or **Load from DB** after a first fetch). A few extras — server-side ensemble logging, and saving a replaced image into the shipped library — need one of the served options below.

**Serve with Docker + nginx** *(from the `awareness/` folder):*

```bash
docker compose -f deploy/docker-compose.yml up -d --build
# then open http://localhost:8080
```

**Serve with nginx** *(bare metal, no Docker):*

Point nginx at the app using the bundled [`deploy/nginx.conf.example`](deploy/nginx.conf.example) — set `__WEB_ROOT__` to the `awareness/` folder, fill in your domain and TLS, then:

```bash
nginx -t && nginx -s reload
# then open your site
```

---

## Who it's for

- **Security / GRC teams** who run weekly or monthly awareness bulletins  
- **IT and SOC** who want timely, credible stories without writing from scratch  
- **MSPs and consultants** who deliver awareness programs for clients  

---

## What it does

| Capability | Why it matters |
|------------|----------------|
| **35 trusted RSS sources** | Government CERTs (CISA, NCSC, ENISA, etc.), major vendors, and security journalism — one place instead of dozens of bookmarks. |
| **Data-privacy & employee filter** | Keeps stories aligned with **people risk**: phishing, scams, MFA, breaches, social engineering, privacy — not raw CVE-only advisories. You see how many items matched vs. total in each feed. |
| **Local database (IndexedDB)** | Articles persist for **up to 90 days** with deduplication. **Load from DB** when you're offline or want to reuse past pulls. |
| **Smart summaries** | Optional **Claude or OpenAI** for plain-language summaries and tips, or **built-in local summaries** when you don't use an API key. |
| **14 newsletter templates** | Email-safe layouts aligned with the standalone pack in `templates/imported-standalone/` (warm outer band, elevated card, Arial/Georgia stacks at send time), plus digest and test variants — with your **org name, SOC email, portal link, and classification** baked in. |
| **QR codes & report CTAs** | Optional portal QR and "report suspicious" blocks so every send drives **real behavior**. |

---

## How you use it (workflow)

1. **Configure** — Org name, SOC mailbox, awareness portal URL, frequency, and how many stories per send.  
2. **Fetch Live News** — Parallel fetch with fallbacks (proxies + RSS bridges) for feeds that are hard to reach from the browser.  
3. **Filter by date** — 7 / 14 / 30 / 90 days or all stored.  
4. **Select articles** — Up to your chosen limit; optional type chips (Phishing, Data Breach, etc.).  
5. **Generate** — Preview HTML, copy to clipboard, paste into Outlook, Google Workspace, or your CMS.  

---

## Tech at a glance

- **Single-page app**: `index.html` + vanilla JavaScript modules (no build step).  
- **IndexedDB** for storage and merge-friendly **upserts** (summaries and tips stay saved).  
- **SVG graphics** for threat-type illustrations in the builder.  

---

## Privacy & trust (talking points for promotion)

- **Your API keys** (if used) stay in **your browser**; there is no vendor backend in this repo.  
- **Curation is explicit**: the product is honest that it filters for **employee-relevant** and **data-privacy** angles — so stakeholders trust you're not spamming staff with patch-only noise.  
- **Portable**: works as a static site; suitable for air-gapped or internal hosting if you add your own fetch path later.  

---

## Downloads & the "this file might be harmful" warning

When you use **Download All**, the app bundles your per-language newsletter pages into a single `.zip` **inside your browser** and saves it to your computer. At that moment some browsers — most often **Chrome** and **Microsoft Edge** on Windows — show a caution prompt such as *"This file isn't commonly downloaded,"* *"… might be harmful — Keep / Discard,"* or Edge's *"blocked because it could harm your device."*

**This is expected, and the file is safe.** The ZIP only contains the HTML newsletter pages you just generated — nothing else.

### Why it happens (in plain terms)

The browser doesn't open the file to inspect it — it decides based on **reputation**, and a freshly-exported zip fails every check it relies on:

- The ZIP is **built new every time you export**, so it's a file the browser has **never seen before** and can't recognize.
- **`.zip` is a file type browsers treat cautiously**, because zips are a common way malware gets passed around.
- It isn't **signed by a known publisher** and didn't arrive from a well-known website, so there's **no one for the browser to "vouch" for it**.

Put together — a brand-new, unrecognized zip with no track record — the browser plays it safe and asks you to confirm. It's an *"I don't recognize this"* prompt, **not** a *"this is a virus"* finding. (Note: code-signing wouldn't remove this — signing applies to installable programs, and the prompt is a reputation check, not a signature check.)

### How to get the file (the right-click / keep steps)

1. **At the download prompt, keep the file.** In **Chrome**, click the **⋮** next to the flagged download (or right-click it) and choose **Keep**. In **Edge**, hover the item, click **…**, then **Keep → Keep anyway**.
2. **If Windows warns when you open the extracted pages** (a separate *"this file came from another computer"* notice): **right-click the downloaded `.zip` → Properties →** tick **Unblock** (near the bottom of the *General* tab) **→ OK**, then extract. This clears the "downloaded from elsewhere" tag (Windows' *Mark of the Web*) so the HTML files open without further prompts.

> Prefer to avoid the prompt entirely? Use **Download HTML** (one language at a time) instead of **Download All** — single HTML files generally don't trigger the zip warning.

---

## Advisories on a restricted / corporate network

The Advisory feature pulls CVE data from **NVD** (fetched **directly** — no proxy needed) and, optionally, **Tenable/Qualys** RSS (which have no CORS, so they go through public CORS proxies). On a locked-down network you may see *"NVD unreachable… signal is aborted without reason"* — that's the public proxies being **blocked by a firewall/web filter**, not down.

- **NVD** works as long as the network allows `services.nvd.nist.gov` (it usually does).
- For **Tenable/Qualys** behind such a filter, ask IT to allow the public proxy domains (`api.allorigins.win`, `corsproxy.io`, `api.codetabs.com`, `api.rss2json.com`).

---

## Positioning (one-liner)

**"Credible sources → filtered for real people → ready-to-send awareness — in one screen."**

Use that line on landing pages, proposals, and LinkedIn when you describe what the tool delivers without overpromising autonomous SOC or compliance certification.

---

*Built for teams who care about clarity, credibility, and speed — not buzzwords.*
