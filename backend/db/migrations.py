"""Migrations as operations on the schema model, not as raw SQL strings.

Two reasons, and the second is the one that matters.

A migration set written as SQL can only be checked by running it, which needs the
database this phase deliberately does not have. Written as operations, replaying
them produces a `Schema` -- so `replay(MIGRATIONS) == SCHEMA` is a real check that
the migrations build exactly what the schema declares, and it fails when either
side changes alone. That is the same relationship the Phase 4 capability check has
to `catalog.ts`, and it is what stops a migration set becoming a thing that was
true once.

Forward-only, on purpose: there is no DropTable or DropColumn in the vocabulary.
Erasing data is Phase 72's subject, with backups and a reviewed order, not
something a migration does on the way past.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol

from backend.db.schema import SCHEMA
from backend.db.sql import create_index_sql, table_sql
from backend.db.types import Column, Index, Schema, Table


class Operation(Protocol):
    def apply(self, tables: dict[str, Table]) -> None: ...
    def statements(self) -> tuple[str, ...]: ...
    def fingerprint(self) -> str: ...


@dataclass(frozen=True, slots=True)
class CreateTable:
    table: Table

    def apply(self, tables: dict[str, Table]) -> None:
        if self.table.name in tables:
            raise ValueError(f"{self.table.name} already exists")
        tables[self.table.name] = self.table

    def statements(self) -> tuple[str, ...]:
        return table_sql(self.table)

    def fingerprint(self) -> str:
        """Every property of the table that changes what the migration DOES.

        Column uniqueness and the index list used to be absent, so dropping a
        UNIQUE constraint or changing an index on an applied migration produced
        no signal at all -- which is most of what "editing an applied migration"
        means in practice. Found while repairing the checksum comparison itself:
        making the comparison real is worth nothing if the value being compared
        does not cover the edit. Still structural rather than raw SQL, so
        reformatting the DDL does not read as tampering.
        """

        columns = ",".join(
            f"{column.name} {column.type}{'' if column.nullable else ' NOT NULL'}"
            f"{' UNIQUE' if column.unique else ''}"
            f"{'->' + column.references if column.references else ''}"
            for column in self.table.columns
        )
        indexes = ",".join(
            f"{'unique:' if index.unique else ''}{'+'.join(index.columns)}"
            for index in self.table.indexes
        )
        return f"create_table:{self.table.name}:{columns}|indexes:{indexes}"


@dataclass(frozen=True, slots=True)
class AddColumn:
    table: str
    column: Column

    def apply(self, tables: dict[str, Table]) -> None:
        current = tables[self.table]
        tables[self.table] = Table(
            name=current.name,
            columns=current.columns + (self.column,),
            owned=current.owned,
            indexes=current.indexes,
            note=current.note,
        )

    def statements(self) -> tuple[str, ...]:
        nullable = "" if self.column.nullable else " NOT NULL"
        return (f"ALTER TABLE {self.table} ADD COLUMN {self.column.name} {self.column.type}{nullable};",)

    def fingerprint(self) -> str:
        return f"add_column:{self.table}.{self.column.name}:{self.column.type}"


@dataclass(frozen=True, slots=True)
class AddIndex:
    table: str
    index: Index

    def apply(self, tables: dict[str, Table]) -> None:
        current = tables[self.table]
        tables[self.table] = Table(
            name=current.name,
            columns=current.columns,
            owned=current.owned,
            indexes=current.indexes + (self.index,),
            note=current.note,
        )

    def statements(self) -> tuple[str, ...]:
        return (create_index_sql(self.table, self.index),)

    def fingerprint(self) -> str:
        return f"add_index:{self.index.name_for(self.table)}"


@dataclass(frozen=True, slots=True)
class Migration:
    number: int
    name: str
    operations: tuple[Operation, ...]

    def __post_init__(self) -> None:
        if self.number < 1:
            raise ValueError("migrations are numbered from 1")
        if not self.name or " " in self.name:
            raise ValueError("a migration needs a single-word name")
        if not self.operations:
            raise ValueError(f"migration {self.number} does nothing")

    @property
    def checksum(self) -> str:
        """Stable over what the migration DOES, not over how it is written.

        Editing an applied migration is the classic way a database and its
        history stop describing each other. The checksum is recorded, so an edit
        is visible instead of silent.
        """

        material = "|".join(operation.fingerprint() for operation in self.operations)
        return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]

    def statements(self) -> tuple[str, ...]:
        return tuple(
            statement for operation in self.operations for statement in operation.statements()
        )


def _initial() -> tuple[Migration, ...]:
    """The whole schema, as one first migration.

    One migration rather than twenty-six because nothing has ever been deployed:
    there is no history to preserve, and a first migration split into pieces
    would be a fiction about an evolution that did not happen. The second
    migration onwards will be real changes.
    """

    from backend.db.sql import _dependency_order

    ordered = _dependency_order(SCHEMA)
    return (
        Migration(
            number=1,
            name="initial_schema",
            operations=tuple(CreateTable(SCHEMA.table(name)) for name in ordered),
        ),
    )


MIGRATIONS: tuple[Migration, ...] = _initial()

#: The checksum of every migration that has ever been declared, recorded as a
#: LITERAL. It was previously `{1: MIGRATIONS[0].checksum}`, which made every
#: comparison against it `x == x`: editing migration 1 moved both sides together
#: and produced no signal anywhere -- the schema check exited 0 and all 1,375
#: tests passed with `messages.body` changed from text to jsonb. A recorded
#: value has to be independent of the thing it records, or it records nothing.
#: When a migration is legitimately added, append its checksum here deliberately.
APPLIED_CHECKSUMS = {1: "b023e88a34917ef5"}


def replay(migrations: tuple[Migration, ...] = MIGRATIONS) -> dict[str, Table]:
    """Build the tables these migrations produce.

    Returns tables rather than a `Schema` because a partial migration set is not
    a database: `Schema` enforces whole-database rules -- exactly one root, every
    foreign key resolvable -- which a fragment cannot satisfy and should not have
    to. `replayed_schema()` is the version that asserts them.
    """

    numbers = [migration.number for migration in migrations]
    if numbers != sorted(numbers) or len(set(numbers)) != len(numbers):
        raise ValueError("migrations must be numbered in order, without gaps in the sequence")
    tables: dict[str, Table] = {}
    for migration in migrations:
        for operation in migration.operations:
            operation.apply(tables)
    return tables


def replayed_schema(migrations: tuple[Migration, ...] = MIGRATIONS) -> Schema:
    """The replayed tables as a validated schema.

    Worth its own function: it proves the migrations build something that is a
    legal database, not merely something that matches the declaration. Both could
    be wrong in the same way otherwise.
    """

    tables = replay(migrations)
    return Schema(tuple(tables[name] for name in sorted(tables)))


def drift(migrations: tuple[Migration, ...] = MIGRATIONS) -> list[str]:
    """Every disagreement between the migrations and the declared schema."""

    replayed = replay(migrations)
    declared = {table.name: table for table in SCHEMA.tables}
    problems: list[str] = []
    for name in sorted(set(replayed) | set(declared)):
        if name not in replayed:
            problems.append(f"{name} is declared but no migration creates it")
        elif name not in declared:
            problems.append(f"{name} is created by a migration but not declared")
        elif replayed[name] != declared[name]:
            problems.append(f"{name} differs between the migrations and the schema")
    return problems
