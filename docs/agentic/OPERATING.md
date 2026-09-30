# Running the local agentic loop — the operator's manual

**ROUGH DRAFT, 2026-09-22.** Written before the system has ever run against real
ORION code, which means every procedure below is derived from the code rather
than from experience. Expect the first real night to correct it.

The other three documents answer different questions, and none of them answer
this one:

| Document | Question |
|---|---|
| `LOCAL_AGENTIC_DEVELOPMENT_MISSION.md` | **why** this exists, and what it is held to |
| `ARCHITECTURE.md` | **how** it works, and where it deviates |
| `docs/handoffs/CLAUDE_TO_ASTRA_…` | what was built, and what Astra should argue with |
| **this file** | **how Nick runs it** |

---

## Command reference — every command, for when you forget

Runs are per project, so every command carries `--project <id>`. Leave it out
and the command looks for the original single run instead and answers *"No
project-agent run exists."* `scripts/orion-projects list` shows each project's
id. Or skip the lookup entirely:

```bash
scripts/orion-agent --project <id> commands
```

prints this whole list for that one project, with its id already filled in and
a line on what each command does. It works before the project has ever been
launched, and it changes nothing. Type everything from the ORION folder
(`cd ~/Desktop/ORION`) — the commands start with `scripts/`.

**See what it is doing**

| Command | What it does, and when to use it |
|---|---|
| `scripts/orion-agent --project <id> status` | Where the run is: status, the task in hand, open escalations with their ids, and the heartbeat. `"live": false` while the status says running means the supervisor crashed. Also shows the `revision` number that steer and resolve need. |
| `scripts/orion-agent --project <id> brief` | Writes a fresh Astra review brief for the run and prints where it saved it. Use it when an alert says **ASTRA REVIEW NEEDED**. |
| `scripts/orion-agent --project <id> commands` | Prints this list for that project. |

**Start or continue**

| Command | What it does, and when to use it |
|---|---|
| `scripts/orion-projects launch <id> --until-stopped` | Starts or continues the project until you stop it. Use `--until 2026-09-24T08:00:00+01:00` instead for an exact wall-clock stop. It runs in the background, so closing the terminal or app does not stop it. Same as **Start / Continue** in Projects. Add `--enable` only when execution is disabled. Keep-awake options are `--keep-display-on`, `--nudge-minutes 5`, and `--no-keep-awake`. ORION cannot prevent lid sleep; preflight warns about it. |
| `scripts/orion-projects rebrief <id>` | After a project has started: replaces the briefs of tasks not yet done with the current ones beside the plan, without a new run. Accepted work keeps the brief it was reviewed against. Refuses while the run is live, or if any task block in the plan changed. |
| `scripts/orion-projects refresh <id>` | Re-copies a saved project's plan and its briefs from where they were imported, after you have edited them. Only before the project's first start; after that its tasks live in the run. |
| `scripts/orion-projects preflight` | Checks, changing nothing, whether this Mac will stay up for a run: power, lid and sleep settings. Run it before leaving one overnight. |

**Stop it** — no revision needed: a halt must never fail because the run moved on.

| Command | What it does, and when to use it |
|---|---|
| `scripts/orion-project-agent --project <id> pause` | Holds at the next task boundary and keeps its place. Use it when you want it to wait, not end. |
| `scripts/orion-project-agent --project <id> stop` | **The normal way to stop.** The step in flight finishes, the run ends at the next safe boundary, and it stays fully resumable. |
| `scripts/orion-project-agent --project <id> exterminate` | Abandons the model call in flight right now. Use it only when stop is too slow. Accepted work is never lost; the half-done step is thrown away when the run next starts. |
| `scripts/orion-project-agent --project <id> resume` | Clears a pause, stop or exterminate. It does not restart a run whose process has already exited — use `launch` above for that (which also clears them for you). |

**Steer and decide** — `N` is the `revision` from `status`, taken just before.
If the command says the revision changed, check `status` again.

| Command | What it does, and when to use it |
|---|---|
| `scripts/orion-project-agent --project <id> steer --revision N --text "..."` | Gives the agent an instruction in plain words. Applied at the next task boundary, never mid-task. |
| `scripts/orion-project-agent --project <id> resolve --revision N --id ESCALATION_ID --note "..."` | Answers an escalation. `ESCALATION_ID` is in `status` and in the Discord alert. The note is *why it is now safe to continue* and is kept as the audit record. A parked task gets one more attempt, not a fresh budget. |

