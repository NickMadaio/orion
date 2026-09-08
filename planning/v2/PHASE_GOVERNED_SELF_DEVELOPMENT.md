# Governed self-development and personalities

Not a numbered phase (see `MANIFEST_PHASES.json`'s 85 -- there is no slot for
this). This is Nick's item **#5** from `HANDOFF.md`'s
work order, verbatim: *"integrate the smart local models to do self
propogation changes (the multiple orion personalities we had talked about in
another chat). Self propogation and coding tasks i dont need in a rush should
go through a local model to save money."* Recorded here as `scopeNotInManifest`
in spirit; `PHASE_GATES.json` is a concurrent session's file tonight and could
not be touched to register it formally there -- see "What I could not do"
below.

Two things, named separately because the job named them separately and they
must never be confused:

- **Personalities** -- Main, Vent, Coach, Research, Creative. Conversation and
  workflow configuration only.
- **Governed self-development** -- the deliberately renamed replacement for
  "self-propagation". A local model may be handed a non-urgent coding task;
  it may never be handed authority. Built tonight: the boundary and the
  routing rules. Not built: the loop that would actually read a local model's
  output and turn it into a diff. **Off by default, and nothing here turns it
  on.**

## Part 1 -- Personalities

### The permanent rule

> Unrestricted speech; restricted capabilities.

Research may ask for wider sources. Creative may brainstorm without limit.
Coach may be more directive. **None of them may grant file, account,
messaging, system, or self-modification access.** This is enforced in
`openclaw-plugins/orion-control/src/personalities.ts`, proven in
`personalities.test.ts`, by three independent layers:

