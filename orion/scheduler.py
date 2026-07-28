from __future__ import annotations

import json
from datetime import datetime, timezone
from threading import Event, Thread
from typing import Callable

from .store import Store


class Scheduler:
    """Small durable scheduler. Jobs are claimed atomically and survive runtime restarts."""

    def __init__(self, store: Store, execute: Callable[[str, dict], None], poll_seconds: float = 1.0) -> None:
        self.store = store
        self.execute = execute
        self.poll_seconds = poll_seconds
        self._stop = Event()
        self._thread = Thread(target=self._run, name="orion-scheduler", daemon=True)

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.wait(self.poll_seconds):
            for job in self.store.due_jobs(datetime.now(timezone.utc).isoformat(timespec="seconds")):
                if not self.store.claim_job(job["id"]):
                    continue
                try:
                    self.execute(job["kind"], json.loads(job["payload_json"]))
                except Exception as error:  # The failure is durable and inspectable.
                    self.store.finish_job(job["id"], str(error))
                else:
                    self.store.finish_job(job["id"])
