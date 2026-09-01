"""What the policy engine is asked to decide about.

The manifest names fourteen evaluation inputs. Thirteen of them are here.
**Device trust is deliberately not a field**: it is looked up in the device
directory, because a request that carries its own trust level has not been
checked. Everything a caller can set is a claim; everything the engine looks up
is a fact, and the split has to be visible in the type.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.security.delegation import Delegation
from orion.security.profiles import Profile
from orion.security.signing import Signature
from orion.security.vocabulary import RequestSource, RiskLevel, SecurityState
from orion.shared.identifiers import Identifier


FIELDS = frozenset(
    {
        "request_id",
        "correlation_id",
        "authenticated_user",
        "origin_device",
        "target_device",
        "capability",
        "resource",
        "declared_risk",
        "active_profile",
        "request_source",
        "external_data_involved",
        "issued_at",
        "expires_at",
        "security_state",
    }
)

#: Fields a caller may omit. `delegation` and `signature` are objects rather
#: than scalars and are attached by the caller directly; they are not accepted
#: from a decoded JSON payload at all, so a model-produced object cannot invent
#: a delegation for itself.
OPTIONAL = frozenset({"declared_risk"})


@dataclass(frozen=True, slots=True)
class PolicyRequest:
    request_id: Identifier
    correlation_id: Identifier
    authenticated_user: Identifier | None
    origin_device: Identifier
    target_device: Identifier
    capability: str
    resource: str
    active_profile: Profile
    request_source: RequestSource
    external_data_involved: bool
    issued_at: datetime
    expires_at: datetime
    security_state: SecurityState
    declared_risk: RiskLevel | None = None
    delegation: Delegation | None = None
    signature: Signature | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_id", Identifier(self.request_id))
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        if self.authenticated_user is not None:
            object.__setattr__(self, "authenticated_user", Identifier(self.authenticated_user))
        object.__setattr__(self, "origin_device", Identifier(self.origin_device))
        object.__setattr__(self, "target_device", Identifier(self.target_device))
        if not isinstance(self.capability, str) or not self.capability:
            raise ValueError("capability must be a non-empty string")
        if not isinstance(self.resource, str) or not self.resource or len(self.resource) > 1024:
            raise ValueError("resource must be a non-empty string under 1024 characters")
        object.__setattr__(self, "active_profile", Profile(self.active_profile))
        object.__setattr__(self, "request_source", RequestSource(self.request_source))
        if not isinstance(self.external_data_involved, bool):
            raise ValueError("external_data_involved must be a boolean")
        for field in ("issued_at", "expires_at"):
            value = getattr(self, field)
            if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
                raise ValueError(f"{field} must be a timezone-aware datetime")
            object.__setattr__(self, field, value.astimezone(timezone.utc))
        if self.expires_at <= self.issued_at:
            # Every request expires. A request with no end is a standing
            # permission nobody granted.
            raise ValueError("expires_at must be after issued_at")
        object.__setattr__(self, "security_state", SecurityState(self.security_state))
        if self.declared_risk is not None:
            object.__setattr__(self, "declared_risk", RiskLevel(self.declared_risk))
        if self.delegation is not None and not isinstance(self.delegation, Delegation):
            raise ValueError("delegation must be a Delegation")
        if self.signature is not None and not isinstance(self.signature, Signature):
            raise ValueError("signature must be a Signature")

    @classmethod
    def from_dict(
        cls,
        data: object,
        *,
        delegation: Delegation | None = None,
        signature: Signature | None = None,
    ) -> "PolicyRequest":
        """Decode a request strictly.

        Unknown keys are refused rather than ignored. That is the whole defence
        against a model deciding for itself: a payload carrying `outcome`,
        `allow`, `device_trust` or `override` does not get those fields quietly
        dropped -- it fails to decode, and the caller finds out.
        """

        if not isinstance(data, dict):
            raise ValueError("policy request must be a JSON object")
        unknown = sorted(set(data) - FIELDS)
        missing = sorted(FIELDS - OPTIONAL - set(data))
        if unknown or missing:
            raise ValueError(f"policy request fields mismatch: unknown={unknown} missing={missing}")

        fields: Mapping[str, Any] = data
        user = fields["authenticated_user"]
        return cls(
            request_id=Identifier(fields["request_id"]),
            correlation_id=Identifier(fields["correlation_id"]),
            authenticated_user=None if user is None else Identifier(user),
            origin_device=Identifier(fields["origin_device"]),
            target_device=Identifier(fields["target_device"]),
            capability=fields["capability"],
            resource=fields["resource"],
            active_profile=Profile(fields["active_profile"]),
            request_source=RequestSource(fields["request_source"]),
            external_data_involved=fields["external_data_involved"],
            issued_at=_timestamp(fields["issued_at"], "issued_at"),
            expires_at=_timestamp(fields["expires_at"], "expires_at"),
            security_state=SecurityState(fields["security_state"]),
            declared_risk=(
                None if fields.get("declared_risk") is None else RiskLevel(fields["declared_risk"])
            ),
            delegation=delegation,
            signature=signature,
        )

    def signed_fields(self) -> Mapping[str, str]:
        """Exactly what a signature has to cover.

        Every field that can change the outcome. Leaving one out is how an
        altered request keeps a valid signature -- so `resource` and
        `target_device` are in here, not just the capability name.
        """

        return {
            "request_id": str(self.request_id),
            "capability": self.capability,
            "resource": self.resource,
            "origin_device": str(self.origin_device),
            "target_device": str(self.target_device),
            "authenticated_user": "" if self.authenticated_user is None else str(self.authenticated_user),
            "issued_at": self.issued_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
        }


def _timestamp(value: object, field: str) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(f"{field} must include a timezone")
        return value.astimezone(timezone.utc)
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 string")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"{field} must be a valid ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)
