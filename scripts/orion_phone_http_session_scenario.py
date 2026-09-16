"""Phone signs a challenge and receives its read token entirely over HTTP.

Only an expiring owner/device-bound setup grant is injected into the Simulator.
Account enrollment is still a disposable fixture, not production sign-in.
"""
import json
import hashlib
import os
import secrets
from pathlib import Path
import subprocess
import tempfile
import threading
import time

from backend.adapters.local_today import local_server
from backend.local_today.device_sessions import DeviceReadSessions
from backend.local_today.repository import TodaySnapshotRepository
from backend.local_today.publication import PublishingTodayRepository
from backend.local_today.session_exchange import LocalSessionExchange, ExchangeRejected


def check_http_session(registry, owner, now, build, derived, run, container, *, source=None, preview_seconds=None, env=None, device=None):
    root = Path(__file__).resolve().parents[1]
    with (derived/'http-export-build.log').open('w') as log:
        run(['swift','build','--package-path','native/OrionMobile','--product','TodayPlanExport'], stdout=log, stderr=subprocess.STDOUT)
    exporter = root/'native/OrionMobile/.build/debug/TodayPlanExport'
    def export(path):
        result = run([str(exporter),str(path)], capture_output=True, timeout=5)
        if len(result.stdout) > 1_000_000: raise ValueError('Oversized source export')
        return json.loads(result.stdout)
    before = hashlib.sha256(source.read_bytes()).hexdigest() if source is not None else None
    snapshot = export(source) if source is not None else export('--fixture')
    if source is None: snapshot['capturedAt'] = 0
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
    class PersonalRepository(PublishingTodayRepository):
        calls = 0
        def get(self, owner, record_id):
            result = super().get(owner, record_id)
            self.calls += 1
            if self.calls == 2 and preview_seconds is None: registry.revoke(owner, 'pairing-test-phone', now=now())
            return result
    expected_reads = 2 if source is not None else 3
    try:
        with tempfile.TemporaryDirectory(prefix='orion-http-session-') as path:
            repo = (PersonalRepository(Path(path)/'private',owner=owner,source=source,exporter=export)
                    if source is not None else ScenarioRepository(Path(path)/'private'))
            repo.put(owner, 'today-plan', snapshot)
            server = local_server(repo, sessions, exchange=exchange)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                fd = os.open(bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd,'w') as stream:
                    json.dump(dict(port=server.server_port, owner=str(owner.user_id), device='pairing-test-phone', token=grant), stream)
                if preview_seconds is not None:
                    subprocess.run(['xcrun','simctl','terminate',device,'com.nickmadaio.orion.phone'], env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    run(['xcrun','simctl','launch',device,'com.nickmadaio.orion.phone','--http-session-test'], stdout=subprocess.DEVNULL)
                    run(['open','-a','/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app'])
                    ready_deadline = time.monotonic()+12
                    while repo.calls == 0 and time.monotonic() < ready_deadline:
                        time.sleep(0.1)
                    if repo.calls == 0: raise RuntimeError('Phone did not authenticate and read during preview setup')
                    print(f'Authenticated personal preview open for {preview_seconds} seconds. Ctrl-C closes access.', flush=True)
                    deadline = time.monotonic()+preview_seconds
                    while time.monotonic() < deadline:
                        time.sleep(min(1, max(0, deadline-time.monotonic())))
                else:
                    with (derived/'http-session-ui.log').open('w') as log:
                        test = 'testHTTPPublishedPlanReadingAndRevocation' if source is not None else 'testHTTPDeviceSessionReadAndRevocation'
                        run(build+['-only-testing:OrionPhoneUITests/PhoneShellTests/'+test,
                                   'test-without-building'], stdout=log, stderr=subprocess.STDOUT, timeout=120)
                    assert exchange.accepted == ['/session/challenge','/session/exchange']
                    assert repo.calls == expected_reads
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
                    assert repo.calls == expected_reads
                    assert exchange.accepted == ['/session/challenge','/session/exchange']
            finally:
                try:
                    registry.revoke(owner, 'pairing-test-phone', now=now())
                finally:
                    server.shutdown(); server.server_close(); thread.join(timeout=3)
        if source is not None:
            if hashlib.sha256(source.read_bytes()).hexdigest() != before:
                raise RuntimeError('Source changed during read-only verification; inspect concurrent writers')
            action = 'timed authenticated preview' if preview_seconds is not None else 'authenticated read/refresh/revocation'
            print(f"PASS: personal revision {snapshot['revision']} {action}; source unchanged")
        else:
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
