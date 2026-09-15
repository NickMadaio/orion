from pathlib import Path
import tempfile
import unittest

from backend.ownership import Session, resolve_owner, owner_first_violations
from backend.local_today.repository import TodaySnapshotRepository, SnapshotConflict
from backend.local_today.publication import PublishingTodayRepository


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "private"
        self.owner = resolve_owner(Session("session1", "owner001", "device01"))
        self.other = resolve_owner(Session("session2", "owner002", "device02"))
        self.snapshot = {"revision": 1, "capturedAt": 100, "plan": None}
        self.calls = 0
        self.failure = False
        def export(source):
            self.assertEqual(source, Path("fixed-local-source"))
            self.calls += 1
            if self.failure:
                raise ValueError("invalid source")
            return self.snapshot
        self.repo = PublishingTodayRepository(self.path, owner=self.owner,
            source=Path("fixed-local-source"), exporter=export)

    def test_read_publishes_only_configured_owner(self):
        self.assertEqual(owner_first_violations(PublishingTodayRepository), [])
        with self.assertRaises(KeyError):
            self.repo.get(self.other, "today-plan")
        self.assertEqual(self.calls, 0)
        self.assertEqual(self.repo.get(self.owner, "today-plan").value["revision"], 1)
        self.assertEqual(self.calls, 1)

    def test_advance_preserves_age_and_repeated_read_is_idempotent(self):
        self.repo.get(self.owner, "today-plan")
        self.repo.get(self.owner, "today-plan")
        self.snapshot = {"revision": 2, "capturedAt": 150, "plan": None}
        value = self.repo.get(self.owner, "today-plan").value
        self.assertEqual(value["revision"], 2)
        self.assertEqual(value["capturedAt"], 150)

    def test_failure_and_rollback_preserve_snapshot_then_recover(self):
        self.repo.get(self.owner, "today-plan")
        self.failure = True
        with self.assertRaises(ValueError):
            self.repo.get(self.owner, "today-plan")
        durable = TodaySnapshotRepository(self.path)
        self.assertEqual(durable.get(self.owner, "today-plan").value["revision"], 1)
        self.failure = False
        self.snapshot = {"revision": 0, "capturedAt": 50, "plan": None}
        with self.assertRaises(SnapshotConflict):
            self.repo.get(self.owner, "today-plan")
        self.snapshot = {"revision": 2, "capturedAt": 200, "plan": None}
        self.assertEqual(self.repo.get(self.owner, "today-plan").value["revision"], 2)
