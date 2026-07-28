from __future__ import annotations

import json
import os
import pwd
import subprocess
import time
import uuid
from pathlib import Path


class MacBridgeUnavailable(RuntimeError):
    pass


class MacBridge:
    """Small Python client for the native Swift capability boundary."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        user_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        packaged = user_home / "Applications" / "Orion.app" / "Contents" / "Library" / "LoginItems" / "OrionMacBridge.app" / "Contents" / "MacOS" / "orion-mac-bridge"
        release = project_root / "native" / "OrionMacBridge" / ".build" / "release" / "orion-mac-bridge"
        debug = project_root / "native" / "OrionMacBridge" / ".build" / "debug" / "orion-mac-bridge"
        self.binary = packaged if packaged.exists() else release if release.exists() else debug

    def request(self, action: str, payload: dict[str, str] | None = None) -> dict[str, str]:
        request = {"id": uuid.uuid4().hex, "action": action, "payload": payload or {}}
        app_response = self._request_through_companion(request)
        if app_response is not None:
            if not app_response.get("ok"):
                raise RuntimeError(app_response.get("error") or "The native macOS action failed.")
            return dict(app_response.get("result") or {})
        if not self.binary.exists():
            raise MacBridgeUnavailable("Open the Orion desktop app to use native Mac capabilities.")
        completed = subprocess.run(
            [str(self.binary)], input=json.dumps(request) + "\n", text=True, capture_output=True, timeout=30, check=False
        )
        if completed.returncode != 0:
            raise MacBridgeUnavailable(completed.stderr.strip() or "The Orion Mac Bridge could not start.")
        try:
            response = json.loads(completed.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as error:
            raise MacBridgeUnavailable("The Orion Mac Bridge returned an unreadable response.") from error
        if not response.get("ok"):
            raise RuntimeError(response.get("error") or "The native macOS action failed.")
        return dict(response.get("result") or {})

    def _request_through_companion(self, request: dict[str, object]) -> dict | None:
        """Use the running menu-bar app for TCC-protected macOS APIs."""
        bridge_root = self.project_root / "orion" / "data" / "native_bridge"
        requests = bridge_root / "requests"
        responses = bridge_root / "responses"
        if not requests.exists() or not responses.exists():
            return None
        request_id = str(request["id"])
        target = requests / f"{request_id}.json"
        temporary = requests / f".{request_id}.tmp"
        temporary.write_text(json.dumps(request))
        temporary.replace(target)
        response = responses / f"{request_id}.json"
        # The companion services requests on its main run loop. Give it enough
        # room during app startup instead of incorrectly falling back to the
        # legacy helper (which has a different macOS privacy identity).
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if response.exists():
                try:
                    return json.loads(response.read_text())
                finally:
                    response.unlink(missing_ok=True)
            time.sleep(0.05)
        target.unlink(missing_ok=True)
        return None
