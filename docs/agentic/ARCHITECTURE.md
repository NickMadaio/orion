# The local agentic runtime — architecture

Companion to `LOCAL_AGENTIC_DEVELOPMENT_MISSION.md`, which says *why*. This says
*how*, and records the places where the implementation deliberately differs from
the mission's suggested mechanism.

Built 2026-09-21 by Claude, on the disabled controller foundation Astra left at
`18de992`. **Nothing has run against real ORION code.**

---

## 1. Where it lives

```
scripts/orion-agent                    entrypoint: doctor, plan, init, run, status, brief, resolve, bench
scripts/orion-project-agent            operator controls: pause, resume, steer, resolve
scripts/lib/orion-project-agent.mjs    THE DURABLE CONTROLLER — owns all workflow state (schema v3)
scripts/lib/agentic/
  contract.mjs      task + review contract schema. The one definition of "a task".
  boundary.mjs      the write gate: structure → containment → scope → deny-lists
  checks.mjs        the fixed-argv check registry. The only commands that run.
  workspace.mjs     git worktree, scoped writes, verified checkpoints, diffs
  lease.mjs         exclusive leases with PROOF of who holds them
  journal.mjs       append-only audit, two streams
  models.mjs        role registry, Ollama backend, exclusive residency
  prompts.mjs       prompt assembly and reply parsing
  cancellation.mjs  races inference against an abort — never a file mutation
  context.mjs       the input-token budget: estimate, evict, refuse
  resources.mjs     read-only RAM/swap/thermal telemetry and the inference guard
  prompts/*.md      THE AGENT OPERATING SYSTEM (worker, reviewer, repair)
  worker.mjs        the ~27B agentic loop for one task
  reviewer.mjs      review, bounded repair, final review
  escalation.mjs    Discord alerting, rate limiting, brief writing
  brief.mjs         the phone message and the Astra brief
  supervisor.mjs    the deterministic loop, watchdog, recovery
  activity.mjs      the live thinking channel — one disposable snapshot, throttled
  settings.mjs      operator settings; models editable, `enabled` deliberately not
  bench.mjs         model benchmarking in a disposable repository
  evals/            reviewer-hard.mjs, worker-eval.mjs — how models are chosen
native/Orion/Sources/Orion/ProjectAgentStatus.swift        the UI's read model (v3) + heartbeat
native/Orion/Sources/Orion/ProjectAgentInstructions.swift  activity, settings and prompt readers
native/Orion/Sources/Orion/ProjectAgentPanel.swift         two clocks, live reasoning, controls
native/Orion/Sources/Orion/ProjectAgentLoop.swift          the loop, drawn as a loop, from durable stage
native/Orion/Sources/Orion/ProjectAgentReviews.swift       what the reviewer said, and where it wrote code
native/Orion/Sources/Orion/ProjectTab.swift                hosts the panel
docs/agentic/plans/smoke-run.json                     the first thing to run
```

---

## 2. The loop, in one diagram

```
 orion-agent run
      │
      ├─ acquire supervisor lease (pid + boot + start time)
      ├─ probe models — refuse now, not at 02:00
      ├─ recover: reclaim a provably-dead lease, reconcile `interrupted`,
      │           discard any half-written mutation back to HEAD
      │
      └─ loop until budget / completed / escalated:
             │
    ┌────────┴─── status?
    │
    ├─ escalated  → notify once → STOP
    ├─ paused     → hold the lease, poll, continue when resumed
    ├─ awaiting_review → REVIEWER
    │                     PASS            → accept
    │                     PASS_WITH_TASKS → accept + append correction tasks
    │                                       (back to the WORKER, not to Nick)
    │                     BLOCKED         → escalate
    │                     unusable twice  → checkpoint withdrawn, back to the WORKER
    │                     checks disagree → checkpoint withdrawn, back to the WORKER
    │                     (never a silent accept — the gate does not open)
    ├─ blocked: stuck / timed out, or attempts ≥ repairAfterAttempts
    │          → BOUNDED REVIEWER REPAIR   (tree reset to last known, work kept)
    │                     repaired        → worker continues, told what was done
    │                     repair failed   → worker continues, told it was not
    │                     repair declined → escalate
    ├─ blocked, attempts left → retry from the last KNOWN checkpoint, told why
    ├─ all accepted, no final review → FINAL REVIEW
    │                     PASS_WITH_TASKS → corrections under RUN SCOPE → WORKER
    │                                       (outside run scope → escalate)
    └─ else → runProjectAgent: claim ONE task → WORKER → verify → awaiting_review
             │
             └─ watchdog after every branch: stall / repeated failure / repeated blocker
```

