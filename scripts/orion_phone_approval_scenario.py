"""Test the registered Simulator phone as an offering device, via explicit UI.

Initial phone admission is performed by the existing disposable fixture harness.
This second flow uses the phone's actual persistent key to sign confirmation.
"""
import base64
import hashlib
import json
import os
import subprocess

from backend.devices.identity import DeviceIdentity
from backend.pairing.session import PairingRejected, PairingState


def check_approval(registry, service, owner, phone, now, build, derived, run, container):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from orion_v2_phone_pairing_check import cleanup_pairing_files
    names = ('pairing-approval-request.json', 'pairing-approval-response.json')
    fingerprint = hashlib.sha256(base64.b64decode(phone.public_key)).hexdigest()
    for mode, test in [('approve', 'Accept'), ('reject', 'Reject'), ('expired', 'Expired')]:
        directory = container()
        if any((directory / name).exists() for name in names):
            raise RuntimeError('Existing approval test files preserved')
        joining_key = ec.generate_private_key(ec.SECP256R1())
        public = base64.b64encode(joining_key.public_key().public_bytes(serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint)).decode('ascii')
        identity = DeviceIdentity(public, phone.algorithm, False)
        offer = service.offer(owner, offering_device_id='pairing-test-phone', now=now())
        service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=identity,
            signature=joining_key.sign(service._join_message(offer, identity), ec.ECDSA(hashes.SHA256())), now=now())
        device_id = 'reviewed-test-device-' + mode
        try:
            fd = os.open(directory / names[0], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(dict(schema=1, ownerID=str(owner.user_id), pairingID=str(offer.pairing_id),
                    nonce=offer.nonce, offeringFingerprint=fingerprint, joiningDeviceID=device_id,
                    joiningPublicKey=public, expiresAt=now().timestamp()-1 if mode == 'expired' else offer.expires_at.timestamp()), stream)
            before = registry.list(owner)
            with (derived / ('approval-' + mode + '.log')).open('w') as log:
                run(build + ['-only-testing:OrionPhoneUITests/PhoneShellTests/testPairingApproval' + test,
                    'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
            response = container() / names[1]
            assert registry.list(owner) == before, 'UI signing must not claim server admission'
            if mode == 'expired':
                assert not response.exists(), 'Expired request must not produce a signature'
                service.cancel(owner, offer.pairing_id, now=now())
                continue
            assert response.stat().st_size <= 4096
            proof = json.loads(response.read_text())
            assert proof['pairingID'] == str(offer.pairing_id) and proof['decision'] == mode
            if mode == 'reject':
                assert proof.get('signature') is None
                service.cancel(owner, offer.pairing_id, now=now())
                continue
            signature = base64.b64decode(proof['signature'], validate=True)
            assert registry._verifier.verify(phone.public_key, service._confirm_message(offer, identity, device_id), signature)
            assert not registry._verifier.verify(phone.public_key, service._confirm_message(offer, identity, 'changed-device-id'), signature)
            completed = service.confirm(owner, pairing_id=offer.pairing_id, offering_signature=signature,
                joining_device_id=device_id, joining_identity=identity, name='Reviewed test device', platform='macos', now=now())
            assert completed.state is PairingState.COMPLETED
            try:
                service.confirm(owner, pairing_id=offer.pairing_id, offering_signature=signature,
                    joining_device_id=device_id, joining_identity=identity, name='Replay', platform='macos', now=now())
            except PairingRejected:
                pass
            else: raise RuntimeError('Approval replay accepted')
        finally:
            cleanup_pairing_files(directory, container, names, str(offer.pairing_id))
    print('PASS: explicit Simulator approval signs exact joining key/id; rejection and expired requests produce no approval; replay refused')
