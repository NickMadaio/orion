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
scripts/lib/orion-project-agent.mjs    THE DURABLE CONTROLLER — owns all workflow state (schema v2)
scripts/lib/agentic/
  contract.mjs      task + review contract schema. The one definition of "a task".
  boundary.mjs      the write gate: structure → containment → scope → deny-lists
  checks.mjs        the fixed-argv check registry. The only commands that run.
  workspace.mjs     git worktree, scoped writes, verified checkpoints, diffs
  lease.mjs         exclusive leases with PROOF of who holds them
  journal.mjs       append-only audit, two streams
  models.mjs        role registry, Ollama backend, exclusive residency
  prompts.mjs       prompt assembly and reply parsing
  prompts/*.md      THE AGENT OPERATING SYSTEM (worker, reviewer, repair)
  worker.mjs        the ~27B agentic loop for one task
  reviewer.mjs      review, bounded repair, final review
  escalation.mjs    Discord alerting, rate limiting, brief writing
  brief.mjs         the phone message and the Astra brief
  supervisor.mjs    the deterministic loop, watchdog, recovery
  bench.mjs         model benchmarking in a disposable repository
native/Orion/Sources/Orion/ProjectAgentStatus.swift   the UI's read model (v2) + heartbeat
native/Orion/Sources/Orion/ProjectTab.swift           the panel
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
    │                     BLOCKED         → escalate
    │                     unparseable     → escalate (never a silent accept)
    ├─ blocked & attempts ≥ repairAfterAttempts → BOUNDED REVIEWER REPAIR
    │                     repaired + checks pass → grant ONE more worker attempt
    │                     otherwise             → escalate
    ├─ all accepted, no final review → FINAL REVIEW
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
better implementation. **These are the things for Astra to argue with.**

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

### 4.4 Reviewer repair grants ONE attempt, not a fresh budget

`grantRepairRetry` sets `attempts = maxAttempts - 1`. Resetting to zero would let
a single task consume attempt budget indefinitely, one repair at a time — the
ping-pong the bounds exist to prevent. `repairsUsed` caps repairs per task at 1.

### 4.5 Corrections inherit scope and may only narrow it

A `PASS_WITH_TASKS` correction cannot request files the parent task was not
approved to touch. Otherwise a review could grant the worker reach no human
approved. A correction that genuinely needs wider scope is a `BLOCKED`.

### 4.6 Corrections are scheduled BEFORE new planned work

Found by a test. A review found something wrong with work that was just accepted;
letting new planned work start on top of it means the next task builds on the
thing being corrected, and the correction has to be applied twice.

### 4.7 Final-review `PASS_WITH_TASKS` escalates instead of creating tasks

A cross-cutting correction has no parent task to inherit scope from, and
inventing one would be the reviewer granting itself reach. So the corrections are
listed in the escalation and a human turns them into contracts.

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

### 4.11 Enablement is a file outside the repository

`~/.openclaw/orion-controlled/agentic-config.json` must say `"enabled": true`.
Task scopes are repository-relative, so that file is outside every possible
scope by construction: the agent cannot turn itself on. Same spirit as
`GOVERNED_SELF_DEVELOPMENT_ENABLED`, which remains `false` and governs the
separate legacy loop.

---

## 5. Unattended reliability, mechanism by mechanism

| Requirement | Mechanism |
|---|---|
| Crash recovery | `recoverRun`: lease proof → reconcile → discard partial work to HEAD |
| Durable persistence | atomic temp+rename+fsync of `state.json`, plus directory fsync |
| Git safety | run-scoped branch, never `-B`, never push, one commit per accepted task, **every exit code checked and the SHA verified against HEAD** |
| Atomic transitions | single `state.lock`, expected-revision checks, validation on every read |
| Watchdog | stall count, consecutive failures, repeated-blocker count — every loop branch routes through `trip()` |
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

---

## 7. Resource management

48 GiB unified memory. A ~27B worker is ~17 GiB resident; an ~80B reviewer is
36–48 GiB. They do not both fit.

`ModelRuntime.ensureExclusive(role)` unloads every other model (`keep_alive: 0`)
and then **verifies against `/api/ps`** rather than assuming the unload took. An
unload that silently failed is how two large models end up resident and the
machine starts swapping. `releaseAll()` runs in the supervisor's `finally`, so a
finished run does not leave 17 GiB pinned.

---

## 8. What is NOT built

Stated plainly so nobody infers otherwise:

- **No Astra transport.** By design (mission §8). Escalation pauses and alerts.
- **No automatic planning.** Plans are human-authored JSON, validated by
  `orion-agent plan`. Nothing generates a task graph.
- **No push, no deploy, no install.** Ever, from this system.
- **No 80B reviewer has been benchmarked**, because none is installed.
- **No live run against real ORION code has happened.**
- **The legacy `scripts/orion-code` loop is untouched** and still disabled. This
  is a separate system; do not launch the legacy loop as a substitute.
