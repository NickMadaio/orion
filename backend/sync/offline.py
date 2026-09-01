"""The outbox, and what a device is allowed to keep while it is away.

Two separate concerns that both show up when the network does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from types import MappingProxyType
from typing import Mapping

from backend.sync.records import SyncMessage


class OfflineQueue:
    """Changes made while offline, replayed in order on reconnect.

    Idempotent by message id, because a queue that guarantees exactly-once
    delivery does not exist: this one may deliver twice and the engine does not
    care, which is a cheaper property than the one that does not exist.
    """

    def __init__(self) -> None:
        self._pending: list[SyncMessage] = []
        self._delivered: set[str] = set()

    def enqueue(self, message: SyncMessage) -> bool:
        if any(item.message_id == message.message_id for item in self._pending):
            # An edit while still queued replaces rather than queueing twice.
            self._pending = [
                message if item.message_id == message.message_id else item
                for item in self._pending
            ]
            return False
        self._pending.append(message)
        return True

    def drain(self) -> tuple[SyncMessage, ...]:
        """What to send, oldest first. Nothing is removed until it is acknowledged."""

        return tuple(self._pending)

    def acknowledge(self, message_ids: tuple[str, ...]) -> int:
        """Remove exactly what was acknowledged, and nothing else.

        This used to add the ids to a cumulative `_delivered` set and then filter
        the WHOLE pending list against it. So once an id had ever been
        acknowledged, re-queueing it -- a user editing a synced message while
        offline -- meant the next acknowledge of anything deleted the edit. Even
        `acknowledge(())` deleted it. The correction was dropped from the outbox
        and never sent, silently, on exactly the path this class exists for.
        """

        acknowledged = {str(item) for item in message_ids}
        # `_delivered` is a RECORD, for was_delivered(). It must never be used to
        # filter `_pending`, which is what made a re-queued edit disappear.
        self._delivered.update(acknowledged)
        before = len(self._pending)
        self._pending = [item for item in self._pending if item.message_id not in acknowledged]
        return before - len(self._pending)

    @property
    def depth(self) -> int:
        return len(self._pending)

    def was_delivered(self, message_id: str) -> bool:
        return message_id in self._delivered


@dataclass(frozen=True, slots=True)
class CacheRule:
    cacheable: bool
    encrypted: bool
    ttl: timedelta | None
    reason: str


#: What a device may keep locally. Declared rather than habitual: "keep local
#: caching minimal and encrypted where necessary" is a decision per field, and
#: the fields that must never be cached are the point.
CACHE_POLICY: Mapping[str, CacheRule] = MappingProxyType(
    {
        "message_body": CacheRule(
            True, encrypted=True, ttl=timedelta(days=30),
            reason="a conversation you cannot read offline is not much of a conversation",
        ),
        "message_metadata": CacheRule(
            True, encrypted=False, ttl=timedelta(days=90),
            reason="ids and sequences carry nothing private and are what ordering needs",
        ),
        "conversation_titles": CacheRule(
            True, encrypted=True, ttl=timedelta(days=90),
            reason="a title is often the most revealing line in a thread",
        ),
        "pending_approvals": CacheRule(
            False, encrypted=False, ttl=None,
            reason="an approval decided against a stale copy is an approval of something else",
        ),
        "credentials": CacheRule(
            False, encrypted=False, ttl=None,
            reason="never; the vault holds these and hands out brief borrows",
        ),
        "health_state": CacheRule(
            False, encrypted=False, ttl=None,
            reason="Phase 33's health privacy firewall decides this, not a cache policy",
        ),
    }
)


def may_cache(field: str) -> bool:
    rule = CACHE_POLICY.get(field)
    if rule is None:
        # A field nobody classified is not cached. Forgetting to think about a
        # field must not grant it durability on a device somebody might lose.
        return False
    return rule.cacheable


def requires_encryption(field: str) -> bool:
    rule = CACHE_POLICY.get(field)
    return bool(rule and rule.cacheable and rule.encrypted)
