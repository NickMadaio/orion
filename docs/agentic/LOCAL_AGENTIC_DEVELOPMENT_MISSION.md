# Local agentic development — the canonical mission

Recorded 2026-09-21 from Nick's direct instruction, rewritten as a specification
rather than kept as a transcript. This file is the reason the system in
`scripts/lib/agentic/` exists and the standard it is held to. Implementation
details live beside the code; **intent lives here**, and a change to intent is a
decision Nick makes, not a side effect of an implementation discovery.

If an implementation discovery requires changing this document materially,
propose the change in `docs/agentic/MISSION_AMENDMENTS.md` and leave this file
alone until it is accepted. Silently rewriting the statement of intent is how a
project stops meaning anything.

**Corrected 2026-09-22 by Nick directly**, which is the one route that edits this
file in place: seven distinctions that the first draft either blurred or stated
as architecture when they were only implementation defaults. They are marked
**[2026-09-22]** where they appear. The single sentence they all serve:

> Build a long-running unattended ORION development system that maximises useful
> Astra-acceptable work per elapsed hour **while minimising how often Nick has to
> intervene.**

The second half of that sentence is not decoration. Every bound below that sends
work back into the local loop instead of out to a human is there because an
escalation is a cost, not a safety feature.

---

## 1. Why this exists

Astra (ChatGPT/Codex) is the most capable reviewer on this project and the most
scarce. Spending it on routine implementation — typos, ordinary bugs, mechanical
refactors, test scaffolding — is the binding constraint on ORION's rate of
progress. Every hour Astra spends writing a function it could have reviewed in
ninety seconds is an hour ORION does not advance.

So move the *volume* of implementation onto local models that run continuously
on Nick's Mac, and preserve Astra for the places where its intelligence has the
highest leverage: architecture, escalation, and final acceptance.

The system must do useful ORION development for **many unattended hours** while
Nick is in class, studying, out, or asleep. Not a demo loop. Something that can
be switched on the night after Astra reviews it.

### The optimisation, stated once

> Maximise **Astra-acceptable ORION development per real elapsed hour**, not
> tokens per second, not tasks attempted, not lines written.

A slower model that halves rework is a win. A fast model that produces work
Astra rejects is worse than nothing, because it costs Astra's time twice.

---

## 2. The hierarchy

```
Nick
 └── Astra          senior architect, escalation point, quality backstop (MANUAL)
      └── Claude    large implementation passes, architecture, this system
           └── local agentic runtime, unattended:

                ┌─────────────────────────────────────────────────┐
                │                                                 │
                ▼                                                 │
          ~27B worker ──▶ frequent self-check ──▶ independent      │
                          and self-correction    reviewer          │
                                                 (~80B-class)      │
                                                    │              │
                                   PASS ◀───────────┤              │
                                                    │              │
                                   PASS_WITH_TASKS ─┼──────────────┤
                                                    │   corrections│
                                                    │   return to  │
                                   BLOCKED ─────────┤   the worker │
                                                    │              │
                                          bounded reviewer repair ─┘
                                                    │
                                                    ▼
                                   still blocked: persist, pause,
                                   Discord Nick → he starts Astra
```

**[2026-09-22] Claude is the current implementation agent, not a permanent rung.**
It is building this system and doing the large passes now. Nothing in the runtime
depends on Claude existing: the roles that matter at execution time are worker,
reviewer and orchestrator, and the human-facing ones are Nick and Astra. If a
different implementation agent replaces Claude, this diagram loses a line and the
runtime does not change.

**[2026-09-22] The loop is a loop.** Work returns to the worker far more often
than it leaves for a human. Every arrow above that points back into the worker
exists to keep Nick asleep; the only arrow out is the one nothing local could
resolve.

Model classes, not model names. Current candidates: `qwen3.6:27b` as worker, an
~80B-class local model as reviewer. **Nothing in the code may hard-code these.**
Models are resolved through a role registry (`worker`, `reviewer`) backed by
configuration, and the backend interface is narrow enough that a different
runtime — llama.cpp, MLX, a paid API — is a new backend, not a rewrite.

Model selection is a question to be **measured**, not argued (§11).

---

## 3. The worker (~27B)

The workhorse. It implements code, edits files within its permitted scope, runs
the checks its task names, investigates failures, breaks work into stages,
inspects its own output, corrects its own routine mistakes, persists progress,
and continues while its task contract permits.

