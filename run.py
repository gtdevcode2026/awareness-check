#!/usr/bin/env python3
"""
Security Awareness app — local launcher.

Serves the static app in ./awareness over http and opens it in your browser.
Pure Python standard library: no Node.js and no `npm install` are needed just to
view the app (it is a fully static site). Keep this window open while using the
app; close it or press Ctrl+C to stop.

    Windows / macOS / Linux:   python run.py     (or  python3 run.py )

Developer tasks (tests, linting, the dev server) still use Node + npm — see the
README. This launcher is only for running the app.
"""

from __future__ import annotations

import http.server
import os
import socket
import sys
import threading
import webbrowser
from functools import partial

HOST = "127.0.0.1"
PORT = 4173
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(PROJECT_ROOT, "awareness")
URL = f"http://{HOST}:{PORT}/"


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static file handler: explicit MIME types, no-cache headers, quiet logging."""

    # Make sure the browser gets the right Content-Type for the app's assets even
    # on Python builds with a sparse mimetypes registry.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
    }

    def end_headers(self):
        # No-cache so edits/regenerated bundles always show on refresh.
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):  # noqa: A003 - keep the console clean
        return


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def main() -> int:
    if not os.path.isdir(APP_DIR):
        print(f"  Could not find the app folder:\n    {APP_DIR}")
        print("  Run this script from the project root (the folder that contains 'awareness').")
        return 1

    # Already running? Just open the browser instead of failing on a bound port.
    if _port_in_use(HOST, PORT):
        print(f"  The app already appears to be running at {URL}")
        print("  Opening it in your browser...")
        webbrowser.open(URL)
        return 0

    handler = partial(Handler, directory=APP_DIR)
    try:
        httpd = http.server.ThreadingHTTPServer((HOST, PORT), handler)
    except OSError as exc:
        print(f"  Could not start the server on {HOST}:{PORT} - {exc}")
        return 1

    print()
    print("  Starting the Security Awareness app...")
    print(f"  It will open in your browser at {URL}")
    print("  Keep this window open while using the app. Press Ctrl+C to stop.")
    print()

    # Open the browser once the server is listening.
    threading.Timer(1.0, lambda: webbrowser.open(URL)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopping the app. Goodbye!")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
