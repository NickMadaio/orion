#!/usr/bin/env python3
"""Prove the schema, the migrations and the manifest still describe one database.

Nothing here connects to anything. It checks four things that can be wrong
without a database, and are expensive to discover with one:

1. the declared schema covers the manifest's twenty-six tables, exactly;
2. replaying the migrations reproduces the declared schema, exactly;
3. every recorded migration checksum still matches -- an edited migration is the
   classic way a database and its history stop describing each other;
4. the emitted SQL contains no hardcoded user, and every owned table is indexed
   by its owner.

`--sql` prints the statements. Whatever would eventually run can be read before
anything runs it.

Read-only. Exit 0 when everything agrees, 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.db.migrations import (  # noqa: E402
    APPLIED_CHECKSUMS,
    MIGRATIONS,
    drift,
    replay,
    replayed_schema,
)
from backend.db.schema import MANIFEST_TABLES, SCHEMA  # noqa: E402
from backend.db.sql import schema_sql  # noqa: E402
from backend.db.types import OWNER_COLUMN  # noqa: E402

#: A uuid literal in DDL would be a row baked into the schema -- which for this
#: schema means a user.
UUID_LITERAL = re.compile(r"'[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}'")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", action="store_true", help="print the emitted SQL")
    arguments = parser.parse_args()

    failures: list[str] = []

    declared = set(SCHEMA.names)
    expected = set(MANIFEST_TABLES)
    for name in sorted(expected - declared):
        failures.append(f"the manifest names {name} and the schema does not declare it")
    for name in sorted(declared - expected):
        failures.append(f"{name} is declared but the manifest does not name it")

    failures.extend(drift())
    try:
        replayed_schema()
    except ValueError as error:
        failures.append(f"the migrations do not build a legal schema: {error}")

    for migration in MIGRATIONS:
        recorded = APPLIED_CHECKSUMS.get(migration.number)
        if recorded is None:
            failures.append(f"migration {migration.number} has no recorded checksum")
        elif recorded != migration.checksum:
            failures.append(
                f"migration {migration.number} ({migration.name}) was edited: "
                f"recorded {recorded}, now {migration.checksum}"
            )
    for number in sorted(set(APPLIED_CHECKSUMS) - {item.number for item in MIGRATIONS}):
        failures.append(f"migration {number} has a checksum but no longer exists")

    sql = schema_sql(SCHEMA)
    if UUID_LITERAL.search(sql):
        failures.append("the emitted SQL contains a uuid literal, which would hardcode a row")
    for table in SCHEMA.tables:
        if not table.owned:
            continue
        if not any(index.columns[0] == OWNER_COLUMN for index in table.indexes):
            failures.append(f"{table.name} is owned but not indexed by {OWNER_COLUMN}")
        column = table.column(OWNER_COLUMN)
        if column.nullable or column.references != "users.id":
            failures.append(f"{table.name}.{OWNER_COLUMN} is not a non-null reference to users.id")

    owned = sum(1 for table in SCHEMA.tables if table.owned)
    print(f"schema check: {len(SCHEMA)} tables ({owned} owned, {len(SCHEMA) - owned} root), "
          f"{sum(len(table.foreign_keys) for table in SCHEMA.tables)} foreign keys")
    print(f"schema check: {len(MIGRATIONS)} migration(s) replay to {len(replay())} tables, drift none")
    print(f"schema check: {len(sql.splitlines())} lines of DDL, no hardcoded rows")

    if arguments.sql:
        print()
        print(sql)

    if failures:
        print(f"schema check: FAIL ({len(failures)})")
        for line in failures[:30]:
            print(f"  {line}")
        return 1
    print("schema check: OK -- schema, migrations and the manifest agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