**[2026-09-22] The worker performs frequent self-review and self-correction, and
this is a required part of the ladder, not a courtesy.** It inspects its own
output, finds its own routine mistakes, and fixes them without another model
being involved. Most defects should die here: a correction the worker makes
itself costs seconds, the same correction found by the reviewer costs a full
review cycle, and found by Astra it costs the scarcest thing in the project.

What the worker may not do is serve as its own **independent approval gate**. It
reviews its work; it does not decide that its work passed. Those are different
acts, and only the second one is forbidden. The orchestrator holds the gate, the
reviewer is a different call with different evidence, and no amount of worker
self-assessment advances a task.

Self-review is **frequent and lightweight**, and triggered by meaningful signals
rather than an arbitrary percentage:

- a subtask boundary was reached,
- a check transitioned from failing to passing (or the reverse),
- the change touched a file the contract flags as higher risk,
- the same failure has now been seen more than once,
- the diff has grown past the contract's expected size.

"Review every 50%" is rejected: 50% of an unknown total is not a signal.

### What the worker may not do

The worker may reason about implementation detail, propose improvements, and
surface problems it believes are real. It may **not** silently change:

- the objective,
- architectural constraints,
- acceptance criteria,
- scope or non-scope.

It may *propose* a contract amendment. A proposal is a durable record that a
higher level approves or refuses. An amendment that takes effect because the
worker preferred it is the failure mode this whole design exists to prevent —
ten unattended hours are only worth having if they were spent on the right
problem.

---

## 4. The reviewer (~80B)

Local inference time is cheap relative to Astra's attention. The reviewer is
allowed to be slow if that materially improves what reaches Astra.

It reviews **batches of worker output against the explicit task contract**, not
against its own taste. "Does this feel good?" is not a review. Its verdict is
one of three machine-readable states:

| Verdict | Meaning |
|---|---|
| `PASS` | The implementation satisfies the contract. Advancement permitted. |
| `PASS_WITH_TASKS` | Fundamentally sound. Remaining corrections become explicit new tasks **returned to the local worker** for another correction/review cycle. |
| `BLOCKED` | Cannot be safely resolved inside the local loop. Escalates. |

`BLOCKED` is for: architectural ambiguity, contradictory requirements, repeated
inability to solve a problem, an operation needing approval, a question needing
human judgement, or a problem needing Astra-level reasoning.

**[2026-09-22] `PASS_WITH_TASKS` is a local outcome, not an escalation.** Its
whole purpose is to keep work inside the loop: corrections go back to the worker
and are reviewed again. This holds at the END of a run as well as within it — a
final review that wants cross-cutting corrections should generally produce tasks
for the worker rather than waking Nick.

The one thing a review may never do is grant itself reach. A correction inherits
the scope of the task it came from; a cross-cutting correction at final review
inherits the **run scope** — the union of the scopes a human already approved in
the plan. A correction that needs a file outside that union is the case that
escalates, because no human has approved anything there, and that is a judgement
about what this run is allowed to touch rather than about code.

**The orchestrator enforces the gate, not the worker.** The worker is never
handed a review function and cannot accept its own work. If the reviewer refuses
advancement, no amount of worker reasoning overrides it.

### Preventing ping-pong

Unbounded reviewer/worker correction is an infinite loop with extra steps.
There must be retry limits, correction-cycle limits, loop detection, escalation
rules, and clear terminal states. Every one of these is configurable; none may
be infinite.

### 4A. Bounded reviewer-assisted repair

The reviewer is not restricted to commentary. When the worker has made several
bounded attempts at the same problem and still cannot resolve it, the reviewer
may perform a **small, targeted implementation intervention** to unblock it:
correct a flawed abstraction causing repeated downstream failures, repair a
difficult section, fix an incorrect interface or state transition, rewrite a
narrow function the worker keeps mishandling, or establish the correct pattern
and hand the rest back.

The role is:

> **diagnose → make the minimum useful correction → validate → return control.**

This gives a local escalation ladder:

```
worker self-correction
  → reviewer review
    → bounded reviewer repair
      → worker continuation
        → human/Astra, only if still blocked
```

The orchestrator decides when repair is permitted, from explicit criteria:
the worker exceeded its correction-attempt threshold; the same failure recurs;
the reviewer identified a localised root cause; the intervention fits inside a
bounded scope; the reviewer has the context and permission it needs.

The reviewer may **not** make broad architectural changes because it disagrees
with the implementation. Architectural ambiguity, contradictory requirements,
dangerous operations, or failure that persists after repair remain `BLOCKED`.

