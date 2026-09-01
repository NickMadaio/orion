"""The server side: ingest, order, resolve, and answer "what did I miss".

Everything here is idempotent by message id. A sync protocol whose correctness
depends on each message arriving exactly once is a protocol that has not met a
mobile network -- the queue will deliver twice, and the engine must not care.
"""

from __future__ import annotations

import base64
import json

from dataclasses import dataclass, replace
from typing import Iterable, Mapping

from backend.sync.ordering import Position, next_sequence, ordered
from backend.sync.records import Conflict, SyncMessage


@dataclass(frozen=True, slots=True)
class IngestResult:
    accepted: tuple[str, ...]
    duplicates: tuple[str, ...]
    conflicts: tuple[Conflict, ...]

    @property
    def changed(self) -> bool:
        return bool(self.accepted or self.conflicts)


@dataclass(frozen=True, slots=True)
class Delta:
    """What a reconnecting device missed, and where it is now."""

    messages: tuple[SyncMessage, ...]
    cursor: str

    @property
    def empty(self) -> bool:
        return not self.messages


def _encode_cursor(fields: dict[str, object]) -> str:
    raw = json.dumps(fields, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_cursor(cursor: str) -> dict[str, object]:
    try:
        fields = json.loads(base64.urlsafe_b64decode(str(cursor).encode("ascii")))
    except Exception:
        raise ValueError("that is not a cursor this engine issued") from None
    if not isinstance(fields, dict) or not isinstance(fields.get("v"), int):
        raise ValueError("a cursor carries the write version it stopped at")
    return fields


class SyncEngine:
    """One conversation store, owner-scoped, with the ordering rule applied once."""

    def __init__(self) -> None:
        self._messages: dict[tuple[str, str], SyncMessage] = {}
        self._conflicts: list[Conflict] = []
        # A monotonic write counter, and the write at which each message last
        # CHANGED. A cursor made of ordering fields alone can only express "what
        # was appended after this point": a revision does not move a message's
        # position, so every edit made while a device was away was invisible to
        # it forever. Versioning the writes is what makes `since` mean "what
        # changed", which is what a reconnecting device actually needs.
        self._version = 0
        self._versions: dict[tuple[str, str], int] = {}

    def _stamp(self, user_id: str, message_id: str) -> None:
        self._version += 1
        self._versions[(user_id, message_id)] = self._version

    # -- writing -----------------------------------------------------------

    def ingest(self, user_id: str, messages: Iterable[SyncMessage]) -> IngestResult:
        accepted: list[str] = []
        duplicates: list[str] = []
        conflicts: list[Conflict] = []

        # Validate the whole batch before applying any of it. This used to raise
        # PermissionError partway through with earlier messages already stored,
        # so a replayed batch was partially applied and the caller had no way to
        # know how far it got.
        batch = list(messages)
        for message in batch:
            if message.user_id != user_id:
                raise PermissionError(f"{message.message_id} belongs to another user")

        for message in batch:
            key = (user_id, message.message_id)
            existing = self._messages.get(key)
            if existing is None:
                self._messages[key] = message
                self._stamp(user_id, message.message_id)
                accepted.append(message.message_id)
                continue
            if existing == message:
                # The ordinary case on a flaky link: the same message again.
                duplicates.append(message.message_id)
                continue
            if message.sequence != existing.sequence:
                # An edit changes what a message SAYS, never where it happened.
                # A rev-2 edit carrying a different sequence used to be stored
                # wholesale, silently moving the message in history. The device
                # id may legitimately differ -- that is the two-device race that
                # _resolve exists for -- but the sequence may not.
                raise ValueError(
                    f"{message.message_id} cannot change its position in history"
                )
            winner, conflict = self._resolve(existing, message)
            self._messages[key] = winner
            self._stamp(user_id, message.message_id)
            if conflict is not None:
                conflicts.append(conflict)
                self._conflicts.append(conflict)
            if winner is message:
                accepted.append(message.message_id)
            else:
                duplicates.append(message.message_id)

        return IngestResult(tuple(accepted), tuple(duplicates), tuple(conflicts))

    @staticmethod
    def _resolve(existing: SyncMessage, incoming: SyncMessage) -> tuple[SyncMessage, Conflict | None]:
        """Higher revision wins; equal revisions break on device id.

        Deterministic on purpose: every device runs this and must pick the same
        winner. Last-write-wins by timestamp would be the thing the manifest
        forbids, wearing a different hat.
        """

        if incoming.revision > existing.revision:
            winner, loser, reason = incoming, existing, "a higher revision arrived"
        elif incoming.revision < existing.revision:
            winner, loser, reason = existing, incoming, "an older revision arrived late"
        elif incoming.device_id == existing.device_id:
            # Same revision, same device, different content. This used to take
            # the later arrival and return no conflict -- which is arrival-order
            # dependent and silent, so two engines receiving the same two
            # versions in different orders diverged permanently with
            # `conflicts == ()`. Nothing forces a client to bump `revision` on an
            # edit, so this is reachable from ordinary use, and it is exactly the
            # failure this phase says it prevents. Resolve it deterministically
            # on content and RECORD it.
            ordered_pair = sorted([existing, incoming], key=lambda item: item.body)
            winner, loser = ordered_pair[0], ordered_pair[1]
            reason = "same revision and device with different content; resolved on content"
        else:
            ordered_pair = sorted([existing, incoming], key=lambda item: item.device_id)
            winner, loser = ordered_pair[0], ordered_pair[1]
            reason = "same revision from two devices; the lower device id wins"
        return winner, Conflict(
            message_id=existing.message_id,
            kept_revision=winner.revision,
            kept_device=winner.device_id,
            discarded_revision=loser.revision,
            discarded_device=loser.device_id,
            reason=reason,
        )

    # -- reading -----------------------------------------------------------

    def conversation(self, user_id: str, conversation_id: str) -> tuple[SyncMessage, ...]:
        mine = [
            message for (owner, _), message in self._messages.items()
            if owner == user_id and message.conversation_id == conversation_id
        ]
        by_position: Mapping[tuple[int, str, str], SyncMessage] = {
            message.position.key: message for message in mine
        }
        return tuple(by_position[position.key] for position in ordered([m.position for m in mine]))

    def cursor_for(self, user_id: str, conversation_id: str) -> str:
        """An opaque marker for "everything I have seen up to here".

        It carries the WRITE VERSION, not a position. A position can only say
        what was appended after a point; a revision does not move a message's
        position, so an edit made while a device was away could never come back
        through `since`. It also carries the position, for a human reading a log.

        Encoded rather than delimited. The previous format was
        `<sequence>|<device>|<message>` parsed with `split("|", 2)`, and nothing
        forbids `|` in a device id -- so a device called "mac|home" produced a
        cursor that parsed back wrong and was handed the message it already had.
        """

        messages = self.conversation(user_id, conversation_id)
        seen = max(
            (self._versions.get((user_id, item.message_id), 0) for item in messages),
            default=0,
        )
        last = messages[-1].position if messages else None
        return _encode_cursor(
            {
                "v": seen,
                "s": last.sequence if last else 0,
                "d": last.device_id if last else "",
                "m": last.message_id if last else "",
            }
        )

    def since(self, user_id: str, conversation_id: str, cursor: str) -> Delta:
        """Exactly what a device missed -- appended OR edited.

        A week away is not a year of history, and it is also not a year of
        history minus every correction made during it.
        """

        after = _decode_cursor(cursor)["v"]
        messages = tuple(
            message for message in self.conversation(user_id, conversation_id)
            if self._versions.get((user_id, message.message_id), 0) > after
        )
        return Delta(messages=messages, cursor=self.cursor_for(user_id, conversation_id))

    def next_sequence_for(self, user_id: str, conversation_id: str) -> int:
        return next_sequence(
            message.sequence for message in self.conversation(user_id, conversation_id)
        )

    @property
    def conflicts(self) -> tuple[Conflict, ...]:
        return tuple(self._conflicts)
