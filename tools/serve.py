#!/usr/bin/env python3
"""Serve Bill Companion locally.

The site is plain static files, so any static server works — this one just sets
the right MIME types for .mjs/.json and disables caching, which matters while
you're iterating on the ingested data.

    python tools/serve.py            # http://localhost:8000
    python tools/serve.py --port 9000
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# A Windows console defaults to cp1252, which cannot encode the arrow below —
# printing the startup banner would kill the server before it ever listened.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
    }

    # corpus/files/ used to be refused here, so the local server would show
    # exactly what a deploy showed and nothing could come to depend on a file
    # that would not be there. The reasoning was sound and its premise has
    # changed: the block was justified in CLAUDE.md by "nothing in the app links
    # to them", and samples/library.json now does. A deploy serves whatever is in
    # the repo, so refusing them locally no longer makes the two agree — it makes
    # them disagree, in the direction that hides a broken link from the only
    # person who runs this locally.
    BLOCKED = ()

    def send_head(self):
        if any(self.path.startswith(p) for p in self.BLOCKED):
            self.send_error(404, "Not part of the site (see tools/corpus.mjs)")
            return None
        return super().send_head()

    def end_headers(self) -> None:
        # Data shards change whenever you re-run the ingester; caching them
        # during development just hides the update.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # 404s on data/usc/** are expected and routine (an un-ingested title),
        # so keep the console to real problems.
        if len(args) > 1 and str(args[1]).startswith("4") and "/data/usc/" in str(args[0]):
            return
        super().log_message(fmt, *args)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://localhost:{args.port}/"
        print(f"Bill Companion → {url}   (Ctrl+C to stop)")
        if not args.no_open:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
