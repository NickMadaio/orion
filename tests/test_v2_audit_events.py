"""Phase 6: the audit event, the two renderings, and the live-ledger adapter."""

from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from orion.core.audit.events import (
    ACTORS,
    FIELDS,
    ApprovalRecord,
    AuditEvent,
    DecisionRecord,
    ExecutionRecord,
)
from orion.core.audit.narrative import REASON_PHRASES, SPOKEN_REASON_LIMIT, describe
from orion.core.audit.trail import (
    AuditTrail,
    InMemorySink,
    SecureDebugRefused,
    UserFacingEntry,
)
from orion.core.events.ports import AuditRecord
from orion.core.tools.registry import decode_registry
from orion.mac.audit_ledger import UNNAMED_DEVICE, LedgerRowError, events_for
from orion.shared.result import DecisionOutcome, ExecutionStatus, Sensitivity


REPO_ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 8, 24, 21, 0, tzinfo=timezone.utc)
KEY = "sk-abcdefghijklmnopqrstuvwxyz012345"


def decision(outcome="REQUIRE_APPROVAL", codes=("risk_requires_approval",)):
    return DecisionRecord(outcome=outcome, risk="R4", reason_codes=codes, policy_version="policy-v2.5")


def event(**overrides):
    fields = {
        "event_id": "audit-0001-aaaa",
        "correlation_id": "correlation-0001",
        "occurred_at": NOW,
        "actor": "orion",
        "user": "user-nick-0001",
        "device": "mac-studio-0001",
        "proposed_action": "file_delete",
        "capability": "files.delete",
        "resource": "~/Desktop/notes.txt",
        "decision": decision(),
        "sensitivity": Sensitivity.INTERNAL,
    }
    fields.update(overrides)
    return AuditEvent(**fields)


class TwelveFieldTests(unittest.TestCase):
    def test_the_manifests_twelve_fields_are_all_present(self):
        rendered = event().to_dict()
        for field in (
            "actor", "user", "device", "proposed_action", "capability", "resource",
            "decision", "approval", "execution", "result", "occurred_at", "correlation_id",
        ):
            self.assertIn(field, rendered, field)

    def test_decoding_is_strict(self):
        rendered = event().to_dict()
        with self.assertRaises(ValueError):
            AuditEvent.from_dict({**rendered, "smuggled": "value"})
        with self.assertRaises(ValueError):
            AuditEvent.from_dict({key: value for key, value in rendered.items() if key != "device"})

    def test_the_field_set_matches_what_decoding_expects(self):
        self.assertEqual(set(event().to_dict()) - {"redactions"}, FIELDS)

    def test_an_actor_outside_the_vocabulary_is_refused(self):
        with self.assertRaises(ValueError):
            event(actor="whoever")
        for actor in ACTORS:
            self.assertEqual(event(actor=actor).actor, actor)

    def test_a_decision_must_say_why(self):
        with self.assertRaises(ValueError):
            decision(codes=())

    def test_an_event_must_say_what_was_acted_on(self):
        with self.assertRaises(ValueError):
            event(resource="")


class RedactionCannotBeSkippedTests(unittest.TestCase):
    def test_free_text_fields_are_redacted_at_construction(self):
        built = event(resource=f"~/keys/{KEY}", result=f"wrote {KEY}", details={"note": KEY})
        rendered = json.dumps(built.to_dict())
        self.assertNotIn(KEY, rendered)
        self.assertIn("openai_style_key", built.redactions)

    def test_the_string_fields_are_exactly_the_ones_that_were_decided_about(self):
        # If somebody adds a new free-text field, this fails and they have to
        # decide whether it is redacted -- which is the whole point.
        strings = {
            name for name, spec in AuditEvent.__dataclass_fields__.items()
            if spec.type in ("str", "str | None")
        }
        self.assertEqual(strings, {"actor", "proposed_action", "capability", "resource", "result"})

    def test_rebuilding_an_event_redacts_again(self):
        built = replace(event(), result=f"leaked {KEY}")
        self.assertNotIn(KEY, built.result)

    def test_a_decoded_event_never_looks_cleaner_than_the_original(self):
        built = event(details={"note": KEY})
        again = AuditEvent.from_dict(built.to_dict())
        self.assertEqual(again.redactions, built.redactions)
        self.assertEqual(again.to_dict(), built.to_dict())

    def test_claiming_a_redaction_that_did_not_happen_does_not_hide_anything(self):
        built = event(details={"note": KEY}, redactions=("invented_rule",))
        self.assertIn("invented_rule", built.redactions)
        self.assertIn("openai_style_key", built.redactions)
        self.assertNotIn(KEY, json.dumps(built.to_dict()))

    def test_secure_debug_is_per_event_and_off_by_default(self):
        self.assertFalse(event().secure_debug)
        self.assertEqual(event(details={"prompt": "hello"}).details["prompt"], "[omitted:prompt]")
        kept = event(details={"prompt": "hello"}, secure_debug=True)
        self.assertEqual(kept.details["prompt"], "hello")

    def test_the_phase_1_emission_record_still_fits(self):
        record = event().to_audit_record()
        self.assertIsInstance(record, AuditRecord)
        self.assertEqual(record.correlation_id, "correlation-0001")
        self.assertEqual(record.fields["outcome"], "REQUIRE_APPROVAL")


