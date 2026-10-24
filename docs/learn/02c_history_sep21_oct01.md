# 02c — History, 2026-09-21 to 2026-10-01: the local agentic runtime, the Qwen era, the life loop, and a phone that can lock itself

> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: the 198 commits authored 2026-09-21 through 2026-10-01 (`8ef85c8` … `d96cab3`), plus
> `HANDOFF.md` (entries dated 2026-09-21 to 2026-10-01), `docs/agentic/*`, `docs/planning/v2/PHASES_40_52_BATCH_REPORT_2026-09-26.md`,
> `AGENTS.md` (the 2026-09-30 commit-and-push rule), and the code the commits created under `scripts/lib/agentic/`,
> `scripts/lib/attention/`, `scripts/lib/life/`, `scripts/lib/remote/`, `scripts/lib/focus/`.
> Read after: 02b (2026-09-01 to 2026-09-20). Read before: chapter 09 (the agentic dev loop in depth, which this
> chapter deliberately does not repeat) and the later history chapter that starts on 2026-10-02.

This chapter is a narrative, like 02b. It has no runtime component of its own, so the STYLE "section template" is
applied per **era**: *What was built*, *Why*, *Key commits*, *Steps back*, *Lessons*, *Walk it yourself*, *Questions
to ask your tutor*. Chapter 09 explains **how the agentic dev loop works**; this chapter explains **when and why it
was built, what broke while it ran, and what it produced**.

## In this file

