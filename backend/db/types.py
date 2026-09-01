"""What a table is allowed to be.

The manifest's ownership rules -- server-controlled ownership, no hardcoded user,
no trusted client `user_id` -- are usually enforced by discipline in handlers.
Here they are properties of the schema, checked when it is declared, because a
table that forgot its owner column is a table whose ownership check will be a
`WHERE` clause somebody has to remember.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Mapping


#: A closed type vocabulary. Postgres has hundreds; a schema that can use any of
#: them is a schema nobody can reason about, and `text` for a timestamp is a bug
#: that survives review.
TYPES = (
    "uuid", "text", "timestamptz", "boolean", "integer", "bigint",
    "jsonb", "bytea", "text[]",
)

_NAME = re.compile(r"^[a-z][a-z0-9_]{1,62}$")

#: Column names that mean "who owns this". Exactly one is permitted per table --
#: two would be two answers to the same question, and the wrong one would
#: eventually be the one a query used.
OWNER_COLUMNS = frozenset({"user_id", "owner_id", "account_id", "principal_id"})

#: The one the schema actually uses.
OWNER_COLUMN = "user_id"


@dataclass(frozen=True, slots=True)
class Column:
    name: str
    type: str
    nullable: bool = False
    references: str | None = None
    unique: bool = False
    note: str = ""

    def __post_init__(self) -> None:
        if not _NAME.fullmatch(self.name):
            raise ValueError(f"{self.name!r} is not a valid column name")
        if self.type not in TYPES:
            raise ValueError(f"{self.name}: unknown type {self.type!r}")
        if self.references is not None:
            if self.references.count(".") != 1:
                raise ValueError(f"{self.name}: a reference looks like <table>.<column>")
            if self.type != "uuid":
                raise ValueError(f"{self.name}: a foreign key must be a uuid")


@dataclass(frozen=True, slots=True)
class Index:
    columns: tuple[str, ...]
    unique: bool = False

    def __post_init__(self) -> None:
        if not self.columns:
            raise ValueError("an index needs at least one column")

    def name_for(self, table: str) -> str:
        return f"{'uq' if self.unique else 'ix'}_{table}_{'_'.join(self.columns)}"


@dataclass(frozen=True, slots=True)
class Table:
    name: str
    columns: tuple[Column, ...]
    owned: bool = True
    indexes: tuple[Index, ...] = ()
    note: str = ""

    def __post_init__(self) -> None:
        if not _NAME.fullmatch(self.name):
            raise ValueError(f"{self.name!r} is not a valid table name")
        names = [column.name for column in self.columns]
        if len(set(names)) != len(names):
            raise ValueError(f"{self.name}: repeats a column")
        if not names or names[0] != "id":
            raise ValueError(f"{self.name}: the first column must be the id")
        if self.columns[0].type != "uuid" or self.columns[0].nullable:
            raise ValueError(f"{self.name}: id must be a non-null uuid")
        if "created_at" not in names:
            # Every row records when it appeared. An audit that cannot say when
            # something was created is an audit of the present tense.
            raise ValueError(f"{self.name}: every table records created_at")

        owner_columns = [name for name in names if name in OWNER_COLUMNS]
        if self.owned:
            if owner_columns != [OWNER_COLUMN]:
                raise ValueError(
                    f"{self.name}: an owned table carries exactly one owner column, "
                    f"{OWNER_COLUMN}, and has {owner_columns}"
                )
            owner = self.column(OWNER_COLUMN)
            if owner.nullable or owner.references != "users.id":
                raise ValueError(f"{self.name}: {OWNER_COLUMN} must be non-null and reference users.id")
            if not any(index.columns[0] == OWNER_COLUMN for index in self.indexes):
                # Every read is scoped by owner, so every read starts with this
                # index. Without it, ownership is correct and unusable.
                raise ValueError(f"{self.name}: an owned table needs an index leading with {OWNER_COLUMN}")
        elif owner_columns:
            raise ValueError(f"{self.name}: declared unowned but carries {owner_columns}")

        for index in self.indexes:
            unknown = [column for column in index.columns if column not in names]
            if unknown:
                raise ValueError(f"{self.name}: index over unknown columns {unknown}")

    def column(self, name: str) -> Column:
        for column in self.columns:
            if column.name == name:
                return column
        raise KeyError(f"{self.name} has no column {name}")

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(column.name for column in self.columns)

    @property
    def foreign_keys(self) -> tuple[tuple[str, str], ...]:
        return tuple(
            (column.name, column.references)
            for column in self.columns
            if column.references is not None
        )


@dataclass(frozen=True, slots=True)
class Schema:
    tables: tuple[Table, ...]

    def __post_init__(self) -> None:
        names = [table.name for table in self.tables]
        if len(set(names)) != len(names):
            raise ValueError("a table is declared twice")
        by_name: Mapping[str, Table] = {table.name: table for table in self.tables}
        unowned = [table.name for table in self.tables if not table.owned]
        if unowned != ["users"]:
            # Exactly one root. A second ownerless table is either a table nobody
            # owns -- which cannot be shown to a person -- or an ownership rule
            # somebody decided not to apply.
            raise ValueError(f"users must be the only unowned table; found {unowned}")
        for table in self.tables:
            for column, reference in table.foreign_keys:
                target, _, target_column = reference.partition(".")
                if target not in by_name:
                    raise ValueError(f"{table.name}.{column} references unknown table {target}")
                if target_column not in by_name[target].column_names:
                    raise ValueError(f"{table.name}.{column} references unknown column {reference}")

    def __len__(self) -> int:
        return len(self.tables)

    def table(self, name: str) -> Table:
        for table in self.tables:
            if table.name == name:
                return table
        raise KeyError(f"no table {name}")

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(table.name for table in self.tables)