**Every reviewer-authored code change is recorded separately in the audit
record**, so Astra can see exactly where the reviewer crossed from reviewing
into implementing. A reviewer that quietly writes the code it then approves has
destroyed the independence that made its approval worth anything.

### [2026-09-22] The repair bounds are defaults, not architectural law

What is architectural: repair is **bounded and surgical**, it is recorded
separately from review, it may not rewrite the design, and it hands control back
to the worker.

What is merely a starting number, and must be configurable rather than compiled
in: how many files one repair may touch (default 2), how many repairs a single
task may receive (default 1), how many further worker attempts a repair buys
(default 1), and how many failed attempts precede repair (default 3). These were
guesses, made to be measured and changed. A system that hard-codes them cannot
answer the question §11 exists to ask, and a number in a `const` is a number
nobody tunes at 2am when the alternative is waking someone up.

---

## 5. Task contracts

The highest-leverage piece in the system. Ten unattended hours are useful only
if the agent solved the right problem.

A task contract must be structured enough for reliable autonomous execution and
compact enough that it does not burn the context it is competing for. It
captures: identity, objective, context, scope, **explicit non-scope**, relevant
components and files, architectural constraints, dependencies, preconditions,
acceptance criteria, required checks, completion criteria, review requirements,
risk classification, and escalation conditions.

Non-scope is not decoration. "Do not also refactor X" is the sentence that
prevents a four-hour unrequested rewrite.

Bureaucracy for its own sake is a failure, not rigour. If a field is never read
by the orchestrator, never shown to a model, and never checked, it should not
exist.

**[2026-09-22] `preconditions` stays, as an optional but ENFORCEABLE field.** It
is not decoration and it is not required on every task. Where a precondition is
machine-checkable — a file exists, a dependency was accepted, a named check
passes before work starts — the orchestrator verifies it and refuses to start the
task if it does not hold. Where it is prose, it informs the worker and the
reviewer like any other context. The failure mode it prevents is the expensive
one: an agent spending an attempt discovering that the ground it was standing on
was not there.

### [2026-09-22] Who writes contracts, and who may change them

Human-authored JSON plans are **where this starts, not what it believes.** The
current runtime accepts a validated plan file and generates nothing; that is an
implementation limitation and it is expected to lift. A future planner — a
model, a higher rung, an ORION feature — may generate task contracts, and the
architecture should not assume otherwise.

The invariant that survives any planner is about the **execution** worker, not
about authorship:

> The worker executing a task may not silently redefine its approved scope,
> constraints, objective, or acceptance criteria.

It may *propose* an amendment, and a proposal is a durable record something above
it approves or refuses. Who is allowed to author a contract in the first place is
a question about the planning layer; what an executing agent may quietly change
about the contract it was handed is settled, and the answer is nothing.

---

## 6. Review contracts

Reviews are structured too. A review tells the next stage: what was examined,
which contract version it was checked against, what passed, what failed, the
evidence and test results, severity, required corrections, whether advancement
is permitted, and whether escalation is required.

Machine-readable where the orchestrator must act on it. The orchestrator must
never have to infer a decision from prose like *"everything mostly looks fine."*

---

## 7. The deterministic orchestrator

**Models provide intelligence. The runtime provides control.**

Workflow state is owned by deterministic code and persisted durably — never held
in a model's conversation, never re-derived by asking a model what stage it
thinks it is in. The runtime owns: current project, task, subtask, assigned
model, phase, contract version, review state, retry count, correction-cycle
count, last successful checkpoint, whether progression is permitted, whether
escalation is required, which model runs next, and pause/resume/failure state.

---

## 8. Astra's role, and the manual boundary

Astra is senior architect, high-level reviewer, escalation point, quality
backstop. It should not be fixing typos.

When Astra reviews, it gets **concise structured context**: the relevant task
contracts, review results, test results, focused diffs, and the unresolved
architectural questions. Never a request to reread huge historical chats.

A tiny, obvious, high-confidence problem Astra may fix directly. Anything larger
becomes new work for the local system.

### Astra escalation is MANUAL. This is not negotiable yet.

There is no automatic paid Astra API escalation. When the local system needs
Astra it must:

1. **PAUSE.**
2. **Persist state** so nothing is lost.
3. **Alert Nick** (§9).

Nick then opens ChatGPT/Codex remotely and starts Astra by hand.

