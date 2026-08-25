"""Minimale fake Ollama-server voor tests — puur stdlib, geen extra dependency.

Beantwoordt /api/tags (voor /api/health) en /api/chat (streaming ndjson, in
hetzelfde formaat als de echte Ollama-API). `delay` is instelbaar tijdens de
test, voor de generation-locking-test die een langlopende generatie nodig heeft.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _Handler(BaseHTTPRequestHandler):
    server: "FakeOllama"

    def log_message(self, *a):
        pass  # stdout stil houden tijdens tests

    def do_GET(self):
        if self.path == "/api/tags":
            body = json.dumps({"models": []}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)  # request-body negeren, alleen het antwoord telt

        cfg = self.server  # type: FakeOllama
        if cfg.status_code != 200:
            self.send_response(cfg.status_code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": cfg.error_body}).encode())
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            if cfg.delay:
                time.sleep(cfg.delay)
            self.wfile.write(
                (json.dumps({"message": {"content": cfg.reply_text}, "done": False}) + "\n").encode()
            )
            self.wfile.flush()
            self.wfile.write(
                (
                    json.dumps(
                        {
                            "message": {"content": ""},
                            "done": True,
                            "eval_count": 1,
                            "eval_duration": 1_000_000,
                        }
                    )
                    + "\n"
                ).encode()
            )
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # client kapte de verbinding af (stop-knop) — geen testfout


class FakeOllama(ThreadingHTTPServer):
    """Context-manager-achtige fake Ollama-server. Attributen (delay,
    status_code, error_body, reply_text) zijn tijdens de test aan te passen."""

    def __init__(self, host: str = "127.0.0.1", port: int = 0):
        super().__init__((host, port), _Handler)
        self.delay = 0.0
        self.status_code = 200
        self.error_body = "fake ollama error"
        self.reply_text = "hoi"
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://{self.server_address[0]}:{self.server_address[1]}"

    def start(self) -> None:
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.shutdown()
        self.server_close()
        if self._thread:
            self._thread.join(timeout=5)
