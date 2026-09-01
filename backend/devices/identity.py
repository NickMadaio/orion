"""Three identities, deliberately three types.

The manifest's rule is "do not conflate them", and nothing enforces that except
being unable to pass one where another is meant:

- **UserIdentity** -- who the person is. Phase 13 produces it.
- **DeviceIdentity** -- which machine this is, evidenced by a signature.
- **Attestation** -- whether the software is a genuine build, which says nothing
  about either of the other two.

A jailbroken phone holding a genuine key is a real device running an app nobody
can vouch for, and the record has to be able to say exactly that rather than
collapsing it into "trusted" or "not".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from orion.shared.identifiers import Identifier, Symbol


class Platform(str, Enum):
    MACOS = "macos"
    IOS = "ios"
    IPADOS = "ipados"
    WATCHOS = "watchos"
    WEB = "web"


class AttestationState(str, Enum):
    """What is known about the software, not about the key or the person."""

    #: Nothing was claimed. The honest default.
    UNATTESTED = "unattested"
    #: The device says its key is hardware-backed. A CLAIM, recorded as one.
    SELF_ATTESTED = "self_attested"
    #: The platform vouched for the build and the server checked it.
    HARDWARE_ATTESTED = "hardware_attested"
    #: An attestation was offered and did not check out. Worse than none.
    FAILED = "failed"


#: States in which a device may hold capabilities. FAILED is excluded on purpose:
#: an attestation that was offered and failed is a stronger signal than one that
#: was never offered.
USABLE_ATTESTATION = frozenset(
    {AttestationState.UNATTESTED, AttestationState.SELF_ATTESTED, AttestationState.HARDWARE_ATTESTED}
)


@dataclass(frozen=True, slots=True)
class UserIdentity:
    """Who the person is. Comes from Phase 13, never from a device."""

    user_id: Identifier

    def __post_init__(self) -> None:
        object.__setattr__(self, "user_id", Identifier(self.user_id))


@dataclass(frozen=True, slots=True)
class DeviceIdentity:
    """Which machine this is: a public key and the algorithm that signs with it.

    There is no private-key field and no constructor that accepts one. The server
    receives a public key and a signature, which is what a device sends when the
    private half cannot leave it.
    """

    public_key: str
    algorithm: Symbol
    hardware_backed_claim: bool

    def __post_init__(self) -> None:
        if not isinstance(self.public_key, str) or len(self.public_key) < 16:
            raise ValueError("a public key must be a substantial string")
        lowered = self.public_key.lower()
        if "private" in lowered or "begin rsa" in lowered or "begin ed25519" in lowered:
            # Somebody pasting a private key into the public field is not a
            # hypothetical, and the failure should be loud rather than stored.
            raise ValueError("that looks like a private key; only public keys are registered")
        object.__setattr__(self, "algorithm", Symbol(self.algorithm))
        if not isinstance(self.hardware_backed_claim, bool):
            raise ValueError("hardware backing is a boolean claim")


@dataclass(frozen=True, slots=True)
class Attestation:
    """What the platform says about the app. Re-checked, never inherited."""

    state: AttestationState
    checked_at: datetime | None = None
    detail: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "state", AttestationState(self.state))
        if self.checked_at is not None:
            if self.checked_at.tzinfo is None or self.checked_at.utcoffset() is None:
                raise ValueError("checked_at must be timezone-aware")
            object.__setattr__(self, "checked_at", self.checked_at.astimezone(timezone.utc))
        if self.state is AttestationState.HARDWARE_ATTESTED and self.checked_at is None:
            # "The platform vouched for it" with no record of when is a claim
            # about the past that nobody can date.
            raise ValueError("a hardware attestation records when it was checked")

    @property
    def usable(self) -> bool:
        return self.state in USABLE_ATTESTATION
