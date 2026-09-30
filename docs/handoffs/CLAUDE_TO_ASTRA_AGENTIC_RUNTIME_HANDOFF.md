# Claude → Astra: the local agentic runtime

Recorded 2026-09-21. Successor to `ASTRA_TO_CLAUDE_AGENTIC_LOOP_HANDOFF.md`,
whose claims I verified before building (all held; see §7).

**Read this file, `docs/agentic/ARCHITECTURE.md` §4 (deviations), and the diff.
Do not reconstruct anything from chat history.**

---

## 1. What this is

An unattended local development loop for ORION: a ~27B worker implements against
explicit task contracts, a stronger local model reviews against those contracts,
the orchestrator enforces the gates, and anything the local ladder cannot resolve
pauses the run and alerts Nick on Discord. Astra escalation is **manual**, as
instructed.

The canonical statement of intent is `docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md`,
written from Nick's direct instruction as a specification rather than a
transcript. Treat it as the authority on *why*; treat this as the record of
*what I built and what I am unsure about*.

**A full audit against the mission was run on 2026-09-22 and the twelve defects
it found are fixed. Read §10 before the rest of this file** — four of them were
on the path Nick would use at 03:00 when something had already gone wrong, and
one of them meant the smoke run in §8 could never have passed.

**Nothing has run against real ORION code. The system is disabled by default.**

---

## 2. State of the repository

- Branch `orion-v2/backlog-checkpoint`, on top of Astra's `6307a82`.
- Untracked `capabilities.md` **preserved**, not swept into any commit.
- All three existing worktrees preserved; none reset, rebased or recreated.
- No push, no deploy, no install, no app bundle, no config or permission writes.
- `~/.openclaw/orion-controlled/project-agent/` still contains **no run**.
  `agentic-config.json` was not created; the system is off.

### Schema change you should know about first

`scripts/lib/orion-project-agent.mjs` moved from **v1 to v2** in place, and is
now at **v3** (task-level escalations; see §10). Every invariant Astra's 12 tests
asserted still holds and all 12 still pass; only the fixtures changed (they now
carry `scope` and `checks`, and pass `maxAttempts: 2` explicitly because the
runtime default is now 3).

No migration path was written. The handoff verified no production v1 state ever
existed, and a migration nobody needs is a code path nobody tests. The Swift
decoder now **refuses** v1 rather than partially reading it.

---

## 3. Verification actually performed

| Check | Result |
|---|---|
| `node --test` — 4 new agentic suites + the controller suite | **59 passed, 0 failed** |
| `scripts/orion_v2_ci_check.sh --quick` | **OK** — 197 security invariants, 348 plugin tests, 82 automation, agentic suites registered and green |
| `python3 scripts/orion_v2_secret_scan.py --allowlist …` | clean, 30 reviewed fixtures allowlisted |
| `plugin/orion-control` `tsc --noEmit` | clean |
| `vitest run src/self-development-authority.test.ts` | 29 passed (after adding 5 surfaces) |
| Swift `swift build` + full `swift test` | **503 cases, 0 failures** across all three bundles (Xcode license is now accepted; the gate Astra hit is cleared) |
| `ProjectAgentStatusTests` + `ProjectAgentPanelTests` | 13 passed (was 3) |
| `Tests/run-project-agent-ui.sh` | **PASS** — the panel lays out in every state in a real NSHostingView |
| Live model run against qwen3.6:27b | see §6 |

The supervisor suite is **end-to-end against a real git repository with real
`node --check` execution** — only the model is faked. That was deliberate: the
failures this system must survive are filesystem and process failures.

**It already earned its keep.** Five real bugs were caught by these tests, not
by reading:

1. `git status --porcelain -z` output was being `.trim()`ed, which ate the
   leading status space and silently truncated the first changed file's path
   (`sandbox/widget.mjs` → `andbox/widget.mjs`). `node --check` then failed on a
   file that was fine, and a correct task blocked. This would have wasted an
   entire unattended night and looked like "the model is bad at JavaScript".
2. Correction tasks were scheduled *after* new planned work, so the next task
   built on the thing being corrected.
3. A `.foregroundStyle()` ternary mixing `HierarchicalShapeStyle` and `Color`
   broke the app build — caught only because I ran the real Swift build rather
   than the parse-only check.
4. Steering from the UI during a review bumped the revision, so the verdict
   failed to apply and **escalated** — waking Nick to report that he had touched
   the UI. Review, repair, final review and escalation now re-read state first.