Every branch ends in a durable, fsynced state transition. One task per
`runProjectAgent` call means every task boundary is also a process boundary: a
crash costs the task in flight, never the night.

---

## 3. The write gate

Four layers, all of which must pass, checked **before any bytes are written**:

| Layer | Question | Source |
|---|---|---|
| structure | is this a usable relative path? | `boundary.mjs` |
| containment | does it resolve inside the worktree? | `realpath` of the nearest existing ancestor |
| scope | did a human approve **this task** to touch it? | the contract's `scope` allowlist |
| runtime policy | is it a surface that governs the agent? | `RUNTIME_PROTECTED_SURFACES` |
| ORION policy | is it one of ORION's security surfaces? | the **installed** `self-development-authority.js` |

Fail-closed: if the compiled ORION policy cannot be loaded at all, nothing is
writable and `doctor` says so.

The runtime deny-list is self-referential — `scripts/lib/agentic/` includes
`boundary.mjs` and `prompts/`. A worker that can edit the code and instructions
constraining it can remove its own constraints.

---

## 4. Deviations from the mission

Each of these is a case where the mission's suggested mechanism had a materially
better implementation, or where reality forced a choice the mission did not
anticipate. **These are the things for Astra to argue with.**

### 4.1 Checks are registry names, not commands

The mission did not specify, and the legacy coder took a shell string from the
task. A task description is data a model can influence, so "the check for this
task is `rm -rf ~/Desktop`" becomes a sentence that executes. Contracts now name
a check; the argv lives in `checks.mjs`, which is itself deny-listed. Adding a
check is a reviewed human edit.

### 4.2 The worker gets a tool vocabulary, not a shell

`READ`, `SEARCH`, `FILE`, `CHECK`, `DONE`, `BLOCKED`, `PROPOSE`. No arbitrary
command execution anywhere in the worker path. The mission asked to "think
through shell permissions"; the conclusion was that the safest shell permission
is not having a shell.

### 4.3 Whole files, never diffs

Carried forward from `scripts/orion-code`, which measured it: at 27B, diffs come
back with wrong line numbers and overlapping hunks, and each one is a silent
no-op or a mangled file. A complete file has one failure mode instead of five.

### 4.4 Reviewer repair is bounded and surgical; the numbers are configuration

`grantRepairRetry` does not reset `attempts` to zero — that would let a single
task consume attempt budget indefinitely, one repair at a time, which is the
ping-pong the bounds exist to prevent. **That** is the architectural part, along
with: repair is recorded separately from review, may not redesign, and returns
control to the worker.

The numbers are not architecture and are not compiled in (mission §4A, corrected
2026-09-22). All four live in `config.limits` and may be tuned per machine or per
run without touching code:

| Limit | Default | What it bounds |
|---|---|---|
| `repairAfterAttempts` | 3 | failed worker attempts before repair is permitted |
| `repairMaxFiles` | 2 | files one repair may write; more is a design change, which escalates |
| `repairsPerTask` | 1 | repairs a single task may receive at all |
| `repairRetryAttempts` | 1 | further worker attempts a successful repair buys |

They started as guesses and are meant to be measured (§11). A guess in a `const`
is a guess nobody revisits.

### 4.5 Corrections inherit scope and may only narrow it

A `PASS_WITH_TASKS` correction cannot request files the parent task was not
approved to touch. Otherwise a review could grant the worker reach no human
approved. A correction that genuinely needs wider scope is a `BLOCKED`.

### 4.6 Corrections are scheduled BEFORE new planned work

Found by a test. A review found something wrong with work that was just accepted;
letting new planned work start on top of it means the next task builds on the
thing being corrected, and the correction has to be applied twice.

### 4.7 Final-review `PASS_WITH_TASKS` returns work to the worker, under run scope

**Superseded 2026-09-22.** This deviation previously escalated every
cross-cutting correction, on the reasoning that it had no parent task to inherit
scope from. That reasoning was right about scope and wrong about the outcome:
`PASS_WITH_TASKS` is a local verdict, and routing it to a human inverts the
thing the loop is for — an escalation is a cost, not a safety feature.

Corrections from a final review now inherit the **run scope**: the union of the
scopes a human already approved across the plan's tasks. Nothing is invented and
no reviewer grants itself reach, because every path in that union was written by
a person. The corrections become ordinary tasks, the worker does them, and they
are reviewed like anything else.

