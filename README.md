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

## Two ways to open it — please read

There are two things you might try. **Only one works.**

### ❌ Double-clicking `awareness/index.html` (opening the file directly)

- The page opens at a `file://…` address (read straight from your disk).
- **Why it fails:** for security, browsers **refuse to run a page's program files
  (its JavaScript) when the page is opened directly from disk.** With its code
  blocked, the app never starts.
- **Result: a blank or broken screen.** Nothing loads — not the buttons, not the
  newsletter builder, not the advisory generator, not the news feeds.
- **Do not use this method.** It is not a bug you can work around; it is how every
  modern browser behaves for files opened off the disk.

### ✅ Launching with the script — `run.py`

- Running `run.py` starts a small **local web server** and opens the app at
  **http://127.0.0.1:4173**.
- **Why this is needed / why it works:** the browser will only run the app's code
  when the page is **served over http**, not read from disk. `run.py` does that
  serving for you — so the browser now trusts and runs everything.
- **Result: the full app works** — building newsletters and posters, the security
  advisory generator, exporting files (`.html`, `.eml`, the `send_advisories.py`
  sender), and (when you're online) fetching live **news and CVE feeds**.
- This is the **supported way** to run it.

> **In one line:** the app must be *served*, not *opened from disk*. `run.py` serves
> it for you — run the script, then use the page it opens.

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

- The app is **static** but must be **served over http** — double-clicking
  `awareness/index.html` will not work (see "Two ways to open it" above). `run.py`
  serves it for you.
- Optional AI features need your own API key, entered in the app's settings
  (nothing is committed to this repo).
