"""Static server for the scene preview.

Vite serves `public/` at the site root and `src/` from the project root, so the
same URL space has to be reconstructed by hand: /src/... comes from the repo,
everything else falls back to public/. Without this, scene.js's playmat paths
(/snaptest/playmats/..., /home-playmats/...) 404 and every scene silently
renders on bare cloth — the opposite of what is being checked.

A POST to /__save/<name> writes the body under SAVE_DIR, so a page can hand
rendered canvases to offline analysis. Scene generation lives in the browser
(canvas, the production crop geometry, the real card images) while the analysis
that consumes it is Python, and this is the seam between them.
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE_DIR = os.environ.get("PREVIEW_SAVE_DIR", "/tmp/preview-out")
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")

class H(SimpleHTTPRequestHandler):
    def do_POST(self):
        if not self.path.startswith("/__save/"):
            self.send_error(404)
            return
        name = self.path[len("/__save/"):].split("?", 1)[0]
        # Names are validated rather than joined blindly: this writes to disk on
        # behalf of a web page, so a "../.." in the path would be an arbitrary
        # file write. Loopback binding is not on its own a reason to skip this.
        if not SAFE_NAME.match(name):
            self.send_error(400, "bad name")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 32 * 1024 * 1024:
            self.send_error(400, "bad length")
            return
        os.makedirs(SAVE_DIR, exist_ok=True)
        with open(os.path.join(SAVE_DIR, name), "wb") as out:
            out.write(self.rfile.read(length))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b"ok")

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
