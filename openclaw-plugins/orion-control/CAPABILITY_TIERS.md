# Orion Control Capability Tiers

## Runtime permission profiles

The active profile is stored separately from plugin configuration and changed
only through a versioned, audited transition:

- `restricted_read_only`: simulation plus configured visible, non-sensitive
  Desktop reads.
- `approved_root_edit`: also enables configured direct-user-authorized create
  and update actions within approved roots.
- Higher named profiles reserve room for future catalog actions but do not
  themselves add roots or bypass per-action gates.

Every raise requires canonical approval. A direct lowering request takes effect
immediately. External accounts, communications, credentials, destructive
actions, network/browser access, macOS privacy permissions, and elevated OS
control remain separately gated at every profile.

## Tier 0: deterministic simulation

Status: available through the guarded TaskGraph tool.

Existing catalog actions other than `test_marker_create` remain simulation-only.
They cannot change applications, mail, reminders, calendars, user files, or
external state.

## Tier 1: dedicated test-workspace marker

Status: enabled after passing the local and live test gates on 2026-07-29.

Enabled action:

- `test_marker_create`
  - accepts only a validated marker slug and at most 512 UTF-8 bytes;
  - derives the destination beneath the configured Orion-controlled test root;
  - has no caller-supplied path;
  - creates a private regular file without following symlinks;
  - refuses overwrite when existing content differs;
  - treats identical content as `already_present`;
  - independently reads the file back before reporting success;
  - records validation, attempts, idempotency key, execution mode, and
    verification evidence in the private append-only JSONL ledger.

Live evidence:

- initial guarded create run: `92fac9ac-a051-4acc-bc2d-722c64de6dfd`;
- idempotent repeat run: `4888da07-0c2e-4a2d-918d-7beae819ab29`;
- untrusted-source rejection run: `4c3e7185-5e25-4861-a4c6-073883387bf3`.

Test gates:

- plugin unit/integration suite: 14 passed;
- disabled-tier rejection;
- invalid marker and path-escape rejection;
- create-only conflict and no-overwrite behavior;
- independent read-back;
- identical-repeat idempotency;
- bounded retry only for classified transient failures;
- untrusted instruction rejection with zero executed steps;
- live normal-route create, status lookup, replay, and adversarial rejection.

## Remaining denial boundary

The plugin enables no arbitrary roots, delete, move/rename, bulk mutation,
application control, credentials, network, web, browser, messages, email,
calendar, reminders, external accounts, elevated execution, or macOS privacy
permissions. Explicit approved-root file replacement is hash-bound and
collision/staleness checked. Adding an action to the catalog does not enable
its capability tier; code, tests, plugin configuration, the active permission
profile, and exact optional-tool policy must all opt in.

## Next fast safe tier

The next low-risk candidate is a create-only text artifact action under a
separately configured, Orion-owned scratch root. It should reuse the Tier 1
executor/verifier template, add an explicit filename-extension allowlist and
content limit, and remain unable to address user directories. Moving from an
Orion-owned scratch root to any user project or personal data location requires
an explicit user decision on the exact root and allowed operations.
