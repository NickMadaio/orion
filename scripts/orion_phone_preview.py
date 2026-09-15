#!/usr/bin/env python3
"""Bounded, local-only personal plan preview in iPhone Simulator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.ownership import Session, resolve_owner
from backend.adapters.local_today import LocalReadSessions, local_server
from backend.local_today.publication import PublishingTodayRepository
from orion_v2_phone_read_check import remove_matching_bootstrap


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Explicit accepted Mac plan file; read only")
    parser.add_argument("--simulator", default="98256948-7A0B-4AE9-9928-8ED1A66C971F")
    parser.add_argument("--seconds", type=int, default=300, help="Preview lifetime, 1–600 seconds")
    parser.add_argument("--verify", action="store_true", help="Run UI verification and exit instead of leaving an interactive preview")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 600:
        parser.error("--seconds must be between 1 and 600")
    source = args.source.absolute()  # Interpret the explicit path in the caller’s directory.
    os.chdir(ROOT)
    env = dict(os.environ, DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer")
    derived = ROOT / ".builds/personal-phone-preview"
    derived.mkdir(parents=True, exist_ok=True)
    def run(command, **kwargs):
        return subprocess.run(command, env=env, check=True, **kwargs)
    build = ["xcodebuild", "-project", "native/OrionMobile/OrionMobile.xcodeproj", "-scheme", "OrionPhone",
             "-destination", f"platform=iOS Simulator,id={args.simulator}", "-derivedDataPath", str(derived),
             "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-"]
    with (derived / "build.log").open("w") as log:
        run(build + ["build-for-testing" if args.verify else "build"], stdout=log, stderr=subprocess.STDOUT)
    with (derived / "export-build.log").open("w") as log:
        run(["swift", "build", "--package-path", "native/OrionMobile", "--product", "TodayPlanExport"], stdout=log, stderr=subprocess.STDOUT)
    exporter = ROOT / "native/OrionMobile/.build/debug/TodayPlanExport"
    def export(path):
        result = subprocess.run([str(exporter), str(path)], env=env, capture_output=True, timeout=5)
        if result.returncode or len(result.stdout) > 1_000_000:
            raise ValueError("Source export refused")
        return json.loads(result.stdout)
    initial = export(source)  # Validate before installing a grant or starting any listener.
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    run(["xcrun", "simctl", "bootstatus", args.simulator, "-b"], stdout=subprocess.DEVNULL)
    run(["xcrun", "simctl", "install", args.simulator, str(derived / "Build/Products/Debug-iphonesimulator/OrionPhone.app")])
    def container():
        return Path(subprocess.check_output(["xcrun", "simctl", "get_app_container", args.simulator,
            "com.nickmadaio.orion.phone", "data"], env=env, text=True).strip())
    bootstrap = container() / "Documents/local-today.json"
    bootstrap.parent.mkdir(exist_ok=True)
    if bootstrap.exists():
        raise RuntimeError("Existing connection configuration preserved; close its preview first")
    sessions = LocalReadSessions()
    identity = Session("preview-session", "preview-owner", "preview-device")
    owner = resolve_owner(identity)
    token = sessions.issue(identity, lifetime=max(180, args.seconds + 30))
    with tempfile.TemporaryDirectory(prefix="orion-personal-preview-") as directory:
        repository = PublishingTodayRepository(Path(directory) / "private", owner=owner, source=source, exporter=export)
        repository.put(owner, "today-plan", initial)
        server = local_server(repository, sessions)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            fd = os.open(bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump({"port": server.server_port, "owner": str(owner.user_id), "token": token}, stream)
            if args.verify:
                with (derived / "ui.log").open("w") as log:
                    run(build + ["-only-testing:OrionPhoneUITests/PhoneShellTests/testPublishedPlanReading", "test-without-building"], stdout=log, stderr=subprocess.STDOUT)
                if len(repository.read_history(owner)) < 2:
                    raise RuntimeError("UI did not complete initial read and refresh")
                print(f"PASS: personal plan revision {initial['revision']} read and refreshed in Simulator")
            else:
                subprocess.run(["xcrun", "simctl", "terminate", args.simulator, "com.nickmadaio.orion.phone"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                run(["xcrun", "simctl", "launch", args.simulator, "com.nickmadaio.orion.phone", "--local-today"], stdout=subprocess.DEVNULL)
                run(["open", "-a", "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app"])
                print(f"Local personal-plan preview open for {args.seconds} seconds. Ctrl-C closes it.", flush=True)
                deadline = time.monotonic() + args.seconds
                while time.monotonic() < deadline:
                    time.sleep(min(1, max(0, deadline - time.monotonic())))
        finally:
            sessions.revoke(token)
            try:
                candidates = {bootstrap}
                try:
                    candidates.add(container() / "Documents/local-today.json")
                except subprocess.CalledProcessError:
                    pass
                for path in candidates:
                    remove_matching_bootstrap(path, token)
            finally:
                server.shutdown(); server.server_close(); worker.join(timeout=3)
                subprocess.run(["xcrun", "simctl", "terminate", args.simulator, "com.nickmadaio.orion.phone"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    unchanged = source.exists() and hashlib.sha256(source.read_bytes()).hexdigest() == before
    print("Source unchanged during preview." if unchanged else "Source changed during preview; this command performs no source writes.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Preview closed.")
