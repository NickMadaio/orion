"""Phase 27: the Action Inbox, and the memory a correction may never become.

The manifest's hardest sentence here is "do not automatically turn correction
history into unrestricted model memory". Both halves sound reasonable and only
one is allowed: "this person moves newsletters to low priority" is a preference;
"Nick doesn't care about marketing" is a durable claim about a person, inferred
from external content. Phases 3 and 18 already refuse the second, and these
tests call Phase 18's own checker rather than restating it.
"""

from __future__ import annotations

import dataclasses
import unittest
from datetime import datetime, timedelta, timezone

from backend.gmail.inbox import (
    ACTIONABLE,
    INBOX_SCOPE,
    MANIFEST_CLASSES,
    SIGNAL_HISTORY_LIMIT,
    TODAY_LIMIT,
    Classification,
    ClassifiedItem,
    Correction,
    InboxRefused,
    PreferenceRefused,
    PreferenceSignal,
    Source,
    actionable,
    correct,
    for_today,
    signals_from,
)
from backend.gmail.messages import MessageRefused
from backend.memory.durability import Evidence, Grounds, PromotionRefused
from backend.memory.durability import check as durability_check
from orion.core.context.domains import Provenance


NOW = datetime(2026, 8, 26, 9, tzinfo=timezone.utc)


def item(message_id: str = "m1", **kwargs) -> ClassifiedItem:
    base = {
        "message_id": message_id,
        "classification": Classification.NEEDS_REPLY,
        "classified_at": NOW,
        "confidence": 0.8,
    }
    base.update(kwargs)
    return ClassifiedItem(**base)


class NineClassificationsTests(unittest.TestCase):
    MANIFEST = (
        "needs_reply", "waiting_on", "important", "fyi", "receipt",
        "newsletter", "travel", "calendar", "low_priority",
    )

    def test_the_manifests_nine_are_all_present(self):
        values = {member.value for member in MANIFEST_CLASSES}
        self.assertEqual(values, set(self.MANIFEST))
        self.assertEqual(len(self.MANIFEST), 9)

    def test_unclassified_is_a_tenth_state_and_not_one_of_the_nine(self):
        # Phase 20 made the same decision about capture kinds: a classifier that
        # always answers produces a wrong answer for anything unusual.
        self.assertNotIn(Classification.UNCLASSIFIED, MANIFEST_CLASSES)
        self.assertIn(Classification.UNCLASSIFIED, set(Classification))

    def test_unclassified_is_never_surfaced(self):
        self.assertFalse(actionable(Classification.UNCLASSIFIED))

    def test_every_class_has_an_actionability_entry(self):
        for classification in Classification:
            with self.subTest(classification=classification):
                self.assertIn(classification, ACTIONABLE)
                self.assertIsInstance(actionable(classification), bool)

    def test_a_class_with_no_entry_is_refused_rather_than_defaulted(self):
        from unittest.mock import patch

        import backend.gmail.inbox as inbox

        thinned = {
            key: value
            for key, value in ACTIONABLE.items()
            if key is not Classification.TRAVEL
        }
        with patch.object(inbox, "ACTIONABLE", thinned):
            with self.assertRaises(InboxRefused) as caught:
                actionable(Classification.TRAVEL)
        self.assertIn("silently default", str(caught.exception))

    def test_the_actionable_ones_are_the_ones_a_person_can_act_on(self):
        self.assertTrue(actionable(Classification.NEEDS_REPLY))
        self.assertTrue(actionable(Classification.WAITING_ON))
        self.assertFalse(actionable(Classification.NEWSLETTER))
        self.assertFalse(actionable(Classification.RECEIPT))


class NoMirrorTests(unittest.TestCase):
    """Phase 26's follow-up: a classification store must not become the mirror."""

    TEXT_FIELDS = {"subject", "snippet", "body", "preview", "summary", "text", "content"}

    def test_a_classified_item_has_no_text_field(self):
        names = {field.name for field in dataclasses.fields(ClassifiedItem)}
        self.assertEqual(names & self.TEXT_FIELDS, set())

    def test_a_correction_has_no_text_field(self):
        names = {field.name for field in dataclasses.fields(Correction)}
        self.assertEqual(names & self.TEXT_FIELDS, set())

    def test_a_preference_signal_has_no_text_field(self):
        names = {field.name for field in dataclasses.fields(PreferenceSignal)}
        self.assertEqual(names & self.TEXT_FIELDS, set())

    def test_a_message_id_is_an_id(self):
        with self.assertRaises(MessageRefused):
            item(message_id="Re: are you free Thursday?")


