"""Incremental sync, full listing, and reconciliation against the source of truth.

Two absences look identical in a list of events and mean opposite things:

- an event missing from an **incremental page** did not change;
- an event missing from a **full listing** is gone.

Getting these the wrong way round deletes a person's calendar. So they are not
one function with a flag -- `apply_incremental` and `reconcile` are separate
entry points with different signatures, and neither can be reached with the
other's data by accident.

The provider is the source of truth throughout. Local state is a cache, and when
the two disagree the cache is wrong by definition -- there is no merge, because
a merge implies ORION's copy has standing that it does not have.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum


class SyncOutcome(str, Enum):
    INCREMENTAL = "incremental"
    #: The provider rejected the sync token. Google answers 410 GONE when a
    #: token is older than it keeps history for; the only correct response is a
    #: full listing, because the deltas in between no longer exist.
    FULL_RESYNC_REQUIRED = "full_resync_required"
    RECONCILED = "reconciled"


class SyncRefused(ValueError):
    """The sync input was refused, and the reason names the rule."""


@dataclass(frozen=True, slots=True)
class RemoteRecord:
    """One item as the provider describes it.

    `deleted` is the provider saying so. It is the only thing that removes a
    record during an incremental sync -- inference from absence is what
    `reconcile` is for, and only on a full listing.
    """

    record_id: str
    etag: str
    updated_at: datetime
    deleted: bool = False
    payload: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        if not isinstance(self.record_id, str) or not self.record_id.strip():
            raise SyncRefused("a record needs an id")
        if not isinstance(self.updated_at, datetime) or self.updated_at.tzinfo is None:
            raise SyncRefused("updated_at must be an aware datetime")
        set_(self, "updated_at", self.updated_at.astimezone(timezone.utc))
        set_(self, "payload", dict(self.payload))


@dataclass(frozen=True, slots=True)
class SyncState:
    """Where a resource's sync got to."""

    user_id: str
    connection_id: str
    resource: str
    sync_token: str | None = None
    last_full_listing_at: datetime | None = None

    def __post_init__(self) -> None:
        for field_name in ("user_id", "connection_id", "resource"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise SyncRefused(f"{field_name} is required")


@dataclass(frozen=True, slots=True)
class SyncResult:
    outcome: SyncOutcome
    state: SyncState
    records: Mapping[str, RemoteRecord]
    #: Ids removed by this sync, and why. Reported rather than silent, because
    #: a deletion the user did not expect is the thing they will ask about.
    removed: tuple[str, ...] = ()


def apply_incremental(
    state: SyncState,
    cache: Mapping[str, RemoteRecord],
    page: Iterable[RemoteRecord],
    *,
    next_sync_token: str,
) -> SyncResult:
    """Apply a delta page. **Absence here means unchanged, never deleted.**

    Only `deleted=True` removes anything. That is the provider stating a fact;
    everything else in the cache is left exactly where it was.
    """

    if state.sync_token is None:
        raise SyncRefused(
            "an incremental sync needs a token; without one this is a full listing "
            "and must go through reconcile()"
        )
    updated = dict(cache)
    removed: list[str] = []
    for record in page:
        if record.deleted:
            if updated.pop(record.record_id, None) is not None:
                removed.append(record.record_id)
            continue
        updated[record.record_id] = record
    return SyncResult(
        outcome=SyncOutcome.INCREMENTAL,
        state=replace(state, sync_token=next_sync_token),
        records=updated,
        removed=tuple(removed),
    )


def on_sync_token_rejected(state: SyncState) -> SyncResult:
    """The provider refused the token (Google: 410 GONE).

    The token is cleared. Keeping it would mean the next attempt sends the same
    dead token and fails identically forever, which is a sync that is broken and
    looks merely quiet.
    """

    return SyncResult(
        outcome=SyncOutcome.FULL_RESYNC_REQUIRED,
        state=replace(state, sync_token=None),
        records={},
    )


def reconcile(
    state: SyncState,
    cache: Mapping[str, RemoteRecord],
    full_listing: Iterable[RemoteRecord],
    *,
    now: datetime,
    next_sync_token: str | None = None,
) -> SyncResult:
    """Replace local state with the provider's, which is the truth by definition.

    This is the only function that may infer deletion from absence, and it may
    do so because a full listing is a complete statement about what exists. It
    takes `full_listing` rather than `page` so that handing it a delta is a
    misuse a reader can see, not an argument that looks right.
    """

    if not isinstance(now, datetime) or now.tzinfo is None:
        raise SyncRefused("now must be an aware datetime")
    remote = {}
    for record in full_listing:
        if record.deleted:
            # A full listing does not include deleted items; one that does is a
            # delta page wearing the wrong name.
            raise SyncRefused(
                "a full listing does not contain deletions -- this looks like an "
                "incremental page, and treating it as complete would delete everything else"
            )
        remote[record.record_id] = record
    removed = tuple(sorted(set(cache) - set(remote)))
    return SyncResult(
        outcome=SyncOutcome.RECONCILED,
        state=replace(
            state,
            sync_token=next_sync_token,
            last_full_listing_at=now.astimezone(timezone.utc),
        ),
        records=remote,
        removed=removed,
    )


def drift(cache: Mapping[str, RemoteRecord], remote: Mapping[str, RemoteRecord]) -> Mapping[str, tuple[str, ...]]:
    """What the cache got wrong, for the reconciliation report.

    Compared on etag rather than on the payload: an etag is what the provider
    says identity-plus-version is, and comparing payloads means deciding which
    fields count -- a decision that puts ORION's opinion above the source of
    truth.
    """

    missing = tuple(sorted(set(remote) - set(cache)))
    extra = tuple(sorted(set(cache) - set(remote)))
    stale = tuple(
        sorted(
            record_id
            for record_id, record in remote.items()
            if record_id in cache and cache[record_id].etag != record.etag
        )
    )
    return {"missing": missing, "extra": extra, "stale": stale}
