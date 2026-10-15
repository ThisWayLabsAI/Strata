"""Serve the real web UI with fake HTTP responses; no models, keys or GPU.

Run from the repo: python tools/mobile_chat_fixture.py
Open http://127.0.0.1:8091; About > Settings > Chat layout overrides detection.
Chat replies stream canned Markdown. Send 'error' to test an error reply.
Never use this fixture as a real API server or expose it beyond localhost.
"""
from __future__ import annotations

import json
import itertools
import time
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
IMAGE_SEEDS = itertools.count(1000)


class Fixture(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "serve"), **kwargs)

    def log_message(self, *_args):
        pass

    def json_reply(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            self.json_reply({"status": "ok", "model": "mobile-fixture-no-gpu", "images": True,
                             "image_generation": True, "loaded": False})
        elif path == "/metrics":
            self.json_reply({"live": {"state": "idle"}})
        elif path == "/mcp":
            self.json_reply({"servers": [], "tools": 0})
        elif path == "/settings":
            self.json_reply({})
        elif path == "/v1/images/capabilities":
            from serve.image_references import capabilities
            self.json_reply(capabilities({"llm_vision": __file__}))
        elif path == "/config":
            self.json_reply({}, 404)  # no machine settings in a UI fixture
        elif path == "/":
            self.path = "/web/index.html"
            super().do_GET()
        elif path.startswith("/web/") and ".." not in path:
            super().do_GET()
        else:
            self.send_error(404)

    def do_POST(self):
        if urlsplit(self.path).path in ("/v1/images/generations", "/v1/images/edits"):
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            from serve.image_references import parse, provenance
            editing = urlsplit(self.path).path.endswith("/edits")
            try:
                references = parse(request, {"llm_vision": __file__}, edit=editing)
            except ValueError as error:
                self.json_reply({"error": {"message": str(error)}}, 400)
                return
            if request.get("prompt") == "error":
                self.json_reply({"error": {"message": "Fixture image failure"}}, 500)
                return
            time.sleep(0.02)
            self.json_reply({"size": request.get("size", "1024x1024"), "model": "fixture-image-model", "created": int(time.time()),
                             **({"operation": "edit" if editing else "generate", "references": provenance(references)} if references else {}),
                             "strata": {"steps": request.get("steps", 8), "backend": "fixture", "quant": "fixture"}, "data": [{
                "seed": request["seed"] if "seed" in request else next(IMAGE_SEEDS),
                "b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="}]})
            return
        if urlsplit(self.path).path != "/v1/chat/completions":
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        content = request.get("messages", [{}])[-1].get("content", "")
        if content == "error":
            self.json_reply({"error": {"message": "Fixture error: try again."}}, 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            for index in range(60):
                chunk = {"choices": [{"delta": {"content": f"Paragraph {index}: " + "mobile streaming fixture " * 10 + "\n\n"}}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
                time.sleep(0.04)
            self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Stop/disconnect is a normal test path


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8091), Fixture)
    print("Mobile UI fixture: http://127.0.0.1:8091 (no GPU)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