class ClassificationRulesTests(unittest.TestCase):
    def test_a_confidence_is_between_zero_and_one(self):
        for bad in (-0.1, 1.1, True, "high"):
            with self.subTest(confidence=bad):
                with self.assertRaises(InboxRefused):
                    item(confidence=bad)

    def test_a_classification_a_person_made_is_certain(self):
        # A person saying so is not a probability.
        with self.assertRaises(InboxRefused):
            item(source=Source.USER, confidence=0.9)

    def test_only_a_person_corrects(self):
        with self.assertRaises(InboxRefused):
            item(source=Source.ORION, corrected_from=Classification.FYI)

    def test_a_naive_timestamp_is_refused(self):
        with self.assertRaises(InboxRefused):
            item(classified_at=datetime(2026, 8, 26, 9))


class CorrectionTests(unittest.TestCase):
    def test_a_correction_records_what_it_changed_from(self):
        # The same reason Phase 20 records resolvedBy: a later reader has to be
        # able to tell an answer from a guess.
        original = item(classification=Classification.NEWSLETTER)
        corrected, correction = correct(
            original, Classification.LOW_PRIORITY, at=NOW + timedelta(hours=1)
        )
        self.assertIs(corrected.classification, Classification.LOW_PRIORITY)
        self.assertIs(corrected.corrected_from, Classification.NEWSLETTER)
        self.assertIs(corrected.source, Source.USER)
        self.assertEqual(corrected.confidence, 1.0)
        self.assertIs(correction.was, Classification.NEWSLETTER)
        self.assertIs(correction.became, Classification.LOW_PRIORITY)

    def test_correcting_to_the_same_class_is_refused(self):
        with self.assertRaises(InboxRefused):
            correct(item(), Classification.NEEDS_REPLY, at=NOW)

    def test_a_person_cannot_correct_to_unclassified(self):
        # "I don't know" is ORION's state, not an instruction, and accepting it
        # would let a correction erase a working classification.
        with self.assertRaises(InboxRefused) as caught:
            correct(item(), Classification.UNCLASSIFIED, at=NOW)
        self.assertIn("not to unclassified", str(caught.exception))

    def test_a_correction_that_changes_nothing_cannot_be_constructed(self):
        with self.assertRaises(InboxRefused):
            Correction(
                message_id="m1", was=Classification.FYI, became=Classification.FYI, at=NOW
            )

    def test_the_original_item_is_untouched(self):
        original = item(classification=Classification.NEWSLETTER)
        correct(original, Classification.IMPORTANT, at=NOW)
        self.assertIs(original.classification, Classification.NEWSLETTER)
        self.assertIs(original.source, Source.ORION)


def corrections(count: int, was=Classification.NEWSLETTER, became=Classification.LOW_PRIORITY):
    return [
        Correction(message_id=f"m{index}", was=was, became=became, at=NOW)
        for index in range(count)
    ]


