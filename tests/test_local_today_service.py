"""Actual socket and database restart checks for local read-only plan delivery."""
from contextlib import closing
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.ownership import Session, resolve_owner, owner_first_violations
from backend.local_today.repository import TodaySnapshotRepository, SnapshotConflict
from backend.adapters.local_today import LocalReadSessions, local_server


class LocalTodayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / "private"
        self.repo = TodaySnapshotRepository(self.directory)
        self.a = Session("session-a", "user-aaa", "device-a")
        self.b = Session("session-b", "user-bbb", "device-b")
        self.owner = resolve_owner(self.a)
        self.now = 1000.0
        self.sessions = LocalReadSessions(lambda: self.now)
        self.token = self.sessions.issue(self.a)
        self.other = self.sessions.issue(self.b)
        self.value = {"revision": 8, "capturedAt": 900.0, "plan": {"reason": "Example fixture only", "blocks": []}}
        self.repo.put(self.owner, "today-plan", self.value)
        self.server = local_server(self.repo, self.sessions, clock=lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, token=None, path="/plan", method="GET"):
        request = Request(f"http://127.0.0.1:{self.server.server_port}{path}", method=method)
        if token is not None:
            request.add_header("Authorization", "Bearer " + token)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response), response.headers

    def test_real_read_is_session_scoped_and_audited(self):
        status, body, headers = self.request(self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body, {"schemaVersion": 1, "ownerID": "user-aaa", "snapshot": self.value})
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.repo.read_history(self.owner), ((1000.0, "found"),))
        self.assertEqual(self.repo.read_history(resolve_owner(self.b)), ())

    def test_cross_owner_absence_matches_missing(self):
        first = self.request(self.other)[:2]
        self.repo.delete(self.owner, "today-plan")
        self.assertEqual(first, self.request(self.token)[:2])
        self.assertEqual(first, (404, {"error": "not_found"}))

    def test_auth_missing_wrong_expired_revoked(self):
        for token in (None, "wrong"):
            self.assertEqual(self.request(token)[0], 401)
        self.now = 1300
        self.assertEqual(self.request(self.token)[0], 401)
        token = self.sessions.issue(self.a)
        self.assertEqual(self.request(token)[0], 200)
        self.sessions.revoke(token)
        self.assertEqual(self.request(token)[0], 401)

    def test_no_ownership_query_or_http_writes(self):
        self.assertEqual(self.request(self.other, "/plan?owner_id=user-aaa")[0], 404)
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.request(self.token, method=method)[0], 405)
        self.assertEqual(self.request(self.token)[1]["snapshot"], self.value)

    def test_restart_retains_snapshot_and_audit_but_not_sessions(self):
        self.assertEqual(self.request(self.token)[0], 200)
        self.stop()
        self.repo = TodaySnapshotRepository(self.directory)
        self.sessions = LocalReadSessions(lambda: self.now)
        self.server = local_server(self.repo, self.sessions, clock=lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.assertEqual(self.request(self.token)[0], 401)
        replacement = self.sessions.issue(self.a)
        self.assertEqual(self.request(replacement)[1]["snapshot"], self.value)
        self.assertEqual(len(self.repo.read_history(self.owner)), 2)

    def test_atomic_revisions_and_idempotent_publication(self):
        self.repo.put(self.owner, "today-plan", self.value)
        for value in ({**self.value, "revision": 7}, {**self.value, "plan": None}):
            with self.assertRaises(SnapshotConflict):
                self.repo.put(self.owner, "today-plan", value)
        self.assertEqual(self.request(self.token)[1]["snapshot"], self.value)
        newer = {**self.value, "revision": 9, "plan": None}
        self.repo.put(self.owner, "today-plan", newer)
        self.assertEqual(self.request(self.token)[1]["snapshot"], newer)

    def test_every_repository_route_scopes_owner(self):
        self.assertEqual(owner_first_violations(TodaySnapshotRepository), [])
        self.assertEqual(self.repo.count(resolve_owner(self.b)), 0)
        self.assertEqual(self.repo.list(resolve_owner(self.b)), ())
        with self.assertRaises(KeyError):
            self.repo.delete(resolve_owner(self.b), "today-plan")
        with self.assertRaises(PermissionError):
            self.repo.get("user-aaa", "today-plan")
        self.assertEqual(self.repo.count(self.owner), 1)

    def test_payload_bounds_and_ownership_claims(self):
        for value in ({**self.value, "owner_id": "user-bbb"}, {**self.value, "revision": True},
                      {**self.value, "capturedAt": float("nan")}, {**self.value, "plan": []},
                      {**self.value, "plan": {"large": "x" * 1_000_000}}):
            with self.assertRaises(ValueError):
                self.repo.put(self.owner, "today-plan", value)
        self.assertEqual(self.request(self.token)[1]["snapshot"], self.value)

    def test_private_storage_and_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.directory / "today.sqlite3").stat().st_mode & 0o777, 0o600)
        public = Path(self.temp.name) / "public"
        public.mkdir(mode=0o755)
        with self.assertRaises(PermissionError):
            TodaySnapshotRepository(public)
        link = Path(self.temp.name) / "link"
        link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(PermissionError):
            TodaySnapshotRepository(link)

    def test_corruption_returns_unavailable_not_empty_plan(self):
        import sqlite3
        with closing(sqlite3.connect(self.directory / "today.sqlite3")) as db:
            with db:
                db.execute("UPDATE snapshots SET body='{}'")
        self.assertEqual(self.request(self.token)[:2], (503, {"error": "unavailable"}))


if __name__ == "__main__":
    unittest.main()