5. An instruction arriving after the last task was handed to its worker made
   closure refuse (correctly — Astra's third repaired defect), and that
   exception propagated out of the loop and **killed the supervisor**. The run
   stopped, nobody was told, and the morning would have shown a process that was
   simply gone. It is now a `pending_steering` escalation, and the loop body can
   no longer throw out of the process at all.
6. `probe()` checked a model was *installed* but not *usable as configured*.
   `think: true` against a model that does not support thinking is an HTTP 400
   on every generation — a run that starts at 23:00 and does nothing all night
   with no visible cause. Found by pointing the streaming path at `llama3.2:3b`.
7. The live channel's flush returned early while another write was in flight and
   returned no promise, so `end()` could be dropped. Symptom: a finished
   generation whose panel said "thinking" forever — the exact lie the channel
   exists to prevent.

Items 4–7 are all the same failure mode: **something stops, and nobody is told.**
That is what this system is for, and none of them were visible by reading.

### One pre-existing breakage fixed in passing

Every GUI harness in `native/Orion/Tests/` was failing to build with
`no such module 'MobileCore'` — `SessionService` began importing it from the
sibling `OrionMobile` package and `build-modules.sh` never built or linked it.
Fixed, because I needed a harness to verify the panel. `LayoutHarness` has
separate rot of its own (`BreakSurface.isFullBleed` no longer exists), which I
left alone as someone else's design change — **worth knowing that harness is
still red for an unrelated reason.**

Both of those are the exact failure mode this system exists to avoid, and
neither was visible by reading the code.

---

## 4. What I want your judgement on

Ordered by how much it would cost to be wrong.

### 4.1 Is the contract the right shape? (highest leverage)

`scripts/lib/agentic/contract.mjs`. Eighteen fields. I checked that every one is
read by something that acts on it.

**Updated 2026-09-22**: `preconditions` was the weakest — prompt-only, verified by
nothing — and Nick's answer was to keep it and enforce it rather than drop it. The
machine-checkable forms (`exists:` / `absent:`) are now verified against the
worktree before the worker's first turn, and an unmet one blocks the task
immediately with the reason named rather than being discovered on the third
attempt. Anything else in the field stays prose and reaches the models as context.
`reviewDepth`, which genuinely was read by nothing, is now rendered for the
reviewer. The open question left for you is whether the enforceable vocabulary
should grow beyond those two forms.

The load-bearing decision is that **`scope` is an allowlist and it is the write
gate**, not advice. A task can only change files a human named. I believe this is
the single most important safety property in the design; it is also the one most
likely to make real tasks annoying to write. Tell me if the friction is wrong.

### 4.2 The reviewer-repair rung

`docs/agentic/ARCHITECTURE.md` §4.4. The reviewer may write code after the worker
exhausts its attempts, and every such change is recorded in `state.repairs`,
separately from `state.reviews`, and surfaced in the UI as *"N change(s) were
authored by the review model, not the worker."*

I am confident about the recording. I am **less** confident that one repair per
task and one further worker attempt is the right bound — it is a guess, made
configurable, never measured. It is also the place where reviewer independence is
weakest by construction: the model that wrote the fix is the model that will
review the worker's continuation of it.

### 4.3 Final-review `PASS_WITH_TASKS` escalates instead of creating tasks

§4.7. A cross-cutting correction has no parent to inherit scope from. My
resolution — escalate and let a human write the contracts — is safe but may make
final review a frequent escalation source in practice. If it fires constantly,
the right fix is probably a "run-level scope" on the plan rather than loosening
the inheritance rule.

### 4.4 Is `scripts/lib/orion-project-agent.mjs` too big?

556 lines, against the house rule's 200–400 typical / 800 max. I kept the state
machine in one file because its invariants are cross-cutting and splitting them
across modules would mean two places to look when a lifecycle assertion fires.
Reasonable people could split validation out. Your call.

### 4.5 Streaming, and what it exposed

Generation now streams so the panel can show live reasoning. Building that found
a real robustness gap: `probe()` checked a model was *installed* but not that it
was *usable as configured*. `think: true` against a model that does not support
thinking is an HTTP 400 on **every** generation — a run that would have started
at 23:00 and done nothing all night, with no obvious cause. `probe()` now does a
one-token generation per role and names the fix in the error. Worth checking I
have not made startup too slow for a 48 GiB machine that has to load a model to
answer.

### 4.6 Model selection was measured, not argued

Eight models, two evals, 15 reviewer runs. The hard reviewer eval plants three
real defects and two decoys and scores recall minus false positives, because an
earlier recall-only version rewarded flagging everything.

| reviewer | recall | false positives | consistency | source |
|---|---|---|---|---|
| **qwen3.6:27b** | **3.0/3** | **0.0** | 3/3 every run | dense 27B, 77.2% SWE-bench |
| gemma4:31b | 3.0/3 | 0.0 | 3/3 every run | dense 31B |
| devstral:24b | 3.0/3 | 0.0 | 3/3 every run | dense 24B, 46.8% SWE-bench |
| qwen3:30b | 2.3/3 | 0.0 | one 1/3 run | MoE 30B-A3B |
| qwen3-coder:30b | 2.3/3 | unmeasured | 2/3 typical | MoE 30B-A3B |
| qwen2.5-coder:32b | 1.7/3 | 0.3 | one 1/3 run | dense 32B, older |
| Qwen3-Next-80B IQ3_XXS | 1/2 judgment | — | failed 4/4 | MoE, heavily quantized |

`qwen3.6:27b` for both roles: top on published benchmarks *and* on the eval, and
one model means residency never changes — no eviction, no swap, `doctor` reports
a 21 GiB peak rather than 42.

Two findings worth carrying: the quantized 80B **codes well and reviews badly**,
which matches published work on aggressive quantization degrading MoE expert
routing and instruction-following while leaving generation intact. And the
27B's apparent slowness is **token volume, not throughput** — 923 vs devstral's
1,113 tok/min, but 11× the tokens, because it thinks. The thinking is the
accuracy.

---

## 5. Security posture

Worked inside ORION's existing architecture rather than beside it:

- The write gate **loads** `self-development-authority.js`, preferring the
  **installed** build, for the reason that file's own comments give.
- I added five surfaces to `FORBIDDEN_SELF_CHANGE_SURFACES` covering the new
  runtime. They are not in force until the plugin is rebuilt and deployed, so
  the runtime also carries its own deny-list of the same surfaces and checks
  both. Neither depends on the other being current.
- `GOVERNED_SELF_DEVELOPMENT_ENABLED` is **untouched and still `false`**. The
  legacy `scripts/orion-code` loop is untouched and must not be launched as a
  substitute; its hazards from Astra's handoff all still stand.
- Fail-closed: if no compiled policy loads, nothing is writable and `doctor`
  says so.
- No arbitrary shell anywhere in the model path. Checks are fixed argv from a
  registry that is itself deny-listed.
- Model endpoint is loopback-only, enforced at config load.
- Check subprocesses get a fixed environment — the operator's exported
  credentials are not inherited — and their own process group so a timeout kills
  descendants.
- The escalation notifier is injectable and the test suite never reaches the
  real webhook. Discord alerts are live on this machine.

**Reads are deny-listed, not scope-limited.** A worker that cannot read the
caller of the function it is changing writes the wrong function, so reads stay
wide. But anything it can read it can copy into a file it *is* allowed to write,
so `UNREADABLE_SURFACES` in `boundary.mjs` refuses `var/brain/` (Nick's Obsidian
vault), `var/data/`, any `.env`, private key material, and `.git/`. The worktree
is a `git worktree add` checkout and therefore contains **tracked files only** —
the untracked `.env` in the primary checkout is simply not present — which is
most of the protection; the deny-list is the rest.

This is defence in depth, not a guarantee: a permitted file that quotes
something sensitive is still readable. **I would like you to check the list is
complete** — I derived it from what is tracked today, and a future tracked path
holding personal data would not be covered.

---

## 6. The live run — what a real 27B actually did

`orion-agent bench --candidates "qwen3.6:27b/qwen3.6:27b" --hours 0.4`, against a
disposable git repository, with the real local model in both roles. Two
ORION-shaped tasks: add `remove(id)` to a small store, then cover it with a test
that imports the real module.

```
candidate                accepted  blocked  corr  repairs  wall  wt/hr
qwen3.6:27b/qwen3.6:27b  1/2       1        0     0        17m   6.99
```

- **`bench-remove`: accepted.** The worker wrote a complete file, `### CHECK`
  passed, the checkpoint committed, and the reviewer returned a valid `PASS`.
  The whole gate ran on a real model with no human.
- **`bench-cover`: blocked** (`worker_or_validation_failed`), and the run
  escalated `repeated_failure` rather than spinning to the budget.
- 3 worker turns (9.8 min of inference), 1 reviewer pass (2.3 min).
- **0 unusable replies, 0 rejected reviews, 0 refused writes.** The marker
  protocol, the JSON review schema and the boundary all held against a real
  model on the first try — the part I was least sure of.

So the path works end to end on this Mac. What it does not tell us is whether
the 27B is good enough, and **one run of one configuration is a smoke test, not
a benchmark**. Treat 6.99 weight/hour as a number to beat, not a result.

### It also exposed a defect in the harness

The disposable repository is deleted when a candidate finishes, and the journal
went with it — so the summary said `bench-cover` blocked and the explanation had
already been destroyed. A benchmark that throws away its evidence cannot answer
the question it exists to answer. Journals are now retained under
`~/.openclaw/orion-controlled/project-agent/bench-journals/` and the path is
recorded on the ledger line. **The blocked task above therefore has no surviving
diagnosis**; the next run will.

## 7. Astra's handoff claims I verified

All held. Branch, `18de992`, the three worktrees, untracked `capabilities.md`,
the absent production state path, `GOVERNED_SELF_DEVELOPMENT_ENABLED = false`,
the legacy coder's hazards, the installed models, and the note that `runProjectAgent`
performed one task per invocation and stopped at review.

**One thing changed since it was written**: the Xcode license gate is now
accepted, so the native build and XCTest run normally. That is why this handoff
can claim real Swift test results where Astra's could not.

---

## 8. What remains

**Before a first real run** (human decisions, none of which I made):

1. Rebuild and deploy the plugin so the five deny-list surfaces protecting the
   agent runtime are in the installed build. The runtime carries its own copy
   meanwhile, so this is belt-and-braces, not a blocker.
2. Create `~/.openclaw/orion-controlled/agentic-config.json` with
   `{"enabled": true}`. Nothing runs until it exists. It is outside the
   repository on purpose — the agent cannot write it, so it cannot turn itself
   on. **Model choice is now settable from the UI, `enabled` deliberately is
   not**; see ARCHITECTURE §4.13.
3. Run the smoke plan — it only touches `tests/workspace/agentic-smoke/`.
4. Watch one full run before leaving it overnight.

**Open, and worth your judgement:**

- **The worker eval is weak.** Five models scored 6/6; it cannot rank coding
  ability. The reviewer eval discriminates cleanly (15 runs, six models, clean
  separation) and is what the model choice rests on. A harder worker eval would
  need multi-turn support — the current one scores explore-first models as
  failures, which is why `qwen3-coder:30b` is unranked as a worker.
- **One diff, one coding task.** Both evals are narrow. They agreed with
  published SWE-bench on five of six models, which is reassuring, not proof.
- **Repair bound is now 2 files** (was 6). Still a guess, now a tighter one.
- **`devstral:24b` is a genuine alternative** — tied on the hard reviewer eval
  (3.0/3 ×3) at 4× the speed and 14 GB. I did not pick it because the version
  Ollama ships is the 46.8% SWE-bench original, not the 68% Devstral Small 2,
  and `qwen3.6:27b` is top-ranked on both published benchmarks and my eval.
  Devstral Small 2 GGUF exists and is untested.
- **PHASE_GATES.json** — no numbered gate closed. The `scopeNotInManifest`
  entry `supervised_local_project_agent` is updated and still describes this.

## 9. Files to review, in order

1. `docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md` — intent (Nick's, not mine)
2. `docs/agentic/ARCHITECTURE.md` §4 — **the eleven deviations**
3. `scripts/lib/agentic/contract.mjs` — the schema everything rests on
4. `scripts/lib/agentic/boundary.mjs` — the write gate
5. `scripts/lib/agentic/prompts/*.md` — the agent operating system
6. `scripts/lib/orion-project-agent.mjs` — the state machine (diff against v1)
7. `scripts/lib/agentic/supervisor.mjs` — the loop
8. `scripts/lib/agentic/activity.mjs` — the live thinking channel
9. `native/Orion/Sources/Orion/ProjectAgentPanel.swift` — the panel
10. `tests/agentic-*.test.mjs` and `native/Orion/Tests/ProjectAgentHarness/` — what I actually proved

---

## 10. Audit and fix pass — 2026-09-22

The runtime was audited line by line against all nineteen sections of the
mission prompt. The architecture held; twelve defects did not. Most were left by
the v3 task-level-escalation refactor, which updated some call sites and not
others — and the ones it missed were, with a grim consistency, the operator
path: what Nick reads and types when a run has already stopped.

### The operator path was broken in four places

| What | Where | Effect |
|---|---|---|
| Resolve argv missing `--id` | `ProjectAgentStatus.swift` | the panel's Resolve button **always** failed; the panel printed the correct command as help text while sending the wrong one |
| `resolve` passed the note as the escalation id | `scripts/orion-agent` | `orion-agent resolve` always threw "no such open escalation"; no `--id` flag existed |
| Discord resolve instruction missing `--id` | `agentic/brief.mjs` | the one message designed to be acted on from a phone gave a command that errors; now carries the real revision and id |
| `status` and `brief` read `state.escalation` | `scripts/orion-agent` | v3 renamed it to `escalations[]`, so the morning's first `status` showed nothing, and the Astra brief silently lost its "Why this stopped" section |

Both documented routes for clearing an escalation were dead at once. Nothing
tested the argv, which is why a rename took out the UI and the CLI together;
`ProjectAgentStatusTests` now asserts the resolve argv.

### The smoke run could not have passed

`no-orphan-exports` resolved references with `git grep`, which searches tracked
files only, and the worker runs its checks *before* committing. So a new module
whose caller was also new was always an orphan. `smoke-greeting` — the first
thing intended to run on this machine — would have burned three attempts and
escalated, and it would have read as "the model cannot write JavaScript".

Fixed in both halves: the grep now passes `--untracked`, and the plan's first
task creates the caller that makes its export reached. Verified both ways — the
smoke shape passes, and a genuinely unreferenced export still fails, so the
anti-gaming check keeps its teeth. The check also now recognises
`export { x }`, `export { a as b }`, `export async function` and `export var`;
it previously saw only four spellings, which is a loophole in a check whose
whole purpose is to be un-gameable.

### The reviewer could manufacture a false alarm

The independent re-run passed `baseline: new Map()`, so every pre-existing
export in a touched file looked newly added. Any that was not referenced
elsewhere failed only for the reviewer — the worker saw green — which is a
`contradiction` escalation with `recommendAstra: true`. A false alarm routed
into the loudest channel available is precisely the cry-wolf failure §9 forbids.
The baseline is now reconstructed from `task.commit^`, and an unresolvable ref
(a root commit) yields an empty baseline rather than killing the review pass.

### Reviewer repair could act on an escalated task

`repairable` filtered on status and attempts but not on open escalations, unlike
`claimableTasks`. After a `BLOCKED` review on the last attempt a task is both
blocked and escalated, so with other work still claimable the loop would spend a
reviewer call writing code into the task Nick had just been woken about — and
contradict the reviewer's own verdict, which per §4 means the local loop cannot
safely resolve it. `claimableTasks` is now exported and the supervisor uses it
instead of re-deriving the claim predicate, which is how the two disagreed.

### Three mission requirements were documented as satisfied but were not

- **Context (§13).** `num_ctx` was set, and nothing checked the prompt fitted
  inside it. Eight working-set files at the 90 KB cap is ~240k tokens against a
  65,536 window, and Ollama truncates the **front** — the contract. Now measured
  before every turn, with oldest-first eviction and refusal over silent
  truncation. See ARCHITECTURE §6.
- **Self-review (§3).** The five signals were in the prompt and nowhere in the
  code. The runtime now observes them and forces a read-only checkpoint turn;
  withheld actions are reported back so a dropped write is re-sent rather than
  repeated into the repetition detector. ARCHITECTURE §4.20.
- **Resources (§11).** RAM pressure, swap and thermals were unmeasured.
  `agentic/resources.mjs` samples them read-only around every generation and
  aborts on sustained critical pressure — and treats unmeasurable telemetry as
  unmeasurable rather than as an emergency, because a guard that fails closed on
  its own gauges takes the night down with it. ARCHITECTURE §4.21.

`### SEARCH` also walked straight through the read deny-list: `readScoped`
refuses `var/brain/` (Nick's vault, 47 tracked files) but `git grep` returned
matching *lines* from it. Hits are now filtered through `unreadableSurface()`
and `readScoped` resolves symlinks before matching. Verified: a term present in
three vault files returns zero vault hits.

`reviewDepth` was read by nothing at all — not even rendered into a prompt —
while `contract.mjs`'s own header claimed it drove attempt budgets. It is now
rendered for the reviewer, and the header says what is true: risk and review
depth inform prompts and self-review cadence and never widen authority.

### Verification actually performed

73 Node tests pass (65 before; the new ones cover the resolve argv, the
context budget, the resource parser and the self-review checkpoint). `swift
build` completes clean. `orion-agent doctor` exits 0 and probed the live Ollama
— both roles usable — and `orion-agent plan` validates the corrected smoke plan
with no scope findings.

**Still true: nothing has run against real ORION code, and the system remains
disabled.** `agentic-config.json` does not exist. The §8 list is what to do
before a first real run, and it is unchanged apart from the smoke plan now being
one that can pass.

**Not run in this pass:** the full `orion_v2_ci_check.sh` sweep and the 503-case
Swift suite. Nick asked to hold off on long test runs; the CI script now also
registers `tests/agentic-regressions.test.mjs`, so a full sweep is worth one run
before the first overnight session.

---

## 11. Canonical corrections — 2026-09-22, from Nick

Seven distinctions Nick corrected directly after reading the audit. They edit
the mission in place, which is the one route that may: intent is his. The
sentence they all serve now leads the mission — maximise Astra-acceptable work
per elapsed hour **while minimising how often he has to intervene.** The second
half is the part the first draft under-weighted, and three of the corrections
follow from it: an escalation is a cost, not a safety feature.

| # | Correction | Where it now lives |
|---|---|---|
| 1 | The worker **does** self-review and self-correct; it just cannot be its own approval gate | mission §3, ARCH §4.20 |
| 2 | Repair bounds are implementation defaults, **not architectural law** | mission §4A, ARCH §4.4 |
| 3 | `PASS_WITH_TASKS` returns work to the **worker**, including at final review | mission §4, ARCH §4.7 |
| 4 | Human-authored JSON plans are a **current limitation**, not the philosophy | mission §5, ARCH §8 |
| 5 | Claude is the current implementation agent, **not a permanent rung** | mission §2 |
| 6 | `preconditions` stays: optional, but **enforceable** | mission §5 |
| 7 | Show the agentic loop **as a loop** in the UI | mission §15 |

### What changed in the code, not just the prose

**Self-review (1).** The checkpoint turn previously withheld writes. That was
wrong twice: it blocked self-correction at the exact moment the model had just
found the problem, and it spent two turns of a fourteen-turn budget per
checkpoint. Now only `### DONE` is withheld — correction is the point,
self-approval is the prohibition. Triggers also dedupe per cause, because
`risk: high` otherwise scheduled a checkpoint on every write *including the
corrective write made during a checkpoint*, and a high-risk task would have
spent its budget reviewing itself.

**Repair bounds (2).** `repairMaxFiles`, `repairsPerTask` and
`repairRetryAttempts` joined `repairAfterAttempts` in `config.limits`, validated
at load. Nothing reads a constant any more.

**Final review (3).** `applyFinalReviewCorrections` turns a cross-cutting
`PASS_WITH_TASKS` into ordinary worker tasks scoped to the **run scope** — the
union of the scopes a human wrote into the plan. Nothing is invented, because
every path in that union was approved by a person. Only a correction reaching
*outside* it escalates. This needed one narrow controller change: a review row
may now be run-level (`taskId` and `commit` both null), because the final review
names no task and no checkpoint, and saying so with nulls beats pointing at
something that does not exist. Per-task reviews keep the strict rule.

**Preconditions (6).** `exists:` and `absent:` forms are verified against the
worktree before the worker's first turn; anything else stays prose and reaches
the models as context. An unmet precondition blocks immediately with the reason
named, rather than being discovered on the third attempt. `accepted:` was
deliberately not added — `dependencies` already says that, and two ways to say
one thing is one way to disagree.

**The loop dial (7).** `ProjectAgentLoop.swift`: IMPLEMENT → SELF-CHECK →
REVIEW → CORRECT around a ring, with ESCALATE named separately as the exit that
costs Nick something. Position comes from the task's durable `stage` and the
run's status — never from a model asserting where it is — and the ring tints
dim when the heartbeat is stale, so a loop that has stopped does not look like a
loop that is turning.

### Verification

74 Node tests pass, including a new one proving a `PASS_WITH_TASKS` final review
produces a correction task with **zero escalations**, and the corrected
self-review test proving the checkpoint correction is applied while the `DONE`
riding with it is withheld and recorded. `swift build` clean.
`Tests/run-project-agent-ui.sh` passes in all four panel states with the dial in
place (911pt with a short trace). Secret scan clean.

Still true: nothing has run against real ORION code, and the system is disabled.

---

## 12. Stuck detection, halt controls, and the final sweep — 2026-09-22

Three things Nick asked for after the corrections, and one defect the work on
them exposed.

### A worker can now be stuck without being wrong

Repetition detection catches a model repeating itself byte for byte. It never
caught the shape that actually costs a night: a worker that keeps editing, keeps
running checks, produces *different* output every turn, and gets nowhere.

Progress is now defined positively — a turn progresses if it wrote a file it had
not written before, or moved a check from failing to passing — and
`stuckAfterTurns` (default 4) fruitless turns means stuck. Nick is told **once**,
informationally, and the task goes to the reviewer for repair **immediately**
rather than after the attempt budget drains, because spending two more attempts
against the same wall is what being stuck means.

**The defect this exposed**, found while reviewing it: the counter originally
incremented on *every* turn, so a worker spending turns on `### READ` and
`### SEARCH` was declared stuck. That punishes precisely what the worker's own
system prompt prescribes — *"stop editing, read a different file: the caller,
the test, the type definition"* — and it would have fired hardest on the hard
tasks, where the reading matters most. A turn now counts only if the worker
actually tried to move the work (a write, a check, or a `### DONE`). Pure
investigation stays bounded by the turn budget and repetition detection.

### Three ways to halt, reachable from anywhere

`pause` holds; `stop` ends at the next safe boundary, fully resumable;
`exterminate` abandons the generation in flight. All three are durable
controller requests rather than process signals, which is what lets the ORION
panel, the operator CLI and Discord reach the same switch. The supervisor polls
for `exterminate` on its heartbeat tick, because the process that has to act on
it may be nine minutes into a generation.

Discord control went into the **existing** verb grammar in `scripts/orion-remote`
as one verb with a closed sub-vocabulary — `agent status|pause|resume|stop|exterminate`
— rather than a parallel listener, so it inherits the sender allowlist, the taint
gate, the lock check and the rate limits unchanged. The destructive action needs
two deliberate tokens: a bare "stop" still falls through to conversation and
cannot touch the agent. Nothing there can START a run; enablement stays a file
outside the repository.

Exterminate is abrupt, not destructive. The task's outcome becomes genuinely
unknown, which the controller already models: the lease is retained, the run
reconciles on next start, and any half-written mutation is discarded back to the
last accepted commit.

### Two safety properties strengthened along the way

- **The worker lease now carries a real owner record** (`acquireLease` rather
  than a bare `mkdir`), and `inspectLease` no longer reports a lease directory
  with no readable owner as "no lease". That combination was the one way two
  writers could still have met on one worktree — the failure `lease.mjs` exists
  to make impossible.
- **Inference is raced against the abort signal** (`agentic/cancellation.mjs`),
  so a cancel interrupts a generation even if a backend ignores the signal it
  was handed. Only inference is raced; a filesystem mutation is never abandoned
  half-done, and a late model reply has no effects.

### The state lock no longer loses a race

`mkdir` is still the atomic primitive. What changed is contention: it used to
throw immediately, so an operator command landing in the same millisecond as a
controller commit knocked the supervisor's transaction over — and the write it
killed was the one recording that a task had stopped, leaving a task marked
`running` that nothing was running. It now waits up to two seconds, and reclaims
a lock older than a minute, which cannot belong to a live transaction.

### Verification

**89 Node tests** pass. `scripts/orion_v2_ci_check.sh --quick` is **OK** (197
security invariants, the plugin and automation suites, 22 architectural rules
held, 0 violated). `scripts/orion_v2_remote_check.sh` is **OK**, which matters
because this pass changed the inbound command path. `swift test` exits 0 and
`ProjectAgentStatusTests` passes 8/8 including the decoder-degradation case.
`Tests/run-project-agent-ui.sh` passes in all four panel states. Secret scan
clean.

**Still true: nothing has run against real ORION code, and the system is
disabled.** `agentic-config.json` does not exist.


## Follow-up verification — 2026-09-22 22:01 BST (Codex)

The five defects in the subsequent read-only recheck are now repaired: owned
worker leases and conservative recovery, cancellation across all reviewer
paths, bounded ordinary-failure retries, truthful Stop/restart controls, and
the contradictory smoke import constraint. See the newest `HANDOFF.md` entry
for exact behavior and evidence. Tests: **88 Node, 15 targeted Swift**, all
passing; real-source UI layout harness passed in all four states; independent
scoped review has no remaining findings. No enablement,
installation, real-model smoke, or overnight run is implied.

## 2026-09-22 — Reviewer runtime recovery (Nick-authorized addition)

Nick requested automatic reviewer recovery when an issue occurs during an unattended run. The supervisor now asks the reviewer to diagnose thrown loop/review/repair errors before escalating. The reviewer can authorize retry, unload resident models and retry with a fresh session, or request human escalation. Existing task-code repair remains constrained to the task scope and configured repair budget; recovery grants no shell, policy-edit, integration, or permission authority.

Recovery claims are saved in `state.runtimeRecoveries` before inference. Defaults are two recoveries per operation phase/task and six per run, persisted across relaunches. Inference has a 120-second recovery deadline; model unloading propagates cancellation. Failed or refused diagnosis and exhausted budgets escalate and notify before exit. A successful diagnosis only authorizes another attempt: normal checks, checkpoint review and final review still decide completion.

Stop, Pause, Exterminate, held/unknown worker leases, uncertain worker outcomes, explicit BLOCKED verdicts, check disagreements and unresolved escalations are not auto-cleared. This operates while the supervisor is alive; it cannot repair a powered-off machine, a crashed supervisor, unavailable reviewer, or startup failure before loop initialization. It does not install or enable the runtime.

Validation: 93/93 Node tests (`node --test tests/agentic-*.test.mjs tests/project-agent.test.mjs`), secret scan clean with reviewed allowlist, and `git diff --check` clean. Independent review reran four recovery tests and reported no remaining actionable findings. No live-model overnight proof or installation/enablement performed.

## 13. Readiness pass and install — 2026-09-23, from Nick

Nick's ten-point reply to the "will it run when I hit run" audit, followed by
*"install and make sure everything is ready for real use"*. Nothing was
enabled or launched. `agentic-config.json` still does not exist, because
**Enable & start** is what creates it. Nothing is committed, as the tree is
still the mixed dirty tree from before.

**Behaviour changed**

- **Settle, then decide** (ARCHITECTURE §4.22). An abort now waits up to
  `settleGraceMs` (60 s) for the worker to finish. Only a worker that never
  finishes is uncertain. This fixes the probe-confirmed deadlock in which a
  mid-task exterminate left the run `interrupted` with a stop standing that
  `resume` refused to clear.
- **Halts need no revision.** `pause`, `stop`, `exterminate` and `resume`
  cannot fail on a stale number. Exterminate also schedules a detached reaper
  that SIGKILLs the verified supervisor process (pid, boot id and start time)
  after 20 s if it has not exited (§4.20b).
- **Failure ladder** (§4.24). If the worker is stuck or times out, the reviewer
  repairs. If the review fails twice, the checkpoint goes back to the worker
  with feedback. A check disagreement goes back to the worker. A failed repair
  still gets the worker its retry. Every returned task carries
  `feedback` (§4.23).
- **Known checkpoints only** (§4.25). The tree is reset to the last reviewed or
  accepted commit before each claim, so a stray unreviewed commit is never built
  on.
- **Resource guard.** A one-time step in swap from loading the model (1.84 GiB,
  measured) no longer trips it. It stops only when swap is still growing, or
  when memory pressure is critical. The probe now loads the model at the real
  context size.
- **Runtime recovery review** (ARCHITECTURE, amended section). Three gaps closed:
  - a task-level escalation no longer switches recovery off;
  - an unreachable reviewer gets a host-made "wait 30 s, retry" within the same
    budget, recorded `decidedBy: "host"`;
  - the supervisor's pause check read a field that does not exist.
  A reviewer answering outside the three allowed actions is still refused.
- **Keep-awake** (`scripts/lib/agentic/awake.mjs`). The run holds
  `caffeinate -i -s -w <pid>`, with optional display-on and an activity nudge.
  A read-only preflight reads what macOS says closing the lid will do and warns;
  it never blocks a start. Nothing touches `pmset`.
- **Every printed command carries `--project <id>`.** Discord alerts now pass
  `root`, so they print the project's own commands. `orion-agent commands`
  prints the whole reference.
- **Discord `agent` control.**
  - It resolves the active project.
  - Under launchd, which cannot read `~/Desktop`, it falls back to the
    controller copy installed beside the bridge.
  - The installer's DRIFTED fingerprint now covers that controller copy as
    well.

**Installed**

- **Discord bridge:** reinstalled twice, and not DRIFTED afterwards. The second
  install came after the recovery fix and the wider fingerprint. It is
  connected.
- **ORION app:** release build 275, signed with the same "Orion Local Signing"
  identity (designated requirement unchanged, so the TCC grants carry over).
  - Passes `codesign --verify --strict --deep`.
  - The previous app is kept at
    `/Applications/.Orion-previous-275-pre-keepawake-20260923.app`.
  - Relaunched with no crash report.
  - A window capture shows Projects → Advance ORION capabilities as "Ready to
    start", with **Enable & start**, the keep-awake options and the preflight
    line.
- **Plugin:** already current. Built and installed fingerprints match
  (`e0fbbeb7ab40`), and the five agentic deny-list surfaces are in the installed
  build. It was not redeployed.

**Verified**

- **Node:** 174/174 across all 12 agentic suites.
- **Swift:** `swift test` 513/513 across three bundles, including 6 new
  `ProjectKeepAwakeTests`. `swift build` is clean.
- **UI:** `run-project-agent-ui.sh` passes.
- **Repo checks:** `orion_v2_ci_check.sh --quick` OK and
  `orion_v2_remote_check.sh` OK; the live `remote.json` is byte-identical.
- **Secret scan:** nothing in the agentic files. Its 30 findings are
  pre-existing fixtures elsewhere.
- **Mutation checks:** the new recovery tests fail when each fix is reverted.
- **Test safety:** the supervisor test wrapper now silences all four
  notifiers, so no test can reach the live Discord alert path.

**Preflight** (read-only, no run)

- **`doctor`:** qwen3.6:27b is installed and usable in both roles. No leases are
  held.
- **Memory:** swap is 8.5 GiB and compressed memory 12.9 GiB, at pressure 2
  (warn). A reboot before an overnight run helps.
- **Plan:** validates, with 5 tasks, weight 12 and no scope findings.
- **Baseline:** the plan's automation suites pass 82/82 on an exported copy of
  HEAD. `automation-install.test.mjs` does not exist yet; task 1 creates it,
  and it is in scope.
- **Power:** on battery at 30–42%, discharging. macOS reports that closing the
  lid will not sleep the Mac (Vorssaint).

**Open**

- **The worktree forks from HEAD `bbe4575`.** None of today's runtime changes
  are committed. That is harmless for this plan, which only touches committed
  automation code, but the tree has 54 dirty paths waiting on Nick's decision.
- **`ProjectAgentPanel.swift` is the legacy single-root panel.** It is used
  only by the UI harness, and its hints remain in the legacy form on purpose.
- **Keep-awake is not restarted if `caffeinate` is killed from outside.** The
  receipt reports it instead.
- **A corrupt `launchOptions` makes `launch` refuse until it is fixed by
  hand.**

## 14. Briefs mechanism, and where the briefs themselves stand — 2026-09-23

Nick asked for the plan to be substantial enough for the local models to work
from "for literally hours on end", **with Astra's plan left intact**. It is: not
one byte of `advance-orion-capabilities.md` changed.

**Built and tested (184/184 Node, Swift suite passing)**

- A plan may have briefs in a folder beside it: `<plan>.briefs/common.md` plus
  `<task-id>.md` (ARCHITECTURE §4.26, OPERATING §2).
- The host loads them into each contract's `brief`, capped at 18,000
  characters. They are rendered after the contract for worker, reviewer and
  repair alike, under a heading that says the contract governs.
- Loading is strict: orphan, stray, empty, oversize and doubled briefs are all
  refused.
- The brief joins the digest only when present. Existing digests are unchanged,
  and a test pins the legacy formula.
- Correction tasks inherit their parent's brief; a reviewer cannot author one.
- `orion-projects add` snapshots the briefs with the plan. `orion-projects
  refresh <id>` re-takes plan and briefs before a project's first start.
- The Plan tab shows whether briefs exist. That view is built and tested but
  **not yet installed** in /Applications.
- The bridge was reinstalled and is not DRIFTED.

**Not done: the briefs themselves.** The workflow that researches each task at
HEAD, writes the briefs, fact-checks them with two skeptics, cold-reads them as
the worker would, and checks cross-brief consistency was **stopped during
research** on Nick's instruction to finish up (usage). No brief file exists.
The run therefore behaves exactly as before (contracts only) until they are
written.

To finish:

1. Write `docs/agentic/plans/advance-orion-capabilities.briefs/`.
2. Run `scripts/orion-agent plan docs/agentic/plans/advance-orion-capabilities.md`
   and confirm every task carries a brief.
3. Run `scripts/orion-projects refresh advance-orion-capabilities` to put the
   briefs into the saved project, which has not been started.

The workflow script is saved under this session's
`workflows/scripts/plan-briefs-*.js`.

**Also stopped:** the final six-dimension adversarial review (the
`final-pass-review` workflow). Its results were not collected.