class CorrectionsAreNotMemoryTests(unittest.TestCase):
    """The manifest's rule, inherited from Phase 18 rather than restated."""

    def test_a_signal_is_scoped_to_inbox_classification_and_nothing_else(self):
        signal = signals_from(corrections(3))[0]
        self.assertEqual(signal.scope, INBOX_SCOPE)
        self.assertTrue(signal.applies_to(INBOX_SCOPE))
        for other in ("health", "calendar", "everything", "*", ""):
            with self.subTest(scope=other):
                self.assertFalse(signal.applies_to(other))

    def test_a_signal_cannot_name_its_own_scope(self):
        # A preference that can name its own scope will eventually name all of
        # them.
        for scope in ("everything", "*", "health", ""):
            with self.subTest(scope=scope):
                with self.assertRaises(PreferenceRefused):
                    PreferenceSignal(
                        was=Classification.FYI,
                        became=Classification.IMPORTANT,
                        observations=1,
                        scope=scope,
                    )

    def test_a_signal_is_orion_inferred_and_cannot_claim_otherwise(self):
        for provenance in Provenance:
            if provenance is Provenance.ORION_INFERRED:
                continue
            with self.subTest(provenance=provenance):
                with self.assertRaises(PreferenceRefused):
                    PreferenceSignal(
                        was=Classification.FYI,
                        became=Classification.IMPORTANT,
                        observations=1,
                        provenance=provenance,
                    )

    def test_no_signal_can_become_durable_memory_under_any_grounds(self):
        # Phase 18's own checker. Even at the repetition threshold, with an
        # approver claimed, ORION_INFERRED is in NEVER_DURABLE.
        for signal in signals_from(corrections(SIGNAL_HISTORY_LIMIT)):
            for grounds in Grounds:
                with self.subTest(signal=signal.was.value, grounds=grounds):
                    with self.assertRaises(PromotionRefused):
                        durability_check(
                            Evidence(
                                grounds=grounds,
                                provenance=signal.provenance,
                                observations=signal.observations,
                                approved_by="orion",
                            )
                        )

    def test_a_signal_has_no_method_that_yields_memory(self):
        forbidden = {"to_memory", "as_memory", "remember", "promote", "as_fact", "describe"}
        self.assertEqual({name for name in dir(PreferenceSignal) if name in forbidden}, set())

    def test_correction_history_is_bounded(self):
        # An unbounded correction log is a record of everything a person has
        # ever disagreed with -- the unrestricted memory the manifest warns
        # about, wearing a different name.
        signal = signals_from(corrections(SIGNAL_HISTORY_LIMIT * 5))[0]
        self.assertEqual(signal.observations, SIGNAL_HISTORY_LIMIT)

    def test_signals_are_grouped_by_the_shape_of_the_correction(self):
        mixed = corrections(3) + corrections(
            2, was=Classification.FYI, became=Classification.NEEDS_REPLY
        )
        signals = signals_from(mixed)
        self.assertEqual(len(signals), 2)
        self.assertEqual(
            {(signal.was, signal.became, signal.observations) for signal in signals},
            {
                (Classification.NEWSLETTER, Classification.LOW_PRIORITY, 3),
                (Classification.FYI, Classification.NEEDS_REPLY, 2),
            },
        )

    def test_signals_are_aggregated_only_from_corrections(self):
        with self.assertRaises(PreferenceRefused):
            signals_from(["newsletters are low priority"])

    def test_signals_are_ordered_deterministically(self):
        mixed = corrections(1, Classification.TRAVEL, Classification.FYI) + corrections(1)
        self.assertEqual(
            [signal.was.value for signal in signals_from(mixed)],
            [signal.was.value for signal in signals_from(list(reversed(mixed)))],
        )


class TodayTests(unittest.TestCase):
    def test_only_actionable_items_reach_today(self):
        items = [
            item("m1", classification=Classification.NEEDS_REPLY),
            item("m2", classification=Classification.NEWSLETTER),
            item("m3", classification=Classification.RECEIPT),
            item("m4", classification=Classification.WAITING_ON),
        ]
        self.assertEqual(
            {entry.message_id for entry in for_today(items)}, {"m1", "m4"}
        )

    def test_mail_cannot_fill_the_today_screen(self):
        # Phase 19 caps the screen at twelve across all sections and refuses to
        # become a dashboard. An inbox that can push twelve onto it makes it one.
        self.assertLessEqual(TODAY_LIMIT, 5)
        many = [
            item(f"m{index}", classified_at=NOW + timedelta(minutes=index))
            for index in range(20)
        ]
        self.assertEqual(len(for_today(many)), TODAY_LIMIT)

    def test_the_newest_actionable_items_are_the_ones_shown(self):
        older = item("m1", classified_at=NOW)
        newer = item("m2", classified_at=NOW + timedelta(hours=1))
        self.assertEqual(
            [entry.message_id for entry in for_today([older, newer], limit=1)], ["m2"]
        )

    def test_the_order_is_deterministic_when_times_tie(self):
        tied = [item("mb"), item("ma")]
        self.assertEqual(
            [entry.message_id for entry in for_today(tied)],
            [entry.message_id for entry in for_today(list(reversed(tied)))],
        )

    def test_an_unclassified_item_is_a_question_for_orion_not_an_action(self):
        self.assertEqual(
            for_today([item(classification=Classification.UNCLASSIFIED)]), ()
        )

    def test_a_limit_must_be_a_positive_whole_number(self):
        for bad in (0, -1, 1.5):
            with self.subTest(limit=bad):
                with self.assertRaises(InboxRefused):
                    for_today([item()], limit=bad)


