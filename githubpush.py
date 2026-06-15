#!/usr/bin/env python3
"""
githubpush.py
=============
Push this project to a NEW GitHub repo as an EXACT MIRROR of your local folder,
excluding ONLY the Claude / AI-assistant files.

Whoever clones the repo gets the same folder structure and files you have here
(including node_modules/, dist/, reports, etc.) -- minus the Claude files.

WHY THIS IS SAFE
----------------
C:\\Users\\hp is itself a git repo (0 commits, no remote). Pushing "that repo"
would leak ~/.ssh keys, .npmrc, _netrc, registry hives, etc. So this script
creates a SEPARATE, isolated git repo rooted at THIS project folder and only
ever touches files under it.

WHAT IT DOES
------------
1. Writes a .gitignore that excludes ONLY Claude files.
2. Initializes a dedicated git repo here (if one doesn't already exist).
3. Adds a .gitkeep to any empty folder so the exact directory tree is preserved.
4. Force-stages EVERYTHING (so node_modules/, build output, etc. are included
   even though the project's own .gitignore would normally skip them), then
   surgically removes ONLY the Claude paths from the commit.
5. Commits, then creates a new GitHub repo and pushes:
     - uses the `gh` CLI if installed & authenticated, OR
     - falls back to the GitHub REST API with a GITHUB_TOKEN env var.

USAGE
-----
    python githubpush.py            # normal run (asks before publishing)
    python githubpush.py --dry-run  # list what WOULD be pushed; change nothing
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ----------------------------------------------------------------------------
# CONFIG  (edit these)
# ----------------------------------------------------------------------------
REPO_NAME      = "awareness-check"      # name of the new GitHub repo
VISIBILITY     = "private"              # "private" or "public"
DEFAULT_BRANCH = "main"
COMMIT_MESSAGE = "Initial commit: security awareness newsletter & poster generator"
GITHUB_USER    = ""                     # optional; auto-detected for the token path
PRESERVE_EMPTY_DIRS = True              # add .gitkeep so empty folders survive a clone

PROJECT_ROOT = Path(__file__).resolve().parent

# .gitignore content -- ONLY Claude / AI files are excluded.
CLAUDE_EXCLUDES = [
    ".claude/",
    "CLAUDE.md",
    ".claude.json",
    ".claude.json.tmp*",
    ".agents/",
    "AGENTS.md",
    "skills-lock.json",
    ".impeccable/",
]

# Names/dirs treated as "Claude / agent files" and removed from the commit.
CLAUDE_DIR_NAMES  = {".claude", ".agents", ".impeccable"}
CLAUDE_FILE_NAMES = {"CLAUDE.md", "AGENTS.md", "skills-lock.json"}

# Never descend into these while creating .gitkeep files.
SKIP_WALK_DIRS = {".git"} | CLAUDE_DIR_NAMES

GITIGNORE_MARKER = "# === managed by githubpush.py (Claude files only) ==="
GITIGNORE_END    = "# === end managed block ==="


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def run(args, *, capture=False, check=True, quiet=False):
    """Run a command inside PROJECT_ROOT. Returns stdout (str) when capture=True."""
    if not quiet:
        print(f"  $ {' '.join(args)}")
    result = subprocess.run(args, cwd=str(PROJECT_ROOT), text=True, capture_output=True)
    if check and result.returncode != 0:
        sys.stderr.write(result.stdout or "")
        sys.stderr.write(result.stderr or "")
        raise SystemExit(f"\n[ERROR] command failed ({result.returncode}): {' '.join(args)}")
    return result.stdout.strip() if capture else result


def git(*args, **kw):
    return run(["git", *args], **kw)


def section(title):
    print(f"\n=== {title} ===")


def samepath(a: str, b: str) -> bool:
    try:
        return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))
    except OSError:
        return False


def is_claude_path(rel: str) -> bool:
    """True if a repo-relative path is a Claude / AI-assistant file."""
    rel = rel.replace("\\", "/")
    parts = rel.split("/")
    if any(p in CLAUDE_DIR_NAMES for p in parts):
        return True
    base = parts[-1]
    if base in CLAUDE_FILE_NAMES:
        return True
    if base.startswith(".claude.json"):
        return True
    return False


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ----------------------------------------------------------------------------
# steps
# ----------------------------------------------------------------------------
def write_gitignore():
    section("Writing .gitignore (Claude files only)")
    block = [GITIGNORE_MARKER] + CLAUDE_EXCLUDES + [GITIGNORE_END]
    block_text = "\n".join(block) + "\n"

    path = PROJECT_ROOT / ".gitignore"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if GITIGNORE_MARKER in existing and GITIGNORE_END in existing:
        head = existing.split(GITIGNORE_MARKER)[0].rstrip()
        tail = existing.split(GITIGNORE_END)[-1].lstrip()
        new = (head + ("\n\n" if head else "") + block_text + ("\n" + tail if tail else "")).rstrip() + "\n"
    else:
        new = (existing.rstrip() + "\n\n" if existing.strip() else "") + block_text
    path.write_text(new, encoding="utf-8")
    print(f"  wrote {path} (excludes only: {', '.join(CLAUDE_EXCLUDES)})")


def add_gitkeeps():
    if not PRESERVE_EMPTY_DIRS:
        return 0
    section("Preserving empty folders (.gitkeep)")
    created = 0
    # Bottom-up so a .gitkeep added in a child makes its parent non-empty.
    for dirpath, dirnames, filenames in os.walk(PROJECT_ROOT, topdown=False):
        rel = os.path.relpath(dirpath, PROJECT_ROOT).replace("\\", "/")
        if rel == ".":
            continue
        parts = rel.split("/")
        if any(p in SKIP_WALK_DIRS for p in parts):
            continue
        if not os.listdir(dirpath):  # truly empty right now
            (Path(dirpath) / ".gitkeep").write_text("", encoding="utf-8")
            created += 1
    print(f"  added {created} .gitkeep file(s)")
    return created


def ensure_repo():
    """Returns True if a new repo was initialized by this run."""
    section("Ensuring a dedicated git repo for this project")
    toplevel = git("rev-parse", "--show-toplevel", capture=True, check=False, quiet=True)
    if toplevel and samepath(toplevel, str(PROJECT_ROOT)):
        print(f"  repo already initialized at {PROJECT_ROOT}")
        created = False
    else:
        if toplevel:
            print(f"  note: this folder is inside another repo ({toplevel}); creating an")
            print("  isolated repo here so that outer repo is never touched.")
        git("init")
        git("symbolic-ref", "HEAD", f"refs/heads/{DEFAULT_BRANCH}", check=False, quiet=True)
        created = True
        print(f"  initialized new repo at {PROJECT_ROOT}")
    # Preserve exact bytes (no CRLF/LF rewriting) so the mirror is faithful.
    git("config", "core.autocrlf", "false", quiet=True)
    return created


def stage_mirror():
    """Force-stage everything, then drop only the Claude paths from the index."""
    section("Staging an exact mirror (then removing Claude files)")
    git("add", "--all", "--force")

    staged = [f for f in git("diff", "--cached", "--name-only", capture=True, quiet=True).splitlines() if f.strip()]
    to_remove = [f for f in staged if is_claude_path(f)]
    if to_remove:
        for batch in chunks(to_remove, 100):
            git("rm", "--cached", "--quiet", "--", *batch)
        print(f"  removed {len(to_remove)} Claude file(s) from the commit")
    else:
        print("  no Claude files were staged")

    # mark the *nix launchers executable so they can be double-clicked / run directly
    for launcher in ("run.command", "run.sh"):
        if (PROJECT_ROOT / launcher).exists():
            git("update-index", "--chmod=+x", "--", launcher, check=False, quiet=True)

    final = [f for f in git("diff", "--cached", "--name-only", capture=True, quiet=True).splitlines() if f.strip()]
    leaked = [f for f in final if is_claude_path(f)]
    if leaked:
        print("  [WARN] Claude files still staged (unexpected):")
        for f in leaked[:10]:
            print(f"    ! {f}")
    print(f"  {len(final)} file(s) will be committed (mirror minus Claude files)")
    return final


def commit():
    section("Committing")
    if git("diff", "--cached", "--quiet", check=False, quiet=True).returncode == 0:
        print("  nothing to commit (already matches HEAD).")
        return
    git("commit", "-m", COMMIT_MESSAGE)
    git("branch", "-M", DEFAULT_BRANCH)
    print("  committed.")


def has_origin() -> bool:
    return "origin" in git("remote", capture=True, check=False, quiet=True).split()


def push_with_gh():
    print("  using gh CLI to create the repo and push...")
    run(["gh", "repo", "create", REPO_NAME, f"--{VISIBILITY}",
         "--source", ".", "--remote", "origin", "--push"])


def api_request(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "githubpush.py")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def push_with_token(token):
    print("  using GITHUB_TOKEN + GitHub API to create the repo and push...")
    user = GITHUB_USER or api_request("https://api.github.com/user", token)["login"]
    print(f"  authenticated as {user}")
    try:
        repo = api_request("https://api.github.com/user/repos", token, method="POST",
                           payload={"name": REPO_NAME, "private": VISIBILITY == "private"})
        print(f"  created {repo['full_name']}")
    except urllib.error.HTTPError as e:
        if e.code == 422:
            print(f"  repo '{REPO_NAME}' already exists; will push to it.")
        else:
            raise SystemExit(f"[ERROR] GitHub API {e.code}: {e.read().decode()}")

    clean_url = f"https://github.com/{user}/{REPO_NAME}.git"
    token_url = f"https://{user}:{token}@github.com/{user}/{REPO_NAME}.git"
    if has_origin():
        git("remote", "set-url", "origin", token_url, quiet=True)
    else:
        git("remote", "add", "origin", token_url, quiet=True)
    git("push", "-u", "origin", DEFAULT_BRANCH)
    git("remote", "set-url", "origin", clean_url, quiet=True)  # scrub token from config
    print(f"  pushed. Remote scrubbed to {clean_url}")


def push():
    section("Creating GitHub repo & pushing")
    if has_origin():
        print("  'origin' already configured; pushing to it.")
        git("push", "-u", "origin", DEFAULT_BRANCH)
        return
    if shutil.which("gh") and run(["gh", "auth", "status"], check=False, quiet=True).returncode == 0:
        push_with_gh()
        return
    if shutil.which("gh"):
        print("  gh is installed but not authenticated. Run: gh auth login")
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        push_with_token(token)
        return
    print(
        "\n  [SKIPPED PUSH] No way to create the remote was available.\n"
        "  Your changes ARE committed locally. To push, either:\n"
        "    A) gh auth login   (then re-run:  python githubpush.py)\n"
        "    B) set a token:     $env:GITHUB_TOKEN = \"ghp_xxx\"   (then re-run)\n"
    )


def dry_run_preview():
    """Filesystem-only preview -- creates NO repo and writes NO files."""
    section("DRY RUN -- files that WOULD be pushed (mirror minus Claude)")
    included, total_bytes, excluded = [], 0, 0
    for dirpath, dirnames, filenames in os.walk(PROJECT_ROOT):
        rel_dir = os.path.relpath(dirpath, PROJECT_ROOT).replace("\\", "/")
        parts = [] if rel_dir == "." else rel_dir.split("/")
        if ".git" in parts or any(p in CLAUDE_DIR_NAMES for p in parts):
            dirnames[:] = []  # don't descend
            continue
        # prune excluded subdirs before descending
        dirnames[:] = [d for d in dirnames if d not in (SKIP_WALK_DIRS)]
        for fn in filenames:
            rel = (fn if rel_dir == "." else f"{rel_dir}/{fn}")
            if is_claude_path(rel):
                excluded += 1
                continue
            included.append(rel)
            try:
                total_bytes += (Path(dirpath) / fn).stat().st_size
            except OSError:
                pass
    for f in sorted(included)[:40]:
        print(f"  + {f}")
    if len(included) > 40:
        print(f"  ... and {len(included) - 40} more")
    print(f"\n  would push {len(included)} files ({total_bytes/1024/1024:.1f} MB); "
          f"excluded {excluded} Claude file(s).")
    print("  (preview only -- nothing was created, committed, or pushed.)")


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    if not shutil.which("git"):
        raise SystemExit("[ERROR] git is not installed / not on PATH.")

    print(f"Project root : {PROJECT_ROOT}")
    print(f"New repo     : {REPO_NAME} ({VISIBILITY})")
    print(f"Mode         : EXACT MIRROR, excluding only Claude files")

    if "--dry-run" in sys.argv:
        dry_run_preview()
        return

    write_gitignore()
    add_gitkeeps()
    ensure_repo()
    files = stage_mirror()
    if not files:
        print("\nNothing to commit. Done.")
        return

    print()
    answer = input(f"Commit {len(files)} files and publish to GitHub repo "
                   f"'{REPO_NAME}' ({VISIBILITY})? [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        print("Aborted. Nothing was committed or pushed.")
        git("reset", quiet=True)
        return

    commit()
    push()
    print("\nDone.")


if __name__ == "__main__":
    main()
