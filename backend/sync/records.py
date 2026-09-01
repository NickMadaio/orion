"""What travels between a device and the cloud.

`created_at` is here and is metadata: it is what a person is shown, and nothing
sorts by it. `revision` is what conflict resolution uses, because an edit is a
new version of a message rather than a new message, and "which version" is a
question a counter can answer and a clock cannot.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from backend.sync.ordering import Position, display_time


ROLES = ("user", "orion", "system")

FIELDS = frozenset(
    {
        "message_id", "conversation_id", "user_id", "device_id", "sequence",
        "role", "body", "created_at", "revision",
    }
)


@dataclass(frozen=True, slots=True)
class SyncMessage:
    message_id: str
    conversation_id: str
    user_id: str
    device_id: str
    sequence: int
    role: str
    body: str
    created_at: datetime
    revision: int = 1

    def __post_init__(self) -> None:
        for field in ("message_id", "conversation_id", "user_id", "device_id"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{field} must be a non-empty string")
        if self.role not in ROLES:
            raise ValueError(f"role must be one of {list(ROLES)}")
        if type(self.sequence) is not int or self.sequence < 1:
            raise ValueError("a sequence starts at 1")
        if type(self.revision) is not int or self.revision < 1:
            raise ValueError("revisions start at 1")
        object.__setattr__(self, "created_at", display_time(self.created_at))

    @property
    def position(self) -> Position:
        return Position(
            sequence=self.sequence, device_id=self.device_id, message_id=self.message_id
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "message_id": self.message_id,
            "conversation_id": self.conversation_id,
            "user_id": self.user_id,
            "device_id": self.device_id,
            "sequence": self.sequence,
            "role": self.role,
            "body": self.body,
            "created_at": self.created_at.isoformat().replace("+00:00", "Z"),
            "revision": self.revision,
        }

    @classmethod
    def from_dict(cls, data: object) -> "SyncMessage":
        if not isinstance(data, dict):
            raise ValueError("a sync message is a JSON object")
        unknown = sorted(set(data) - FIELDS)
        missing = sorted(FIELDS - set(data) - {"revision"})
        if unknown or missing:
            raise ValueError(f"sync message fields mismatch: unknown={unknown} missing={missing}")
        fields: Mapping[str, Any] = data
        created = fields["created_at"]
        if isinstance(created, str):
            text = f"{created[:-1]}+00:00" if created.endswith("Z") else created
            created = datetime.fromisoformat(text)
        return cls(
            message_id=fields["message_id"],
            conversation_id=fields["conversation_id"],
            user_id=fields["user_id"],
            device_id=fields["device_id"],
            sequence=fields["sequence"],
            role=fields["role"],
            body=fields["body"],
            created_at=created,
            revision=fields.get("revision", 1),
        )


@dataclass(frozen=True, slots=True)
class Conflict:
    """Two versions of one message, and which one the rule chose.

    Recorded rather than swallowed: the person whose edit lost is going to
    notice, and an audit trail that cannot explain why is worse than one that
    says "your other device had a newer revision".
    """

    message_id: str
    kept_revision: int
    kept_device: str
    discarded_revision: int
    discarded_device: str
    reason: str
