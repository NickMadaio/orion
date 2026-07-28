import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        files = {
            "/": ("index.html", "text/html"),
            "/styles.css": ("styles.css", "text/css"),
            "/app.js": ("app.js", "application/javascript"),
        }
        if self.path not in files:
            self.send_error(404)
            return
        name, content_type = files[self.path]
        content = (ROOT / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            messages = json.loads(self.rfile.read(length))["messages"]
            key = os.getenv("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("Missing API key in .env")
            response = Anthropic(api_key=key).messages.create(
                model="claude-sonnet-4-5",
                max_tokens=2048,
                system="You are ORION, Nick's clear, practical personal reasoning network.",
                messages=messages,
            )
            text = "".join(x.text for x in response.content if x.type == "text")
            self.send_json({"text": text})
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)

    def send_json(self, payload, status=200):
        content = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    load_dotenv(Path.home() / "ORION" / ".env")
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("ORION is ready at http://127.0.0.1:8787")
    print("Press Control+C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open("http://127.0.0.1:8787")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
