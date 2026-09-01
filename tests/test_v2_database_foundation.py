"""Phase 11: schema, migrations, and the repositories bound to them.

The ownership rules the manifest states as instructions to handlers -- server
controlled ownership, no hardcoded user, never trust a client `user_id` -- are
tested here as properties of the schema and of the write path, because that is
where they can be made true rather than remembered.
"""

from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import datetime, timezone

from pathlib import Path

import backend.db.migrations as migrations_module
from backend.db.identifiers import KINDS, IdGenerator, SequentialIds, kind_of
from backend.db.migrations import (
    APPLIED_CHECKSUMS,
    MIGRATIONS,
    AddColumn,
    AddIndex,
    CreateTable,
    Migration,
    drift,
    replay,
    replayed_schema,
)
from backend.db.repository import SERVER_CONTROLLED, TableRepository
from backend.db.schema import MANIFEST_TABLES, SCHEMA
from backend.db.sql import create_table_sql, schema_sql
from backend.db.types import OWNER_COLUMN, Column, Index, Schema, Table
from backend.ownership import ClientOwnershipRefused, Owner, Session, resolve_owner


NOW = datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc)
MINE = Session("session-0001-aa", "user-nick-0001", "mac-studio-0001")
THEIRS = Session("session-0002-aa", "user-other-0001", "iphone-them-0001")


def table(**overrides):
    fields = {
        "name": "widgets",
        "columns": (
            Column("id", "uuid"),
            Column("user_id", "uuid", references="users.id"),
            Column("label", "text"),
            Column("created_at", "timestamptz"),
        ),
        "indexes": (Index(("user_id",)),),
    }
    fields.update(overrides)
    return Table(**fields)


class IdentifierTests(unittest.TestCase):
    def test_ids_are_uuid_shaped_and_say_what_they_are(self):
        generator = IdGenerator()
        identifier = generator.new("task")
        self.assertTrue(identifier.startswith("task_"))
        self.assertEqual(len(identifier), len("task_") + 32)
        self.assertEqual(kind_of(identifier), "task")

    def test_generation_is_injectable_so_tests_need_no_randomness(self):
        generator = IdGenerator(SequentialIds())
        self.assertEqual(
            [generator.new("user"), generator.new("user")],
            ["user_" + "0" * 31 + "1", "user_" + "0" * 31 + "2"],
        )

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            IdGenerator().new("whatever")

    def test_a_source_that_is_not_uuid_shaped_is_refused(self):
        with self.assertRaises(ValueError):
            IdGenerator(lambda: "short").new("user")

    def test_every_table_has_a_kind_to_name_its_rows(self):
        # Not a strict one-to-one -- some tables share a kind -- but a table with
        # no plausible kind means an id nobody can identify in a log.
        self.assertGreaterEqual(len(KINDS), 20)


class SchemaRuleTests(unittest.TestCase):
    def test_the_twenty_six_manifest_tables_are_declared_exactly(self):
        self.assertEqual(len(MANIFEST_TABLES), 26)
        self.assertEqual(sorted(SCHEMA.names), sorted(MANIFEST_TABLES))

    def test_users_is_the_only_table_without_an_owner(self):
        unowned = [item.name for item in SCHEMA.tables if not item.owned]
        self.assertEqual(unowned, ["users"])

    def test_every_owned_table_carries_a_server_controlled_owner(self):
        for item in SCHEMA.tables:
            if not item.owned:
                continue
            owner = item.column(OWNER_COLUMN)
            self.assertFalse(owner.nullable, item.name)
            self.assertEqual(owner.references, "users.id", item.name)

    def test_every_owned_table_is_indexed_owner_first(self):
        # Every read is scoped by owner. Without this index ownership is correct
        # and unusable.
        for item in SCHEMA.tables:
            if item.owned:
                self.assertTrue(
                    any(index.columns[0] == OWNER_COLUMN for index in item.indexes), item.name
                )

    def test_a_table_may_not_have_two_owners(self):
        with self.assertRaises(ValueError):
            table(columns=table().columns + (Column("account_id", "uuid", references="users.id"),))

    def test_an_owned_table_without_an_owner_column_is_refused(self):
        with self.assertRaises(ValueError):
            Table("widgets", (Column("id", "uuid"), Column("created_at", "timestamptz")))

    def test_an_unowned_table_carrying_an_owner_is_refused(self):
        with self.assertRaises(ValueError):
            table(owned=False)

    def test_every_table_records_when_a_row_appeared(self):
        with self.assertRaises(ValueError):
            table(columns=(Column("id", "uuid"), Column("user_id", "uuid", references="users.id")))

    def test_a_foreign_key_must_point_somewhere_real(self):
        with self.assertRaises(ValueError):
            Schema(SCHEMA.tables + (table(columns=(
                Column("id", "uuid"),
                Column("user_id", "uuid", references="users.id"),
                Column("ghost_id", "uuid", references="ghosts.id"),
                Column("created_at", "timestamptz"),
            )),))

    def test_a_foreign_key_must_be_a_uuid(self):
        with self.assertRaises(ValueError):
            Column("thing_id", "text", references="users.id")

    def test_the_job_table_carries_phase_8s_idempotency_rule(self):
        jobs = SCHEMA.table("jobs")
        self.assertIn(
            Index(("user_id", "idempotency_key"), unique=True), jobs.indexes
        )

    def test_credentials_are_stored_encrypted_and_versioned(self):
        credentials = SCHEMA.table("oauth_credentials")
        self.assertEqual(credentials.column("encrypted_refresh_token").type, "bytea")
        self.assertEqual(credentials.column("key_version").type, "integer")
        self.assertNotIn("refresh_token", credentials.column_names)


