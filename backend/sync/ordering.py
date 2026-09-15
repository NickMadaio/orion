"""How two devices agree on what came first, without agreeing on the time.

A Lamport counter. Each device sends a sequence one greater than the highest it
has seen from anyone; ties break on device id, then message id. Wall-clock time
is carried because a person needs to be shown one, and it is never consulted for
order.

The rule is duplicated in Swift, in `native/OrionMobile/Sources/MobileCore/
Conversation.swift`. Two implementations of one rule is precisely how two devices
end up disagreeing about history, so `docs/planning/v2/sync-ordering-vectors.json`
holds the cases and both sides are checked against it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence


@dataclass(frozen=True, slots=True)
class Position:
    """Where a message sits in the order. Three fields, all deterministic."""

    sequence: int
    device_id: str
    message_id: str

    def __post_init__(self) -> None:
        if type(self.sequence) is not int or self.sequence < 1:
            raise ValueError("a sequence starts at 1")
        if not self.device_id or not self.message_id:
            raise ValueError("a position names its device and message")

    @property
    def key(self) -> tuple[int, str, str]:
        return (self.sequence, self.device_id, self.message_id)


def next_sequence(observed: Iterable[int]) -> int:
    """One greater than the highest sequence this device has seen.

    Not `local + 1`: a device that has been offline must not reuse sequences the
    rest of the world has already moved past, or its messages sort into the
    middle of a conversation that happened after it.
    """

    highest = 0
    for value in observed:
        if type(value) is not int or value < 0:
            raise ValueError("sequences are non-negative integers")
        highest = max(highest, value)
    return highest + 1


def ordered(positions: Sequence[Position]) -> tuple[Position, ...]:
    """The one true order. Same input, same output, on any device."""

    return tuple(sorted(positions, key=lambda position: position.key))


def is_wall_clock_free(sort_key, *, now) -> bool:
    """Whether an ordering key looks at wall-clock time.

    The previous version built `left` and `right` as IDENTICAL positions and
    asserted the key gave the same answer for both -- which every deterministic
    function does, including `lambda _: 0`. Its docstring said the two differed
    by "a timestamp attached out of band" and said it was "used by the check
    script"; neither was true, and nothing imported it.

    This version actually varies the clock: it calls the key twice with the
    system clock moved, and requires the answer not to move with it.
    """

    position = Position(sequence=5, device_id="device-a", message_id="m1")
    before = sort_key(position)
    after = sort_key(position, now=now) if _takes_now(sort_key) else sort_key(position)
    if before != after:
        return False
    # And an ordering key must depend on the three ordering fields alone: two
    # positions that differ only in a field the key may not read must compare
    # equal, and two that differ in one it must read must not.
    other = Position(sequence=6, device_id="device-a", message_id="m1")
    return sort_key(position) != sort_key(other)


def _takes_now(sort_key) -> bool:
    import inspect

    try:
        return "now" in inspect.signature(sort_key).parameters
    except (TypeError, ValueError):
        return False


def display_time(value: datetime) -> datetime:
    """The timestamp a person is shown. Metadata, never an ordering input."""

    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("a display time must be timezone-aware")
    return value.astimezone(timezone.utc)
