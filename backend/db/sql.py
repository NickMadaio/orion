"""Emit the SQL. Deterministic, and never executed here.

Phase 10 stood up no server and Phase 11 adds no driver, so what this produces is
reviewable text rather than a side effect. `scripts/orion_v2_schema_check.py`
prints it: whatever would eventually run can be read before anything runs it.
"""

from __future__ import annotations

from backend.db.types import Column, Index, Schema, Table


NOT_NULL = " NOT NULL"


def column_sql(column: Column) -> str:
    parts = [f"  {column.name} {column.type}"]
    if column.name == "id":
        parts.append(" PRIMARY KEY")
    if not column.nullable:
        parts.append(NOT_NULL)
    if column.unique and column.name != "id":
        parts.append(" UNIQUE")
    if column.references is not None:
        target, _, target_column = column.references.partition(".")
        # RESTRICT rather than CASCADE: deleting a user should be a deliberate,
        # ordered erasure (Phase 72), not a silent cascade through twenty-five
        # tables that nobody watched.
        parts.append(f" REFERENCES {target}({target_column}) ON DELETE RESTRICT")
    return "".join(parts)


def create_table_sql(table: Table) -> str:
    columns = ",\n".join(column_sql(column) for column in table.columns)
    return f"CREATE TABLE {table.name} (\n{columns}\n);"


def create_index_sql(table: str, index: Index) -> str:
    unique = "UNIQUE " if index.unique else ""
    return f"CREATE {unique}INDEX {index.name_for(table)} ON {table} ({', '.join(index.columns)});"


def table_sql(table: Table) -> tuple[str, ...]:
    return (create_table_sql(table),) + tuple(
        create_index_sql(table.name, index) for index in table.indexes
    )


def schema_sql(schema: Schema) -> str:
    """Every statement, in dependency order so it could actually be run."""

    ordered = _dependency_order(schema)
    statements: list[str] = []
    for name in ordered:
        statements.extend(table_sql(schema.table(name)))
    return "\n\n".join(statements) + "\n"


def _dependency_order(schema: Schema) -> tuple[str, ...]:
    """Tables before the tables that reference them.

    Self-references (sessions.rotated_from) are ignored rather than treated as a
    cycle: a table can always be created before it points at itself.
    """

    remaining = {table.name: {
        reference.split(".")[0]
        for _, reference in table.foreign_keys
        if reference.split(".")[0] != table.name
    } for table in schema.tables}
    ordered: list[str] = []
    while remaining:
        ready = sorted(name for name, needs in remaining.items() if not (needs - set(ordered)))
        if not ready:
            raise ValueError(f"circular foreign keys among {sorted(remaining)}")
        for name in ready:
            ordered.append(name)
            del remaining[name]
    return tuple(ordered)
