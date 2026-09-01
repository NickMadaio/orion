"""The twenty-six tables the manifest names.

Held as data so the ownership rules in `types.py` can be checked against them,
and so the migrations in `migrations.py` can be proven to build exactly this and
nothing else.

The manifest's list is kept separately, in `MANIFEST_TABLES`, and compared. A
table quietly disappearing then fails a test rather than a reading.
"""

from __future__ import annotations

from backend.db.types import Column, Index, Schema, Table


def _id() -> Column:
    return Column("id", "uuid")


def _owner() -> Column:
    return Column("user_id", "uuid", references="users.id")


def _created() -> Column:
    return Column("created_at", "timestamptz")


def _updated() -> Column:
    return Column("updated_at", "timestamptz", nullable=True)


#: Every owned table is read owner-first, so every owned table is indexed
#: owner-first.
def _owner_index(*extra: str) -> Index:
    return Index(("user_id",) + extra)


TABLES = (
    Table(
        "users",
        (
            _id(),
            Column("email", "text", unique=True),
            Column("display_name", "text", nullable=True),
            Column("status", "text"),
            _created(),
            _updated(),
            Column("deleted_at", "timestamptz", nullable=True),
        ),
        owned=False,
        indexes=(Index(("email",), unique=True),),
        note="The one root. Everything else is owned by a row in here.",
    ),
    Table(
        "devices",
        (
            _id(), _owner(),
            Column("name", "text"),
            Column("platform", "text"),
            Column("public_key", "text"),
            Column("attestation_state", "text"),
            Column("capabilities", "text[]"),
            _created(),
            Column("last_seen_at", "timestamptz", nullable=True),
            Column("revoked_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("revoked_at"), Index(("public_key",), unique=True)),
        note="Phase 14's record. Public keys only -- the private half never leaves the device.",
    ),
    Table(
        "sessions",
        (
            _id(), _owner(),
            Column("device_id", "uuid", nullable=True, references="devices.id"),
            Column("token_hash", "text", unique=True),
            Column("issued_at", "timestamptz"),
            Column("expires_at", "timestamptz"),
            Column("rotated_from", "uuid", nullable=True, references="sessions.id"),
            Column("revoked_at", "timestamptz", nullable=True),
            Column("ip_hash", "text", nullable=True),
            _created(),
        ),
        indexes=(_owner_index("expires_at"), Index(("token_hash",), unique=True)),
        note="token_hash, never the token: a stolen database must not be a stolen session.",
    ),
    Table(
        "connections",
        (
            _id(), _owner(),
            Column("provider", "text"),
            Column("status", "text"),
            Column("scopes", "text[]"),
            _created(), _updated(),
            Column("deleted_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("provider"),),
    ),
    Table(
        "oauth_credentials",
        (
            _id(), _owner(),
            Column("connection_id", "uuid", references="connections.id"),
            Column("provider", "text"),
            Column("scopes", "text[]"),
            Column("encrypted_refresh_token", "bytea"),
            # The wrapped DATA KEY. `key_version` alone names which KEK wrapped
            # it, but unwrap() needs the wrapped material itself -- so without
            # this column a credential persisted to this table could never be
            # decrypted, and the gate's claim that "the Phase 11 table matches"
            # was false of the one field that makes the envelope work.
            Column("wrapped_key", "bytea"),
            Column("key_version", "integer"),
            _created(), _updated(),
            Column("revoked_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("provider"), Index(("connection_id",))),
        note="Phase 12 fills this. Nothing here can be written until envelope encryption exists.",
    ),
    Table(
        "webhook_subscriptions",
        (
            _id(), _owner(),
            Column("connection_id", "uuid", references="connections.id"),
            Column("provider", "text"),
            Column("endpoint", "text"),
            Column("secret_ref", "text"),
            Column("expires_at", "timestamptz", nullable=True),
            _created(),
        ),
        indexes=(_owner_index("provider"),),
        note="secret_ref, not a secret: the value lives in the vault.",
    ),
    Table(
        "sync_cursors",
        (
            _id(), _owner(),
            Column("connection_id", "uuid", references="connections.id"),
            Column("resource", "text"),
            Column("cursor", "text"),
            _created(), _updated(),
        ),
        indexes=(Index(("user_id", "connection_id", "resource"), unique=True),),
    ),
    Table(
        "conversations",
        (
            _id(), _owner(),
            Column("title", "text", nullable=True),
            Column("started_at", "timestamptz"),
            Column("last_turn_at", "timestamptz", nullable=True),
            _created(),
        ),
        indexes=(_owner_index("last_turn_at"),),
    ),
    Table(
        "messages",
        (
            _id(), _owner(),
            Column("conversation_id", "uuid", references="conversations.id"),
            Column("role", "text"),
            Column("body", "text"),
            Column("sensitivity", "text"),
            _created(),
        ),
        indexes=(_owner_index("conversation_id"), Index(("conversation_id",))),
    ),
    Table(
        "memory_items",
        (
            _id(), _owner(),
            Column("kind", "text"),
            Column("body", "text"),
            Column("domain", "text"),
            Column("provenance", "text"),
            Column("confidence", "text"),
            _created(), _updated(),
            Column("forgotten_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("domain"),),
        note="domain and provenance mirror Phase 3, so recalled memory can be firewalled.",
    ),
    Table(
        "tasks",
        (
            _id(), _owner(),
            Column("title", "text"),
            Column("status", "text"),
            Column("due_at", "timestamptz", nullable=True),
            Column("source", "text"),
            _created(), _updated(),
            Column("completed_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("status"),),
    ),
    Table(
        "task_dependencies",
        (
            _id(), _owner(),
            Column("task_id", "uuid", references="tasks.id"),
            Column("depends_on_task_id", "uuid", references="tasks.id"),
            _created(),
        ),
        indexes=(Index(("user_id", "task_id", "depends_on_task_id"), unique=True),),
    ),
    Table(
        "task_estimates",
        (
            _id(), _owner(),
            Column("task_id", "uuid", references="tasks.id"),
            Column("minutes", "integer"),
            Column("basis", "text"),
            _created(),
        ),
        indexes=(_owner_index("task_id"),),
    ),
    Table(
        "health_daily_states",
        (
            _id(), _owner(),
            Column("day", "text"),
            Column("state", "jsonb"),
            Column("computed_at", "timestamptz"),
            _created(),
        ),
        indexes=(Index(("user_id", "day"), unique=True),),
    ),
    Table(
        "health_journal_entries",
        (
            _id(), _owner(),
            Column("day", "text"),
            Column("body", "text"),
            Column("tags", "text[]"),
            _created(),
        ),
        indexes=(_owner_index("day"),),
    ),
    Table(
        "capabilities",
        (
            _id(),
            # NOT globally unique. A per-user catalogue with a global unique
            # constraint means the first user to register "mail.send" denies the
            # name to everyone else forever, and the constraint violation is a
            # cross-tenant existence oracle. The table's own note says a
            # capability row is duplicated per user -- a global UNIQUE is exactly
            # what forbids that.
            Column("name", "text"),
            Column("domain", "text"),
            Column("risk_level", "text"),
            Column("approval_required", "boolean"),
            Column("platforms", "text[]"),
            _created(), _updated(),
            Column("user_id", "uuid", references="users.id"),
        ),
        indexes=(_owner_index("name"), Index(("user_id", "name"), unique=True)),
        note=(
            "Owned, deliberately. A capability catalogue shared across users would make one "
            "user's registry edit everybody's, and multi-user hardening is Phase 83."
        ),
    ),
    Table(
        "device_capabilities",
        (
            _id(), _owner(),
            Column("device_id", "uuid", references="devices.id"),
            Column("capability_id", "uuid", references="capabilities.id"),
            Column("enabled", "boolean"),
            _created(), _updated(),
        ),
        indexes=(Index(("user_id", "device_id", "capability_id"), unique=True),),
    ),
    Table(
        "capability_grants",
        (
            _id(), _owner(),
            Column("capability_id", "uuid", references="capabilities.id"),
            Column("device_id", "uuid", nullable=True, references="devices.id"),
            Column("granted_by", "uuid", references="users.id"),
            Column("expires_at", "timestamptz", nullable=True),
            _created(),
            Column("revoked_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("capability_id"),),
    ),
    Table(
        "delegated_policies",
        (
            _id(), _owner(),
            Column("delegate_id", "uuid", references="users.id"),
            Column("capabilities", "text[]"),
            Column("max_risk", "text"),
            Column("profile", "text"),
            Column("expires_at", "timestamptz"),
            _created(),
            Column("revoked_at", "timestamptz", nullable=True),
        ),
        indexes=(_owner_index("expires_at"),),
        note="Mirrors Phase 5's Delegation, including that it must expire.",
    ),
    Table(
        "jobs",
        (
            _id(), _owner(),
            Column("origin_device_id", "uuid", references="devices.id"),
            Column("target_device_id", "uuid", references="devices.id"),
            Column("capability", "text"),
            Column("arguments", "jsonb"),
            Column("risk_level", "text"),
            Column("status", "text"),
            Column("idempotency_key", "text"),
            Column("expires_at", "timestamptz"),
            _created(), _updated(),
        ),
        indexes=(
            _owner_index("status"),
            Index(("user_id", "idempotency_key"), unique=True),
        ),
        note="The unique index is Phase 8's idempotency rule, in the one place it cannot be forgotten.",
    ),
    Table(
        "job_attempts",
        (
            _id(), _owner(),
            Column("job_id", "uuid", references="jobs.id"),
            Column("attempt", "integer"),
            Column("delivery_token_hash", "text"),
            Column("status", "text"),
            Column("started_at", "timestamptz", nullable=True),
            Column("finished_at", "timestamptz", nullable=True),
            Column("reason", "text", nullable=True),
            _created(),
        ),
        indexes=(Index(("user_id", "job_id", "attempt"), unique=True),),
        note="The token is stored hashed for the same reason a session token is.",
    ),
    Table(
        "approvals",
        (
            _id(), _owner(),
            Column("job_id", "uuid", nullable=True, references="jobs.id"),
            Column("capability", "text"),
            Column("canonical_hash", "text"),
            Column("granted_by", "uuid", references="users.id"),
            Column("method", "text"),
            Column("granted_at", "timestamptz"),
            Column("expires_at", "timestamptz"),
            _created(),
        ),
        indexes=(_owner_index("canonical_hash"),),
        note="canonical_hash binds an approval to the exact arguments, as the live plugin already does.",
    ),
    Table(
        "automations",
        (
            _id(), _owner(),
            Column("name", "text"),
            Column("trigger", "jsonb"),
            Column("enabled", "boolean"),
            _created(), _updated(),
        ),
        indexes=(_owner_index("enabled"),),
    ),
    Table(
        "automation_runs",
        (
            _id(), _owner(),
            Column("automation_id", "uuid", references="automations.id"),
            Column("status", "text"),
            Column("started_at", "timestamptz"),
            Column("finished_at", "timestamptz", nullable=True),
            _created(),
        ),
        indexes=(_owner_index("automation_id"),),
    ),
    Table(
        "notifications",
        (
            _id(), _owner(),
            Column("channel", "text"),
            Column("body", "text"),
            Column("sensitivity", "text"),
            Column("delivered_at", "timestamptz", nullable=True),
            Column("acknowledged_at", "timestamptz", nullable=True),
            _created(),
        ),
        indexes=(_owner_index("delivered_at"),),
    ),
    Table(
        "audit_events",
        (
            _id(), _owner(),
            Column("correlation_id", "text"),
            Column("actor", "text"),
            Column("device_id", "uuid", nullable=True, references="devices.id"),
            Column("proposed_action", "text"),
            Column("capability", "text"),
            Column("resource", "text"),
            Column("decision", "jsonb"),
            Column("approval_id", "uuid", nullable=True, references="approvals.id"),
            Column("execution", "jsonb", nullable=True),
            Column("result", "text"),
            Column("sensitivity", "text"),
            Column("redactions", "text[]"),
            Column("occurred_at", "timestamptz"),
            _created(),
        ),
        indexes=(_owner_index("occurred_at"), Index(("correlation_id",))),
        note="Phase 6's twelve fields, with the redaction record kept alongside them.",
    ),
)

SCHEMA = Schema(TABLES)

#: The manifest's list, in its order. Compared against SCHEMA by a test.
MANIFEST_TABLES = (
    "users", "devices", "sessions", "connections", "oauth_credentials",
    "webhook_subscriptions", "sync_cursors", "conversations", "messages",
    "memory_items", "tasks", "task_dependencies", "task_estimates",
    "health_daily_states", "health_journal_entries", "capabilities",
    "device_capabilities", "capability_grants", "delegated_policies", "jobs",
    "job_attempts", "approvals", "automations", "automation_runs",
    "notifications", "audit_events",
)
