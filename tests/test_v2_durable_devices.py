"""Restart, concurrent-writer and failed-storage proofs for device trust."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import timedelta

from backend.devices.durable import DurableDeviceRegistry, DeviceStoreError
from backend.devices.registry import DeviceRejected
from backend.devices.identity import Attestation, AttestationState
from backend.pairing.session import PairingService, PairingRejected, PairingState
from tests.test_v2_device_identity import NOW, owner, identity, sign, register, SECRETS, MAC_KEY, PHONE_KEY
from backend.devices.proofs import HmacVerifier, VerifierUnavailable


class DurableDeviceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'private'
        self.owner = owner()
        self.registry = DurableDeviceRegistry(self.path, verifier=HmacVerifier(SECRETS), create=True)

    def open(self):
        return DurableDeviceRegistry(self.path, verifier=HmacVerifier(SECRETS))

    def test_restart_preserves_registration_attestation_and_revocation(self):
        register(self.registry, self.owner)
        self.registry.touch(self.owner, 'device-mac-0001', now=NOW + timedelta(seconds=1))
        self.registry.record_attestation(self.owner, 'device-mac-0001', Attestation(AttestationState.FAILED, NOW, 'test failure'))
        record = self.registry.revoke(self.owner, 'device-mac-0001', now=NOW + timedelta(seconds=2))
        self.assertEqual(self.open().list(self.owner), (record,))
        # A separate interpreter proves this is not a shared Python object/cache.
        code = '''from pathlib import Path
import sys
from backend.devices.durable import DurableDeviceRegistry
from tests.test_v2_device_identity import owner
r=DurableDeviceRegistry(Path(sys.argv[1]))
rows=r.list(owner())
assert len(rows)==1 and rows[0].revoked and rows[0].attestation.state.value=='failed'
print('persisted-revocation')
'''
        result = subprocess.check_output([sys.executable, '-c', code, str(self.path)], text=True)
        self.assertEqual(result.strip(), 'persisted-revocation')

    def test_stale_instance_touch_cannot_restore_revoked_trust(self):
        register(self.registry, self.owner)
        other = self.open()
        other.list(self.owner)
        self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
        record = other.touch(self.owner, 'device-mac-0001', now=NOW + timedelta(seconds=1))
        self.assertTrue(record.revoked)
        self.assertTrue(self.registry.list(self.owner)[0].revoked)

    def test_other_owner_cannot_read_or_revoke(self):
        register(self.registry, self.owner)
        other = owner('other-account')
        self.assertEqual(self.open().list(other), ())
        with self.assertRaises(DeviceRejected): self.registry.revoke(other, 'device-mac-0001', now=NOW)
        self.assertFalse(self.registry.list(self.owner)[0].revoked)

    def test_pending_challenges_and_pairings_die_on_restart(self):
        register(self.registry, self.owner)
        service = PairingService(self.registry)
        offer = service.offer(self.owner, offering_device_id='device-mac-0001', now=NOW)
        fresh = PairingService(self.open())
        with self.assertRaises(PairingRejected):
            fresh.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=identity(PHONE_KEY), signature=b'bad', now=NOW)
        self.assertEqual(self.open().challenges.outstanding, 0)

    def test_two_instances_cannot_register_duplicate_key(self):
        other = self.open()
        barrier = threading.Barrier(2)
        outcomes = []
        def attempt(registry):
            barrier.wait()
            try:
                register(registry, self.owner)
                outcomes.append('registered')
            except DeviceRejected:
                outcomes.append('rejected')
        threads = [threading.Thread(target=attempt, args=(r,)) for r in (self.registry, other)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(10)
        self.assertCountEqual(outcomes, ['registered', 'rejected'])
        self.assertEqual(len(self.open().list(self.owner)), 1)

    def test_confirmation_and_concurrent_revocation_serialize(self):
        entered, release, revoke_started, revoked = (threading.Event() for _ in range(4))
        class PausingVerifier(HmacVerifier):
            def verify(self, key, message, signature):
                if message.startswith(b'pair-confirm|'):
                    entered.set()
                    if not release.wait(3): raise RuntimeError('test synchronization timeout')
                return super().verify(key, message, signature)
        registry = DurableDeviceRegistry(self.path, verifier=PausingVerifier(SECRETS))
        register(registry, self.owner)
        service = PairingService(registry)
        offer = service.offer(self.owner, offering_device_id='device-mac-0001', now=NOW)
        phone = identity(PHONE_KEY)
        service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=phone,
            signature=sign(PHONE_KEY, service._join_message(offer, phone)), now=NOW)
        failures = []
        def confirm():
            try:
                service.confirm(self.owner, pairing_id=offer.pairing_id,
                    offering_signature=sign(MAC_KEY, service._confirm_message(offer, phone, 'new-phone')),
                    joining_device_id='new-phone', joining_identity=phone, name='Phone', platform='ios', now=NOW)
            except Exception as error: failures.append(error)
        def revoke():
            revoke_started.set()
            try:
                self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
                revoked.set()
            except Exception as error: failures.append(error)
        confirming = threading.Thread(target=confirm)
        revoking = threading.Thread(target=revoke)
        confirming.start()
        try:
            self.assertTrue(entered.wait(2))
            revoking.start()
            self.assertTrue(revoke_started.wait(2))
            self.assertFalse(revoked.wait(0.1), 'Revocation must not commit inside confirmation')
        finally:
            release.set()
            confirming.join(5)
            if revoking.ident is not None: revoking.join(5)
        self.assertEqual(failures, [])
        self.assertTrue(revoked.is_set())
        records = self.open().list(self.owner)
        self.assertEqual(len(records), 2)
        self.assertTrue(next(r for r in records if str(r.device_id)=='device-mac-0001').revoked)

    def test_failed_transaction_rolls_back_and_does_not_cache_trust(self):
        register(self.registry, self.owner)
        with self.assertRaises(RuntimeError):
            with self.registry.transaction():
                self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
                raise RuntimeError('fixture failure before commit')
        self.assertFalse(self.registry.list(self.owner)[0].revoked)
        self.assertFalse(self.open().list(self.owner)[0].revoked)

    def test_write_failure_never_reports_success(self):
        register(self.registry, self.owner)
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db:
            db.execute("CREATE TRIGGER refuse_update BEFORE UPDATE ON devices BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        with self.assertRaises(DeviceStoreError):
            self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
        self.assertFalse(self.registry.list(self.owner)[0].revoked)

    def test_failed_pairing_commit_cancels_instead_of_reporting_completed(self):
        register(self.registry, self.owner)
        service = PairingService(self.registry)
        offer = service.offer(self.owner, offering_device_id='device-mac-0001', now=NOW)
        phone = identity(PHONE_KEY)
        service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=phone,
            signature=sign(PHONE_KEY, service._join_message(offer, phone)), now=NOW)
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db:
            db.execute("CREATE TRIGGER refuse_insert BEFORE INSERT ON devices BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        def confirm():
            return service.confirm(self.owner, pairing_id=offer.pairing_id,
                offering_signature=sign(MAC_KEY, service._confirm_message(offer, phone, 'new-phone')),
                joining_device_id='new-phone', joining_identity=phone, name='Phone', platform='ios', now=NOW)
        with self.assertRaises(DeviceStoreError): confirm()
        self.assertEqual(service._pairings[str(offer.pairing_id)].state, PairingState.CANCELLED)
        self.assertEqual(len(self.open().list(self.owner)), 1)
        with self.assertRaises(PairingRejected): confirm()

    def test_corrupt_record_refuses_instead_of_becoming_empty(self):
        register(self.registry, self.owner)
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db:
            db.execute("UPDATE devices SET body='{}'")
        with self.assertRaises(DeviceStoreError): self.registry.list(self.owner)
        with self.assertRaises(DeviceStoreError): self.open()

    def test_mismatched_record_owner_refuses(self):
        register(self.registry, self.owner)
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db:
            body = json.loads(db.execute('SELECT body FROM devices').fetchone()[0])
            body['user_id'] = 'different-owner'
            db.execute('UPDATE devices SET body=?', (json.dumps(body),))
        with self.assertRaises(DeviceStoreError): self.registry.list(self.owner)

    def test_unknown_schema_preserved_and_refused(self):
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db: db.execute('PRAGMA user_version=99')
        with self.assertRaises(DeviceStoreError): self.open()
        with closing(sqlite3.connect(self.path / 'devices.sqlite3')) as db, db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 99)

    def test_private_permissions_and_symlinks(self):
        self.assertEqual((self.path.stat().st_mode & 0o777), 0o700)
        self.assertEqual(((self.path / 'devices.sqlite3').stat().st_mode & 0o777), 0o600)
        self.path.chmod(0o755)
        with self.assertRaises(PermissionError): self.open()
        self.path.chmod(0o700)
        link = Path(self.temp.name) / 'link'
        link.symlink_to(self.path, target_is_directory=True)
        with self.assertRaises(PermissionError): DurableDeviceRegistry(link)

    def test_missing_database_does_not_recreate_on_read(self):
        (self.path / 'devices.sqlite3').unlink()
        with self.assertRaises(FileNotFoundError): self.registry.list(self.owner)
        self.assertFalse((self.path / 'devices.sqlite3').exists())

    def test_reopen_deleted_or_truncated_database_refuses(self):
        register(self.registry, self.owner)
        self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
        database = self.path / 'devices.sqlite3'
        database.write_bytes(b'')
        with self.assertRaises(DeviceStoreError): self.open()
        self.assertEqual(database.stat().st_size, 0)
        database.unlink()
        with self.assertRaises(FileNotFoundError): self.open()
        self.assertFalse(database.exists())

    def test_create_never_overwrites_existing_store(self):
        register(self.registry, self.owner)
        with self.assertRaises(FileExistsError): DurableDeviceRegistry(self.path, create=True)
        self.assertEqual(len(self.open().list(self.owner)), 1)

    def test_default_verifier_still_refuses_registration(self):
        refusing = DurableDeviceRegistry(self.path)
        with self.assertRaises(VerifierUnavailable): register(refusing, self.owner)
        self.assertEqual(refusing.list(self.owner), ())

    def test_revoked_offering_device_cannot_pair_through_stale_instance(self):
        register(self.registry, self.owner)
        other = self.open()
        service = PairingService(other)
        offer = service.offer(self.owner, offering_device_id='device-mac-0001', now=NOW)
        phone = identity(PHONE_KEY)
        service.claim(pairing_id=offer.pairing_id, nonce=offer.nonce, identity=phone,
            signature=sign(PHONE_KEY, service._join_message(offer, phone)), now=NOW)
        self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
        with self.assertRaises(PairingRejected):
            service.confirm(self.owner, pairing_id=offer.pairing_id,
                offering_signature=sign(MAC_KEY, service._confirm_message(offer, phone, 'new-phone')),
                joining_device_id='new-phone', joining_identity=phone, name='New phone', platform='ios', now=NOW)
        self.assertEqual(len(other.list(self.owner)), 1)

if __name__ == '__main__': unittest.main()