What still escalates is the case that genuinely needs a judgement: a correction
naming a file outside the run scope. No human has approved work there, and
whether this run may touch it is not a question about code.

### 4.8 Two journal streams

The mission asked for an audit trail. A naive implementation allocates every
event a sequence number from durable state, which means journalling bumps the
revision — and the operator's `pause --revision N` then races the agent's own
logging. So `control` entries (state transitions) are sequenced and contiguous;
`observation` entries (what the models did) are not. `auditJournal` checks
contiguity only on the control stream.

### 4.9 The reviewer default is not an 80B model

No ~80B model is installed on this machine. A default naming an absent model
fails at 02:00 instead of at startup, so the default is the largest installed
model (`gemma4:31b`) and `agentic-config.json` overrides it the moment an
80B-class model is pulled. `probe()` refuses to start a run whose models are
missing.

### 4.10 Progress may go DOWN, and says why

When a review adds corrections the denominator grows. The alternative — hiding
scope growth to keep the number monotonic — is the "72% complete" the mission
explicitly rejects. `correctionTasks` and `scopeGrowth` are exposed beside the
percentage, and the UI marks review-authored tasks with their own icon.

### 4.11 Pending steering at closure escalates rather than crashing

Astra's third repaired defect makes closure refuse when an instruction arrived
after the last task was handed to its worker — correctly, because discarding it
would be silent. That refusal threw out of the supervisor loop and killed the
process: the run stopped and nobody was told. It is now an escalation that
quotes the instruction and asks whether to turn it into a task or dismiss it.

### 4.12 Inference streams, and the thinking channel is a separate file

A non-streaming request to a 27B is indistinguishable, from outside, from a dead
inference runtime — for nine minutes at a time. Generation now streams, so
"it is thinking" is an observed fact rather than an inference from elapsed time,
and the reasoning is published live.

It is published to `activity.json`, **not** the journal: the journal is the
durable audit record and reasoning traces are enormous, are not evidence, and
would bury it. `activity.json` is one snapshot, overwritten in place, throttled
to ~400ms, never fsynced. Losing it costs nothing. Transitions (thinking starts,
thinking stops) bypass the throttle, because the indicator's whole job is to
distinguish working from hung and a lagging indicator cannot do that.

### 4.13 The panel shows settings but does not edit them

`enabled` decides whether a model may change real code while nobody is watching,
and it lives outside the repository so that moving it takes a deliberate act. A
toggle in a window is not that act. The panel shows every setting and the exact
file path; changing them is a file edit.

### 4.14 Escalation is TASK-level, and `escalated` means "stuck"

The first design made escalation run-level: one BLOCKED review halted everything.
That contradicted the mission's continuity requirement directly — independent
tasks sat untouched while the night went by. Now an escalation names a task,
parks that task alone, and the loop carries on; `escalated` means *nothing
claimable remains*, not *an escalation exists*. Only a run-level escalation
(taskId null) stops work immediately.

Three consequences worth knowing: `settleStatus` became the single answer to
"what can the loop do now" and several hard-coded `'ready'` assignments were
lies once the queue emptied; a task escalated before it ever ran stays `queued`
and is parked by the claim filter rather than marked `blocked`, because a blocked
task with zero attempts violates the lifecycle invariant; and the UI must tell
"something needs you" apart from "the run stopped", or it teaches you to ignore
the first.

### 4.15 The reviewer re-runs the checks

The gate used to judge a diff plus the worker's own report of its check results.
`verify` validated the shape of that report but never re-executed anything, so
evidence and subject came from the same process. The reviewer now re-runs the
contract's checks itself, and a disagreement is a `contradiction` escalation
rather than a finding to argue about — either the check is flaky or the worker
reported a result it did not get, and those need different responses.

### 4.16 Subtasks are declared by the worker and owned by the runtime

The mission names "current subtask" four times and the code had none. The worker
now emits `### SUBTASK: 2/4 label`, the controller records it durably, and it is
cleared whenever the task leaves the worker's hands. It is a progress label with
no authority: `stage` and the checks decide acceptance, and a subtask claiming
"4/4 finished" finishes nothing.

### 4.17 Context is bounded, not compacted

The mission asks for "periodic context compaction". This does not summarise
prior turns; it bounds them — a stable system prompt, the contract rendered
identically each turn, a working set capped at 8 files, and tail-biased check
output. Summarisation was rejected because a summary of a failed check is a
lossy copy of the one thing the next turn needs to read exactly, and because a
summariser is another model call that can be wrong. Recorded as a deviation
rather than silently skipped.

