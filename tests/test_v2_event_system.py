"""Phase 7: the event envelope, the type registry, and the bus.

The interesting requirement is not the nine fields -- it is "keep event producers
separate from event consumers, do not directly couple unrelated systems", which
is a property of the wiring. Most of these tests are about that.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from orion.core.eventbus.bus import (
    DeliveryReport,
    EventBus,
    ReentrantPublish,
    UnregisteredEvent,
)
from orion.core.eventbus.categories import Category, DEFAULT_SENSITIVITY, floor_for
from orion.core.eventbus.coupling import (
    CASCADES,
    MAX_CASCADE_DEPTH,
    REASONS,
    cascade_reason,
    may_cascade,
)
from orion.core.eventbus.envelope import (
    FIELDS,
    CredentialInPayload,
    EventEnvelope,
)
from orion.core.eventbus.types import REGISTRY, in_category, registered, versions_of
from orion.shared.result import Sensitivity


NOW = datetime(2026, 8, 24, 21, 0, tzinfo=timezone.utc)
KEY = "sk-abcdefghijklmnopqrstuvwxyz012345"

PAYLOADS = {
    "tasks.created": {"task_id": "t1"},
    "tasks.completed": {"task_id": "t1"},
    "notifications.raised": {"notification_id": "n1"},
    "health.state_changed": {"day": "2026-08-24"},
    "memory.item_written": {"item_id": "m1"},
    "security.policy_decided": {"outcome": "ALLOW", "capability": "device.status.read"},
}


def envelope(event_type="tasks.created", *, event_id="event-0001-aaaa", version=1, payload=None, **overrides):
    fields = {
        "event_id": event_id,
        "event_type": event_type,
        "version": version,
        "user_id": "user-nick-0001",
        "source": "orion.tasks",
        "occurred_at": NOW,
        "sensitivity": REGISTRY[(event_type, 1)].sensitivity if (event_type, 1) in REGISTRY else Sensitivity.INTERNAL,
        "correlation_id": "correlation-0001",
        "payload": payload if payload is not None else PAYLOADS.get(event_type, {"task_id": "t1"}),
    }
    fields.update(overrides)
    return EventEnvelope(**fields)


class EnvelopeTests(unittest.TestCase):
    def test_the_nine_fields_are_all_present_and_required(self):
        self.assertEqual(
            FIELDS,
            {
                "event_id", "event_type", "version", "user_id", "source",
                "occurred_at", "sensitivity", "correlation_id", "payload",
            },
        )
        self.assertEqual(set(envelope().to_dict()), FIELDS)

    def test_decoding_is_strict_in_both_directions(self):
        rendered = envelope().to_dict()
        with self.assertRaises(ValueError):
            EventEnvelope.from_dict({**rendered, "extra": 1})
        with self.assertRaises(ValueError):
            EventEnvelope.from_dict({key: value for key, value in rendered.items() if key != "source"})

    def test_a_round_trip_is_lossless(self):
        original = envelope()
        self.assertEqual(EventEnvelope.from_dict(original.to_dict()), original)

    def test_the_category_comes_from_the_type_not_from_a_field(self):
        # A separate category field is a field that can disagree with the name.
        self.assertIs(envelope("health.state_changed").category, Category.HEALTH)
        self.assertNotIn("category", FIELDS)

    def test_an_event_may_not_be_less_sensitive_than_its_category(self):
        with self.assertRaises(ValueError):
            envelope("health.state_changed", sensitivity=Sensitivity.INTERNAL)

    def test_every_category_has_a_declared_sensitivity_floor(self):
        for category in Category:
            self.assertIsInstance(floor_for(category), Sensitivity)
        self.assertEqual(set(DEFAULT_SENSITIVITY), set(Category))

    def test_a_payload_with_a_credential_is_refused_not_redacted(self):
        # Phase 6 redacts because an audit record must be written anyway. An
        # event carrying a credential is a defect at the producer.
        with self.assertRaises(CredentialInPayload):
            envelope(payload={"task_id": "t1", "note": KEY})
        with self.assertRaises(CredentialInPayload):
            envelope(payload={"task_id": "t1", "access_token": "anything"})

    def test_a_credential_nested_deep_in_a_payload_is_still_refused(self):
        with self.assertRaises(CredentialInPayload):
            envelope(payload={"task_id": "t1", "steps": [{"detail": {"secret": "x"}}]})

    def test_timestamps_must_carry_a_timezone(self):
        with self.assertRaises(ValueError):
            envelope(occurred_at=datetime(2026, 8, 24, 21, 0))

    def test_event_types_must_be_dotted_and_lowercase(self):
        for bad in ("Tasks.Created", "tasks", "tasks.created.extra.deep", "tasks-created"):
            with self.assertRaises(ValueError, msg=bad):
                envelope(bad)


class TypeRegistryTests(unittest.TestCase):
    def test_every_category_has_at_least_one_registered_type(self):
        for category in Category:
            self.assertTrue(in_category(category), category)

    def test_every_type_is_versioned_and_explained(self):
        for (name, version), entry in REGISTRY.items():
            self.assertGreaterEqual(version, 1, name)
            self.assertTrue(entry.description.endswith("."), name)
            self.assertTrue(entry.required_payload, name)

    def test_lookup_answers_by_name_and_version(self):
        self.assertIsNotNone(registered("tasks.created", 1))
        self.assertIsNone(registered("tasks.created", 2))
        self.assertEqual(versions_of("tasks.created"), (1,))


class CouplingMatrixTests(unittest.TestCase):
    def test_every_allowance_carries_a_reason(self):
        for source, targets in CASCADES.items():
            for target in targets:
                self.assertIn((source, target), REASONS, f"{source.value}->{target.value}")
                self.assertTrue(cascade_reason(source, target))

    def test_a_subsystem_may_always_follow_up_within_itself(self):
        for category in Category:
            self.assertTrue(may_cascade(category, category))

    def test_health_reaches_only_notifications(self):
        # Phase 38 makes planning health-aware by having the PLANNER consume
        # health events, not by health emitting task events.
        self.assertEqual(CASCADES[Category.HEALTH], frozenset({Category.NOTIFICATIONS}))

    def test_notifications_are_terminal(self):
        self.assertEqual(CASCADES[Category.NOTIFICATIONS], frozenset())

    def test_an_unlisted_pair_is_denied(self):
        self.assertFalse(may_cascade(Category.EMAIL, Category.HEALTH))
        self.assertIsNone(cascade_reason(Category.EMAIL, Category.HEALTH))


class BusTests(unittest.TestCase):
    def setUp(self):
        self.bus = EventBus()
        self.seen: list[str] = []

    def record(self, event):
        self.seen.append(event.event_type)
        return None

    def test_an_unregistered_type_or_version_cannot_be_published(self):
        with self.assertRaises(UnregisteredEvent):
            self.bus.publish(envelope(version=9))

    def test_a_payload_missing_a_required_key_cannot_be_published(self):
        with self.assertRaises(ValueError):
            self.bus.publish(envelope(payload={"unrelated": "value"}))

    def test_subscribers_are_called_in_registration_order(self):
        order: list[str] = []
        for name in ("first", "second", "third"):
            self.bus.subscribe(name, lambda event, name=name: order.append(name) or None)
        self.bus.publish(envelope())
        self.assertEqual(order, ["first", "second", "third"])

    def test_a_subscriber_filters_by_type_category_and_version(self):
        self.bus.subscribe("by_type", self.record, event_types=["tasks.completed"])
        self.bus.subscribe("by_category", self.record, categories=[Category.TASKS])
        self.bus.subscribe("by_version", self.record, versions=[2])
        report = self.bus.publish(envelope("tasks.created"))
        self.assertEqual([name for _, name in report.delivered], ["by_category"])

    def test_a_subscription_to_an_unregistered_type_is_refused(self):
        with self.assertRaises(UnregisteredEvent):
            self.bus.subscribe("wishful", self.record, event_types=["tasks.imagined"])

    def test_a_failing_subscriber_affects_neither_publisher_nor_others(self):
        def explode(event):
            raise RuntimeError("consumer bug")

        self.bus.subscribe("boom", explode, categories=[Category.TASKS])
        self.bus.subscribe("fine", self.record, categories=[Category.TASKS])
        report = self.bus.publish(envelope())
        self.assertEqual(self.seen, ["tasks.created"])
        self.assertEqual([failure.subscriber for failure in report.failures], ["boom"])
        self.assertFalse(report.clean)

    def test_a_handler_may_not_publish(self):
        self.bus.subscribe(
            "reentrant",
            lambda event: self.bus.publish(envelope(event_id="event-0002-aaaa")),
            categories=[Category.TASKS],
        )
        with self.assertRaises(ReentrantPublish):
            self.bus.publish(envelope())

    def test_the_bus_still_works_after_a_contract_violation(self):
        self.bus.subscribe(
            "reentrant",
            lambda event: self.bus.publish(envelope(event_id="event-0002-aaaa")),
            categories=[Category.NOTIFICATIONS],
        )
        self.bus.subscribe("fine", self.record, categories=[Category.TASKS])
        self.bus.publish(envelope())
        self.assertEqual(self.seen, ["tasks.created"])

    def test_an_allowed_follow_up_is_delivered(self):
        self.bus.subscribe(
            "notifier",
            lambda event: [envelope("notifications.raised", event_id="event-0002-aaaa")],
            categories=[Category.TASKS],
        )
        self.bus.subscribe("watcher", self.record, categories=[Category.NOTIFICATIONS])
        report = self.bus.publish(envelope())
        self.assertEqual(self.seen, ["notifications.raised"])
        self.assertEqual(len(report.published), 2)
        self.assertTrue(report.clean)

    def test_a_refused_cascade_is_reported_and_not_delivered(self):
        self.bus.subscribe(
            "leaker",
            lambda event: [envelope("health.state_changed", event_id="event-0003-aaaa")],
            categories=[Category.TASKS],
        )
        self.bus.subscribe("health_watcher", self.record, categories=[Category.HEALTH])
        report = self.bus.publish(envelope())
        self.assertEqual(self.seen, [])
        self.assertEqual(len(report.refused_cascades), 1)
        self.assertIn("may not cause a health event", report.refused_cascades[0])

    def test_a_cascade_is_bounded(self):
        def forever(event):
            return [envelope("tasks.completed", event_id="event-0004-aaaa")]

        self.bus.subscribe("looper", forever, categories=[Category.TASKS])
        report = self.bus.publish(envelope())
        self.assertLessEqual(len(report.published), MAX_CASCADE_DEPTH + 1)
        self.assertTrue(any("cascade depth" in line for line in report.refused_cascades))

    def test_a_handler_returning_something_that_is_not_an_event_is_reported(self):
        self.bus.subscribe("confused", lambda event: ["not an event"], categories=[Category.TASKS])
        report = self.bus.publish(envelope())
        self.assertIn("not an event", report.refused_cascades[0])

    def test_there_is_no_api_by_which_a_producer_names_a_consumer(self):
        # The structural half of "keep producers separate from consumers": if a
        # publish call could name a target, everything else here is decoration.
        self.assertEqual(
            [name for name in EventBus.publish.__code__.co_varnames[: EventBus.publish.__code__.co_argcount]],
            ["self", "envelope"],
        )
        self.assertNotIn("target", EventBus.subscribe.__code__.co_varnames)

    def test_a_subscriber_must_be_named_and_unique(self):
        self.bus.subscribe("named", self.record)
        with self.assertRaises(ValueError):
            self.bus.subscribe("named", self.record)
        with self.assertRaises(ValueError):
            self.bus.subscribe("", self.record)

    def test_a_delivery_report_is_clean_only_when_nothing_went_wrong(self):
        self.assertTrue(DeliveryReport().clean)


if __name__ == "__main__":
    unittest.main()
