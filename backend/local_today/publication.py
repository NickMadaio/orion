"""Explicit local publication, not a remote path selector or a cloud adapter."""
from pathlib import Path
from typing import Callable

from backend.ownership import Owner, Record
from backend.local_today.repository import TodaySnapshotRepository


class PublishingTodayRepository(TodaySnapshotRepository):
    """Refresh the configured owner's snapshot before returning any plan read.

    Export failure leaves the prior durable snapshot intact but refuses this read,
    so the UI cannot mistake a missing source for successful fresh publication.
    The source and exporter are configured by a trusted local caller, never HTTP.
    """
    def __init__(self, directory: Path, *, owner: Owner, source: Path,
                 exporter: Callable[[Path], dict]):
        if not isinstance(owner, Owner):
            raise PermissionError("publication requires a server-resolved owner")
        super().__init__(directory)
        self._publication_owner = owner
        self._source = Path(source)
        self._exporter = exporter

    def get(self, owner: Owner, record_id: str) -> Record:
        if not isinstance(owner, Owner):
            raise PermissionError("read requires a server-resolved owner")
        if owner.user_id == self._publication_owner.user_id and record_id == "today-plan":
            value = self._exporter(self._source)
            self.put(owner, record_id, value)
        return super().get(owner, record_id)