**From Discord** — a DM to Orion. Discord can never *start* a run.

| Message | What it does |
|---|---|
| `agent status <id>` | A short progress summary, and whether a supervisor is actually alive. |
| `agent pause <id>` | The same as pause above. |
| `agent stop <id>` | The same as stop above. |
| `agent exterminate <id>` | The same as exterminate above. Two words on purpose: a bare "stop" is only conversation. |
| `agent resume <id>` | The same as resume above. It has to come from you, not from Orion. |

> **Which run Discord acts on.** With the project id, that project. Without it,
> the project running now, or the only one with a run; if several could be
> meant, Orion lists them and changes nothing. Discord runs an *installed copy*
> of `scripts/orion-remote`, so a change to it reaches the phone only after
> `scripts/orion-remote-install` is re-run at the Mac. If Discord rejects these,
> or says no run exists while one is running, that copy is out of date.
> (`orion-agent commands` prints the same rule from `DISCORD_REACH` in
> `scripts/lib/agentic/brief.mjs`; change both if the targeting rule changes.)

**The original single run** (created with `scripts/orion-agent init`, not a saved
project) uses the same commands without `--project`, and starts with
`scripts/orion-agent run --until-stopped`. `scripts/orion-agent commands` prints that
version of the list.

---

## Markdown work backlog — 23 September 2026

The phased product work queue is `docs/agentic/plans/advance-orion-capabilities.md`.
It continues the unfinished product work from **Advance Orion capabilities**;
it is distinct from these operating instructions. `orion-agent plan` and `init`
now accept `.md` files containing one `orion-plan` metadata block and explicit
`orion-task` contract blocks. Other roadmap prose is not queued. Each contract
supplies scope, acceptance, checks and dependencies; initialization snapshots the
queue, so editing the Markdown does not hot-reload an active run. JSON remains
supported. The initial queue is five source-only Phase 57 tasks; live scheduler
activation and later capability work await subsequent bounded batches/review.

## 0. The one thing to know first

It is **off**, and it cannot turn itself on.

```
~/.openclaw/orion-controlled/agentic-config.json     {"enabled": true}
```

That file lives outside the repository. Task scopes are repository-relative, so
no task can ever name it. Nothing else — not the panel, not Discord, not a
model — can create it. Turning this system on is a thing you do at the keyboard,
on purpose, once.

Everything below assumes you have read §1 before doing that.

---

## 1. Before the first real run

A checklist, in order. Do not skip to §4 on the first night.

**1. Check the machine.**

```bash
scripts/orion-agent doctor
```

Exits non-zero if the compiled self-change policy is missing or a configured
model is absent or unusable. Read `resources` in its output too: if the machine
is already under memory pressure, a run started now will be fighting for RAM.
It checks the machine, so it needs no project; add `--project <id>` and it also
reports that project's heartbeat and leases.

**2. Rebuild and deploy the plugin.** The five deny-list surfaces protecting the
agent's own runtime live in `plugin/orion-control/src/self-development-authority.ts`
and are not in force until the installed build has them. The runtime carries its
own copy of the same list meanwhile, so this is belt-and-braces rather than a
blocker — but do it before you trust the belt.

**3. Run the smoke plan.** It only touches `tests/workspace/agentic-smoke/`, and
it exercises every part of the path that can fail on a specific Mac: model load
and eviction, the worktree, the boundary, the checks, the commit, the review
gate, the final review.

```bash
scripts/orion-agent plan docs/agentic/plans/smoke-run.json               # validates; changes nothing
scripts/orion-projects add docs/agentic/plans/smoke-run.json "Smoke run"  # prints the new project's id
scripts/orion-projects launch <id> --until-stopped                       # add --enable if it says disabled
scripts/orion-agent --project <id> status
```

**4. Watch one full run before leaving it overnight.** This is the step people
skip. The point of the first run is not the code it produces; it is you learning
what the panel looks like when things are normal, so that abnormal is visible.

---

## 2. Writing a plan

