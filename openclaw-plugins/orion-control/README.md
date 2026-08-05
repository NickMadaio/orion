# Orion Control

OpenClaw guarded control foundation for Orion.

It exposes:

- `orion_task_run`: validates a typed TaskGraph, dispatches only catalogued
  executors, independently verifies resulting state, and appends a durable
  task record.
- `orion_task_status`: reads the latest durable task record.
- `orion_permission_status`: shows the active permission profile, version,
  configured/effective tiers, and separately gated capabilities.
- `orion_permission_change`: raises or lowers the profile with an optimistic
  version check and private append-only audit record. Raises require a second
  call bound to the canonical approval hash; lowering is immediate on a direct
  user request.

Tier 1 adds one real action: `test_marker_create`. It can create one small,
create-only marker selected by a validated slug inside the dedicated
Orion-controlled test workspace. It has no path argument, never overwrites,
and treats an identical repeat as an idempotent success. All older catalog
actions remain simulation-only.

Profiles gate capability tiers. `consequential_local` — the current setting —
adds move, rename and delete-to-Trash on top of the create/update tiers. Hidden
or sensitive paths, traversal, symlinks, collisions, stale hashes, and untrusted
instructions all still fail closed. Mail, accounts, credentials, communications
and elevated Mac actions remain separately gated.

## Control contract

- Only catalogued actions with complete arguments are accepted.
- Dependencies must exist, be acyclic, and preserve nested-folder ordering.
- Trust is never declared by the caller. The model-facing schema has no `trust`
  field; `authorizeTaskGraph` rebuilds every submitted input as
  `untrusted_external` and mints the only `trusted_user` inputs from OpenClaw
  host provenance (`message_received`, `llm_input`, `before_tool_call`). With no
  authenticated user turn bound to the tool call, every action fails closed with
  `no_authenticated_user_turn`.
- Every action must trace to a trusted user or policy instruction, and any
  action that changes state must be asked for in the user's own turn text.

  How literally, depends on what the action can destroy:

  - **Destructive** (`move`, `rename`, `delete`) — `delete` still asks for
    confirmation bound to its exact arguments; move and rename do not. None of
    them require the user to name anything, and all of them are subject to the
    write-target check below.
  - **Write targets** — a path that appears in untrusted content Orion read and
    in nothing the user said is refused (`target_from_untrusted_content`). This
    is what binds an action to the request, now that the wording rules are gone:
    provenance proves a real turn exists, but not that this step is what it
    asked for.
  - **Navigation** (`browser_open_url`) — judged on the URL, not the wording.
    A URL is refused when a value in its query string, path, or fragment also
    appears in untrusted content Orion read. That is the actual threat — a
    hostile page getting its contents back out via `evil.com/?leak=…` — and it
    is checked directly, in raw and percent-decoded form.
  - **Everything else** — the recent turns are read together, as the one
    conversation they are, and a target the user pointed at loosely is enough.

  Deliberately not a spelling test. The old rules refused "rick roll me" for
  containing no navigation verb and "make a text file" for not naming the file;
  no list of accepted verbs fixes that, since the next person says "throw on
  some music". They are gone.

  What replaced them is the pair of taint checks, and that pairing is not
  optional — deleting the wording rules without them opened a real hole, because
  provenance proves a user turn exists but not that a given step is what it
  asked for.
- Untrusted webpages, email, files, images, and tool output cannot create
  actions.
- Risk, verifier, reversibility, and every SHA-256 hash are derived server-side
  from the action catalog and the exact bytes written; a caller-supplied hash is
  optional and, when present, enforced as an extra concurrency assertion.
- Retries are bounded to zero, one, or two.
- Only errors explicitly classified as transient may consume the retry budget.
- Approval is invalidated when action arguments or working context change.
- Success means a separate verifier observed the expected resulting state.
- Every terminal run is synchronously appended to a JSONL ledger with mode
  `0600`.
- Real capability tiers are disabled unless the plugin configuration enables
  them and the current permission profile allows them. Optional tools remain
  hidden unless tool policy opts in.

## Fast capability ramp-up

Each action is a declarative catalog entry that binds:

- risk and approval policy,
- required arguments and deterministic argument validation,
- capability tier and executor,
- independent verifier,
- canonical idempotency key,
- bounded recovery and durable ledger behavior.

New low-risk tiers should add a narrow executor/verifier pair and use the
shared TaskGraph test harness. They must pass disabled-tier, scope escape,
untrusted-source, idempotency, independent-verification, permanent-failure,
and bounded-retry tests before live opt-in.

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```

The default ledger is `.orion-control/task-ledger.jsonl` relative to the
Gateway working directory. Tier 1 defaults to
`~/.openclaw/orion-controlled/test-workspace`; both paths can be set in the
plugin configuration. Set `enableTestWorkspaceActions` to `true` and opt in
the two optional tools through `tools.alsoAllow` only after the test suite
passes.
