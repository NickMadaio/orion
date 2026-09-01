"""Free and busy, computed from events rather than asked for.

Google has a free/busy endpoint, and it answers a narrower question than ORION
needs: it will not say *why* an hour is busy, and Phase 23 has to be able to
tell the person "you are free then, except you declined that meeting". So busy
intervals are derived from the events, and each carries the event that caused it.

The merge is the part that goes wrong quietly. Two meetings that touch at 10:00
are not one two-hour block with a gap; three overlapping meetings are not three
busy intervals. Merging is done once, here, so every caller gets the same answer.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from backend.calendar.events import CalendarRefused, Event


#: Below this a gap is not a slot, it is the walk between two rooms.
DEFAULT_MINIMUM_SLOT = timedelta(minutes=15)


@dataclass(frozen=True, slots=True)
class Interval:
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("start", "end"):
            value = getattr(self, field)
            if not isinstance(value, datetime) or value.tzinfo is None:
                raise CalendarRefused(f"{field} must be an aware datetime")
            set_(self, field, value.astimezone(timezone.utc))
        if self.end <= self.start:
            raise CalendarRefused("an interval ends after it starts")

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    def overlaps(self, other: "Interval") -> bool:
        # Touching is not overlapping: a meeting ending at 10:00 and one
        # starting at 10:00 leave no gap, but they are also not in conflict.
        return self.start < other.end and other.start < self.end


@dataclass(frozen=True, slots=True)
class Busy:
    """A busy interval and the events that made it busy."""

    interval: Interval
    causes: tuple[str, ...]


def busy_intervals(events: Iterable[Event]) -> tuple[Busy, ...]:
    """Merged busy time, with the event ids that caused each block."""

    spans: list[tuple[datetime, datetime, str]] = []
    for event in events:
        if not event.blocks_time():
            continue
        start, end = event.span()
        if end <= start:
            # A zero-length event is a marker, not an occupation.
            continue
        spans.append((start, end, event.event_id))
    if not spans:
        return ()
    spans.sort(key=lambda item: (item[0], item[1]))

    merged: list[tuple[datetime, datetime, list[str]]] = []
    for start, end, event_id in spans:
        if merged and start <= merged[-1][1]:
            previous_start, previous_end, causes = merged[-1]
            merged[-1] = (previous_start, max(previous_end, end), causes + [event_id])
        else:
            merged.append((start, end, [event_id]))
    return tuple(
        Busy(interval=Interval(start=start, end=end), causes=tuple(causes))
        for start, end, causes in merged
    )


def free_slots(
    window: Interval,
    events: Iterable[Event],
    *,
    minimum: timedelta = DEFAULT_MINIMUM_SLOT,
) -> tuple[Interval, ...]:
    """The gaps in `window` that nothing occupies and that are worth offering.

    Busy time outside the window is ignored rather than clipped away
    incorrectly: an event that starts before the window and ends inside it must
    still block the part that is inside, which is what the max/min below does.
    """

    if minimum <= timedelta(0):
        raise CalendarRefused("a minimum slot is a positive length")
    cursor = window.start
    slots: list[Interval] = []
    for busy in busy_intervals(events):
        start = max(busy.interval.start, window.start)
        end = min(busy.interval.end, window.end)
        if end <= start:
            continue
        if start - cursor >= minimum:
            slots.append(Interval(start=cursor, end=start))
        cursor = max(cursor, end)
        if cursor >= window.end:
            break
    if window.end - cursor >= minimum:
        slots.append(Interval(start=cursor, end=window.end))
    return tuple(slots)


def is_free(window: Interval, events: Iterable[Event]) -> bool:
    """Whether the whole window is free."""

    return not any(
        busy.interval.overlaps(window) for busy in busy_intervals(events)
    )


def conflicts(candidate: Interval, events: Sequence[Event]) -> tuple[Event, ...]:
    """Which events a proposed interval would collide with.

    Phase 25 needs this before it may show a preview, and Phase 23 needs it to
    explain a refusal. Returning the events rather than a boolean is what makes
    "you already have X then" possible.
    """

    hits: list[Event] = []
    for event in events:
        if not event.blocks_time():
            continue
        start, end = event.span()
        if end <= start:
            continue
        if Interval(start=start, end=end).overlaps(candidate):
            hits.append(event)
    return tuple(hits)
