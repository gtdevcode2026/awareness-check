# Security Awareness Newsletter & Poster Generator

A static web app for creating security-awareness newsletters, posters, and CVE
security advisories.

## Prerequisites

- **[Python 3](https://www.python.org/downloads/)** — used by the launcher
  (`run.py`) to serve the app. Check with `python --version` (or `python3
  --version`). Works on Windows, macOS, and Linux.
- A modern browser (Chrome, Edge, or Firefox).
- An internet connection if you want the live **news / CVE feeds** to load.
- That's it to *run* the app — the launcher uses only Python's standard library,
  so there is **no `npm install`** and **no Node.js** needed just to view it.
  (Node.js is only for development: tests, linting, the dev server.)

## Two ways to open it

**Both work.** The only difference is whether the **live news / CVE feeds** (and
the optional AI features) load.

### ✅ Double-clicking `awareness/index.html` (opening the file directly)

- The page opens at a `file://…` address (read straight from your disk).
- **The app runs.** Building newsletters, posters, and security advisories;
  editing; and exporting files (`.html`, `.eml`, the `send_advisories.py` sender)
  all work — fully offline.
- **The one limit:** the live **news / CVE feeds** and the optional **AI**
  features need a network call the browser will not make from a `file://` page, so
  those stay empty. Everything you build or paste in by hand still works.
- Fine if you just want to build and export without the live feeds.

### ✅ Launching with the script — `run.py` (recommended)

- Running `run.py` starts a small **local web server** and opens the app at
  **http://127.0.0.1:4173**.
- **Everything from double-click mode, plus** the live **news / CVE feeds** and AI
  features — because the page is now **served over http**, the browser allows those
  network calls.
- Use this when you want the feeds to load. This is the **supported way** to run it.

> **In one line:** double-click runs the app for building and exporting; use
> `run.py` when you also want the live feeds.

## How to run

Works the same on **Windows, macOS, and Linux** — all you need is **Python 3**.

1. **Get the code**

   ```bash
   git clone <repo-url>
   cd <repo-folder>           # the folder that contains run.py
   ```

   (or on GitHub click **Code → Download ZIP**, unzip it, and open the unzipped
   folder)

2. **Launch it** — from that folder (the one containing `run.py`):

   ```bash
   python run.py             # or:  python3 run.py
   ```

   On Windows you can also just **double-click `run.py`** (this is fine — it is
   `index.html` that must not be opened directly).

3. Your browser opens automatically at **http://127.0.0.1:4173**.
4. Keep the window open while using the app; **close it (or press Ctrl+C) to stop**.

> Run `run.py` from the **project root** (the folder that contains it), not from
> inside `awareness/`.

### A note on the news / CVE feeds

The live feeds (NVD, Tenable, Qualys) are fetched through public relay services
because a browser cannot call those sites directly. So they work **only when**:

1. the app is **launched with `run.py`** (served over http — not double-clicked), **and**
2. your machine is **online**.

If a feed shows "no results" or "unreachable," it usually means a public relay is
temporarily down — try again shortly. Everything else (building, editing,
exporting) works offline.

### For development (tests, linting) — needs Node.js

Only contributors need this; running the app does **not**. Node powers the tests,
linter, and an alternative dev server:

```bash
cd awareness
npm install                 # one-time
npm run test:unit           # unit tests
npm run lint                # linter
npm run serve               # dev server at http://127.0.0.1:4173 (+ helpers)
```

Full developer docs (testing, deployment) live in
[`awareness/README.md`](awareness/README.md).

## Notes

- The app is **static**. Double-clicking `awareness/index.html` runs it for
  building and exporting; serving it with `run.py` over http additionally enables
  the live **news / CVE feeds** and AI (see "Two ways to open it" above).
- Optional AI features need your own API key, entered in the app's settings
  (nothing is committed to this repo).
