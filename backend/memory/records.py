"""A memory item: the manifest's nine fields, all required.

`expires_at` is required and nullable, which sounds contradictory and is not: the
field must be present so somebody had to decide, and `None` is a legitimate
decision for the user class. A memory with no end that nobody chose is a belief
ORION acquired by accident.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Mapping

from backend.memory.classes import MemoryClass, rules_for
from backend.memory.durability import NEVER_DURABLE
from orion.core.context.domains import Domain, Provenance
from orion.shared.result import Sensitivity


FIELDS = frozenset(
    {
        "memory_id", "source", "provenance", "confidence", "sensitivity",
        "created_at", "updated_at", "expires_at", "user_editable",
    }
)


@dataclass(frozen=True, slots=True)
class MemoryItem:
    memory_id: str
    user_id: str
    memory_class: MemoryClass
    domain: Domain
    body: str
    source: str
    provenance: Provenance
    confidence: float
    sensitivity: Sensitivity
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None
    user_editable: bool
    grounds: str | None = None
    observations: int = 1

    def __post_init__(self) -> None:
        for field in ("memory_id", "user_id", "source", "body"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{field} must be a non-empty string")
        object.__setattr__(self, "memory_class", MemoryClass(self.memory_class))
        object.__setattr__(self, "domain", Domain(self.domain))
        object.__setattr__(self, "provenance", Provenance(self.provenance))
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        if not isinstance(self.confidence, (int, float)) or not 0.0 <= float(self.confidence) <= 1.0:
            raise ValueError("confidence is between 0 and 1")
        object.__setattr__(self, "confidence", float(self.confidence))
        for field in ("created_at", "updated_at"):
            object.__setattr__(self, field, _aware(getattr(self, field), field))
        if self.expires_at is not None:
            object.__setattr__(self, "expires_at", _aware(self.expires_at, "expires_at"))
            if self.expires_at <= self.created_at:
                raise ValueError("expires_at must be after created_at")
        elif self.memory_class is not MemoryClass.USER:
            # Only facts about the person may be permanent, and only because a
            # person's name does not expire. Everything else goes stale.
            raise ValueError(f"{self.memory_class.value} memory must expire")
        if rules_for(self.memory_class).durable and self.provenance in NEVER_DURABLE:
            # The manifest rule this module exists for, enforced on the TYPE.
            # It used to live only in MemoryStore.remember, behind
            # `if rules.requires_grounds:` -- and EPISODIC is durable WITHOUT
            # grounds, so untrusted scraped text and ORION's own inferences went
            # straight past it, stayed a year, and came back out of recall().
            # Constructing the record directly, or dataclasses.replace-ing an
            # episodic item into a permanent USER fact, skipped it too.
            raise ValueError(
                f"{self.provenance.value} can never be {self.memory_class.value} memory, "
                f"which is durable"
            )
        if self.domain is Domain.CREDENTIALS:
            raise ValueError("credentials are never memory")
        if not isinstance(self.user_editable, bool):
            raise ValueError("user_editable is a boolean")

    def expired_at(self, now: datetime) -> bool:
        return self.expires_at is not None and _aware(now, "now") >= self.expires_at

    @property
    def durable(self) -> bool:
        return rules_for(self.memory_class).durable

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "MemoryItem":
        """Strictly decoded, the way the sync module already does it.

        The plan's exit criterion is "four classes, nine required fields,
        strictly decoded", and `FIELDS` was a constant shaped exactly like the
        sync module's strictness mechanism with no mechanism behind it: nothing
        imported it, and `backend/memory/` had no decode path at all. An unknown
        key was not rejected because there was nothing to reject it.
        """

        required = FIELDS | {"user_id", "memory_class", "domain", "body"}
        unknown = sorted(set(data) - required)
        missing = sorted(required - set(data) - {"expires_at"})
        if unknown or missing:
            raise ValueError(
                f"memory item fields mismatch: unknown={unknown} missing={missing}"
            )

        def moment(value):
            if value is None or isinstance(value, datetime):
                return value
            text = f"{value[:-1]}+00:00" if str(value).endswith("Z") else str(value)
            return datetime.fromisoformat(text)

        return cls(
            memory_id=data["memory_id"],
            user_id=data["user_id"],
            memory_class=MemoryClass(data["memory_class"]),
            domain=Domain(data["domain"]),
            body=data["body"],
            source=data["source"],
            provenance=Provenance(data["provenance"]),
            sensitivity=Sensitivity(data["sensitivity"]),
            confidence=data["confidence"],
            created_at=moment(data["created_at"]),
            updated_at=moment(data["updated_at"]),
            expires_at=moment(data.get("expires_at")),
            user_editable=data["user_editable"],
        )

    def edited(self, body: str, *, now: datetime) -> "MemoryItem":
        if not self.user_editable:
            raise PermissionError(f"{self.memory_id} is a record of what happened, not a claim to edit")
        if not isinstance(body, str) or not body:
            raise ValueError("an edit needs a body")
        return replace(
            self,
            body=body,
            updated_at=_aware(now, "now"),
            # An edited memory is the user's assertion now, whatever it was
            # before. Keeping the old provenance would let an inference the user
            # corrected stay labelled an inference.
            provenance=Provenance.USER_ASSERTED,
            grounds="explicit_user_assertion",
            confidence=1.0,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "memory_id": self.memory_id,
            "user_id": self.user_id,
            "memory_class": self.memory_class.value,
            "domain": self.domain.value,
            "body": self.body,
            "source": self.source,
            "provenance": self.provenance.value,
            "confidence": self.confidence,
            "sensitivity": self.sensitivity.value,
            "created_at": _render(self.created_at),
            "updated_at": _render(self.updated_at),
            "expires_at": None if self.expires_at is None else _render(self.expires_at),
            "user_editable": self.user_editable,
            "grounds": self.grounds,
            "observations": self.observations,
        }


def _aware(value: object, field: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _render(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
