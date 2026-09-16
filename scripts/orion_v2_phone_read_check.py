#!/usr/bin/env python3
"""Run a real Simulator-to-loopback fixture scenario; clean up its grant and store."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import hashlib
import hmac
import secrets
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.ownership import Session, resolve_owner
from backend.local_today.repository import TodaySnapshotRepository
from backend.adapters.local_today import local_server
from backend.local_today.device_sessions import DeviceReadSessions
from backend.devices.durable import DurableDeviceRegistry
from backend.devices.identity import DeviceIdentity
from backend.devices.proofs import HmacVerifier
from backend.devices.registry import _registration_message


def remove_matching_bootstrap(path, token):
    """Leave unknown/replaced files alone; malformed data must not prevent teardown."""
    try:
        value = json.loads(path.read_text())
        if isinstance(value, dict) and value.get("token") == token:
            path.unlink()
            return True
    except (OSError, ValueError):
        pass
    return False


def main():
    os.chdir(ROOT)
    env = dict(os.environ, DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer")
    device = sys.argv[1] if len(sys.argv) > 1 else "98256948-7A0B-4AE9-9928-8ED1A66C971F"
    derived = ROOT / ".builds/phone-read-check"
    derived.mkdir(parents=True, exist_ok=True)
    def run(args, **kwargs):
        return subprocess.run(args, env=env, check=True, **kwargs)
    build = ["xcodebuild", "-project", "native/OrionMobile/OrionMobile.xcodeproj", "-scheme", "OrionPhone",
             "-destination", f"platform=iOS Simulator,id={device}", "-derivedDataPath", str(derived),
             "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-"]
    with (derived / "build.log").open("w") as log:
        run(build + ["build-for-testing"], stdout=log, stderr=subprocess.STDOUT)
    with (derived / "export-build.log").open("w") as log:
        run(["swift", "build", "--package-path", "native/OrionMobile", "--product", "TodayPlanExport"], stdout=log, stderr=subprocess.STDOUT)
    snapshot = json.loads(subprocess.check_output([str(ROOT / "native/OrionMobile/.build/debug/TodayPlanExport"), "--fixture"], env=env))
    snapshot["capturedAt"] = 0  # Explicit stale fixture; a successful fetch must not make it fresh.
    identity = Session("read-session", "read-owner", "read-device")
    class ScenarioRepository(TodaySnapshotRepository):
        calls = 0
        def get(self, owner, record_id):
            self.calls += 1
            if self.calls == 2:
                raise OSError("fixture storage outage")
            value = super().get(owner, record_id)
            if self.calls == 3:
                devices.revoke(resolve_owner(identity), identity.device_id, now=datetime.now(timezone.utc))
                # Durable device revocation, not token deletion. This in-flight
                # read finishes; the next request must recheck and clear access.
            return value
    run(["xcrun", "simctl", "bootstatus", device, "-b"], stdout=subprocess.DEVNULL)
    app = derived / "Build/Products/Debug-iphonesimulator/OrionPhone.app"
    run(["xcrun", "simctl", "install", device, str(app)])
    container = Path(subprocess.check_output(["xcrun", "simctl", "get_app_container", device, "com.nickmadaio.orion.phone", "data"], env=env, text=True).strip())
    bootstrap = container / "Documents/local-today.json"
    bootstrap.parent.mkdir(exist_ok=True)
    if bootstrap.exists():
        raise RuntimeError("Existing local bootstrap preserved; remove it explicitly before this test")
    with tempfile.TemporaryDirectory(prefix="orion-read-") as directory:
        # Explicit synthetic device key. This proves session-to-registry wiring;
        # the separate pairing harness exercises the phone's persistent P-256 key.
        public = "read-device-public-fixture"
        secret = secrets.token_bytes(32)
        sign = lambda message: hmac.new(secret, message, hashlib.sha256).digest()
        devices = DurableDeviceRegistry(Path(directory) / "devices", verifier=HmacVerifier({public: secret}), create=True)
        owner = resolve_owner(identity)
        key = DeviceIdentity(public, HmacVerifier.algorithm, False)
        now = datetime.now(timezone.utc)
        registration = devices.begin_registration(owner, now=now)
        devices.register(owner, device_id=identity.device_id, name="Synthetic read device", platform="ios",
            identity=key, challenge=registration.value,
            signature=sign(_registration_message(owner, identity.device_id, key, registration.value)), now=now)
        sessions = DeviceReadSessions(devices)
        challenge = sessions.begin(owner, identity.device_id, now=now)
        token = sessions.exchange(owner, identity.device_id, challenge=challenge.value,
            signature=sign(sessions.message(owner, identity.device_id, public, challenge.value)), now=now, lifetime=600)
        repo = ScenarioRepository(Path(directory) / "private")
        repo.put(resolve_owner(identity), "today-plan", snapshot)
        server = local_server(repo, sessions)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            fd = os.open(bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump({"port": server.server_port, "owner": "read-owner", "token": token}, stream)
            with (derived / "ui.log").open("w") as log:
                run(build + ["-only-testing:OrionPhoneUITests/PhoneShellTests/testDeviceIdentitySurvivesRelaunch", "-only-testing:OrionPhoneUITests/PhoneShellTests/testDisconnectedAndSampleRoutes", "-only-testing:OrionPhoneUITests/PhoneShellTests/testLocalReadRecoveryAndRevocation", "test-without-building"], stdout=log, stderr=subprocess.STDOUT)
            assert repo.calls == 3, "UI did not execute the read/outage/recovery scenario"
            print("PASS: real Simulator read, stale display, outage, recovery and durable-device-revocation clearing")
        finally:
            sessions.revoke(token)
            try:
                # XCTest may reinstall into a different data container.
                current = subprocess.run(["xcrun", "simctl", "get_app_container", device, "com.nickmadaio.orion.phone", "data"], env=env, capture_output=True, text=True)
                candidates = {bootstrap}
                if current.returncode == 0:
                    candidates.add(Path(current.stdout.strip()) / "Documents/local-today.json")
                for path in candidates:
                    remove_matching_bootstrap(path, token)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=3)
                subprocess.run(["xcrun", "simctl", "terminate", device, "com.nickmadaio.orion.phone"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)



if __name__ == "__main__":
    main()