---

## 9. Discord escalation

ORION notifies Nick over Discord whenever human or Astra intervention is
genuinely required. The message must be understandable **from a phone**, with no
access to the machine: project and task, current phase, why execution stopped,
the reviewer's decision, what the local system already tried, relevant
tests/errors, the current checkpoint or commit, what it needs from Nick, and
whether an Astra review is specifically recommended.

> A system that blocks at 01:00 and waits silently until it is discovered at
> 09:00 has defeated a major purpose of this architecture.

The converse is equally binding: **do not alert for anything the local system
can handle itself.** An escalation channel that cries wolf is an escalation
channel that gets muted, and a muted channel is the 01:00 failure again.

---

## 10. Unattended reliability is a first-class requirement

Not a later hardening pass. The following are requirements, not aspirations:

- **Crash recovery.** A failure of the orchestrator, the inference runtime, a
  tool process, or the machine must not cost hours of state.
- **Durable workflow persistence.** Enough structured state to restart from the
  last safe checkpoint.
- **Git safety.** Branches, commits and checkpoints so autonomous changes stay
  reversible. No ten-hour mystery diff.
- **Atomic state transitions.** Nothing is "complete" before the code, state and
  tests have actually reached a consistent state.
- **Watchdog.** Detect repeated identical failures, repetitive tool calls,
  infinite review cycles, absence of meaningful progress, hung processes, model
  loops, runaway execution.
- **Bounded retries.** Never infinite.
- **Timeouts** on every external process and tool call.
- **Pause / resume.** Nick can interrupt deliberately and continue safely.
- **[2026-09-22] Stop and exterminate, from anywhere.** Three distinct halts —
  hold (`pause`), end somewhere safe and resumable (`stop`), and abandon the
  generation in flight (`exterminate`) — reachable from the ORION panel, the
  operator CLI and Discord, because the moment Nick wants a run to stop is
  usually a moment he is not at the machine.
- **[2026-09-22] A stuck worker is detected and handed upward.** A worker that
  stays busy without writing anything new or fixing a check is stuck, whatever
  it reports. Nick is told once, and the reviewer is brought in to break it out
  rather than the worker spending its remaining attempts on the same wall.
- **[2026-09-23] Something always handles it.** Nick's words: *"a time out or
  being stuck should be handled by the reviewer model, and if the reviewer gets
  stuck then the worker model handles it. or just something has to."* A timeout
  goes to the reviewer exactly as being stuck does. A reviewer that cannot review
  hands the checkpoint back to the worker to resubmit smaller. A reviewer repair
  that fails still gives the worker its turn. The one thing that never happens is
  the worker approving its own work — that line from §3 does not move — so the
  ladder always ends in either a reviewed checkpoint or Nick, never in a silent
  stall and never in an open gate.
- **[2026-09-23] Nick can always stop it.** *"At the end of the day I need to be
  able to stop the model."* Pause, stop cleanly, or kill it outright, from the
  panel, the CLI or Discord, without looking anything up first, and even when
  the process has stopped responding. After any of them the run must be
  restartable. Being able to START from the panel ("Enable & start") is
  acceptable on that condition: stopping must be at least as easy as starting.
- **[2026-09-23] The Mac stays awake for the run.** Activating a project keeps
  the machine from sleeping for as long as the run lasts, with the options
  configurable when the project is started (keep the display on, periodically
  declare activity). What cannot be done without admin rights — keeping it awake
  with the lid shut — is reported plainly at launch rather than silently assumed.
- **Restart recovery.** A reboot must not require reconstructing state from chat
  logs.
- **Partial-work handling.** Interruption halfway through a mutation must be
  recognisable and recoverable.

---

## 11. Model runtime and resources

Target: a **48 GB Apple Silicon MacBook Pro**. This is a hard constraint, not a
guideline. A ~27B worker and an ~80B reviewer cannot both be resident.

Design around it: explicit load/unload, only the required model resident, RAM
pressure and swap awareness, deliberate context sizes, clean reviewer handoffs,
thermal and resource behaviour over long runs, recovery when inference fails,
and prevention of concurrent processes exhausting memory between them.

---

## 12. Benchmarking

Build so model selection can be **measured on real ORION development tasks**:
completion rate, test pass rate, review acceptance rate, correction cycles,
review failures, architectural violations, Astra rewrite rate, time to final
accepted implementation, throughput of accepted tasks, resource usage.