class NarrativeTests(unittest.TestCase):
    def test_a_person_can_read_it(self):
        sentence = describe(event())
        self.assertIn("Orion tried to work with a file", sentence)
        self.assertIn("asked first", sentence)
        self.assertIn("It has not been approved.", sentence)

    def test_no_identifiers_reach_the_user_facing_record(self):
        sentence = describe(event())
        for identifier in ("audit-0001-aaaa", "correlation-0001", "mac-studio-0001", "policy-v2.5"):
            self.assertNotIn(identifier, sentence)

    def test_a_denial_says_why_in_words(self):
        sentence = describe(event(decision=decision("DENY", ("external_content_cannot_authorize",))))
        self.assertIn("refused", sentence)
        self.assertIn("not from you", sentence)
        self.assertNotIn("external_content_cannot_authorize", sentence)

    def test_a_long_denial_stops_being_a_list(self):
        codes = tuple(sorted(REASON_PHRASES))[: SPOKEN_REASON_LIMIT + 2]
        sentence = describe(event(decision=decision("DENY", codes)))
        self.assertIn("among other reasons", sentence)

    def test_an_unknown_reason_code_does_not_print_a_code_at_somebody(self):
        sentence = describe(event(decision=decision("DENY", ("something_new_in_phase_40",))))
        self.assertIn("Orion's rules did not allow it", sentence)
        self.assertNotIn("something_new_in_phase_40", sentence)

    def test_approval_and_execution_are_reported_when_known(self):
        sentence = describe(
            event(
                approval=ApprovalRecord("approval-0001", "user-nick-0001", "voice", NOW),
                execution=ExecutionRecord(ExecutionStatus.SUCCEEDED, NOW, NOW + timedelta(seconds=1)),
                result="Moved to Trash",
            )
        )
        self.assertIn("You approved it.", sentence)
        self.assertIn("It worked.", sentence)
        self.assertIn("Moved to Trash.", sentence)

    def test_nothing_is_said_about_execution_that_the_record_does_not_know(self):
        sentence = describe(event())
        for phrase in ("It worked", "It failed", "It was cancelled"):
            self.assertNotIn(phrase, sentence)


class TrailTests(unittest.TestCase):
    def setUp(self):
        self.developer = InMemorySink()
        self.user_facing = InMemorySink()
        self.trail = AuditTrail(self.developer, self.user_facing)

    def test_one_event_produces_both_records(self):
        self.trail.record(event())
        self.assertEqual(len(self.developer), 1)
        self.assertEqual(len(self.user_facing), 1)
        self.assertIsInstance(self.user_facing.entries[0], UserFacingEntry)
        self.assertIsInstance(self.developer.entries[0], dict)

    def test_the_two_records_come_from_one_event_and_cannot_disagree(self):
        built = event(result="Moved to Trash")
        self.trail.record(built)
        self.assertEqual(self.developer.entries[0]["event_id"], str(built.event_id))
        self.assertEqual(self.user_facing.entries[0].sentence, describe(built))

    def test_a_secure_debug_record_needs_a_secure_debug_trail(self):
        built = event(details={"prompt": "hello"}, secure_debug=True)
        with self.assertRaises(SecureDebugRefused):
            self.trail.record(built)
        permitted = AuditTrail(InMemorySink(), InMemorySink(), secure_debug=True)
        self.assertEqual(permitted.record(built), built.event_id)

    def test_the_developer_record_is_written_first(self):
        class Failing(InMemorySink):
            def append(self, payload):
                raise RuntimeError("render failed")

        trail = AuditTrail(self.developer, Failing())
        with self.assertRaises(RuntimeError):
            trail.record(event())
        # The evidence survived the rendering bug, which is the ordering's job.
        self.assertEqual(len(self.developer), 1)

    def test_only_an_audit_event_can_be_recorded(self):
        with self.assertRaises(ValueError):
            self.trail.record({"event_id": "audit-0001-aaaa"})


