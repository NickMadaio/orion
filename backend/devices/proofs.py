"""Challenges and possession proofs.

A device proves it holds a private key by signing something the server chose.
Two properties make that meaningful, and both are about the challenge rather than
the signature: it must be **single-use**, or a captured proof can be replayed
forever, and it must be **short-lived**, or a captured proof can be replayed for
a while.

Verification remains an explicitly injected port with a refusing default.
The optional P256Verifier adapter verifies Apple device-key signatures; merely
installing its dependency does not activate it. A device cannot become trusted
because nobody configured a verifier.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol, runtime_checkable


#: Long enough to scan a code and tap approve, short enough that a captured
#: challenge is worthless by the time it is useful.
CHALLENGE_LIFETIME = timedelta(minutes=5)
CHALLENGE_BYTES = 32


class VerifierUnavailable(RuntimeError):
    """No signature verifier is installed. Nothing may be trusted without one."""


class ChallengeRejected(RuntimeError):
    """The challenge is unknown, spent, or expired."""


@runtime_checkable
class SignatureVerifier(Protocol):
    algorithm: str

    def verify(self, public_key: str, message: bytes, signature: bytes) -> bool: ...


class RefusingVerifier:
    """The default. Verifies nothing, and says so.

    Returning False would be worse than raising: a device would simply fail to
    register, somebody would debug the proof, and the missing verifier would be
    found last.
    """

    algorithm = "refusing"

    def verify(self, public_key: str, message: bytes, signature: bytes) -> bool:
        raise VerifierUnavailable(
            "no signature verifier is installed: production needs Ed25519 or ES256 "
            "verification of device keys"
        )


@dataclass(frozen=True, slots=True)
class Challenge:
    value: str
    issued_at: datetime
    expires_at: datetime
    purpose: str

    def expired_at(self, now: datetime) -> bool:
        return now >= self.expires_at


class ChallengeStore:
    """Issues challenges and spends them exactly once."""

    def __init__(self, source: Callable[[], str] = lambda: secrets.token_urlsafe(CHALLENGE_BYTES)) -> None:
        self._source = source
        self._open: dict[str, Challenge] = {}

    def issue(self, purpose: str, *, now: datetime) -> Challenge:
        challenge = Challenge(
            value=self._source(),
            issued_at=_aware(now),
            expires_at=_aware(now) + CHALLENGE_LIFETIME,
            purpose=purpose,
        )
        self._open[challenge.value] = challenge
        return challenge

    def spend(self, value: str, purpose: str, *, now: datetime) -> Challenge:
        """Consume a challenge. A second attempt with the same value fails."""

        challenge = self._open.pop(value, None)
        if challenge is None:
            raise ChallengeRejected("unknown or already-used challenge")
        if challenge.purpose != purpose:
            # A pairing challenge must not be spendable as a registration proof.
            raise ChallengeRejected(f"challenge was issued for {challenge.purpose}")
        if challenge.expired_at(_aware(now)):
            raise ChallengeRejected("challenge expired")
        return challenge

    @property
    def outstanding(self) -> int:
        return len(self._open)


class HmacVerifier:
    """A verifier for tests and local work. Symmetric, and therefore NOT identity.

    Named for what it is: with an HMAC key both sides can produce a signature, so
    it proves possession of a shared secret rather than of a private key. Fine
    for exercising the lifecycle; useless as device identity, which is why the
    production default refuses instead of falling back to this.
    """

    algorithm = "hmac-sha256-test-only"

    def __init__(self, keys: dict[str, bytes]) -> None:
        self._keys = dict(keys)

    def verify(self, public_key: str, message: bytes, signature: bytes) -> bool:
        secret = self._keys.get(public_key)
        if secret is None:
            return False
        return hmac.compare_digest(hmac.new(secret, message, hashlib.sha256).digest(), signature)


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)
