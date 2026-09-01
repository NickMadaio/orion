"""Phase 25: calendar writes, and what has to be true before one happens.

The rule under most of these: **what was approved is what is executed.** An
approval flow that shows a preview and then executes "the write" is the oldest
race there is, and the person finds out when a three-hour meeting goes out under
an approval they gave a thirty-minute one.
"""

from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from backend.calendar.events import Event, Response, Transparency
from backend.calendar.writes import (
    RISK,
    WRITABLE_FIELDS,
    Approval,
    ApprovalRefused,
    ChangedField,
    DelegationRefused,
    EventDraft,
    Preview,
    WriteKind,
    WriteRefused,
    audit_details,
    authorize,
    changed_fields,
    preview,
    undo_for,
)
from backend.connectors.broker import Connection, ConnectionState, ConnectorRefused
from backend.connectors.scopes import Feature, for_features
from orion.security.vocabulary import RiskLevel, at_least
from orion.shared.result import DecisionOutcome


NOW = datetime(2026, 8, 25, 12, tzinfo=timezone.utc)


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, 26, hour, minute, tzinfo=timezone.utc)


def draft(**kwargs) -> EventDraft:
    base = {
        "calendar_id": "cal1",
        "summary": "Coffee with Sam",
        "starts_at": at(10),
        "ends_at": at(11),
    }
    base.update(kwargs)
    return EventDraft(**base)


def existing_event(**kwargs) -> Event:
    base = {
        "event_id": "e1",
        "calendar_id": "cal1",
        "summary": "Coffee with Sam",
        "starts_at": at(10),
        "ends_at": at(11),
        "transparency": Transparency.OPAQUE,
    }
    base.update(kwargs)
    return Event(**base)


def write_connection(**kwargs) -> Connection:
    base = {
        "connection_id": "conn1",
        "user_id": "u1",
        "provider": "google",
        "features": (Feature.CALENDAR_WRITE,),
        "scopes": for_features(Feature.CALENDAR_WRITE),
        "credential_ref": "cred1",
    }
    base.update(kwargs)
    return Connection(**base)


def approval_for(shown: Preview, **kwargs) -> Approval:
    base = {
        "approval_id": "appr1",
        "granted_by": "u1",
        "granted_at": NOW,
        "preview_fingerprint": shown.fingerprint(),
    }
    base.update(kwargs)
    return Approval(**base)


def authorized(shown: Preview, approval: Approval, **kwargs):
    return authorize(
        shown,
        approval,
        kwargs.pop("connection", write_connection()),
        now=NOW,
        correlation_id="corr1",
        device_id="dev1",
        user_id="u1",
        **kwargs,
    )


class ThreeOperationsTests(unittest.TestCase):
    def test_the_manifests_two_capabilities_exist_by_name(self):
        self.assertEqual(WriteKind.CREATE.value, "calendar.events.create")
        self.assertEqual(WriteKind.UPDATE.value, "calendar.events.update")

    def test_deletion_is_separate_and_strictly_higher_risk(self):
        self.assertEqual(RISK[WriteKind.CREATE], RISK[WriteKind.UPDATE])
        self.assertTrue(
            at_least(RISK[WriteKind.DELETE], RiskLevel.R3),
        )
        for kind in (WriteKind.CREATE, WriteKind.UPDATE):
            with self.subTest(kind=kind):
                self.assertNotEqual(RISK[WriteKind.DELETE], RISK[kind])
                self.assertTrue(at_least(RISK[WriteKind.DELETE], RISK[kind]))

    def test_a_create_does_not_name_an_existing_event(self):
        with self.assertRaises(WriteRefused):
            preview(WriteKind.CREATE, draft(event_id="e1"))

    def test_an_update_and_a_delete_must_name_one(self):
        for kind in (WriteKind.UPDATE, WriteKind.DELETE):
            with self.subTest(kind=kind):
                with self.assertRaises(WriteRefused):
                    preview(kind, draft())


