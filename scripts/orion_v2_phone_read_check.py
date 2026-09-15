#!/usr/bin/env python3
"""Run a real Simulator-to-loopback fixture scenario; clean up its grant and store."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.ownership import Session, resolve_owner
from backend.local_today.repository import TodaySnapshotRepository
from backend.adapters.local_today import LocalReadSessions, local_server


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
             "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=NO"]
    with (derived / "build.log").open("w") as log:
        run(build + ["build-for-testing"], stdout=log, stderr=subprocess.STDOUT)
    with (derived / "export-build.log").open("w") as log:
        run(["swift", "build", "--package-path", "native/OrionMobile", "--product", "TodayPlanExport"], stdout=log, stderr=subprocess.STDOUT)
    snapshot = json.loads(subprocess.check_output([str(ROOT / "native/OrionMobile/.build/debug/TodayPlanExport"), "--fixture"], env=env))
    snapshot["capturedAt"] = 0  # Explicit stale fixture; a successful fetch must not make it fresh.
    sessions = LocalReadSessions()
    identity = Session("read-session", "read-owner", "read-device")
    token = sessions.issue(identity, lifetime=600)
    class ScenarioRepository(TodaySnapshotRepository):
        calls = 0
        def get(self, owner, record_id):
            self.calls += 1
            if self.calls == 2:
                raise OSError("fixture storage outage")
            value = super().get(owner, record_id)
            if self.calls == 3:
                sessions.revoke(token)  # This completed read succeeds; subsequent refresh is unauthorized.
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
                run(build + ["-only-testing:OrionPhoneUITests/PhoneShellTests/testDisconnectedAndSampleRoutes", "-only-testing:OrionPhoneUITests/PhoneShellTests/testLocalReadRecoveryAndRevocation", "test-without-building"], stdout=log, stderr=subprocess.STDOUT)
            assert repo.calls == 3, "UI did not execute the read/outage/recovery scenario"
            print("PASS: real Simulator read, stale display, outage, recovery and revoked-access clearing")
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
