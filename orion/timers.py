from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from threading import RLock, Timer

from .store import Store


class TimerManager:
    """Persistent local timers with system notifications and no cloud dependency."""

    def __init__(self, store: Store, notify=None) -> None:
        self.store = store
        self.notify = notify or self._notify
        self._scheduled: dict[int, Timer] = {}
        self._lock = RLock()
        self.restore()

    @staticmethod
    def _notify(label: str) -> None:
        safe_label = label.replace('"', "'")
        subprocess.run(["osascript", "-e", f'display notification "{safe_label}" with title "Orion timer"'], check=False, timeout=10)

    def restore(self) -> None:
        for timer in self.store.active_timers():
            due_at = datetime.fromisoformat(timer["due_at"])
            self._schedule(timer["id"], timer["label"], max(0, (due_at - datetime.now(timezone.utc)).total_seconds()))

    def create(self, seconds: int, label: str = "Timer finished") -> dict:
        if seconds < 1 or seconds > 24 * 60 * 60:
            raise ValueError("Timers must be between one second and 24 hours.")
        due_at = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        timer_id = self.store.create_timer(label, due_at.isoformat(timespec="seconds"))
        self._schedule(timer_id, label, seconds)
        return {"id": timer_id, "label": label, "due_at": due_at.isoformat(timespec="seconds"), "status": "active"}

    def _schedule(self, timer_id: int, label: str, seconds: float) -> None:
        callback = Timer(seconds, self._finish, args=(timer_id, label))
        callback.daemon = True
        with self._lock:
            previous = self._scheduled.pop(timer_id, None)
            if previous:
                previous.cancel()
            self._scheduled[timer_id] = callback
        callback.start()

    def _finish(self, timer_id: int, label: str) -> None:
        self.store.finish_timer(timer_id)
        with self._lock:
            self._scheduled.pop(timer_id, None)
        self.notify(label)

    def cancel(self, timer_id: int) -> bool:
        cancelled = self.store.cancel_timer(timer_id)
        if cancelled:
            with self._lock:
                timer = self._scheduled.pop(timer_id, None)
                if timer:
                    timer.cancel()
        return cancelled