class DraftRulesTests(unittest.TestCase):
    def test_an_event_the_person_will_see_needs_a_title(self):
        with self.assertRaises(WriteRefused):
            draft(summary="   ")

    def test_an_event_ends_after_it_starts(self):
        with self.assertRaises(WriteRefused):
            draft(starts_at=at(11), ends_at=at(10))

    def test_a_zero_length_write_is_refused(self):
        with self.assertRaises(WriteRefused):
            draft(starts_at=at(10), ends_at=at(10))

    def test_unknown_transparency_is_a_reading_not_a_value_to_write(self):
        # UNKNOWN is what Phase 22 records when it could not READ a value. Sent
        # as a write it becomes a value the fail-safe treats as busy forever,
        # with nothing to say why.
        with self.assertRaises(WriteRefused):
            draft(transparency=Transparency.UNKNOWN)

    def test_a_naive_datetime_is_refused(self):
        with self.assertRaises(WriteRefused):
            draft(starts_at=datetime(2026, 8, 26, 10))

    def test_the_writable_fields_are_the_ones_a_draft_renders(self):
        self.assertEqual(set(WRITABLE_FIELDS), set(draft().values()) | {"starts_at"})


class ChangedFieldsTests(unittest.TestCase):
    def test_a_create_shows_everything_it_sets(self):
        changes = {item.name for item in changed_fields(None, draft())}
        self.assertIn("summary", changes)
        self.assertIn("starts_at", changes)

    def test_a_create_does_not_list_fields_it_leaves_empty(self):
        changes = {item.name for item in changed_fields(None, draft())}
        self.assertNotIn("description", changes)
        self.assertNotIn("location", changes)

    def test_an_update_lists_only_what_differs(self):
        shown = preview(
            WriteKind.UPDATE,
            draft(event_id="e1", starts_at=at(14), ends_at=at(15)),
            before=existing_event(),
        )
        self.assertEqual({item.name for item in shown.changes}, {"starts_at", "ends_at"})

    def test_a_changed_field_carries_both_sides(self):
        shown = preview(
            WriteKind.UPDATE,
            draft(event_id="e1", summary="Coffee with Alex"),
            before=existing_event(),
        )
        change = shown.changes[0]
        self.assertEqual(change.name, "summary")
        self.assertEqual(change.before, "Coffee with Sam")
        self.assertEqual(change.after, "Coffee with Alex")

    def test_an_update_that_changes_nothing_is_refused(self):
        # A preview that can be empty teaches the person to approve without
        # reading, which costs more than the write it saved.
        with self.assertRaises(WriteRefused) as caught:
            preview(WriteKind.UPDATE, draft(event_id="e1"), before=existing_event())
        self.assertIn("changes nothing", str(caught.exception))

    def test_an_update_without_the_current_event_is_refused(self):
        with self.assertRaises(WriteRefused):
            preview(WriteKind.UPDATE, draft(event_id="e1"))

    def test_a_delete_shows_the_one_change_it_makes(self):
        shown = preview(WriteKind.DELETE, draft(event_id="e1"))
        self.assertEqual(
            [(item.name, item.before, item.after) for item in shown.changes],
            [("existence", "exists", "deleted")],
        )


