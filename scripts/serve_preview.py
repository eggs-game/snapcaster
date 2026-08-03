"""Static server for the scene preview.

Vite serves `public/` at the site root and `src/` from the project root, so the
same URL space has to be reconstructed by hand: /src/... comes from the repo,
everything else falls back to public/. Without this, scene.js's playmat paths
(/snaptest/playmats/..., /home-playmats/...) 404 and every scene silently
renders on bare cloth — the opposite of what is being checked.
"""
import functools, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class H(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        # /src/**, /scripts/** and /node_modules/** are repo paths; everything
        # else is public/. node_modules is here only so the local runner can
        # resolve the bare "tesseract.js" specifier through an import map, the
        # way Vite resolves it in a real build.
        repo = p.startswith(("src/", "scripts/", "node_modules/"))
        base = ROOT if repo else os.path.join(ROOT, "public")
        return os.path.join(base, p)

    def end_headers(self):
        # Canvas reads scene pixels back via toDataURL, so Scryfall images must
        # not taint it. They send permissive CORS already; this side just needs
        # to not cache stale module code between edits.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
