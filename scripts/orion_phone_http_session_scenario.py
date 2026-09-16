"""Phone signs a challenge and receives its read token entirely over HTTP.

Only an expiring owner/device-bound setup grant is injected into the Simulator.
Account enrollment is still a disposable fixture, not production sign-in.
"""
import json
import os
import secrets
from pathlib import Path
import subprocess
import tempfile
import threading

from backend.adapters.local_today import local_server
from backend.local_today.device_sessions import DeviceReadSessions
from backend.local_today.repository import TodaySnapshotRepository
from backend.local_today.session_exchange import LocalSessionExchange, ExchangeRejected


def check_http_session(registry, owner, now, build, derived, run, container):
    root = Path(__file__).resolve().parents[1]
    with (derived/'http-export-build.log').open('w') as log:
        run(['swift','build','--package-path','native/OrionMobile','--product','TodayPlanExport'], stdout=log, stderr=subprocess.STDOUT)
    snapshot = json.loads(run([str(root/'native/OrionMobile/.build/debug/TodayPlanExport'),'--fixture'], capture_output=True).stdout)
    snapshot['capturedAt'] = 0
    directory = container()
    bootstrap = directory/'http-session-bootstrap.json'
    if bootstrap.exists(): raise RuntimeError('Existing HTTP session bootstrap preserved')
    sessions = DeviceReadSessions(registry)
    class ObservedExchange(LocalSessionExchange):
        accepted = []
        def handle(self, path, header, body):
            result = super().handle(path, header, body)
            self.accepted.append(path)
            return result
    exchange = ObservedExchange(sessions)
    grant = exchange.authorize(owner, 'pairing-test-phone')
    assert sessions.resolve('Bearer '+grant) is None, 'Setup grant is not a read token'
    class ScenarioRepository(TodaySnapshotRepository):
        calls = 0
        def get(self, owner, record_id):
            self.calls += 1
            if self.calls == 2: raise OSError('synthetic snapshot outage')
            value = super().get(owner, record_id)
            if self.calls == 3: registry.revoke(owner, 'pairing-test-phone', now=now())
            return value
    directories = {directory}
    legacy_token = None
    legacy_path = None
    try:
        with tempfile.TemporaryDirectory(prefix='orion-http-session-') as path:
            repo = ScenarioRepository(Path(path)/'private')
            repo.put(owner, 'today-plan', snapshot)
            server = local_server(repo, sessions, exchange=exchange)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                fd = os.open(bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd,'w') as stream:
                    json.dump(dict(port=server.server_port, owner=str(owner.user_id), device='pairing-test-phone', token=grant), stream)
                with (derived/'http-session-ui.log').open('w') as log:
                    run(build+['-only-testing:OrionPhoneUITests/PhoneShellTests/testHTTPDeviceSessionReadAndRevocation',
                               'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
                assert exchange.accepted == ['/session/challenge','/session/exchange']
                assert repo.calls == 3
                assert registry._owned(owner, 'pairing-test-phone').revoked
                try: exchange.handle('/session/challenge', 'Bearer '+grant, {})
                except ExchangeRejected: pass
                else: raise RuntimeError('Setup grant replay accepted')
                # A consumed setup grant plus an old-style file must not silently
                # fall back to a different connection after authentication fails.
                legacy_path = container()/'local-today.json'
                directories.add(legacy_path.parent)
                legacy_token = secrets.token_urlsafe(32)
                fd = os.open(legacy_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd,'w') as stream:
                    json.dump(dict(port=server.server_port, owner=str(owner.user_id), token=legacy_token), stream)
                with (derived/'http-session-refusal.log').open('w') as log:
                    run(build+['-only-testing:OrionPhoneUITests/PhoneShellTests/testHTTPFailureDoesNotUseLegacyToken',
                               'test-without-building'], stdout=log, stderr=subprocess.STDOUT)
                assert repo.calls == 3
                assert exchange.accepted == ['/session/challenge','/session/exchange']
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=3)
        print('PASS: actual phone HTTP challenge/signature/token exchange, memory-only read token, read/outage/recovery and durable revoke clearing')
    finally:
        exchange.revoke(grant)
        cleanup_http_bootstraps(directories, container, grant, legacy_token)


def cleanup_http_bootstraps(directories, container, grant, legacy_token):
    from scripts.orion_v2_phone_read_check import remove_matching_bootstrap
    known = set(directories)
    try: known.add(container())
    except subprocess.CalledProcessError: pass
    for directory in known:
        remove_matching_bootstrap(directory/'http-session-bootstrap.json', grant)
        if legacy_token is not None:
            remove_matching_bootstrap(directory/'local-today.json', legacy_token)
