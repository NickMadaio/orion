"""Which things count as proof of who you are -- and which never do.

The manifest's rule is short and easy to violate later: *do not treat an OAuth
connector as ORION account authentication.* Being able to read someone's Gmail is
not evidence of being them; it is evidence that they once said yes to a consent
screen on a device that may no longer be theirs.

So connector providers are held here, next to the mechanisms, and registering one
as a mechanism raises. It is a rule that would otherwise be violated by a
plausible-looking pull request two years from now.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping, Protocol, runtime_checkable


#: Providers ORION connects to for DATA. None of them is a way to sign in.
CONNECTOR_PROVIDERS = frozenset({"google", "gmail", "apple_calendar", "whoop", "github", "slack"})


class ConnectorIsNotALogin(ValueError):
    """Something tried to register a data connector as an authentication method."""


@runtime_checkable
class Verifier(Protocol):
    """Checks one kind of proof. Implementations are per-mechanism."""

    def verify(self, account: str, proof: bytes, challenge: bytes) -> str | None:
        """Resolve the account to its user id, or None if the proof does not hold.

        Returns an identity rather than a bool on purpose: a verifier that answers
        yes/no leaves somebody else to decide WHOSE session to mint, and that
        somebody was the caller.
        """
        ...


@dataclass(frozen=True, slots=True)
class Mechanism:
    """What a mechanism IS. Whether it is usable is a separate question.

    `production_requires` says what a real verifier needs; nothing here claims to
    have one. Usability is decided by whether a verifier has been installed on
    the service, so "implemented" cannot drift from "actually works" -- a boolean
    saying yes while no verifier exists is exactly the kind of claim this program
    has already been bitten by.
    """

    name: str
    assurance: str
    requires_challenge: bool
    production_requires: str
    note: str

    def __post_init__(self) -> None:
        if self.assurance not in ("low", "medium", "high"):
            raise ValueError("assurance is low, medium or high")
        if self.name in CONNECTOR_PROVIDERS:
            raise ConnectorIsNotALogin(f"{self.name} is a data connector, not a login")
        if not self.note:
            raise ValueError("a mechanism says what it is")


MECHANISMS: Mapping[str, Mechanism] = MappingProxyType(
    {
        mechanism.name: mechanism
        for mechanism in (
            Mechanism(
                "passkey", "high", requires_challenge=True,
                production_requires="a WebAuthn assertion verifier (ES256/Ed25519) and stored credential public keys",
                note="The shape is fixed here, not the crypto.",
            ),
            Mechanism(
                "apple_sign_in", "high", requires_challenge=True,
                production_requires="Apple's public keys and identity-token verification",
                note="Sign in with Apple.",
            ),
            Mechanism(
                "email_link", "medium", requires_challenge=True,
                production_requires="a single-use link store and an email sender",
                note="Medium: it proves control of a mailbox, which is not the same as a person.",
            ),
            Mechanism(
                "recovery_code", "low", requires_challenge=False,
                production_requires="hashed single-use codes, generated once and never redisplayed",
                note="Low on purpose: it is a fallback, and fallbacks get photographed.",
            ),
        )
    }
)


def mechanism(name: str) -> Mechanism:
    if name in CONNECTOR_PROVIDERS:
        raise ConnectorIsNotALogin(f"{name} is a data connector, not a login")
    try:
        return MECHANISMS[name]
    except KeyError:
        raise ValueError(f"unknown authentication mechanism: {name}") from None


def production_gap(name: str) -> str:
    """What a real deployment still has to build for this mechanism."""

    return mechanism(name).production_requires
