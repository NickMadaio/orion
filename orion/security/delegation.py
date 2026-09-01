"""A delegated grant: authority handed to something else, narrowed on the way.

The manifest lists delegation as an evaluation input and Phase 50 builds
delegated policies on top of it. The rule that matters is the one that is easy
to get wrong: a delegation may narrow what its delegator can do and may never
widen it. Encoded here so a later phase inherits the constraint instead of
re-deciding it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from orion.security.profiles import Profile, narrower_of
from orion.security.vocabulary import RiskLevel, at_most
from orion.shared.identifiers import Identifier


@dataclass(frozen=True, slots=True)
class Delegation:
    delegation_id: Identifier
    delegator_id: Identifier
    delegate_id: Identifier
    capabilities: tuple[str, ...]
    max_risk: RiskLevel
    profile: Profile
    expires_at: datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "delegation_id", Identifier(self.delegation_id))
        object.__setattr__(self, "delegator_id", Identifier(self.delegator_id))
        object.__setattr__(self, "delegate_id", Identifier(self.delegate_id))
        if not isinstance(self.capabilities, tuple) or not self.capabilities:
            raise ValueError("a delegation must name at least one capability")
        if not all(isinstance(item, str) and item for item in self.capabilities):
            raise ValueError("delegated capability names must be non-empty strings")
        object.__setattr__(self, "max_risk", RiskLevel(self.max_risk))
        object.__setattr__(self, "profile", Profile(self.profile))
        if (
            not isinstance(self.expires_at, datetime)
            or self.expires_at.tzinfo is None
            or self.expires_at.utcoffset() is None
        ):
            raise ValueError("a delegation must expire, with a timezone")
        object.__setattr__(self, "expires_at", self.expires_at.astimezone(timezone.utc))

    def covers(self, capability: str) -> bool:
        return capability in self.capabilities

    def expired_at(self, instant: datetime) -> bool:
        return instant >= self.expires_at

    def permits_risk(self, level: RiskLevel) -> bool:
        return at_most(level, self.max_risk)

    def effective_profile(self, active: Profile) -> Profile:
        """The profile that actually applies while acting under this delegation.

        Always the narrower of the two. A delegation naming a higher profile
        than the one currently active does not raise it; it is capped, silently
        from the delegate's point of view and visibly in the decision's reasons.
        """

        return narrower_of(active, self.profile)
