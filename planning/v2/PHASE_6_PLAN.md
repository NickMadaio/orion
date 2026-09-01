# ORION v2 Phase 6 — Build the Audit System

Status: **planned — 2026-08-24**. Phase 5 closed the same day.

## What the manifest asks for

Structured audit events carrying twelve named fields; user-facing records that a
person can understand; developer logs kept separate; a list of things that must
never be logged; and a central redaction middleware.

## What already exists

The live system audits a great deal. `TaskLedger` appends a `TaskRunRecord` per
task run, `permission-audit.jsonl` records every profile change, the repair
ledger records self-modification, and Phase 2 added `inference-ledger.jsonl`.
Mapped against the manifest's twelve fields:

| Manifest field | Live today |
|---|---|
| actor | partly — `authorization` carries trust provenance |
| user | **absent**, because there is one user and it is implicit |
| device | **absent**, for the same reason |
| proposed action | `steps[].action` |
| capability | the flat action name; Phase 4 added the dotted one |
| resource | inside step arguments, unlabelled |
| policy decision | `validation.status` |
| approval | `steps[].approval` |
| execution | `steps[]` outcomes |
| result | `status` |
| timestamp | `createdAt` / `completedAt` |
| correlation ID | `taskId` — per task, not across a decision chain |

So the gap is not "nothing is recorded". It is that **the record is shaped like a
task run rather than a decision**, that two of the fields do not exist because
today there is one user on one machine, and that nothing redacts anything.

The single-user gap matters more than it looks: every one of those rows becomes
ambiguous the moment a second device can propose an action, and that is Phase 15.

## Design

`orion/core/audit/`:

```
patterns.py    credential shapes and sensitive field names, in one place
redaction.py   the middleware: recursive, reporting, no content in its report
events.py      AuditEvent and the twelve fields, strictly decoded
narrative.py   the same event rendered for a person
trail.py       one event, two renderings, one write path
```

### Redaction is not middleware you can forget to call

The manifest says "create central redaction middleware", and the ordinary reading
is a function every writer calls on the way to a sink. Every writer that forgets
is then a leak, and forgetting is silent.

So redaction happens **in the event constructor**. There is no way to build an
`AuditEvent` whose free-text fields have not been through the redactor, which
means there is no way to hand a sink an unredacted one. The event carries the
list of rules that fired, never the matched content.

### Two renderings, one event

The user-facing record is *derived from* the developer record, not written
alongside it. Two independent writes are two things that can disagree, and an
audit trail that disagrees with itself is worse than one that is merely terse.

### Secure-debug is narrower than it sounds

The manifest permits "complete sensitive prompts" only under explicit secure-debug
mode. It does not permit raw secrets under any mode. So the trail drops prompt-like
keys entirely unless secure debug is on — and when it is on, credential patterns
inside those prompts are *still* redacted. The exemption is for the prompt, not for
what somebody pasted into it.

### Proving it against the real ledger

`scripts/orion_v2_audit_check.py` replays the live task ledger through an offline
adapter and the redactor, and reports two numbers: how many live rows map cleanly
onto the v2 event contract, and how many contain anything the redactor would
strike. It prints rule names and row counts, never matched content — a check that
quotes the secret it found is a second copy of the secret.

That check is also the honest form of Phase 9's "credentials cannot appear in
logs": evidence over the real ledger rather than a synthetic fixture.

## Test-gated slices

1. Patterns and the redactor, including the report shape and nested structures.
2. `AuditEvent`: twelve fields, strict decoding, redaction that cannot be skipped.
3. The narrative renderer, including denial reasons in plain words.
4. The trail: separation, secure-debug, and the never-log list.
5. The live ledger replay.

## Exit criteria

- Every one of the twelve fields is present and required.
- No `AuditEvent` can exist with unredacted free text, and a test proves the
  constructor is the choke point rather than a convention.
- Tokens, passwords, cookies, private keys and API keys are redacted from values
  *and* from field names, with the rule recorded and the content never repeated.
- Prompts are absent unless secure debug is explicitly enabled.
- User-facing and developer records come from one event and cannot disagree.
- The live ledger replays through the contract with the numbers recorded.
- Suites green.

## What this phase does NOT do

It does not migrate the live ledgers. Phase 1's compatibility mapping said the
existing ledgers "remain durable evidence until Phase 6 migration", and that
expectation is being deliberately not met: the ledgers are written by TypeScript
on the live route, and swapping the audit path of a running system is a
coordinated change on shared plugin files. The contract, the redactor and the
proof that live rows fit are here; the swap is registered as closing work.
