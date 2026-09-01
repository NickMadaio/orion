"""UUID-based identifiers, generated through something a test can replace.

The manifest asks for UUID-style ids. It does not ask for `uuid4()` scattered
through the code, and that difference matters: a schema whose id rules can only
be exercised with real randomness is a schema whose id rules are believed rather
than known. Generation is injected, the same way `now` is injected everywhere in
Core.

Ids are rendered `<kind>_<32 hex>` so a stray id in a log says what it is. The
prefix is not parsed for authority anywhere -- it is for humans reading an audit
record at two in the morning.
"""

from __future__ import annotations

import uuid
from typing import Callable, Iterator

from orion.shared.identifiers import Identifier


#: Every kind of thing that gets an id. A closed list, because "what is this id"
#: should have an answer and a typo should not silently invent a new kind.
KINDS = (
    "user", "device", "session", "connection", "credential", "webhook",
    "cursor", "conversation", "message", "memory", "task", "estimate",
    "healthstate", "journal", "capability", "grant", "delegation", "job",
    "attempt", "approval", "automation", "run", "notification", "audit",
    "pairing", "migration",
)


def _uuid4_hex() -> str:
    return uuid.uuid4().hex


class IdGenerator:
    """Makes ids. Replaceable, so a test can be deterministic without mocking."""

    def __init__(self, source: Callable[[], str] = _uuid4_hex) -> None:
        self._source = source

    def new(self, kind: str) -> Identifier:
        if kind not in KINDS:
            raise ValueError(f"unknown id kind: {kind}")
        value = self._source()
        if len(value) != 32 or any(character not in "0123456789abcdef" for character in value):
            raise ValueError("an id source must produce 32 lowercase hex characters")
        return Identifier(f"{kind}_{value}")


class SequentialIds:
    """A deterministic source for tests. Never used in production.

    Named for what it is rather than `FakeIds`: the risk with a test double is
    somebody wiring it in by accident, and this name makes that obvious in a
    stack trace.
    """

    def __init__(self, start: int = 1) -> None:
        self._counter: Iterator[int] = iter(range(start, start + 1_000_000))

    def __call__(self) -> str:
        return f"{next(self._counter):032x}"


def kind_of(identifier: str) -> str | None:
    """The kind a rendered id claims to be, or None if it does not say."""

    prefix, separator, remainder = str(identifier).partition("_")
    if not separator or prefix not in KINDS or len(remainder) != 32:
        return None
    return prefix
