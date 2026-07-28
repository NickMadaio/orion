from __future__ import annotations

import json
import subprocess


NATIVE_TIMER_SHORTCUT = "Orion Native Timer"


class NativeClockUnavailable(RuntimeError):
    pass


class NativeClock:
    """Bridge to a user-owned Shortcuts workflow that controls macOS Clock.

    The Clock app itself has no public scripting dictionary for timer creation.
    Shortcuts provides the supported Set Timer action, so Orion intentionally
    invokes a narrowly named shortcut rather than driving the graphical app.
    """

    def __init__(self, shortcut_name: str = NATIVE_TIMER_SHORTCUT) -> None:
        self.shortcut_name = shortcut_name

    def is_ready(self) -> bool:
        completed = subprocess.run(["shortcuts", "list"], text=True, capture_output=True, timeout=10, check=False)
        return completed.returncode == 0 and self.shortcut_name in completed.stdout.splitlines()

    def start_timer(self, seconds: int, label: str = "Orion timer") -> dict:
        if seconds < 1 or seconds > 24 * 60 * 60:
            raise ValueError("Timers must be between one second and 24 hours.")
        if not self.is_ready():
            raise NativeClockUnavailable(
                f"Native Clock setup is needed once: create a Shortcuts shortcut named “{self.shortcut_name}” "
                "with the Set Timer action, then let Orion run it."
            )
        payload = json.dumps({"seconds": seconds, "label": label})
        completed = subprocess.run(
            ["shortcuts", "run", self.shortcut_name, "-i", payload], text=True, capture_output=True, timeout=30, check=False
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "The native Clock shortcut could not start the timer.")
        return {"backend": "macos_clock", "seconds": seconds, "label": label, "status": "started"}
