"""The device record, and the registry that owns it.

Registration is a signed-in person presenting a public key and a signature over a
server-issued challenge. Three things have to be true and each is checked here:
the person is authenticated (Phase 13's `Owner`), the challenge is fresh and
single-use (Phase 14's `ChallengeStore`), and the signature verifies under an
installed verifier.

`as_policy_directory()` is the point of the whole thing: Phase 5's engine asks a
`DeviceDirectory` whether a device is trusted, and until now that directory was
built by hand in tests.
"""

from __future__ import annotations

import hashlib

from dataclasses import dataclass, replace
from datetime import datetime, timezone

from backend.devices.identity import (
    Attestation,
    AttestationState,
    DeviceIdentity,
    Platform,
)
from backend.devices.proofs import (
    ChallengeStore,
    RefusingVerifier,
    SignatureVerifier,
    VerifierUnavailable,
)
from backend.ownership import Owner
from orion.security.devices import Device, DeviceDirectory
from orion.security.vocabulary import DeviceTrust
from orion.shared.identifiers import Identifier


class DeviceRejected(RuntimeError):
    """The registration or the proof did not check out."""


@dataclass(frozen=True, slots=True)
class DeviceRecord:
    """The manifest's ten fields."""

    device_id: Identifier
    user_id: Identifier
    name: str
    platform: Platform
    identity: DeviceIdentity
    attestation: Attestation
    capabilities: tuple[str, ...]
    created_at: datetime
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    #: Which proof admitted this device, when it was not a registration
    #: challenge. Its own field rather than an entry in `capabilities`, which is
    #: read as authorization -- provenance is not a capability.
    proven_by: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "device_id", Identifier(self.device_id))
        object.__setattr__(self, "user_id", Identifier(self.user_id))
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("a device has a name a person can recognise")
        object.__setattr__(self, "platform", Platform(self.platform))
        if not isinstance(self.identity, DeviceIdentity):
            raise ValueError("a device record carries a DeviceIdentity")
        if not isinstance(self.attestation, Attestation):
            raise ValueError("a device record carries an Attestation")

    @property
    def revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def public_key(self) -> str:
        return self.identity.public_key

    def trust(self) -> DeviceTrust:
        """How Phase 5's policy engine should see this device."""

        if self.revoked:
            return DeviceTrust.REVOKED
        if not self.attestation.usable:
            # A failed attestation is not "unknown": something was offered and
            # did not check out, so the device is held at PENDING rather than
            # being allowed to act.
            return DeviceTrust.PENDING
        return DeviceTrust.PAIRED

    def summary(self) -> dict[str, object]:
        """What the Security Center shows. No key material beyond a fingerprint."""

        return {
            "device_id": str(self.device_id),
            "name": self.name,
            "platform": self.platform.value,
            "attestation": self.attestation.state.value,
            "hardware_backed_claim": self.identity.hardware_backed_claim,
            "capabilities": list(self.capabilities),
            "proven_by": self.proven_by,
            "created_at": self.created_at.isoformat(),
            "last_seen_at": None if self.last_seen_at is None else self.last_seen_at.isoformat(),
            "revoked_at": None if self.revoked_at is None else self.revoked_at.isoformat(),
            # A hash, not a prefix. public_key[:12] is "-----BEGIN P" for every
            # PEM key and "ssh-ed25519 " for every OpenSSH one, so the single
            # field meant to let a person tell two devices apart in the Security
            # Center was identical for all of them.
            "key_fingerprint": hashlib.sha256(self.public_key.encode("utf-8")).hexdigest()[:16],
        }