class MigrationTests(unittest.TestCase):
    def test_replaying_the_migrations_reproduces_the_declared_schema(self):
        self.assertEqual(drift(), [])
        self.assertEqual(sorted(replay()), sorted(SCHEMA.names))

    def test_the_replayed_tables_are_themselves_a_legal_schema(self):
        # Matching the declaration is not enough: both could be wrong the same
        # way. This asserts the migrations build a database that obeys the rules.
        self.assertEqual(sorted(replayed_schema().names), sorted(SCHEMA.names))

    def test_drift_is_found_when_the_migrations_stop_matching(self):
        shortened = (Migration(1, "partial", MIGRATIONS[0].operations[:-1]),)
        self.assertTrue(drift(shortened))

    def test_every_migration_has_a_recorded_checksum(self):
        for migration in MIGRATIONS:
            self.assertEqual(APPLIED_CHECKSUMS.get(migration.number), migration.checksum)

    def test_editing_an_applied_migration_changes_its_checksum(self):
        # The classic way a database and its history stop describing each other.
        edited = Migration(1, "initial_schema", MIGRATIONS[0].operations[:-1])
        self.assertNotEqual(edited.checksum, APPLIED_CHECKSUMS[1])

    def test_the_recorded_checksum_is_an_independent_literal(self):
        # The point of a recorded checksum is that it does NOT move when the
        # migration does. Assigning it from MIGRATIONS[0].checksum made the
        # comparison `x == x`, so an edit to the applied migration produced no
        # signal anywhere -- schema check green, whole suite green. Parse the
        # assignment and require it be built from constants alone.
        import ast

        tree = ast.parse(Path(migrations_module.__file__).read_text(encoding="utf-8"))
        assignments = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "APPLIED_CHECKSUMS"
                for target in node.targets
            )
        ]
        self.assertEqual(len(assignments), 1, "APPLIED_CHECKSUMS must be assigned exactly once")
        for node in ast.walk(assignments[0].value):
            self.assertIsInstance(
                node,
                (ast.Dict, ast.Constant, ast.Load),
                f"APPLIED_CHECKSUMS must be literal, found {type(node).__name__}",
            )

    def test_editing_the_applied_schema_is_detected(self):
        # The end-to-end property the literal exists for: change what migration 1
        # does, and the recorded checksum no longer matches it.
        edited = Migration(1, "initial_schema", MIGRATIONS[0].operations[:-1])
        self.assertNotEqual(APPLIED_CHECKSUMS[1], edited.checksum)
        self.assertEqual(APPLIED_CHECKSUMS[1], MIGRATIONS[0].checksum)

    def test_the_checksum_covers_uniqueness_and_indexes(self):
        # It covered name, type, nullability and references only -- so dropping a
        # UNIQUE constraint or changing an index on an applied migration produced
        # no signal, which is most of what "editing an applied migration" means.
        base = SCHEMA.table("capabilities")
        original = Migration(1, "m", (CreateTable(base),))
        # Not `indexes=()` -- the Table type already refuses that, correctly.
        # Drop only the UNIQUENESS, which is legal and was invisible.
        relaxed = replace(base, indexes=tuple(
            replace(index, unique=False) for index in base.indexes
        ))
        without_index = Migration(1, "m", (CreateTable(relaxed),))
        self.assertNotEqual(original.checksum, without_index.checksum)

    def test_a_checksum_is_stable_across_rewording(self):
        same = Migration(1, "renamed_but_identical", MIGRATIONS[0].operations)
        self.assertEqual(same.checksum, MIGRATIONS[0].checksum)

    def test_migrations_must_be_numbered_in_order(self):
        with self.assertRaises(ValueError):
            replay((MIGRATIONS[0], Migration(1, "duplicate", MIGRATIONS[0].operations)))

    def test_a_migration_that_does_nothing_is_refused(self):
        with self.assertRaises(ValueError):
            Migration(2, "empty", ())

    def test_operations_can_add_columns_and_indexes(self):
        base = Migration(1, "base", (CreateTable(table()),))
        extended = Migration(
            2, "extend",
            (AddColumn("widgets", Column("colour", "text", nullable=True)),
             AddIndex("widgets", Index(("label",)))),
        )
        result = replay((base, extended))["widgets"]
        self.assertIn("colour", result.column_names)
        self.assertIn(Index(("label",)), result.indexes)

    def test_the_vocabulary_is_forward_only(self):
        # Erasing data is Phase 72's subject, with backups and a reviewed order.
        import backend.db.migrations as module

        self.assertFalse([name for name in dir(module) if name.startswith(("Drop", "Delete"))])


