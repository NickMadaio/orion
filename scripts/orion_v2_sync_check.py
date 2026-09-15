#!/usr/bin/env python3
"""Prove both implementations of the ordering rule still agree.

The rule lives twice -- `backend/sync/ordering.py` and MobileCore's
`Conversation.swift` -- because the server and the phone both have to sort a
conversation without asking each other. Two implementations of one rule is
exactly how two devices end up disagreeing about history, which is the failure
Phase 17 exists to prevent.

`docs/planning/v2/sync-ordering-vectors.json` holds cases whose expected order was
written BY HAND. Generating them from either implementation would make them agree
with whatever the code does, including if what it does is wrong.

This script checks the Python side and the properties that cannot be expressed as
a vector. `scripts/orion_v2_mobile_check.sh` checks the Swift side against the
same file.

Read-only. Exit 0 when they agree, 1 otherwise.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.sync.engine import SyncEngine  # noqa: E402
from backend.sync.offline import CACHE_POLICY, may_cache  # noqa: E402
from backend.sync.ordering import Position, ordered  # noqa: E402
from backend.sync.records import SyncMessage  # noqa: E402

VECTORS = REPO_ROOT / "docs" / "planning" / "v2" / "sync-ordering-vectors.json"
SWIFT_SOURCE = (
    REPO_ROOT / "native" / "OrionMobile" / "Sources" / "MobileCore" / "Conversation.swift"
)
NOW = datetime(2026, 8, 25, 16, 0, tzinfo=timezone.utc)


def main() -> int:
    failures: list[str] = []
    document = json.loads(VECTORS.read_text(encoding="utf-8"))
    cases = document["cases"]

    for case in cases:
        positions = [
            Position(sequence=item["sequence"], device_id=item["device_id"],
                     message_id=item["message_id"])
            for item in case["input"]
        ]
        actual = [position.message_id for position in ordered(positions)]
        if actual != case["expected_order"]:
            failures.append(
                f"vector '{case['name']}': python ordered {actual}, expected {case['expected_order']}"
            )

    # The property no vector can express: the same messages, shuffled, sort the
    # same way. A rule that depends on arrival order passes every fixed vector.
    shuffled = [
        Position(sequence=3, device_id="mac", message_id="c"),
        Position(sequence=1, device_id="phone", message_id="a"),
        Position(sequence=3, device_id="iphone", message_id="b"),
    ]
    first = [item.message_id for item in ordered(shuffled)]
    second = [item.message_id for item in ordered(list(reversed(shuffled)))]
    if first != second:
        failures.append(f"ordering depends on input order: {first} vs {second}")

    # And the one the manifest states outright: no wall clock.
    early = SyncMessage(message_id="m1", conversation_id="c", user_id="u", device_id="phone",
                        sequence=2, role="user", body="x", created_at=NOW)
    late = SyncMessage(message_id="m2", conversation_id="c", user_id="u", device_id="phone",
                       sequence=1, role="user", body="y", created_at=NOW - timedelta(hours=5))
    engine = SyncEngine()
    engine.ingest("u", [early, late])
    if [message.message_id for message in engine.conversation("u", "c")] != ["m2", "m1"]:
        failures.append("ordering followed the clock instead of the sequence")

    # The Swift side must still be reading these vectors at all.
    swift = SWIFT_SOURCE.read_text(encoding="utf-8")
    for fragment in (
        "left.sequence < right.sequence",
        "left.deviceID < right.deviceID",
        # The third tiebreak was never grepped for, so it could be dropped here
        # without this check noticing.
        "left.id < right.id",
    ):
        if fragment not in swift:
            failures.append(
                f"MobileCore's Conversation.swift no longer contains `{fragment}`"
            )

    uncached = sorted(name for name in CACHE_POLICY if not may_cache(name))
    # State the COUNT unconditionally and the VERDICT only below, after the
    # failure list. This line used to assert "python and the rule agree" before
    # anything had been decided, so a failing run printed "agree" and then
    # "FAIL (2)" -- and "agree" is the line a human skims.
    print(f"sync check: {len(cases)} shared ordering vectors compared")
    print(f"sync check: {len(CACHE_POLICY)} cache rules; never cached: {uncached}")
    print("sync check: an unclassified field is not cacheable" if not may_cache("something_new")
          else "sync check: WARNING an unclassified field was cacheable")

    if failures:
        print(f"sync check: FAIL ({len(failures)})")
        for line in failures:
            print(f"  {line}")
        return 1
    print("sync check: OK -- one ordering rule, two implementations, same answer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
