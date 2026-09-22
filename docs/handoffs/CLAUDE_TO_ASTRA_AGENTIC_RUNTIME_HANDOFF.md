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
