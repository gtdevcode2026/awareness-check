# Security Awareness Newsletter & Poster Generator

A static web app for creating security-awareness newsletters and posters.

## Prerequisites

- **[Node.js](https://nodejs.org) (LTS, v18 or newer)** — the only requirement.
  Check with `node -v`.
- A modern browser (Chrome, Edge, or Firefox).
- That's it. The download already includes all dependencies (`node_modules/`),
  so there is **no `npm install` step** for normal use.

## How to run

1. **Get the code** — on GitHub click **Code → Download ZIP** and unzip it,
   or `git clone <repo-url>`.
2. **Launch it:**
   - **Windows** — double-click **`run.bat`**
   - **macOS** — double-click **`run.command`** *(first time: right-click → Open)*
   - **Linux** — run `./run.command` in a terminal
3. Your browser opens automatically at **http://127.0.0.1:4173**.
4. Keep the small terminal window open while using the app; **close it to stop**.

### Run from a terminal instead

```bash
cd awareness
npm run serve:static        # serves at http://127.0.0.1:4173
```

(If you cloned without dependencies, run `npm install` once inside `awareness/` first.)

## Notes

- The app is **static** — opening `awareness/index.html` directly from disk will
  **not** work; it must be *served* over http, which the launchers do for you.
- Optional AI features need your own API key, entered in the app's settings
  (nothing is committed to this repo).
- Developer docs (tests, linting, deployment) live in
  [`awareness/README.md`](awareness/README.md).
