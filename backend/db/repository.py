"""Tables reached only through an owner.

Phase 10 closed the "one user cannot access another user's data" invariant at the
resolution layer and recorded the obligation this file discharges: *Phase 11 must
subclass Repository rather than query around it.*

Reads inherit that for free -- `Repository` has no method without an owner. The
new surface is writes, and writes are where server-controlled ownership is
actually won or lost: `insert` takes the owner from the `Owner`, generates the
id, and REFUSES a payload that tried to name either.
"""

from __future__ import annotations

from datetime import datetime
from typing import Mapping

from backend.db.identifiers import IdGenerator
from backend.db.types import OWNER_COLUMNS, Table
from backend.ownership import ClientOwnershipRefused, Owner, Record, Repository


#: Columns the caller never supplies: the server decides who owns a row, what its
#: id is, and when it appeared.
SERVER_CONTROLLED = frozenset({"id", "created_at"}) | OWNER_COLUMNS

#: Columns that name WHO authorized something. They reference users.id just as an
#: owner column does, and SERVER_CONTROLLED did not cover them -- so a caller
#: could insert an approval or a capability grant attributing it to somebody
#: else. `approvals.granted_by` is the accountability field for a privileged
#: action; a caller supplying it is the thing Phase 11's own requirement forbids.
#: `delegated_policies.delegate_id` is deliberately absent: naming the delegate is
#: the caller's decision to make.
ATTRIBUTION_COLUMNS = frozenset({"granted_by"})


class TableRepository(Repository):
    """An owner-scoped repository over one declared table."""

    def __init__(self, table: Table, ids: IdGenerator, kind: str) -> None:
        if not table.owned:
            # `users` is the root and has no owner to scope by. It is reached
            # through authentication, which is Phase 13; giving it an
            # owner-scoped repository would be pretending it has an owner.
            raise ValueError(f"{table.name} is unowned and cannot be owner-scoped")
        super().__init__(table.name)
        self._table = table
        self._ids = ids
        self._kind = kind

    @property
    def table(self) -> Table:
        return self._table

    def put(self, owner: Owner, record_id: str, value: Mapping[str, object]) -> Record:
        """The inherited write path, guarded the same way as `insert`.

        `insert` refused client-supplied ownership; `put` -- public, inherited,
        on the same class -- did not, so the identical forged `user_id` reached
        the row BODY through the other door. Today the store keys on
        (owner, id) so reads still cannot cross, but that body is precisely what
        a SQL subclass will write as the row. The structural check passes either
        way, because it tests argument ORDER, not payload refusal.
        """

        self._refuse_client_ownership(value)
        return Repository.put(self, owner, record_id, value)

    def _refuse_client_ownership(self, values: Mapping[str, object]) -> None:
        if not isinstance(values, Mapping):
            raise ValueError("values must be a mapping")
        claimed = sorted(key for key in values if key in SERVER_CONTROLLED)
        if claimed:
            raise ClientOwnershipRefused(
                f"{self._table.name}: {claimed} are set by the server, not by the caller"
            )
        attributed = sorted(key for key in values if key in ATTRIBUTION_COLUMNS)
        if attributed:
            raise ClientOwnershipRefused(
                f"{self._table.name}: {attributed} record who authorized an action "
                f"and are set by the server, not by the caller"
            )

    def insert(self, owner: Owner, values: Mapping[str, object], *, now: datetime) -> Record:
        """Write a row. The caller supplies data, never identity."""

        if not isinstance(values, Mapping):
            raise ValueError("values must be a mapping")
        claimed = sorted(key for key in values if key in SERVER_CONTROLLED)
        attributed = sorted(key for key in values if key in ATTRIBUTION_COLUMNS)
        if attributed and not claimed:
            # Refused for the same reason as an ownership claim: it forges the
            # record of who authorized the action.
            raise ClientOwnershipRefused(
                f"{self._table.name}: {attributed} record who authorized an action "
                f"and are set by the server, not by the caller"
            )
        if claimed:
            # Refused rather than stripped. A read that carries an ownership
            # claim is noise; a WRITE that carries one is an attempt to create a
            # row belonging to somebody else, and it should fail loudly.
            raise ClientOwnershipRefused(
                f"{self._table.name}: {claimed} are set by the server, not by the caller"
            )

        known = set(self._table.column_names)
        unknown = sorted(set(values) - known)
        if unknown:
            raise ValueError(f"{self._table.name} has no columns {unknown}")

        row: dict[str, object] = dict(values)
        row["user_id"] = str(owner.user_id)
        row["created_at"] = now.isoformat()
        record_id = self._ids.new(self._kind)

        missing = sorted(
            column.name
            for column in self._table.columns
            if not column.nullable and column.name not in row and column.name != "id"
        )
        if missing:
            raise ValueError(f"{self._table.name} requires {missing}")

        # The base write path directly: `insert` legitimately supplies id,
        # created_at and the owner column, which the guarded public `put`
        # exists to refuse from a caller.
        return Repository.put(self, owner, record_id, row)