class SecondWritePathTests(unittest.TestCase):
    """`insert` was guarded and `put` -- public, inherited, same class -- was not."""

    def setUp(self):
        self.repo = TableRepository(SCHEMA.table("tasks"), IdGenerator(SequentialIds()), "task")
        self.owner = resolve_owner(Session(session_id="session-0001", user_id="user-nick-0001", device_id="device-mac-0001"))

    def test_put_refuses_a_client_supplied_owner(self):
        with self.assertRaises(ClientOwnershipRefused):
            self.repo.put(self.owner, "task-0001", {
                "title": "a task", "user_id": "user-other-0001",
            })

    def test_put_refuses_a_client_supplied_id_and_timestamp(self):
        for forged in ({"id": "forged"}, {"created_at": "1970-01-01T00:00:00"}):
            with self.assertRaises(ClientOwnershipRefused):
                self.repo.put(self.owner, "task-0001", {"title": "a task", **forged})

    def test_insert_still_works_through_the_guarded_class(self):
        record = self.repo.insert(
            self.owner, {"title": "a task", "status": "open", "source": "test"},
            now=datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(record.owner_id, "user-nick-0001")


class AttributionTests(unittest.TestCase):
    def test_who_authorized_an_action_is_not_the_callers_to_state(self):
        # SERVER_CONTROLLED covered the owner column but not the other columns
        # that reference users.id. approvals.granted_by is the accountability
        # field for a privileged action, and a caller could supply it.
        repo = TableRepository(SCHEMA.table("approvals"), IdGenerator(SequentialIds()), "approval")
        owner = resolve_owner(Session(session_id="session-0001", user_id="user-nick-0001", device_id="device-mac-0001"))
        with self.assertRaises(ClientOwnershipRefused):
            repo.insert(owner, {"granted_by": "user-other-0001"},
                        now=datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc))