class DeviceRegistry:
    def __init__(
        self,
        challenges: ChallengeStore | None = None,
        verifier: SignatureVerifier | None = None,
    ) -> None:
        # Keyed by (owner, device id). A flat namespace made registration an
        # existence oracle for OTHER users' devices: registering somebody else's
        # device_id returned "already registered" while an unused one returned
        # "did not prove possession", the two were distinguishable, attempts were
        # unlimited, and the challenge was not consumed on the first path. It
        # also let one account squat an id its rightful owner could never use.
        self._devices: dict[tuple[str, str], DeviceRecord] = {}
        self._challenges = challenges or ChallengeStore()
        self._verifier = verifier or RefusingVerifier()

    @property
    def challenges(self) -> ChallengeStore:
        return self._challenges

    def begin_registration(self, owner: Owner, *, now: datetime):
        """Hand out the challenge this device will have to sign."""

        _require_owner(owner)
        return self._challenges.issue("device_registration", now=now)

    def register(
        self,
        owner: Owner,
        *,
        device_id: str,
        name: str,
        platform: str,
        identity: DeviceIdentity,
        challenge: str,
        signature: bytes,
        attestation: Attestation | None = None,
        capabilities: tuple[str, ...] = (),
        now: datetime,
    ) -> DeviceRecord:
        _require_owner(owner)
        # Spend the challenge BEFORE deciding anything a caller could learn from:
        # an unlimited, free probe is what turns a distinguishable error into an
        # oracle.
        spent = self._challenges.spend(challenge, "device_registration", now=now)
        if (str(owner.user_id), str(device_id)) in self._devices:
            raise DeviceRejected(f"{device_id} is already registered")
        message = _registration_message(owner, device_id, identity, spent.value)
        try:
            verified = self._verifier.verify(identity.public_key, message, signature)
        except VerifierUnavailable:
            # Raised rather than swallowed: a device must not become trusted
            # because nobody installed a verifier.
            raise
        if not verified:
            raise DeviceRejected("the device did not prove possession of its key")
        self._require_matching_algorithm(identity)
        if any(record.public_key == identity.public_key for record in self._devices.values()):
            raise DeviceRejected("that public key is already registered to a device")

        record = DeviceRecord(
            device_id=device_id,
            user_id=owner.user_id,
            name=name,
            platform=platform,
            identity=identity,
            attestation=attestation or Attestation(AttestationState.UNATTESTED),
            capabilities=tuple(capabilities),
            created_at=_aware(now),
        )
        self._devices[(str(owner.user_id), str(device_id))] = record
        return record

    def adopt(
        self,
        owner: Owner,
        *,
        device_id: str,
        name: str,
        platform: str,
        identity: DeviceIdentity,
        proven_by: str,
        proof_message: bytes,
        proof_signature: bytes,
        now: datetime,
        attestation: Attestation | None = None,
        capabilities: tuple[str, ...] = (),
    ) -> DeviceRecord:
        """Register a device whose possession was proven somewhere else.

        Exists for exactly one caller: pairing, where the joining device signed
        the pairing nonce moments earlier and is not present again when the
        offering device confirms. Asking it to sign a second, freshly-minted
        challenge would be a protocol nobody can implement -- the device would
        have to sign something that did not exist when it was last online.

        `proven_by` records WHICH proof stood in, so a device record always says
        how it got here. The proof itself is re-checked here rather than taken on
        the caller's word: this method used to accept any identity with no
        signature and no verifier call, so any holder of an Owner could mint a
        DeviceTrust.PAIRED device out of nothing -- on the same registry where
        `register` correctly raises VerifierUnavailable. The joining device is not
        online at confirm time, but the signature it made earlier is, and a
        signature does not go stale. Everything else -- the owner, the
        duplicate-key check, the attestation default -- is the same as `register`.
        """

        _require_owner(owner)
        if not proven_by:
            raise DeviceRejected("adoption must record which proof admitted the device")
        if str(device_id) in self._devices:
            raise DeviceRejected(f"{device_id} is already registered")
        try:
            verified = self._verifier.verify(identity.public_key, proof_message, proof_signature)
        except VerifierUnavailable:
            # Same stance as register: a device must not become trusted because
            # nobody installed a verifier.
            raise
        if not verified:
            raise DeviceRejected("the standing proof does not verify against this device's key")
        self._require_matching_algorithm(identity)
        if any(record.public_key == identity.public_key for record in self._devices.values()):
            raise DeviceRejected("that public key is already registered to a device")
        record = DeviceRecord(
            device_id=device_id,
            user_id=owner.user_id,
            name=name,
            platform=platform,
            identity=identity,
            # UNATTESTED, not SELF_ATTESTED: nothing was attested. SELF_ATTESTED
            # means "the device says its key is hardware-backed" -- a claim that was
            # never made or transmitted, and that the Security Center would show.
            attestation=attestation or Attestation(AttestationState.UNATTESTED),
            # Provenance stays OUT of `capabilities`, which is read as
            # authorization. It is recorded on its own field.
            capabilities=tuple(capabilities),
            proven_by=str(proven_by),
            created_at=_aware(now),
        )
        self._devices[(str(owner.user_id), str(device_id))] = record
        return record

    def touch(self, owner: Owner, device_id: str, *, now: datetime) -> DeviceRecord:
        record = self._owned(owner, device_id)
        updated = replace(record, last_seen_at=_aware(now))
        self._devices[(str(owner.user_id), str(device_id))] = updated
        return updated

    def revoke(self, owner: Owner, device_id: str, *, now: datetime) -> DeviceRecord:
        """Immediate. The next policy decision sees it, with no cache in between."""

        record = self._owned(owner, device_id)
        revoked = replace(record, revoked_at=_aware(now))
        self._devices[(str(owner.user_id), str(device_id))] = revoked
        return revoked

    def record_attestation(
        self, owner: Owner, device_id: str, attestation: Attestation
    ) -> DeviceRecord:
        record = self._owned(owner, device_id)
        updated = replace(record, attestation=attestation)
        self._devices[(str(owner.user_id), str(device_id))] = updated
        return updated

    def list(self, owner: Owner) -> tuple[DeviceRecord, ...]:
        _require_owner(owner)
        return tuple(
            record for record in self._devices.values()
            if str(record.user_id) == str(owner.user_id)
        )

    def security_center(self, owner: Owner) -> tuple[dict[str, object], ...]:
        return tuple(record.summary() for record in self.list(owner))

    def as_policy_directory(self, owner: Owner) -> DeviceDirectory:
        """Build the directory Phase 5's engine asks about trust.

        Only devices that can sign get a signing key id, because Phase 5 refuses
        to record a paired device without one -- a paired device that cannot sign
        would be denied at the signature gate with a confusing reason.
        """

        devices = []
        for record in self.list(owner):
            trust = record.trust()
            devices.append(
                Device(
                    device_id=record.device_id,
                    owner_id=record.user_id,
                    trust=trust,
                    platform=record.platform.value,
                    signing_key_id=_key_id(record) if trust is DeviceTrust.PAIRED else None,
                )
            )
        return DeviceDirectory(devices)

    def _require_matching_algorithm(self, identity: DeviceIdentity) -> None:
        """The record must not claim a crypto property nobody checked.

        A record could say `algorithm: ed25519` while the signature was checked
        by an HMAC verifier, and `summary()` does not expose `algorithm`, so the
        false claim was neither verified nor visible.
        """

        declared = getattr(identity, "algorithm", None)
        actual = getattr(self._verifier, "algorithm", None)
        if declared and actual and str(declared) != str(actual):
            raise DeviceRejected(
                f"this registry verifies {actual}, but the device declares {declared}"
            )

    def _owned(self, owner: Owner, device_id: str) -> DeviceRecord:
        _require_owner(owner)
        record = self._devices.get((str(owner.user_id), str(device_id)))
        if record is None or str(record.user_id) != str(owner.user_id):
            raise DeviceRejected(f"no device {device_id}")
        return record


def _key_id(record: DeviceRecord) -> str:
    """A stable id for the key Phase 5 will look up when checking a signature."""

    # Hashed, not truncated. This was f"key-{device_id}"[:127], and Identifier
    # permits 128 characters -- so "key-" plus a 128-char id was 132, cut to 127,
    # and any two device ids sharing their first 123 characters produced the SAME
    # signing key id. orion/security/rules.py compares exactly this value to bind
    # a signature to its origin device, with a comment explaining that verifying
    # against any registered key would let one device sign as another. Truncation
    # reintroduced that through the back door. Never truncate an identifier that
    # is compared for equality.
    digest = hashlib.sha256(str(record.device_id).encode("utf-8")).hexdigest()
    return f"key-{digest[:48]}"


def _registration_message(owner: Owner, device_id: str, identity: DeviceIdentity, challenge: str) -> bytes:
    """What the device signs.

    Binds the challenge to this owner, this device id and this key. Signing the
    bare challenge would let a captured signature register a different device.
    """

    return f"register|{owner.user_id}|{device_id}|{identity.public_key}|{challenge}".encode("utf-8")


def _require_owner(owner: object) -> None:
    if not isinstance(owner, Owner):
        raise DeviceRejected("device registration needs a signed-in owner")


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)