class ReviewRegressionTests(unittest.TestCase):
    """Reproductions from the independent review of 2026-08-26."""

    class Wildcard(str):
        """A str that compares equal to everything, as a review used."""

        def __eq__(self, other):
            return True

        def __ne__(self, other):
            return False

        def __hash__(self):
            return hash(str(self))

    def test_a_scope_that_merely_compares_equal_is_refused(self):
        # `provenance` was compared AND re-set to the constant; `scope` was only
        # compared, so an object that compared equal was stored verbatim and a
        # reader of `.scope` saw "everything".
        with self.assertRaises(PreferenceRefused):
            PreferenceSignal(
                was=Classification.FYI,
                became=Classification.IMPORTANT,
                observations=1,
                scope=self.Wildcard("everything"),
            )

    def test_applies_to_reads_the_signals_own_scope(self):
        # It was `return scope == INBOX_SCOPE` -- a constant function of its
        # argument that never read `self.scope`, so the field it exists to
        # enforce had no effect, and a hostile argument made it say yes to
        # anything. The gate's follow-up has a future classifier consuming
        # signals through this method.
        signal = signals_from(corrections(3))[0]
        self.assertTrue(signal.applies_to(INBOX_SCOPE))
        self.assertFalse(signal.applies_to(self.Wildcard("orion.memory.durable")))

    def test_a_scope_that_compares_equal_is_stored_as_the_constant(self):
        # A str SUBCLASS spelling the right value passes the comparison; what
        # gets stored must still be the constant, not the subclass instance,
        # or a reader of `.scope` gets whatever that instance decides to be.
        class Sneaky(str):
            def __repr__(self):
                return "'everything'"

        signal = PreferenceSignal(
            was=Classification.FYI,
            became=Classification.IMPORTANT,
            observations=1,
            scope=Sneaky(INBOX_SCOPE),
        )
        self.assertIs(type(signal.scope), str)
        self.assertEqual(signal.scope, INBOX_SCOPE)

    def test_applies_to_consults_the_stored_scope_even_if_pinning_failed(self):
        # Defence in depth: pinning makes this unreachable today, so the guard
        # is exercised against an instance whose scope was set behind the
        # constructor's back.
        signal = signals_from(corrections(3))[0]
        object.__setattr__(signal, "scope", "everything")
        self.assertFalse(signal.applies_to(INBOX_SCOPE))
        self.assertFalse(signal.applies_to("everything"))

    def test_the_observation_cap_is_on_the_type_not_only_the_aggregator(self):
        with self.assertRaises(PreferenceRefused):
            PreferenceSignal(
                was=Classification.FYI,
                became=Classification.IMPORTANT,
                observations=10 ** 6,
            )
        at_limit = PreferenceSignal(
            was=Classification.FYI,
            became=Classification.IMPORTANT,
            observations=SIGNAL_HISTORY_LIMIT,
        )
        self.assertEqual(at_limit.observations, SIGNAL_HISTORY_LIMIT)


class BoundaryTests(unittest.TestCase):
    def test_the_declared_graph_still_holds(self):
        from backend.boundaries import all_errors

        self.assertEqual(all_errors(), [])

    def test_the_inbox_does_not_import_the_memory_module(self):
        from pathlib import Path

        from backend.boundaries import imported_names

        path = Path(__file__).resolve().parents[1] / "backend" / "gmail" / "inbox.py"
        for _, name in imported_names(path):
            with self.subTest(imported=name):
                self.assertFalse(name.startswith("backend.memory"))


if __name__ == "__main__":
    unittest.main()
