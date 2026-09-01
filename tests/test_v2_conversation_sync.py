"""Phase 17: conversation and state sync.

The rule the manifest states as a prohibition -- do not rely only on local
timestamps -- is the design here, so most of these tests are about what ordering
does NOT look at.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.sync.engine import SyncEngine
from backend.sync.offline import CACHE_POLICY, OfflineQueue, may_cache, requires_encryption
from backend.sync.ordering import Position, next_sequence, ordered
from backend.sync.records import SyncMessage


REPO_ROOT = Path(__file__).resolve().parents[1]
VECTORS = REPO_ROOT / "planning" / "v2" / "sync-ordering-vectors.json"
NOW = datetime(2026, 8, 25, 16, 0, tzinfo=timezone.utc)
USER = "user-nick-0001"


def message(message_id="m1", sequence=1, *, device="phone", body="hello", revision=1,
            conversation="conversation-1", user=USER, created_at=NOW):
    return SyncMessage(
        message_id=message_id, conversation_id=conversation, user_id=user, device_id=device,
        sequence=sequence, role="user", body=body, created_at=created_at, revision=revision,
    )


class OrderingTests(unittest.TestCase):
    def test_the_hand_written_vectors_hold(self):
        document = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(document["cases"]), 6)
        for case in document["cases"]:
            positions = [
                Position(sequence=item["sequence"], device_id=item["device_id"],
                         message_id=item["message_id"])
                for item in case["input"]
            ]
            self.assertEqual(
                [item.message_id for item in ordered(positions)],
                case["expected_order"],
                case["name"],
            )

    def test_the_expectations_were_not_generated_from_the_implementation(self):
        # Generated expectations agree with whatever the code does, including
        # when what it does is wrong. This records that they were not.
        document = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertIn("hand", document["expectationsWrittenBy"])

    def test_ordering_does_not_depend_on_arrival_order(self):
        positions = [
            Position(3, "mac", "c"), Position(1, "phone", "a"), Position(3, "iphone", "b"),
        ]
        self.assertEqual(
            [item.message_id for item in ordered(positions)],
            [item.message_id for item in ordered(list(reversed(positions)))],
        )

    def test_a_sequence_is_one_past_everything_seen_not_one_past_local(self):
        # A device back from offline must not reuse sequences the world moved
        # past, or its messages sort into the middle of a later conversation.
        self.assertEqual(next_sequence([]), 1)
        self.assertEqual(next_sequence([4, 9, 2]), 10)

    def test_a_position_must_name_its_device_and_message(self):
        for bad in ({"device_id": ""}, {"message_id": ""}, {"sequence": 0}):
            fields = {"sequence": 1, "device_id": "phone", "message_id": "m1"}
            fields.update(bad)
            with self.assertRaises(ValueError, msg=str(bad)):
                Position(**fields)


class RecordTests(unittest.TestCase):
    def test_a_message_round_trips(self):
        original = message()
        self.assertEqual(SyncMessage.from_dict(original.to_dict()), original)

    def test_decoding_is_strict(self):
        rendered = message().to_dict()
        with self.assertRaises(ValueError):
            SyncMessage.from_dict({**rendered, "smuggled": 1})
        with self.assertRaises(ValueError):
            SyncMessage.from_dict({k: v for k, v in rendered.items() if k != "device_id"})

    def test_a_timestamp_must_carry_a_timezone(self):
        with self.assertRaises(ValueError):
            message(created_at=datetime(2026, 8, 25, 16, 0))

    def test_created_at_is_metadata_and_not_a_position(self):
        self.assertNotIn("created_at", Position.__dataclass_fields__)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = SyncEngine()

    def test_messages_sort_by_sequence_not_by_clock(self):
        self.engine.ingest(USER, [
            message("m1", 2, created_at=NOW),
            message("m2", 1, created_at=NOW - timedelta(hours=5)),
        ])
        self.assertEqual(
            [item.message_id for item in self.engine.conversation(USER, "conversation-1")],
            ["m2", "m1"],
        )

    def test_ingesting_the_same_message_twice_changes_nothing(self):
        self.engine.ingest(USER, [message()])
        result = self.engine.ingest(USER, [message()])
        self.assertEqual(result.accepted, ())
        self.assertEqual(result.duplicates, ("m1",))
        self.assertFalse(result.changed)
        self.assertEqual(len(self.engine.conversation(USER, "conversation-1")), 1)

    def test_a_higher_revision_wins_and_the_conflict_is_recorded(self):
        self.engine.ingest(USER, [message(body="first")])
        result = self.engine.ingest(USER, [message(body="edited", revision=2, device="mac")])
        self.assertEqual(result.conflicts[0].kept_revision, 2)
        self.assertEqual(result.conflicts[0].discarded_revision, 1)
        self.assertIn("higher revision", result.conflicts[0].reason)
        self.assertEqual(self.engine.conversation(USER, "conversation-1")[0].body, "edited")

    def test_an_older_revision_arriving_late_does_not_win(self):
        self.engine.ingest(USER, [message(body="new", revision=3)])
        self.engine.ingest(USER, [message(body="stale", revision=2, device="mac")])
        self.assertEqual(self.engine.conversation(USER, "conversation-1")[0].body, "new")

    def test_equal_revisions_from_two_devices_resolve_the_same_way_everywhere(self):
        # Deterministic, because every device runs this and must agree.
        first = SyncEngine()
        first.ingest(USER, [message(body="a", device="alpha"), message(body="b", device="beta")])
        second = SyncEngine()
        second.ingest(USER, [message(body="b", device="beta"), message(body="a", device="alpha")])
        self.assertEqual(
            first.conversation(USER, "conversation-1")[0].device_id,
            second.conversation(USER, "conversation-1")[0].device_id,
        )

    def test_a_conflict_is_recorded_rather_than_swallowed(self):
        self.engine.ingest(USER, [message(body="a", device="alpha")])
        self.engine.ingest(USER, [message(body="b", device="beta")])
        self.assertEqual(len(self.engine.conflicts), 1)
        self.assertTrue(self.engine.conflicts[0].reason)

    def test_a_device_cannot_write_into_another_users_history(self):
        with self.assertRaises(PermissionError):
            self.engine.ingest(USER, [message(user="user-other-0001")])

    def test_a_cursor_returns_exactly_what_was_missed(self):
        # The cursor comes from the engine rather than being hand-spelled: a
        # cursor is opaque now, and a test that writes its own is testing a
        # format instead of the behaviour.
        self.engine.ingest(USER, [message("m1", 1)])
        cursor = self.engine.cursor_for(USER, "conversation-1")
        self.engine.ingest(USER, [message("m2", 2), message("m3", 3)])
        delta = self.engine.since(USER, "conversation-1", cursor)
        self.assertEqual([item.message_id for item in delta.messages], ["m2", "m3"])
        self.assertEqual(delta.cursor, self.engine.cursor_for(USER, "conversation-1"))

    def test_a_current_cursor_returns_nothing(self):
        self.engine.ingest(USER, [message("m1", 1)])
        cursor = self.engine.cursor_for(USER, "conversation-1")
        self.assertTrue(self.engine.since(USER, "conversation-1", cursor).empty)

    def test_an_empty_conversation_has_a_usable_cursor(self):
        cursor = self.engine.cursor_for(USER, "conversation-1")
        self.assertTrue(self.engine.since(USER, "conversation-1", cursor).empty)

    def test_a_cursor_names_the_exact_message_it_stopped_at(self):
        # The first version carried only sequence and device, so a reconnecting
        # device was handed back the last message it already had -- every time.
        from backend.sync.engine import _decode_cursor

        self.engine.ingest(USER, [message("m1", 1)])
        fields = _decode_cursor(self.engine.cursor_for(USER, "conversation-1"))
        self.assertEqual(fields["m"], "m1")
        self.assertEqual(fields["s"], 1)
        self.assertGreater(fields["v"], 0)

    def test_a_device_id_containing_the_delimiter_does_not_corrupt_the_cursor(self):
        # The cursor was `<seq>|<device>|<message>` parsed with split("|", 2),
        # and nothing forbids "|" in a device id -- so a device called "mac|home"
        # got handed back the message it already had.
        self.engine.ingest(USER, [message("m1", 1, device="mac|home")])
        cursor = self.engine.cursor_for(USER, "conversation-1")
        self.assertTrue(self.engine.since(USER, "conversation-1", cursor).empty)

    def test_an_edit_made_while_a_device_was_away_comes_back(self):
        # `since` filtered on position, and a revision does not change position,
        # so every correction made while a device was offline was invisible to it
        # forever. The plan's exit criterion is "exactly what a cursor missed".
        self.engine.ingest(USER, [message("m1", 1), message("m2", 2)])
        cursor = self.engine.cursor_for(USER, "conversation-1")
        self.assertTrue(self.engine.since(USER, "conversation-1", cursor).empty)
        self.engine.ingest(USER, [message("m1", 1, body="corrected", revision=2)])
        delta = self.engine.since(USER, "conversation-1", cursor)
        self.assertEqual([item.message_id for item in delta.messages], ["m1"])
        self.assertEqual(delta.messages[0].body, "corrected")

    def test_a_malformed_cursor_is_refused(self):
        with self.assertRaises(ValueError):
            self.engine.since(USER, "conversation-1", "not-a-cursor")

    def test_the_next_sequence_accounts_for_every_device(self):
        self.engine.ingest(USER, [message("m1", 1, device="phone"), message("m2", 7, device="mac")])
        self.assertEqual(self.engine.next_sequence_for(USER, "conversation-1"), 8)

    def test_conversations_do_not_bleed_into_each_other(self):
        self.engine.ingest(USER, [message("m1", 1), message("m2", 1, conversation="conversation-2")])
        self.assertEqual(len(self.engine.conversation(USER, "conversation-1")), 1)


class OfflineQueueTests(unittest.TestCase):
    def setUp(self):
        self.queue = OfflineQueue()

    def test_changes_queue_in_order(self):
        self.queue.enqueue(message("m1", 1))
        self.queue.enqueue(message("m2", 2))
        self.assertEqual([item.message_id for item in self.queue.drain()], ["m1", "m2"])

    def test_editing_a_queued_message_replaces_it(self):
        self.queue.enqueue(message("m1", 1, body="typo"))
        self.assertFalse(self.queue.enqueue(message("m1", 1, body="fixed", revision=2)))
        self.assertEqual(self.queue.depth, 1)
        self.assertEqual(self.queue.drain()[0].body, "fixed")

    def test_nothing_leaves_the_queue_until_it_is_acknowledged(self):
        self.queue.enqueue(message("m1", 1))
        self.queue.drain()
        self.assertEqual(self.queue.depth, 1)
        self.assertEqual(self.queue.acknowledge(("m1",)), 1)
        self.assertEqual(self.queue.depth, 0)

    def test_double_delivery_is_harmless(self):
        # A queue that guarantees exactly-once delivery does not exist.
        engine = SyncEngine()
        self.queue.enqueue(message("m1", 1))
        batch = self.queue.drain()
        engine.ingest(USER, batch)
        second = engine.ingest(USER, batch)
        self.assertEqual(second.accepted, ())
        self.assertEqual(len(engine.conversation(USER, "conversation-1")), 1)

    def test_an_acknowledged_message_is_remembered(self):
        self.queue.enqueue(message("m1", 1))
        self.queue.acknowledge(("m1",))
        self.assertTrue(self.queue.was_delivered("m1"))


class OfflineEditTests(unittest.TestCase):
    def test_a_requeued_edit_survives_an_unrelated_acknowledgement(self):
        # acknowledge() filtered the whole pending list against a cumulative
        # _delivered set, so re-queueing an already-acknowledged id -- a user
        # editing a synced message while offline -- meant the next acknowledge of
        # ANYTHING deleted the edit. Silent loss of the user's own correction.
        queue = OfflineQueue()
        queue.enqueue(message("m1", 1))
        queue.acknowledge(("m1",))
        queue.enqueue(message("m1", 1, body="the correction typed offline", revision=2))
        queue.enqueue(message("m2", 2))
        queue.acknowledge(("m2",))
        self.assertEqual([item.message_id for item in queue.drain()], ["m1"])
        self.assertEqual(queue.drain()[0].body, "the correction typed offline")

    def test_acknowledging_nothing_removes_nothing(self):
        queue = OfflineQueue()
        queue.enqueue(message("m1", 1))
        queue.acknowledge(("m1",))
        queue.enqueue(message("m1", 1, body="edited", revision=2))
        self.assertEqual(queue.acknowledge(()), 0)
        self.assertEqual(queue.depth, 1)


class SilentDivergenceTests(unittest.TestCase):
    def test_two_versions_from_one_device_at_one_revision_do_not_diverge(self):
        # Nothing forces a client to bump `revision` on an edit, and the
        # same-revision-same-device branch took the later arrival and returned no
        # conflict. Two engines seeing the same pair in different orders ended up
        # with different content, permanently, with conflicts == ().
        first = message("m1", 1, body="the original")
        second = message("m1", 1, body="an edit the client forgot to bump")
        left, right = SyncEngine(), SyncEngine()
        left.ingest(USER, [first, second])
        right.ingest(USER, [second, first])
        self.assertEqual(
            left.conversation(USER, "conversation-1")[0].body,
            right.conversation(USER, "conversation-1")[0].body,
        )

    def test_and_it_is_recorded_rather_than_swallowed(self):
        engine = SyncEngine()
        engine.ingest(USER, [message("m1", 1, body="the original")])
        result = engine.ingest(USER, [message("m1", 1, body="a silent edit")])
        self.assertEqual(len(result.conflicts), 1)

    def test_an_edit_cannot_move_a_message_in_history(self):
        engine = SyncEngine()
        engine.ingest(USER, [message("m1", 1), message("m2", 2)])
        with self.assertRaises(ValueError):
            engine.ingest(USER, [message("m1", 99, body="edited", revision=2)])

    def test_a_batch_is_all_or_nothing(self):
        # ingest raised partway through with earlier messages already stored.
        engine = SyncEngine()
        with self.assertRaises(PermissionError):
            engine.ingest(USER, [message("ok1", 1), message("bad", 2, user="user-other-0001")])
        self.assertEqual(engine.conversation(USER, "conversation-1"), ())


class CachePolicyTests(unittest.TestCase):
    def test_every_rule_says_why(self):
        for field, rule in CACHE_POLICY.items():
            self.assertTrue(rule.reason, field)

    def test_message_bodies_are_cached_and_encrypted(self):
        self.assertTrue(may_cache("message_body"))
        self.assertTrue(requires_encryption("message_body"))

    def test_the_things_that_must_never_be_cached_are_not(self):
        for field in ("credentials", "pending_approvals", "health_state"):
            self.assertFalse(may_cache(field), field)

    def test_an_unclassified_field_is_not_cached(self):
        # Forgetting to think about a field must not grant it durability on a
        # device somebody might lose.
        self.assertFalse(may_cache("something_nobody_classified"))
        self.assertFalse(requires_encryption("something_nobody_classified"))


if __name__ == "__main__":
    unittest.main()
