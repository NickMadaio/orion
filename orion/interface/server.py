#!/usr/bin/env python3
"""ORION interface bridge.

Serves the standalone Orion interface and is the only component that knows how
to reach the two local services behind it:

  * the OpenClaw gateway  (loopback 127.0.0.1:18789)  -> `openclaw agent --json`
  * the warm TTS daemon   (~/.openclaw/orion-tts.sock) -> scripts/orion-local-tts

Keeping that knowledge in one file is deliberate. The gateway's WebSocket RPC
surface is versioned and will drift; the documented CLI is the stable contract.
If a future OpenClaw release changes the shape, only `ask_agent` below needs to
follow it -- the interface itself never speaks to the gateway directly.

Standard library only, loopback only, no auth token ever reaches the browser.

    python3 orion/interface/server.py            # then open the printed URL
    python3 orion/interface/server.py --port 8770 --open
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
HOME = Path.home()

OPENCLAW_BIN = os.environ.get("ORION_OPENCLAW_BIN", str(HOME / ".openclaw/bin/openclaw"))
OPENCLAW_CONFIG = Path(os.environ.get("ORION_OPENCLAW_CONFIG", str(HOME / ".openclaw/openclaw.json")))
TTS_SCRIPT = Path(os.environ.get("ORION_TTS_SCRIPT", str(REPO / "scripts/orion-local-tts")))
TTS_SOCKET = Path(os.environ.get("ORION_TTS_SOCKET", str(HOME / ".openclaw/orion-tts.sock")))

DEFAULT_SESSION = "orion-interface"
AGENT_TIMEOUT_S = int(os.environ.get("ORION_AGENT_TIMEOUT", "180"))
TTS_TIMEOUT_S = int(os.environ.get("ORION_TTS_TIMEOUT", "20"))

# Static assets we are willing to serve. An explicit allowlist rather than a
# path join, so no traversal is possible by construction.
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/hologram.js": ("hologram.js", "text/javascript; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}

MAX_BODY = 256 * 1024
MAX_TTS_CHARS = 4000


# --------------------------------------------------------------------------
# Gateway
# --------------------------------------------------------------------------

def gateway_port() -> int:
    try:
        cfg = json.loads(OPENCLAW_CONFIG.read_text())
        return int(cfg.get("gateway", {}).get("port", 18789))
    except Exception:
        return 18789


def gateway_up(timeout: float = 0.4) -> bool:
    """A TCP connect is enough: we only need to know the listener is there."""
    try:
        with socket.create_connection(("127.0.0.1", gateway_port()), timeout=timeout):
            return True
    except OSError:
        return False


def tts_up() -> bool:
    if not TTS_SOCKET.exists():
        return False
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.4)
        s.connect(str(TTS_SOCKET))
        s.close()
        return True
    except OSError:
        return False


_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _extract_reply(payload: dict) -> str:
    """Pull the assistant text out of an `openclaw agent --json` response.

    The documented shape is {"payloads": [{"text": ...}], "meta": {...}}, but
    older and newer builds have also used `text`, `reply`, and `message`. We
    accept any of them rather than hard-failing on a field rename.
    """
    parts = []
    for item in payload.get("payloads") or []:
        if isinstance(item, dict) and item.get("text"):
            parts.append(str(item["text"]))
    if parts:
        return "\n\n".join(parts).strip()

    for key in ("text", "reply", "message", "content", "output"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, dict) and isinstance(val.get("text"), str):
            return val["text"].strip()
    return ""


def ask_agent(text: str, session: str) -> dict:
    """Run one agent turn through the gateway CLI."""
    if not Path(OPENCLAW_BIN).exists():
        raise RuntimeError(f"openclaw CLI not found at {OPENCLAW_BIN}")

    cmd = [
        OPENCLAW_BIN, "agent",
        "--session-key", session,
        "--message", text,
        "--json",
        "--timeout", str(AGENT_TIMEOUT_S),
    ]
    started = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=AGENT_TIMEOUT_S + 15,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"agent timed out after {AGENT_TIMEOUT_S}s")

    elapsed_ms = int((time.monotonic() - started) * 1000)
    stdout = _ANSI.sub("", proc.stdout or "").strip()

    if proc.returncode != 0 and not stdout:
        err = _ANSI.sub("", proc.stderr or "").strip().splitlines()
        detail = err[-1] if err else f"exit {proc.returncode}"
        raise RuntimeError(f"agent failed: {detail}")

    # --json reserves stdout, but be forgiving about stray leading lines.
    payload = None
    for candidate in (stdout, *reversed(stdout.splitlines())):
        candidate = candidate.strip()
        if not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue

    if payload is None:
        if stdout:
            return {"reply": stdout, "ms": elapsed_ms, "raw": True}
        raise RuntimeError("agent returned no parseable output")

    reply = _extract_reply(payload)
    if not reply and payload.get("status") == "in_flight":
        raise RuntimeError("a turn is already running in this session")
    return {"reply": reply, "ms": elapsed_ms, "meta": payload.get("meta") or {}}


# --------------------------------------------------------------------------
# Speech
# --------------------------------------------------------------------------

def synthesize(text: str) -> bytes:
    """Render text to a wav via the thin client (which uses the warm daemon)."""
    if not TTS_SCRIPT.exists():
        raise RuntimeError(f"tts script not found at {TTS_SCRIPT}")

    tmpdir = tempfile.mkdtemp(prefix="orion-ui-tts-")
    out = Path(tmpdir) / "reply.wav"
    try:
        proc = subprocess.run(
            [str(TTS_SCRIPT), str(out), text],
            capture_output=True,
            text=True,
            timeout=TTS_TIMEOUT_S,
        )
        if not out.exists() or out.stat().st_size == 0:
            err = (proc.stderr or "").strip().splitlines()
            raise RuntimeError(err[-1] if err else "tts produced no audio")
        return out.read_bytes()
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"tts timed out after {TTS_TIMEOUT_S}s")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "OrionInterface/1.0"
    protocol_version = "HTTP/1.1"

    # -- helpers -----------------------------------------------------------

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # This UI is local-only and must never be embedded or called cross-site.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'",
        )
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _guard_origin(self) -> bool:
        """Reject cross-origin writes. A page you visit must not be able to
        drive your assistant just because it is listening on loopback."""
        origin = self.headers.get("Origin")
        if origin is None:
            return True  # same-origin fetch or curl
        host = self.headers.get("Host", "")
        return origin in (f"http://{host}", f"https://{host}")

    def log_message(self, fmt, *args):
        if os.environ.get("ORION_UI_VERBOSE"):
            sys.stderr.write("[orion-ui] " + (fmt % args) + "\n")

    # -- routes ------------------------------------------------------------

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path in ASSETS:
            name, ctype = ASSETS[path]
            try:
                self._send(200, (HERE / name).read_bytes(), ctype)
            except OSError:
                self._json(404, {"error": f"missing asset {name}"})
            return

        if path == "/api/health":
            warm = tts_up()
            self._json(200, {
                "ok": True,
                "gateway": gateway_up(),
                "gateway_port": gateway_port(),
                "tts": warm or TTS_SCRIPT.exists(),
                "tts_warm": warm,
            })
            return

        self._json(404, {"error": "not found"})

    do_HEAD = do_GET

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if not self._guard_origin():
            self._json(403, {"error": "cross-origin request refused"})
            return

        try:
            body = self._read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"bad request body: {exc}"})
            return

        if path == "/api/ask":
            text = str(body.get("text") or "").strip()
            if not text:
                self._json(400, {"error": "text is required"})
                return
            session = str(body.get("session") or DEFAULT_SESSION)
            if not re.fullmatch(r"[A-Za-z0-9._:-]{1,120}", session):
                self._json(400, {"error": "invalid session key"})
                return
            try:
                self._json(200, ask_agent(text, session))
            except Exception as exc:
                self._json(502, {"error": str(exc)})
            return

        if path == "/api/speak":
            text = str(body.get("text") or "").strip()
            if not text:
                self._json(400, {"error": "text is required"})
                return
            if len(text) > MAX_TTS_CHARS:
                text = text[:MAX_TTS_CHARS]
            try:
                self._send(200, synthesize(text), "audio/wav")
            except Exception as exc:
                self._json(502, {"error": str(exc)})
            return

        self._json(404, {"error": "not found"})


def main() -> int:
    ap = argparse.ArgumentParser(description="ORION interface bridge")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ORION_UI_PORT", "8770")))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="open the interface in a browser")
    args = ap.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("refusing to bind a non-loopback address", file=sys.stderr)
        return 2

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print(f"cannot bind {args.host}:{args.port} — {exc}", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}/"
    print(f"ORION interface  {url}")
    print(f"  gateway  {'up' if gateway_up() else 'DOWN'} (port {gateway_port()})")
    print(f"  tts      {'warm' if tts_up() else 'cold — first reply will be slower'}")
    print("  ctrl-c to stop")

    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