1. **The type cannot express authority.** `PersonalityProfile` has exactly
   seven fields -- `id`, `label`, `tone`, `memoryLean`, `planningStyle`,
   `modelRoleLean`, `sourceBreadth` -- and none of them is a capability tier,
   a permission profile, a strictness mode, an exec-allowlist entry, or a
   filesystem root. This is "passed by absence": there is nowhere on the type
   for a widening to be written, not a field that is checked and rejected.
   Proven by a **real, machine-run instance of the TypeScript compiler**
   inside the test suite (`personalities.test.ts`, "compile-time proof"
   describe block) -- it compiles the actual `personalities.ts` alongside an
   in-memory fixture that tries to add `capabilityTier`, `permissionProfile`
   or `strictnessMode` to a `PersonalityProfile` literal, and asserts
   TypeScript refuses with error **TS2353** ("Object literal may only specify
   known properties"), by code and by the field name appearing in the
   message. A second fixture with no such field is asserted to compile with
   zero diagnostics, so the harness is proven not to fail on everything.

2. **The runtime parser is a strict allowlist, not a denylist.**
   `parsePersonalityProfile` is the path anything untyped (a config file, a
   value crossing a process boundary) has to go through. It accepts exactly
   the seven field names above and throws `PersonalityAuthorityViolation` for
   any other key -- including a real field spelled differently, and
   including anything that looks like authority. A denylist would have to
   predict every spelling of "let me widen this"; an allowlist only ever
   admits what it already knows is safe.

3. **Composing a personality with real authority never merges the two.**
   `composeConversationConfiguration(personality, authority)` returns
   `authority` **by reference, untouched** -- proven by identity comparison
   (`toBe`, not `toEqual`) across all five personalities in
   `personalities.test.ts`.

`ModelRoleLean` (`"reasoning" | "local" | "fast" | "coder"`) is the one place a
personality touches model routing, and it can only name a role **already
declared** in `model-roles.seed.json` -- leaning toward one can never
introduce a model, provider or credential nobody configured.

### Mutation proof (hard rule 6), executed live this session

**Claim: a personality definition cannot carry an authority-shaped field.**

Broke it: added `"capabilityTier"` to `ALLOWED_PERSONALITY_FIELDS` in
`personalities.ts` (the runtime allowlist). Ran the named test
`parsePersonalityProfile: the runtime allowlist > REJECTS a candidate
carrying capabilityTier, by name, in the failure message`. It failed:

```
AssertionError: expected function to throw an error, but it didn't
 ❯ src/personalities.test.ts:170:54
```

Restored `personalities.ts` from a pre-mutation copy; reran the same test and
the full file (19/19) -- green; `diff` against the pre-mutation copy showed no
residual change.

## Part 2 -- Governed self-development

### What it is, and what it is not

A **local model proposing a diff** to Orion's own source for work that is not
time-sensitive, so cloud tokens are spent on work that actually needs them.
Not "self-propagation": no replication, no silent persistence, no
self-granted authority. Every diff a local model produces is reviewed and
applied through the same gate everything else in this repo goes through --
this session did not build that application/review loop; it built the two
things a loop would have to obey before it could exist honestly.

### 1. The forbidden self-change surface (`self-development-authority.ts`)

A deny-list of paths, checked with `assertDiffAllowed(paths)` **before** a
proposed diff is accepted, in every strictness mode including `sovereign`,
with no instruction able to reopen any of them:

| Named surface | Path(s) | Reason |
|---|---|---|
| policy evaluator | `openclaw-plugins/orion-control/src/catalog.ts`, `validator.ts` | tier tables and the code that enforces them |
| approval verifier | `openclaw-plugins/orion-control/src/approvals.ts` | decides whether a person said yes |
| audit ledger | `openclaw-plugins/orion-control/src/ledger.ts`, `provenance.ts` | the record and its hash chain |
| secret store / sandbox rules | `orion/security/**` | Keychain-adjacent Python, risk and profile derivation |
| update signing | `native/Orion/**` (whole tree) | Sparkle, the EdDSA key reference, `make_app_bundle.sh`'s signing order -- AGENTS.md's one invariant |
| LOCK ORION | `scripts/orion-lock` | the emergency off switch |
| privileged broker | `backend/connectors/broker.py` | the module that actually sends/writes to an external service |
| (also) | `selfrepair.ts`, `strictness.ts`, `permissions.ts`, `scripts/orion-repair`, `orion-forge`, `orion-approve`, `orion-mode`, `orion-sign-setup`, `orion-keys`, and this deny-list file itself | each closes a path to reopening one of the above indirectly |

This is a **new, independent** table, not a reuse of `selfrepair.ts`'s
`AUTHORITY_PLUGIN_FILES`. That table's job is "reachable, with Nick's named
authority instruction" -- AUTHORITY is a class you can still enter. Every path
above must be reachable by **nothing** this capability does, full stop.
Folding the two together would make the stricter guarantee only as strong as
the weaker one the day someone edits the shared table for an unrelated
reason.

Path handling refuses absolute paths, `~`-relative paths, and anything whose
normalized form escapes the repository root (`../` climbing past it), and
matches the deny-list against the **resolved destination**, not the literal
presence of `..` in the input -- a path that uses `..` but still lands inside
the repo, at a location that is not on the deny-list, is judged on where it
actually lands, not refused for containing a `..` character.

**Mutation proof, executed live:** removed the `approvals.ts` entry from
`FORBIDDEN_SELF_CHANGE_SURFACES`. Ran the named test `assertDiffAllowed: the
forbidden self-change surfaces > REFUSES a diff touching
openclaw-plugins/orion-control/src/approvals.ts`. It failed:

```
AssertionError: expected function to throw an error, but it didn't
 ❯ src/self-development-authority.test.ts:48:50
```

Restored from a pre-mutation copy; reran -- 29/29 green; `diff` confirmed no
residual change.

### 2. Default state: OFF

`GOVERNED_SELF_DEVELOPMENT_ENABLED = false as const` in
`self-development-authority.ts`. `assertGovernedSelfDevelopmentEnabled()`
throws `GovernedSelfDevelopmentDisabledError` unconditionally while it is
false, and nothing in this session's diff flips it. It is a hard-coded
constant rather than an environment variable or a config value on purpose: a
kill switch that the thing it switches off could itself edit is not a kill
switch, and both of those are things a local model's own future diff might
touch.

**This is the honest limit of tonight's work: the flag exists and is off. No
loop reads it, because no loop exists yet to read it.**

### 3. Routing: "not time-sensitive" as data, not a vibe (`self-development-scheduling.ts`)

A `SelfDevelopmentJob` carries `urgency` (`"routine" | "time_sensitive"`), an
optional `deadlineAt`, and `failedLocalReview: boolean`. `routeJob(job, now)`
returns `"local"` unless one of three things is true, each independently
testable:

1. `failedLocalReview` is already `true` -- a job does not get a second local
   attempt once one has been rejected or flagged.
2. `urgency` is `"time_sensitive"`.
3. `deadlineAt` has entered the **urgent window** (`URGENT_WINDOW_MS`, two
   hours) -- a routine job does not stay routine right up to the moment it is
   already late.

**Mutation proof, executed live:** changed `if (job.failedLocalReview)` to
`if (false && job.failedLocalReview)`. Ran the named test `routeJob: local
unless one of three things is true > a job that already failed local review
goes to CLOUD even when routine`. It failed:

```
AssertionError: expected 'local' to be 'cloud'
 ❯ src/self-development-scheduling.test.ts:39:26
```

Restored; reran -- 23/23 green; `diff` confirmed no residual change.

### 4. Budget envelope and pause conditions

`SelfDevelopmentBudgetEnvelope { maxDurationMs, maxModelCalls, maxTokens }`,
default `{30 min, 40 calls, 400,000 tokens}` -- deliberately small next to
Phase 67's **daily** ceilings (`scripts/orion-budget`: 5,000,000 tokens, 400
calls), because one job is a slice of a day, not the day. `checkBudget(usage,
envelope)` reports every ceiling exceeded, meant to be polled during a run
rather than consulted once at the end.

