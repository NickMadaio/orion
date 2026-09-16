"""Registered-device session possession, lifecycle and actual HTTP refusal."""
from contextlib import closing
from datetime import timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from backend.local_today.device_sessions import DeviceReadSessions
from backend.local_today.repository import TodaySnapshotRepository
from backend.adapters.local_today import local_server
from backend.devices.durable import DurableDeviceRegistry
from backend.devices.identity import Attestation, AttestationState
from backend.devices.proofs import ChallengeRejected, HmacVerifier
from backend.devices.registry import DeviceRejected
from tests.test_v2_device_identity import owner, register, NOW, MAC_KEY, PHONE_KEY, sign, SECRETS

class DeviceReadSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.registry = DurableDeviceRegistry(self.root/'devices', verifier=HmacVerifier(SECRETS), create=True)
        self.owner = owner()
        register(self.registry, self.owner)
        self.clock = 100.0
        self.sessions = DeviceReadSessions(self.registry, clock=lambda:self.clock)

    def proof(self, challenge, key=MAC_KEY, device='device-mac-0001'):
        return sign(key, self.sessions.message(self.owner, device, MAC_KEY, challenge))

    def grant(self):
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        return self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
            signature=self.proof(challenge.value), now=NOW)

    def test_possession_then_expiry(self):
        token = self.grant()
        resolved = self.sessions.resolve('Bearer '+token)
        self.assertEqual(str(resolved.user_id), str(self.owner.user_id))
        self.assertEqual(str(resolved.device_id), 'device-mac-0001')
        self.clock += 300
        self.assertIsNone(self.sessions.resolve('Bearer '+token))

    def test_challenge_single_use_even_after_invalid_proof(self):
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        with self.assertRaises(DeviceRejected):
            self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
                signature=self.proof(challenge.value, PHONE_KEY), now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
                signature=self.proof(challenge.value), now=NOW)

    def test_expired_challenge_and_other_owner_refused(self):
        with self.assertRaises(DeviceRejected): self.sessions.begin(owner('other-owner'), 'device-mac-0001', now=NOW)
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        with self.assertRaises(ChallengeRejected):
            self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
                signature=self.proof(challenge.value), now=NOW+timedelta(minutes=5))

    def test_registration_signature_cannot_open_session(self):
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        with self.assertRaises(DeviceRejected):
            self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
                signature=sign(MAC_KEY, f'register|{self.owner.user_id}|device-mac-0001|{MAC_KEY}|{challenge.value}'.encode()), now=NOW)

    def test_restart_invalidates_token_and_challenges(self):
        token = self.grant()
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        fresh = DeviceReadSessions(self.registry)
        self.assertIsNone(fresh.resolve('Bearer '+token))
        with self.assertRaises(ChallengeRejected):
            fresh.exchange(self.owner, 'device-mac-0001', challenge=challenge.value, signature=self.proof(challenge.value), now=NOW)

    def test_revocation_between_challenge_and_exchange_refuses(self):
        challenge = self.sessions.begin(self.owner, 'device-mac-0001', now=NOW)
        self.registry.revoke(self.owner, 'device-mac-0001', now=NOW)
        with self.assertRaises(DeviceRejected):
            self.sessions.exchange(self.owner, 'device-mac-0001', challenge=challenge.value,
                signature=self.proof(challenge.value), now=NOW)

    def test_failed_attestation_retires_token_permanently(self):
        token = self.grant()
        self.registry.record_attestation(self.owner, 'device-mac-0001', Attestation(AttestationState.FAILED))
        self.assertIsNone(self.sessions.resolve('Bearer '+token))
        self.registry.record_attestation(self.owner, 'device-mac-0001', Attestation(AttestationState.UNATTESTED))
        self.assertIsNone(self.sessions.resolve('Bearer '+token))

    def test_real_http_revocation_and_storage_outage(self):
        token = self.grant()
        repo = TodaySnapshotRepository(self.root/'today')
        repo.put(self.owner, 'today-plan', {'revision':1,'capturedAt':0,'plan':None})
        server = local_server(repo, self.sessions)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def get():
            request = Request(f'http://127.0.0.1:{server.server_port}/plan', headers={'Authorization':'Bearer '+token})
            try: response = urlopen(request, timeout=3)
            except HTTPError as error: response=error
            with response: return response.status, json.load(response)
        try:
            self.assertEqual(get()[0], 200)
            other = DurableDeviceRegistry(self.root/'devices', verifier=HmacVerifier(SECRETS))
            with closing(sqlite3.connect(self.root/'devices/devices.sqlite3')) as db, db:
                db.execute('PRAGMA user_version=99')
            self.assertEqual(get(), (503, {'error':'unavailable'}))
            with closing(sqlite3.connect(self.root/'devices/devices.sqlite3')) as db, db:
                db.execute('PRAGMA user_version=1')
            self.assertEqual(get()[0], 200)
            other.revoke(self.owner, 'device-mac-0001', now=NOW)
            self.assertEqual(get(), (401, {'error':'unauthorized'}))
        finally:
            server.shutdown(); server.server_close(); thread.join(3)

if __name__ == '__main__': unittest.main()