The question being answered is always §1's: which configuration produces the
most Astra-acceptable ORION development per real elapsed hour?

---

## 13. Context and token management

An architectural concern, for every model in the stack — Claude, Astra, the
worker, the reviewer, and any future API model.

No endless agent conversation containing the whole history of ORION. Prefer
persistent structured state, task and review manifests, decision records,
targeted retrieval, relevant-file loading, diff-based context, periodic
compaction, concise summaries, and stable reusable prompt components.

> **The project remembers through durable project state, not through one model's
> chat context.**

This is also the economics if paid APIs ever enter the loop.

---

## 14. Logging and observability

We need to know what an autonomous system did while nobody was watching: tasks
and subtasks, state transitions, models used, important decisions, tools and
actions, commits and code changes, test executions, review decisions,
corrections, retry counts, failures, escalations, and timing.

Structured summaries over indiscriminate dumps of private reasoning traces.

---

## 15. ORION UI

The workflow surfaces in ORION's project UI: project name, current task and
subtask, current agent/model, execution stage, a small activity view, progress
for the current task, separate overall-project progress, review status, last
checkpoint, running/paused/blocked, escalation status, and the ability to steer
or intervene.

Circular/gradient progress indicators in the spirit of ORION's timer UI.

**Progress comes from real task/workflow structure — never from a model
asserting "72% complete."** UI work must not derail the runtime; sequencing it
later is fine, but the backend must expose the state the UI will need.

### [2026-09-22] Show the loop as a loop

This is an agentic **loop**, and the panel should look like one: a cycle —
implement → self-check → review → (repair) → back round — with the agent's
current position on it lit, and the stages it has already been through this task
marked. Nick asked for this directly.

It earns its place for a reason beyond looking good. The failure this whole
system is built against is *something stopped and nobody was told*, and the
symptom of that is a panel that looks identical whether the loop is turning or
dead. A stage marker that moves is assurance the loop is alive; a stage marker
that has not moved in forty minutes, next to a heartbeat, is the fastest way to
see that it is not. The position must come from durable state — the task's stage
and the run's own records — never from a model narrating where it thinks it is.

---

## 16. Permissions and operational protection

This system changes a real project unattended. It needs enough capability to be
useful and must not be able to destroy unrelated data.

In scope for deliberate design: shell permissions, filesystem scope, allowed
directories, dangerous and destructive commands, git operations, network,
secrets, credentials, database access, production versus development resources,
and which actions require approval.

**Work inside ORION's existing permission and security architecture.** A
parallel security system that contradicts the real one is worse than none,
because it creates two beliefs about what is allowed.

---

## 17. Definition of done

An agent does not mark a task complete because it produced code. Completion
requires all of:

- the implementation exists,
- the relevant tests and checks pass,
- acceptance criteria are satisfied,
- required review gates passed,
- blocking issues are resolved,
- state is persisted,
- the repository is left resumable.

---

## 18. Engineering judgement

This document states intent, not every low-level decision. Where a proposed
mechanism has a materially better implementation, use the better one — preserve
the goal, improve the mechanism, and **document the deviation** so Astra can
review it. Do not follow a bad technical detail because it was casually
proposed.

Recorded deviations live in `docs/agentic/ARCHITECTURE.md` under "Deviations
from the mission".

## 2026-09-22 — Reviewer runtime recovery (Nick-authorized addition)

Nick requested automatic reviewer recovery when an issue occurs during an unattended run. The supervisor now asks the reviewer to diagnose thrown loop/review/repair errors before escalating. The reviewer can authorize retry, unload resident models and retry with a fresh session, or request human escalation. Existing task-code repair remains constrained to the task scope and configured repair budget; recovery grants no shell, policy-edit, integration, or permission authority.

Recovery claims are saved in `state.runtimeRecoveries` before inference. Defaults are two recoveries per operation phase/task and six per run, persisted across relaunches. Inference has a 120-second recovery deadline; model unloading propagates cancellation. Failed or refused diagnosis and exhausted budgets escalate and notify before exit. A successful diagnosis only authorizes another attempt: normal checks, checkpoint review and final review still decide completion.

Stop, Pause, Exterminate, held/unknown worker leases, uncertain worker outcomes, explicit BLOCKED verdicts, check disagreements and unresolved escalations are not auto-cleared. This operates while the supervisor is alive; it cannot repair a powered-off machine, a crashed supervisor, unavailable reviewer, or startup failure before loop initialization. It does not install or enable the runtime.