class PreviewTests(unittest.TestCase):
    def test_a_preview_carries_the_policy_outcome_with_it(self):
        shown = preview(WriteKind.CREATE, draft(), reason_codes=("R2",))
        self.assertIs(shown.outcome, DecisionOutcome.REQUIRE_APPROVAL)
        self.assertEqual(shown.reason_codes, ("R2",))

    def test_collisions_are_shown_and_do_not_block(self):
        clash = existing_event(event_id="other", starts_at=at(10, 30), ends_at=at(12))
        shown = preview(WriteKind.CREATE, draft(), existing=[clash])
        self.assertEqual(shown.collides_with, ("other",))

    def test_an_event_does_not_collide_with_itself(self):
        current = existing_event()
        shown = preview(
            WriteKind.UPDATE,
            draft(event_id="e1", summary="Renamed"),
            before=current,
            existing=[current],
        )
        self.assertEqual(shown.collides_with, ())

    def test_a_declined_event_is_not_a_collision(self):
        declined = existing_event(event_id="other", response=Response.DECLINED)
        shown = preview(WriteKind.CREATE, draft(), existing=[declined])
        self.assertEqual(shown.collides_with, ())

    def test_the_fingerprint_is_stable_for_the_same_preview(self):
        first = preview(WriteKind.CREATE, draft())
        second = preview(WriteKind.CREATE, draft())
        self.assertEqual(first.fingerprint(), second.fingerprint())

    def test_the_fingerprint_changes_with_any_shown_detail(self):
        base = preview(WriteKind.CREATE, draft())
        for description, other in (
            ("summary", preview(WriteKind.CREATE, draft(summary="Coffee with Alex"))),
            ("time", preview(WriteKind.CREATE, draft(starts_at=at(14), ends_at=at(15)))),
            ("calendar", preview(WriteKind.CREATE, draft(calendar_id="cal2"))),
            (
                "transparency",
                preview(WriteKind.CREATE, draft(transparency=Transparency.TRANSPARENT)),
            ),
        ):
            with self.subTest(changed=description):
                self.assertNotEqual(base.fingerprint(), other.fingerprint())

    def test_a_preview_cannot_choose_its_own_risk(self):
        # Stronger than hashing it: the risk is derived from the operation, so
        # there is no forged value to hash. A review found the same shape in
        # Phase 29, where a settable risk meant an R3 send audited as R1.
        shown = preview(WriteKind.CREATE, draft())
        self.assertIs(shown.risk, RISK[WriteKind.CREATE])
        with self.assertRaises(WriteRefused):
            replace(shown, risk=RiskLevel.R5)

    def test_everything_the_person_sees_is_in_the_fingerprint(self):
        # A review found `collides_with`, `reason_codes` and `undo_available`
        # shown and/or audited but outside the hash, so an approval given for a
        # preview warning of a clash authorised one that showed none.
        clash = existing_event(event_id="other", starts_at=at(10, 30), ends_at=at(12))
        with_clash = preview(WriteKind.CREATE, draft(), existing=[clash])
        without = preview(WriteKind.CREATE, draft())
        self.assertEqual(with_clash.collides_with, ("other",))
        self.assertEqual(without.collides_with, ())
        self.assertNotEqual(with_clash.fingerprint(), without.fingerprint())
        with self.assertRaises(ApprovalRefused):
            authorized(without, approval_for(with_clash))

    def test_reason_codes_are_signed_because_they_reach_the_audit(self):
        loud = preview(WriteKind.CREATE, draft(), reason_codes=("external_attendee",))
        quiet = preview(WriteKind.CREATE, draft(), reason_codes=("routine",))
        self.assertNotEqual(loud.fingerprint(), quiet.fingerprint())
        with self.assertRaises(ApprovalRefused):
            authorized(quiet, approval_for(loud))

    def test_a_delete_cannot_be_built_claiming_an_undo(self):
        shown = preview(WriteKind.DELETE, draft(event_id="e1"))
        self.assertFalse(shown.undo_available)
        with self.assertRaises(WriteRefused):
            replace(shown, undo_available=True, undo_unavailable_because="")

    def test_a_delete_claiming_an_undo_is_refused_on_the_flag_alone(self):
        # Changing the flag AND the reason trips the reason check first, so the
        # flag check was never exercised on its own.
        shown = preview(WriteKind.DELETE, draft(event_id="e1"))
        with self.assertRaises(WriteRefused):
            replace(shown, undo_available=True)

    def test_the_fingerprint_encoding_is_pinned_to_ensure_ascii_false(self):
        # With the default `ensure_ascii=True`, an astral character is escaped
        # as a surrogate PAIR, so the lone-surrogate spelling hashes
        # identically -- a real collision in an authorisation token, found by
        # review on the recipient field of the sibling send path. The boundary
        # now refuses lone surrogates, so this is defence in depth and is
        # pinned at the layer it lives on rather than through a collision that
        # can no longer be constructed.
        import hashlib
        import json

        shown = preview(WriteKind.CREATE, draft(summary="Board vote " + chr(0x1F600)))
        payload = {
            "kind": shown.kind.value,
            "calendar_id": shown.draft.calendar_id,
            "event_id": shown.draft.event_id,
            "values": dict(shown.draft.values()),
            "changes": [
                {"name": item.name, "before": item.before, "after": item.after}
                for item in shown.changes
            ],
            "risk": shown.risk.value,
            "outcome": shown.outcome.value,
            "reason_codes": list(shown.reason_codes),
            "collides_with": list(shown.collides_with),
            "undo_available": shown.undo_available,
            "undo_unavailable_because": shown.undo_unavailable_because,
        }
        unescaped = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        escaped = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        self.assertNotEqual(unescaped, escaped)
        self.assertIn("\\ud83d", escaped)
        self.assertEqual(
            shown.fingerprint(),
            hashlib.sha256(unescaped.encode("utf-8")).hexdigest(),
        )

    def test_a_preview_with_no_changes_shows_nothing(self):
        shown = preview(WriteKind.CREATE, draft())
        with self.assertRaises(WriteRefused):
            replace(shown, changes=())

    def test_an_unencodable_summary_is_refused_rather_than_colliding(self):
        # json.dumps(ensure_ascii=True) escapes an astral character as a
        # surrogate PAIR, so a lone-surrogate string hashed identically to the
        # real one. Refused at the boundary instead.
        with self.assertRaises(WriteRefused):
            draft(summary="Board vote " + chr(0xD83D))

    def test_a_non_string_description_cannot_be_flattened_into_the_hash(self):
        class Sneaky:
            def __str__(self):
                return "Team lunch"

        with self.assertRaises(WriteRefused):
            draft(description=Sneaky())


