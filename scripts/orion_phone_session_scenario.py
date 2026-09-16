"""Persistent Simulator key -> signed session exchange -> HTTP read -> revocation.

Account enrollment still belongs to the disposable pairing harness. Challenge
and bearer delivery use private Simulator files, not a production auth endpoint.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from backend.adapters.local_today import local_server
from backend.local_today.device_sessions import DeviceReadSessions
from backend.local_today.repository import TodaySnapshotRepository
from backend.devices.proofs import ChallengeRejected


def check_phone_session(registry, owner, phone, now, build, derived, run, container):
    root = Path(__file__).resolve().parents[1]
    with (derived/'session-export-build.log').open('w') as log:
        run(['swift','build','--package-path','native/OrionMobile','--product','TodayPlanExport'], stdout=log, stderr=subprocess.STDOUT)
    snapshot = json.loads(run([str(root/'native/OrionMobile/.build/debug/TodayPlanExport'),'--fixture'], capture_output=True).stdout)
    snapshot['capturedAt'] = 0
    directory = container()
    names = ('read-session-request.json', 'read-session-response.json')
    if any((directory/name).exists() for name in (*names, 'local-today.json')):
        raise RuntimeError('Existing session/bootstrap files preserved')
    sessions = DeviceReadSessions(registry)
    challenge = sessions.begin(owner, 'pairing-test-phone', now=now())
    token = None
    directories = {directory}
    try:
        fd = os.open(directory/names[0], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd,'w') as stream:
            json.dump(dict(schema=1, ownerID=str(owner.user_id), deviceID='pairing-test-phone',
                publicKey=phone.public_key, challenge=challenge.value, expiresAt=challenge.expires_at.timestamp()), stream)
        with (derived/'session-proof.log').open('w') as log:
            run(build + ['-only-testing:OrionPhoneUITests/PhoneShellTests/testPersistentKeyReadSessionProof',
                         'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
        response = container()/names[1]
        directories.add(response.parent)
        if response.stat().st_size > 4096: raise RuntimeError('Oversized session proof')
        proof = json.loads(response.read_text())
        assert proof['challenge'] == challenge.value and proof['publicKey'] == phone.public_key
        signature = base64.b64decode(proof['signature'], validate=True)
        token = sessions.exchange(owner, 'pairing-test-phone', challenge=challenge.value, signature=signature, now=now(), lifetime=300)
        try:
            sessions.exchange(owner, 'pairing-test-phone', challenge=challenge.value, signature=signature, now=now())
        except ChallengeRejected:
            pass
        else: raise RuntimeError('Session proof replay accepted')

        class ScenarioRepository(TodaySnapshotRepository):
            calls = 0
            def get(self, owner, record_id):
                self.calls += 1
                if self.calls == 2: raise OSError('synthetic snapshot outage')
                result = super().get(owner, record_id)
                if self.calls == 3:
                    registry.revoke(owner, 'pairing-test-phone', now=now())
                return result

        with tempfile.TemporaryDirectory(prefix='orion-phone-read-') as path:
            repo = ScenarioRepository(Path(path)/'private')
            repo.put(owner, 'today-plan', snapshot)
            server = local_server(repo, sessions)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                bootstrap = container()/'local-today.json'
                directories.add(bootstrap.parent)
                fd = os.open(bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd,'w') as stream:
                    json.dump(dict(port=server.server_port, owner=str(owner.user_id), token=token), stream)
                with (derived/'session-read.log').open('w') as log:
                    run(build + ['-only-testing:OrionPhoneUITests/PhoneShellTests/testLocalReadRecoveryAndRevocation',
                                 'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
                assert repo.calls == 3
                assert sessions.resolve('Bearer '+token) is None
                assert registry._owned(owner, 'pairing-test-phone').revoked
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=3)
        print('PASS: persistent phone key opens read session; proof replay refused; HTTP read/outage/recovery pass; durable revoke clears phone reading')
    finally:
        if token is not None: sessions.revoke(token)
        cleanup_session_files(directories, container, names, challenge.value, token)


def cleanup_session_files(directories, container, names, challenge, token):
    from scripts.orion_v2_phone_pairing_check import cleanup
    from scripts.orion_v2_phone_read_check import remove_matching_bootstrap
    candidates = set(directories)
    try:
        candidates.add(container())
    except subprocess.CalledProcessError:
        pass
    for candidate in candidates:
        for name in names: cleanup(candidate/name, challenge, field='challenge')
        if token is not None: remove_matching_bootstrap(candidate/'local-today.json', token)