class LedgerAdapterTests(unittest.TestCase):
    def registry(self):
        return decode_registry(
            json.loads((REPO_ROOT / "planning/v2/capability-registry.json").read_text(encoding="utf-8"))
        )

    def row(self, **overrides):
        base = {
            "taskId": "orion-74baa26cf680bd8b",
            "planHash": "abc123",
            "goal": "set a timer",
            "status": "succeeded",
            "createdAt": "2026-08-24T21:00:00.000Z",
            "completedAt": "2026-08-24T21:00:02.000Z",
            "authorization": {"binding": "recent", "turnCount": 1, "sources": ["user_turn"]},
            "validation": {"valid": True, "status": "ready", "issues": [], "executionOrder": ["s1"]},
            "steps": [
                {
                    "stepId": "s1",
                    "status": "succeeded",
                    "attempts": 1,
                    "idempotencyKey": "k1",
                    "request": {"action": "timer_set", "arguments": {"title": "tea", "minutes": 3}},
                    "verification": {"method": "read_back", "observed": True, "evidence": "ok"},
                }
            ],
        }
        base.update(overrides)
        return base

    def test_a_live_row_becomes_an_audit_event(self):
        built = list(events_for(self.row(), self.registry()))
        self.assertEqual(len(built), 1)
        self.assertEqual(built[0].capability, "reminder.timer.set")
        self.assertIs(built[0].decision.outcome, DecisionOutcome.ALLOW)
        self.assertIs(built[0].execution.status, ExecutionStatus.SUCCEEDED)

    def test_the_two_fields_the_live_ledger_lacks_are_marked_not_invented(self):
        built = next(iter(events_for(self.row(), self.registry())))
        self.assertIsNone(built.user)
        self.assertEqual(str(built.device), UNNAMED_DEVICE)

    def test_a_task_with_no_steps_is_still_a_decision(self):
        rejected = self.row(
            steps=[],
            status="rejected",
            validation={
                "valid": False,
                "status": "rejected",
                "issues": [{"code": "unknown_action", "message": "no such action", "stepId": "s1"}],
                "executionOrder": [],
            },
        )
        built = list(events_for(rejected, self.registry()))
        self.assertEqual(len(built), 1)
        self.assertIs(built[0].decision.outcome, DecisionOutcome.DENY)
        self.assertEqual(built[0].decision.reason_codes, ("unknown_action",))
        self.assertEqual(built[0].proposed_action, "unrecorded")

    def test_the_live_validators_three_outcomes_map_onto_the_manifests_three(self):
        for status, outcome in (
            ("ready", DecisionOutcome.ALLOW),
            ("needs_approval", DecisionOutcome.REQUIRE_APPROVAL),
            ("rejected", DecisionOutcome.DENY),
        ):
            row = self.row(validation={"valid": True, "status": status, "issues": [], "executionOrder": []})
            self.assertIs(next(iter(events_for(row, self.registry()))).decision.outcome, outcome)

    def test_a_row_without_a_task_id_is_reported_not_skipped(self):
        with self.assertRaises(LedgerRowError):
            list(events_for({"status": "succeeded"}, self.registry()))

    def test_the_trust_binding_survives_redaction_under_its_own_name(self):
        # The live row calls it `authorization`; under that name the redactor
        # would strike it, correctly, because it cannot know it holds "there was
        # a user turn recently" rather than a credential.
        built = next(iter(events_for(self.row(), self.registry())))
        self.assertEqual(built.details["trust_binding"], "recent")


if __name__ == "__main__":
    unittest.main()
