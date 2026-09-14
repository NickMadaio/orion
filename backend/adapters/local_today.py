"""Loopback-only transport proof. No sign-in endpoint, writes or public bind.

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
from typing import Callable

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


def local_server(repository: TodaySnapshotRepository, sessions: LocalReadSessions,
                 *, clock: Callable[[], float] = time.time) -> HTTPServer:
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
            session = sessions.resolve(headers[0]) if len(headers) == 1 else None
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
            self._reply(405, {"error": "read_only"})

        do_PUT = do_POST
        do_PATCH = do_POST
        do_DELETE = do_POST

    # No caller-supplied host; this can never listen on a LAN/public interface.
    return HTTPServer(("127.0.0.1", 0), Handler)