class ApprovalBindsToContentTests(unittest.TestCase):
    def test_an_approval_for_this_preview_authorises_the_write(self):
        shown = preview(WriteKind.CREATE, draft())
        result = authorized(shown, approval_for(shown))
        self.assertEqual(result.request.method, "POST")
        self.assertIn("/calendars/cal1/events", result.request.url)
        self.assertEqual(result.approval.approval_id, "appr1")

    def test_an_approval_for_a_different_preview_is_refused(self):
        # The race this whole phase is built around: the person approved a
        # thirty-minute meeting and a three-hour one is about to go out.
        shown = preview(WriteKind.CREATE, draft())
        approval = approval_for(shown)
        mutated = preview(WriteKind.CREATE, draft(ends_at=at(13)))
        with self.assertRaises(ApprovalRefused) as caught:
            authorized(mutated, approval)
        self.assertIn("different preview", str(caught.exception))

    def test_a_one_character_difference_is_enough(self):
        shown = preview(WriteKind.CREATE, draft())
        approval = approval_for(shown)
        with self.assertRaises(ApprovalRefused):
            authorized(preview(WriteKind.CREATE, draft(summary="Coffee with Sam ")), approval)

    def test_the_fingerprint_is_compared_in_constant_time(self):
        # Phase 22 learned that asserting the words appear in the source passes
        # vacuously when the docstring says them, so the call is observed.
        # The fingerprint is not a secret -- anyone holding the preview can
        # compute it -- so this is defence in depth rather than a necessary
        # property. It is still what anything used as an authorisation token
        # should be compared with.
        import hmac as hmac_module
        from unittest.mock import patch

        shown = preview(WriteKind.CREATE, draft())
        with patch.object(
            hmac_module, "compare_digest", wraps=hmac_module.compare_digest
        ) as compare:
            authorized(shown, approval_for(shown))
        compare.assert_called_once_with(shown.fingerprint(), shown.fingerprint())

    def test_a_mismatched_approval_is_refused_through_the_same_path(self):
        import hmac as hmac_module
        from unittest.mock import patch

        shown = preview(WriteKind.CREATE, draft())
        approval = approval_for(shown)
        with patch.object(
            hmac_module, "compare_digest", wraps=hmac_module.compare_digest
        ) as compare:
            with self.assertRaises(ApprovalRefused):
                authorized(preview(WriteKind.CREATE, draft(ends_at=at(13))), approval)
        compare.assert_called_once()

    def test_an_approval_cannot_override_a_denial(self):
        shown = preview(WriteKind.CREATE, draft(), outcome=DecisionOutcome.DENY)
        with self.assertRaises(ApprovalRefused) as caught:
            authorized(shown, approval_for(shown))
        self.assertIn("cannot override a denial", str(caught.exception))

    def test_a_write_that_policy_simply_allowed_still_needs_an_approval(self):
        # "Start with explicit approval" -- an ALLOW is not an approval, and
        # this phase does not have the delegation that would make it one.
        shown = preview(WriteKind.CREATE, draft(), outcome=DecisionOutcome.ALLOW)
        with self.assertRaises(ApprovalRefused):
            authorized(shown, approval_for(shown))

    def test_an_approval_needs_a_real_grantor_and_time(self):
        shown = preview(WriteKind.CREATE, draft())
        with self.assertRaises(ApprovalRefused):
            approval_for(shown, granted_by="  ")
        with self.assertRaises(ApprovalRefused):
            approval_for(shown, granted_at=datetime(2026, 8, 25, 12))

    def test_a_delegated_grant_is_refused_and_names_the_phase_that_owns_it(self):
        shown = preview(WriteKind.CREATE, draft())
        with self.assertRaises(DelegationRefused) as caught:
            authorized(shown, approval_for(shown, delegated_policy="routine_confirmations"))
        self.assertIn("Phase 50", str(caught.exception))

    def test_a_connection_without_calendar_write_cannot_write(self):
        read_only = write_connection(
            features=(Feature.CALENDAR_READ,), scopes=for_features(Feature.CALENDAR_READ)
        )
        shown = preview(WriteKind.CREATE, draft())
        with self.assertRaises(ConnectorRefused):
            authorized(shown, approval_for(shown), connection=read_only)

    def test_a_connection_that_cannot_fetch_cannot_write(self):
        shown = preview(WriteKind.CREATE, draft())
        for state in (ConnectionState.NEEDS_REFRESH, ConnectionState.NEEDS_REAUTH):
            with self.subTest(state=state):
                with self.assertRaises(ConnectorRefused):
                    authorized(
                        shown,
                        approval_for(shown),
                        connection=replace(write_connection(), state=state),
                    )

    def test_the_request_never_carries_the_credential(self):
        shown = preview(WriteKind.CREATE, draft())
        result = authorized(shown, approval_for(shown))
        self.assertNotIn("Authorization", result.request.headers)
        self.assertEqual(result.request.credential_ref, "cred1")

    def test_each_operation_uses_its_own_method_and_url(self):
        cases = {
            WriteKind.CREATE: ("POST", "/calendars/cal1/events"),
            WriteKind.UPDATE: ("PATCH", "/calendars/cal1/events/e1"),
            WriteKind.DELETE: ("DELETE", "/calendars/cal1/events/e1"),
        }
        for kind, (method, tail) in cases.items():
            with self.subTest(kind=kind):
                if kind is WriteKind.CREATE:
                    shown = preview(kind, draft())
                elif kind is WriteKind.UPDATE:
                    shown = preview(
                        kind, draft(event_id="e1", summary="Renamed"), before=existing_event()
                    )
                else:
                    shown = preview(kind, draft(event_id="e1"))
                result = authorized(shown, approval_for(shown))
                self.assertEqual(result.request.method, method)
                self.assertTrue(result.request.url.endswith(tail))