The bound is now enforced against the real window rather than asserted — see
§6, which describes the estimate, the eviction order and the refusal.

### 4.18 Enablement is a file outside the repository

`~/.openclaw/orion-controlled/agentic-config.json` must say `"enabled": true`.
Task scopes are repository-relative, so that file is outside every possible
scope by construction: the agent cannot turn itself on. Same spirit as
`GOVERNED_SELF_DEVELOPMENT_ENABLED`, which remains `false` and governs the
separate legacy loop.

**Changed 2026-09-23, by Nick's decision.** The panel's **Enable & start** now
writes that file (via `scripts/orion-projects launch … --enable`), so enabling no
longer needs a text editor. What did NOT change is the property that matters: the
switch is still outside the repository, it is still flipped only by a human
choosing an explicit action, and nothing the agent runs can reach it. The
launcher that writes it is itself on the runtime's protected-surface list, so no
task can alter what "enable" means. The earlier position — that enabling should
require a file edit — traded usability for a guarantee the launcher already
gives. What Nick required in return is that **stopping is at least as easy as
starting**, which is §4.20b.

### 4.19 `risk` and `reviewDepth` inform prompts; they never widen authority

The mission asks for risk classification and review requirements in the
contract. Both are now read: `risk: high` is one of the signals that forces a
worker self-review checkpoint (§4.20), and `reviewDepth` is rendered into the
contract block so the reviewer knows how far to dig.

Neither changes what a task may *do*. They do not grant attempts, widen scope,
or alter a gate. That is deliberate: a field a model can see and that also
relaxes a bound is a field worth lying about. An earlier draft of the header in
`contract.mjs` claimed these drove attempt budgets; they never did, and the
claim was removed rather than implemented.

### 4.20 Self-review fires on observed signals, and withholds only self-approval

The mission rejects "review every 50%" and lists the signals instead. The
runtime — not the prompt alone — now watches for them: a subtask boundary, a
check that flipped in either direction, the same failure output seen twice, a
write to a `high` risk task, and a write substantially larger than the task
implied. Any of those makes the NEXT exchange a self-review checkpoint.

The worker may **fix what it finds** in that same exchange — writing and
re-checking are self-correction, which the mission requires of it (§3, corrected
2026-09-22). The single action withheld is `### DONE`: a checkpoint turn cannot
end in the worker declaring its own work finished, because that is
self-*approval*, which is the one thing it may never do. It is told the marker
was withheld, so it re-asserts on the next exchange after the checks have
actually run rather than silently repeating a dropped action into the repetition
detector.

An earlier draft withheld writes too. That was wrong twice over: it made
self-correction impossible at the exact moment the model had just found the
problem, and it spent two turns of a fourteen-turn budget per checkpoint.

### 4.19b The stuck gate: busy is not the same as progressing

Repetition detection catches a model repeating itself byte for byte. It does not
catch the shape that actually costs a night: a worker that keeps editing, keeps
running checks, produces *different* output every turn, and never gets anywhere.

So progress is defined positively and counted. A turn progresses if it wrote a
file it had not written before, or moved a check from failing to passing.
`stuckAfterTurns` (default 4) barren turns in a row is a stuck worker, whatever
it says about itself. Being stuck is **not** a failure and does not end the
task: Nick is told once, informationally, and the problem is handed one rung up.

The reviewer then gets it **immediately**, without waiting for the attempt
budget to run out — spending two more attempts against the same wall is exactly
what being stuck means. Its repair prompt is told the worker is stuck rather
than wrong, and told not to repeat the approach that failed.

### 4.20b Three ways to halt, and they are different

| | what it does | in flight |
|---|---|---|
| `pause` | holds; lease kept; continues on resume | allowed to finish |
| `stop` | ends the run at the next safe boundary, fully resumable | allowed to finish |
| `exterminate` | abandons the generation in flight | aborted |

All three are **durable requests on the controller**, not process signals, which
is what lets the panel, the CLI and Discord reach the same switch. The supervisor
polls for `exterminate` on its heartbeat tick, because the process that must act
on it may be nine minutes into a generation at the time.

**None of them needs a revision number** (changed 2026-09-23). The revision
exists so a stale snapshot cannot act on a run that has moved, which matters for
steering and resolving because they carry content. It does not matter for a halt:
stopping is always safe, and "look up a number first" is not something anyone
should have to do while trying to stop a run.

