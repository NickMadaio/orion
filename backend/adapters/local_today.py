"""Loopback-only plan reads and optional device-session exchange. No account
sign-in, plan writes or public bind.

LocalReadSessions are ephemeral harness credentials, not production account
sessions or phone pairing. Restart invalidates them; durable snapshots survive.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import secrets
import time
from typing import Callable, Protocol

from backend.ownership import Session, resolve_owner
from orion.shared.json_values import thaw_json
from backend.local_today.repository import TodaySnapshotRepository


@dataclass(frozen=True)
class _Grant:
    session: Session
    expires_at: float


class LocalReadSessions:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._grants: dict[bytes, _Grant] = {}

    def issue(self, session: Session, lifetime: float = 300) -> str:
        if not isinstance(session, Session) or not math.isfinite(lifetime) or not 0 < lifetime <= 3600:
            raise ValueError("invalid local session")
        token = secrets.token_urlsafe(32)
        self._grants[hashlib.sha256(token.encode()).digest()] = _Grant(session, self._clock() + lifetime)
        return token

    def revoke(self, token: str) -> None:
        self._grants.pop(hashlib.sha256(token.encode()).digest(), None)

    def resolve(self, header: str | None) -> Session | None:
        if not header or not header.startswith("Bearer ") or len(header) > 128:
            return None
        token = header[7:]
        grant = self._grants.get(hashlib.sha256(token.encode()).digest())
        if grant is None or self._clock() >= grant.expires_at:
            return None
        return grant.session


class ReadSessionResolver(Protocol):
    def resolve(self, header: str | None) -> Session | None: ...


def local_server(repository: TodaySnapshotRepository, sessions: ReadSessionResolver,
                 *, clock: Callable[[], float] = time.time, exchange=None) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(2)

        def log_message(self, *args):
            pass  # Do not print headers, bearer values, URLs or record bodies.

        def _reply(self, status: int, value: dict):
            body = json.dumps(value, allow_nan=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            # No query/body ownership input; /plan is the declared read route.
            if self.path != "/plan":
                return self._reply(404, {"error": "not_found"})
            headers = self.headers.get_all("Authorization", [])
            try:
                session = sessions.resolve(headers[0]) if len(headers) == 1 else None
            except Exception:
                return self._reply(503, {"error": "unavailable"})
            if session is None:
                return self._reply(401, {"error": "unauthorized"})
            owner = resolve_owner(session)
            try:
                record = repository.get(owner, "today-plan")
            except KeyError:
                try:
                    repository.record_read(owner, clock(), "missing")
                except Exception:
                    return self._reply(503, {"error": "unavailable"})
                return self._reply(404, {"error": "not_found"})
            except Exception:
                return self._reply(503, {"error": "unavailable"})
            try:
                repository.record_read(owner, clock(), "found")
                # Record.value is frozen. Read its plain JSON representation for wire encoding.
                value = thaw_json(record.value)
                result = {"schemaVersion": 1, "ownerID": str(owner.user_id), "snapshot": value}
            except Exception:
                return self._reply(503, {"error": "unavailable"})
            self._reply(200, result)

        def do_POST(self):
            if exchange is None or self.path not in {"/session/challenge", "/session/exchange"}:
                return self._reply(405, {"error": "read_only"})
            from backend.local_today.session_exchange import ExchangeRejected
            lengths = self.headers.get_all("Content-Length", [])
            auth = self.headers.get_all("Authorization", [])
            types = self.headers.get_all("Content-Type", [])
            if len(auth) != 1:
                return self._reply(401, {"error": "unauthorized"})
            if (self.headers.get_all("Transfer-Encoding", []) or len(lengths) != 1
                    or len(lengths[0]) > 4 or not lengths[0].isascii() or not lengths[0].isdecimal()
                    or not 1 <= int(lengths[0]) <= 4096 or types != ["application/json"]):
                return self._reply(400, {"error": "invalid_request"})
            def unique(pairs):
                result = {}
                for key, value in pairs:
                    if key in result: raise ValueError("duplicate field")
                    result[key] = value
                return result
            try:
                raw = self.rfile.read(int(lengths[0]))
                if len(raw) != int(lengths[0]): raise ValueError("incomplete body")
                body = json.loads(raw, object_pairs_hook=unique)
                if not isinstance(body, dict): raise ValueError("object required")
            except (ValueError, OSError):
                return self._reply(400, {"error": "invalid_request"})
            try:
                result = exchange.handle(self.path, auth[0], body)
            except ExchangeRejected:
                return self._reply(401, {"error": "unauthorized"})
            except Exception:
                return self._reply(503, {"error": "unavailable"})
            self._reply(200, result)

        def do_PUT(self):
            self._reply(405, {"error": "read_only"})
        do_PATCH = do_PUT
        do_DELETE = do_PUT

    # No caller-supplied host; this can never listen on a LAN/public interface.
    return HTTPServer(("127.0.0.1", 0), Handler)
