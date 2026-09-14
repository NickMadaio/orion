"""Durable snapshots behind the existing server-resolved Owner boundary.

Snapshot publication is a local caller operation; the HTTP surface cannot write.
The plan is an opaque shared-Swift document, not a second Python scheduler.
"""
from __future__ import annotations

from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import sqlite3
import stat
from typing import Mapping

from backend.ownership import Owner, OwnershipViolation, Record, Repository

MAX_SNAPSHOT_BYTES = 1_000_000


def _owner(owner: Owner) -> str:
    if not isinstance(owner, Owner):
        raise OwnershipViolation("a server-resolved owner is required")
    return str(owner.user_id)


def _encode(value: Mapping[str, object]) -> str:
    if not isinstance(value, Mapping) or set(value) != {"revision", "capturedAt", "plan"}:
        raise ValueError("snapshot requires revision, capturedAt and plan only")
    revision, captured, plan = value["revision"], value["capturedAt"], value["plan"]
    if type(revision) is not int or not 0 <= revision <= 2**53 - 1:
        raise ValueError("invalid revision")
    if type(captured) not in (float, int) or not math.isfinite(captured) or captured < 0:
        raise ValueError("invalid capture time")
    if plan is not None and not isinstance(plan, dict):
        raise ValueError("plan must be an object or null")
    body = json.dumps(dict(value), allow_nan=False, sort_keys=True, separators=(",", ":"))
    if len(body.encode()) > MAX_SNAPSHOT_BYTES:
        raise ValueError("snapshot too large")
    return body


class SnapshotConflict(ValueError):
    """An older or different publication cannot replace the accepted revision."""


class TodaySnapshotRepository(Repository):
    """Single plan snapshot per owner, stored atomically in a private directory."""

    def __init__(self, directory: Path):
        super().__init__("today_snapshot")
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise PermissionError("snapshot directory must be private and owned by this user")
        self._path = directory / "today.sqlite3"
        fd = os.open(self._path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise PermissionError("snapshot database must be private and owned by this user")
        finally:
            os.close(fd)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS snapshots (owner TEXT PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS reads (owner TEXT NOT NULL, observed REAL NOT NULL, outcome TEXT NOT NULL)")

    @contextmanager
    def _connect(self):
        # One connection per operation; synchronous transactions survive restart.
        db = sqlite3.connect(self._path, timeout=5)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def put(self, owner: Owner, record_id: str, value: Mapping[str, object]) -> Record:
        user = _owner(owner)
        if record_id != "today-plan":
            raise ValueError("only the today snapshot can be published")
        body = _encode(value)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT body FROM snapshots WHERE owner=?", (user,)).fetchone()
            if row:
                old = json.loads(row[0])
                if value["revision"] < old["revision"]:
                    raise SnapshotConflict("older revision")
                if value["revision"] == old["revision"] and body != row[0]:
                    raise SnapshotConflict("revision reused for different content")
            db.execute("INSERT INTO snapshots(owner,body) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body", (user, body))
        return Record(record_id="today-plan", owner_id=owner.user_id, kind=self.kind, value=json.loads(body))

    def get(self, owner: Owner, record_id: str) -> Record:
        user = _owner(owner)
        if record_id != "today-plan":
            raise KeyError("snapshot not found")
        with self._connect() as db:
            row = db.execute("SELECT body FROM snapshots WHERE owner=?", (user,)).fetchone()
        if row is None:
            raise KeyError("snapshot not found")
        value = json.loads(row[0])
        _encode(value)  # corrupted persisted data must not become a valid response
        return Record(record_id="today-plan", owner_id=owner.user_id, kind=self.kind, value=value)

    def list(self, owner: Owner) -> tuple[Record, ...]:
        _owner(owner)
        try:
            return (self.get(owner, "today-plan"),)
        except KeyError:
            return ()

    def count(self, owner: Owner) -> int:
        return len(self.list(owner))

    def delete(self, owner: Owner, record_id: str) -> None:
        user = _owner(owner)
        if record_id != "today-plan":
            raise KeyError("snapshot not found")
        with self._connect() as db:
            result = db.execute("DELETE FROM snapshots WHERE owner=?", (user,))
            if result.rowcount == 0:
                raise KeyError("snapshot not found")

    def record_read(self, owner: Owner, observed: float, outcome: str) -> None:
        user = _owner(owner)
        if outcome not in {"found", "missing", "unavailable"} or not math.isfinite(observed):
            raise ValueError("invalid read observation")
        with self._connect() as db:
            db.execute("INSERT INTO reads VALUES(?,?,?)", (user, observed, outcome))

    def read_history(self, owner: Owner) -> tuple[tuple[float, str], ...]:
        user = _owner(owner)
        with self._connect() as db:
            return tuple(db.execute("SELECT observed,outcome FROM reads WHERE owner=? ORDER BY rowid", (user,)))
