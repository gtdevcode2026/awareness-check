# Security Awareness Newsletter & Poster Generator

A static web app for creating security-awareness newsletters and posters.

## Prerequisites

- **[Python 3](https://www.python.org/downloads/)** — used by the cross-platform
  launcher (`run.py`) to serve the app. Check with `python --version` (or
  `python3 --version`). Works on Windows, macOS, and Linux.
- A modern browser (Chrome, Edge, or Firefox).
- That's it for running the app — the launcher uses only Python's standard
  library, so there is **no `npm install`** and **no Node.js** needed just to view
  it. (Node.js is only for development: tests, linting, the dev server.)



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

   On Windows you can also just **double-click `run.py`**.

3. Your browser opens automatically at **http://127.0.0.1:4173**.
4. Keep the window open while using the app; **close it (or press Ctrl+C) to stop**.

> Run `run.py` from the **project root** (the folder that contains it), not from
> inside `awareness/`.

### For development (tests, linting) — needs Node.js

Only contributors need this; running the app does **not**. Node powers the tests,
linter, and an alternative dev server:

```bash
cd awareness
npm install                 # one-time
npm run test:unit           # unit tests
npm run lint                # linter
npm run serve:static        # alternative dev server at http://127.0.0.1:4173
```

Full developer docs (testing, deployment) live in
[`awareness/README.md`](awareness/README.md).

## Notes

- The app is **static** — opening `awareness/index.html` directly from disk will
  **not** work; it must be *served* over http, which `run.py` does for you.
- Optional AI features need your own API key, entered in the app's settings
  (nothing is committed to this repo).