**Exterminate is abrupt, not destructive — and restartable.** It aborts the model
call, then *waits, bounded, for the worker to actually stop* (§4.22). A worker
that stopped has a known outcome: its task goes back to the queue with the
attempt refunded, the tree returns to the last known checkpoint (§4.25), and
`resume` continues it. Only a worker that is still running after the grace
period is uncertain, which keeps the old shape: lease retained, run
reconciled on next start.

**If the supervisor itself will not stop**, exterminate still wins. The operator
CLI hands the wait to a small detached reaper — detached because the panel and
Discord call the CLI with 15- and 20-second timeouts — which, after 20 seconds,
SIGKILLs the exact process that held the supervisor lease when exterminate was
asked for: same pid, same boot, same start time. A reused pid, or a supervisor
that already exited, is never touched. The receipt lands in `exterminate.json`.
What is left behind is the crash shape recovery already reconciles.

**`resume` clears requests; it never reconciles work.** It used to refuse an
interrupted run outright. Combined with `run` refusing while a stop stood, that
made an exterminated run impossible to restart from anywhere. Clearing a flag is
always safe; what must not happen is a second writer beside a first that may be
alive, and recovery still guards that with proof the writer is dead.

A standing stop survives the process that honoured it, so `orion-agent run`
refuses to start under one and says how to clear it. Silently exiting at the
first boundary would look like a launch that did nothing.

### 4.20c The state lock waits rather than losing a race

`mkdir` is still the atomic primitive; what changed is contention. It used to
throw immediately, so an operator control landing in the same millisecond as a
controller commit could knock the supervisor's transaction over — and the write
it killed was the one recording that a task had stopped, leaving a task marked
`running` that nothing was running. Found by the EXTERMINATE test.

Transactions hold the lock for milliseconds, so it now waits up to two seconds
and then refuses. A lock older than a minute cannot belong to a live
transaction; it is debris from a crash between `mkdir` and `rmdir`, and it is
reclaimed rather than left to brick every future transaction.

### 4.22 Settle, then decide: a stopped worker is not an uncertain one

A task timeout and an exterminate both used to mark the outcome UNCERTAIN the
instant the abort fired — retain the lease, mark the run interrupted, reconcile on
the next start. That is correct only while the worker might still be writing, and
it cost far more than it protected: a timeout ended the whole night (an
interrupted run claims nothing), and an exterminate left a run nothing could
restart.

But the worker is an in-process promise whose model call, checks and loop all
honour the abort, so whether it stopped is **observable**. `runProjectAgent` now
waits, bounded by `settleGraceMs` (default 60s), for that promise to settle.
Settled means stopped writing, so the outcome is known:

| Cause | Outcome |
|---|---|
| exterminate | task back to the queue, attempt refunded — the operator stopped it; the worker did not fail |
| timeout | blocked as `worker_timeout` → the reviewer, immediately, like `worker_stuck` |
| still running after the grace | genuinely uncertain: the old behaviour, unchanged |

### 4.23 Every task sent back carries the reason it came back

The worker used to retry blind. `changes_requested` never showed it the
reviewer's findings; a failed attempt never showed it the error; a repair never
told it what the reviewer had done. So the same mistake could be made three times
with the attempt budget as the only thing that learned. Each of those paths now
records `task.feedback`, and the worker's prompt renders it as **WHY THIS TASK
CAME BACK**, straight after the contract. It is cleared when a checkpoint is
accepted.

### 4.24 The review rung can fail too, and the loop handles that locally

Nick's instruction (2026-09-23): *a timeout or being stuck should be handled by
the reviewer; if the reviewer gets stuck, the worker handles it — something has
to.* The one limit is that the worker can never stand in for the reviewer as an
approval gate, so "the worker handles it" means **producing a checkpoint the
reviewer can judge**, never approving its own:

- **Unusable review output** — one more try on the next pass; a second failure on
  the same checkpoint withdraws it and returns the task to the worker, told to
  make the change smaller.
- **Check disagreement** — the worker's reported green does not hold on an
  independent re-run. That is a failing checkpoint, which is the worker's to fix,
  so it goes straight back, told which checks failed. (It used to escalate as a
  `contradiction` recommending Astra on the first occurrence.)
- **Transport or timeout during a review** — runtime recovery reloads and retries
  first; a second failure hands the checkpoint back likewise.
- **A repair that itself fails** — the worker gets the further attempt it would
  have had, told no repair happened. The used repair still counts, so this
  cannot loop.
- **Out of attempts** — the task blocks as `review_unavailable`, which is Nick's.
  The reviewer is the rung that failed, so it cannot also be the rung that
  repairs.

