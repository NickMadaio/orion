"""Publish and subscribe, with the couplings a bus usually hides made explicit.

Three structural rules, each one a way subsystems normally get wired together:

1. `publish()` takes an envelope and no target, so a producer cannot name a
   consumer.
2. A handler receives an envelope and nothing else, so a consumer cannot reach
   back into a producer.
3. `publish()` inside a handler raises. Handlers **return** follow-up events,
   which the bus delivers in a bounded second pass, checked against the cascade
   matrix. Mid-handling publication is how "A causes B" quietly becomes "A
   causes B causes C causes A".

Delivery is synchronous and in registration order, so a test that passes today
passes tomorrow. Nothing here is thread-safe by design; concurrency belongs in
the adapter that owns a runloop, not in a contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Mapping, Sequence

from orion.core.eventbus.categories import Category
from orion.core.eventbus.coupling import MAX_CASCADE_DEPTH, may_cascade, refusal_reason
from orion.core.eventbus.envelope import EventEnvelope
from orion.core.eventbus.types import REGISTRY, EventType
from orion.shared.identifiers import Identifier


Handler = Callable[[EventEnvelope], Sequence[EventEnvelope] | None]


class UnregisteredEvent(ValueError):
    """An event type or version the registry does not know."""


class ReentrantPublish(RuntimeError):
    """A handler tried to publish while the bus was delivering.

    Its own type because the fix is never "retry": the handler should return the
    follow-up instead, which is the difference between a bus and a call graph.
    """


@dataclass(frozen=True, slots=True)
class Subscription:
    name: str
    handler: Handler
    event_types: frozenset[str]
    categories: frozenset[Category]
    versions: frozenset[int]

    def wants(self, envelope: EventEnvelope, event_type: EventType) -> bool:
        if self.versions and envelope.version not in self.versions:
            return False
        if self.event_types and envelope.event_type in self.event_types:
            return True
        if self.categories and event_type.category in self.categories:
            return True
        return not self.event_types and not self.categories


@dataclass(frozen=True, slots=True)
class Failure:
    subscriber: str
    event_id: Identifier
    error: str


@dataclass(frozen=True, slots=True)
class DeliveryReport:
    delivered: tuple[tuple[str, str], ...] = ()
    failures: tuple[Failure, ...] = ()
    published: tuple[str, ...] = ()
    refused_cascades: tuple[str, ...] = ()

    @property
    def clean(self) -> bool:
        return not self.failures and not self.refused_cascades


@dataclass(frozen=True, slots=True)
class _Pending:
    envelope: EventEnvelope
    depth: int


class EventBus:
    def __init__(
        self,
        registry: Mapping[tuple[str, int], EventType] | None = None,
        *,
        max_depth: int = MAX_CASCADE_DEPTH,
    ) -> None:
        self._registry = registry if registry is not None else REGISTRY
        self._subscriptions: list[Subscription] = []
        self._max_depth = int(max_depth)
        self._delivering = False

    def subscribe(
        self,
        name: str,
        handler: Handler,
        *,
        event_types: Iterable[str] = (),
        categories: Iterable[Category] = (),
        versions: Iterable[int] = (),
    ) -> Subscription:
        """Register a consumer.

        A subscriber names event types or categories -- never a producer. There
        is deliberately no way to subscribe to "whatever module X emits".
        """

        if not isinstance(name, str) or not name:
            raise ValueError("a subscriber must be named, so a failure can be attributed")
        if any(existing.name == name for existing in self._subscriptions):
            raise ValueError(f"{name} is already subscribed")
        if not callable(handler):
            raise ValueError("handler must be callable")
        wanted = frozenset(event_types)
        unknown = sorted(item for item in wanted if not any(key[0] == item for key in self._registry))
        if unknown:
            raise UnregisteredEvent(f"{name} subscribed to unregistered types: {unknown}")
        subscription = Subscription(
            name=name,
            handler=handler,
            event_types=wanted,
            categories=frozenset(categories),
            versions=frozenset(versions),
        )
        self._subscriptions.append(subscription)
        return subscription

    def publish(self, envelope: EventEnvelope) -> DeliveryReport:
        if self._delivering:
            raise ReentrantPublish(
                "a handler may not publish; return follow-up events instead"
            )
        self._check(envelope)
        self._delivering = True
        try:
            return self._deliver_all([_Pending(envelope, depth=0)])
        finally:
            self._delivering = False

    def _check(self, envelope: EventEnvelope) -> EventType:
        if not isinstance(envelope, EventEnvelope):
            raise ValueError("publish takes an EventEnvelope")
        event_type = self._registry.get((envelope.event_type, envelope.version))
        if event_type is None:
            raise UnregisteredEvent(f"{envelope.event_type} v{envelope.version} is not registered")
        missing = [key for key in event_type.required_payload if key not in envelope.payload]
        if missing:
            raise ValueError(f"{envelope.event_type} payload is missing {missing}")
        return event_type

    def _deliver_all(self, queue: list[_Pending]) -> DeliveryReport:
        delivered: list[tuple[str, str]] = []
        failures: list[Failure] = []
        published: list[str] = []
        refused: list[str] = []

        while queue:
            pending = queue.pop(0)
            event_type = self._check(pending.envelope)
            published.append(str(pending.envelope.event_id))
            for subscription in list(self._subscriptions):
                if not subscription.wants(pending.envelope, event_type):
                    continue
                try:
                    follow_ups = subscription.handler(pending.envelope) or ()
                except ReentrantPublish:
                    # Isolation protects the publisher from a consumer's BUGS.
                    # It does not protect the bus from a consumer breaking its
                    # contract: a report line is exactly the quiet coupling this
                    # design exists to prevent, so this one is loud.
                    raise
                except Exception as error:  # noqa: BLE001 -- isolation is the point
                    # A publisher that dies because some unrelated consumer threw
                    # is a coupling mechanism wearing a bus's clothes.
                    failures.append(
                        Failure(
                            subscriber=subscription.name,
                            event_id=pending.envelope.event_id,
                            error=f"{type(error).__name__}: {error}",
                        )
                    )
                    continue
                delivered.append((str(pending.envelope.event_id), subscription.name))
                for follow_up in follow_ups:
                    outcome = self._queue_follow_up(
                        follow_up, pending, subscription.name, queue
                    )
                    if outcome is not None:
                        refused.append(outcome)

        return DeliveryReport(
            delivered=tuple(delivered),
            failures=tuple(failures),
            published=tuple(published),
            refused_cascades=tuple(refused),
        )

    def _queue_follow_up(
        self,
        follow_up: object,
        pending: _Pending,
        subscriber: str,
        queue: list[_Pending],
    ) -> str | None:
        if not isinstance(follow_up, EventEnvelope):
            return f"{subscriber} returned something that is not an event"
        try:
            # Validated HERE rather than when it is dequeued. Checking it later
            # would raise out of publish() -- past the per-handler guard, taking
            # the whole delivery report with it -- which is precisely the
            # publisher-dies-because-a-consumer-was-wrong failure isolation
            # exists to prevent.
            self._check(follow_up)
        except (UnregisteredEvent, ValueError) as error:
            return f"{subscriber}: {follow_up.event_type} is not publishable ({error})"
        if pending.depth + 1 > self._max_depth:
            return (
                f"{subscriber}: {follow_up.event_type} exceeded the cascade depth "
                f"of {self._max_depth}"
            )
        source = pending.envelope.category
        if not may_cascade(source, follow_up.category):
            return f"{subscriber}: {refusal_reason(source, follow_up.category)}"
        queue.append(_Pending(envelope=follow_up, depth=pending.depth + 1))
        return None