**Start from `docs/agentic/PLAN_STANDARD.md`.** It is the baseline every new
plan meets: what reaches the model and what never does, the graph shape (branches,
one owner per file, a check of the task's own), what each contract and brief must
say, and a template. `plan` and `orion-projects add` print a `lint` section that
checks the mechanical parts of it.

A plan is human-authored JSON: a project name, options, and a list of task
contracts. `scripts/orion-agent plan <file>` validates it and changes nothing —
run it as often as you like.

The fields that carry weight:

**`scope` — this is the write gate, not advice.** A task can only change files
listed here. Two forms only: an exact path (`scripts/lib/thing.mjs`) or a
directory prefix (`scripts/lib/agentic/`). No globs. If the worker decides a
neighbouring file would be easier to fix, the boundary refuses it before any
bytes are written. **Getting this wrong is the main way a plan wastes a night:**
too narrow and the task cannot be done, too wide and you have approved more than
you meant to.

**`nonScope` — the sentence that prevents the four-hour rewrite.** "Do not also
refactor X." It is prose, it reaches both models, and it is what the reviewer
checks against.

**`acceptance` — what PASS means.** The reviewer judges against these, literally.
Vague criteria produce vague reviews.

**`checks` — names from a fixed registry**, never commands:

```
node-syntax · agentic-tests · project-agent-tests · automation-tests
plugin-typecheck · plugin-security · plugin-tests · secret-scan · no-orphan-exports
```

Adding one is a reviewed human edit to `scripts/lib/agentic/checks.mjs`. A plan
naming an unregistered check is refused by `plan`.

> ⚠ `no-orphan-exports` asks whether a new export is actually *reached*. A task
> that creates a module whose only caller does not exist yet will fail it,
> correctly. Either give the task the caller too, or do not name this check.
> This is the trap the smoke plan's first task is shaped to avoid.

**`preconditions` — optional, and enforced where it can be.** `exists: path` and
`absent: path` are verified against the worktree *before* the worker's first
turn; an unmet one blocks the task immediately with the reason named, rather
than being discovered on the third attempt. Anything else is prose.

**`dependencies`** order the graph. **`weight`** drives honest progress: a task
worth 5 moves the plan ring five times as far as a task worth 1.

**Briefs: the reference that travels with each task.** Only the task blocks
reach the models, and a task's `context` is capped at 2,000 characters. A worker
alone for hours needs more than that: the exact functions it will call, the
record formats it has to match, the traps, and what the reviewer will check.
Put that in a folder beside the plan, named after it:

```
docs/agentic/plans/my-plan.md
docs/agentic/plans/my-plan.briefs/common.md          every task gets this
docs/agentic/plans/my-plan.briefs/<task-id>.md       that task only
```

Each task's contract then carries `common.md` followed by its own brief. The
brief is rendered after the contract for the worker, the reviewer and the repair
role alike, headed so that the contract visibly governs. The plan file itself is
never touched, so the approved plan stays exactly as it was approved.

- **Limits:** at most 18,000 characters per task, common and own together. That
  is about 6,000 tokens, an eighth of the worker's input budget. The rest of the
  budget is the room for real files.
- **Strict loading:** a file that names no task, a stray non-`.md` file, an empty
  brief, an oversize brief, or a task that also has an inline `brief` all make
  `plan` refuse, by name. `plan` reports how many characters each task carries
  and which tasks have no brief of their own.
- **Improving briefs on a running project:** stop it, edit the briefs, then run `scripts/orion-projects rebrief <id>`. Each changed task's contract revision goes up, and the journal records `briefs_refreshed`.
- **Snapshots:** `orion-projects add` snapshots the briefs with the plan.
  `scripts/orion-projects refresh <id>` re-takes both from the source, but only
  while the project has never been started. After that, the tasks, briefs
  included, live in the run's state.
- **Integrity:** a brief is part of the contract's digest, so a review cannot be
  claimed for a brief that was edited afterwards. Correction tasks inherit their
  parent's brief. A reviewer cannot write one.
- **Why the files live beside the plan and are loaded by the host:** the
  worker's worktree is built from the last commit, so an uncommitted brief left
  for the worker to READ would not be there.

---

## 3. Starting a run

In the installed app, open **Projects**, select a saved project, choose a time
budget, and press **Start project** or **Continue project**. When execution is
disabled, the explicit button is **Enable & start**. Importing or selecting a
project does not start it. The + button imports a Markdown or JSON plan snapshot.

The saved-project CLI equivalent is:

```bash
scripts/orion-projects add docs/agentic/plans/advance-orion-capabilities.md "Advance ORION capabilities"
scripts/orion-projects list
scripts/orion-projects launch <id> --until-stopped --enable
scripts/orion-agent --project <id> status
```

Omit `--enable` when execution is already enabled. Each project owns its plan,
state, journal, worktree, and log under
`~/.openclaw/orion-controlled/project-agent/projects/<id>/`. Only one project
may run at a time. Continue reconciles a provably dead interrupted worker before
clearing a stop; uncertain outcomes remain blocked. Closing the app does not stop
a detached run. Editing the plan does not hot-reload an initialized run.

The original single-project terminal route remains available. It is the one
route that takes no `--project`:

```bash
scripts/orion-agent init <plan.json>     # creates the run + a fresh worktree/branch
scripts/orion-agent run --until-stopped  # supervises until done, blocked, or stopped
```

`init` creates a run-scoped branch (`orion-agent/<runid>`) in its own worktree:
`projects/<id>/worktree` for a project (the first `launch` runs `init` for you),
`project-agent/worktree` for the original single run. It refuses to reuse an
existing branch or adopt a worktree that belongs to something else.

`run` refuses to start if:

- the enablement file is missing or not `true`,
- a worker lease is held by a process that is still alive,
- a stop request from a previous session is still standing (it prints
  `scripts/orion-project-agent --project <id> resume` to clear it; `launch`
  clears it for you),
- a configured model is missing or unusable.

**It never pushes, deploys, or installs.** Work lands as one commit per accepted
task on that branch, with the task id in the subject. Ten hours of autonomous
change stays reversible.

### Keeping the Mac up for the night

A run holds its own sleep assertion. `launch` starts `caffeinate -i -s -w <pid>`,
bound to the run's own process, so it lets go the moment the run ends, however
it ends. The Projects view shows the options before you start:

| Option | Flag | What it does |
|---|---|---|
| Keep this Mac awake while it runs (on) | `--no-keep-awake` turns it off | stops idle sleep; this Mac idle-sleeps after 1 minute otherwise |
| Keep the display on (off) | `--keep-display-on` | also stops the screen sleeping |
| Nudge activity every N min (off) | `--nudge-minutes N` | tells macOS someone is there, like Vorssaint moving the mouse. It also wakes the display each time |

Each launch uses exactly the options it is given. The app always sends all of
them, and there is no "keep what I chose last time" for a flag you leave out.

**What it cannot do is stop the lid.** Lid-close sleep needs clamshell mode (power
plus an external display), Vorssaint's lid option, or `sudo pmset -a
disablesleep 1`, run by you and undone with `0` afterwards. ORION never changes
that setting. `scripts/orion-projects preflight` reads what macOS says
closing the lid would do and warns before a start. The warning never blocks a
start. After starting, `projects/<id>/launch.json` records what was actually put
in place (`keepAwake`), what the preflight saw (`preflight`) and any `warnings`,
and `run.log` has the same lines.

---

## 4. Watching it

**The ORION Projects tab** contains a searchable saved-project list and the
selected project's **Plan**, **Activity**, and **Reviews**. Plan shows the
Markdown document and expandable task contracts; **Open Markdown** opens its saved
copy. Activity shows task progress, trace, events, and steering. Reviews shows
review notes and escalation resolution. The header reports the live heartbeat;
a stored running status alone is not proof that a supervisor is alive.

From a terminal:

```bash
scripts/orion-agent --project <id> status          # durable state + heartbeat + leases + journal integrity
scripts/orion-project-agent --project <id> status  # the same state, for the UI's control path
```

The `heartbeat` block is the one to trust. `live: false` with `status: running`
means a crashed supervisor, not a busy one.

---

## 5. Controlling it

Three ways to halt, and they are **not** the same thing:

| | what it does | the generation in flight |
|---|---|---|
| **pause** | holds here, keeps the lease, continues when resumed | allowed to finish |
| **stop** | ends the run at the next safe boundary, fully resumable | allowed to finish |
| **exterminate** | abandons the model call immediately | aborted |

Reach for **stop**. Exterminate exists because "wait nine minutes for a 27B to
finish thinking" is not always an acceptable answer — it is abrupt but not
destructive: the tree returns to the last accepted commit, the run reconciles on
next start, and nothing that was accepted is ever lost.

**From the panel:** Pause / Resume / Stop / Exterminate. Exterminate asks for
confirmation. Steering and escalation-resolution have their own boxes.

**From a terminal.** The halts carry no revision: stopping must never fail
because the run moved between your `status` and your command. `steer` and
`resolve` do carry `--revision N` from `status`, so an instruction or a decision
made on a stale snapshot cannot land on a run that has moved:

```bash
scripts/orion-project-agent --project <id> pause
scripts/orion-project-agent --project <id> resume                    # also clears a stop or exterminate
scripts/orion-project-agent --project <id> stop
scripts/orion-project-agent --project <id> exterminate
scripts/orion-project-agent --project <id> steer   --revision N --text "..."
scripts/orion-project-agent --project <id> resolve --revision N --id ESCALATION_ID --note "..."
```

Omitting `--project` targets the original single run. Discord works out which
run you mean as described in the command reference at the top.

**From Discord**, one verb with a closed vocabulary, optionally followed by a
project id:

```
agent status | agent pause | agent resume | agent stop | agent exterminate   [<id>]
```

Two deliberate tokens for the destructive one — a bare "stop" is conversation and
cannot touch the agent. Nothing over Discord can *start* a run.

**Steering** is applied at the next task boundary, never mid-task. An instruction
that arrives after the last task has been handed out will refuse to be silently
lost: the run escalates rather than dropping it.

---

## 6. What arrives on your phone, and what to do

Two tiers, deliberately different. Learning to tell them apart at 3am is the
whole point.

**Informational — no action needed.** One line, its own 30-minute rate limit, no
brief. It never asks for anything.

- *the worker is stuck on X* — it kept working without writing anything new or
  fixing a check. The reviewer is being brought in to break it out. You will hear
  again only if that fails.
- *the reviewer stepped in on X* — the worker was stuck, so the review model made
  a bounded repair. Recorded separately from reviews, because a reviewer that
  writes the code it approves has spent the independence that made its approval
  worth anything.

**Escalation — the run wants you.** First line says whether Astra is
specifically recommended. It carries the task, the stage, why it stopped, what
was already tried, the failing checks, the last checkpoint, and the exact
`resolve` command with the project and the escalation id already filled in.
The revision is left as `N` on purpose: the run bumps it the moment the alert is
delivered, so any number in the message would already be stale. The message
names the `status` command that shows the live one, and the `commands` line that
prints everything else.

What to do:

1. Read the message. If it says *ASTRA REVIEW NEEDED*, open ChatGPT/Codex
   yourself and point Astra at the brief in the run directory
   (`scripts/orion-agent --project <id> brief` writes a fresh one). **Nothing
   here calls Astra.**
2. If it is a judgement you can make, make it, then resolve the escalation with
   a note saying *why it is now safe to continue*. The note is not ceremony; it
   is the audit record for a decision a model was not allowed to make.
3. Resolving a task-level escalation returns that task to the queue with one
   further attempt — not a fresh budget.

A task-level escalation **parks one task and the night continues** on everything
else. Only a run-level escalation, or having nothing claimable left, stops the
run. The panel says which.

---

## 7. When something has gone wrong

| Symptom | What it means | What to do |
|---|---|---|
| `status: running`, heartbeat stale | the supervisor died | continue it: `scripts/orion-projects launch <id> --until-stopped`; recovery reclaims the dead lease and discards any half-written mutation |
| refuses to start: *lease held and owner appears alive* | another writer may still be running | find and stop that process; never delete the lock to make this go away |
| refuses to start: *stop request still standing* | a `stop`/`exterminate` from last session | `scripts/orion-project-agent --project <id> resume`, or just `launch` again, which clears it |
| *state lock held longer than 2000ms* | two writers contending, or debris from a crash | retry; a lock older than a minute is reclaimed automatically |
| a task blocked with `worker_outcome_unknown` | the worker was stopped mid-flight and did not settle within a minute, so nobody can say what it wrote | the run reconciles on next start once the process is provably gone; the attempt is spent deliberately |
| `runtime_recovery_reviewer_unreachable` in the journal | the model server stopped answering, so the host waited 30s and retried (at most 2 per phase, 6 per run) | nothing, if the run carried on; if Ollama stays down, the budget runs out and you get a run-level alert |
| the run escalated `contradiction` | the worker reported checks passing and an independent re-run disagrees | take it seriously: either a flaky check or a worker reporting a result it did not get |
| nothing happened all night, no alert | check `doctor` first — usually a model that is installed but not usable as configured | |

The journal is the record: `~/.openclaw/orion-controlled/project-agent/projects/<id>/journal.jsonl`
(`project-agent/journal.jsonl` for the original single run), append-only, two
streams, with gap detection. `status` reports its integrity.
The 200-event display buffer in state is *not* the audit trail.

---

## 8. Tuning

Everything below lives in `agentic-config.json` under `limits`. The shape of the
ladder is architecture; these numbers are starting guesses meant to be measured
(mission §4A, §11).

| Limit | Default | Bounds |
|---|---|---|
| `maxAttempts` | 3 | worker attempts per task |
| `stuckAfterTurns` | 4 | fruitless turns before the worker is declared stuck |
| `repairAfterAttempts` | 3 | failed attempts before reviewer repair is permitted |
| `repairMaxFiles` | 2 | files one repair may write; more is a design change, which escalates |
| `repairsPerTask` | 1 | repairs a single task may receive |
| `repairRetryAttempts` | 1 | further worker attempts a successful repair buys |
| `maxCorrectionDepth` | 2 | how far corrections may cascade |
| `taskTimeoutMs` | 3600000 | one hour per task |
| `iterationStallLimit` | 3 | supervisor iterations with no state change before the watchdog trips |
| `maxConsecutiveFailures` | 3 | consecutive loop failures before it stops and tells you |
| `runtimeRecoveriesPerPhase` / `PerRun` | 2 / 6 | bounded self-recovery from *runtime* failures (see below) |

Models are configured from the terminal. They are a machine-wide setting, shared
by every project, so this command takes no `--project`:

```bash
scripts/orion-project-agent set-model worker qwen3.6:27b
```

`enabled` can be set by the explicit **Enable & start** action in Projects
or by `scripts/orion-projects launch <id> --until-stopped --enable`. Merely opening the
app, importing a plan, or selecting a project never changes enablement.

> **Unreviewed, flagged 2026-09-22:** `runtimeRecoveries*` bound a path where the
> reviewer model is asked to choose between `retry`, `reload_models` and
> `escalate` after a *runtime* failure (not a code failure). It is tightly
> bounded — fixed action vocabulary, budget claimed before inference, operator
> controls re-checked, error text treated as untrusted, no shell — but it is a
> model in a control path, which the mission's §7 reserves for deterministic
> code. **Astra should rule on it before an unattended night.**

---

## 9. What it will never do

Worth knowing precisely, because it is what lets you sleep:

- **Write outside a task's approved scope.** Refused before any bytes are written.
- **Run an arbitrary command.** Only registry checks run, as fixed argv, no shell.
- **Accept its own work.** The worker has no review function; the orchestrator
  holds the gate; the reviewer is a separate call with independently re-run checks.
- **Push, deploy, or install.** Ever.
- **Reach the network.** The model endpoint is loopback-only, enforced at config load.
- **Read your vault.** `var/brain/`, `var/data/`, `.env`, key material and `.git/`
  are refused to both reading and searching.
- **Call Astra.** Escalation pauses, persists, and alerts you. You start Astra.
- **Turn itself on.**

---

## 10. Open, as of this draft

- Nothing has run against real ORION code. Every number here is a guess or a
  measurement from a disposable repository.
- The worker eval is weak — five models scored 6/6 — so the model choice rests on
  the reviewer eval. `devstral:24b` is a genuine untested alternative.
- The runtime-recovery path in §8 needs Astra's judgement.
- No numbered phase gate has been closed for this system; it is tracked as
  `scopeNotInManifest: supervised_local_project_agent`.