| § | Section |
|---|---|
| 0 | [How to read this chapter](#0-how-to-read-this-chapter) |
| 1 | [Where things stood on the morning of 2026-09-21](#1-where-things-stood-on-the-morning-of-2026-09-21) |
| 2 | [Era 1 — A scheduler entry point and a disabled agent foundation (09-21, morning)](#2-era-1--a-scheduler-entry-point-and-a-disabled-agent-foundation-09-21-morning) |
| 3 | [Era 2 — The local agentic development runtime (09-21 afternoon – 09-22)](#3-era-2--the-local-agentic-development-runtime-09-21-afternoon--09-22) |
| 4 | [Era 3 — First real runs: the loop learns what "stuck" means (09-23 – 09-26)](#4-era-3--first-real-runs-the-loop-learns-what-stuck-means-09-23--09-26) |
| 5 | [Era 4 — The Phases 40–52 batch (09-26, 00:47)](#5-era-4--the-phases-4052-batch-09-26-0047) |
| 6 | [Era 5 — Qwen writes the roadmap packets and Phase 58 history (09-26 – 09-27)](#6-era-5--qwen-writes-the-roadmap-packets-and-phase-58-history-09-26--09-27) |
| 7 | [Era 6 — The attention engine, ops tools and the review sweep (09-27)](#7-era-6--the-attention-engine-ops-tools-and-the-review-sweep-09-27) |
| 8 | [Era 7 — The phone link and the life loop (09-28 – 09-29)](#8-era-7--the-phone-link-and-the-life-loop-09-28--09-29) |
| 9 | [Era 8 — The backlog commit of 09-30, and a repo cleaned for readers](#9-era-8--the-backlog-commit-of-09-30-and-a-repo-cleaned-for-readers) |
| 10 | [Era 9 — Scheduling rebuilt from Nick's real day (09-30 – 10-01)](#10-era-9--scheduling-rebuilt-from-nicks-real-day-09-30--10-01) |
| 11 | [Era 10 — Night markers, one to-do list, and the phone's Screen Time lock (10-01)](#11-era-10--night-markers-one-to-do-list-and-the-phones-screen-time-lock-10-01) |
| 12 | ["ORION truthful" and "ORION truthful 2": Qwen's second and third projects (09-30 – 10-01)](#12-orion-truthful-and-orion-truthful-2-qwens-second-and-third-projects-09-30--10-01) |
| 13 | [Era 11 — Day rules by construction, and the surfaces project is staged (10-01 afternoon)](#13-era-11--day-rules-by-construction-and-the-surfaces-project-is-staged-10-01-afternoon) |
| 14 | [Steps back, catalogued](#14-steps-back-catalogued) |
| 15 | [Lessons that recur across eras](#15-lessons-that-recur-across-eras) |
| 16 | [Walk the whole period yourself](#16-walk-the-whole-period-yourself) |
| 17 | [Every commit in range](#17-every-commit-in-range) |

---

## 0. How to read this chapter

### 0.1 The range, checked

The brief said "about 198 commits" from 2026-09-21 through 2026-10-01. The exact command, filtering on **author
date** (git's `--since/--until` filter on committer date, which is why 02b found one commit off at its edge), gives
exactly **198**:

```bash
git log --reverse --format='%h %ad %s' --date=short | awk '$2>="2026-09-21" && $2<="2026-10-01"' | wc -l   # 198
```

First: `8ef85c8` (2026-09-21 09:22 +0100), which 02b noted was authored on the 21st. Last: `d96cab3` (2026-10-01 19:57).
The next commit after the range, `d2f7745` (2026-10-02 02:30), belongs to the next chapter.

Commits per day: 09-21 **11**, 09-22 3, 09-23 0, 09-24 2, 09-25 5, 09-26 **36**, 09-27 **56**, 09-28 0, 09-29 **21**,
09-30 **25**, 10-01 **39**.

Two dates have no commits at all (09-23 and 09-28), yet both are among the busiest days in `HANDOFF.md`. That is not
an accident. From 09-21 to 09-30 the working tree held a large **uncommitted backlog**, committed in one go on 09-30
(Era 8). When this chapter says "built on 09-28", it means the work first appears in `HANDOFF.md` on that date, and
in git on 09-30 in commit `b59bdca` or `7724c43`. The git history therefore *understates* the first half of the range
and *overstates* the second half.

By commit-subject type (the prefix before `(`): `agent(...)` **106**, `feat` 23, `claude(...)` 16, `fix` 15, `docs`
12, `agent-repair(...)` 11, `merge` 7, `chore` 3, `test` 2, `review` 2, `ci` 1. Net size from the parent of the range
to the last commit in it: **815 files, +73,387 / −11,107 lines** (`git diff --shortstat`). The −11,107 is dominated by
`bc659a1` (93 files, +18/−11,539 lines). Its subject is `test(plugin): run sandbox-exec terminal tests only on macOS`,
but `git show --stat bc659a1` shows it deleted 22 files of `docs/planning/_archive`, ~36 files of the tracked
Obsidian vault `var/brain/`, and 5 files of `docs/handoffs/briefs-research-2026-09-23`. Those deletions belong to the
repository cleanup described in `a27103b` (whose own diffstat is only 4 files, +39/−4): the cleanup's `git rm`s were
already staged when the test fix was committed, so **they were swept into the wrong commit**. Treat `bc659a1` as
"test fix plus the cleanup's deletions" and `a27103b` as "the cleanup's additions and its explanation" (Era 8).

### 0.2 Three kinds of author, and why that matters

`git log --format=%an` over the 198 commits shows four author names:

| Author name | Commits | What it really is |
|---|---|---|
| `Orion local agent` | 106 | Commits made by the **Qwen worker** inside the agentic runtime's isolated worktree. Subject `agent(<task-id>): ...`. |
| `Orion local reviewer` | 11 | Commits made by the **Qwen reviewer** when it *repairs* a task the worker could not finish. Subject `agent-repair(<task-id>): reviewer intervention`. |
| `Nick Madaio` | 79 | The human's git identity. In practice this is **Claude Code sessions** (long explanatory messages, trailer `Co-Authored-By: Claude Opus 5.5` on three of them), **Codex/Astra sessions** (terse messages, no trailer), and merges Nick ran himself. |
| `Claude review` | 2 | `a76bd9e` and `4a2816d`, the two fix commits Claude put on Qwen's branches during the 09-27 review sweep. |

The agent commits live on `orion-agent/<id>` branches (the runtime makes a real git worktree per project) and were
merged into `orion-v2/backlog-checkpoint` with `--no-ff` merges: `58af930`, `636036b`, `33dbcae`, `efcdac9` on
09-27; `e7a1f94` on 09-29; `5628d2b`, `0a97af5` on 10-01. Seven merge commits in total. Reading the history
topologically (`git log --graph`) therefore shows a main line of human work with side branches of machine work
joining it. Reading it by author date (what this chapter does) interleaves them.

A trap for tutors: the "agent" commits' **bodies are the worker's own final message**, not an engineer's writeup.
Two phrases recur and you should know them before reading the table in section 17:

* `ALREADY SATISFIED:` is how the worker's closing message starts when, on its last exchange, it found nothing left to change. **Usually the diff of that same commit is the work**: an earlier exchange of the same attempt wrote the files (or a reviewer repair did), and the checkpoint commit carries them. Only when the worktree is *clean* does the host make a truly empty commit (`commitAlreadySatisfied`, `scripts/lib/agentic/workspace.mjs:222`, `git commit --allow-empty`). I checked all 198 commits: **none is empty** (every one has a diffstat), so that path was never taken in this range. 30 of the 106 `agent(...)` commits open with "ALREADY SATISFIED". Read the phrase as "my last exchange changed nothing", not as "nothing was written".
* `Every registered check passed; the host submitted this checkpoint after the self-review exchanges.` is the
  runtime's boilerplate when the worker said nothing useful at the end.

Do not read these bodies as design documents. The design lives in `docs/agentic/ARCHITECTURE.md`, `HANDOFF.md`, and
the Claude commit bodies.

### 0.3 The two assistants, again, and a rule that was broken once

02b explained the Claude/Astra split. In this range a **third** actor appears: Qwen (`qwen3.6:27b`, local, via Ollama).
The relay is now Claude and Astra as designers and reviewers, Qwen as a high-volume implementer. Nick sits above all
three and sets the intent ("make sure this loop is able to be continuous", 09-22).

`AGENTS.md:140-150` records a rule Nick set on 2026-09-30: finished work is committed in logical groups with
conventional messages, pushed to the branch, and `main` is fast-forwarded (`git push origin HEAD:main`, never
forced), and **"No Co-Authored-By lines."** Three commits made *after* that rule still carry
`Co-Authored-By: Claude Opus 5.5`: `55c5648`, `3034d64` and `7e1ea26`, all on 2026-10-01. So the rule did not take
hold in the same day it was written. Section 14 lists this among the steps back; it matters because 02b's 0.3 says
the trailer "later became forbidden" and that rule's first violations are in this chapter.

### 0.4 Paths, and the branch you are standing on

All code citations use paths as of HEAD `6c93032`. The repo reorganisation of 09-15 (see 02b, 0.4) had already happened,
so the paths in this range match today's, with three exceptions:

* The tracked personal vault `var/brain` was **untracked** on 09-30 (`a27103b`); it stays on disk.
* `docs/planning/_archive` and several research dumps moved to `~/Desktop/ORION-archive/2026-09-30/` (`a27103b`).
  Commits earlier than that can cite files that are no longer in the tree but are in history.
* Files that later commits changed are cited at their **HEAD** line numbers, and this chapter says so when the HEAD
  version includes later work (for example `scripts/lib/life/commute.mjs` has the 2026-10-05 home-gap rule that does
  not exist in any commit of this range).

The worktree is dirty (see the snapshot note in `STYLE.md`): `plugin/orion-control/dist/` has untracked and modified
build outputs, and `docs/evals/2026-10-02-schedule/` has uncommitted files. None of the eras below depend on
uncommitted material; where a file exists only uncommitted, the text says so.

### 0.5 Jargon you need before Era 1

* **Qwen, worker, reviewer.** `qwen3.6:27b` served by Ollama on loopback. The *worker* implements one task at a
  time; the *reviewer* (the same model, different system prompt and with thinking on) judges the checkpoint, may
  *repair* it by writing code itself, and is the only party that can accept it. Neither can run a shell (see chapter 09
  for the fixed tool vocabulary).
* **Task / plan / brief.** A plan is a Markdown file under `docs/agentic/plans/`, a task is one block in it with a
  contract (scope paths, acceptance criteria, checks), and a brief is a per-task Markdown file in
  `<plan>.briefs/` that the worker reads. `docs/agentic/PLAN_STANDARD.md` (added 09-25) is the style guide.
* **Check.** A registry name with a fixed argv (`node-syntax`, `scope-tests`, `doc-report`,
  `automation-install-tests`…) that the host runs, never the model. `scope-tests` runs `node --test` on the task's own
  test files (`scripts/lib/agentic/checks.mjs:160`).
* **Escalation, task-level vs run-level.** An escalation is the runtime stopping and asking a human. From 09-22 it
  can park **one task** (`deferred: true`) while the loop keeps working on independent tasks.
* **Packet.** A document produced by an investigation task: baseline, requirement matrix, architecture and
  interfaces, smallest next slice, test scenarios, gates and handoff. The 40 "phase-NN-packet" and "vision-*" commits
  of 09-26/27 are packets, not features.
* **Life loop.** The set of modules under `scripts/lib/life/` that plan, remind, observe, intervene, follow up and
  adapt Nick's day. Distinct from the agentic dev loop; one is how ORION builds himself, the other is how ORION runs
  Nick's day.
* **Truthful.** A family of checks that stop ORION claiming things he did not do ("Done, unlocked" when nothing
  unlocked). Two Qwen projects in this range are named after it.
* **Surfaces.** The UI plan staged on 10-01 for Qwen to build: phone composer, orbs, finish-early UI, focus lists.

---

## 1. Where things stood on the morning of 2026-09-21

From 02b's ending and the first `HANDOFF.md` entries of this range:

* The program is nominally 85 phases with a gate record each. On 09-21 the HANDOFF says **46/85 complete (54%), 25
  in progress, 14 not started** (`HANDOFF.md`, 2026-09-21 15:31 entry, "46/85 complete (54%)").
* Phases 57 (Automation Framework) and 58 (Automation Simulation) are the live front. Phase 57 has a guarded runtime,
  a preview and a dispatcher; what it lacks is a **disabled installation transaction**, a scheduler adapter and
  crash reconciliation. Those are the five tasks the first Qwen run is given.
* ORION's Python runtime is dead as a product; the Swift app (`native/Orion`), the TypeScript plugin
  (`plugin/orion-control`), and the Node scripts under `scripts/` are the live stack (`CLAUDE.md`, "Where the
  program is").
* The phone app exists as a Simulator-only pairing shell (02b Era 9). There is no iCloud/CloudKit link yet, nothing
  has run on Nick's physical iPhone, and he has no Apple Developer membership.
* The repo has **no GitHub-visible progress for 3 weeks**: the last push is old, CI is red (since 09-03, see
  Era 8), and the dirty tree grows daily.
* The legacy offline coder `scripts/orion-code` (Python, `gpt-oss:20b`, whole-file edits) exists from 09-07 and is
  *explicitly not* the path forward ("do not launch the legacy loop as a substitute", HANDOFF 09-21 15:31).
* Astra (ChatGPT/Codex) is "the most capable reviewer on this project and the most scarce"
  (`docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md:31`). The mission of the new runtime is stated in one sentence
  in that file: **maximise useful Astra-acceptable work per elapsed hour while minimising how often Nick has to
  intervene.** Every design bound that follows comes from the second half.

---

## 2. Era 1 — A scheduler entry point and a disabled agent foundation (09-21, morning)

*Commits: `8ef85c8` (09:22), `18de992` (15:31), `6307a82` (15:33).* These are Astra's last commits before the handoff
to Claude, and they close the previous chapter's automation thread while opening the next.

### What was built

* **`8ef85c8` — guarded scheduler entrypoint and preview.** New `scripts/orion-automation-run` (6 lines),
  `scripts/lib/orion-automation-tick.mjs` (21 lines) and `scripts/lib/orion-automation-schedule.mjs` (41 lines), plus a
  human CLI verb `schedule-plan <name> --timezone <IANA>` on `scripts/orion-automation` (net −52/+252 lines across 8
  files). The tick adapter "accepts only an installed name, evaluates the current minute through the guarded runtime,
  emits status/reason only, and never prints calendar output into scheduler history" (HANDOFF 2026-09-21 09:19).
  The commit **removed** the old install route that used `--schedule/--timezone`, because installed OpenClaw's help
  showed the real flags are `--cron`, `--tz` and `--command-argv` and the old route "bypassed runtime limits".
  Registration now *explicitly refuses* until a guarded one exists. This is the setup for Qwen's first project: the
  disabled-installation transaction (Era 3).
* **`18de992` — checkpoint of the disabled reviewed-agent foundation.** Astra's fixture-only durable controller
  (`scripts/lib/orion-project-agent.mjs`, +204 lines), revisioned operator CLI (`scripts/orion-project-agent`),
  a Swift status model (`native/Orion/Sources/Orion/ProjectAgentStatus.swift`, +100) and the Projects tab integration
  (`ProjectTab.swift`, +94). 12 controller tests pass. Astra's independent review had found three defects, fixed in
  the same commit: **lifecycle corruption, verification after timeout, and pending steering at closure**. "No
  worker/model/reviewer transport enabled, no production run state initialized."
* **`6307a82` — a 96-line HANDOFF entry telling Claude to take over.** The pointer is
  `docs/handoffs/ASTRA_TO_CLAUDE_AGENTIC_LOOP_HANDOFF.md`. Nick asked "to stop at a stable source checkpoint and a
  technical handoff, not further agentic-workflow implementation."

### Why

Phase 57 had reached the point where more guard work by Astra was lower value than getting the unattended loop to build
the remaining plumbing. Astra built the *controller* (a durable state machine with a CLI), Claude was handed the job
of building the *runtime* around it (worker, reviewer, models, supervisor). The split matches the mission statement:
spend the scarce reviewer on architecture and acceptance, not on writing the 40th `node --test` file.

### Steps back

None in the three commits themselves. The pre-commit review that found three defects is an example of the **review
before checkpoint** rule from `AGENTS.md` (Phase 32.5 charter §6) working as designed.

### Lessons

* A fixture-only first slice that "does nothing" is a legitimate checkpoint when the next slice needs a stable
  contract. The 12 controller tests were the contract Claude later had to keep green ("Astra's 12 tests still pass;
  only their fixtures changed", `a32a8ae`).
* The handoff file pattern again: a long, explicit HANDOFF entry (`6307a82`) is how work crosses between assistants who
  cannot see each other's chat.

### Walk it yourself

```bash
git show --stat 8ef85c8 | head -20
sed -n 1,60p scripts/lib/orion-automation-schedule.mjs
git show --stat 18de992 | head -20
sed -n 1689,1720p HANDOFF.md     # the 09-21 09:19 and 15:31 entries (line numbers at HEAD may drift)
```

### Questions to ask your tutor

1. Why did `8ef85c8` remove the working install route instead of fixing its flags?
2. What is the difference between "disabled registration" and "installed and enabled" for a scheduled job, and which
   file enforces it?
3. Why is the project-agent `enabled` flag kept outside the repository (`~/.openclaw/orion-controlled/agentic-config.json`)?
4. What would have gone wrong if Claude had started writing the worker before Astra's controller had a stable state
   schema?

---

## 3. Era 2 — The local agentic development runtime (09-21 afternoon – 09-22)

*Commits: `a32a8ae` (16:24), `ac3c1ab`, `5737588`, `f2eab40`, `d2ca03c` (all 16:30–16:41), `a63f1f2` (20:07),
`89cc8cb`, `8d76910` (20:16), `c9ddbec` (09-22 01:42), `d1e7e98` (01:47), `bbe4575` (01:50).* Eleven commits, **one
day**, and the core of the system that will write ~106 of the next 198 commits. Chapter 09 explains the machinery; this
section is the *story* of how the first version took shape and what it got wrong immediately.

### What was built

**`a32a8ae` — the runtime (37 files, +6,446/−167).** In one commit: the controller moved from v1 to v2 *in place*; new
modules under `scripts/lib/agentic/` (`worker.mjs`, `supervisor.mjs`, `models.mjs`, `workspace.mjs`, `checks.mjs`,
`boundary.mjs`, `escalation.mjs`, `journal.mjs`, `lease.mjs`, and others, 17 files in that directory); worker, reviewer
and repair system prompts under `scripts/lib/agentic/prompts/`; the CLIs `scripts/orion-agent` and
`scripts/orion-project-agent`; 55 Node tests and 8 Swift tests. The body is worth quoting for its design claims
(from the commit message, 2026-09-21):

> Containment: the worker gets a fixed tool vocabulary, never a shell. Checks are registry names with fixed argv, never
> strings carried by a task. Writes pass structure, containment, contract scope, the runtime deny-list and ORION's
> INSTALLED self-change policy, and fail closed when that policy cannot load. Reads are deny-listed for var/brain/,
> .env and key material. Execution is gated on a config file outside the repository, so the agent cannot enable itself.

Other design decisions recorded in the same body:

* **Roles, not model names.** "Models are addressed by role, never by name, with exclusive residency verified against
  Ollama rather than assumed: measured, qwen3.6:27b holds 20.7 GiB at a 64k context, so a larger reviewer cannot be
  co-resident on 48 GiB." This is the machine constraint that shapes everything: one big model at a time on a 48 GiB
  Mac, so the "worker" and the "reviewer" are the same weights loaded once.
* **Review verdicts.** `PASS / PASS_WITH_TASKS / BLOCKED`, with **bounded reviewer repair recorded separately from
  reviews**, so a repair cannot masquerade as a review.
* **Escalation state the loop cannot clear for itself.** A BLOCKED review or a hard failure puts the run into an
  escalation that only a human resolution clears.
* **Append-only journal with a control stream and an observation stream.** The durable audit record.
* **Lease on PID + boot + start-time proof.** So a stale supervisor cannot be mistaken for a live one after a reboot.
* **Real-git tests.** "The supervisor suite runs end to end against a real git repository with real checks; only the
  model is faked. It caught a `git status --porcelain` trim that truncated the first changed file's path."
* **Not run.** "NOT RUN against ORION code. GOVERNED_SELF_DEVELOPMENT_ENABLED and the legacy scripts/orion-code loop are
  untouched. No numbered gate closed." The run remained disabled until Nick created `agentic-config.json` himself
  (`scripts/lib/agentic/settings.mjs:17`, where `enabled` is "file only" and `enabledIsFileOnly: true` at line 47).

**`ac3c1ab`, `5737588` — three ways an unattended run stops badly (self-review of the runtime, 6 minutes later).**
* A review or repair takes *minutes*. Nick pausing from the UI during one bumps the revision, so applying the verdict
  against the revision the loop started from failed and **escalated, waking him to report that he touched the UI**. Fix:
  re-read state and confirm the checkpoint is still the one on disk before applying anything.
* An instruction that arrives after the last task was handed to its worker is never applied, and closure correctly
  refuses to discard it. That exception **propagated out of the loop and killed the supervisor**: "the morning showed a
  process that was simply gone." Fix: the loop body cannot throw out of the process; a failed iteration is journalled and
  counted, and the watchdog ends the run with an escalation.
* A config with `repairAfterAttempts > maxAttempts` made the reviewer-repair rung unreachable "silently", so tasks would
  escalate that the loop could have unblocked. It is now refused at load.
* "Two regression tests, both of which failed before these fixes. The test harness was not awaiting its own async script
  functions, which is how the second bug surfaced at all."

**`f2eab40` — "Attempt N of 14" was a lie.** The turn counter was labelled "Attempt N of 14", but the worker system
prompt's escalation ladder keys off *attempts* ("attempt 2 failed the same way, read a different file; attempt 3, report
BLOCKED"). The prompt was telling an unattended model it had **fourteen tries at a task the controller blocks after
three**. A *turn* is one exchange inside an attempt; an *attempt* is one whole run at the task, spent when a review
sends the work back. Both are now shown from durable state. The constants `MAX_TURNS = 14` live at
`scripts/lib/agentic/worker.mjs:39`.

**`d2ca03c` — a benchmark that destroys its evidence cannot answer its question.** The first live bench of the runtime
against `qwen3.6:27b` accepted one task through the full gate and blocked the other; "the summary said which task
blocked; only the journal said why, and the disposable repository holding it had already been removed." Journals are now
copied to `bench-journals/` before the repo is deleted, and the path is recorded on the ledger line.

**`a63f1f2` — the project panel, "two clocks" and a live reasoning channel (12 files, +1,321).** The UI Nick asked for:
progress for the current task *and* for the plan, somewhere to read the instructions the local models get, and a place
to steer, pause and see settings. Three design ideas, each argued in the commit body:

1. **Two clocks.** "Plan progress is accepted task WEIGHT over total; current-task progress is the recorded stage's
   position in the lifecycle. One ring answering both would answer neither — a task ring hides that four tasks remain,
   and a plan ring sits still for forty minutes during a task and looks frozen. Neither number comes from a model."
2. **Streaming inference** makes "it is thinking" an *observed fact*: "a non-streaming request to a 27B is
   indistinguishable, from outside, from a dead runtime for nine minutes at a time." The trace is written to
   `activity.json` (a single disposable snapshot, throttled to ~400 ms, never fsynced) and **not** to the journal, which
   is the durable audit record and which reasoning traces would bury. "Thinking transitions bypass the throttle: a
   lagging indicator cannot do the one job it has."
3. **`probe()` now does a one-token generation per role** (`scripts/lib/agentic/models.mjs:334`). Streaming exposed a
   real gap: `probe()` checked a model was *installed* but not *usable as configured*; `think: true` against a model
   that does not support thinking is a 400 on every generation, i.e. "a run that starts at 23:00 and does nothing all
   night with no obvious cause."

Settings are shown **read-only** in the panel: "`enabled` decides whether a model may change real code unattended and
lives outside the repository so moving it takes a deliberate act. A toggle in a window is not that act."

**`89cc8cb` — measure the layout, and unbreak the GUI harnesses.** A harness that lays the real panel out in a real
`NSHostingView` and measures it ("does the live reasoning channel keep a viewport inside the dashboard's own
ScrollView?"). The history that motivates it: nested same-axis ScrollViews "size themselves to their whole content",
the defect behind "the task day-calendar view does not scroll correctly". Measured: +133 pt for a full trace, so the
6000-character cap holds. It also found a **pre-existing breakage**: `SessionService` began importing `MobileCore` from
the sibling `OrionMobile` package and `build-modules.sh` did not build or link it, "so every GUI harness in Tests/ failed
with 'no such module MobileCore' pointing at TodayPlanStore.swift, a file none of them care about."

**`c9ddbec` (09-22 01:42) — task-level escalation: "one hard problem cannot end the night".** Nick: "make sure this
loop is able to be continuous. If one part is stopped see what else can be done." It could not: escalation was
run-level; one BLOCKED review set status to `escalated`, the claim logic refused every task, and the supervisor
returned. The commit:

* makes `escalations` a **list** (schema v3), each naming a task or the run; a task-level escalation parks that task and
  nothing else; `claimableTasks` excludes it; `escalated` now means "nothing claimable remains" not "an escalation
  exists" ("two different facts that the controller, the CLI and the panel now report separately");
* routes every "what can the loop do now" decision through one function, `settleStatus`; the validator refuses
  `ready` with an empty queue;
* **fixes a bug three different models tripped over**: the reviewer was shown `diffSince(baseRef)`, every
  previously accepted task's changes stacked on the one under review, and asked whether *this* task violated its scope.
  It correctly saw a forbidden file modified, by a task it had already accepted, and escalated. Fix:
  `diffForCheckpoint` (`scripts/lib/agentic/workspace.mjs:314`) shows one checkpoint. "That bug killed 2 of 3 benchmark
  runs and read as model confusion." (This is the signature of this era: *a harness bug looks like a model failure*.)
* adds an **informational notification tier**: "when the reviewer crosses into writing code, one line, its own rate
  limit, no brief, no action requested. Deliberately not an escalation — routing it through that path is how an alert
  channel learns to cry wolf."
* tightens the bare-minimum repair from 6 files to 2 ("Six is most of a refactor").
* **Chooses the model.** "qwen3.6:27b for both roles, measured over eight candidates on two evals (3/3 planted defects,
  zero false positives, every run; 77.2% SWE-bench). One model for both roles means residency never changes — no
  eviction, no swap." The HANDOFF (2026-09-22 entry "Task-level escalation, measured model choice") adds the
  rejected alternative: a quantised 80B coder "codes well and reviews badly (1/2 judgment defects, 4/4 runs)", attributed
  to MoE routing damage under aggressive quantisation, and "is retired". Model choice is settable via
  `orion-project-agent set-model`; `enabled` stays a file edit.

**`d1e7e98` — independent check re-runs, durable subtasks, eval harnesses.** Three more design commitments:

* **Independent check re-runs.** The reviewer was judging a diff plus the worker's own account of whether its checks
  passed. "`verify` validated the shape of that report but never re-executed anything, so the evidence and the thing being
  judged came out of the same process. A review that takes the author's word for the test results is not independent."
  The reviewer now re-runs the contract's checks; a disagreement escalates as `contradiction`, "either the check is flaky or
  the worker reported a result it did not get, and those need different responses".
* **Durable subtasks.** `### SUBTASK: 2/4 label` is recorded by the controller and shown under the stage. It clears when the
  task leaves the worker's hands ("a stale '2/3 writing the change' beside an accepted task is a panel lying about the
  present"). "It carries no authority; stage and the checks decide acceptance."
* **Context is bounded, not compacted**, with the reason: "a summary of a failed check is a lossy copy of the one thing the
  next turn must read exactly."
* Bench candidates now split on `+`, not `/` (HuggingFace names contain slashes and the reviewer was parsed as literally
  "hf.co"); a trailing `!` marks a non-thinking model. The two evals moved into `scripts/lib/agentic/evals/`: "they found
  three bugs in my own code, and they do not belong in a scratch directory."

**`8d76910`, `bbe4575`** are docs: the HANDOFF entries that record what the UI pass and the continuity fix exposed.

The numbers at the end of the era (from the commit bodies): **65 Node tests, 503 Swift cases, layout harness green**,
CI `--quick` OK, secret scan clean. Still "NOT run against ORION code; still gated on `agentic-config.json {"enabled":
true}`, which does not exist."

### What happened *beside* these commits (HANDOFF, uncommitted until 09-30)

The git history for 09-22 and 09-23 is nearly silent, but HANDOFF shows heavy uncommitted work, mostly by Codex under
Nick's direction:

* **09-22 22:01 (Codex), five agentic review findings repaired.** A read-only review "reproduced five defects despite 77
  green Node tests": worker **leases** now use an ownership-record API (ownerless locks are treated as held/uncertain);
  **Exterminate** reaches task review, repair and final review, and late inference replies cannot write, commit or publish
  acceptance (new `scripts/lib/agentic/cancellation.mjs`); ordinary worker failures retry from HEAD within the attempt
  budget; Stop clears even in ready state; a smoke task's greeting import was allowed. 88 Node tests pass. The old
  tree-state evidence went to `.builds/agentic-five-fixes-2026-09-22/`.
* **09-22 (Nick-authorised addition): reviewer runtime recovery.** The supervisor asks the reviewer to diagnose thrown
  loop errors before escalating (retry; unload models and retry with a fresh session; or ask for a human), bounded at 2
  recoveries per phase and 6 per run, persisted. This is `scripts/lib/agentic/recovery.mjs`.
* **09-23 09:20, executable-Markdown plans.** Nick clarified that the requested document "is the phased product work
  queue, not worker operating instructions". Codex added `scripts/lib/agentic/plan.mjs`, a Markdown plan parser
  (only *marked contract blocks* grant task scope; prose and examples cannot), wired it into `plan`/`init`, and created
  `docs/agentic/plans/advance-orion-capabilities.md`, five tasks for Phase 57. A fenced-block bug that let nested task
  examples be queued was found by independent review and fixed.
* **09-23 14:59 / 16:30 / 23:51 / 23:31.** The saved Projects workspace, a "readiness pass" (a mid-task exterminate can
  now be resumed; stuck or timeout goes to the reviewer; keep-awake options and lid/power preflight in the Projects
  view; Discord `agent` control reaches the installed controller under launchd), a restored workflow diagram, and a
  wall-clock `--until-stopped` run mode with a full-width workflow UI. ORION app build **275** is installed with the
  previous app kept as `/Applications/.Orion-previous-275-pre-keepawake-20260923.app` (the rollback copy).

### Steps back in this era

| What | Fix | Commit |
|---|---|---|
| Nick touching the UI during a review escalated the run | re-read state and confirm the checkpoint before applying a verdict | `ac3c1ab` |
| Late instruction exception killed the supervisor | the loop body cannot throw out of the process; failures are journalled | `ac3c1ab` |
| Worker prompt said "Attempt N of 14" when controller blocks after 3 | show turns and attempts separately | `f2eab40` |
| Benchmark deleted the evidence it existed to produce | copy journals to `bench-journals/` first | `d2ca03c` |
| `think: true` against a non-thinking model = silent all-night no-op | `probe()` does a real one-token generation | `a63f1f2` |
| Reviewer judged cumulative diff, escalated on a previous task's files; looked like model confusion | `diffForCheckpoint` | `c9ddbec` |
| Run-level escalation ended the night for one hard task | schema v3 task-level escalations | `c9ddbec` |
| Five review findings despite 77 green tests (leases, exterminate, retry, stop, smoke scope) | Codex repair pass | HANDOFF 09-22 22:01, uncommitted until `490d991` |
| Every GUI harness failed to build (MobileCore not linked) | `build-modules.sh` | `89cc8cb` |

### Lessons

1. **A harness bug looks exactly like a model bug.** Three different models "tripped over" the cumulative-diff problem and
   it read as confusion. The fix was in the *evidence given to the model*, not in the model. When a local model "fails
   the same way" across candidates, suspect the harness first.
2. **Make liveness observable by construction.** The streaming channel is not a nicety; without it "thinking" and "dead"
   are indistinguishable for minutes.
3. **Separate the audit stream from the display stream.** Reasoning traces go to a disposable file; the journal stays
   readable.
4. **Intent lives in a file the code cannot rewrite.** `docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md` says material
   changes go in `MISSION_AMENDMENTS.md` first; `enabled` lives outside the repo.
5. **Tests that cannot fail are not tests**: both regression tests in `ac3c1ab` "failed before these fixes", and the
   harness's own async bug was what hid them.

### Walk it yourself

```bash
git show -s --format=%B a32a8ae | sed -n 1,60p
sed -n 380,425p scripts/lib/agentic/models.mjs       # ensureExclusive (note: HEAD includes the 10-01 eviction fix, see §12)
sed -n 305,330p scripts/lib/agentic/workspace.mjs    # diffForCheckpoint
sed -n 10,50p scripts/lib/agentic/settings.mjs       # enabled is file-only
sed -n 1,40p docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md
```

### Questions to ask your tutor

1. Why does the mission say an escalation "is a cost, not a safety feature", and which bound in the runtime follows
   from that sentence?
2. In `c9ddbec`, what is the difference between `escalated` before and after the change, and why would conflating
   them "teach you to ignore the alert"?
3. Why measure one model for both roles rather than a strong reviewer and a small worker, given a 48 GiB machine?
4. Which two clocks does the panel show, and why would a single ring be worse?
5. Chapter 09 covers the worker loop. Using only the commit body of `a32a8ae`, list every gate a worker write passes.


---

## 4. Era 3 — First real runs: the loop learns what "stuck" means (09-23 – 09-26)

*Commits in git: `7898699`, `d7286b2` (09-24), `97cec31`, `6b696c5`, `a5f4487`, `004b7a6`, `f529b4f` (09-25),
`7bf79a5`, `bb51bbe`, `69f65f2` (09-26 early). Seven of the ten are Qwen's. The rest of this era, which is most of it,
exists only in `HANDOFF.md` and in the uncommitted tree until `490d991` on 09-30.*

### What was built

The first real project, **`advance-orion-capabilities`** (Phase 57, `docs/agentic/plans/advance-orion-capabilities.md`,
five tasks), was started by Nick from the Projects tab on the evening of 09-23 (`--until-stopped`, branch
`orion-agent/f3c41a5b`, HANDOFF 2026-09-24 00:04). The tasks were:

| # | Task id | What it asks Qwen to write | Result |
|---|---|---|---|
| 1 | `auto-install-readback` | validate a registered scheduler job against the installed record | accepted only **through a reviewer repair**, `7898699` |
| 2 | `auto-install-transaction` | `installDisabledAutomation`: a durable, disabled installation transaction in `scripts/lib/orion-automation-install.mjs` | `d7286b2` repair (wrong), then `97cec31` accepted 09-25 07:30 |
| 3 | `auto-install-reconcile` | `reconcileDisabledAutomation`: finish or clean an incomplete install without duplicate effects | `6b696c5` repair, `a5f4487`, two review-correction tasks `004b7a6`, `f529b4f` |
| 4 | `auto-install-fixture-route` | prove an installed record reaches guarded execution under fixtures | `7bf79a5` repair then `bb51bbe` |
| 5 | `auto-install-review-packet` | an implementation review and live-proof handoff for Astra | `69f65f2` (`docs/planning/v2/PHASE_57_LOCAL_AGENT_REVIEW.md`, 302 lines) |

Everything else in this era is a **defect list for the runtime**. Nobody planned it as a work item; every defect was
found by a night of failed unattended work, written up in HANDOFF, and fixed with a test that fails when the fix is
reverted ("mutation checks", repeated in six HANDOFF entries). This is the most instructive stretch of the whole
program for how the loop was hardened, so it is told in order.

### Timeline of what went wrong

**09-24 00:04.** First real run is live. At verification it is on `auto-install-readback`, attempt 2: "the first attempt was
automatically retried after a worker/validation failure, as designed."

**09-24 00:44 (false worker-stop).** What looked like a lost supervisor was a false `worker_stuck` after four *passing* check
cycles. Root cause: the stuck counter counted only the *first write to a path* as progress, so a worker that corrected the
same file during a required self-review was classed as stuck right after a useful correction. Also: `diffSince()` omitted
**untracked** files, so the repair reviewer was told "the current diff is empty before the first checkpoint". Also: after a
passing reviewer repair, the worker was required to rewrite the same files and say DONE; Qwen kept replying `CHECK` and hit
the repetition gate. Fix: repair retries durably carry the repair SHA and files; **the host reruns every check against
those files and submits the clean repair to ordinary review without another worker generation**. At 00:46 the reviewer
accepted repair commit `78986999` and the loop started task 2. (That commit hash, 8 digits, is quoted from HANDOFF; it is
not among the 198 commits and I could not resolve it; **(inferred)** it was a repair commit later superseded on the branch.)

**09-24 02:42.** The run stopped, status `escalated`. Task 1 accepted via `7898699`; task 2 blocked after all attempts. The
journal shows why (HANDOFF 2026-09-24 03:37): attempt 1, the worker read ~10 files in one exchange, **evicting 7 of its own
reads** from its working set, then hit the repetition gate; attempt 2, **twice spent the whole 16k output budget thinking**
(empty replies) then timed out; a reviewer repair (`d7286b2`) was judged "structurally correct" but blocked for missing
tests; Nick's resolution ("add the six missing tests") was wasted because the controller **resubmitted the same repair
checkpoint three seconds later** and the reviewer blocked it again.

The commit message of `d7286b2` is the evidence of how bad the model's repair was: *"the reviewer supplied no diagnosis"*.
Claude's verdict in HANDOFF is blunt: "**The repaired installer is not correct**, whatever the reviewer said": it required
`now` to be a `Date` (passed to `automationSchedulePlan`, which throws "Invalid current clock" on every call), nested
`policy: plan.policy` where dispatch refuses it, never released its lock, stored neither plan nor record in the
transaction, labelled a failed read as `create_pending`, and published with `rename`, which overwrites. "No test exists to
show any of this." A reviewer model had *accepted code that cannot run once*. This is the origin of two later rules: the
reviewer **re-runs checks** (`d1e7e98`, already there) and every new brief demands named test scenarios.

**09-24 03:37 (Claude).** Briefs rewritten from verified research (40.8 KB, was Codex's 14 KB), because "Codex's briefs were
accurate but thin". New: exact signatures and line references, installed-record shape, test recipes with a fixed clock, an
**exchange plan sized to the stuck gate and output budget**, "traps, taken from tonight's actual mistakes", and a
per-criterion checklist "for the reviewer, who cannot open files". Runtime fixes: a reviewed repair checkpoint is consumed
by any verdict; one exchange reads only what fits beside the task's own files; after a reply starved by thinking, the next
exchange runs with `think: false` once (`models.mjs` takes a per-call `think`); a new operator command `orion-projects
rebrief` refreshes the briefs of unfinished tasks on a started run. A throwaway installer that followed the brief was
executed against the real modules (7/7 tests, covering 15+ brief claims) to **fact-check the brief by running it**.

**09-24 morning (Nick and Astra restart the run several times; all stop on task 2's last attempt).** HANDOFF 23:22 reads the
journal: 08:40Z a worker turn thought for 23 minutes (64k characters) and produced nothing; 09:13Z the next call hit the
30-minute "inference timeout", which was classed `worker_or_validation_failed` (spends an attempt) instead of
`worker_timeout` (goes to the reviewer); 09:22Z with worker thinking now off, the worker sent the same
`SUBTASK+READ+READ` three turns running because reads of files already in view were ignored *silently*, so it never learned.
Fixed: a READ of a file already in view gets a notice; the repetition gate counts *consecutive identical* turns "as its
comment always said" and routes to `worker_stuck` (the reviewer rung); "inference timeout" routes to `worker_timeout`.
HANDOFF also records a process failure: "No handoff entry was written for the 09:37–10:17 BST edits (worker, supervisor,
models, controller, Swift)." That is the relay protocol broken by Astra, noticed by Claude.

**09-25 03:40, 04:12 (Claude, overnight, on Nick's instruction).** The start button was disabled because task 2's escalation
was still open and **the app said nothing about it**; fixed in `ProjectTab.swift`. At 04:00 the **resource guard stopped a
worker generation** ("swap is still climbing"), and it was **charged as an ordinary worker failure, spending task 2's last
attempt**; the run escalated. Fix: `resources.mjs` marks a guard stop `recoverableRuntime` + `resourcePressure`, the
controller refunds the attempt, and `recovery.mjs` handles pressure on the host, without asking the 27B reviewer: unload the
model, wait `resourceSettleMs` (default 180 s), retry. Also noted: "Swap is 17 GB and mostly stale; a reboot before the next
run would help. Keep the lid open."

**09-25 07:40.** Task 2 accepted at 07:30 (`97cec31`, "independent review: transaction order, exclusive publish, all six
scenarios"). Four defects fixed during the night, each with a mutation-checked test (214/214 agentic):
1. *Unfinished work wiped on every resume* (`partial_work_discarded`): "23-of-24-passing work was thrown away twice." Now a
   task's own dirty files are kept when all are in its scope and it was the last task the worker wrote (`recoverRun` at
   startup and at claim). Another task never inherits them.
2. *Green work called stuck*: self-review exchanges that may not say DONE counted toward the stuck gate. With fresh
   all-passing checks both gates now submit the checkpoint to review (`worker_green_submitted`).
3. *Kept files not counted as written*, so CHECK answered "nothing written".
4. *Memory-pressure stops charged as failures* (above).
The last real bug in task 2 was in **its test**: the ledger file name used the raw installationId instead of its sha256.

**09-25 14:12 (the big one: "Stuck was retyping files").** Claude's diagnosis of the 07:30 stop on task 3 reads: "not
stuck, and not a model-quality problem. The block was `worker_timeout`: nine exchanges in the hour, and the worker was
making progress. The time went on output." Every change was a whole-file `### FILE` write; at local generation speed that
is **about 7 minutes for a 20 KB module and 11 minutes for the 34 KB test file**; turns 6 and 8 each retyped the module for a
small fix; turns 6 and 8 wrote without a CHECK, "so the worker was fixing a failure it could not see"; the repair retyped the
same file, hit the output cap (`doneReason: length`) and was cut off before its diagnosis. Changes (224/224):

1. **`### EDIT`** — SEARCH/REPLACE hunks, `scripts/lib/agentic/edits.mjs` (`applyEdits` at line 16). Each SEARCH must match
   exactly once; trailing whitespace forgiven; all-or-nothing; a failure names which block and why. "Every write still goes
   through `writeScoped` as a complete file, so scope, protected surfaces and the diff the reviewer sees are exactly what they
   were for `### FILE`. Only what the model has to TYPE changes." This is the single biggest throughput change of the era.
2. **Checks run automatically after every write.**
3. **Deferral.** Every task-level escalation becomes `deferred: true`; the task waits for Astra; independent work continues.
4. **Alert modes** (`orion-project-agent --project ID alerts quiet|away`): quiet sends one silent Discord digest when the
   run stops plus `briefs/astra-deferred.md`; away sends each deferral as it happens. Default quiet.
5. **More tries**: a repair that leaves checks failing no longer escalates; `repairRetryAttempts` 1 → 3.

Live result that day: relaunched 14:02 in quiet mode; "worker turn 2 was an EDIT that took 51 seconds, and all checks were
green"; the task went to review 5 minutes after start. (Contrast: 7-11 minutes per whole-file rewrite before.)

**09-25 14:55 (soft task hour).** `taskTimeoutMs` (60 min) became the *first* budget, extendable by the reviewer: "At each
exchange boundary the worker checks whether the next exchange will fit… the reviewer gets a short report… It grants 0–45 min
plus an ETA", capped by `taskHardTimeoutMs` (4 h). Every decision journalled as `deadline_extended` / `deadline_extension_refused`
(`scripts/lib/agentic/extension.mjs`). And the Projects run console was redesigned (status orb that breathes cyan for worker
and violet for reviewer, pulses orange when it needs Nick, a "Sent → Recorded → Done" proof that a button press landed,
read from the loop never assumed). Nick stopped the run at 14:33 "(battery)": the Mac drained ~60%/h while running.

**09-25 15:07 (plan standard and plan lint).** `docs/agentic/PLAN_STANDARD.md` is the baseline for every plan: what reaches
worker, reviewer and repair and what never does (plan prose, other tasks, the graph); architecture rules A1–A8 (independent
branches, one owner per file, a task-specific check, checks registered before the run, sizing, docs-task criteria, scope as
the grant, preconditions) and information rules I1–I8 (objective as end state, one statement per criterion, named test
scenarios, specified interfaces, task-specific context, described failure injection, real escalation conditions, no
impossible instructions). `plan-lint.mjs` prints advisory findings; its only error is `scope-tests` with no test file in scope.
New check `scope-tests` (`scripts/lib/agentic/checks.mjs:160`) runs `node --test` on the task's own `tests/**.test.mjs`
scope files with fixed argv, so no per-plan registry edit is needed. The current plan scored "0 errors, 16 warnings, 1 note".

**09-25 18:43 ("Every task checks what already exists first").** Because Astra's full plan "may already be done", every
attempt now starts with `surveyExistingWork` (`scripts/lib/agentic/existing.mjs`) recording per scope file: exists, lines,
exports, test count, last commit; and per `Export foo(` promised in the contract where it is already defined. The worker sees
it as "ALREADY IN THE REPOSITORY" each exchange. And an **overwrite guard** (`overwriteRisk`, `existing.mjs:123`) refuses a write
that removes existing exports the contract does not mention, lowers a file's test count, or discards more than half of a
40+-line file. A worker that changed nothing can finish with `### DONE ALREADY SATISFIED:` on fresh all-green checks; if the worktree is
clean the host then makes an **empty commit** (`commitAlreadySatisfied`, `workspace.mjs:222`). In practice, in this range, **no commit is empty**: the
phrase in the 30 commits that carry it means "my last exchange changed nothing" while the commit itself holds the files earlier exchanges wrote
(see 0.2). The reviewer then judges the existing scope files "criterion by criterion. There is no benefit of the doubt."

**09-26 early (git: `7bf79a5`, `bb51bbe`, `69f65f2`).** Task 4's tests were the *only thing missing*: the reviewer repair
`7bf79a5` (05:10) said "the worker has written tasks 1-3 tests but never added the Task 4 tests… there are no Task 4
assertions to fail and fix", and added all of them in one 264-line block (due-trigger and repeat refusal, five
refusal-before-execution variants, two retry guards, no-real-systems assertions). The worker's `bb51bbe` then maps every
acceptance criterion to those tests and ends "ALREADY SATISFIED". `69f65f2` produced the 302-line review packet. Phase 57's
code work was done at 05:43 on 09-26.

### Steps back in this era

| What | Fix | Where |
|---|---|---|
| Reviewer accepted an installer with 6 undetected defects | rewrite briefs with executable fact-check; reviewer re-runs checks | HANDOFF 09-24 03:37 |
| Resolution note wasted: same repair resubmitted in 3 s | a reviewed repair checkpoint is consumed by any verdict | same |
| Silent no-op READ of a file already in view | notice added; repetition gate counts consecutive identical turns | HANDOFF 09-24 23:22 |
| "inference timeout" charged as a worker failure | routed to `worker_timeout` | same |
| Memory-pressure stop spent task 2's last attempt | `recoverableRuntime` + host-side recovery | HANDOFF 09-25 04:12 |
| Unfinished work wiped on resume (23/24 tests passing, discarded twice) | keep the task's own in-scope dirty files | HANDOFF 09-25 07:40 |
| Whole-file rewrites took 7-11 min each | `### EDIT` hunks | HANDOFF 09-25 14:12 |
| App hid *why* Start was disabled | message in `ProjectTab.swift` | HANDOFF 09-25 03:40 |
| Repeated writes over existing exports | overwrite guard + survey | HANDOFF 09-25 18:43 |
| No handoff entry for a 40-minute edit session (Astra) | Claude documented it retroactively | HANDOFF 09-24 23:22 |

### Lessons

1. **A 27B local model is slow at output, not at thought.** The fix for "stuck" was not a smarter model; it was reducing
   what must be typed (EDIT hunks) and bounding what must be read.
2. **"Stuck" and "slow" are different failures and need different routes.** Five of the defects above are misclassifications:
   a timeout charged as a failure; a green checkpoint called stuck; a resource stop charged as a failure; a repair resubmitted
   as new work. Each wasted an attempt or woke a human for nothing.
3. **A reviewer that takes the author's word is not a reviewer.** The wrong installer was "accepted" at review once before
   check re-runs and named test scenarios existed.
4. **Write the brief as if the worker cannot ask.** The rewritten briefs gave exact signatures, line numbers, test recipes
   and "traps" from real mistakes, and fact-checked them by running a throwaway implementation.
5. **Count what you can trust.** HANDOFF says "236/236 agentic" on 09-25 18:43 and "144/144" and "157/157" on 09-26. These are
   different invocations of the suite (**(inferred)**: whole `tests/agentic-*.test.mjs` vs a filtered subset); the numbers are
   not a regression.

### Walk it yourself

```bash
sed -n 1253,1300p HANDOFF.md                                  # 09-24 00:04 and 09-23 entries
grep -n "^## 2026-09-2[45]" HANDOFF.md                        # find the defect-list entries
sed -n 1,40p scripts/lib/agentic/edits.mjs                    # the EDIT mechanism
sed -n 100,160p scripts/lib/agentic/existing.mjs              # overwriteRisk
git show 7898699 d7286b2 --stat                               # the two reviewer repairs of task 1 and task 2
git show -s --format=%B d7286b2                               # "the reviewer supplied no diagnosis"
```

### Questions to ask your tutor

1. Explain, with the 09-25 14:12 numbers, why a whole-file write is a throughput problem for a local 27B model.
2. Why is a resource-pressure stop a "recoverableRuntime" rather than a worker failure, and who handles it (host or model)?
3. What does `overwriteRisk` refuse, and why is "lowers a file's test count" a good signal that a worker is destroying work?
4. Why does `commitAlreadySatisfied` make an *empty* commit rather than skipping the checkpoint?
5. How did the project verify that a brief's claims were true before giving it to a model?


---

## 5. Era 4 — The Phases 40–52 batch (09-26, 00:47)

*Commit: `9855d99` (85 files, +3,946/−215). Report: `docs/planning/v2/PHASES_40_52_BATCH_REPORT_2026-09-26.md`.* A single large human-driven commit in the middle of a machine-driven week. It is the only phase-closing batch in this range; every other "phase" in the range is an **investigation packet** (Era 5).

### What was built

Under the `AGENTS.md` ten-phase batch protocol (review, repair, batch report, local commit, no push), Nick asked for "the next 10 phases" and Claude took phases 40 to 52. The report's state table, verbatim in meaning:

| Phase | State | In one line |
|---|---|---|
| 40 | closed | ORION re-homed to London (`orion-timezone set Europe/London`, live). |
| 43 | closed | Owner re-authentication (Touch ID or password) to release a lock or relax a mode. |
| 44 | closed | Its requirements already passed; its entry opened when 43 closed. |
| 46 | closed | Cancel a running action from the phone or Mac; optional arguments shown to the model; timeout retry. |
| 47 | closed | Deletions recoverable from the Trash, proven against the real `~/.Trash` through the installed plugin; `scripts/orion-undo`. |
| 48 | open | Per-turn binding passed; plugin tamper protection is "not a prevention"; broker and signing blocked on Nick. |
| 49 | open, not started | iPhone approval with Face ID and device-key signatures. |
| 50 | requirements pass | Delegations carry resources (`orion-mode --within`). Cannot close until 49 does. |
| 51 | requirements pass | The bare `git` allowlist entry is retired. Cannot close until 49 and 50 do. |
| 52 | built, flag off | `terminal_run` with in-app Allow once / Allow for this chat / Deny. `enableRawTerminalActions` is off. |

Design decisions quoted from the report, with the rejected alternative where one is named:

* **Cancellation (46):** a cancel mark is checked before every step; "the step in flight finishes, because a half-killed step is the one state the repair engine can't reason about", except `terminal_run`, which is killed. Rejected: killing any step mid-flight. Timeout retry only for reads and set-to-a-state actions: "A toggle retried after a timeout undoes itself."
* **Trash recovery (47):** `orion-undo` "never overwrites, is audited, and is a person's tool: it is not on ORION's allowlist."
* **Integrity (48):** SHA-256 manifests in `~/.openclaw/orion-gate/integrity`, written only by the installers; launchd starts the bridge through a verifier kept outside the copy it guards; the plugin checks itself at load.
* **The broker (48) was deliberately not built as code.** "A broker running as the same macOS user adds no boundary. It needs a second macOS user, or a `sandbox-exec` profile around the gateway. Both are admin changes, so they are Nick's call."
* **Raw terminal (52):** one zsh command per approval, 2-minute limit, 20 KB output cap, Stop kills the process group. Nick's decision replaced Face ID with an in-chat choice.

### The independent review found a live hole

"A reviewer that saw only the code and the source requirements found: 3 CRITICAL, 6 HIGH, 7 MEDIUM, 5 LOW." The most serious, **C1, was live before the batch**: the Desktop root contains the repo, and `desktop_file_write_explicit` needs no approval, so **ORION could rewrite `scripts/orion-remote` (on his exec allowlist) or `scripts/orion-approve` (what the app's Allow button runs) with no approval at all**. Repaired with `protected-paths.ts` (no file action may write, move, rename or delete under `~/Desktop/ORION`, `~/.openclaw` or `~/Library/LaunchAgents`, and moving a folder that contains one is refused too). The other repaired findings: the approval card never showed the command or file (C2), one approved command could grant itself standing shell access (C3: `terminal_run` runs under `sandbox-exec` with a minimal environment and redacted output, chat grants capped at 8 hours), Stop re-ran the command (H1), commands copied from a web page ran under a chat grant (H2: `command` and `cwd` are now taint-checked), one approval could run twice (H4: the rename that spends the grant is the gate), and a check inside the plugin cannot catch the plugin being replaced (H5: requirement marked *blocked*, honestly). Not changed because it is a live config change that needs Nick's yes: bare `env` and `find` on the main exec allowlist (H6).

One test per repaired finding lives in `plugin/orion-control/src/review-repairs.test.ts` (9 tests). Proofs: plugin 374/374; `orion-deploy` all seven suites; `orion-undo --live` through the installed plugin; secret scan clean.

### A process wrinkle: what was held back

The commit message says: "Held back (deployed, uncommitted): scripts/orion-remote, orion-remote-bridge, orion_v2_remote_check.sh, orion_v2_ci_check.sh — the batch's `action` verb shares hunks with earlier uncommitted Discord/agent work." Files that were **deployed to Nick's Mac but not committed** is a state that cost trouble on 09-30; they were committed in `c2eda84`.

### Steps back and lessons

* **Phase 48 "plugin tamper protection" went from claimed to blocked** during review: a self-check cannot prove its own integrity. The gate record says so; PHASE_GATES is not "closed" for it.
* **A live vulnerability found only by an *independent* review.** Claude wrote the batch and a reviewer that "saw only the code and the source requirements" found C1. This is the Phase 32.5 charter's review rule paying for itself. The same rule had not been applied to the loop's own reviewer (Era 3), which is why it accepted broken code.
* The batch closes only **five phases** (40, 43, 44, 46, 47) out of the "next ten", and the report says why for each. That is the correct outcome under the gate protocol; the program counts *evidence*, not effort.

### Walk it yourself

```bash
sed -n 1,30p docs/planning/v2/PHASES_40_52_BATCH_REPORT_2026-09-26.md
ls plugin/orion-control/src | grep -i "protected\|review-repairs"
git show --stat 9855d99 | head -40
```

### Questions to ask your tutor

1. Why can a broker running as the same macOS user "add no boundary", and what two designs would?
2. What exactly does `protected-paths.ts` forbid, and why was it needed even though the file action needed no approval?
3. Why is `orion-undo` deliberately not on ORION's exec allowlist?
4. What is the difference between a requirement marked *blocked* and one marked *passed* in `PHASE_GATES.json`, and why is H5 marked blocked?

---

## 6. Era 5 — Qwen writes the roadmap packets and Phase 58 history (09-26 – 09-27)

*Commits: `cb26fea`, `d8115bc`, `e347f55`, `9c36b1c`, `3407596`, `6da2009` (Phase 58 history, 09-26 06:06–07:01); the packets `99bc119` … `fd4fa9c` (34 phase packets) and `88bed63` … `b07ba75` (6 vision packets), 09-26 12:22 to 09-27 05:30; repairs `4ce3f1e`, `4a3f175`, `ddcb950`, `1a137b4`, `1d7b475`.* This is 52 commits of Qwen's, and the lesson of the era is what the commits *are* and *are not*.

### What was built

**Phase 58 history (6 tasks, ~1,025 lines).** The overnight chain launched at 04:37 BST on 09-26 first relaunched `advance-orion-capabilities` for its last two tasks, then, if the first run was not halted by an operator, started the new project "Automation history" (`docs/agentic/plans/automation-history.md`). It targets Phase 58's last open requirement, `uses_historical_data_where_available`:

| Task | Commit | Output |
|---|---|---|
| `hist-ledger` | `cb26fea` | append-only automation history ledger (`scripts/lib/orion-automation-history.mjs`) |
| `hist-summary` | `d8115bc` | `summarizeAutomationHistory(entries, {from, windowDays})`, pure, half-open window |
| `hist-runtime-record` | `e347f55` | `runInstalledAutomation` records every dispatch outcome (guard: `result.reason !== "not_due"`) |
| `hist-cron-deliver` | `9c36b1c` | `scripts/orion-cron-deliver` keeps an outcome history (v, at, label, outcome, exitCode only; never message text) |
| `hist-forecast` | `3407596` | simulation uses history where it exists (`withHistory`, `NO_HISTORY_NOTE`) |
| `hist-review-packet` | `6da2009` | Phase 58 history review packet |

The plan's brief facts were "prototyped on a `git archive HEAD` copy", including that cron-deliver tests stay off Discord under a temp HOME. Tasks 3 to 5 (`e347f55`, `9c36b1c`, `3407596`) ended "ALREADY SATISFIED".

**The full-roadmap investigation (Astra's plan, Claude's fixes, Qwen's output).** On 09-26 Astra transferred "the full roadmap" to the offline model: `docs/agentic/plans/orion-full-roadmap.md` plus 41 briefs, "40 executable documentation contracts: one for each of 34 non-complete phase records, plus six cross-cutting original-vision packets". These **investigate source and propose small implementation contracts; they do not implement features or grant blanket authority.** Outputs go to `docs/planning/offline-roadmap-results/` (40 files).

Claude made it runnable on 09-26 11:44 (HANDOFF): (1) the brief no longer tells the worker to READ `PHASE_GATES.json`, which is **553 KB** while READ truncates at 90,000 characters, "before phase 34, so the worker would have got about 22k tokens of the wrong phases" (each brief already embeds the phase's gate record); (2) the only check is now `doc-report` (`scripts/lib/agentic/doc-report-check.mjs`, registered in `checks.mjs`), replacing `node-syntax`, "which never ran on Markdown". `doc-report` fails a report that is missing any of the six required sections, omits any of its phase's requirement ids, or cites a repository path that does not exist before "Smallest next slice".

The six sections of a packet are the contract: baseline, requirement matrix, architecture and interfaces, smallest next slice, test scenarios, gates and handoff.

### The 09-26 15:51 escalation: why the run stopped at 2 of 40

Phases 48 and 49 were accepted. **Phases 50 and 51 spent every exchange of three attempts on READ and SEARCH and never wrote their report.** The reviewer declined to repair them, both tasks were deferred, and the recurring `worker_stuck` raised a run-level `repeated_failure`. Claude's fix (HANDOFF 09-26 15:51):

1. Every brief's exchange plan now says to **write the report skeleton with FILE in exchange 1** (six sections and every requirement id), then EDIT at least every two exchanges.
2. `common.md` gained a "Write first" section.
3. `worker.mjs`: a worker that has written nothing by half its exchanges is told to write now, and a `worker_write_nudge` event is emitted (with a supervisor test that fails without it).
4. `rebrief` refreshed 38 unfinished tasks; the three escalations were resolved; the run relaunched.

The `4ce3f1e` repair (09-26 14:15, phase 49) is the visible symptom: "The worker repeatedly truncated the report before completing the mandatory 'Test Scenarios' and 'Gates and Handoff' sections", so the *reviewer* appended them (103 lines).

### What the packets are, honestly

* **34 phase packets** (48–53, 56–75, 77–84; **(inferred)** Phases 54, 55 and 76 had no open work, since 76 closed on 09-17 per HANDOFF and 54/55 are absent from the plan) and **6 vision packets** (`vision-daily-experience`, `vision-connected-foundation`, `vision-attention-communications`, `vision-knowledge-finance`, `vision-voice-environment`, `vision-release-recovery`).
* Each is one Markdown file of 35–150 lines. Claude's 09-27 review sweep says it directly: "**many roadmap reports are thin (38–60 lines against the 100–180 asked for).**" Of 126 requirement statuses, "none over-claims against PHASE_GATES; one is conservative."
* Four **correction tasks** were needed: `1a137b4` (phase 66 test scenarios), `1d7b475` ("Verify cited symbols exist at worktree baseline before marking Built", phase 70), `4a3f175` (a reviewer repair of the finance packet: "The finance freshness seam producer row says '(assumed)'… the worker kept searching without committing to the explicit unknown marker") and `ddcb950` (a state-ownership contradiction: the packet claimed `backend/memory/store.py` owned durable state when `SessionDomain` does). Plan total: 44/44 accepted (40 planned + 4 corrections; merge `33dbcae`).
* Most packets conclude with an **evidenced blocker**: phase-order gates, native checks not registered, or "Nick-only decisions", which is exactly what the PLAN_STANDARD asks a docs task to do when it cannot prove more. The `phase-NN-packet` commits did **not** move any phase gate; they feed the Product Vision Delivery plan (`docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`) and the later recovery gates.

### Review fixes on Qwen's branches (09-27 22:21 and 22:22)

Claude swept all four Qwen branches on 09-27 and found two real defects (`HANDOFF.md`, 2026-09-27 22:23):

1. **`a76bd9e` (attention):** `orion-attention-collect` put full **error text, including local file paths,** into the Today feed and digest outages. They are now source names only, and `buildTodayFeed` reduces objects to their source. About 20 lines of leftover model reasoning comments were removed.
2. **`4a2816d` (history):** `orion-cron-deliver` recorded "silent" *before* the silence check, so every delivered run wrote two history lines. Fixed, with a test "each run records exactly one outcome" that fails on the old code.

Then four `--no-ff` merges at 23:27: `58af930` (Phase 57 installer, 7/7), `636036b` (Phase 58 history, 6/6), `33dbcae` (packets, 44/44), `efcdac9` (attention and ops, 32/32). No file overlapped the dirty tree; "merged tree: 296 automation/attention/ops tests and 224 agentic tests pass, CI is OK, secret scan clean" (HANDOFF 2026-09-28 09:33).

### Steps back

| What | Fix |
|---|---|
| 553 KB gate file truncated: worker would see the wrong phases | brief no longer says READ it; gate record embedded per brief |
| `node-syntax` "never ran on Markdown" | `doc-report` check |
| Phase 50/51 packets: 3 attempts all on READ/SEARCH, no write → run-level halt at 2/40 | write-first skeleton, `worker_write_nudge`, rebrief |
| Phase 49 packet truncated before required sections | reviewer repair `4ce3f1e` |
| Packet cited unproven file as "(assumed)" | repair `4a3f175`, correction `ddcb950` |
| cron-deliver recorded two outcomes per run | `4a2816d` |
| Collector leaked local paths into a user-visible feed | `a76bd9e` |
| `orion-remote-install` left the bridge stopped on its first run, twice | second run fixes it; "a task chip has been filed" (HANDOFF 09-26 15:51). **Still open at the end of the range**; Era 7 records it fixed on 09-28 |

### Lessons

1. **A model asked to "investigate" will keep investigating.** The fix was to make the deliverable exist from exchange 1 and edit it. This is the same insight as Era 3's `### EDIT`: control the shape of the work, not just the model.
2. **A docs check needs a purpose-built validator.** `node-syntax` on a Markdown task is a check that cannot fail; `doc-report` makes the six sections and the requirement ids machine-checkable.
3. **Volume is not value.** 40 packets is a count, and the review says "thin". The accepted measure is the downstream use: Era 6's attention engine was *designed by Claude from the packets' blockers*, not copied from them (HANDOFF 09-27 09:50: "Its packets mostly ended in evidenced blockers… so the new plan was designed, not copied").
4. **Check what an "ALREADY SATISFIED" commit proves.** It proves the criteria are met by something in the repository; it does not prove that something was written by this task.

### Walk it yourself

```bash
ls docs/planning/offline-roadmap-results/ | head -50
sed -n 1,60p docs/planning/offline-roadmap-results/phase-52-packet.md
sed -n 1,60p scripts/lib/agentic/doc-report-check.mjs
git show -s --format=%B 4ce3f1e 4a3f175 1d7b475
sed -n 645,665p HANDOFF.md        # the 09-26 15:51 escalation entry
```

### Questions to ask your tutor

1. Why does a 553 KB file defeat a worker whose READ truncates at 90,000 characters, and what was the fix?
2. What does `doc-report` check, and what class of worker failure did it replace?
3. Why were the 40 packets "thin" and is that a failure of the model or of the brief?
4. What is a task-level deferral (`deferred: true`), and why did two deferrals still halt the whole run?

---

## 7. Era 6 — The attention engine, ops tools and the review sweep (09-27)

*Commits: `3e21314` … `c05c88e` (32 Qwen commits, 09-27 09:52–14:50), `59b1aa2`, `dd8f168` (reviewer repairs of the review packet), `a76bd9e`, `4a2816d`, the four merges.* 56 commits on 09-27, more than any single day in the 02b range (the busiest there was 34 on 09-01).

### What was built, and why

HANDOFF 09-27 09:50 is the design note: the roadmap run finished 44/44, and its packets "mostly ended in evidenced blockers", so Claude **designed** a new plan, `docs/agentic/plans/attention-and-ops.md`: 30 tasks (32 including two repairs), "17 of them independent. Every written path is new, so nothing collides with the dirty checkout." Launched `--until-stopped` as `project-f9a223a3-…`. Not wired on purpose: live readers, a schedule, delivery, the Swift Today surface. Fixtures only.

**The attention engine** (`scripts/lib/attention/`, 997 lines of source plus tests, Phases 59/63/64) is a pipeline of small pure functions:

| Stage | Module | Rule |
|---|---|---|
| item shape | `item.mjs` | exact signal key set `urgency, actionability, novelty, confidence, importance, interruptibility`, each `null` or in [0,1] (`ATTENTION_SIGNALS`, `item.mjs:2`) |
| urgency | `urgency.mjs` | step function of hours to due: ≤0 → 1, ≤1 h → 0.95, ≤6 → 0.8, ≤24 → 0.6, ≤72 → 0.4 …; `null` if no due time |
| novelty | `novelty.mjs` | from how many times the same `dedupKey` surfaced in 7 days |
| score | `score.mjs` | weighted average with `DEFAULT_WEIGHTS` urgency 0.30, importance 0.20, actionability 0.15, confidence 0.15, novelty 0.10, interruptibility 0.10; **"unknown is never zero"**: `null` signals are dropped and weights renormalised, and fewer than 3 known signals returns a `null` score (unranked) |
| dedup | `dedup.mjs` | keep the newest per `dedupKey` |
| gate | `gate.mjs:16` | six rules in order, first match wins (below) |
| queue | `store.mjs` | durable file, atomic temp+rename, mode 0600 |
| sources | `sources/calendar|waiting|focus|manual.mjs` | calendar "starting soon", overdue/due-today waiting-ons, a gentle "no focus yet" item, CLI-entered |
| rank / explain | `rank.mjs`, `explain.mjs` | now / later / dropped, and a sentence for why |
| budget | `budget.mjs:10` | `canInterrupt(ledger, now, {maxPerHour: 2, maxPerDay: 8})` |
| collect / feed / digest | `collect.mjs`, `today-feed.mjs`, `digest.mjs` | gather from every source "naming outages", write the Today feed JSON, a short digest for voice or Discord |
| simulate | `simulate.mjs` | replays a day hour by hour through rank and budget |
| CLIs | `scripts/orion-attention`, `orion-attention-collect` | list/show/add/ack/snooze/prune; one pass end to end |

The gate's rules, from its header (`scripts/lib/attention/gate.mjs:3-12`):

```js
// scripts/lib/attention/gate.mjs:3-12
 * Rules apply in this exact order (first match wins):
 *  1. Expired -> drop, "expired"
 *  2. Unranked (score null) -> today, "unranked"
 *  3. Quiet hours + urgency < 0.9 -> today, "quiet_hours"
 *  4. Focus active/unknown + urgency < 0.9 -> today, "focus_active" or "focus_unknown"
 *  5. score >= 0.6 -> interrupt, "score"
 *  6. otherwise -> today, "low_score"
```

The point of this design (from the engine doc `docs/planning/v2/ATTENTION_ENGINE.md`, 130 lines, `c05c88e`): an item either **interrupts**, **files into Today**, or is **dropped**, and always says why. Unknown focus state *holds interruption back* (rule 4 treats `focusActive !== false` as active), which is the conservative failure direction.

**Ops tools** (Phase 60, 67, 74): `orion-costs` (`ba89a71`, `abfba59`: inference ledger summary, nearest-rank percentiles, cost rounded to 6 decimals), `orion-incident-timeline` (`087906d`, `93311b1`: one timeline from audit logs), `orion-focus-report` (`72c5bb2`, `8be51dd`: the week in focus), and remote-audit stats (`fa584c6`: what the remote channel was asked and refused). All fixture-driven CLIs with temp-directory tests and fixed clocks (`--now`).

### Steps back

* **The batch review packet could not be written by the worker.** `59b1aa2` (reviewer repair, 15:34): "The worker repeatedly produced an incomplete ATTENTION_AND_OPS_REVIEW.md: missing files (store.mjs, collect.mjs, calendar.mjs, orion-attention…), empty Verify section… The root cause is the worker never systematically enumerated all 56 new files from the diff." The reviewer wrote the whole 116-line document. Then `dd8f168` (16:52) rewrote its "Proven" section because "the worker kept rewriting descriptions instead of restructuring" to name tests. **A doc task that needs to enumerate 56 files from a diff is beyond what the worker's context can do**; the reviewer, who sees the diff, can.
* **Unused imports (`d738369`, `83e3637`, `b9fc452`) and `assert` calls in library code (`0604567`)** appear as one-line correction tasks. **(inferred)** These come from a reviewer rule: library modules throw `TypeError`, they do not `assert` (`0604567`: "replace assert calls with explicit TypeError throws"). The worker kept adding `node:assert` imports to library files that only tests should use.
* **The review sweep's two defects** (feed leaked local paths; history double-recorded). Both were *real behavioural bugs that all tests passed*, one found by Claude reading the code, the other by writing the "exactly one outcome per run" test.

### Lessons

* **Fixture-only first** is the correct way to build proactive behaviour: the engine can be simulated for a whole day (`simulate.mjs`) before anything touches a notification channel. The live wiring comes later (the life loop's watcher and the phone link).
* **Design for "unknown".** `null` signals are not zero, fewer than three known signals means *unranked*, and an unreadable source is *named* in the feed instead of silently skipped ("naming outages", `att-collect`).
* **Never put an error string into a user-facing feed.** Source names only (`a76bd9e`).

### Walk it yourself

```bash
sed -n 1,60p scripts/lib/attention/gate.mjs
sed -n 1,12p scripts/lib/attention/score.mjs
node --test tests/attention-*.test.mjs 2>&1 | tail -8     # read-only; runs only local temp-dir tests
sed -n 1,80p docs/planning/v2/ATTENTION_ENGINE.md
git show -s --format=%B 59b1aa2
```

### Questions to ask your tutor

1. Walk an item with `urgency = 0.95`, `dueAt` in 30 minutes, during quiet hours, through `attentionGate`. Which rule fires?
2. Why does `scoreAttentionItem` return `null` with fewer than three known signals instead of treating missing ones as zero?
3. What does the interruption budget protect against, and where would the ledger of interrupts be stored in a live version?
4. Why did the worker fail the batch review packet, and why could the reviewer do it?


---

## 8. Era 7 — The phone link and the life loop (09-28 – 09-29)

*Commits in git: the 21 life-loop commits of 09-29 (`7947249` … `e7a1f94`). The phone link, voice, widgets and the day's other Claude work (09-28 and the rest of 09-29) are in HANDOFF only, and enter git on 09-30 (Era 8).* 09-28 has no commits at all; it is nonetheless the day the project got a real phone.

### What was built on 09-28 (HANDOFF, committed 09-30 in `b59bdca` and `7724c43`)

**The phone becomes real.** The Simulator-only pairing shell (02b, Era 9) is replaced with a design where the iPhone talks to the Mac **through iCloud (CloudKit)**, chosen by Nick over Tailscale ("Nick chose CloudKit as the backbone, with Tailscale as an optional fast lane later", HANDOFF 09-28 09:33). He joined the Apple Developer Program as an **Individual**; the iPhone (an iPhone 16) was paired, put in Developer Mode and registered, "the WWDR G3 intermediate was missing (only the 2023-expired one was present), and Nick installed it". The first install of `OrionPhone` on a real device happened this morning, with a provisioning profile that runs to 2027-09-28.

The design (HANDOFF 09-28 10:00), contract `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift`:

* iCloud container `iCloud.com.nickmadaio.orion`, private database, zone `OrionLink`.
* Record types: **`MacState`** (one record, the JSON snapshot, written every ~30 s or on change), **`LinkCommand`** (written by the phone; the Mac fills status and reply), **`LinkAlert`** (written by the Mac for each new approval request; triggers a push).
* **Every command is text in `orion-remote`'s grammar**: it runs as `handle --from phone --id <record> --at <ms>` with `ORION_REMOTE_ALLOW=phone`, "so the lock, replay, rate and verb rules apply exactly as for Discord". The phone reuses the existing security perimeter instead of building a new one.
* Mac side `native/OrionLink` (SwiftPM `LinkCore` plus a menu-bar helper, bundle `com.nickmadaio.orion.link`). On 09-28 10:29 the helper was **embedded into `Orion.app`** as a login item (`Contents/Library/LoginItems/ORION Link.app`) "without a permission reset": Orion keeps its local signing identity so its designated requirement is unchanged and every TCC grant, including Full Disk Access, is kept.
* Obstacle on the way: a ~15-minute wait for Apple to link the container to the Mac app (`CKError 10 / internal 2007 "Invalid bundle ID for container"`).
* By 09-28 11:16 the phone could chat (messages become `LinkCommand`s the Mac hands to ORION's brain), log water/meals/supplements into the Mac's `health-log.json` using the plugin's lock protocol, and request "Plan my day / Replan / Undo" through a `today-plan-request.json` file the Mac app consumes.
* **Mac Home restored**: "the pre-Astra version again (orb, orbiting Quick Open apps, parked brief rail); tab renamed back to 'Home'. Astra's Today plan moved to the Tasks tab as a compact 'ORION's plan' panel." This reverses Astra's product-route decision of 09-07 to 09-14 (02b, Era 7): the Today view stayed, the *Home* replacement did not. A concrete example of Nick overruling a prior assistant's design.
* Fixes found on the way: **`orion-remote-install` raced bootout/bootstrap and left the Discord bridge unloaded while printing success** (now waits, retries, fails loudly; this closes the 09-26 open item); the ORION Link helper **kept running old code after app updates** (now `PhoneLink.ensureRunning` restarts a helper older than its binary).
* Installed Orion build 374; rollback copy `/Applications/.Orion-previous-374-pre-tracking-20260928.app`.

### The life loop: Qwen starts, Nick stops it for class, Claude finishes (09-29)

On 09-29 03:23 Nick saved his "v1 list and mission statement" to `docs/vision/ORION_PURPOSE.md` (priorities: classes > sleep > gym > deadlines/study > at least one hour of side project daily > other > rest) and handed the **decision logic** of an executive-function assistant to Qwen: project "Life loop" (`project-992584c3…`, 19 tasks, `docs/agentic/plans/life-loop.md`), pure modules under `scripts/lib/life/`: block shape, priority, weekly expansion, daily needs, free gaps, study request parsing and fitting, sleep state, bedtime ladder, follow-through escalation, deferral classifier, after-late-night replan, patterns, sync event/merge/apply, next action, CLIs `orion-next` and `orion-study`, a review packet. Kept for Claude: "wiring, phone voice, voice, the Swift".

What actually happened (commit order, `7947249` at 03:29 and then nothing until 11:47):

| Phase | Commits | Notes |
|---|---|---|
| Qwen, 03:29 | `7947249` `life-block` | one task done, then Nick **stopped the run for class** (`agent stop`) |
| Qwen, 11:47–12:28 | `a9e5e43` priority, `b8a2e21` weekly, `99620b4` daily needs, `7ddf825` gaps, `5bc82b0` study-parse, `383d1e0` study-parse fix | six accepted plus one correction: "unknown subject preserves original casing" |
| Nick's hand-over, 13:43 | thirteen `claude(life-*)` commits (`dd9aa26` fit-study … `b913b18` review packet), **all stamped 13:43** | "Nick: just take over all of qwen's work. mark it as done in orion aswell." |
| merge, 13:47 | `e7a1f94` | "qwen 7 accepted, Claude 13 after hand-over; 112/112 tests" |

Two things to know about that table:

* The thirteen Claude commits carry **one identical timestamp** and one identical body line ("Built by Claude after Nick handed the Life loop over from qwen (2026-09-29)"). They are a batch re-commit of work done sequentially, then split one-per-task so the history matches the plan, on the same branch `orion-agent/21eb0d9f` **(inferred from the HANDOFF 13:45 entry, "one commit per task")**. Do not read the timestamps as thirteen separate hours of work.
* The run state was *invalid* after the hand-over: HANDOFF 2026-10-01 06:45 records "its state was invalid after the 2026-09-29 hand-over (13 accepted tasks still carried review evidence). Cleared, and it validates as completed 20/20. Backup: `state.json.bak-20261001`." Marking a run complete by hand corrupted the controller's evidence invariant; it took until 10-01 to repair through the runner's own library (`resolveProjectEscalation`, `mutateProjectAgent`, `acceptProjectFinalReview`).

### Wiring (Claude, the rest of 09-29, committed in `37c29fd` on 09-30)

The pure modules were wired to Nick's real calendar in the same afternoon:

* `scripts/lib/life/live-day.mjs` reads the real calendar through the Mac bridge; `orion-now` (next action, sleep plan, phone signal, side-project hour, open check-ins); `orion-plan-study` (real free slots to a deadline); `orion-patterns` (sleep log, phone signals, WHOOP: "14-day avg 5.6 h sleep, 4 red days"); **`orion-checkin`** (the follow-through loop plus the deferral classifier; state `~/.openclaw/orion-controlled/checkins.json`).
* **Moving the day** (HANDOFF 09-29 14:45): the bridge gains `move_calendar_event`; blocks ORION creates carry an `[orion:<kind>]` marker in the title; `lib/life/replan.mjs`; `scripts/orion-reschedule late|busy|add|day|fill|undo`, with a lock and an undo journal. Commas are used in plan strings "because exec reads `|` as a pipe". People and classes are fixed; study, gym, games, rest, errands, chores, side projects and meals alone are movable.
* `scripts/orion-watch`, run every 5 minutes by the ORION app (`LifeWatch.swift`): asks about an empty day in the morning and right after the last class; after a short night (under 6 h WHOOP or a late "bed") reshapes the morning (a nap, early work later) and tells him.
* **Check-ins and Focus lock**: pushes carry Started / 10 more min / Done answered through the link to `orion-checkin`; ignored check-ins at level 3 engage the phone's **Focus lock** (FamilyControls individual authorization) on apps Nick picks, released on Started/Done or after 45 minutes.
* **Late nights** (phone `NightPlan`): a real plan through bedtime moves bedtime after it plus 30 minutes and drops wind-down; being seen awake after bedtime moves the alarm later automatically ("Monday example: up till 03:00, Macro 13:30 → alarm 11:15").

### Claude's other work on 09-29 (all committed on 09-30)

The 09-29 HANDOFF entries (03:23, 03:40, 03:55, 04:25, 13:45, 14:00, 14:45, 15:42, 20:55, 21:12) show a day of broad hardening:

* **03:40: "Mac voice was dead for three weeks"**: the TTS daemon stopped on 09-07 and nothing restarted it (launchd cannot run `~/Desktop` code). New `scripts/orion-tts-install` runs a copy from `~/.openclaw/orion-tts` under launchd (KeepAlive). Also `orion://show/<tab>` and `scripts/orion-show` (ORION can switch Mac tabs), `scripts/orion-runs` (read-only run status: "ORION kept saying he couldn't see the coding run").
* **Finding for Nick** (03:40): "the brain is `anthropic/claude-haiku-4-5` with thinking off (Sept: 347 of 349 replies). This is the main cause of weak conversation and flaky tool use; upgrading is a cost decision (USER.md budget $0–10/mo). Each turn also carries ~240k cached tokens of context." Corrected in 03:55: "~15k tokens base per model call (instructions + 35 tool schemas) growing with conversation; the '240k' was a multi-step turn's total."
* **03:55: phone night routine and offline ORION**: `NightRoutine.swift` (bed = min(latest bedtime, first calendar event tomorrow − get-ready − sleep need); wind-down and bedtime notifications; AlarmKit wake alarm), `OfflineBrain.swift` (when the Mac is not online, chat goes to Apple's on-device Foundation Models with tools), and phone signals (`PhoneSignals.swift`: motion, charging, place rounded to ~100 m; off by default). **Bug caught**: the mic/speech usage strings had not been written (a replace with count 0), "the mic would have crashed the app".
* **04:25: 59 real turns through `orion-remote`** (isolated `orion-eval-life-*` sessions) found "first batch 7/12; after fixes 10/12 and 8/10". The headline failure: *"fabricated 'Done. I'll wake you at 7:30' (no tool)"*. Fix: `orion-wake` plus the **truth check** in `orion-remote` ("a claimed action or inability with zero tools is re-asked once; missing toolSummary = zero, found when it never fired"). **This is the seed of the whole 'ORION truthful' theme.** Also found: the offline brain "invented reminders and times and re-logged food", so it was redesigned: actions come from plain rules, schedule/sleep/next answers are fixed text from real data, "the model only chats".
* **15:42: widgets (Mac + iPhone)**: a long list (hologram, Event Horizon, Command Center, Now & Next, Today, To-dos, Projects, Check-in, Day Rings, Tonight, Countdown) sharing `MobileCore/Glance.swift` (`OrionGlance`). Nothing on the phone yet: "device build fails with 'No Accounts' — Xcode has no signed-in developer account". **Model decision**: stay on Haiku 4.5 ("measured week incl. evals ≈ $1.57 → ≈ $7/month; Sonnet for every turn ≈ $20, over the $0–10 budget"), but truth-check retries (fake "done", false "can't", silent turn) re-ask on `anthropic/claude-sonnet-5` (`ORION_ESCALATION_MODEL`, `scripts/orion-remote:700`, "off" disables; config backup `openclaw.json.pre-escalation-20260929`).
* **20:55: voice fixed (Mac and phone)**. Root causes documented: the Keychain read on the press path (a locally-signed rebuild made every key read a hidden prompt → "26 s freezes / 'NO KEY'"); mic died on device changes; **self-echo** (ORION hearing his own voice: `MobileCore/SelfEcho.swift` plus `BargeInPolicy`); voice ID "dead since 31 Jul" (hand-started only). TTS "Flash model slurred '8:14 PM.'" → `spoken_times()` in `orion_tts_daemon.py` writes clock times as words. 60 scenarios run, side effects undone.
* **21:12: Qwen project "Tighten ORION"** imported (`docs/agentic/plans/tighten-orion.md`, 8 standalone modules: reply-lint, claims, eval-grade, lateness, deadline-ramp, plan-parse, morning-brief, distraction), "not started: Nick turns Qwen on".

### Steps back in this era

| What | Fix |
|---|---|
| Qwen's life-loop project stopped mid-run (Nick left for class) | Claude took over all 13 remaining tasks; run state corrupted, cleared 10-01 |
| Mac voice dead since 09-07, no one noticed | launchd-installed TTS daemon; doctor reports `responding, engine=mlx-warm` |
| Phone: mic usage strings never written | caught in the built Info.plist; "all six usage strings verified" |
| ORION invented "Done, I'll wake you" | `orion-wake` + truth check (re-ask once) |
| Offline model invented reminders and re-logged food | rule-based actions, model chats only |
| Episodic auto-capture saved the *transport brief* as Nick's words (5 junk memory entries) | `episodic.ts nickWords()` + test; entries removed |
| Mac Home replaced by Astra's Today view | Home restored; Today moved to Tasks |
| Device build "No Accounts" | Nick to sign in to Xcode; **(inferred)** resolved by 09-30, since HANDOFF 10-01 reports the phone installed |
| `orion-weather-alert` run to answer "umbrella?" **posted to Discord** | described as SENDS in the tool list (HANDOFF 21:12) |

### Lessons

1. **Wiring is most of the work.** The 19 pure modules were done in a day; the wire-up to a real calendar, a real bridge, a real phone and a real clock took the rest of the week and found most of the bugs (the scheduling era, §10).
2. **Run real scenarios, with undo.** The 59-turn and 60-turn runs went through the real route with isolated sessions and every side effect undone (events deleted by id, reminders deleted, health log restored from a copy under the shared lock). That discipline is what Era 9 relies on.
3. **A model that cannot say "I did not do it" will say "done".** The truth check is a harness response to a model behaviour.
4. **Tool descriptions are behaviour.** A tool described as a *read* but that *sends* (`orion-weather-alert`) gets invoked to answer questions.

### Walk it yourself

```bash
git show --stat e7a1f94 | head -45
git log --format='%h %ad %an %s' --date=format:%H:%M 7947249^..e7a1f94 | head -30
sed -n 454,470p HANDOFF.md                      # 09-29 14:00 and 13:45 entries
ls scripts/lib/life | head -60
node --test tests/life-*.test.mjs 2>&1 | tail -5   # read-only; uses a fake bridge
```

### Questions to ask your tutor

1. Why does every phone command run through `orion-remote handle --from phone` rather than a new API?
2. What is a `LinkCommand`, who writes it and who fills in the reply?
3. Explain the truth check: what is re-asked, on which model, and what counts as "zero tools"?
4. Why did the 13 Claude life-loop commits get one timestamp, and what does that say about reading history by time?
5. What exactly was invalid about the life-loop run state after the hand-over?

---

## 9. Era 8 — The backlog commit of 09-30, and a repo cleaned for readers

*Commits: `913b4b2` (10:23), `490d991`, `6e76273`, `37c29fd`, `c2eda84`, `a796471`, `5e29292`, `7724c43`, `b59bdca`, `1cf8796`, `faf8d4e`, `5e660de` (all 10:23–10:24), then `bc659a1`, `96ff75f`, `3a93ad2`, `a27103b`, `a17299f`, `fd4c88c` (20:27–20:37).* This is the **backlog checkpoint** of the era: from 09-01's "backlog checkpoint" (02b, Era 1) the working tree had again grown into thousands of uncommitted lines, and this time Nick asked for a push.

### Why it happened

HANDOFF 09-30 20:37: "Nick is putting the repo on his resume. An interviewer's first two impressions were clutter and a red CI badge (red since 3 September)." New standing rule in `AGENTS.md:140-150`: "Commit and push every finished piece of work" in logical groups, push the branch **and** fast-forward `main` (`git push origin HEAD:main`, never force), update README, add a HANDOFF entry, "No Co-Authored-By lines." Before the commit "the mixed dirty tree was secret-scanned: no keys; the only hits were refusal-test fixtures".

### The ten groups (10:23–10:24 BST, all on 2026-09-30)

| Commit | Group | Size | Contents |
|---|---|---|---|
| `913b4b2` | chore | 1 file | `.gitignore` for Xcode and SwiftPM per-user state |
| `490d991` | `feat(agentic)` | 51 files, +9,695/−397 | the whole local project-agent runtime: plans, briefs, supervisor, recovery, keep-awake, cancellation, project library, `orion-agent`, `orion-projects`, `orion-runs`, `orion-project-agent` |
| `6e76273` | `docs(plans)` | 140 files, +11,554 | agent work plans and task briefs: life loop, Tighten ORION, ORION truthful, attention and ops, automation history, the full roadmap |
| `37c29fd` | `feat(life)` | 37 files, +2,699 | the daily life loop: replanning, filling empty days, deadline study ramps, morning brief, short-night naps, commute buffers, lateness patterns, distraction rules, NL plan parsing, undo journal, nine CLIs |
| `c2eda84` | `feat(remote)` | 23 files, +2,491 | claim classifier and reply linter on the chat path, escalation on false claims, eval mode that blocks real sends (`orion-eval-run`, `orion-eval-grade`), declarative GET-only connectors with Keychain secrets (TfL, Canvas), finance summary, Shortcuts wrappers |
| `a796471` | `feat(voice)` | 5 files, +301 | TTS daemon and voice-ID installers, wake handling, self-echo guards, speaker verification floor |
| `5e29292` | `feat(plugin)` | 20 files, +809 | supplement edit/remove, episodic memory, task catalog updates |
| `7724c43` | `feat(mac)` | 42 files, +4,207 | project agent UI, `LifeWatch` timer, CloudKit phone link, Plaid finance export, widget glance export, voice fixes; calendar bridge gains event move/get, reminder completion and ranged listing |
| `b59bdca` | `feat(phone)` | 106 files, +10,425 | ORION for iPhone: chat, plan, health, focus lock, widgets, CloudKit link, offline answers, night routine, Screen Time monitor extension (nudge then lock), live presence, notification extension |
| `1cf8796`, `faf8d4e`, `5e660de` | docs | | handoff (+1,182 lines, `HANDOFF.md`), planning, vision, capability registry; **README rewritten** ("The old README described the superseded Python runtime as the product"); the commit-and-push rule |

Total of the ten groups: about 44,000 lines inserted (summing the diffstats above). After it, "`orion-v2/backlog-checkpoint` was pushed and `main` fast-forwarded to it" (`faf8d4e` is the head at that moment, per `AGENTS.md:149-150`). **This is the first time GitHub's `main` showed ORION's live stack** instead of the Python runtime.

### The cleanup and CI repair (evening, 20:27–20:37)

The new push exposed that CI had been **red since 09-03**. Six fixes (HANDOFF 09-30 20:37):

1. `bc659a1`: four sandbox-exec terminal tests skip off macOS (`it.skipIf`). The terminal tool runs inside macOS `sandbox-exec` under zsh; "GitHub's Linux runner has neither". (This commit also carries the cleanup's deletions; see 0.1.)
2. `96ff75f`: stale fixtures: remote-agent fixtures copied `orion-remote` alone though it imports from `scripts/lib`; automation-install validated a proposal expiring 2026-09-27 against the **real clock**, so tests that passed on the day they were written failed three days later; they now pass the fixed `NOW`.
3. `3a93ad2`: **rule 20** (a safety grep that flags calendar-cancel-like actions) flagged `supplement_remove` just because its name contains "remove"; it edits the supplement list. The check still fails on any health action naming the calendar, an event or a cancel.
4. `a27103b`: tidy: dead material to `~/Desktop/ORION-archive/2026-09-30/` ("nothing deleted; all still in git history"): the health-log race experiment, one-off research dumps, old live-run artifacts and `docs/planning/_archive`; the personal Obsidian vault `var/brain` **untracked and gitignored** (it holds personal notes; it stays on disk where `orion-note` writes); the original wishlist `capabilities.md` moved to `docs/vision/original-wishlist.md`; `docs/README.md` index; README repo map. **Kept on purpose:** `orion/` (the Python policy engine and capability registry; the deploy's registry builder and CI contract checks import it) and `backend/` (the v1 phone backend, imported by the schema and sync checks). The README describes both "for what they are now".
5. `a17299f`: the inventory and deferral checks read the plugin installed on the Mac at `~/.openclaw/extensions`, "which a runner does not have". CI points `ORION_CATALOG_DIST` at the committed `plugin/orion-control/dist`.
6. `fd4c88c`: the model-contract check treated a missing `~/.openclaw/openclaw.json` as DRIFT on a runner; it now reports "not checked here".

Proof: "all Node tests pass (746/746). Every CI step passes locally with `HOME` pointing at an empty directory to mimic a runner. Rule 5 (`raw_terminal` exists) is still reported, as before; CI marks that step continue-on-error."

### Also on 09-30 morning (Claude, HANDOFF 10:00 and 10:24, committed in the groups above)

* **Qwen "Tighten ORION"** escalated overnight (`deadline-ramp` worker_stuck on the cap/spill). Claude took over: brought the five accepted modules from `orion-agent/30a6ca83` (reply-lint, claims, eval-grade, lateness, plan-parse) into the tree and wrote deadline-ramp, morning-brief and distraction to their briefs; 205 Node tests; the `orion-remote` truth check now uses `claims.classifyClaim`, and every reply goes through `fixReply` (24-hour/mixed times, repeats).
* **Supplement failure (07:02)**: "combine" had no remove or rename, so ORION added two items and said "Combined". New `supplement_remove` and `supplement_update` actions plus an AGENTS rule: "combine = remove + add; done only if every part ran".
* **Connections** (`scripts/orion-connect`, `lib/connect/spec.mjs`): declarative GET-only connectors, one https host, Keychain secrets read only there, writes need `orion-connect-admin allow-writes`. Live eval: "ORION built a `crypto` connector himself in 15 s". Built-ins TfL (live) and Canvas (needs domain and a Keychain token "ORION Canvas").
* **Screen Time**: phone target `ScreenMonitor` (DeviceActivity monitor) + `ScreenWatch.swift`: work blocks nudge at 15/30 and lock at 45; after bedtime nudge 10/20 and lock 30; free time nudges 60/120 and never locks; lock only with Focus lock on.
* **Eval safety**: `lib/eval-mode.mjs` plus guards in `orion-discord-alert` and `orion-messages-send`; `scripts/orion-eval-run` (marker on during a run, always removed). Use it for all scenario runs, "a test answer to 'umbrella?' ran it and posted to Discord" had shown why.
* **Commute buffer** `scripts/lib/life/commute.mjs`: walls off 30 minutes before the first class and after the last. And a 5-task Qwen project "ORION truthful" imported (§12).

### Steps back

| What | Fix |
|---|---|
| CI red for 27 days (09-03 to 09-30) | the six fixes above; first green run is a side effect of this push |
| README described a dead product | rewritten |
| Deployed-but-uncommitted files from the 09-26 batch (`orion-remote`, bridge, CI scripts) | committed in `c2eda84` |
| Cleanup deletions swept into the wrong commit | accepted; documented in 0.1 |
| Personal notes in a tracked vault | `var/brain` untracked |

### Lessons

* **A red badge is a product defect when the repo is a resume.** The 27-day red CI had accumulated four independent causes, none caused by the others: a platform assumption (macOS-only tests), a hidden file dependency, a real-clock dependency, and a naive safety grep.
* **Tests that depend on the real clock fail later.** `96ff75f` is the cleanest example in this range: an expiry constant three days in the future of when it was written.
* **Commit early, in groups.** A ten-group commit of ~44,000 lines is still reviewable because each group has a purpose and a message body, but nothing could be bisected before it.
* **Hide personal data by default.** The vault was tracked in a repo whose visibility was about to change.

### Walk it yourself

```bash
git log --format='%h %ad %s' --date=format:'%H:%M' 913b4b2^..5e660de
git show --stat 7724c43 | head -50
sed -n 136,152p AGENTS.md
git show -s --format=%B a27103b a17299f fd4c88c
cat .github/workflows/ci.yml | head -60
```

### Questions to ask your tutor

1. Why did the author pass a fixed `NOW` into four automation-install tests, and what general class of bug is that?
2. What did rule 20 get wrong about `supplement_remove`, and how does the repaired rule still protect the calendar?
3. What is `ORION_CATALOG_DIST` and why does CI need it?
4. Why keep `orion/` and `backend/` in a repo whose live stack is TypeScript and Swift?
5. What would you check before pushing a mixed dirty tree to a public remote?


---

## 10. Era 9 — Scheduling rebuilt from Nick's real day (09-30 – 10-01)

*Commits: `4205b85` (09-30 13:32), `afe697b` (13:50), `752ac71`, `e7a6962`, `0f3f28f` (23:33), `936b695` (10-01 07:10), `1bcf4ad` (11:39). Continued in Era 11 (`2602593`, `3034d64`).* Every commit here is a reaction to something Nick saw go wrong on his actual phone or calendar. This is the era in which "the life loop" met reality, and the most useful one for understanding why the scheduler looks the way it does.

### The 09-30 incident (the reason for everything below)

HANDOFF 2026-09-30 23:33 describes it: "Soccer 5-7 was added to a day ORION had already filled. The two phone sessions (11:06–11:19, 13:16–13:18 BST) then went through repeated overlaps, 'did not fit' refusals, chains of undo that removed soccer, a crash in `--say`, and in the end a rebuild that put gym at 1 PM before soccer." Codex's 12:36 entry adds the mechanism: "repeated `orion-reschedule day` calls added new requests on top of the existing movable plan. Untouched blocks stayed by design, so the requested replacement could not fit; repeated fixed additions created two Soccer practice events. `day --say` then crashed on a bare hour (`Assignment to constant variable`). The model finally fell back to generic `calendar_event_remove`, whose irreversible delete correctly required per-event approval, and then fabricated `A-XXXX`…" (a fake approval id; the HANDOFF text is cut off in the source).

After that, Nick reviewed the test runs: **"why am i reading at 8 am, why am i doing my yt side project right after class with no getting back home buffer… the timing of things are terrible."**

### What was built, in order

**`4205b85` (Codex, 13:32): make day-plan replacement transactional.** "Route explicit whole-day rebuilds through one reversible scheduler transaction, clear stale and duplicate blocks, and recover cleanly from partial writes. Fix the natural-language time parser regressions exposed by the live phone session and update the installed phone guidance." `orion-reschedule day --replace` now replaces every future non-class/deadline block in a single undoable transaction; `scripts/lib/life/calendar-write.mjs` journals deleted event contents so undo can restore them, and rolls back partial mutations if a write fails. `orion-reschedule clear` is the narrower command. Live: the real day was recovered (13 stale/duplicate blocks removed), and "one `orion-reschedule undo` restores the prior calendar state."

**`afe697b` (Codex, 13:50, HANDOFF 13:43): "Adaptive rescheduling: incremental first, priority rebuild when needed."** Nick's clarification: "replacement is one tool, not the default. Normal changes should move only what needs moving; when the remaining day becomes impossible or badly tangled, ORION should rebuild it from the most important must-haves and then fill the gaps." Ordinary `day` stays incremental; if anything cannot fit it automatically retries as a **priority rebuild**; `--rebuild` requests that directly; `--replace` remains the explicit complete-new-schedule path. Rebuilds keep classes, deadlines and social/fixed commitments and work in progress. `plan-parse` carries must/high-priority/important language as importance 0 and maybe/optional language as importance 2 without polluting titles.

**`752ac71` + `e7a6962` + `0f3f28f` (Claude, 23:33): scheduling rebuilt.** The scheduler (`scripts/lib/life/replan.mjs`) was **rewritten** around three kinds of time (header at `replan.mjs:1-18`):

```js
// scripts/lib/life/replan.mjs:5-16
// Three kinds of time (rewritten 2026-09-30, after a day where soccer 5-7 went
// onto a full calendar and every attempt overlapped, refused, or put gym at
// 1 PM before soccer):
//   walls   — classes, plans with people, anything fixed. Never move.
//   pinned  — a time Nick said ("nap at 1"). Placed exactly there; ORION's own
//             blocks get out of its way. Only a wall can push it, and then just
//             past the wall, reported in `shifted`.
//   flexible— everything else, laid out in TIME ORDER (his stated order), each at
//             or after where he wanted it. Importance only decides what is left
//             out when not everything fits; it never reorders the day.
// What cannot fit is reported, never silently dropped.
```

Rules added in the same commit group:

* **"Importance only decides what is left out, never the order."** The earlier planner ordered by priority, which put gym at 1 PM before a 5 PM soccer.
* A stated time that cannot be kept becomes flexible and never bumps other blocks (`shifted`); `soft` walls (travel) guard flexible work but never override his time.
* **Sensible times** (`scripts/lib/life/sensible-time.mjs`, new, 28 lines at HEAD): untimed plans wait until he is home (last class end plus commute, or wake on a no-class day) and each kind has a natural time: evening for reading/relaxing (20:00), 17:00 for gym, 18:30 for dinner, lunch not before noon, a nap right after he is home.
* **Travel** (`commute.mjs`): plans away from home (soccer practice, nights out) get travel before and after. (HEAD adds a 2026-10-05 rule for a long gap between two classes; not in this range.)
* **`orion-reschedule` verbs** added: `drop "<title>"` (movable blocks, no approval, undoable), `overrun <min>` (a class runs over; what follows slides back), `late`/`busy`/`overrun` cascade; a bare date or `tomorrow` is a date, and times already over today are refused; relative titles ("gym after soccer"); restating a block replaces it; `add "title, 30"` accepted; **`ignoreTitles` `["(optional)"]`**: Nick: "i never go to them so get rid of all of them going forward" (the optional workshop series; both series were deleted from 7/8 October onward on 10-01 00:04 once the bridge learned `span: future`).
* **Live proof**: "seven `orion-eval-run` sessions texting as Nick about 2026-10-01; the last two runs gave correct layouts. Every test change to 2026-10-01 was reverted to the snapshot. A wrong-day run (a bare date, before the fix) wrote to 2026-09-30; it was undone from the journal and leftovers were dropped." The end-to-end tests run against a **fake calendar bridge** (`tests/fixtures/fake-bridge.mjs`; `tests/life-reschedule-cli.test.mjs`).
* ORION's own guidance (AGENTS.md and the TOOLS blurb): "never invent a time; 'nap 60 so 3' ends at 3; relative wording goes in titles; `drop`, not undo; move one block with `add`; `overrun` for classes; `--fill` only when asked."

**`936b695` (10-01 07:10): plan from the to-do list, one block per to-do.** At 23:23 on 09-30 Nick asked ORION to plan Thursday from his to-do list ("don't include any of the groceries"). ORION pasted the list into `day --say`; `plan-parse` read "review CS lect **2**" as 2 PM, glued it to the following items as "Review CS lect , research backpacking stuff, Online learning for Northeastern, f…", and silently dropped finish resume, apply to SOMEWHERE and the rest. Fix: `orion-reschedule day --todos` reads the Orion reminders list itself and books one movable block per to-do with its real title; estimates come from Qwen's `todo-parse` (used for minutes and optional only); due-later or already-on-calendar items are named, not booked; what does not fit is named "no room today"; `plan-parse` shields numbers that label something (`lect/lab/quiz/chapter/week … N`) from time parsing. ORION's guidance says: never paste the list. "Its comma splitting joins pieces without an activity word, so it is not a list parser."

**`1bcf4ad` (10-01 11:39): the `now` command.** 11:28 BST: "I only just got home … going to eat now so put my break now and rearrange my schedule accordingly." ORION retyped the whole day with `day --plan` and invented times: nothing went in now, DS lab stayed at 11:00 during lunch, the side project went to 12:55, **dinner moved *earlier* to 18:15**. New `orion-reschedule now "<title>, <min>" … [--at HH:MM]` books what he is doing from now (or from when he started); a later same-named block is *moved, not doubled*; every movable block not yet done slides after it in order. **Root bug fixed with it**: "an ORION-made block was fixed when its title read like a class ('DS lab', a to-do), so it could never move. `toBlocks` now makes every `[orion:…]` block movable."

### Steps back

| What Nick reported or what broke | Fix | Commit |
|---|---|---|
| Soccer 5–7 on a full day: overlaps, refusals, undo chains deleted soccer, `--say` crash | transactional replace; incremental-then-rebuild | `4205b85`, `afe697b` |
| ORION fell back to generic `calendar_event_remove` and fabricated an approval id | `drop`, `clear`, `skip`; rule "schedule changes never use the generic calendar actions" (landed 10-06; see next chapter) | `e7a6962` (drop) |
| Gym at 1 PM before soccer at 5 | order by time, importance only decides what is left out | `752ac71` |
| "Reading at 8 AM", "YouTube right after class" | `sensible-time.mjs`, home floor, commute | `752ac71` |
| To-do list pasted into `--say` became one garbled block | `day --todos` | `936b695` |
| "Dinner moved earlier" when he said he was eating now | `now` command | `1bcf4ad` |
| An ORION block called "DS lab" was filed as a class, pinned, and made its own commute walls | every `[orion:…]` block is movable; classes must be fixed *and* not ORION's | `1bcf4ad`, `2602593` |
| ORION's reply misstated times the calendar had right ("resume at 4:00 PM" for 14:30–16:00) | `reply-times` checker (Era 12) | `4032800` |
| Run on a bare date wrote to the wrong day | bare date/`tomorrow` handled; undone from the journal | `e7a6962` |

### Lessons

1. **Don't let a model compose a schedule by retyping it.** Three of the five Nick complaints (`day --say` merge, the retyped lunch day, dinner earlier) are the model re-emitting the whole day with invented times. The fix each time was a **verb that changes one thing** (`drop`, `now`, `--todos`, and in Era 11 `extend/resize/move/swap/rename`).
2. **Order and importance are different axes.** Order by time (his words); use importance only to decide what to cut.
3. **Real days are the test set.** The scenario tests were seeded from Nick's actual messages and the actual calendar; the fake bridge makes them repeatable.
4. **Nick's reported symptom is evidence; the model's explanation is not.** Each HANDOFF entry opens with what Nick said and what he saw, then derives the cause from the session log.

### Walk it yourself

```bash
sed -n 1,30p scripts/lib/life/replan.mjs
sed -n 1,28p scripts/lib/life/sensible-time.mjs
sed -n 1,40p scripts/orion-reschedule                      # the verb list is its header comment
node --test tests/life-reschedule-cli.test.mjs tests/life-sensible-time.test.mjs 2>&1 | tail -6
sed -n 332,360p HANDOFF.md                                  # the 09-30 23:33 entry
```

### Questions to ask your tutor

1. In `replan.mjs`, what are walls, pinned and flexible blocks, and what happens when a pinned time collides with a wall?
2. Why does importance not reorder the day? Give the 09-30 example.
3. What is the difference between `--replace`, `--rebuild`, and the default incremental mode of `orion-reschedule day`?
4. Why does `now` move a same-named later block instead of adding a second one?
5. Why does the test suite use a fake bridge rather than Nick's real Calendar?

---

## 11. Era 10 — Night markers, one to-do list, and the phone's Screen Time lock (10-01)

*Commits: `35e4889`, `1fc1162`, `6b1da5d`, `44c1443` (10-01 00:04–00:07), `51e0b56`, `0ee7ea6`, `b47d259` (00:39–00:40), `900bcaa`, `1801a69` (01:02–01:04), `017d51c` (06:57).* A single night (after midnight on 10-01), in which Nick used ORION from bed, hit three different problems and Claude fixed each live.

### What was built

**Wake and asleep-by markers (`35e4889`, then `44c1443`, `017d51c`).** Nick asked for "little markers for when i wake up (orion alarm) and when i should be asleep by (wind down is prior to that and ends at the 'asleep' line)". One rule file serves both Mac and phone (`scripts/lib/life/night.mjs`, the phone's `NightPlan` rule):

```js
// scripts/lib/life/night.mjs:24-30 — wake time for a date
  if (wakeRequest && wakeRequest.date === date && wakeRequest.minute < 12 * 60) return wakeRequest.minute;
  const usual = toMinute(config.usualWake);
  const first = blocksOf(date).filter((b) => b.fixed && b.source !== "orion").sort((a, b) => a.start - b.start)[0];
  return first ? Math.min(usual, first.start - (config.readyMinutes ?? 105)) : usual;
```

* `wake` = a morning alarm he asked for, else `min(usual wake, first real commitment − readyMinutes)`; `asleep-by` = `min(bedtime, next wake − sleep need)`, or after a night out plus the trip home. "Real commitment" excludes ORION's own blocks: "a side-project hour it planned at 8 must not drag the alarm to 6:45."
* `orion-watch` writes `~/.openclaw/orion-controlled/night.json` (yesterday kept as computed, because the calendar feed starts at now; today; tomorrow); the Mac reads it through `NightMarkers.swift`; `orion-reschedule` ends the day at asleep-by so wind-down ends on the line.
* **Bug found live**: an afternoon nap alarm ("wake me at 3:30" after lunch) drew the wake line at 3:30 PM. Only morning requests (before noon) count now.
* **`44c1443`**: Nick: "i usually wake up at 7:15 am for 9 classes". `readyMinutes` default **75 → 105** in the Mac config (`scripts/lib/life/config.mjs:22`) and the phone default; "the phone moves the old 75 default to 105 once and leaves a value he set himself".
* **`017d51c` (06:57)**: Nick: "have the wake up line move to when I actually wake up", and (separately) "is my phone just locked forever now … it's a new day." Actual sleep now comes from WHOOP: the ORION app writes `sleep-actual.json` on every sync; `night.mjs` `actualWake` prefers WHOOP, then the phone's "up", then the first phone use after 04:00. The Mac and phone draw "Woke" and last night's "Fell asleep". **Morning unlock**: `FocusLock.releaseNightLock` runs only 04:00–14:00 and only for a night lock, including old-build locks that carry no reason. Verified on real data: "WHOOP says asleep 01:31, woke 06:21 (planned 07:15)".

**One to-do list, ORION never plans from groceries (`1fc1162`).** The calendar bridge reports each reminder's list and can list, filter, create on and move between lists, and delete a repeating event's future occurrences (`span: future`). In life config: `todoList` "Orion", `sweepLists` ["Reminders"]. **ORION reads and writes only the Orion list**; reminders added by Siri or on the phone land in the default list and are **swept onto Orion** by `orion-agenda-change tasks-sweep` (plus a sweep on every `orion-watch` tick); a duplicate is ticked off (reopenable). "Merged tonight: 6 moved, 1 duplicate ('finish resume') ticked. Groceries and the Family packing list are untouched and never planned from."

**The phone's Screen Time lock becomes visible to ORION (`51e0b56`, `0ee7ea6`).** Trigger, 00:24: Nick asked ORION from the phone "can you pretty please unblock my apps just until 12:45". ORION checked `orion-focus` (the Mac's focus timer) and said nothing was locked. **The lock lives on the phone (Screen Time); the Mac had no view of it.** Built (HANDOFF 10-01 00:40):

* **Phone → Mac**: a `LinkLog.screen(at, locked, until, why, graceUntil)` entry is sent before every chat message and after a grant; the helper stores it as `phoneScreen` plus `screenLog` in the health log.
* **Mac → phone**: `LinkSnapshot.screenGrant` (id, until, because) from `~/.openclaw/orion-controlled/screen-grant.json`. The phone's `FocusLock.grant` lifts the shield, sets `graceUntil`, and starts a DeviceActivity "grace" interval ending at `until`; **`ScreenMonitor.intervalDidEnd("grace")` re-shields if the lock window still runs, even with ORION closed.**
* **`scripts/orion-phone-time`** (86 lines): `status | grant <min|HH:MM> --because "<reason>" | revoke`, `MAX_MINUTES = 60` ("a grant is at most 60 minutes: extra time, never switching the lock off"); allowlisted, with a TOOLS blurb and AGENTS guidance: "decide like a friend; past bedtime prefer 10–20 minutes; talk to him, not about him". The lock state is added to every message's live facts in `orion-remote`.
* Fixed along the way: "the Screen Time monitor never set `orion.screen.lockedBy`, so the end of a work window could not unlock. And the app read the lock from standard defaults, while the monitor wrote to the app group."
* **Live eval** (`orion-eval-phonelock-0034`, with a *simulated* lock report): the vague ask was refused with 10 minutes offered for a reason; 2 hours was refused; "reply to my mom about flights, 10 min" was granted until 12:45 with the reason recorded. The test state was removed afterwards.

### The incident that followed (the most important story in this era)

**`900bcaa`/`1801a69` (01:02–01:04), HANDOFF 10-01 01:04: "Phone unblocking did not work for Nick; first job tomorrow."** At 23:47 Nick asked again; ORION granted 20 minutes; **the phone still ran the old build, so nothing unlocked, but ORION said "Done".** Then: "at first ORION did not recognise the block; when he asked again, ORION said 'Done' and nothing unlocked. He turned the lock off by hand in Settings." Cause: "every phone-side part (lock reporting, acting on grants, re-locking) is in the phone build that was never installed. `devicectl` reports the iPhone `unavailable` (error 4016)" (device locked/asleep).

The response is the era's design principle in two lines of code: `orion-phone-time grant` now prints, while the phone has never reported:

```
// scripts/orion-phone-time:77 (abridged)
SENT, NOT CONFIRMED: extra time until <clock> is on its way, but his phone has never reported its lock,
so its ORION may be too old to act on it. Tell him it is sent, not done, and how to unlock himself right now…
Do not say he is unlocked.
```

and AGENTS.md says the same. HANDOFF then lists a four-step real-device test for the next morning ("Only then call it fixed."): install `OrionPhone.app` with the phone on the same Wi-Fi and screen on or on USB; open ORION once to mirror the lock state; with Focus lock on and a lock active send "unlock my apps for 10 minutes, I need to reply to my mom"; check `orion-phone-time status` shows LOCKED before and UNLOCKED after, and that the apps really unlock and re-lock. **The phone was installed at 06:45 the same morning** (HANDOFF 10-01 06:45: "The iPhone was connected this morning and `OrionPhone.app` was installed"), but "the real-device unlock test is still to do with Nick". At the snapshot of this chapter's end the end-to-end test is not recorded as done; check the later chapter.

### Steps back

| What | Fix |
|---|---|
| ORION said "nothing is locked" (checked the Mac's timer) | phone reports lock; live facts; `orion-phone-time` |
| ORION said "Done, unlocked" to a phone running the old build | `SENT, NOT CONFIRMED` until the phone confirms; AGENTS rule |
| Nap alarm drew the wake line at 3:30 PM | only morning requests count |
| Default get-ready 75 min when real is 105 | config and phone default; phone migrates old default once |
| Night lock "forever" in the morning | `releaseNightLock` in the morning window |
| Monitor never recorded which window locked; app read the wrong defaults | both fixed in `51e0b56` |
| Phone build never installed (error 4016) | installed 06:45; device test still pending |

### Lessons

* **"Done" must mean "confirmed".** A command that travels over a link to a device that may not be listening must have three states, not two: *sent*, *confirmed*, *failed*. The code reports `sent` honestly.
* **Put the state where the decision is made.** ORION decided about the phone lock using the Mac's focus timer, because that was the only state the Mac knew. The fix was to move the phone's state to the Mac before every message, not to teach the model to be careful.
* **Rules about sleep need a reason on file.** Grants go through a policy (§12), not through the model's mood.
* **A one-day-old device build is part of the system.** Three of this night's failures were really "the phone is running yesterday's code".

### Walk it yourself

```bash
sed -n 1,40p scripts/lib/life/night.mjs
sed -n 1,20p scripts/orion-phone-time
sed -n 60,86p scripts/orion-phone-time
sed -n 297,330p HANDOFF.md      # 10-01 00:40 and 00:04 entries
node --test tests/phone-time.test.mjs 2>&1 | tail -5
```

### Questions to ask your tutor

1. Draw the data path for a grant: which file or record carries it from the Mac to the phone and what re-locks the phone?
2. Why is `MAX_MINUTES = 60` a hard constant rather than something the model decides?
3. What is the difference between `sent` and `confirmed` in the grant flow, and where is the "never reported" case detected?
4. Why must the night lock be released in the morning by the phone, rather than by a Mac timer?
5. What does ORION read from WHOOP, and in what order do the wake sources fall back?

---

## 12. "ORION truthful" and "ORION truthful 2": Qwen's second and third projects (09-30 – 10-01)

*Commits: `1a741e9`, `b8c9c5a` (todo-parse, 09-30), `5da0855` (the eviction fix, 10-01 00:52), `7e7f988`, `0b4ede8`, `e12f128`, `87bc5e5`, `e58c083`, `83e3637`, `aa401a1`, `b9fc452` (truthful 2 and the triage task, 10-01 01:00–05:18), `4032800`, `fc3bffb`, `482afc3` (Claude's hand-over work, 06:40), merges `5628d2b`, `0a97af5`, `8645256` (06:42–06:45).* This is the cleanest example of the whole dev loop at work: a plan written by Claude from Nick's real failures, run unattended overnight by Qwen, one task failing for a *machine* reason, and a human hand-over.

### The plan

**ORION truthful** (`docs/agentic/plans/orion-truthful.md`, 5 tasks, imported as `project-37a62c0e`, 09-30 10:24): 

| Task | Module | What it must do |
|---|---|---|
| `todo-parse` | `scripts/lib/life/todo-parse.mjs` | parse a to-do title ("thinking fast and slow book") into minutes and optional |
| `trace` | `scripts/lib/eval/trace.mjs` | `parseTrace` an OpenClaw session log into Nick's words, the calls ORION made with results, and the reply; `expectTools` grades a turn |
| `reply-times` | `scripts/lib/remote/reply-times.mjs` | do the times ORION *says* match what was *booked*? |
| `triage` | `scripts/lib/notify/triage.mjs` | notification triage and digest |
| `scenarios` | `scripts/eval/scenarios-2026-09-30.json` + `scripts/lib/eval/scenario-check.mjs` validator | a 150-scenario catalog |

**ORION truthful 2** (`orion-truthful-2.md`, three tasks, `project-2f12825d`, created 10-01 01:02 "in their own project, since a started project cannot take new tasks"): `grant-policy` (consistent extra-phone-time decisions), `reply-person` (rewrite "his apps" as "your apps"), `day-review` (planned against done, as an evening message).

### What went wrong overnight (HANDOFF 10-01 01:02 and 06:45)

**"ORION truthful" stopped at 15:51 on `trace`: three attempts gone in three seconds with "could not evict gpt-oss:20b before loading qwen3.6:27b".** It was not Qwen's work. "The ORION app keeps its fallback `gpt-oss:20b` loaded, `ensureExclusive` checked the unload once, instantly, and the error counted against the task." Fix `5da0855` (`scripts/lib/agentic/models.mjs:387-425`, test `tests/agentic-evict.test.mjs`): eviction **polls for up to 20 s**, re-asking for the unload, and a failure is `recoverableRuntime` so the attempt is refunded. The code comment records the date: "Checking once, instantly, blocked a whole project on 2026-09-30 (three attempts spent in three seconds)."

```js
// scripts/lib/agentic/models.mjs:396-415 (excerpt)
let remaining = strangers;
const deadline = Date.now() + (this.#config.evictWaitMs ?? 20_000);
for (;;) {
  remaining = (await residentModels(this.#config.endpoint)).filter(entry => entry.model !== spec.model);
  if (!remaining.length || Date.now() >= deadline) break;
  for (const entry of remaining) await unload(this.#config.endpoint, entry.model);
  await new Promise(resolve => setTimeout(resolve, this.#config.evictPollMs ?? 1_000));
}
```

After that the escalation was resolved with the cause, and the project relaunched `--until-stopped`. A chain script (`~/.openclaw/orion-controlled/project-agent/chain-truthful-2.sh`, nohup) launched "ORION truthful 2" once "ORION truthful" had been idle for two 5-minute checks. That is the "replaces hand-written overnight chain scripts" idea that Era 12 of the next chapter formalises as `orion-project-queue`.

**Reviewer repairs and corrections:**

* `1a741e9` (todo-parse, 15:19): "The worker has made zero progress — no files exist yet… Provide the complete initial implementation of parseTodos… plus the full test suite" (373 lines): the reviewer wrote the whole task.
* `7e7f988` (reply-times, 03:22): "`checkReplyTimes` allows multiple mentions to match the same booked block because it never tracks which blocks have been claimed… Adding a Set of matched block indices" — a *genuine* algorithm fix by the reviewer (310 lines).
* `e58c083` (reply-person fix): `isNickReference` mis-detected other capitalised names; fix. `83e3637`/`b9fc452`: unused `node:assert` imports (library code must throw `TypeError`).

**Hand-over.** "ORION truthful" ended with todo-parse accepted, triage awaiting review, `reply-times` blocked (implementation without tests), `trace` blocked (runtime, not task) and scenarios not started. Claude finished the three by hand at 06:40 (`claude(...)` commits):

* **`4032800` reply-times was rewritten.** "Qwen's draft passed the brief's tests but misread real replies: it matched a time to a title by the six words either side and fixed AM/PM before looking at the day, so 'dinner 7:30, gym 7:30–8:30' scrambled both. Times now belong to their clause, an unmarked time takes the reading the booking supports, and a lone time must be the start. Adds the 30 September reply as a test." (143 insertions, **283 deletions**: it is a rewrite.) The file's own header records the real incident: ORION booked "finish resume" 14:30–16:00 and told Nick "resume at 4:00 PM" (`scripts/lib/remote/reply-times.mjs:1-12`).
* **`fc3bffb` trace**: `parseTrace` and `expectTools`, "checked on the real 2026-10-01 unlock session: it flags the orion-focus answer and passes the orion-phone-time ones."
* **`482afc3` scenarios**: **150 scenarios** in Nick's texting style across **16 areas**, each with the tool that must run, what must never appear, risky ones must ask or refuse, and how to undo test side effects; it includes the 09-30 failures (to-dos marked fixed, drop by undo, the phone lock answered from `orion-focus`). Three files, 3,211 insertions.

**Merges** at 06:42: `5628d2b` ("Qwen: todo-parse, triage (reviewed). Claude after hand-over: reply-times (rewritten from Qwen's draft), trace, scenarios. Run state closed as completed through the runner's own state library.") and `0a97af5` ("ORION truthful 2 — grant policy, talk-to-him rewrite, day review (Qwen, all accepted)"). Merged tree: **855 Node tests pass**. Spot-checks on real cases: the reply-person rewrite of the 2026-10-01 reply; grant-policy "refuses 'pretty please' and gives 20 minutes to 'text my friends then bed'".

### The policy modules, concretely

`scripts/lib/life/grant-policy.mjs:decideGrant` (125 lines) is a Qwen-written pure decision table, from a brief: validation; a hard cap (never past the lock, never more than 60); at most two grants in a night ("That's twice already tonight. Phone down — bed."); night lock: an empty or filler reason ("please", "pretty please", "pls") → **0**, "No reason, no time — it's past bedtime. Tell me what it's for and I can give you 10"; with a reason → `min(asked, 20)`, cut to 10 if the grant would eat into sleep needed before the first commitment; work lock: with a reason `min(asked, 15)`, else "You planned this block. Finish it or tell me why you need the phone." Nick's real asks are the test fixtures.

### Honest status at HEAD (this changes how you should read "built")

A grep for importers at snapshot `6c93032` shows these modules are **tested but not imported by any script**: `grant-policy.mjs`, `reply-times.mjs`, `reply-person.mjs`, `day-review.mjs`, `lib/eval/trace.mjs`, `scenario-check.mjs` (`scripts/` and `plugin/` contain no reference outside their own tests and the docs). `todo-parse.mjs` **is** wired (`scripts/orion-tasks`, `scripts/orion-reschedule`), and `notify/triage.mjs` is referenced by `scripts/orion-watches`. HANDOFF 10-01 06:45 lists the unwired ones under "Not yet wired (next): todo-parse into orion-reschedule; trace and expectTools into orion-eval-run; reply-times and reply-person into orion-remote's reply path; grant-policy into orion-phone-time; triage behind a notification reader; day-review as the evening message; then run the 150 scenarios." Only some of that happened. **(Grep result as of snapshot; a different wiring route such as a dynamic import would not show up; check the later chapters.)** So "ORION truthful" produced checkers; whether they run on every reply depends on later work.

### Steps back

| What | Fix |
|---|---|
| Model eviction checked once, instantly: 3 attempts in 3 seconds | poll up to 20 s; failure is `recoverableRuntime` |
| Qwen's reply-times passed tests but scrambled real replies | Claude rewrote it from Nick's real 30 Sept replies |
| `trace` task never ran | fixed runtime; Claude wrote it |
| Run state invalid after hand-over | closed through runner's own library |
| ORION truthful 1 and 2 ran in a project that "cannot take new tasks" once started | a separate project, chained by a script |
| Qwen added unused `node:assert` imports three times | one-line correction tasks; later `0604567` |

### Lessons

* **Tests the model writes are tests the model passes.** `reply-times` had all of its brief's tests green and still scrambled a real reply. Claude fixed it by adding the *real* reply as a test. This is the strongest argument in the repo for scenarios drawn from Nick's own messages.
* **A runtime defect can masquerade as a task failure** (the eviction race) for a whole day, and cost the same attempts as a task failure would.
* **Built is not wired.** Seven modules, one wire-up.

### Walk it yourself

```bash
sed -n 1,30p scripts/lib/remote/reply-times.mjs
sed -n 1,125p scripts/lib/life/grant-policy.mjs | head -80
git show -s --format=%B 4032800
git show --stat 482afc3 | head
grep -rl "grant-policy\|reply-times\|reply-person\|day-review" scripts plugin --exclude-dir=node_modules      # who imports them?
```

### Questions to ask your tutor

1. Why did a repair by the *reviewer* (`7e7f988`) fix a real algorithmic bug but earlier reviewer repairs (`d7286b2`) did not?
2. What is the difference between "the brief's tests pass" and "the module works on Nick's real messages"?
3. Why is `grant-policy` a pure function rather than part of `orion-phone-time`?
4. What did the unwired status of these modules cost the project, given that Nick's complaint was the replies?


---

## 13. Era 11 — Day rules by construction, and the surfaces project is staged (10-01 afternoon)

*Commits: `2602593` (12:01), `55c5648` (14:19), `3034d64` (14:46), `7e1ea26` (14:57), then the Qwen "surfaces" tasks `b4f6ae4`, `90f9e14`, `fcb6e16`, `73dc672`, `70c69b8`, `a5cab54`, `0604567`, `d96cab3` (16:05–19:57).* The range ends mid-run: the surfaces project continues past midnight into 10-02 (the next chapter).

### `2602593` (12:01): "Day rules by construction"

Nick, mid-morning: **"lunch goes into my break which goes into my lab. things are smooshed … even after you reviewed and fixed it yourself there was still overlaps … that a design flaw we need to polish out."** HANDOFF lists six root causes found in the code:

1. *Drawing*: the Mac (20 pt) and the phone (~20 pt) gave every block a minimum height, while 15 minutes is 13 or 16 pt, so short blocks were drawn over the next one.
2. Planning packed blocks edge to edge.
3. **No invariant.** "'What stays' was decided block by block against walls only." Property tests found existing overlaps kept, and in-progress blocks running into classes.
4. Incremental mode evicted a block into the first far gap (a tidy preview put dinner at 22:33 and dropped four blocks).
5. An ORION block filed as "class" (the to-do "DS lab") made its own commute walls and pushed itself two hours.
6. Nap and wind-down ranked as "rest", the first thing dropped.

The fixes introduced an **invariant file**, `scripts/lib/life/day-check.mjs` (41 lines). Its header states the rule: "Until now each fix was 'this case should not overlap'. This is the invariant itself, checked on the finished plan BEFORE anything reaches his calendar."

```js
// scripts/lib/life/day-check.mjs:1-12
// The rules a day ORION writes must keep (2026-10-01). Nick: "even after you
// reviewed and fixed it yourself there was still overlaps. thats not a small hey
// keep this in mind, that a design flaw we need to polish out." […]
//   hard  no block ORION places or moves may overlap anything;
//         every block starts before it ends and is at least 5 minutes.
//   soft  (reported, not refused) two of his own fixed events overlapping —
//         his call, not ours.
```

`orion-reschedule` now checks the *projected* day before any write (refusing with the literal text **NOTHING WAS CHANGED**) and re-reads after. The CLI "always lays the day out as a cascade (rebuild): blocks keep their time where there is room, otherwise just after the previous block plus the gap" (config `bufferMinutes` 10). "Free time only limits additions" (`keepFree` no longer drops existing plans). Commute and "home" come only from real fixed classes; "nap, wind down and sleep rank as sleep". A new verb `orion-reschedule tidy` ("fix my schedule"). The Mac and the phone draw blocks **at true size** (4 pt floor), compact one-line labels, clipped; the phone no longer layers TodayPlan blocks that collide with calendar events.

Tests (`tests/life-day-invariants.test.mjs`): **3,000 + 1,000 random days** (once run at 20,000 + 5,000): "no ORION overlap, the gap kept", plus gap/keepFree scenarios, an existing-overlap repair test, a commute test for ORION's "lab", and a priority test. This is the first **property-based test** in the project. The real day was tidied: "Break 11:53, DS lab 12:18, side project 13:58, nap 15:08, study 16:03, apply 17:13, internship applications 18:08, dinner 19:48, resume 20:43, review CS lect 2 22:23, wind down 23:30. 'Research backpacking stuff' is named as not fitting." Pending: "the Day view not yet seen on screen after the drawing change (synthetic clicks hide the window)". Mac app deployed (backup `.Orion-previous-*-truesize.app`); phone build ready, not installed (device error 4016 again).

### `3034d64` (14:46): "change one block without retyping the day; rules he states are saved"

The Haiku brain, asked on 10-01 to "extend the DS lab to 3", **retyped the whole day three times**: the lab was never extended, "a second one appeared at 17:25, unmentioned blocks were dropped and 'noted' rules were never saved." Fixes (22 files, +1,450):

* New verbs on `orion-reschedule`: `extend`, `resize`, `move`, `swap`, `rename` ("one block changes and the rest cascades; extend works on a block that already ended; `--then` for 'nap after'; swaps of any lengths keep the span"). Option lists are declared in a table (`scripts/orion-reschedule:96-103`).
* "Past times and re-planning something that already happened are refused with the right command; `--replace` names every block it drops."
* **Shrinking rules** when a day overflows: "breaks, side projects and optional items shrink (never naps, to-dos, study or meals), and later blocks slide into the freed time."
* **His minimums are enforced** (`orion-life min nap 75`; `lengths.mjs`), and **standing rules in his own words are saved by `orion-remote` before the model answers** (`scripts/lib/remote/standing-rules.mjs`). The motivating failure, from the file's header: *"'Going forward remember that you can change how much time is allotted to non priority items' and 'naps should be at least an hour and 15 minutes long ALWAYS' — ORION replied 'Noted' to both and saved neither. Whether a rule is kept can't depend on the model remembering to call a tool: orion-remote reads his own words, saves the rule, and tells the model it is already saved."* The regex that spots a standing rule is `always|going forward|from now on|moving forward|in the future|every time|…`.
* The bridge returns today's *earlier* events; live facts show them.
* **`scripts/orion-eval-schedule`** asks the real ORION to change a **sandbox** day (its own calendar, clock and settings in eval mode) and **grades the day he leaves behind** (`scripts/lib/eval/schedule-grade.mjs`, `scripts/lib/eval/sandbox-bridge.mjs`); 16 scenarios from his real requests in `scripts/eval/schedule-scenarios.json` (403 lines); `--model` compares brains. (The results, "Haiku, Sonnet 5, Qwen 3.5 9B, Qwen 3.6 27B", are in the next chapter's range: `5293e1a`.)
* Also: "Qwen's plan: orion-focus collision renamed to orion-ontask; early-cli scope." Qwen's surfaces tasks would have collided with the existing `orion-focus` CLI name.

### `7e1ea26` (14:57): thinking on for text messages

A four-line change in `scripts/orion-remote` that matters more than its size. (At HEAD this line has been replaced by a per-message `thinkingLevel(...)` call, `scripts/orion-remote:810`; the version in `7e1ea26` was a fixed `"low"` default.) **Thinking had been off for every message** ("openclaw thinkingDefault 'off', chosen for voice speed"). Now `askBrainOnce` passes `--thinking` with `ORION_BRAIN_THINKING ?? "low"`: "text messages that change his day need it (2026-10-01)". And `ORION_BRAIN_MODEL` lets a whole eval run pin a model. This reverses the 09-29 finding ("brain is Haiku 4.5 with thinking off (Sept: 347 of 349 replies) … the main cause of weak conversation") only for text; voice stays fast. Compare the 09-29 decision to stay on Haiku and escalate retries to Sonnet 5: `scripts/orion-remote:697-700`.

### `55c5648` (14:19): staging the surfaces plan for the local agent

Claude spent the early afternoon *preparing the ground* for Qwen's next project ("ORION surfaces", `docs/agentic/plans/orion-surfaces.md`, 521 lines plus 13 briefs; **"Prepared: 1 October 2026 (Claude)"**). The goal in Nick's words as the plan paraphrases them: the finished-early button, schedule-driven focus mode, phone app lists, Deepgram Flux, the thinking orb, the phone chat box, "and asked that the local agent build as much as it can so Claude's time goes to wiring, device testing and design." The commit (36 files, +2,352) does the scaffolding so tasks are self-contained:

* **Vendors Jakub Antalik's thinking orbs (MIT) as `ThinkingOrbsKit`** (`native/OrionMobile/Sources/ThinkingOrbsKit/`, with its LICENSE file) and links them into the Mac and phone apps.
* Adds the `OrionViews` SwiftUI library "for Mac screens the agent may build (**`native/Orion` stays closed to it**)", registers placeholder phone files (`App/FinishEarly.swift`, `FocusLists.swift`, `PhoneOrb.swift`), adds the `AgentTasksTests` target and three checks in `scripts/lib/agentic/checks.mjs`: `mobile-swift-tests`, `mac-build`, `phone-build`, and stops the focus tests leaving empty plists in `~/Library/Preferences`.
* Division of labour stated in the plan: "Wiring (panel, home-screen transformation, live Deepgram socket, phone Screen Time migration, Live Activity taps, thinking stream) is Claude's."

**Qwen's surfaces output inside this range** (all in `scripts/lib/life/`, `scripts/lib/focus/`, `native/OrionMobile/`):

| Commit | Task | Module |
|---|---|---|
| `b4f6ae4` + `90f9e14` | `early` | `scripts/lib/life/early.mjs`: `earlyContext`, `finishEarly` (pull the day forward when a block or class ends early) |
| `fcb6e16` | `early-cli` | `orion-reschedule early [block|out-of-class|home]` |
| `73dc672` | `focus-escalation` | `scripts/lib/focus/escalation.mjs`: `MAC_STEPS`, `focusBlock`, `judgeActivity`, `nextStep` |
| `70c69b8` | `focus-cli` | `scripts/orion-ontask` + `scripts/lib/focus/state.mjs` (status, snooze, allow, wrong, act, log) |
| `a5cab54` + `0604567` | `phone-lists` | `scripts/lib/focus/phone-lists.mjs`: daily caps for feeds/video/games, focus-block escalation blocks lists |
| `d96cab3` | `chat-store` | `ChatStore.swift`, `ChatModels.swift`: persisted chat history and model list (10 new tests) |

`b4f6ae4` is another *good* reviewer repair, with a real diagnosis: "buildWalls receives the original (unclipped) class block… but commuteWalls is computed against effectiveBlocks (with clip applied). The timestamp mismatch means the commute-home wall exclusion never matches, so the wall blocks forward movement." The finish-early work is deliberately built on the day-rule invariant (it "judges via `refuseIfBroken(projectDay(dayWithClip, { moves }), now, 'finishing early')`" per `fcb6e16`).

### Steps back

| What | Fix |
|---|---|
| "Things are smooshed", overlaps after a self-review | `day-check.mjs`: invariant before any write; property tests |
| Haiku retyped the day three times for "extend the DS lab" | verbs that change one block |
| ORION said "Noted" and saved nothing | `orion-remote` saves standing rules from his words before the model replies |
| Thinking was off for every message | `--thinking low` default for text |
| Mac/phone drew 15-minute blocks over their neighbour | true-size drawing with a 4 pt floor |
| Co-Authored-By trailers in the three 10-01 Claude commits after Nick's 09-30 rule | not fixed in this range (Section 14) |

### Lessons

* **An invariant check before every write beats a bug fix per symptom.** `checkDay` is 41 lines and ended a class of complaints that three earlier commits had each addressed one case at a time.
* **Property tests find what examples cannot.** "The property tests found existing overlaps kept, and in-progress blocks running into classes", cases nobody had thought to write down.
* **The rule must not depend on the model's memory.** Standing rules are saved by code reading Nick's words, not by asking the model to call a tool.
* **Stage the ground for the local agent.** Vendoring the library and registering the placeholder files meant Qwen's tasks could be small, independent, and checked with fixed registry names.

### Walk it yourself

```bash
cat scripts/lib/life/day-check.mjs
sed -n 90,110p scripts/orion-reschedule
sed -n 1,25p scripts/lib/remote/standing-rules.mjs
sed -n 798,812p scripts/orion-remote       # the --thinking line (HEAD has since replaced the fixed "low" with a per-message thinkingLevel())
sed -n 182,210p HANDOFF.md                 # the 10-01 12:01 entry
node --test tests/life-day-invariants.test.mjs 2>&1 | tail -6
```

### Questions to ask your tutor

1. State in one sentence the hard rule enforced by `checkDay`, and the one soft case it only reports.
2. Why does `orion-remote` save a standing rule before the model answers? What would break if the model were asked to?
3. What does "cascade" mean for a rebuilt day, and what is `bufferMinutes` for?
4. What does `native/Orion stays closed to it` mean for what Qwen can edit, and which file enforces it?
5. Why was thinking turned off for every message in the first place, and what changed on 10-01?

---

## 14. Steps back, catalogued

Every reversal, incident and fix-of-a-fix in the range, with the commit or HANDOFF entry that records it. "Nick reported" means the entry quotes Nick.

### 14.1 Reverts and design reversals

| # | What was reversed | Why | Where |
|---|---|---|---|
| R1 | The Mac **Home** tab (Astra's Today view) | Nick wanted the pre-Astra orb Home back; Today moved to the Tasks tab | HANDOFF 09-28 11:16 |
| R2 | Run-level escalation (one BLOCKED task ended the night) | "make sure this loop is able to be continuous" | `c9ddbec` |
| R3 | Whole-file writes as the only write | 7–11 minutes per rewrite at local speed | HANDOFF 09-25 14:12 (EDIT) |
| R4 | Cumulative diff shown to the reviewer | escalated on the previous task's files | `c9ddbec` |
| R5 | Non-streaming inference | cannot tell thinking from dead | `a63f1f2` |
| R6 | `node-syntax` as the check for Markdown tasks | "never ran on Markdown" | HANDOFF 09-26 11:44 (`doc-report`) |
| R7 | The 80B reviewer candidate | reviews badly under quantisation | `c9ddbec`, HANDOFF 09-22 |
| R8 | Scheduling by importance order | gym before soccer | `752ac71` |
| R9 | Replacement as the default for rescheduling | "replacement is one tool, not the default" | `afe697b` |
| R10 | One-shot model eviction check | 3 attempts in 3 seconds | `5da0855` |
| R11 | Thinking off for text messages | day-changing requests need it | `7e1ea26` |
| R12 | 75-minute get-ready default | "i usually wake up at 7:15 for 9 classes" | `44c1443` |
| R13 | Day planned from pasted to-do text | merged and dropped to-dos | `936b695` |
| R14 | Generic `calendar_event_remove` for schedule changes | irreversible, needs approval, fabricated an id | `4205b85`, `e7a6962` |

### 14.2 Fixes of fixes and repeats

| Chain | Commits |
|---|---|
| Task 2 installer: reviewer repair (wrong) → briefs rewritten → accepted | `d7286b2` → HANDOFF 09-24 03:37 → `97cec31` |
| Reconcile task: repair → implementation → two review-correction tasks | `6b696c5` → `a5f4487` → `004b7a6`, `f529b4f` |
| Roadmap packets: first pass → thin → correction tasks | `1a137b4`, `1d7b475`, `4a3f175`, `ddcb950` |
| Attention feed: leaked error text → source names only | `a76bd9e` |
| Unused imports in library code ×3 | `d738369`, `83e3637`, `b9fc452` |
| Schedule overlaps, each "one case at a time" → invariant | `4205b85`, `afe697b`, `752ac71`, `1bcf4ad`, `2602593` |
| Phone lock: "nothing locked" → "Done" (unconfirmed) → SENT NOT CONFIRMED | `51e0b56`/`0ee7ea6` → `900bcaa` → `1801a69` |
| `reply-person`: wrong capital-name detection | `87bc5e5` → `e58c083` → `83e3637` |
| `life-study-parse`: casing of unknown subjects | `5bc82b0` → `383d1e0` |

### 14.3 Incidents (something went wrong for Nick or the runtime)

| Date | Incident | Impact | Cause |
|---|---|---|---|
| 09-24 | Four morning restarts of the first run all died on task 2 | a night of work lost | timeout misclassified; silent no-op READ; repetition gate |
| 09-25 04:00 | Memory-pressure stop spent last attempt | run escalated | stop charged as a failure |
| 09-26 | Roadmap run halted at 2/40 | roadmap blocked | worker spent every exchange reading |
| 09-26 | `orion-remote-install` left the Discord bridge stopped (twice) | bridge down until re-run | bootout/bootstrap race (fixed 09-28) |
| 09-27 | Feed leaked local paths; history double-wrote | latent | found in review sweep |
| 09-29 | Mac voice dead for 3 weeks | no spoken replies | launchd cannot run `~/Desktop` code |
| 09-29 | `orion-weather-alert` run to answer a question posted to Discord | a real message sent | tool described as read, behaved as send |
| 09-30 | Day filled, soccer added, 13 stale/duplicate blocks, approval id fabricated | broken calendar | day-plan replacement not transactional |
| 09-30 | CI red 27 days | resume-visible | four independent causes |
| 09-30/10-01 | Phone "unblock" returned "Done" to an unchanged phone | Nick unlocked by hand in Settings | phone ran an uninstalled build |
| 10-01 | "Plan from my to-do list" merged four to-dos into one block | work dropped | comma-splitting NL parser |
| 10-01 | "Rearrange now" put dinner earlier | wrong plan | model retyped the day |
| 10-01 | "Extend the DS lab" retyped the whole day three times | wrong calendar | Haiku, no single-block verb |
| 10-01 | Qwen project stopped 3 attempts in 3 seconds | lost overnight run | model eviction race |

### 14.4 Process failures

* **No handoff entry for a 40-minute edit session** (09-24 09:37 to 10:17, Astra), caught by Claude.
* **Mislabelled commit** `bc659a1` (cleanup deletions inside a test fix).
* **Co-Authored-By trailers after the 09-30 rule** (`55c5648`, `3034d64`, `7e1ea26`). `AGENTS.md:147`: "No Co-Authored-By lines."
* **Run state corrupted by manual hand-over** (life loop), repaired 10-01.
* **Deployed but uncommitted files** after the 09-26 batch, committed 09-30.
* **Seven "built, not wired" modules** (Section 12).

---

## 15. Lessons that recur across eras

1. **Failures in the harness look like failures of the model.** The cumulative diff, the eviction race, the READ no-op, the memory-pressure stop. In each case the first diagnosis blamed the task or the model; the journal showed otherwise. *Read the journal before blaming Qwen.*
2. **Control the shape of the work.** EDIT hunks, write-first skeletons, `--todos`, `now`, `extend` — all replace "emit a big thing" with "emit a small, checkable thing".
3. **Verbs, not retyping.** The scheduler's usability improved each time a free-form request got a dedicated verb.
4. **Truth is a harness property.** The truth check re-asks once; `SENT, NOT CONFIRMED`; `reply-times`; the claim classifier. A model that can say "done" will, so the harness measures whether it was.
5. **Evidence before claims.** "Independent check re-runs", mutation-checked tests, "Verified on real data", live evals with undo, real-device test as the definition of fixed.
6. **Nick's words are the spec.** Many commit bodies quote him; the scenario catalogs are his texts. The scheduler's rules (soccer, 7:15 for a 9:00 class, naps 75 minutes minimum) are his.
7. **Never rewrite intent in place.** `LOCAL_AGENTIC_DEVELOPMENT_MISSION.md` and `enabled` outside the repo.
8. **Cost control.** One model at a time on 48 GiB; Haiku with Sonnet only on truth-check retries (about $7/month measured); battery drain recorded (~60%/h).
9. **A big uncommitted tree is a debt.** The 09-30 push was worth 44,000 lines and a green CI; but nothing between 09-21 and 09-30 could be bisected.
10. **Count carefully.** Different suites produce different test totals (236 vs 144 vs 746 vs 855 vs 946 later); always say which invocation.

---

## 16. Walk the whole period yourself

```bash
# The range, exactly
git log --reverse --format='%h %ad %s' --date=short | awk '$2>="2026-09-21" && $2<="2026-10-01"' | wc -l
# Busiest days
git log --format='%ad' --date=short | awk '$1>="2026-09-21" && $1<="2026-10-01"' | sort | uniq -c
# Who authored what
git log --reverse --format='%an|%ad' --date=short | awk -F'|' '$2>="2026-09-21" && $2<="2026-10-01"{print $1}' | sort | uniq -c
# The merge structure of the machine work
git log --graph --oneline --format='%h %s' 58af930^..e7a1f94 | head -60
# The defect-list HANDOFF entries
grep -n "^## 2026-09-2[1-9]\|^## 2026-09-30\|^## 2026-10-01" HANDOFF.md
# The runtime
ls scripts/lib/agentic scripts/lib/attention scripts/lib/life scripts/lib/focus
# Read the mission and the standard
sed -n 1,60p docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md
sed -n 1,80p docs/agentic/PLAN_STANDARD.md
# Run only the local, side-effect-free tests for a slice
node --test tests/attention-*.test.mjs tests/life-day-invariants.test.mjs tests/phone-time.test.mjs
```

Questions for the whole chapter:

1. Rank the eras by "how many Nick-reported failures led to them". Which era had none? (Eras 2–6 were driven by intent and by the loop's own defects; Eras 7–11 by Nick's day.)
2. Make a one-page timeline of the agentic loop's reliability defects (Era 3) and mark which were harness bugs and which were model behaviours.
3. Which of the 106 agent commits would you trust without reading, which would you read first, and why? Use the `ALREADY SATISFIED` convention and the review-sweep defects as evidence.
4. What does the history say about how Nick wants ORION to behave when it is unsure, comparing the attention gate's `focus_unknown`, the grant policy's `0` for an empty reason, and `SENT, NOT CONFIRMED`?
5. Where does this chapter's story connect to chapter 09 (the loop), chapter 04-05 (the plugin and turn pipeline) and the phone chapters?

---

## 17. Every commit in range

Dates are author dates (all 2026-09-21 to 2026-10-01). Type is the commit-subject prefix (`agent` = Qwen worker, `agent-repair` = Qwen reviewer, `claude` = Claude hand-over commit on a Qwen branch, `review` = Claude's fix on a Qwen branch). **Era** codes: E1 = scheduler entry and foundation (§2); E2 = runtime (§3); E3 = first runs (§4); E4 = Phases 40–52 (§5); E5 = packets and history (§6); E6 = attention and ops (§7); E7 = phone link and life loop (§8); E8 = backlog commit and cleanup (§9); E9 = scheduling rebuilt (§10); E10 = night, reminders, phone lock (§11); E12 = ORION truthful (§12); E11 = day rules and surfaces (§13).

| Hash | Date | Type | One-line meaning | Era |
|---|---|---|---|---|
| `8ef85c8` | 2026-09-21 | feat | Guarded scheduler entrypoint (`orion-automation-run`, tick adapter, `schedule-plan`); old unguarded install route removed | E1 |
| `18de992` | 2026-09-21 | feat | Astra's disabled project-agent foundation: durable controller, revisioned CLI, Projects tab status; 3 review defects fixed | E1 |
| `6307a82` | 2026-09-21 | docs | HANDOFF: Astra hands the agentic loop to Claude | E1 |
| `a32a8ae` | 2026-09-21 | feat | The local unattended development runtime: worker, reviewer, supervisor, journal, lease, containment (37 files) | E2 |
| `ac3c1ab` | 2026-09-21 | fix | Loop survives operator input and exceptions during long model calls; escalation instead of dying | E2 |
| `5737588` | 2026-09-21 | docs | HANDOFF: records the two reliability defects self-review found | E2 |
| `f2eab40` | 2026-09-21 | fix | Worker prompt: show turns and attempts separately (was 'Attempt N of 14' vs 3 real attempts) | E2 |
| `d2ca03c` | 2026-09-21 | fix | Benchmark keeps its journal (`bench-journals/`) instead of deleting the evidence | E2 |
| `a63f1f2` | 2026-09-21 | feat | Project panel: two clocks (plan vs task), streamed reasoning channel, `probe()` does a real one-token generation | E2 |
| `89cc8cb` | 2026-09-21 | test | Layout harness for the panel; fixes GUI harnesses that failed to link `MobileCore` | E2 |
| `8d76910` | 2026-09-21 | docs | HANDOFF: UI pass, streaming change and what it exposed | E2 |
| `c9ddbec` | 2026-09-22 | feat | Task-level escalation (schema v3), `diffForCheckpoint`, informational tier, qwen3.6:27b chosen for both roles | E2 |
| `d1e7e98` | 2026-09-22 | feat | Reviewer re-runs checks independently; durable subtasks; eval harnesses moved into repo | E2 |
| `bbe4575` | 2026-09-22 | docs | HANDOFF: continuity fix and the measured model choice | E2 |
| `7898699` | 2026-09-24 | agent-repair | Qwen reviewer repair of `auto-install-readback`: The worker was deadlocked — it had written correct code but made 0 corrections and never ran checks, so it had no feedback to drive progress. The… | E3 |
| `d7286b2` | 2026-09-24 | agent-repair | Qwen reviewer repair of `auto-install-transaction`: the reviewer supplied no diagnosis | E3 |
| `97cec31` | 2026-09-25 | agent | Qwen task `auto-install-transaction`: Create a durable disabled installation transaction | E3 |
| `6b696c5` | 2026-09-25 | agent-repair | Qwen reviewer repair of `auto-install-reconcile`: the reviewer supplied no diagnosis | E3 |
| `a5f4487` | 2026-09-25 | agent | Qwen task `auto-install-reconcile`: Reconcile incomplete installation without duplicate effects | E3 |
| `004b7a6` | 2026-09-25 | agent | Qwen task `auto-install-reconcile-fix1-1`: Align complete_verified idempotency with contract | E3 |
| `f529b4f` | 2026-09-25 | agent | Qwen task `auto-install-reconcile-fix1-2`: Assert evidence preservation in cleanup_failed test | E3 |
| `9855d99` | 2026-09-26 | feat | Phases 40-52 batch: cancel, trash undo, re-auth, integrity, scoped delegation, raw terminal behind in-app approval; review found 3 critical | E4 |
| `7bf79a5` | 2026-09-26 | agent-repair | Qwen reviewer repair of `auto-install-fixture-route`: The worker has written tasks 1-3 tests but never added the Task 4 tests (auto-install-fixture-route). The file ends after reconcile tests with no… | E3 |
| `bb51bbe` | 2026-09-26 | agent | Qwen task `auto-install-fixture-route`: Prove installation output reaches guarded execution (closing note: already satisfied) | E3 |
| `69f65f2` | 2026-09-26 | agent | Qwen task `auto-install-review-packet`: Write the implementation review and live-proof handoff (closing note: already satisfied) | E3 |
| `cb26fea` | 2026-09-26 | agent | Qwen task `hist-ledger`: Append-only automation history ledger | E5 |
| `d8115bc` | 2026-09-26 | agent | Qwen task `hist-summary`: Summarize a window of automation history | E5 |
| `e347f55` | 2026-09-26 | agent | Qwen task `hist-runtime-record`: Record every installed-automation dispatch outcome (closing note: already satisfied) | E5 |
| `9c36b1c` | 2026-09-26 | agent | Qwen task `hist-cron-deliver`: orion-cron-deliver keeps an outcome history (closing note: already satisfied) | E5 |
| `3407596` | 2026-09-26 | agent | Qwen task `hist-forecast`: Simulation uses history where it exists (closing note: already satisfied) | E5 |
| `6da2009` | 2026-09-26 | agent | Qwen task `hist-review-packet`: Phase 58 history review packet | E5 |
| `99bc119` | 2026-09-26 | agent | Qwen task `phase-48-packet`: Phase 48: Mac Privilege Separation evidence and next slice (closing note: already satisfied) | E5 |
| `4ce3f1e` | 2026-09-26 | agent-repair | Qwen reviewer repair of `phase-49-packet`: The worker repeatedly truncated the report before completing the mandatory 'Test Scenarios' and 'Gates and Handoff' sections, causing the doc-report… | E5 |
| `f69ed6a` | 2026-09-26 | agent | Qwen task `phase-50-packet`: Phase 50: Delegated Policies evidence and next slice | E5 |
| `1930f0d` | 2026-09-26 | agent | Qwen task `phase-51-packet`: Phase 51: Structured Terminal Operations evidence and next slice | E5 |
| `fc93c6d` | 2026-09-26 | agent | Qwen task `phase-52-packet`: Phase 52: Raw Terminal Access evidence and next slice | E5 |
| `d7053fb` | 2026-09-26 | agent | Qwen task `phase-53-packet`: Phase 53: Automation Sessions for Complex Computer Work evidence and next slice (closing note: already satisfied) | E5 |
| `f7cc85e` | 2026-09-26 | agent | Qwen task `phase-56-packet`: Phase 56: Remote Session UI evidence and next slice | E5 |
| `312b6ea` | 2026-09-26 | agent | Qwen task `phase-57-packet`: Phase 57: Automation Framework evidence and next slice | E5 |
| `8b7eff6` | 2026-09-26 | agent | Qwen task `phase-58-packet`: Phase 58: Automation Simulation evidence and next slice | E5 |
| `e076cf3` | 2026-09-26 | agent | Qwen task `phase-59-packet`: Phase 59: Proactive ORION evidence and next slice | E5 |
| `3a0d4d0` | 2026-09-26 | agent | Qwen task `phase-60-packet`: Phase 60: Focus Sessions evidence and next slice (closing note: already satisfied) | E5 |
| `61eaa00` | 2026-09-26 | agent | Qwen task `phase-61-packet`: Phase 61: Prep Cards evidence and next slice | E5 |
| `818d263` | 2026-09-26 | agent | Qwen task `phase-62-packet`: Phase 62: Waiting-On Tracking evidence and next slice (closing note: already satisfied) | E5 |
| `cc1a98d` | 2026-09-26 | agent | Qwen task `phase-63-packet`: Phase 63: Explainability evidence and next slice | E5 |
| `5cb8722` | 2026-09-26 | agent | Qwen task `phase-64-packet`: Phase 64: Confidence Handling evidence and next slice | E5 |
| `c3d4239` | 2026-09-26 | agent | Qwen task `phase-65-packet`: Phase 65: App Intents and System Integration evidence and next slice | E5 |
| `9df527f` | 2026-09-26 | agent | Qwen task `phase-66-packet`: Phase 66: Live Activities evidence and next slice | E5 |
| `1a137b4` | 2026-09-26 | agent | Qwen task `phase-66-packet-fix1-1`: Populate test scenarios with existing adjacent infrastructure or required reconnaissance (closing note: already satisfied) | E5 |
| `3e2b7d2` | 2026-09-26 | agent | Qwen task `phase-67-packet`: Phase 67: Cost Controls evidence and next slice (closing note: already satisfied) | E5 |
| `354a752` | 2026-09-26 | agent | Qwen task `phase-68-packet`: Phase 68: Reliability Testing evidence and next slice | E5 |
| `b5c1042` | 2026-09-26 | agent | Qwen task `phase-69-packet`: Phase 69: Security Attack Testing evidence and next slice | E5 |
| `f0ac8bf` | 2026-09-26 | agent | Qwen task `phase-70-packet`: Phase 70: CI/CD Security evidence and next slice | E5 |
| `1d7b475` | 2026-09-26 | agent | Qwen task `phase-70-packet-fix1-1`: Verify cited symbols exist at worktree baseline before marking Built (closing note: already satisfied) | E5 |
| `542c3bc` | 2026-09-26 | agent | Qwen task `phase-71-packet`: Phase 71: Data Inventory evidence and next slice | E5 |
| `f4ba731` | 2026-09-26 | agent | Qwen task `phase-72-packet`: Phase 72: Privacy Controls evidence and next slice | E5 |
| `bc7e954` | 2026-09-26 | agent | Qwen task `phase-73-packet`: Phase 73: Backups and Recovery evidence and next slice (closing note: already satisfied) | E5 |
| `dcefee7` | 2026-09-27 | agent | Qwen task `phase-74-packet`: Phase 74: Incident Response evidence and next slice | E5 |
| `798e7ba` | 2026-09-27 | agent | Qwen task `phase-75-packet`: Phase 75: Development Workflow evidence and next slice | E5 |
| `f9f6f2c` | 2026-09-27 | agent | Qwen task `phase-77-packet`: Phase 77: Future Apple Watch Expansion evidence and next slice | E5 |
| `8d16264` | 2026-09-27 | agent | Qwen task `phase-78-packet`: Phase 78: Future Travel Assistant evidence and next slice (closing note: already satisfied) | E5 |
| `81e8c33` | 2026-09-27 | agent | Qwen task `phase-79-packet`: Phase 79: Future Reservation Capability evidence and next slice (closing note: already satisfied) | E5 |
| `c8ab51b` | 2026-09-27 | agent | Qwen task `phase-80-packet`: Phase 80: Future Call Capability evidence and next slice | E5 |
| `5aadc56` | 2026-09-27 | agent | Qwen task `phase-81-packet`: Phase 81: Future Location Context evidence and next slice | E5 |
| `e49f7da` | 2026-09-27 | agent | Qwen task `phase-82-packet`: Phase 82: Public Release Preparation evidence and next slice | E5 |
| `030b69e` | 2026-09-27 | agent | Qwen task `phase-83-packet`: Phase 83: Multi-User Hardening evidence and next slice | E5 |
| `fd4fa9c` | 2026-09-27 | agent | Qwen task `phase-84-packet`: Phase 84: Final ORION Mobile Product Shape evidence and next slice | E5 |
| `88bed63` | 2026-09-27 | agent | Qwen task `vision-daily-experience`: Today, focus, school and project continuity | E5 |
| `8e81596` | 2026-09-27 | agent | Qwen task `vision-connected-foundation`: Phone connection and durable service recovery | E5 |
| `89cb2e8` | 2026-09-27 | agent | Qwen task `vision-attention-communications`: Unified attention, watchers and communications (closing note: already satisfied) | E5 |
| `21b56fa` | 2026-09-27 | agent | Qwen task `vision-knowledge-finance`: Knowledge capture, memory and grounded finance (closing note: already satisfied) | E5 |
| `4a3f175` | 2026-09-27 | agent-repair | Qwen reviewer repair of `vision-knowledge-finance-fix1-1`: The finance freshness seam producer row says '(assumed)' with vague notes, but acceptance criteria requires either confirmed inspection OR the exact… | E5 |
| `ddcb950` | 2026-09-27 | agent | Qwen task `vision-knowledge-finance-fix1-2`: Fix state ownership contradiction in knowledge capture seam (closing note: already satisfied) | E5 |
| `650e72c` | 2026-09-27 | agent | Qwen task `vision-voice-environment`: Voice, media, home, battery and meeting capture (closing note: already satisfied) | E5 |
| `b07ba75` | 2026-09-27 | agent | Qwen task `vision-release-recovery`: Cross-cutting release and recovery gates | E5 |
| `3e21314` | 2026-09-27 | agent | Qwen task `att-item`: Attention item shape and validation | E6 |
| `e069f78` | 2026-09-27 | agent | Qwen task `att-urgency`: Urgency from a due time | E6 |
| `56fa015` | 2026-09-27 | agent | Qwen task `att-novelty`: Novelty from recent surfacing history | E6 |
| `a0d6326` | 2026-09-27 | agent | Qwen task `att-score`: Score an item from its known signals | E6 |
| `f93b0c2` | 2026-09-27 | agent | Qwen task `att-dedup`: De-duplicate items by dedupKey | E6 |
| `83f695d` | 2026-09-27 | agent | Qwen task `att-gate`: Route an item: interrupt, file into Today, or drop | E6 |
| `00d7322` | 2026-09-27 | agent | Qwen task `att-store`: Durable attention queue | E6 |
| `1ce6099` | 2026-09-27 | agent | Qwen task `att-src-calendar`: Calendar events become 'starting soon' items | E6 |
| `0fef874` | 2026-09-27 | agent | Qwen task `att-src-waiting`: Overdue and due-today waiting items | E6 |
| `87c0b32` | 2026-09-27 | agent | Qwen task `att-src-focus`: Focus state and a gentle no-focus-yet item (closing note: already satisfied) | E6 |
| `8c27665` | 2026-09-27 | agent | Qwen task `att-src-manual`: Manual items from command-line arguments | E6 |
| `a62395f` | 2026-09-27 | agent | Qwen task `att-rank`: Rank open items into now, later and dropped | E6 |
| `79661c3` | 2026-09-27 | agent | Qwen task `att-explain`: Say why an item was shown or held back | E6 |
| `6f9b155` | 2026-09-27 | agent | Qwen task `att-budget`: An interruption budget | E6 |
| `94ad4b6` | 2026-09-27 | agent | Qwen task `att-collect`: Collect items from every source, naming outages | E6 |
| `720d6ac` | 2026-09-27 | agent | Qwen task `att-today-feed`: A Today feed file the app can read | E6 |
| `ef0e5a6` | 2026-09-27 | agent | Qwen task `att-digest`: A short digest for voice or Discord | E6 |
| `51a6642` | 2026-09-27 | agent | Qwen task `att-simulate`: Simulate a day of attention | E6 |
| `71ec4f3` | 2026-09-27 | agent | Qwen task `att-cli-read`: orion-attention: list and show | E6 |
| `d738369` | 2026-09-27 | agent | Qwen task `att-cli-read-fix1-1`: remove unused spawnSync import | E6 |
| `4d756a0` | 2026-09-27 | agent | Qwen task `att-cli-write`: orion-attention: add, ack, snooze, prune (closing note: already satisfied) | E6 |
| `89f8b55` | 2026-09-27 | agent | Qwen task `att-cli-collect`: orion-attention-collect: one pass end to end | E6 |
| `ba89a71` | 2026-09-27 | agent | Qwen task `ops-inference-summary`: Summarize the inference ledger | E6 |
| `abfba59` | 2026-09-27 | agent | Qwen task `ops-inference-cli`: orion-costs: inference cost and latency at a glance (closing note: already satisfied) | E6 |
| `087906d` | 2026-09-27 | agent | Qwen task `ops-incident-timeline`: One timeline from the audit logs | E6 |
| `93311b1` | 2026-09-27 | agent | Qwen task `ops-incident-cli`: orion-incident-timeline: read the audit logs as one story | E6 |
| `72c5bb2` | 2026-09-27 | agent | Qwen task `ops-focus-report`: A weekly focus report | E6 |
| `8be51dd` | 2026-09-27 | agent | Qwen task `ops-focus-cli`: orion-focus-report: the week in focus | E6 |
| `fa584c6` | 2026-09-27 | agent | Qwen task `ops-remote-audit-stats`: What the remote channel was asked, and what it refused | E6 |
| `c05c88e` | 2026-09-27 | agent | Qwen task `att-doc`: Attention engine architecture document | E6 |
| `59b1aa2` | 2026-09-27 | agent-repair | Qwen reviewer repair of `batch-review-packet`: The worker repeatedly produced an incomplete ATTENTION_AND_OPS_REVIEW.md: missing files (store.mjs, collect.mjs, calendar.mjs, orion-attention,… | E6 |
| `dd8f168` | 2026-09-27 | agent-repair | Qwen reviewer repair of `batch-review-packet-fix1-1`: The Proven section lists descriptive summaries of what tests prove, but the acceptance criteria requires listing each scenario from the brief's Tests… | E6 |
| `a76bd9e` | 2026-09-27 | review | Claude review: attention feed names unreadable sources only (no error text/paths); removes leftover reasoning comments | E6 |
| `4a2816d` | 2026-09-27 | review | Claude review: cron-deliver records one outcome per run (was two) | E6 |
| `58af930` | 2026-09-27 | merge | Merge: Phase 57 installer batch (qwen 7/7) | E5 |
| `636036b` | 2026-09-27 | merge | Merge: Phase 58 automation history (qwen 6/6) | E5 |
| `33dbcae` | 2026-09-27 | merge | Merge: 44 roadmap investigation packets for phases 48-84 | E5 |
| `efcdac9` | 2026-09-27 | merge | Merge: attention engine and ops tools (qwen 32/32) | E6 |
| `7947249` | 2026-09-29 | agent | Qwen task `life-block`: Block shape and validation | E7 |
| `a9e5e43` | 2026-09-29 | agent | Qwen task `life-priority`: Priority ranking | E7 |
| `b8a2e21` | 2026-09-29 | agent | Qwen task `life-weekly`: Weekly recurring schedule expansion | E7 |
| `99620b4` | 2026-09-29 | agent | Qwen task `life-template-daily`: Daily non-negotiables (closing note: already satisfied) | E7 |
| `7ddf825` | 2026-09-29 | agent | Qwen task `life-gaps`: Free gaps in a day | E7 |
| `5bc82b0` | 2026-09-29 | agent | Qwen task `life-study-parse`: Parse a study request | E7 |
| `383d1e0` | 2026-09-29 | agent | Qwen task `life-study-parse-fix1-1`: preserve original casing for unknown subjects (closing note: already satisfied) | E7 |
| `dd9aa26` | 2026-09-29 | claude | Claude hand-over task `life-fit-study`: Fit study time into a day | E7 |
| `a5cae8e` | 2026-09-29 | claude | Claude hand-over task `life-sleep-state`: Infer sleep state | E7 |
| `d20b7f3` | 2026-09-29 | claude | Claude hand-over task `life-bedtime`: Bedtime nudge ladder | E7 |
| `d601e7b` | 2026-09-29 | claude | Claude hand-over task `life-escalation`: Follow-through escalation state machine | E7 |
| `aa23df6` | 2026-09-29 | claude | Claude hand-over task `life-deferral`: Classify a deferral reason | E7 |
| `7d653a2` | 2026-09-29 | claude | Claude hand-over task `life-late-night`: Adjust tomorrow after a late night | E7 |
| `3e49366` | 2026-09-29 | claude | Claude hand-over task `life-patterns`: Learn timing patterns from history | E7 |
| `febbb60` | 2026-09-29 | claude | Claude hand-over task `life-sync-event`: Sync change-event format | E7 |
| `f76180a` | 2026-09-29 | claude | Claude hand-over task `life-sync-merge`: Merge event logs from two devices | E7 |
| `6896901` | 2026-09-29 | claude | Claude hand-over task `life-sync-apply`: Reduce events into state | E7 |
| `9467d24` | 2026-09-29 | claude | Claude hand-over task `life-next`: What should Nick do next | E7 |
| `9fa8340` | 2026-09-29 | claude | Claude hand-over task `life-cli`: CLIs: orion-next and orion-study | E7 |
| `b913b18` | 2026-09-29 | claude | Claude hand-over task `life-doc`: Review packet for the life loop | E7 |
| `e7a1f94` | 2026-09-29 | merge | Merge: Life loop (qwen 7 accepted, Claude 13 after hand-over; 112 tests) | E7 |
| `913b4b2` | 2026-09-30 | chore | Ignore Xcode/SwiftPM per-user state | E8 |
| `490d991` | 2026-09-30 | feat | Backlog group: local project-agent runtime (51 files, +9,695) | E8 |
| `6e76273` | 2026-09-30 | docs | Backlog group: agent work plans and task briefs (140 files) | E8 |
| `37c29fd` | 2026-09-30 | feat | Backlog group: daily life loop (replan, watch, check-in, reschedule, undo journal) | E8 |
| `c2eda84` | 2026-09-30 | feat | Backlog group: truthful replies, eval harness, connectors, finance, Shortcuts | E8 |
| `a796471` | 2026-09-30 | feat | Backlog group: TTS daemon, voice-ID installers, wake handling | E8 |
| `5e29292` | 2026-09-30 | feat | Backlog group: supplement edit/remove, episodic memory, catalog updates | E8 |
| `7724c43` | 2026-09-30 | feat | Backlog group: Mac app (project agent UI, life watch, phone link, finance, glance export) | E8 |
| `b59bdca` | 2026-09-30 | feat | Backlog group: ORION for iPhone (chat, plan, health, focus lock, widgets, Screen Time monitor; 106 files) | E8 |
| `1cf8796` | 2026-09-30 | docs | Backlog group: handoff, planning, vision, capability registry | E8 |
| `faf8d4e` | 2026-09-30 | docs | README rewritten around the live stack | E8 |
| `5e660de` | 2026-09-30 | docs | AGENTS rule: commit and push finished work in logical groups; handoff for 09-30 | E8 |
| `4205b85` | 2026-09-30 | fix | Day-plan replacement is one reversible transaction; NL time parser fixes | E9 |
| `afe697b` | 2026-09-30 | fix | Rebuild tangled days by priority (incremental first) | E9 |
| `1a741e9` | 2026-09-30 | agent-repair | Qwen reviewer repair of `todo-parse`: The worker has made zero progress — no files exist yet. The task requires two new files: the module and its tests. Without an initial implementation,… | E12 |
| `b8c9c5a` | 2026-09-30 | agent | Qwen task `todo-parse`: To-do parser | E12 |
| `bc659a1` | 2026-09-30 | test | Terminal tests macOS-only (CI); also carries the cleanup's deletions (vault, archives) | E8 |
| `96ff75f` | 2026-09-30 | fix | Fix stale fixtures: remote-agent lib copy; automation-install fixed NOW | E8 |
| `3a93ad2` | 2026-09-30 | fix | Rule 20 no longer flags `supplement_remove` as a calendar cancellation | E8 |
| `a27103b` | 2026-09-30 | chore | Tidy repo: archive dead material, untrack personal vault, docs index and repo map | E8 |
| `a17299f` | 2026-09-30 | ci | CI: inventory steps read the committed plugin build (`ORION_CATALOG_DIST`) | E8 |
| `fd4c88c` | 2026-09-30 | fix | Model-contract check skips absent OpenClaw config; handoff | E8 |
| `752ac71` | 2026-09-30 | fix | Scheduler rewrite: walls/pinned/flexible, keep his times and order, sensible times for untimed plans | E9 |
| `e7a6962` | 2026-09-30 | feat | Reschedule verbs: drop, overrun, bare dates, cascading delays, relative titles | E9 |
| `0f3f28f` | 2026-09-30 | docs | Scheduling guidance from 09-30 sessions; handoff | E9 |
| `35e4889` | 2026-10-01 | feat | Wake and asleep-by markers on the Mac and phone day views | E10 |
| `1fc1162` | 2026-10-01 | feat | One to-do list (Orion); ORION never plans from groceries; reminder sweep | E10 |
| `6b1da5d` | 2026-10-01 | docs | HANDOFF: markers, reminders, workshops | E10 |
| `44c1443` | 2026-10-01 | fix | Get-ready time 75 -> 105 minutes (7:15 for a 9:00 class) | E10 |
| `51e0b56` | 2026-10-01 | feat | Phone reports its Screen Time lock; ORION can grant time; monitor/defaults bugs fixed | E10 |
| `0ee7ea6` | 2026-10-01 | feat | `orion-phone-time`; lock state in live facts | E10 |
| `b47d259` | 2026-10-01 | docs | HANDOFF: phone app lock work | E10 |
| `5da0855` | 2026-10-01 | fix | Agentic: wait up to 20s for a model to unload; unload failure is not the task's | E12 |
| `900bcaa` | 2026-10-01 | feat | 'ORION truthful 2' plan; grants are 'sent' until the phone confirms | E10 |
| `1801a69` | 2026-10-01 | fix | Unconfirmed grant tells him how to unlock himself | E10 |
| `7e7f988` | 2026-10-01 | agent-repair | Qwen reviewer repair of `reply-times`: checkReplyTimes allows multiple mentions to match the same booked block because it never tracks which blocks have been claimed. Both '4:00 PM' and… | E12 |
| `0b4ede8` | 2026-10-01 | agent | Qwen task `triage`: Notification triage and digest | E12 |
| `e12f128` | 2026-10-01 | agent | Qwen task `grant-policy`: Extra phone time policy | E12 |
| `87bc5e5` | 2026-10-01 | agent | Qwen task `reply-person`: Talk to him, not about him | E12 |
| `e58c083` | 2026-10-01 | agent | Qwen task `reply-person-fix1-1`: fix capitalized name detection in isNickReference (closing note: already satisfied) | E12 |
| `83e3637` | 2026-10-01 | agent | Qwen task `reply-person-fix1-2`: remove unused node:assert import from library (closing note: already satisfied) | E12 |
| `aa401a1` | 2026-10-01 | agent | Qwen task `day-review`: Planned against done | E12 |
| `b9fc452` | 2026-10-01 | agent | Qwen task `final-fix2-1`: remove unused node:assert import from grant-policy.mjs | E12 |
| `4032800` | 2026-10-01 | claude | Claude rewrites reply-times from Qwen's draft (times belong to their clause) | E12 |
| `fc3bffb` | 2026-10-01 | claude | Claude: session trace parser and tool expectations | E12 |
| `482afc3` | 2026-10-01 | claude | Claude: 150-scenario catalog and validator | E12 |
| `5628d2b` | 2026-10-01 | merge | Merge: ORION truthful (todo-parse, trace, reply-times, triage, 150 scenarios) | E12 |
| `0a97af5` | 2026-10-01 | merge | Merge: ORION truthful 2 (grant-policy, reply-person, day-review) | E12 |
| `8645256` | 2026-10-01 | docs | HANDOFF: truthful finished and merged, phone updated | E12 |
| `017d51c` | 2026-10-01 | feat | Wake line follows actual wake (WHOOP); night lock ends in the morning | E10 |
| `936b695` | 2026-10-01 | fix | `day --todos`: one block per to-do | E9 |
| `1bcf4ad` | 2026-10-01 | feat | `now`: what he is doing now goes in, the rest slides after; ORION blocks always movable | E9 |
| `2602593` | 2026-10-01 | fix | Day rules by construction: `day-check.mjs`, cascade, true-size drawing, property tests | E11 |
| `55c5648` | 2026-10-01 | chore | Stage the surfaces plan: vendor ThinkingOrbsKit, OrionViews, checks, placeholders | E11 |
| `3034d64` | 2026-10-01 | fix | extend/resize/move/swap/rename; standing rules saved; sandbox schedule eval | E11 |
| `7e1ea26` | 2026-10-01 | feat | Thinking on (low) for text messages; eval runs choose model and thinking | E11 |
| `b4f6ae4` | 2026-10-01 | agent-repair | Qwen reviewer repair of `early`: buildWalls receives the original (unclipped) class block from `blocks.find()`, but commuteWalls is computed against effectiveBlocks (with clip… | E11 |
| `90f9e14` | 2026-10-01 | agent | Qwen task `early`: Finished-early plan (closing note: already satisfied) | E11 |
| `fcb6e16` | 2026-10-01 | agent | Qwen task `early-cli`: orion-reschedule early (closing note: already satisfied) | E11 |
| `73dc672` | 2026-10-01 | agent | Qwen task `focus-escalation`: Focus escalation rules | E11 |
| `70c69b8` | 2026-10-01 | agent | Qwen task `focus-cli`: orion-ontask tools | E11 |
| `a5cab54` | 2026-10-01 | agent | Qwen task `phone-lists`: Phone app-list policy | E11 |
| `0604567` | 2026-10-01 | agent | Qwen task `phone-lists-fix1-1`: replace assert calls with explicit TypeError throws (closing note: already satisfied) | E11 |
| `d96cab3` | 2026-10-01 | agent | Qwen task `chat-store`: Chat history store and model list (closing note: already satisfied) | E11 |

**Counts by era** (counted from the table above; they sum to 198): E1 3, E2 11, E3 10, E4 1, E5 53, E6 35, E7 21, E8 18, E9 7, E10 10, E11 12, E12 17.
