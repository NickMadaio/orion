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

`scripts/lib/orion-project-agent.mjs` moved from **v1 to v2** in place. Every
invariant Astra's 12 tests asserted still holds and all 12 still pass; only the
fixtures changed (they now carry `scope` and `checks`, and pass `maxAttempts: 2`
explicitly because the runtime default is now 3).

No migration path was written. The handoff verified no production v1 state ever
existed, and a migration nobody needs is a code path nobody tests. The Swift
decoder now **refuses** v1 rather than partially reading it.

---

## 3. Verification actually performed

| Check | Result |
|---|---|
| `node --test` — 4 new agentic suites + the controller suite | **57 passed, 0 failed** |
| `scripts/orion_v2_ci_check.sh --quick` | **OK** — 197 security invariants, 348 plugin tests, 82 automation, agentic suites registered and green |
| `python3 scripts/orion_v2_secret_scan.py --allowlist …` | clean, 30 reviewed fixtures allowlisted |
| `plugin/orion-control` `tsc --noEmit` | clean |
| `vitest run src/self-development-authority.test.ts` | 29 passed (after adding 5 surfaces) |
| Swift `swift build` + full `swift test` | **247 passed, 0 failed** (Xcode license is now accepted; the gate Astra hit is cleared) |
| `ProjectAgentStatusTests` | 8 passed (was 3; 5 added) |
| Live model run against qwen3.6:27b | see §6 |
| Live model run | see §6 |

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

Both of those are the exact failure mode this system exists to avoid, and
neither was visible by reading the code.

---

## 4. What I want your judgement on

Ordered by how much it would cost to be wrong.

### 4.1 Is the contract the right shape? (highest leverage)

`scripts/lib/agentic/contract.mjs`. Eighteen fields. I checked that every one is
read by something that acts on it, but the mission's warning about bureaucracy
cuts both ways: `preconditions` is the weakest — it only reaches the prompt and
nothing verifies it. Consider whether it should be dropped or enforced.

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

### 4.5 The 48 GiB budget, with a measured correction

I estimated the 27B at ~17 GiB resident. **Measured on this machine at 64k
context: 20.7 GiB** (`/api/ps` during the live run). The default in
`models.mjs` says 17 and should be corrected — it is a config value, not a
hard-coded assumption, but a wrong estimate is how a reviewer handoff starts
swapping.

An ~80B reviewer at Q4 is 36–48 GiB. With the worker measured at 20.7, the two
genuinely cannot coexist, which the exclusive-residency design already assumes.
**No ~80B model is installed**, so the ~27B/~80B hierarchy the mission describes
has never been exercised. The reviewer default is `gemma4:31b` as an interim.

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

1. Rebuild and deploy the plugin so the five new deny-list surfaces are in force.
2. Create `~/.openclaw/orion-controlled/agentic-config.json` with
   `{"enabled": true}` and correct `approxResidentGiB` for the worker to ~21.
3. Run the smoke plan: `orion-agent plan/init/run docs/agentic/plans/smoke-run.json`.
   It operates only on `tests/workspace/agentic-smoke/`.
4. Watch one full run before leaving it overnight.

**Open work:**

- Pull and benchmark an ~80B-class reviewer; the hierarchy is untested.
- Benchmark properly: several candidates, several repetitions, real tasks.
- Decide the read-scope question in §5.
- The UI shows escalation, heartbeat, corrections and reviewer-authored changes,
  but the circular/gradient progress treatment Nick described is still the
  existing simple ring. Backend exposes everything the richer UI needs.
- `PHASE_GATES.json` — I did **not** close any gate or add an entry. The
  `scopeNotInManifest` entry `supervised_local_project_agent` that Astra added
  still describes this work; it may want updating, but that is a registration
  decision I left to you.

---

## 9. Files to review, in order

1. `docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md` — intent (Nick's, not mine)
2. `docs/agentic/ARCHITECTURE.md` §4 — **the eleven deviations**
3. `scripts/lib/agentic/contract.mjs` — the schema everything rests on
4. `scripts/lib/agentic/boundary.mjs` — the write gate
5. `scripts/lib/agentic/prompts/*.md` — the agent operating system
6. `scripts/lib/orion-project-agent.mjs` — the state machine (diff against v1)
7. `scripts/lib/agentic/supervisor.mjs` — the loop
8. `tests/agentic-*.test.mjs` — what I actually proved
