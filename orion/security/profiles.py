"""The five live permission profiles, mirrored where a decision can use them.

`permissions.ts` stays the authoritative gate on the live route. This is the
same rule set expressed where the policy engine can evaluate it, and
`scripts/orion_v2_policy_check.py` compares the two set-for-set every run -- a
mirror nobody checks is just a second opinion waiting to disagree.
"""

from __future__ import annotations

from enum import Enum
from types import MappingProxyType
from typing import Mapping

from orion.security.vocabulary import RiskLevel


class Profile(str, Enum):
    """In ladder order, least to most authority."""

    RESTRICTED_READ_ONLY = "restricted_read_only"
    APPROVED_ROOT_EDIT = "approved_root_edit"
    BROAD_LOCAL_FILESYSTEM = "broad_local_filesystem"
    CONSEQUENTIAL_LOCAL = "consequential_local"
    EXTERNAL_CONNECTED = "external_connected"

    @property
    def rung(self) -> int:
        return PROFILE_LADDER.index(self)


PROFILE_LADDER: tuple[Profile, ...] = (
    Profile.RESTRICTED_READ_ONLY,
    Profile.APPROVED_ROOT_EDIT,
    Profile.BROAD_LOCAL_FILESYSTEM,
    Profile.CONSEQUENTIAL_LOCAL,
    Profile.EXTERNAL_CONNECTED,
)

#: Reading, browsing, media, and the ambient answers. The destructive
#: `file_mutate` tier is deliberately NOT here -- move, rename and delete require
#: raising the profile on purpose.
EDIT_TIERS = frozenset(
    {
        "simulation",
        "app_control",
        "browser_control",
        "media_control",
        "desktop_read",
        "home_read",
        "test_workspace",
        "scratch_workspace",
        "desktop_test_workspace",
        "desktop_modify",
        "desktop_direct_write",
        "scratch_direct_write",
        "ambient_info",
        "reminders",
        "self_tuning",
        "health_tracking",
        "messages_read",
        # Added 2026-09-04, mirroring permissions.ts. These three write one
        # JSON file Orion owns, or only read: the waiting list, trips, and the
        # prep card that assembles mail and calendar without keeping any of it.
        "waiting_on",
        "prep",
        "travel",
    }
)

#: Self-modification and the repair surfaces are listed one by one rather than
#: folded into EDIT_TIERS, for the reason `permissions.ts` gives: none of them is
#: a filesystem operation, and none may arrive as a side effect of widening
#: filesystem access.
CONSEQUENTIAL_TIERS = EDIT_TIERS | {
    "file_mutate",
    "self_modification",
    "self_plugin",
    "self_scripts",
    "self_config",
    # Added 2026-09-04, and listed here by name rather than folded into
    # EDIT_TIERS for exactly the reason the comment above gives: running a
    # repository's build executes code out of that repository, and proposing
    # an automation decides what runs unattended later. Neither is a filesystem
    # operation and neither may arrive by widening filesystem access.
    "dev_operations",
    "automation",
    "calendar",
}

PROFILE_TIERS: Mapping[Profile, frozenset[str]] = MappingProxyType(
    {
        Profile.RESTRICTED_READ_ONLY: frozenset({"simulation", "desktop_read", "ambient_info"}),
        Profile.APPROVED_ROOT_EDIT: EDIT_TIERS,
        Profile.BROAD_LOCAL_FILESYSTEM: EDIT_TIERS,
        Profile.CONSEQUENTIAL_LOCAL: frozenset(CONSEQUENTIAL_TIERS),
        Profile.EXTERNAL_CONNECTED: frozenset(CONSEQUENTIAL_TIERS | {"messages_send"}),
    }
)

#: The highest risk level each profile can currently reach, measured across the
#: live registry on 2026-08-23 rather than chosen.
#:
#: A ceiling equal to the observed maximum grants nothing new and denies nothing
#: today -- that is the point. It is a tripwire: a capability that later
#: classifies above its profile's ceiling fails the policy check instead of
#: quietly becoming reachable from a profile whose promise to the user
#: ("delete, move/rename ... are separately gated") no longer holds.
RISK_CEILING: Mapping[Profile, RiskLevel] = MappingProxyType(
    {
        Profile.RESTRICTED_READ_ONLY: RiskLevel.R0,
        Profile.APPROVED_ROOT_EDIT: RiskLevel.R4,
        Profile.BROAD_LOCAL_FILESYSTEM: RiskLevel.R4,
        Profile.CONSEQUENTIAL_LOCAL: RiskLevel.R5,
        Profile.EXTERNAL_CONNECTED: RiskLevel.R5,
    }
)


def grants(profile: Profile, tier: str) -> bool:
    """Whether a profile permits actions gated behind this capability tier."""

    return tier in PROFILE_TIERS[profile]


def ceiling(profile: Profile) -> RiskLevel:
    return RISK_CEILING[profile]


def narrower_of(first: Profile, second: Profile) -> Profile:
    """The lower rung of two profiles.

    Used by delegation: a delegated grant may narrow what a profile allows and
    may never widen it, so the effective profile is always the lower one.
    """

    return first if first.rung <= second.rung else second