`shouldPause(state)` takes `batteryPercent`, `isCharging`, `thermalPressure`
(`"nominal" | "fair" | "serious" | "critical"`), `quietHoursActive`, and
returns every applicable reason: quiet hours active, thermal pressure
`serious`/`critical`, or battery under 30% while unplugged. Charging state
gates the battery condition -- a plugged-in machine at 5% is not paused for
power.

This **extends** Phase 67 rather than duplicating it. `orion-budget` reads
usage logged after the fact and enforces daily/automation/remote-session
ceilings; this is per-job, checked before and during a run that has not
logged anything anywhere yet. A governed self-development job running away
should never be the thing `orion-budget` discovers hours later.

### 5. The `coder` model role -- measured, not picked by name

`model-roles.seed.json` had no `coder` role. Added one, after benchmarking
rather than assuming, following the standard `native/Orion/Sources/Orion/
LocalModel.swift` already set for this repo (its own header records that
`llama3.2:3b` was dropped from the `local` role not for being bland but for
being **wrong**: told a strain of 8.4 against a suggested band of 14-18, it
wrote "you may be pushing yourself too hard" -- the inverse of the number).

**Method:** the same plain `/api/generate` completion call `LocalModel.swift`
uses (not an agent turn -- a 3B model handed tools reaches for them and never
finishes the paragraph, per that file's own measured finding). Task: write a
JavaScript function `parseDuration` converting strings like `"1h30m"` to a
second count; execute the model's actual returned code against 8 fixed cases
(`1h30m`->5400, `45s`->45, `2h`->7200, `90m`->5400, `1h`->3600, `30m10s`->1810,
`0h0m0s`->0, `10h`->36000).

**Result, measured on this Mac, 2026-09-06:**

| Model | Time | Correctness | Note |
|---|---|---|---|
| `gpt-oss:20b` | 29.1s | **8/8** | only candidate that both answered and was right |
| `qwen3:30b` | no answer inside 120s, then 150s | -- | a reasoning model; spends `num_predict` on its `thinking` field before `response`, the same failure `LocalModel.swift` documents at a smaller budget (200 tokens) -- raising the budget here just moved the stall further out, not past it |
| `qwen3.6:27b` | no answer inside 150s | -- | same shape as `qwen3:30b` |
| `llama3.2:3b` | 19.1s | **0/8** | fast, and wrong: hand-rolled a parser with dead branches that returns `undefined` on every input -- consistent with the health-brief inversion already on record, not a new failure mode |

`coder`'s `primary` is `ollama/gpt-oss:20b` -- the same model as the `local`
role, by measurement rather than by assumption that they should match. A
rerun on different hardware, or against newer local model releases, could
reasonably find a different winner and should replace this measurement rather
than the model name alone; the benchmark script is disposable (it lived in a
scratchpad, not committed) but the method -- execute the actual returned code
against fixed cases, don't read the prose and guess -- is the part worth
keeping.

**Cross-language contract kept honest.** `model-roles.seed.json` is validated
by `orion/core/models/contract.py`'s `decode_contract`, which rejects any
role not in its `ROLES` tuple, and by `orion/core/schemas/model-roles.
schema.json`'s closed `required`/`properties`/`retired.enum` lists, and by
`tests/test_v2_model_contract.py`'s shared `contract()` fixture builder. Added
`"coder"` to all three plus the one shared test fixture (a single-line
addition; the file's `contract()` helper is reused by ~20 tests, so this was
one edit, not twenty). Ran `PYTHONPATH=.
.venv/bin/python -m unittest tests.test_v2_model_contract` before and after:
28/28 both times. Ran `scripts/orion_v2_model_contract_check.py`: exit 0, "all
9 bindings agree" (a `coder` role with no live-config probe is not flagged as
drifted, the same way `vision`'s honest non-assignment is not).

None of `orion/core/models/contract.py`, `orion/core/schemas/model-roles.
schema.json`, or `tests/test_v2_model_contract.py` were on the forbidden list
for this session (that list is `orion/security/*.py` and named plugin/script
files, not `orion/core/`) and none were already dirty at session start, so
editing them to keep a real cross-language contract from silently drifting
was in scope.

## What is unproven

- **The loop itself does not exist.** Nothing reads a local model's output,
  turns it into a diff, or calls `assertDiffAllowed` against a real change.
  `assertDiffAllowed` and `routeJob`/`checkBudget`/`shouldPause` are unit-
  tested in isolation, not integration-tested against a real coding session.
- **The `coder` benchmark is one task, one machine, one day.** Real
  self-development diffs will be larger and more varied than an 8-case
  utility function; `qwen3:30b`/`qwen3.6:27b` might do better on a task that
  rewards their reasoning budget instead of being starved of tokens by it.
  Re-benchmark before trusting this at anything beyond "gpt-oss:20b is the
  known-working default."
- **The urgent window (2 hours) and the budget envelope (30 min / 40 calls /
  400k tokens) are reasoned defaults, not measured ones** -- unlike
  `orion-budget`'s daily ceilings, which were set from a week of real usage.
  They should be recalibrated once a real job has actually run against them.
- **Personalities have no wiring to a live conversation yet.** `PERSONALITIES`
  and `composeConversationConfiguration` are library code; nothing in
  `index.ts`'s action catalog lets Orion actually switch personality mid-
  conversation. See below.

## What I could not do (files I do not own)

Wiring either capability into the live plugin needs edits to files this
session was told are a concurrent session's uncommitted work and must not
touch: `catalog.ts` (a new action/tier for selecting a personality or
submitting a self-development job), `executors.ts` (the executor that would
actually call a personality-aware prompt or hand a job to the `coder` role),
`index.ts` (registering either), and `permissions.ts` (if a new capability
tier is warranted for governed self-development, which given its own deny-
list is arguably orthogonal to the five existing tiers rather than folded
into `self_modification`). `PHASE_GATES.json` and `DATA_INVENTORY.json` are
also on that list, which is why this work is not registered there as a formal
`scopeNotInManifest` entry despite AGENTS.md asking for that -- recorded here
instead, for whoever reconciles the two sessions' work.

## Test count

`cd openclaw-plugins/orion-control && npm test`: **236 tests, 6 files** before
this session's changes; **307 tests, 9 files** after (3 new files: 19 + 29 +
23 = 71 new tests, all passing; 236 + 71 = 307). `npx tsc -p tsconfig.json
--noEmit` clean both before and after. Python: `tests.test_v2_model_contract`
28/28 both before and after the `coder` addition. The full Python suite
(`python -m unittest discover -s tests -t tests -q`) has 2 pre-existing
failures and 2 pre-existing errors unrelated to this work (`test_v2_
policy_engine.py`, `test_v2_policy_primitives.py`, both counting 106 vs an
expected 78 capabilities, and both tracing to `planning/v2/capability-
registry.json` / `orion/security/profiles.py` / `risk.py` -- all three on the
concurrent session's dirty, forbidden-to-touch list, and unrelated to
`model-roles`, personalities, or self-development).