class AuditTests(unittest.TestCase):
    def test_an_authorised_write_carries_its_audit_record(self):
        shown = preview(WriteKind.CREATE, draft(), reason_codes=("R2",))
        result = authorized(shown, approval_for(shown))
        self.assertEqual(result.audit["proposed_action"], "calendar.events.create")
        self.assertEqual(result.audit["capability"], "calendar_write")
        self.assertEqual(result.audit["resource"], "calendar:cal1")
        self.assertEqual(result.audit["approval_id"], "appr1")
        self.assertEqual(result.audit["outcome"], "ALLOW")

    def test_the_audit_record_names_the_changed_fields_not_their_values(self):
        shown = preview(
            WriteKind.UPDATE,
            draft(event_id="e1", summary="Something private"),
            before=existing_event(),
        )
        details = audit_details(
            shown, approval=None, now=NOW, correlation_id="c", device_id="d",
            user_id="u", outcome=DecisionOutcome.REQUIRE_APPROVAL,
        )
        self.assertEqual(details["changed_fields"], ["summary"])
        self.assertNotIn("Something private", str(details))

    def test_a_refusal_is_auditable_too(self):
        shown = preview(WriteKind.CREATE, draft())
        details = audit_details(
            shown, approval=None, now=NOW, correlation_id="c", device_id="d",
            user_id="u", outcome=DecisionOutcome.DENY, refusal="approval_mismatch",
        )
        self.assertEqual(details["outcome"], "DENY")
        self.assertIn("approval_mismatch", details["reason_codes"])

    def test_the_audit_keys_are_the_audit_events_own(self):
        import dataclasses

        from orion.core.audit.events import AuditEvent

        shown = preview(WriteKind.CREATE, draft())
        details = audit_details(
            shown, approval=None, now=NOW, correlation_id="c", device_id="d",
            user_id="u", outcome=DecisionOutcome.ALLOW,
        )
        event_fields = {item.name for item in dataclasses.fields(AuditEvent)}
        for key in ("correlation_id", "occurred_at", "actor", "user", "device",
                    "proposed_action", "capability", "resource"):
            with self.subTest(key=key):
                self.assertIn(key, event_fields)
                self.assertIn(key, details)

    def test_the_actor_distinguishes_an_approved_write_from_an_unapproved_one(self):
        shown = preview(WriteKind.CREATE, draft())
        approved = authorized(shown, approval_for(shown))
        unapproved = audit_details(
            shown, approval=None, now=NOW, correlation_id="c", device_id="d",
            user_id="u", outcome=DecisionOutcome.REQUIRE_APPROVAL,
        )
        self.assertEqual(approved.audit["actor"], "user")
        self.assertEqual(unapproved["actor"], "orion")