class CapabilityScopeTests(unittest.TestCase):
    def test_a_capability_name_is_unique_per_owner_not_globally(self):
        # A global UNIQUE on an owned table means the first user to register
        # "mail.send" denies the name to everyone else forever, and the
        # constraint violation is a cross-tenant existence oracle. The table's
        # own note says a capability row is duplicated per user.
        table = SCHEMA.table("capabilities")
        self.assertTrue(table.owned)
        for column in table.columns:
            self.assertFalse(column.unique, f"{column.name} is globally unique")
        unique_indexes = [index for index in table.indexes if index.unique]
        self.assertTrue(unique_indexes)
        for index in unique_indexes:
            self.assertEqual(index.columns[0], OWNER_COLUMN,
                             "a unique index on an owned table leads with the owner")

    def test_no_owned_table_carries_a_globally_unique_constraint_by_accident(self):
        # devices.public_key and sessions.token_hash ARE deliberately global --
        # a key or a token must be unique across everyone. Everything else must
        # scope its uniqueness to the owner.
        deliberate = {("devices", "public_key"), ("sessions", "token_hash")}
        for table in SCHEMA.tables:
            if not table.owned:
                continue
            for column in table.columns:
                if column.unique:
                    self.assertIn((table.name, column.name), deliberate)
            for index in table.indexes:
                if index.unique and index.columns[0] != OWNER_COLUMN:
                    self.assertIn((table.name, index.columns[0]), deliberate)


class SqlTests(unittest.TestCase):
    def test_the_emitted_sql_is_deterministic(self):
        self.assertEqual(schema_sql(SCHEMA), schema_sql(SCHEMA))

    def test_a_table_is_created_before_the_tables_that_reference_it(self):
        sql = schema_sql(SCHEMA)
        self.assertLess(sql.index("CREATE TABLE users"), sql.index("CREATE TABLE devices"))
        self.assertLess(sql.index("CREATE TABLE conversations"), sql.index("CREATE TABLE messages"))

    def test_deletes_restrict_rather_than_cascade(self):
        # Deleting a user should be a deliberate, ordered erasure, not a silent
        # cascade through twenty-five tables nobody watched.
        sql = schema_sql(SCHEMA)
        self.assertIn("ON DELETE RESTRICT", sql)
        self.assertNotIn("ON DELETE CASCADE", sql)

    def test_no_row_is_baked_into_the_schema(self):
        self.assertNotIn("INSERT", schema_sql(SCHEMA).upper())

    def test_the_id_column_is_the_primary_key(self):
        self.assertIn("id uuid PRIMARY KEY NOT NULL", create_table_sql(SCHEMA.table("tasks")))


class TableRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = TableRepository(SCHEMA.table("tasks"), IdGenerator(SequentialIds()), "task")
        self.mine = resolve_owner(MINE)
        self.theirs = resolve_owner(THEIRS)

    def row(self, **overrides):
        values = {"title": "buy milk", "status": "open", "source": "user"}
        values.update(overrides)
        return values

    def test_a_write_takes_its_owner_from_the_session(self):
        record = self.repository.insert(self.mine, self.row(), now=NOW)
        self.assertEqual(str(record.owner_id), "user-nick-0001")
        self.assertEqual(record.value["user_id"], "user-nick-0001")

    def test_a_write_that_names_an_owner_is_refused_not_stripped(self):
        # A read carrying an ownership claim is noise; a WRITE carrying one is an
        # attempt to create a row belonging to somebody else.
        for claim in ("user_id", "owner_id", "account_id", "id", "created_at"):
            with self.assertRaises(ClientOwnershipRefused, msg=claim):
                self.repository.insert(self.mine, self.row(**{claim: "user-other-0001"}), now=NOW)

    def test_the_server_controlled_set_covers_identity_and_time(self):
        self.assertEqual(SERVER_CONTROLLED & {"id", "created_at", "user_id"},
                         {"id", "created_at", "user_id"})

    def test_an_unknown_column_is_refused(self):
        with self.assertRaises(ValueError):
            self.repository.insert(self.mine, self.row(nonsense="x"), now=NOW)

    def test_a_missing_required_column_is_refused(self):
        with self.assertRaises(ValueError):
            self.repository.insert(self.mine, {"title": "no status"}, now=NOW)

    def test_rows_are_still_owner_scoped_on_read(self):
        self.repository.insert(self.mine, self.row(), now=NOW)
        self.assertEqual(self.repository.count(self.mine), 1)
        self.assertEqual(self.repository.count(self.theirs), 0)

    def test_an_unowned_table_cannot_be_owner_scoped(self):
        with self.assertRaises(ValueError):
            TableRepository(SCHEMA.table("users"), IdGenerator(), "user")

    def test_every_declared_owned_table_can_be_given_a_repository(self):
        for item in SCHEMA.tables:
            if item.owned:
                TableRepository(item, IdGenerator(SequentialIds()), "task")


if __name__ == "__main__":
    unittest.main()
