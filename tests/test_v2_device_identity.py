"""Phases 14 and 15: device identity, and pairing.

The verifier here is HMAC-based and named for what it is. With a shared secret
both sides can produce a signature, so it proves possession of a secret rather
than of a private key -- fine for exercising the lifecycle, useless as identity,
which is why the production default refuses rather than falling back to it.
"""

from __future__ import annotations

import hashlib
import hmac
import unittest
from datetime import datetime, timedelta, timezone

from backend.devices.identity import (
    USABLE_ATTESTATION,
    Attestation,
    AttestationState,
    DeviceIdentity,
    Platform,
    UserIdentity,
)
from backend.devices.proofs import (
    CHALLENGE_LIFETIME,
    ChallengeRejected,
    ChallengeStore,
    HmacVerifier,
    RefusingVerifier,
    VerifierUnavailable,
)
from backend.devices.registry import (
    DeviceRecord,
    DeviceRegistry,
    DeviceRejected,
    _registration_message,
)
from backend.ownership import Owner, Session, resolve_owner
from backend.pairing.session import (
    PAIRING_LIFETIME,
    Pairing,
    PairingRejected,
    PairingService,
    PairingState,
)
from orion.security.devices import DeviceDirectory
from orion.security.vocabulary import DeviceTrust


NOW = datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc)
USER = "user-nick-0001"
MAC_KEY = "public-key-mac-studio-0001"
PHONE_KEY = "public-key-iphone-nick-0001"
SECRETS = {MAC_KEY: b"mac-device-secret", PHONE_KEY: b"phone-device-secret"}


def owner(user_id: str = USER) -> Owner:
    return resolve_owner(Session("session-0001-aa", user_id, "device-mac-0001"))


def sign(public_key: str, message: bytes) -> bytes:
    return hmac.new(SECRETS[public_key], message, hashlib.sha256).digest()


def identity(public_key: str = MAC_KEY, **overrides) -> DeviceIdentity:
    # The algorithm the TEST VERIFIER actually implements. It said "ed25519"
    # while every signature in the suite was checked by HmacVerifier, so every
    # record asserted a cryptographic property nothing had verified -- the same
    # shape as building a fixture instead of calling the producer.
    fields = {
        "public_key": public_key,
        "algorithm": HmacVerifier.algorithm,
        "hardware_backed_claim": True,
    }
    fields.update(overrides)
    return DeviceIdentity(**fields)


def registry(**overrides) -> DeviceRegistry:
    return DeviceRegistry(
        overrides.get("challenges", ChallengeStore()),
        overrides.get("verifier", HmacVerifier(SECRETS)),
    )


def register(subject: DeviceRegistry, holder: Owner, *, device_id="device-mac-0001",
             public_key=MAC_KEY, now=NOW, **overrides) -> DeviceRecord:
    challenge = subject.begin_registration(holder, now=now)
    device_identity = overrides.pop("identity", identity(public_key))
    message = _registration_message(holder, device_id, device_identity, challenge.value)
    fields = {
        "device_id": device_id, "name": "Nick's Mac", "platform": "macos",
        "identity": device_identity, "challenge": challenge.value,
        "signature": sign(public_key, message), "now": now,
    }
    fields.update(overrides)
    return subject.register(holder, **fields)


class SeparationTests(unittest.TestCase):
    """user identity, device identity and attestation are three things."""

    def test_they_are_three_distinct_types(self):
        self.assertNotIsInstance(UserIdentity(USER), DeviceIdentity)
        self.assertNotIsInstance(identity(), UserIdentity)
        self.assertNotIsInstance(Attestation(AttestationState.UNATTESTED), DeviceIdentity)

    def test_a_device_identity_holds_no_user(self):
        self.assertNotIn("user_id", DeviceIdentity.__dataclass_fields__)

    def test_attestation_says_nothing_about_the_key_or_the_person(self):
        # A jailbroken phone with a genuine key is a real device running an app
        # nobody can vouch for, and the record has to be able to say that.
        self.assertNotIn("public_key", Attestation.__dataclass_fields__)
        self.assertNotIn("user_id", Attestation.__dataclass_fields__)

    def test_a_failed_attestation_is_worse_than_none(self):
        self.assertIn(AttestationState.UNATTESTED, USABLE_ATTESTATION)
        self.assertNotIn(AttestationState.FAILED, USABLE_ATTESTATION)

    def test_a_hardware_attestation_records_when_it_was_checked(self):
        with self.assertRaises(ValueError):
            Attestation(AttestationState.HARDWARE_ATTESTED)
        Attestation(AttestationState.HARDWARE_ATTESTED, checked_at=NOW)