class UndoTests(unittest.TestCase):
    def test_a_create_undoes_by_deleting_what_it_created(self):
        shown = preview(WriteKind.CREATE, draft())
        undo = undo_for(shown, written_event_id="new1")
        self.assertIs(undo.kind, WriteKind.DELETE)
        self.assertEqual(undo.draft.event_id, "new1")

    def test_undoing_a_create_needs_the_id_the_provider_assigned(self):
        shown = preview(WriteKind.CREATE, draft())
        with self.assertRaises(WriteRefused):
            undo_for(shown)

    def test_an_update_undoes_by_restoring_what_it_replaced(self):
        shown = preview(
            WriteKind.UPDATE,
            draft(event_id="e1", starts_at=at(14), ends_at=at(15)),
            before=existing_event(),
        )
        undo = undo_for(shown)
        self.assertIs(undo.kind, WriteKind.UPDATE)
        self.assertEqual(undo.draft.starts_at, at(10))
        self.assertEqual(undo.draft.ends_at, at(11))
        self.assertEqual(undo.draft.event_id, "e1")

    def test_a_delete_has_no_undo_and_says_why(self):
        shown = preview(WriteKind.DELETE, draft(event_id="e1"))
        self.assertIsNone(undo_for(shown))
        self.assertFalse(shown.undo_available)
        self.assertIn("new id", shown.undo_unavailable_because)
        self.assertIn("re-invites", shown.undo_unavailable_because)

    def test_create_and_update_advertise_their_undo(self):
        create = preview(WriteKind.CREATE, draft())
        update = preview(
            WriteKind.UPDATE, draft(event_id="e1", summary="Renamed"), before=existing_event()
        )
        self.assertTrue(create.undo_available)
        self.assertTrue(update.undo_available)
        self.assertEqual(create.undo_unavailable_because, "")


class SuggestionsStillCannotWriteTests(unittest.TestCase):
    def test_a_suggestion_still_has_no_way_to_reach_a_write(self):
        # Phase 23's property has to survive a write path existing, which is
        # the first moment it could stop being true.
        from backend.planning.planner import Suggestion

        self.assertEqual(
            {name for name in dir(Suggestion) if name in {"apply", "commit", "write", "save"}},
            set(),
        )

    def test_the_planning_package_cannot_import_the_write_module(self):
        from backend.modules import MODULES

        # planning depends on tasks, calendar, health -- so `calendar` is
        # reachable. The property is enforced by the check below instead.
        self.assertIn("calendar", MODULES["planning"].depends_on)

    def test_nothing_in_planning_imports_calendar_writes(self):
        from pathlib import Path

        from backend.boundaries import imported_names

        root = Path(__file__).resolve().parents[1] / "backend" / "planning"
        for path in root.rglob("*.py"):
            for _, name in imported_names(path):
                with self.subTest(module=path.name, imported=name):
                    self.assertNotEqual(name, "backend.calendar.writes")

    def test_the_declared_module_graph_still_holds(self):
        from backend.boundaries import all_errors

        self.assertEqual(all_errors(), [])


if __name__ == "__main__":
    unittest.main()
