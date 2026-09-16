#!/usr/bin/env python3
"""Disposable two-device pairing proof using the Simulator's persistent key.

No listener, real account or read token is created. A temporary durable registry
is used to verify that revoked trust survives reopening and a process restart.
The offering Mac is an ephemeral fixture; its confirmation is test orchestration,
not evidence of a human approval UI. Requires the device-crypto optional extra.
"""
import base64
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.devices.p256 import P256Verifier
from backend.devices.identity import DeviceIdentity
from backend.devices.registry import _registration_message
from backend.devices.durable import DurableDeviceRegistry
from backend.ownership import Session, resolve_owner
from backend.pairing.session import PairingService, PairingRejected, PairingState


def cleanup(path, pairing_id):
    try:
        if json.loads(path.read_text()).get('pairingID') == pairing_id:
            path.unlink()
    except (OSError, ValueError, AttributeError):
        pass


def cleanup_pairing_files(directory, container, names, pairing_id):
    try:
        candidates = {directory, container()}
    except subprocess.CalledProcessError:
        candidates = {directory}
    for candidate in candidates:
        for name in names:
            cleanup(candidate / name, pairing_id)


def main():
    verifier = P256Verifier()  # Fail before building if the optional runtime is absent.
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    os.chdir(ROOT)
    env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device', nargs='?', default='98256948-7A0B-4AE9-9928-8ED1A66C971F')
    parser.add_argument('--approval', action='store_true', help='also test persistent phone key as the offering device')
    options = parser.parse_args()
    device = options.device
    derived = ROOT / '.builds/phone-pairing-check'
    derived.mkdir(parents=True, exist_ok=True)
    def run(args, **kwargs):
        return subprocess.run(args, env=env, check=True, **kwargs)
    def container():
        return Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', device,
            'com.nickmadaio.orion.phone', 'data'], env=env, text=True).strip()) / 'Documents'
    build = ['xcodebuild', '-project', 'native/OrionMobile/OrionMobile.xcodeproj', '-scheme', 'OrionPhone',
        '-destination', f'platform=iOS Simulator,id={device}', '-derivedDataPath', str(derived),
        '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']
    with (derived / 'build.log').open('w') as log:
        run(build + ['build-for-testing'], stdout=log, stderr=subprocess.STDOUT)
    run(['xcrun', 'simctl', 'bootstatus', device, '-b'], stdout=subprocess.DEVNULL)
    run(['xcrun', 'simctl', 'install', device, str(derived / 'Build/Products/Debug-iphonesimulator/OrionPhone.app')])
    directory = container()
    directory.mkdir(exist_ok=True)
    names = ('pairing-test-request.json', 'pairing-test-response.json')
    if any((directory / name).exists() for name in names):
        raise RuntimeError('Existing pairing test files preserved; inspect them before retrying')
    now = lambda: datetime.now(timezone.utc)
    owner = resolve_owner(Session('pairing-test-session', 'pairing-test-owner', 'pairing-test-mac'))
    mac = ec.generate_private_key(ec.SECP256R1())
    key = base64.b64encode(mac.public_key().public_bytes(serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint)).decode('ascii')
    identity = DeviceIdentity(key, verifier.algorithm, False)
    sign = lambda message: mac.sign(message, ec.ECDSA(hashes.SHA256()))
    store = tempfile.TemporaryDirectory(prefix='orion-pairing-registry-')
    try:
        return run_pairing(store, verifier, owner, identity, sign, now, directory, names, build, derived, run, container, env, device, options.approval)
    finally:
        store.cleanup()


def run_pairing(store, verifier, owner, identity, sign, now, directory, names, build, derived, run, container, env, device, approval=False):
    registry_path = Path(store.name) / 'private'
    registry = DurableDeviceRegistry(registry_path, verifier=verifier, create=True)
    challenge = registry.begin_registration(owner, now=now())
    registry.register(owner, device_id='pairing-test-mac', name='Ephemeral test Mac', platform='macos',
        identity=identity, challenge=challenge.value,
        signature=sign(_registration_message(owner, 'pairing-test-mac', identity, challenge.value)), now=now())
    service = PairingService(registry)
    offer = service.offer(owner, offering_device_id='pairing-test-mac', now=now())
    try:
        fd = os.open(directory / names[0], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(dict(schema=1, pairingID=str(offer.pairing_id), nonce=offer.nonce,
                expiresAt=offer.expires_at.timestamp()), stream)
        with (derived / 'ui.log').open('w') as log:
            run(build + ['-only-testing:OrionPhoneUITests/PhoneShellTests/testPairingClaimProof',
                'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
        response = container() / names[1]
        if response.stat().st_size > 4096:
            raise RuntimeError('Oversized pairing proof')
        proof = json.loads(response.read_text())
        if proof['pairingID'] != str(offer.pairing_id) or proof['algorithm'] != verifier.algorithm:
            raise RuntimeError('Mismatched pairing proof')
        phone = DeviceIdentity(proof['publicKey'], proof['algorithm'], False)
        signature = base64.b64decode(proof['signature'], validate=True)
        message = service._join_message(offer, phone)
        assert verifier.verify(phone.public_key, message, signature)
        assert not verifier.verify(phone.public_key, message + b'tampered', signature)
        service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=phone, signature=signature, now=now())
        assert len(registry.list(owner)) == 1, 'Claim must not admit the phone'
        completed = service.confirm(owner, pairing_id=offer.pairing_id,
            offering_signature=sign(service._confirm_message(offer, phone, 'pairing-test-phone')),
            joining_device_id='pairing-test-phone', joining_identity=phone,
            name='Simulator test phone', platform='ios', now=now())
        assert completed.state is PairingState.COMPLETED
        try:
            service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=phone, signature=signature, now=now())
        except PairingRejected:
            pass
        else:
            raise RuntimeError('Spent pairing accepted a replay')
        if approval:
            from orion_phone_approval_scenario import check_approval
            check_approval(registry, service, owner, phone, now, build, derived, run, container)
        reopened = DurableDeviceRegistry(registry_path, verifier=verifier)
        assert len(reopened.list(owner)) == (3 if approval else 2)
        assert reopened.revoke(owner, 'pairing-test-phone', now=now()).revoked
        assert registry._owned(owner, 'pairing-test-phone').revoked
        # A separate interpreter has neither this process's keys nor registry cache.
        code = """from pathlib import Path
import sys
from backend.devices.durable import DurableDeviceRegistry
from backend.ownership import Session, resolve_owner
owner=resolve_owner(Session('pairing-test-session','pairing-test-owner','pairing-test-mac'))
registry=DurableDeviceRegistry(Path(sys.argv[1]))
assert registry._owned(owner,'pairing-test-phone').revoked
assert len(registry.list(owner)) in (2,3)
print('PASS: revoked phone remains revoked after process restart')
"""
        run([sys.executable, '-c', code, str(registry_path)])
        print('PASS: persistent Simulator key -> real P-256 verification -> two-sided fixture pairing -> replay refusal -> durable revocation')
        print('No real account paired; offering key and temporary registry are disposable; real-account transport and physical-device approval remain unproven.')
    finally:
        try:
            candidates = {directory, container()}
        except subprocess.CalledProcessError:
            candidates = {directory}
        for candidate in candidates:
            for name in names:
                cleanup(candidate / name, str(offer.pairing_id))
        subprocess.run(['xcrun', 'simctl', 'terminate', device, 'com.nickmadaio.orion.phone'], env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