class PublicKeyTests(unittest.TestCase):
    def test_only_public_keys_are_registered(self):
        self.assertNotIn("private_key", DeviceIdentity.__dataclass_fields__)
        for pasted in ("-----BEGIN RSA PRIVATE KEY-----aaaaaaaaaaaaaaaa",
                       "my private key material here"):
            with self.assertRaises(ValueError, msg=pasted):
                identity(public_key=pasted)

    def test_hardware_backing_is_recorded_as_a_claim(self):
        # The server cannot verify it by looking at a string, and pretending
        # otherwise would make later decisions rest on a field nobody checked.
        self.assertTrue(identity().hardware_backed_claim)
        self.assertIn("hardware_backed_claim", identity().__dataclass_fields__)


class ChallengeTests(unittest.TestCase):
    def setUp(self):
        self.store = ChallengeStore()

    def test_a_challenge_is_single_use(self):
        challenge = self.store.issue("device_registration", now=NOW)
        self.store.spend(challenge.value, "device_registration", now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.store.spend(challenge.value, "device_registration", now=NOW)

    def test_a_challenge_expires(self):
        challenge = self.store.issue("device_registration", now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.store.spend(challenge.value, "device_registration", now=NOW + CHALLENGE_LIFETIME)

    def test_a_challenge_is_bound_to_its_purpose(self):
        challenge = self.store.issue("pairing", now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.store.spend(challenge.value, "device_registration", now=NOW)


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()
        self.owner = owner()

    def test_a_device_registers_by_proving_possession(self):
        record = register(self.registry, self.owner)
        self.assertEqual(str(record.user_id), USER)
        # A HASH, not a prefix: public_key[:12] is "-----BEGIN P" for every PEM
        # key, so the one field meant to tell two devices apart was identical for
        # all of them.
        # Two PEM keys sharing their first twelve characters -- which every PEM
        # key does -- must not share a fingerprint.
        left = "-----BEGIN PUBLIC KEY-----\nAAAA"
        right = "-----BEGIN PUBLIC KEY-----\nBBBB"
        self.assertEqual(left[:12], right[:12])
        self.assertNotEqual(
            hashlib.sha256(left.encode("utf-8")).hexdigest()[:16],
            hashlib.sha256(right.encode("utf-8")).hexdigest()[:16],
        )
        self.assertEqual(
            record.summary()["key_fingerprint"],
            hashlib.sha256(record.public_key.encode("utf-8")).hexdigest()[:16],
        )

    def test_the_ten_manifest_fields_are_present(self):
        record = register(self.registry, self.owner)
        for field in ("device_id", "user_id", "name", "platform", "capabilities",
                      "created_at", "last_seen_at", "revoked_at"):
            self.assertIn(field, DeviceRecord.__dataclass_fields__, field)
        self.assertTrue(record.public_key)
        self.assertIsInstance(record.attestation.state, AttestationState)

    def test_a_wrong_signature_is_refused(self):
        challenge = self.registry.begin_registration(self.owner, now=NOW)
        with self.assertRaises(DeviceRejected):
            self.registry.register(
                self.owner, device_id="device-mac-0001", name="Mac", platform="macos",
                identity=identity(), challenge=challenge.value, signature=b"wrong", now=NOW,
            )

    def test_a_replayed_registration_cannot_be_reused(self):
        challenge = self.registry.begin_registration(self.owner, now=NOW)
        device_identity = identity()
        message = _registration_message(self.owner, "device-mac-0001", device_identity, challenge.value)
        signature = sign(MAC_KEY, message)
        self.registry.register(self.owner, device_id="device-mac-0001", name="Mac", platform="macos",
                               identity=device_identity, challenge=challenge.value,
                               signature=signature, now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.registry.register(self.owner, device_id="device-mac-0002", name="Mac 2",
                                   platform="macos", identity=device_identity,
                                   challenge=challenge.value, signature=signature, now=NOW)

    def test_a_signature_is_bound_to_the_device_it_registers(self):
        # Signing the bare challenge would let a captured signature register a
        # different device.
        challenge = self.registry.begin_registration(self.owner, now=NOW)
        device_identity = identity()
        other_message = _registration_message(self.owner, "device-somewhere-else", device_identity, challenge.value)
        with self.assertRaises(DeviceRejected):
            self.registry.register(self.owner, device_id="device-mac-0001", name="Mac",
                                   platform="macos", identity=device_identity,
                                   challenge=challenge.value,
                                   signature=sign(MAC_KEY, other_message), now=NOW)

    def test_registration_needs_a_signed_in_owner(self):
        with self.assertRaises(DeviceRejected):
            self.registry.begin_registration(USER, now=NOW)

    def test_nothing_registers_without_a_verifier_installed(self):
        # A device must not become trusted because nobody installed a verifier.
        bare = DeviceRegistry(ChallengeStore(), RefusingVerifier())
        with self.assertRaises(VerifierUnavailable):
            register(bare, self.owner)

    def test_a_key_cannot_be_registered_twice(self):
        register(self.registry, self.owner)
        with self.assertRaises(DeviceRejected):
            register(self.registry, self.owner, device_id="device-mac-0002")

    def test_another_users_device_is_not_visible_or_revocable(self):
        register(self.registry, self.owner)
        intruder = owner("user-other-0001")
        self.assertEqual(self.registry.list(intruder), ())
        with self.assertRaises(DeviceRejected):
            self.registry.revoke(intruder, "device-mac-0001", now=NOW)


class NamespaceIsolationTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()

    def test_one_account_cannot_learn_that_another_owns_a_device_id(self):
        # A flat namespace made registration an existence oracle: registering
        # somebody else's device_id said "already registered" while an unused one
        # said "did not prove possession". Two distinguishable errors, unlimited
        # attempts, and the challenge was not even consumed on the first path.
        register(self.registry, owner(), device_id="device-alice-mac")
        bob = owner("user-bob-0001")
        challenge = self.registry.begin_registration(bob, now=NOW)
        with self.assertRaises(DeviceRejected):
            self.registry.register(
                bob, device_id="device-alice-mac", name="Not mine", platform="macos",
                identity=identity(PHONE_KEY), challenge=challenge.value,
                signature=b"not a real signature", now=NOW,
            )
        # The challenge is spent either way, so probing is not free.
        with self.assertRaises(ChallengeRejected):
            self.registry.register(
                bob, device_id="device-unused", name="Also not mine", platform="macos",
                identity=identity(PHONE_KEY), challenge=challenge.value,
                signature=b"not a real signature", now=NOW,
            )

    def test_an_id_taken_by_one_account_is_still_free_for_another(self):
        register(self.registry, owner(), device_id="device-mac")
        record = register(
            self.registry, owner("user-bob-0001"), device_id="device-mac", public_key=PHONE_KEY
        )
        self.assertEqual(str(record.user_id), "user-bob-0001")


class SignedStatementTests(unittest.TestCase):
    def test_the_joining_device_id_is_inside_what_the_mac_signs(self):
        # device_id, name and platform sat outside the signed statement while
        # adopt() filed the record under whatever the caller passed. Once a
        # transport sits between the Mac and this call, anything on that path
        # could file the device under an id of its choosing.
        subject = registry()
        holder = owner()
        register(subject, holder)
        pairing = PairingService(subject, HmacVerifier(SECRETS))
        offered = pairing.offer(holder, offering_device_id="device-mac-0001", now=NOW)
        joining = identity(PHONE_KEY)
        join = f"pair-join|{offered.pairing_id}|{offered.nonce}|{joining.public_key}".encode()
        claimed = pairing.claim(
            pairing_id=str(offered.pairing_id), nonce=offered.nonce,
            identity=joining, signature=sign(PHONE_KEY, join), now=NOW,
        )
        # A signature over the OLD message shape, which named no device id.
        stale = (
            f"pair-confirm|{claimed.pairing_id}|{claimed.nonce}|{joining.public_key}"
        ).encode()
        with self.assertRaises(PairingRejected):
            pairing.confirm(
                holder, pairing_id=str(claimed.pairing_id),
                offering_signature=sign(MAC_KEY, stale),
                joining_device_id="device-attacker-0001", joining_identity=joining,
                name="Not the phone", platform="ios", now=NOW,
            )


class AlgorithmBindingTests(unittest.TestCase):
    def test_a_record_cannot_claim_a_curve_the_verifier_never_checked(self):
        # A record could say algorithm: ed25519 while an HMAC verifier checked
        # the signature, and summary() does not expose algorithm -- so the false
        # claim was neither verified nor visible.
        with self.assertRaises(DeviceRejected):
            register(registry(), owner(), identity=identity(MAC_KEY, algorithm="ed25519"))


class SigningKeyIdTests(unittest.TestCase):
    def test_two_long_device_ids_do_not_share_a_signing_key_id(self):
        # _key_id was f"key-{device_id}"[:127] and Identifier permits 128
        # characters, so any two ids sharing their first 123 characters produced
        # the SAME signing key id -- and orion/security/rules.py compares exactly
        # this value to bind a signature to its origin device.
        from backend.devices.registry import _key_id

        shared = "d" + "a" * 122
        left = DeviceRecord(
            device_id=shared + "left", user_id=USER, name="L", platform=Platform.MACOS,
            identity=identity(MAC_KEY), attestation=Attestation(AttestationState.UNATTESTED),
            capabilities=(), created_at=NOW,
        )
        right = DeviceRecord(
            device_id=shared + "rght", user_id=USER, name="R", platform=Platform.MACOS,
            identity=identity(PHONE_KEY), attestation=Attestation(AttestationState.UNATTESTED),
            capabilities=(), created_at=NOW,
        )
        self.assertNotEqual(str(left.device_id), str(right.device_id))
        self.assertEqual(str(left.device_id)[:123], str(right.device_id)[:123])
        self.assertNotEqual(_key_id(left), _key_id(right))


class AdoptionTests(unittest.TestCase):
    """adopt() is the registry's second door. It must be locked like the first."""

    def setUp(self):
        self.owner = owner()
        self.registry = DeviceRegistry(ChallengeStore(), HmacVerifier(SECRETS))
        self.joining = identity(PHONE_KEY)
        self.message = b"pair-join|proof-that-stood-in"
        self.signature = sign(PHONE_KEY, self.message)

    def adopt(self, registry=None, **overrides):
        fields = {
            "device_id": "device-iphone-0001", "name": "Nick's iPhone", "platform": "ios",
            "identity": self.joining, "proven_by": "pairing:pairing-0001",
            "proof_message": self.message, "proof_signature": self.signature, "now": NOW,
        }
        fields.update(overrides)
        return (registry or self.registry).adopt(self.owner, **fields)

    def test_adoption_re_verifies_the_proof_that_stood_in(self):
        # adopt() took no signature and called no verifier: any holder of an Owner
        # could mint a PAIRED device from nothing. The joining device is not online
        # at confirm time, but its earlier signature IS -- so re-check that.
        with self.assertRaises(DeviceRejected):
            self.adopt(proof_signature=sign(MAC_KEY, self.message))

    def test_adoption_refuses_when_no_verifier_is_installed(self):
        # Phase 14's requirement is literally named nothing_is_trusted_without_a
        # _verifier. register() raised VerifierUnavailable; adopt() reached
        # DeviceTrust.PAIRED with RefusingVerifier installed.
        bare = DeviceRegistry(ChallengeStore(), RefusingVerifier())
        with self.assertRaises(VerifierUnavailable):
            self.adopt(bare)

    def test_an_adopted_device_attests_nothing_by_default(self):
        # adopt defaulted to SELF_ATTESTED -- "the device says its key is
        # hardware-backed", a CLAIM -- when the device had claimed nothing.
        record = self.adopt()
        self.assertIs(record.attestation.state, AttestationState.UNATTESTED)

    def test_new_key_cannot_overwrite_revoked_device_id(self):
        register(self.registry, self.owner)
        self.registry.revoke(self.owner, "device-mac-0001", now=NOW)
        before = self.registry.list(self.owner)
        with self.assertRaises(DeviceRejected):
            self.adopt(device_id="device-mac-0001")
        self.assertEqual(self.registry.list(self.owner), before)

    def test_a_good_proof_is_adopted(self):
        record = self.adopt()
        self.assertEqual(str(record.device_id), "device-iphone-0001")


class PolicyDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()
        self.owner = owner()

    def test_the_registry_produces_the_directory_phase_5_asks(self):
        register(self.registry, self.owner)
        directory = self.registry.as_policy_directory(self.owner)
        self.assertIsInstance(directory, DeviceDirectory)
        self.assertIs(directory.trust_of("device-mac-0001"), DeviceTrust.PAIRED)

    def test_revocation_shows_up_immediately(self):
        register(self.registry, self.owner)
        self.registry.revoke(self.owner, "device-mac-0001", now=NOW)
        self.assertIs(
            self.registry.as_policy_directory(self.owner).trust_of("device-mac-0001"),
            DeviceTrust.REVOKED,
        )

    def test_a_failed_attestation_holds_a_device_at_pending(self):
        register(self.registry, self.owner)
        self.registry.record_attestation(
            self.owner, "device-mac-0001", Attestation(AttestationState.FAILED, detail="bad receipt")
        )
        self.assertIs(
            self.registry.as_policy_directory(self.owner).trust_of("device-mac-0001"),
            DeviceTrust.PENDING,
        )

    def test_last_seen_is_recorded_without_changing_trust(self):
        register(self.registry, self.owner)
        touched = self.registry.touch(self.owner, "device-mac-0001", now=NOW + timedelta(hours=1))
        self.assertEqual(touched.last_seen_at, NOW + timedelta(hours=1))
        self.assertIs(touched.trust(), DeviceTrust.PAIRED)


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()
        self.owner = owner()
        register(self.registry, self.owner)
        self.pairing = PairingService(self.registry, HmacVerifier(SECRETS))

    def offer(self, now=NOW) -> Pairing:
        return self.pairing.offer(self.owner, offering_device_id="device-mac-0001", now=now)

    def claim(self, pairing: Pairing, now=NOW, nonce=None) -> Pairing:
        joining = identity(PHONE_KEY)
        message = f"pair-join|{pairing.pairing_id}|{pairing.nonce}|{joining.public_key}".encode()
        return self.pairing.claim(
            pairing_id=str(pairing.pairing_id), nonce=nonce or pairing.nonce,
            identity=joining, signature=sign(PHONE_KEY, message), now=now,
        )

    def confirm(self, pairing: Pairing, now=NOW) -> Pairing:
        joining = identity(PHONE_KEY)
        message = (
            f"pair-confirm|{pairing.pairing_id}|{pairing.nonce}"
            f"|{joining.public_key}|device-iphone-0001"
        ).encode()
        return self.pairing.confirm(
            self.owner,
            pairing_id=str(pairing.pairing_id),
            offering_signature=sign(MAC_KEY, message),
            joining_device_id="device-iphone-0001",
            joining_identity=joining,
            name="Nick's iPhone",
            platform="ios",
            now=now,
        )

    def test_the_joining_devices_possession_proof_is_actually_verified(self):
        # There was NO test for this at all. Deleting the verification from
        # claim() -- accepting any identity with any signature -- left the whole
        # pairing suite green, including the regression where a proof is accepted
        # from ANY registered key rather than the one presenting itself.
        pairing = self.offer()
        joining = identity(PHONE_KEY)
        with self.assertRaises(PairingRejected):
            self.pairing.claim(
                pairing_id=str(pairing.pairing_id), nonce=pairing.nonce,
                identity=joining, signature=sign(MAC_KEY, b"a signature over something else"),
                now=NOW,
            )

    def test_a_proof_from_another_registered_key_is_not_this_devices_proof(self):
        pairing = self.offer()
        joining = identity(PHONE_KEY)
        message = f"pair-join|{pairing.pairing_id}|{pairing.nonce}|{joining.public_key}".encode()
        with self.assertRaises(PairingRejected):
            # The Mac is registered and its signature is valid -- over this exact
            # message. It is still not the joining device's proof.
            self.pairing.claim(
                pairing_id=str(pairing.pairing_id), nonce=pairing.nonce,
                identity=joining, signature=sign(MAC_KEY, message), now=NOW,
            )

    def test_a_revoked_device_cannot_confirm_a_pairing_it_started(self):
        # offer() checked `offering.revoked`; confirm() did not, and confirm() is
        # where the new device is actually admitted. So revoking a compromised Mac
        # between claim and confirm did not stop the attacker walking away with a
        # freshly registered, unrevoked, PAIRED device the owner never approved.
        claimed = self.claim(self.offer())
        self.registry.revoke(self.owner, "device-mac-0001", now=NOW)
        with self.assertRaises(PairingRejected):
            self.confirm(claimed)
        self.assertEqual(
            [str(item.device_id) for item in self.registry.list(self.owner)], ["device-mac-0001"]
        )

    def test_a_pairing_id_is_not_guessable(self):
        # The default id source was f"pairing-{counter:012d}". claim() takes no
        # Owner, and a wrong nonce cancels -- so anyone who could reach the claim
        # path could guess pairing-000000000001, submit junk, and kill every
        # pairing before the owner's phone finished scanning.
        ids = {str(self.offer().pairing_id) for _ in range(8)}
        self.assertEqual(len(ids), 8)
        for value in ids:
            self.assertNotRegex(value, r"^pairing-0+\d$")
            self.assertGreaterEqual(len(value), 24)

    def test_a_non_ascii_nonce_is_refused_rather_than_crashing(self):
        # secrets.compare_digest refuses non-ASCII str, so this raised TypeError
        # out of a method documented to raise PairingRejected -- and it was the
        # one wrong-nonce path that did NOT cancel, making it a probe oracle.
        pairing = self.offer()
        joining = identity(PHONE_KEY)
        with self.assertRaises(PairingRejected):
            self.pairing.claim(
                pairing_id=str(pairing.pairing_id), nonce="n\u00f8nce-with-non-ascii",
                identity=joining, signature=sign(PHONE_KEY, b"x"), now=NOW,
            )
        self.assertEqual(self.pairing.pending(self.owner, now=NOW), ())

    def test_the_adopted_device_records_how_it_was_admitted(self):
        self.confirm(self.claim(self.offer()))
        phone = next(item for item in self.registry.list(self.owner)
                     if str(item.device_id) == "device-iphone-0001")
        self.assertTrue(str(phone.proven_by).startswith("pairing:"))
        # Provenance is NOT a capability: `capabilities` is read as authorization.
        self.assertEqual(phone.capabilities, ())

    def test_a_pairing_needs_proofs_from_both_devices(self):
        pairing = self.offer()
        claimed = self.claim(pairing)
        self.assertIs(claimed.state, PairingState.CLAIMED)
        completed = self.confirm(claimed)
        self.assertIs(completed.state, PairingState.COMPLETED)
        self.assertEqual(len(self.registry.list(self.owner)), 2)

    def test_the_offering_device_alone_cannot_pair_anything(self):
        pairing = self.offer()
        with self.assertRaises(PairingRejected):
            self.confirm(pairing)

    def test_a_wrong_offering_signature_cancels_rather_than_retries(self):
        claimed = self.claim(self.offer())
        with self.assertRaises(PairingRejected):
            self.pairing.confirm(
                self.owner, pairing_id=str(claimed.pairing_id), offering_signature=b"wrong",
                joining_device_id="device-iphone-0001", joining_identity=identity(PHONE_KEY),
                name="phone", platform="ios", now=NOW,
            )
        with self.assertRaises(PairingRejected):
            self.claim(claimed)

    def test_a_nonce_cannot_be_reused(self):
        pairing = self.offer()
        self.claim(pairing)
        with self.assertRaises(PairingRejected):
            self.claim(pairing)

    def test_a_wrong_nonce_cancels_the_pairing(self):
        # A wrong signature on a pairing nonce is not a typo.
        pairing = self.offer()
        with self.assertRaises(PairingRejected):
            self.claim(pairing, nonce="not-the-right-nonce-at-all")
        with self.assertRaises(PairingRejected):
            self.claim(pairing)

    def test_a_pairing_expires_and_expiry_is_checked_at_every_step(self):
        pairing = self.offer()
        with self.assertRaises(PairingRejected):
            self.claim(pairing, now=NOW + PAIRING_LIFETIME)
        second = self.offer(now=NOW)
        claimed = self.claim(second)
        with self.assertRaises(PairingRejected):
            self.confirm(claimed, now=NOW + PAIRING_LIFETIME)

    def test_a_completed_pairing_cannot_be_replayed(self):
        completed = self.confirm(self.claim(self.offer()))
        with self.assertRaises(PairingRejected):
            self.claim(completed)

    def test_the_key_that_claimed_must_be_the_key_that_is_admitted(self):
        claimed = self.claim(self.offer())
        with self.assertRaises(PairingRejected):
            self.pairing.confirm(
                self.owner, pairing_id=str(claimed.pairing_id), offering_signature=b"x",
                joining_device_id="device-iphone-0001", joining_identity=identity(MAC_KEY),
                name="phone", platform="ios", now=NOW,
            )

    def test_a_revoked_device_cannot_admit_another(self):
        self.registry.revoke(self.owner, "device-mac-0001", now=NOW)
        with self.assertRaises(PairingRejected):
            self.offer()

    def test_pairing_is_bound_to_the_account_that_offered_it(self):
        claimed = self.claim(self.offer())
        with self.assertRaises((PairingRejected, DeviceRejected)):
            self.pairing.confirm(
                owner("user-other-0001"), pairing_id=str(claimed.pairing_id),
                offering_signature=b"x", joining_device_id="device-iphone-0001",
                joining_identity=identity(PHONE_KEY), name="phone", platform="ios", now=NOW,
            )

    def test_the_qr_payload_keeps_the_nonce_in_the_fragment(self):
        # Fragments are not sent to servers, so a pairing code that ends up in a
        # URL bar does not end up in an access log.
        payload = self.offer().payload()
        self.assertTrue(payload.startswith("orion-pair://"))
        self.assertIn("#", payload)

    def test_the_security_center_lists_devices_and_anything_in_flight(self):
        pairing = self.offer()
        view = self.pairing.security_center(self.owner, now=NOW)
        self.assertEqual(len(view["devices"]), 1)
        self.assertEqual(view["pending_pairings"][0]["pairing_id"], str(pairing.pairing_id))
        self.pairing.cancel(self.owner, str(pairing.pairing_id), now=NOW)
        self.assertEqual(self.pairing.security_center(self.owner, now=NOW)["pending_pairings"], [])


if __name__ == "__main__":
    unittest.main()
