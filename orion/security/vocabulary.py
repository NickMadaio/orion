"""The closed vocabularies a policy decision is made out of.

The manifest names six risk levels, and they are not a finer-grained version of
the catalog's `low/medium/high/critical`. Those four say how bad an action is;
R0-R5 says what KIND of reach it has -- observation, local, external,
communication, destructive, privileged. An action can be low-severity and still
external, which is exactly the distinction a remote-access phase will need and
the four words cannot make.
"""

from __future__ import annotations

from enum import Enum


class RiskLevel(str, Enum):
    """The manifest's six, in order of reach."""

    R0 = "R0"  # observation / read
    R1 = "R1"  # local reversible action
    R2 = "R2"  # external reversible action
    R3 = "R3"  # external communication
    R4 = "R4"  # destructive or sensitive action
    R5 = "R5"  # privileged / security-critical action

    @property
    def rank(self) -> int:
        return int(self.value[1])


def at_least(level: RiskLevel, floor: RiskLevel) -> bool:
    """Whether `level` reaches `floor`.

    A helper rather than `__ge__`: RiskLevel subclasses str, so comparison
    operators already mean string comparison. Redefining them would make
    `RiskLevel.R2 > "R1"` mean two different things depending on which side the
    string is on, which is the kind of subtlety that produces a permissive bug
    nobody can see by reading.
    """

    return level.rank >= floor.rank


def at_most(level: RiskLevel, ceiling: RiskLevel) -> bool:
    """Whether `level` stays within `ceiling`."""

    return level.rank <= ceiling.rank


def highest(levels: tuple[RiskLevel, ...]) -> RiskLevel:
    if not levels:
        raise ValueError("no risk levels to compare")
    return max(levels, key=lambda level: level.rank)


class SecurityState(str, Enum):
    """What the system as a whole is currently willing to do.

    LOCKED is Phase 43's LOCK ORION, expressible now rather than bolted on
    later: an engine that cannot represent "everything is suspended" would have
    to grow a second, parallel gate to implement it.
    """

    NORMAL = "normal"
    HEIGHTENED = "heightened"
    LOCKED = "locked"


class DeviceTrust(str, Enum):
    """How much authority a device carries.

    Looked up in a directory, never read off the request. A device that states
    its own trust level is not a check; it is a field an attacker fills in.
    """

    UNKNOWN = "unknown"
    PENDING = "pending"
    PAIRED = "paired"
    REVOKED = "revoked"


class RequestSource(str, Enum):
    """Who or what caused this request to exist.

    MODEL_INITIATED does NOT mean "the model emitted the tool call". It almost
    always does; that is the ordinary path and it is USER_DIRECT, because an
    authenticated user turn is behind it. MODEL_INITIATED is the narrower and
    more dangerous case the live validator already refuses under
    `no_authenticated_user_turn`: the model proposing an action with no user
    turn behind it at all -- proactive work, a scheduled loop, a retry that
    outlived its conversation.

    Getting this wrong in the permissive direction is a hole; getting it wrong
    in the strict direction would make Orion ask permission to change the
    volume, which is how a security control gets switched off.
    """

    USER_DIRECT = "user_direct"
    USER_SCHEDULED = "user_scheduled"
    AUTOMATION = "automation"
    MODEL_INITIATED = "model_initiated"
    REMOTE_DEVICE = "remote_device"
    EXTERNAL_CONTENT = "external_content"


#: Sources that may never, on their own, cause anything that changes state. An
#: instruction found inside a web page or an email is data about what somebody
#: wants, not authority to do it.
NON_AUTHORIZING_SOURCES = frozenset({RequestSource.EXTERNAL_CONTENT})
