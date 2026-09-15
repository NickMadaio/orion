"""Real asymmetric signatures through registration, pairing and revocation."""
import base64
import unittest
from datetime import datetime, timedelta, timezone

from backend.devices.p256 import P256Verifier
from backend.devices.proofs import VerifierUnavailable
from backend.devices.identity import DeviceIdentity
from backend.devices.registry import DeviceRegistry, DeviceRejected, _registration_message
from backend.pairing.session import PairingService, PairingRejected, PairingState
from backend.ownership import Session, resolve_owner

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except ImportError:
    ec = None


def public(key):
    return base64.b64encode(key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).decode('ascii')


def sign(key, message):
    return key.sign(message, ec.ECDSA(hashes.SHA256()))


@unittest.skipIf(ec is None, 'requires device-crypto extra; run explicitly in crypto-enabled runtime')
class RealPairingTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.owner = resolve_owner(Session('fixture-session', 'fixture-owner', 'fixture-mac'))
        self.mac = ec.generate_private_key(ec.SECP256R1())
        self.phone = ec.generate_private_key(ec.SECP256R1())
        self.verifier = P256Verifier()
        self.registry = DeviceRegistry(verifier=self.verifier)
        identity = DeviceIdentity(public(self.mac), self.verifier.algorithm, False)
        challenge = self.registry.begin_registration(self.owner, now=self.now)
        message = _registration_message(self.owner, 'fixture-mac', identity, challenge.value)
        self.registry.register(self.owner, device_id='fixture-mac', name='Test Mac', platform='macos',
                               identity=identity, challenge=challenge.value, signature=sign(self.mac, message), now=self.now)
        self.service = PairingService(self.registry)
        self.identity = DeviceIdentity(public(self.phone), self.verifier.algorithm, False)
        self.offer = self.service.offer(self.owner, offering_device_id='fixture-mac', now=self.now)

    def claim(self):
        return self.service.claim(pairing_id=self.offer.pairing_id, nonce=self.offer.nonce,
            identity=self.identity, signature=sign(self.phone, self.service._join_message(self.offer, self.identity)), now=self.now)

    def confirm(self, device_id='fixture-phone', now=None, signature=None):
        message = self.service._confirm_message(self.offer, self.identity, device_id)
        return self.service.confirm(self.owner, pairing_id=self.offer.pairing_id,
            offering_signature=signature if signature is not None else sign(self.mac, message),
            joining_device_id=device_id, joining_identity=self.identity, name='Test phone', platform='ios', now=now or self.now)

    def test_real_pairing_then_revoke_and_replay_refusal(self):
        self.claim()
        self.assertEqual(len(self.registry.list(self.owner)), 1)
        self.assertEqual(self.confirm().state, PairingState.COMPLETED)
        with self.assertRaises(PairingRejected): self.confirm()
        self.assertTrue(self.registry.revoke(self.owner, 'fixture-phone', now=self.now).revoked)

    def test_revoked_record_cannot_be_overwritten_by_new_key(self):
        # This used to pass: adopt checked a string in a dict keyed by tuples.
        self.registry.revoke(self.owner, 'fixture-mac', now=self.now)
        before = self.registry.list(self.owner)
        message = b'new key with a valid proof'
        with self.assertRaises(DeviceRejected):
            self.registry.adopt(self.owner, device_id='fixture-mac', name='Replacement', platform='ios',
                identity=self.identity, proven_by='pairing:test', proof_message=message,
                proof_signature=sign(self.phone, message), now=self.now)
        self.assertEqual(self.registry.list(self.owner), before)

    def test_confirm_cannot_replace_existing_offering_device(self):
        self.claim()
        with self.assertRaises(DeviceRejected): self.confirm(device_id='fixture-mac')
        self.assertEqual(len(self.registry.list(self.owner)), 1)

    def test_revoked_offering_device_cannot_confirm(self):
        self.claim()
        self.registry.revoke(self.owner, 'fixture-mac', now=self.now)
        with self.assertRaises(PairingRejected): self.confirm()

    def test_expiry_between_claim_and_confirm(self):
        self.claim()
        with self.assertRaises(PairingRejected): self.confirm(now=self.now + timedelta(minutes=2))

    def test_wrong_confirmation_cancels(self):
        self.claim()
        with self.assertRaises(PairingRejected): self.confirm(signature=sign(self.phone, b'wrong'))
        with self.assertRaises(PairingRejected): self.confirm()

    def test_invalid_claim_cancels(self):
        with self.assertRaises(PairingRejected):
            self.service.claim(pairing_id=self.offer.pairing_id, nonce=self.offer.nonce,
                identity=self.identity, signature=sign(self.mac, b'wrong'), now=self.now)
        with self.assertRaises(PairingRejected): self.claim()

    def test_signature_tampering_wrong_key_hash_and_encoding(self):
        message = b'pairing proof'
        signature = sign(self.phone, message)
        self.assertTrue(self.verifier.verify(public(self.phone), message, signature))
        self.assertFalse(self.verifier.verify(public(self.phone), message+b'x', signature))
        self.assertFalse(self.verifier.verify(public(self.mac), message, signature))
        self.assertFalse(self.verifier.verify(public(self.phone), message, signature+b'x'))
        self.assertFalse(self.verifier.verify(public(self.phone), message,
            self.phone.sign(message, ec.ECDSA(hashes.SHA384()))))
        for key in ['', public(self.phone)+'\n', 'A'*88, base64.b64encode(b'\x04'+bytes(64)).decode()]:
            self.assertFalse(self.verifier.verify(key, message, signature))
        self.assertFalse(self.verifier.verify(public(self.phone), bytes(16385), signature))

    def test_default_still_refuses(self):
        registry = DeviceRegistry()
        challenge = registry.begin_registration(self.owner, now=self.now)
        with self.assertRaises(VerifierUnavailable):
            registry.register(self.owner, device_id='default-phone', name='Test', platform='ios',
                identity=self.identity, challenge=challenge.value, signature=b'ignored', now=self.now)

if __name__ == '__main__': unittest.main()
