# ORION v2 Phase 11 — Database Foundation

Status: **planned — 2026-08-25**. Phase 10 closed 2026-08-24; Nick answered the
open question by asking for phases 11–15.

## What the manifest asks for

Proper migrations. UUID-style identifiers. Server-controlled ownership on every
user-owned object. Twenty-six named tables. No hardcoded single user. No trust in
a client-submitted `user_id`. Ownership checked server-side on every resource.

## The shape this takes without a database

Phase 10 stood up no server, and this phase adds no dependency either. What a
database phase can honestly deliver in that position is the part that is decided
*before* anything is provisioned, and wrong to improvise afterwards:

- the **schema**, declared as data;
- the **migrations** that build it, ordered and checksummed;
- a **drift check** proving the migrations and the declared schema describe the
  same database — the same relationship `orion_v2_capability_check.py` has to
  `catalog.ts`, and the reason a migration set stays honest;
- the **repository layer** binding every table to Phase 10's owner-scoped
  `Repository`, which is the thing Phase 10 recorded as its own closing work.

The SQL is emitted, not executed. `orion_v2_schema_check.py` prints it, so what
would run is reviewable before anything runs it.

## Ownership is a property of the schema, not of the queries

The manifest's three ownership rules are usually enforced by discipline in
handlers. Here they are properties the schema itself must have, checked:

- every user-owned table carries a non-null `user_id` with a foreign key to
  `users` and an index on it — a table that forgot is a table whose ownership
  check will be a `WHERE` clause somebody remembers;
- no table carries a *second* owner-ish column (`owner_id`, `account_id`), so
  there is one answer to who owns a row;
- `users` is the only table with no owner, and there is exactly one such table.

And the repository layer means the check is not optional at read time: a
`TableRepository` inherits Phase 10's rule that no method exists without an
owner. Phase 10's follow-up said Phase 11 must subclass it rather than query
around it. This is that.

## UUIDs, and where randomness lives

Identifiers are UUID4, rendered as `<kind>_<hex>` so a stray id in a log says
what it is. Generation is injected, exactly as `now` is throughout Core: a
default generator for production, a deterministic one for tests. A schema that
can only be tested with real randomness is a schema whose id rules are believed
rather than known.

## The twenty-six tables

Declared in `backend/db/schema.py` with columns, types, nullability, foreign
keys, indexes and uniqueness. The manifest's list is held separately and
compared, so a table quietly disappearing fails a test rather than a reading.

## Test-gated slices

1. Column and table primitives, and the schema rules above.
2. The twenty-six tables, complete and consistent.
3. Migrations: ordered, checksummed, forward-only, replaying to the declared
   schema exactly.
4. `TableRepository`: owner-bound, and structurally unable to offer an unscoped
   read.
5. The emitted SQL: reviewable, deterministic, and free of a hardcoded user.

## Exit criteria

- Twenty-six tables declared, matching the manifest list exactly.
- Every user-owned table has a server-controlled `user_id`, indexed, with a
  foreign key; `users` is the only ownerless table.
- Migrations are ordered and checksummed, and replaying them reproduces the
  declared schema — proven by a check that fails when either side changes alone.
- Ids are UUID-based and generated through an injected generator.
- Every repository is owner-scoped by construction.
- No hardcoded user id anywhere in the schema, the migrations or the emitted SQL.
- Suites green.

## What this phase does NOT do

It does not connect to PostgreSQL, run a migration, or add a driver. It also does
not implement the vault: `oauth_credentials` is declared here with an
`encrypted_refresh_token` column and nothing that can fill it, because envelope
encryption is Phase 12 and a table that stores a secret before the thing that
encrypts it exists is an invitation.