### 4.25 Only KNOWN checkpoints are real — in history as well as in the tree

`discardToHead` removes uncommitted edits. It never removed a **commit** the
worker made and then failed with — verification refused it, or a stop landed while
git finished. That commit stayed on the run branch, the next attempt built on it,
and because a checkpoint's review diff is `commit^..commit`, its changes were
outside the one view the reviewer was given. Unreviewed work would ride in.

`resetToKnownCheckpoint` applies the system's own rule to history: the known
commits are the run's base, every recorded checkpoint and every recorded reviewer
repair, and the tree returns to the newest of them before every claim and retry,
at recovery, and on the way out of an exterminate. For a repair the files are
kept (unstaged) as the reviewer's evidence while the stray commit leaves history,
so the repair commit records only what the reviewer wrote. It never resets under
a held worker lease.

### 4.26 Briefs: reference material that travels with the contract

**Nick, 2026-09-23:** the plan *"is how the local model will know what to do for
literally hours on end, so it has to be made incredibly well and precisely"*,
and Astra's plan stays intact.

The gap is structural. Only `orion-task` blocks reach a model, and `context` is
2,000 characters. So each task in Astra's plan could say "read these five
files" and nothing about what is in them. A 27B worker with 14 exchanges per
attempt spends its attempts rediscovering signatures and record formats, or
guesses them. The worker's worktree is built from HEAD, so a reference document
left for it to READ must be committed first.

Therefore:

