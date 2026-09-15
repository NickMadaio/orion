"""Pairing: three steps, and both devices have to prove something.

Most pairing flows prove one side -- the phone scans a code and signs; the Mac is
assumed, because it displayed the code. That assumption is the hole. Anyone who
can see the screen (a shoulder, a screen share, a photograph of a code left open)
is the Mac as far as the protocol is concerned.

Here the offering device signs too, over the joining device's public key, so it is
attesting to *which* key it is admitting rather than merely to having been there.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable
from functools import wraps

from backend.devices.identity import Attestation, AttestationState, DeviceIdentity
from backend.devices.registry import DeviceRegistry, DeviceRejected, _registration_message
from backend.devices.proofs import SignatureVerifier, VerifierUnavailable
from backend.ownership import Owner
from orion.shared.identifiers import Identifier


#: Two minutes. Long enough to scan a code and tap approve; short enough that a
#: photographed screen is worthless by the time anybody acts on it.
PAIRING_LIFETIME = timedelta(minutes=2)
NONCE_BYTES = 32


class PairingRejected(RuntimeError):
    """The pairing is unknown, spent, expired, cancelled, or unproven."""


class PairingState(str, Enum):
    OFFERED = "offered"
    CLAIMED = "claimed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


TERMINAL = frozenset({PairingState.COMPLETED, PairingState.CANCELLED, PairingState.EXPIRED})


@dataclass(frozen=True, slots=True)
class Pairing:
    pairing_id: Identifier
    user_id: Identifier
    offering_device_id: Identifier
    nonce: str
    state: PairingState
    created_at: datetime
    expires_at: datetime
    joining_public_key: str | None = None
    joining_device_id: Identifier | None = None
    #: The signature the joining device made over the join message. Retained so
    #: the registry can re-verify the proof at confirm time, when the phone is
    #: no longer online to produce a fresh one.
    joining_signature: bytes | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "pairing_id", Identifier(self.pairing_id))
        object.__setattr__(self, "user_id", Identifier(self.user_id))
        object.__setattr__(self, "offering_device_id", Identifier(self.offering_device_id))
        object.__setattr__(self, "state", PairingState(self.state))
        if len(self.nonce) < 16 and self.state not in TERMINAL:
            raise ValueError("a pairing nonce must be substantial")
        # Validated on the TYPE, not in offer(). `offer` applied _aware() and
        # checked nothing else, so a naive or inverted timestamp was accepted by
        # the constructor and only blew up later, inside expired_at().
        for field in ("created_at", "expires_at"):
            value = getattr(self, field)
            if not isinstance(value, datetime) or value.tzinfo is None:
                raise ValueError(f"{field} must be an aware datetime")
        if self.expires_at <= self.created_at:
            raise ValueError("a pairing must expire after it was created")

    def expired_at(self, now: datetime) -> bool:
        return now >= self.expires_at

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL

    def payload(self) -> str:
        """What goes in the QR code.

        The nonce is in the fragment: fragments are not sent to servers, so a
        pairing code that ends up in a URL bar does not end up in an access log.
        """

        return f"orion-pair://{self.pairing_id}#{self.nonce}"


def _registry_transaction(method):
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        # Revocation and confirmation must serialize. Otherwise an offering key
        # can be revoked after the check but before its new phone is admitted.
        result = None
        try:
            with self._registry.transaction():
                result = method(self, *args, **kwargs)
            return result
        except Exception:
            # The method can finish before the durable commit fails. Never keep
            # a successful pairing label for an admission that was rolled back.
            # The nonce stays spent; retry requires a new deliberate offer.
            if result is not None and result.state is PairingState.COMPLETED:
                self._pairings[str(result.pairing_id)] = replace(
                    result, state=PairingState.CANCELLED, nonce="", joining_device_id=None)
            raise
    return wrapped


class PairingService:
    def __init__(
        self,
        registry: DeviceRegistry,
        verifier: SignatureVerifier | None = None,
        *,
        nonce_source: Callable[[], str] = lambda: secrets.token_urlsafe(NONCE_BYTES),
        id_source: Callable[[], str] | None = None,
    ) -> None:
        self._registry = registry
        self._verifier = verifier if verifier is not None else registry._verifier
        self._nonce = nonce_source
        self._counter = 0
        self._id_source = id_source
        self._pairings: dict[str, Pairing] = {}

    # -- step one ----------------------------------------------------------

    def offer(self, owner: Owner, *, offering_device_id: str, now: datetime) -> Pairing:
        """A signed-in person, on a device they already registered, asks to pair."""

        offering = self._registry._owned(owner, offering_device_id)
        if offering.revoked:
            raise PairingRejected("a revoked device cannot admit another one")
        pairing = Pairing(
            pairing_id=self._identifier(),
            user_id=owner.user_id,
            offering_device_id=offering.device_id,
            nonce=self._nonce(),
            state=PairingState.OFFERED,
            created_at=_aware(now),
            expires_at=_aware(now) + PAIRING_LIFETIME,
        )
        self._pairings[str(pairing.pairing_id)] = pairing
        return pairing

    # -- step two ----------------------------------------------------------

    def claim(
        self,
        *,
        pairing_id: str,
        nonce: str,
        identity: DeviceIdentity,
        signature: bytes,
        now: datetime,
    ) -> Pairing:
        """The joining device proves possession of its key. It is not registered yet."""

        pairing = self._live(pairing_id, now)
        if pairing.state is not PairingState.OFFERED:
            raise PairingRejected("this pairing has already been claimed")
        # Encode both sides: compare_digest refuses non-ASCII str outright, so a
        # nonce with one accented character raised TypeError out of a method
        # documented to raise PairingRejected -- and it was the one wrong-nonce
        # path that did not cancel, which made it a probe oracle.
        if not secrets.compare_digest(
            pairing.nonce.encode("utf-8"), str(nonce).encode("utf-8")
        ):
            self._cancel(pairing, now)
            raise PairingRejected("that is not this pairing's nonce")
        if not self._verify(identity.public_key, self._join_message(pairing, identity), signature):
            # A wrong signature on a pairing nonce is not a typo.
            self._cancel(pairing, now)
            raise PairingRejected("the joining device did not prove possession of its key")
        claimed = replace(
            pairing,
            state=PairingState.CLAIMED,
            joining_public_key=identity.public_key,
            joining_signature=signature,
        )
        self._pairings[str(pairing.pairing_id)] = claimed
        return claimed

    # -- step three --------------------------------------------------------

    @_registry_transaction
    def confirm(
        self,
        owner: Owner,
        *,
        pairing_id: str,
        offering_signature: bytes,
        joining_device_id: str,
        joining_identity: DeviceIdentity,
        name: str,
        platform: str,
        now: datetime,
        attestation: Attestation | None = None,
    ) -> Pairing:
        """The offering device signs off on WHICH key it is admitting."""

        pairing = self._live(pairing_id, now)
        if pairing.state is not PairingState.CLAIMED:
            raise PairingRejected("nothing has claimed this pairing")
        if str(pairing.user_id) != str(owner.user_id):
            raise PairingRejected("this pairing belongs to another account")
        if pairing.joining_public_key != joining_identity.public_key:
            # The offering device is signing a statement about a specific key;
            # swapping the key afterwards would make that statement meaningless.
            raise PairingRejected("that is not the key that claimed this pairing")

        offering = self._registry._owned(owner, str(pairing.offering_device_id))
        if offering.revoked:
            # offer() checked this and confirm() did not -- but confirm() is where
            # the new device is actually admitted. Revoking a compromised device
            # between claim and confirm left the attacker a freshly registered,
            # unrevoked, PAIRED device that the revocation never touched.
            self._cancel(pairing, now)
            raise PairingRejected("a revoked device cannot admit another one")
        if not self._verify(
            offering.public_key,
            self._confirm_message(pairing, joining_identity, str(joining_device_id)),
            offering_signature,
        ):
            self._cancel(pairing, now)
            raise PairingRejected("the offering device did not confirm this pairing")

        try:
            # `adopt`, not `register`: the joining device proved possession over
            # the pairing nonce at claim time and is not here now. Asking it to
            # sign a freshly-minted registration challenge would be a protocol
            # nobody can implement.
            self._registry.adopt(
                owner,
                device_id=joining_device_id,
                name=name,
                platform=platform,
                identity=joining_identity,
                proven_by=f"pairing:{pairing.pairing_id}",
                proof_message=self._join_message(pairing, joining_identity),
                proof_signature=pairing.joining_signature or b"",
                attestation=attestation or Attestation(AttestationState.SELF_ATTESTED),
                now=now,
            )
        except (DeviceRejected, VerifierUnavailable):
            self._cancel(pairing, now)
            raise

        completed = replace(
            pairing,
            state=PairingState.COMPLETED,
            joining_device_id=Identifier(joining_device_id),
            nonce="",
        )
        self._pairings[str(pairing.pairing_id)] = completed
        return completed

    # -- the rest ----------------------------------------------------------

    def cancel(self, owner: Owner, pairing_id: str, *, now: datetime) -> Pairing:
        pairing = self._pairings.get(str(pairing_id))
        if pairing is None or str(pairing.user_id) != str(owner.user_id):
            raise PairingRejected(f"no pairing {pairing_id}")
        return self._cancel(pairing, now)

    def pending(self, owner: Owner, *, now: datetime) -> tuple[Pairing, ...]:
        return tuple(
            pairing for pairing in self._pairings.values()
            if str(pairing.user_id) == str(owner.user_id)
            and not pairing.terminal
            and not pairing.expired_at(now)
        )

    def security_center(self, owner: Owner, *, now: datetime) -> dict[str, object]:
        """Paired devices and anything in flight, for the Phase 42 screen."""

        return {
            "devices": list(self._registry.security_center(owner)),
            "pending_pairings": [
                {"pairing_id": str(item.pairing_id), "state": item.state.value,
                 "expires_at": item.expires_at.isoformat()}
                for item in self.pending(owner, now=now)
            ],
        }

    # -- internals ---------------------------------------------------------

    def _identifier(self) -> str:
        if self._id_source is not None:
            return self._id_source()
        self._counter += 1
        # Random, not sequential. claim() deliberately takes no Owner -- holding
        # the nonce is the proof -- and a wrong nonce cancels the pairing. With a
        # guessable id those two correct decisions combined into a denial of
        # service: walk pairing-000000000001 upwards, submit junk, and every
        # pairing dies before the owner's phone finishes scanning.
        return f"pairing-{secrets.token_hex(16)}"

    def _live(self, pairing_id: str, now: datetime) -> Pairing:
        pairing = self._pairings.get(str(pairing_id))
        if pairing is None:
            raise PairingRejected(f"no pairing {pairing_id}")
        if pairing.terminal:
            raise PairingRejected(f"this pairing is {pairing.state.value}")
        if pairing.expired_at(_aware(now)):
            # Checked at every step, not only at claim: the interesting delay is
            # between claim and confirm, where a person is looking at a phone.
            self._pairings[str(pairing_id)] = replace(pairing, state=PairingState.EXPIRED, nonce="")
            raise PairingRejected("this pairing expired")
        return pairing

    def _cancel(self, pairing: Pairing, now: datetime) -> Pairing:
        # The nonce goes with it. A terminal pairing kept a renderable nonce in
        # the same dict as the live ones, and payload() would still print it -- a
        # spent secret with a live accessor.
        cancelled = replace(pairing, state=PairingState.CANCELLED, nonce="")
        self._pairings[str(pairing.pairing_id)] = cancelled
        return cancelled

    def _verify(self, public_key: str, message: bytes, signature: bytes) -> bool:
        return self._verifier.verify(public_key, message, signature)

    @staticmethod
    def _join_message(pairing: Pairing, identity: DeviceIdentity) -> bytes:
        return f"pair-join|{pairing.pairing_id}|{pairing.nonce}|{identity.public_key}".encode("utf-8")

    @staticmethod
    def _confirm_message(
        pairing: Pairing, identity: DeviceIdentity, joining_device_id: str = ""
    ) -> bytes:
        """What the offering device signs: this pairing, THIS key, and THIS id.

        `joining_device_id` used to sit outside the signed statement while
        `adopt` filed the record under whatever the caller passed. The key
        binding is the security-relevant half and it was always signed, so a
        code-photographer gained nothing -- but once a transport sits between the
        Mac and this call, anything on that path could file the device under an
        id of its choosing and the record, `proven_by` included, would read as
        authoritative. `_registration_message` already includes the device id;
        this is the same fix on the other path.
        """

        return (
            f"pair-confirm|{pairing.pairing_id}|{pairing.nonce}"
            f"|{identity.public_key}|{joining_device_id}"
        ).encode("utf-8")


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)