- A plan may have `<plan>.briefs/` beside it. `plan.mjs` loads `common.md` plus
  `<task-id>.md` into the contract's optional `brief` field, capped at 18,000
  characters (about 6k tokens, an eighth of the worker's input budget).
- The loading is strict: an orphan file, a non-`.md` file, an empty brief, an
  oversize brief, or an inline-plus-file brief is refused, because each of those
  would otherwise leave a task silently briefless.
- `renderContract` puts the brief after the whole contract, under a heading that
  says it grants nothing and that the contract wins. Worker, reviewer and repair
  see the same text.
- **Digest:** the brief joins the digest only when present. Every contract
  written before briefs existed keeps its recorded digest, which a test pins
  against the legacy formula.
- **Corrections** inherit the parent's brief. Final-review corrections take the
  brief of the latest planned task whose scope covers theirs. A reviewer's
  `brief` is discarded, since a reviewer that could attach one could hand the
  worker instructions no person read.
- Project registration snapshots the briefs, and `orion-projects refresh`
  re-takes plan and briefs before a project's first start.
- `docs/agentic/` is already runtime-protected, so no task can edit a brief.

### 4.27 What the first real run taught (2026-09-24)

Task 2 of `advance-orion-capabilities` spent all its attempts without producing
the tests its contract requires. The causes were in the loop, not only in the
model:

- **Reads that evicted themselves.** The worker asked for ten files in one
  exchange, and the reads made room by evicting the first reads of the same
  exchange. Now a single exchange reads only what fits beside the task's own
  files. The rest are skipped and named (`worker_reads_skipped`), and the task's
  own files are never evicted, by count or by token budget.
- **Replies starved by thinking.** Twice, the whole 16,000-token output budget
  went to thinking and the reply was empty; the attempt then timed out. After
  such a reply the next exchange runs with thinking off (`think: false` on that
  one generation, `worker_thinking_disabled`), then thinking resumes.
- **A reviewed repair resubmitted.** A reviewer-repaired checkpoint is recorded
  on the task so the host can submit it without another generation. It was
  cleared on an escalation resolution but not by a review verdict, so a
  "changes requested" repair was resubmitted unchanged on every later attempt.
  Any review verdict now consumes it.
- **Thin briefs.** The reviewer cannot open files. It called an implementation
  "structurally correct" that passed a `Date` where an integer was required and
  nested the policy fields the runtime needs at top level. The brief is the only
  place the reviewer learns those formats. The briefs were rewritten from
  verified research, and every outcome they state was executed against the real
  modules before shipping. `orion-projects rebrief` delivers them to a started
  run's unfinished tasks. It refuses while the run is live or if any task block
  differs, and bumps each changed contract's `rev`.

### 4.21 Resource telemetry is read-only, and unmeasurable is not unhealthy

The mission asks for RAM pressure, swap and thermal awareness over long runs.
`agentic/resources.mjs` samples `vm_stat`, `sysctl` and `pmset` — fixed argv,
no sudo, no tuning, no process killing — before and during every generation.
Sustained critical memory pressure aborts the inference in flight; starting one
under existing critical pressure is refused outright.

What it deliberately does NOT do is treat a missing measurement as an
emergency. If a sampler is slow, absent or changed by an OS update, the absence
is journalled and the run continues. This is the same distinction `checks.mjs`
draws between "your code is wrong" and "this machine cannot run the check": an
unreadable gauge is not a reason to stop developing, and a guard that fails
closed on its own telemetry would take the whole night down with it.

Note that `freeGiB` is recorded for diagnosis only. Free pages sit near zero on
a healthy macOS machine, so a threshold on it would fire constantly; `pressure`
is the signal.

**The swap rule was measured, and changed (2026-09-23).** It used to trip on
swap 2 GiB above where a generation started. On this Mac, loading qwen3.6:27b at
its 65,536-token context produced a single swap step of **1.84 GiB** — 0.16 short
of tripping — and then swap stayed flat through that generation and a second one,
while pressure sat at "warning" and never reached "critical". That step is macOS
paging idle apps out to make room, not distress, and on a busier evening the old
rule would have aborted the first generation of every run. Two changes:

- The swap rule now requires swap to be **still climbing** (up again since the
  previous sample) as well as 2 GiB above the baseline. A load step earns one
  strike at most and its plateau clears it; genuine thrashing strikes twice.
- The probe now loads the model at its **real context size** and holds it for
  five minutes. Probing at 512 tokens meant the first real generation reloaded it
  to build the 64k cache — the step above — inside the guard's window.

Outside factors worth knowing: at measurement time the machine was already
carrying ~12 GiB compressed and ~7 GiB of swap from other apps, and swap had
grown from 3.8 to 8.6 GiB over two days without a reboot. A restart before an
overnight run gives the most headroom; closing heavy apps helps too.

---

## 5. Unattended reliability, mechanism by mechanism

| Requirement | Mechanism |
|---|---|
| Crash recovery | `recoverRun`: lease proof → reconcile → discard partial work to HEAD |
| Durable persistence | atomic temp+rename+fsync of `state.json`, plus directory fsync |
| Git safety | run-scoped branch, never `-B`, never push, one commit per accepted task, **every exit code checked and the SHA verified against HEAD** |
| Atomic transitions | single `state.lock`, expected-revision checks, validation on every read |
| Watchdog | stall count, consecutive failures, repeated-blocker count — every loop branch routes through `trip()` |
| Exception containment | the loop body cannot throw out of the process: a failed iteration is journalled and counted, and the watchdog escalates rather than letting an unattended run die silently |
| Operator races | a review takes minutes; review, repair, final review and escalation re-read state and re-confirm the checkpoint before applying, so steering from the UI mid-review is not an escalation |
| Bounded retries | `maxAttempts`, `maxCorrectionDepth`, `repairsUsed`, worker turn budget, in-worker repetition detection |
| Timeouts | per task, per check, per inference call; checks run in their own process group so descendants die too |
| Pause / resume | `pauseRequested` honoured at task boundaries; the supervisor holds the lease and polls |
| Restart recovery | all state on disk; `run.json` carries branch and base; nothing is reconstructed from a chat |
| Partial work | uncommitted changes are discarded to the last accepted commit and the discard is journalled |
| Liveness | `heartbeat.json` every 10s; a stale heartbeat with a `running` status is a crashed supervisor, and the UI says so |

### The lease, specifically

The Astra handoff flagged that a retained worker lease had no owner proof and no
reconciliation API. It now records `{pid, bootId, startedAt}`. Death is proven
when the boot differs, **or** the pid is absent, **or** the pid's start time
disagrees (a reused pid). Anything else — including "cannot tell" — is treated as
alive. A lease directory with no owner record is never cleared automatically:
that is the crash-between-`mkdir`-and-write case, and clearing it would be a
guess.

---

## 6. Context management

A worker turn is assembled from four stable parts and nothing else: the system
prompt (byte-identical every turn), the contract (rendered identically every
turn), the working set (only files this task touched or asked for, capped at 8),
and the previous turn's outcome (check results, tail-biased, capped).

Deliberately absent: previous turns' reasoning, previous file contents, the run's
history, other tasks. Durable state remembers those.

`num_ctx` is set explicitly at 65536. Ollama loads these models at 32768 by
default and silently truncates the **front** of the prompt — which is exactly
where the contract and the constraints live.

Setting the window is not the same as fitting inside it, so the budget is now
**measured** (`agentic/context.mjs`). Every turn is estimated before inference
at three UTF-8 bytes per token — conservative for code, where the real figure
is nearer four — against `contextTokens` less the output allowance and a
template reserve. Over budget, the oldest working-set files are evicted (each
eviction journalled) and, if the contract alone still does not fit, the turn is
refused rather than sent. A refused turn is visible; a truncated contract is a
model working all night inside constraints it can no longer see.

---

## 7. Resource management

48 GiB unified memory. A ~27B worker is ~17 GiB resident; an ~80B reviewer is
36–48 GiB. They do not both fit.

`ModelRuntime.ensureExclusive(role)` unloads every other model (`keep_alive: 0`)
and then **verifies against `/api/ps`** rather than assuming the unload took. An
unload that silently failed is how two large models end up resident and the
machine starts swapping. `releaseAll()` runs in the supervisor's `finally`, so a
finished run does not leave 17 GiB pinned. An unreadable `/api/ps` now fails
closed: proceeding blind is how the machine ends up holding two models.

Residency is only what this process controls. What the rest of the machine is
doing is **observed** rather than assumed — see §4.21 for the sampler, what it
aborts on, and why unmeasurable telemetry is explicitly not a concern.

---

## 8. What is NOT built

Stated plainly so nobody infers otherwise:

- **No Astra transport.** By design (mission §8). Escalation pauses and alerts.
- **No automatic planning YET.** Plans are human-authored JSON, validated by
  `orion-agent plan`; nothing generates a task graph today. This is a current
  implementation limitation rather than the philosophy (mission §5, corrected
  2026-09-22): a future planner may author contracts. The invariant that does
  not move is about execution, not authorship — the worker running a task may
  not silently redefine its scope, constraints, objective or acceptance, whoever
  wrote them.
- **No push, no deploy, no install.** Ever, from this system.
- **No 80B reviewer has been benchmarked**, because none is installed.
- **No live run against real ORION code has happened.**
- **The legacy `scripts/orion-code` loop is untouched** and still disabled. This
  is a separate system; do not launch the legacy loop as a substitute.

## 2026-09-22 — Reviewer runtime recovery (Nick-authorized addition)

Nick requested automatic reviewer recovery when an issue occurs during an unattended run. The supervisor now asks the reviewer to diagnose thrown loop/review/repair errors before escalating. The reviewer can authorize retry, unload resident models and retry with a fresh session, or request human escalation. Existing task-code repair remains constrained to the task scope and configured repair budget; recovery grants no shell, policy-edit, integration, or permission authority.

Recovery claims are saved in `state.runtimeRecoveries` before inference. Defaults are two recoveries per operation phase/task and six per run, persisted across relaunches. Inference has a 120-second recovery deadline; model unloading propagates cancellation. Failed or refused diagnosis and exhausted budgets escalate and notify before exit. A successful diagnosis only authorizes another attempt: normal checks, checkpoint review and final review still decide completion.

Stop, Pause, Exterminate, held/unknown worker leases, uncertain worker outcomes, explicit BLOCKED verdicts and unresolved escalations are not auto-cleared. (Check disagreements are no longer escalated on first sight: since 2026-09-23 they return the checkpoint to the worker — §4.24.) This operates while the supervisor is alive; it cannot repair a powered-off machine, a crashed supervisor, or startup failure before loop initialization. It does not install or enable the runtime.

**Amended 2026-09-23, from the review of this module.** Three gaps, each of which turned a recoverable night into a stopped one:

- *A parked task switched recovery off.* The guard refused recovery while any escalation was open, but a task-level escalation only parks its task and the loop carries on (§4.14). One parked task plus a later Ollama hiccup therefore ended the run. The guard now holds only for an open **run-level** escalation.
- *An unreachable reviewer ended the night.* When the model server itself is what failed (restarting, refusing connections, or a recovery call past its 120 s deadline), neither model can be asked. The host now makes the one conservative decision itself: wait `HOST_RETRY_BACKOFF_MS` (30 s; `limits.runtimeRecoveryBackoffMs` overrides), then retry. It spends the same budget, so it is exactly as bounded, and it is recorded as `decidedBy: "host"`. A reviewer that *answers* with an action outside the three is still refused. That is misbehaviour, not unreachability, and the fallback does not widen what is allowed. An exterminate during the wait ends it at once.
- *A pending pause escalated.* The supervisor checked `latest.paused`, a field that does not exist, so a pause not yet at a boundary fell through to a run-level escalation. It reads `pauseRequested`.
