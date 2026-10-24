# 02d — History, 2026-10-02 to now: cost pressure, the prompt trim that backfired, the local-first plan, and the day it went live too early

> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: the 185 commits authored 2026-10-02 through 2026-10-13 (`d2f7745` … `6c93032`), plus the
> uncommitted worktree, `HANDOFF.md`, `ORION_V3_HANDOFF.md`, `ORION_V3_CONTINUE.md`,
> `docs/evals/**`, `docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md`, and the plugin files built in
> this range (`plugin/orion-control/src/{work-check,front-desk,local-routing,schedule-flow,account-health}.ts`).
> Read after: 02a, 02b and the (not yet written here) 02c chapter for 2026-09-21 to 2026-10-01.
> Read alongside: `05_plugin_turn_pipeline.md` (how a turn flows through the plugin; this chapter links
> to it instead of re-explaining the code).

This chapter is a narrative with line-cited anchors. The STYLE "section template" is applied per **era**
instead of per component: each era has *What was built*, *Why*, *Key commits*, *Steps back*,
*Lessons*, *Walk it yourself*, and *Questions to ask your tutor*.

## In this file

| § | Section |
|---|---|
| 0 | [How to read this chapter](#0-how-to-read-this-chapter) |
| 1 | [The story in one page](#1-the-story-in-one-page) |
| 2 | [Era 1 — Surfaces handover, schedule evaluations, the hologram (10-02)](#2-era-1--surfaces-handover-schedule-evaluations-the-hologram-10-02) |
| 3 | [Era 2 — Brain, to-dos, focus sessions and "backlog 1" (10-05 – 10-06)](#3-era-2--brain-to-dos-focus-sessions-and-backlog-1-10-05--10-06) |
| 4 | [Era 3 — Cost pressure, the prompt diet, reach and the morning (10-07 – 10-08)](#4-era-3--cost-pressure-the-prompt-diet-reach-and-the-morning-10-07--10-08) |
| 5 | [Era 4 — The revert, the V3 plan and the eval harness (10-08)](#5-era-4--the-revert-the-v3-plan-and-the-eval-harness-10-08) |
| 6 | [Era 5 — The tuning campaign and its report (10-09 – 10-10)](#6-era-5--the-tuning-campaign-and-its-report-10-09--10-10) |
| 7 | [Era 6 — Try, check, escalate: from report to plugin (10-10)](#7-era-6--try-check-escalate-from-report-to-plugin-10-10) |
| 8 | [Era 7 — Local routing goes live, fails, and is gated (10-11 – 10-12 morning)](#8-era-7--local-routing-goes-live-fails-and-is-gated-10-11--10-12-morning) |
| 9 | [Era 8 — Account health, the manual in the brain, and the research (10-12 morning)](#9-era-8--account-health-the-manual-in-the-brain-and-the-research-10-12-morning) |
| 10 | [Era 9 — Scheduling as a fixed sequence, and the live gauntlet (10-12 afternoon)](#10-era-9--scheduling-as-a-fixed-sequence-and-the-live-gauntlet-10-12-afternoon) |
| 11 | [Era 10 — Reminders and the to-do redesign (10-13)](#11-era-10--reminders-and-the-to-do-redesign-10-13) |
| 12 | [Steps back, catalogued](#12-steps-back-catalogued) |
| 13 | [Decisions and reversals](#13-decisions-and-reversals) |
| 14 | [Lessons that recur across eras](#14-lessons-that-recur-across-eras) |
| 15 | [Where things stand today](#15-where-things-stand-today) |
| 16 | [Walk the whole period yourself](#16-walk-the-whole-period-yourself) |
| 17 | [Every commit in range](#17-every-commit-in-range) |

---

## 0. How to read this chapter

### 0.1 The range, checked

The brief said "about 185 commits" and "2026-10-02 to HEAD `6c93032`". That is right, but the obvious
command gets it wrong. `git log --since=2026-10-02` returns **152**, not 185, because a bare date in
`--since` is read as that date *at the current time of day*, and 33 of the 35 commits authored on
2026-10-02 came before that clock time. Filtering on the **author date** string gives the true count:

```bash
git log --reverse --format='%h %ad' --date=short 6c93032 | awk '$2>="2026-10-02"' | wc -l   # 185
```

First: `d2f7745` (2026-10-02 02:30 +0100). Last: `6c93032` (2026-10-13 14:15 +0100). Every commit in the
range carries the London offset (+0100), so there is no clock flip like the one 02b describes.

Commits per day: 10-02 **35**, 10-05 5, 10-06 **29**, 10-07 19, 10-08 **30**, 10-09 22, 10-10 13,
10-11 5, 10-12 **23**, 10-13 4. There are no commits on 10-03 or 10-04. Git has no commits after
`6c93032`; everything newer is in the worktree (see §15).

By conventional-commit type (counted from the subject lines): `feat` 74, `fix` 56, `docs` 38, `ui` 5,
`perf` 5, `test` 2, `revert` 2 (`0691dc4`, `c95e5d4`), `merge` 1 (`e008b3c`), `eval` 1 (`54f5e05`), and one
with no type prefix at all (`d049141`, git's own "Merge remote-tracking branch" message). Net size from
`d2f7745~1` to `6c93032`: **457 files, +55,865 / −1,096 lines** (`git diff --shortstat`).

Eras, with commit counts (these are the era numbers in the §17 table):

| Era | Dates | Commits | One-line story |
|---|---|---|---|
| 1 | 10-02 | 35 | Qwen "surfaces" run finished by handover; schedule evals; hologram |
| 2 | 10-05 – 10-06 | 34 | Basic Memory brain; to-dos; focus sessions; backlog 1 |
| 3 | 10-07 – 10-08 | 31 | Cost cuts, the prompt trim, outreach, morning briefing |
| 4 | 10-08 | 18 | Revert of the trim; V3 plan; harness built in one evening |
| 5 | 10-09 – 10-10 | 27 | Tuning, grader fixes, finals, the report |
| 6 | 10-10 | 8 | Cascade replay; work check, front desk, shadow mode, "on" mode |
| 7 | 10-11 – 10-12 | 11 | "On" goes live, fails, gate added |
| 8 | 10-12 | 6 | Account health; manual in the brain; failure analysis; research |
| 9 | 10-12 | 11 | Fixed-sequence scheduling flow; live gauntlet 12/12 |
| 10 | 10-13 | 4 | Reminders; to-do redesign; sweep |

### 0.2 Who wrote what

The same two assistants as in 02b, plus Nick's own decisions in chat.

- **Claude sessions** (this period: Claude Opus 5.5). 121 of the 185 commit messages end with
  `Co-Authored-By: Claude Opus 5.5` (counted with `grep -c` over the extracted messages). `AGENTS.md:147`
  says "No Co-Authored-By lines" (the rule dated 2026-09-30); the trailer kept appearing anyway, so the
  rule is not enforced by any hook **(inferred: no hook, since the trailers exist)**. The V3 evaluation
  commits from `f1ec2f9` to `340527a` on 10-08 are Claude's but carry no trailer and long bodies.
- **Codex / Astra** (ChatGPT/Codex). The 10-02 "through Codex handover" commits, the whole hologram series,
  the Canvas commit `320626f`, and the HANDOFF entries tagged "(Codex)" are Codex's. Codex's style is
  terse subjects and dense bodies, and every ship is followed by a `docs:` commit recording installed
  build numbers and rollback paths.
- **Nick**: git records him as the author of all 185. The decisions in this chapter that are his are
  quoted from the commit bodies and handoffs, for instance "lets make sure this doesnt happen again"
  (`612f962`, 10-12).

Note the eight commits from "Orion local agent" and "Orion local reviewer" that sit just *before* the
range (`d96cab3` … `b4f6ae4`, all 2026-10-01). Those are the Qwen workers' own commits for the surfaces
run; this chapter starts with the human operator finishing that run.

### 0.3 Paths in this period

The repository was reorganised on 2026-09-15 (02b §0.4); all paths here are the current ones:
`plugin/orion-control/…`, `plugin/workspace/…`, `docs/…`, `scripts/…`, `native/…`. Private data lives
outside the repo under `~/.openclaw/orion-controlled/` (the evaluation ledger, cases, routing logs, the
acceptance record). This chapter names those paths but never reproduces their contents.

### 0.4 Jargon you need before Era 1

- **Gateway / OpenClaw.** The Node agent host in `~/.openclaw` that runs the model, loads the
  `orion-control` plugin and exposes hooks. The plugin's turn pipeline is explained in
  `docs/learn/05_plugin_turn_pipeline.md`.
- **Brain model, primary and fallbacks.** The gateway's configured model order. At the start of this range
  and today it is `anthropic/claude-haiku-4-5-20251001` first, then `ollama/qwen3.5:9b`, then
  `ollama/llama3.2:3b` (`ORION_V3_HANDOFF.md` §2.1; live config read 2026-10-14).
- **Ollama.** The local model server on `127.0.0.1:11434`. Models used here: `qwen3.5:4b-q4_K_M` (the front
  desk), `qwen3.5:9b` (the worker), `qwen3.6:27b`, `gpt-oss:20b`, `llama3.2:3b`.
- **J1–J7.** The seven job families of the V3 evaluation: front desk, simple tools, scheduling, honesty,
  brain, continuity, conversation.
- **Practice vs held-out.** The tuning cases versus the never-inspected cases used for the honest number.
- **Shadow vs on.** `localRouting` modes. Shadow logs what the local front desk *would* do while Claude
  answers; "on" lets the local models actually answer.
- **Acceptance record.** `~/.openclaw/orion-controlled/local-routing/acceptance.json`, the real-route test
  result the plugin demands before it accepts `localRouting: "on"` (introduced in `612f962`).
- **Work check / claim checker.** Code that compares what ORION *said* it did with what the tools
  *printed*. The evaluation version is `scripts/lib/eval/v3/claims.mjs`; the production port is
  `plugin/orion-control/src/work-check.ts`.
- **Gauntlet.** A live script (`scripts/eval/v3/gauntlet/run.sh`) that pushes Nick-style messages through the
  real gateway against his real calendar.
- **dist/.** The compiled plugin. It is tracked in git and is what gets deployed (`.gitignore:7`: "dist/ IS
  tracked: it is what gets deployed to ~/.openclaw/extensions"). This matters in §15.

---

## 1. The story in one page

1. **10-02.** A local Qwen project that was building ORION's phone and Mac surfaces stalled at 54 percent.
   Codex (a human-in-the-loop assistant) repaired the runtime, finished the seven blocked tasks by hand, and
   a Qwen 27B reviewer signed off, 14 of 14. In parallel the schedule evaluation compared Haiku, Sonnet 5 and
   two Qwens: Haiku and Sonnet could do the job; Qwen 9B could not (10/22). A usage screen shipped that
   showed the all-time API spend and call count for the first time.
2. **10-05 / 10-06.** The brain (Basic Memory), to-dos with spreads and parts, focus sessions and a voice
   guard shipped in two long days, plus the first "recurring failures in real chats" audit.
3. **10-07.** Cost became the driver. A local 9B started filtering overheard speech before Claude saw it, the
   always-on prompt files were cut by roughly a third (`f17471c`), and the tracked "hard" evals said it was
   fine. **It was not.**
4. **10-08.** ORION said "Done" to a reschedule that printed `NOTHING WAS BOOKED`. The trim was reverted
   (`0691dc4`, 15:26). Nick and Claude then wrote the V3 plan (a local-first evaluation: can small local
   models do ORION's jobs honestly?) and built the entire harness the same evening.
5. **10-09 / 10-10.** A long tuning campaign. Prompts were engineered per model; graders were fixed by
   reading transcripts; held-out finals measured the honest numbers. Result: a 4B front desk at 89 percent
   (no model passed the 95 percent gate), a 9B that was perfect at simple tools and honesty, and scheduling
   still the hard job (best 27/36). The recommendation: "try, check, escalate", not a category "deep" tier.
6. **10-10 night.** The recommendation was ported into the plugin in about 15 minutes of commits: work check,
   front desk, shadow mode, then "on" mode.
7. **10-11 / 10-12.** "On" went live on evaluation numbers alone. It failed Nick's first real request three
   ways (`18c8f85`, `966cd63`, `0372a72`). A real-route acceptance gate was added (`612f962`) and routing
   went back to shadow. The same day it emerged that the Claude API had been out of credit since
   2026-10-11 19:23, and nobody knew; an account-health alert was built (`513276d`).
7a. **Root cause (10-12 13:25).** The live 9B was running at Ollama's defaults (temperature 1.0, presence
   penalty 1.5) while the evals used temperature 0. Fixed in live config (not in git).
8. **10-12 afternoon.** Scheduling became a fixed sequence in code (`schedule-flow.ts`): code reads the day,
   the 9B fills a small form, code compiles the exact command. Live gauntlet: 12/12.
9. **10-13.** Reminders (`alarm_set`, never a to-do), a redesigned shared to-do list, and a sweep that
   removes the booked sessions of finished to-dos.

The chapter's single biggest lesson is on line 4 to 7: **an evaluation that does not look like production
(different prompt, different sampling settings, different tool surface, different calendar) produces numbers
that do not transfer.** It happened twice in four days, once with the cost trim (evals said 22/22) and once
with the local routing (evals said 89 to 100 percent, live said 0/3).

---

## 2. Era 1 — Surfaces handover, schedule evaluations, the hologram (10-02)

Thirty-five commits, `d2f7745` (02:30) to `302fb8b` (22:07). Half are `docs:` commits that Codex writes
after every installed build.

### What was built

**(a) The "ORION surfaces" run, finished by handover (02:30–02:45).** On 2026-10-01 the local agentic dev
loop (Qwen workers plus a Qwen reviewer, described in the README under "Builds itself") ran a project called
"ORION surfaces" (id `project-ac531385-b605-4b4a-a2dc-296d14bef7a0`, branch `orion-agent/12c3eb5b`,
`HANDOFF.md` 2026-10-02 02:45 entry). It stopped at 54 percent: seven accepted tasks, three blocked, four
queued. The HANDOFF entry gives the causes:

- A repair edit matched two places in a file; the runtime called that "a judgement refusal" and parked the
  blocker.
- The watchdog counted the already-parked blocker again on every unrelated iteration and raised a false
  run-level escalation.
- Phone tasks hit an out-of-scope widget build error.

Codex's fixes: `d2f7745` ("recover rejected repair edits and count distinct failures") and `ad02048`
("validate host transitions before publishing state"). The second was found during the handover itself: a
manual run-status update with an invalid status exposed that the controller only validated state on the
*next read*, not before publishing it. The commit message says the fix validates "the full next snapshot
before its atomic publication", and a regression test proves a rejected transition leaves the snapshot,
journal and revision unchanged.

Then seven near-simultaneous commits at 02:32 finish the blocked tasks "through Codex handover":
`3dc76c5` (Flux turn tracker), `2e6a045` (orb views), `d73711b` (phone composer), `6628d0a` (finished-early
UI), `2306e74` (summon composer), `d988191` (chat-mode views), `3bfc08b` (focus lists). Their bodies state what
was implemented and the verification (for example 12 Flux tests pass; phone simulator build passes). A
prerequisite repair `86b52d3` ("expose chat value initializers…") is flagged as "outside the local worker
task scopes and performed under Nick's direct repair request".

Honest labelling matters here. The HANDOFF entry says: "code authorship is Codex operator, not Qwen. No
task criteria were weakened." Every handover commit and check was submitted through the project's own
review path (`runProjectAgent`, `recordReviewerRepair`, `reviewProjectTask`). Then `e008b3c` merges the
branch; an independent live review by `qwen3.6:27b` returned PASS; the controller read `completed`,
`finalReview: true`, 14/14 accepted, 100 percent. `e7b0efa` removes a contradictory "restart the
supervisor" hint that the finished run still displayed. Verification quoted in `357a227` and the HANDOFF:
946 Node tests and 64 Swift tests.

**(b) The scheduling evaluation (10-01 results landing 10-02, `5293e1a`).** A prior session ran the 16 core
schedule scenarios through the real phone route on a sandbox calendar for four brain models. The summary
file `docs/evals/2026-10-01-schedule/SUMMARY.txt` shows:

| Model / thinking | Result | Median |
|---|---|---|
| Haiku 4.5, medium | 6/16 | 14 s |
| Sonnet 5, medium | 8/16 | 10 s |
| qwen3.5:9b, medium | 1/16 | transport failure |
| qwen3.6:27b, medium | 1/16 | transport failure |
| qwen3.5:9b, off | 5/16 | 27 s |
| qwen3.6:27b, off | 4/16 | 93 s |

(Source: `docs/learn/_fragments/raw/eval-system.md` §5.1, which read `SUMMARY.txt:1-7`. I confirmed the file
exists; the two Qwen "medium" rows are transport failures, "Model override … is not allowed for agent
main" and a rate-limit message, not model results.)

Those first-pass numbers were low for Claude too, because the *tools and the grader* had bugs. `NEXT.md`
(`docs/evals/2026-10-01-schedule/NEXT.md`) lists the fixes, and `0a0aa7e` (11:12) ships most of them:

- per-date **pins** in `pins.json` so a time he sets stays put when a later command cascades;
- renaming onto an existing block reuses it instead of creating a duplicate;
- a saved minimum (his 75-minute nap rule) now applies to today's future blocks;
- relative moves, `orion-reschedule move "X" --by 30`;
- the **"instant no-reply" bug**: session and envelope IDs were stamped to the minute, so a scenario re-run
  in the same minute tripped the inbound replay guard before any inference. The fix is millisecond IDs and
  separate eval replay/rate-limit files;
- the grader now counts transport failures as failures, and accepts a displaced task only when the reply
  names it and asks a decision.

After those fixes the 22-scenario run (16 core plus 6 combined/quality cases) is
`docs/evals/2026-10-02-schedule/SUMMARY.txt:6-10`: Sonnet 5 medium 20/22 then 21/22 (core 15/16 to 16/16),
Haiku 4.5 medium 20/22, Qwen 3.5 9B off 10/22 (core 8/16, median 34 s). The summary's recommendation:
"Sonnet 5 medium for complex schedule edits; Haiku 4.5 medium for quick API answers/simple edits … Qwen 3.5
9B has not passed the schedule gate". That is the baseline against which every local-first claim in the rest
of this chapter should be read.

One piece of this is still uncommitted (see §15): a later run of the Qwen 9B with thinking on
(`qwen-thinking-medium.log`, "14/22 passed … median 29 s per request") exists only in the worktree, together
with a note appended to `SUMMARY.txt` and a one-line runner `run-qwen-thinking.sh`.

**(c) Native surfaces wired into the Mac app (`ff0ec35`, 11:12; `499f02e`; `8dd68c4`).** Shared chat history
and selected gateway sessions across Home, planning and the phone link; the floating composer; orb phases
tied to real "post-answer thinking" (the app stores the assistant's actual reasoning after the answer
completes, never invented progress text); Flux `EndOfTurn` for voice with Apple speech as fallback;
finished-early and Done routed into rescheduling. Then two UX fixes: a "Back to Home" button (`499f02e`) and
renaming the Tasks tab to **Plan** with a compact composer instead of an embedded chat (`8dd68c4`).

**(d) The usage screen (`5b24215`, 14:27).** `scripts/orion-usage` reads every model call from OpenClaw's
trajectories and ORION's own local calls, deduplicates, and reports per model, day and "inferred lane". The
HANDOFF entry (2026-10-02 14:26 BST) records the first all-history totals when the Settings view was checked
against the CLI: **2,281 calls, 54,296,696 tokens, $7.1418 recorded, 1,470 unpriced cloud calls**. Nobody had
that number before. It is the first visible step of the cost story in Era 3. Same commit adds
`orion-conversation-bench`, a dry-run-by-default harness comparing local and hosted models on 12
calibration cases; the commit body says no model benchmark ran for this setup.

**(e) Scheduling rules and the early-exit button (`ae41446`, 15:34).** One **I'm out early** button replaced
two choices; `SCHEDULING.md` was created and injected into planning turns (buffer 5, commute 45, nap 75,
side project 60, campus rules); evaluation check-ins moved to isolated storage. (This commit has no body;
the facts are in the HANDOFF entry 2026-10-02 15:34.)

**(f) The Thinking Orion hologram (eight commits, 15:34–22:07).** `ae41446` introduced the full-size gold and
purple "Thinking Orion" hologram; the following commits tune it: combined layers slowed to 45 percent speed
and *speak only for voice turns* (`e34a9c6`); render in one batched Canvas (`83f92fc`); keep thinking gold
(`dd8a0a8`); balance around the foreground orb (`4ad1e3e`); share it on the phone's full-screen talking
mode (`0903801`). Each is followed by a `docs:` commit with the installed build number (475 → 477 → 479 → 481
→ 483 → 485 → 487 → 489 → 491; the previous bundle is always kept at
`/Applications/.Orion-previous-<n>-….app`).

### Why

- **Surfaces run.** The README promises the local agent builds ORION's own modules (the "Builds itself" row).
  This was the first real project that exercised it end to end on phone and Mac UI, and it needed a human to
  finish it. The handover was designed to keep the record honest: who wrote what, and what review passed.
- **Schedule evaluation.** Nick wanted to know whether a cheaper or local brain could do scheduling. The
  honest answer on 10-02 was "not yet", and that answer is what motivated V3.
- **Usage screen.** Cost was becoming a concern, and nobody could say what ORION cost.

### Key commits

| Commit | Date | What |
|---|---|---|
| `d2f7745` | 10-02 02:30 | Runtime: rejected repair edits recover; distinct failures counted |
| `ad02048` | 10-02 02:41 | Runtime: validate the whole next snapshot before publishing |
| `e008b3c` | 10-02 02:40 | Merge: surfaces complete after handover and Qwen final review |
| `5293e1a` | 10-02 10:06 | The 10-01 schedule evaluation results |
| `0a0aa7e` | 10-02 11:12 | Pins, saved minimums, relative moves, unique eval IDs |
| `ff0ec35` | 10-02 11:12 | Native chat, Flux turns, schedule focus wired in |
| `5b24215` | 10-02 14:27 | `orion-usage` and the conversation-comparison harness |
| `ae41446` | 10-02 15:34 | Early-exit button, SCHEDULING.md, Thinking Orion |
| `83f92fc` | 10-02 16:00 | Hologram batched into one Canvas |
| `0903801` | 10-02 22:05 | Phone talking mode shares the hologram |

### Steps back

1. **The 54 percent stall.** The agent loop's own watchdog produced a false escalation by re-counting the
   same parked blocker (`d2f7745`). A system built to catch failures miscounted one.
2. **A validator that only ran on read.** `ad02048`: a bad status could be *published* and only noticed
   later. The fix moved validation before the atomic publish.
3. **The two Qwen "medium" rows were never model results.** They looked like 1/16 for the 9B and 27B. They
   were an OpenClaw permission error and a rate limit (`docs/learn/_fragments/raw/eval-system.md` §5.1). If
   you quote that table, quote it with the caveat.
4. **Evaluation tests were pushing real notifications.** The `ae41446` HANDOFF entry says the "confusing
   live notifications came from two test-generated check-ins"; Codex backed up state and cancelled those
   two records, and moved evaluation check-ins to isolated storage. Same bug family as the Discord alert in
   `c2eda84` (see the eval dossier §7): an eval touching the live world.
5. **The "literal hybrid" hologram lagged badly.** Nick reported it; the profile showed two animated
   Canvases plus blur. The repair (`83f92fc`) cut Orion from 20.5 to 16.5 percent of a core and
   WindowServer from 40.5 to 14.2 percent over an eight-second sample (HANDOFF 2026-10-02 "Combined hologram
   lag repair"; the entry notes a first post-install sample was confounded by an unrelated Ollama job and is
   kept separate).
6. **Minute-resolution IDs.** The "instant no-reply" was an artefact of the harness, fixed in `0a0aa7e`.

### Lessons

- When an automated builder stalls, finishing by hand is fine, **provided the record says so** and the
  independent review still runs.
- State validation belongs *before* a write, not after.
- A failed evaluation row is a bug report on the harness until proven otherwise. This lesson comes back in
  Era 4 as "a 0 percent means a grader bug, read first".
- Building a cost view first (`orion-usage`) was the right order: every later cost decision cited its numbers.

### Walk it yourself

```bash
# the surfaces handover, in order
git log --reverse --format='%h %ad %s' --date=format:'%H:%M' d2f7745~1..e7b0efa
git show -s --format=%B ad02048
# the 22-scenario schedule result files
sed -n 1,12p docs/evals/2026-10-02-schedule/SUMMARY.txt
# the pins fix
git show --stat --format=%B 0a0aa7e
```

Open `HANDOFF.md` and search for "02:45 BST" (the surfaces entry) and "14:26 BST" (the usage entry, which
holds the 2,281-call figure).

### Questions to ask your tutor

1. Why did the agentic loop count a parked blocker repeatedly, and why is "count distinct failed executions
   once" the right fix?
2. What is an "atomic publication" of state, and why does validating after publishing defeat it?
3. Why were the two Qwen medium rows in the 10-01 schedule table not evidence about Qwen?
4. What does a session ID with minute resolution have to do with a replay guard?
5. Why does the app store the assistant's real thinking after the answer instead of showing progress text?

---

## 3. Era 2 — Brain, to-dos, focus sessions and "backlog 1" (10-05 – 10-06)

Thirty-four commits: five on 10-05 (`6830e6d` … `b748c40`) and twenty-nine on 10-06 (`e11dc82` … `eeb0c81`).
No commits on 10-03 or 10-04. Nearly all are Claude's, with long explanatory bodies.

### What was built

**(a) Day rules that code and prose share (`6830e6d`, `295000a`, 10-05 morning).** The trigger was a real
bad day: a three-hour gap between a 12:30 lecture and a 15:30 lab got no travel time, so the short-night nap
was booked at 12:30, 30 minutes long, against his own 75-minute rule. The body of `295000a` is a small
design lesson: "The 12:30 nap happened because the rule lived nowhere: the commute code knew only the first
and last class, SCHEDULING.md told the brain to stay on campus between classes, and the watcher that booked
the nap never reads prose." The fix is one number, `homeGapMinutes` (2.5 hours), in life-config, read by
the commute-wall code *and* quoted by `SCHEDULING.md`, plus a **rank** (fixed / high / medium / low) on
every block, with his own words settable through `orion-life rank`.

**(b) The Basic Memory brain (`cd1bcb6`, 10-05 10:13).** The commit message records the audit that
justified it: the Obsidian vault "had ~40 notes, nearly all about ORION's internals and none about Nick;
recall had not been used successfully since early September, and Ollama (which recall's embeddings need)
was not running." The replacement is Basic Memory (AGPL, local, Markdown with `[[links]]`) pointed at
`~/Documents/orionBrain` as project `orion`. `orion-brain-seed` builds linked notes from real sources:
`USER.md`, `SCHEDULING.md`, life-config, his courses and campuses, projects and every daily memory file,
for **93 notes and 203 links**. `orion-brain` (allowlisted) offers `search`, `read`, `context`, `learn`,
`recent`. The commit explains the route: "OpenClaw's embedded runner does not receive MCP servers, so the
CLI is the route." Standing rules he states land in a note named "Learned about Nick". `97e80d1` adds a
six-phase plan for the local agent to learn into the brain.

**(c) To-dos that plan themselves (`e11dc82`, `b1b530b`, `d133e92`, `5ff7aee`, `75ebf7e`).** A to-do on the
"Orion" Reminders list carries a due date, a **spread** written in its notes ("2 hours a day until it's
due", "two 2-hour blocks, Tuesday and Thursday", "four 1-hour blocks this week") and a priority.
`orion-tasks add|set|list|plan` turns that into sessions through `orion-reschedule`, so the day rules,
travel walls and undo all apply, and the watcher re-plans every morning. Then: groups with **parts**
(`- [ ] Course · 40%`), editing on the phone and a Mac "Edit" popover, parts that drag like to-dos, and
to-dos that **wait for another** to finish (`75ebf7e`). The to-do notes grammar lives in one place on
purpose (`MobileCore.TaskNotes` in Swift and `scripts/lib/life/task-notes.mjs` in Node, "one format").

**(d) Approvals that actually run (`e568abb`).** After "I didn't go to Marketing, delete it" on 10-06,
ORION undid his own changes and used the generic calendar delete, which needs approval and on a repeating
class removes the series' first occurrence. Nick approved and nothing happened, "because an approval is a
permission slip ORION must act on and nothing told him it existed." Fixes: `orion-reschedule skip` (just
that occurrence, no approval, undoable), a bridge that deletes a single occurrence by its start, and
`orion-approve` now starts `orion-approve-resume`, which asks ORION to run the approved call in the
conversation that asked.

**(e) Canvas facts in the brain (`320626f`, Codex).** `orion-connect canvas-course <id>` takes complete,
GET-only snapshots (syllabus, assignment availability, classic quiz metadata) with the token kept in the
existing Keychain reader, and `orion-brain canvas-refresh` updates only marked sections of existing course
notes, with exclusions, backups and local-edit conflict checks. 17 regression tests added.

**(f) Focus sessions rebuilt (`6eb4dca` … `8fc00be`, `656db4d`, `87b49ed`).** The bug story is in "Steps
back". What shipped: `orion-session start --minutes N | --until HH:MM`, any work/break sequence ("20w 5b
40w", number words), start part-way, recover an ended session, today's total; a Music panel with a
playlist picker; **minimise floats the session** over every app as a thin bottom-middle bar (a
borderless `NSPanel` that can take clicks).

**(g) Other 10-06 pieces.** `orion-project-run` and `orion-project-queue` let ORION list, start, queue and
stop Qwen projects from chat, "registered projects only, never --enable" (`de9221b`, `b748c40`);
`orion-log-audit` finds recurring failures in his real chats by category (refusals, tool errors, repeated
calls, rephrased requests, frustration, slow replies; it "reads Nick's words only") (`de87e8c`);
`app_open` finds Finder (`e109b8e`); Escape or "Done" ends a voice turn and Left Option is a second
push-to-talk key (`01576d2`); a stale phone-lock report older than 15 minutes now reads **UNKNOWN NOW**
(`2234adf`); the Mac window behaves like a normal window (`528a99b`).

**(h) The P0 phone-voice guard (`4000a9d`).** "The phone re-listened forever and sent background speech as
messages." A `VoiceSessionGuard` ends a voice conversation after 45 s idle, 15 minutes, 30 turns, or three
noise-only turns; leaving the screen ends it; a stopped session can never listen again or send. The planning
docs `41e22f1` and `8f6d350` (backlog 1, "by owner, batch and dependency") are where this was scoped.

### Why

Nick was using ORION daily and each real failure became a commit within hours. This is the "real use finds
the bugs" mode that Era 3 and the V3 plan later formalise (`orion-log-audit` is its first tool).

### Key commits

| Commit | Date | What |
|---|---|---|
| `295000a` | 10-05 09:22 | One class-wrapper rule for code and prose; every block ranked |
| `cd1bcb6` | 10-05 10:13 | Basic Memory brain, 93 notes, `orion-brain` CLI |
| `e11dc82` | 10-06 15:53 | To-dos with due dates, spreads, priorities, planned into sessions |
| `e568abb` | 10-06 16:57 | `skip` without approval; approvals actually run |
| `1e99edc` | 10-06 17:14 | `--until` real; unknown options fail with NOTHING WAS CHANGED |
| `2b4301c` | 10-06 17:21 | A stuck turn ends after three repeat-guard blocks |
| `6eb4dca` | 10-06 18:02 | Focus: `orion-ontask` stops overwriting the app's session file |
| `4000a9d` | 10-06 21:35 | P0: phone voice session guard |
| `de87e8c` | 10-06 21:38 | `orion-log-audit` |

### Steps back (each is a bug found in real use, with its root cause)

1. **The 12:30 nap (10-05).** A rule that lived in three places (code, prose, a watcher) and agreed in none.
2. **`--until` silently ignored (`1e99edc`).** "Plan things until around 8 PM" passed `--until`, which did not
   exist; the tool ignored unknown options and the evening ran to 21:29. Fix: any option the tool does not
   have is refused with **NOTHING WAS CHANGED**. This is the first appearance of the "refuse, don't ignore"
   principle that is later applied to `orion-tasks` too (`b5bf4ab`).
3. **The two-minute spin (`2b4301c`).** "Delete all scheduled tasks for today": the agenda refusal told ORION to
   use "typed Calendar actions", it looped on a malformed call, and the repeat guard blocked it **30 times
   without ending the turn**. Fix: after three guard blocks a run gets no more tools and must reply.
4. **A tool overwrote the app's state (`6eb4dca`).** `orion-ontask` kept its state in `focus-state.json`, the
   Mac app's own session file, and overwrote it, so the app could not start or show a session. Meanwhile
   ORION started the retired CLI lockdown `orion-focus`, "which nobody could see, allowed no browser and
   nagged on Discord". Fix: its own file `ontask-state.json`, `orion-focus` removed from the allowlist.
5. **Music got quit by the distraction reviewer (`e9cfc38`).** A session paused Music when "pause music" was
   on, and the reviewer then quit it as "not part of certification work".
6. **Shuffle that toggled twice (`475b14a`).** Music reports the change a moment late; the app read the old
   value back 0.12 s later and a second press undid it.
7. **The float that vanished (`8fc00be`).** It followed `isActiveFocus`, false while paused, so pausing hid
   the bar and left no way to resume.
8. **End-break lengthened the break (`87b49ed`).** "End break" sent the time served as the time to leave, so
   each press doubled the break.
9. **A phone told the Mac he was away (`2234adf`).** The phone reports its lock only when he messages from
   the phone app, so a voice turn on the Mac saw a two-hour-old "not locked".

### Lessons

- **One rule, one home.** If code and prose both state a rule, make one of them quote the other's source.
- **Refuse unknown input loudly.** A silently ignored option is a false success waiting to happen.
- **A guard that blocks but never ends the turn is a loop with extra steps** (`2b4301c`).
- **Don't share a state file between two writers** (`6eb4dca`).

### Walk it yourself

```bash
git show -s --format=%B 295000a cd1bcb6 e568abb 2b4301c
sed -n 1,40p scripts/orion-tasks         # the grammar and help of the to-do planner
git log --reverse --format='%h %s' --date=short 6830e6d..eeb0c81 | grep -c .   # 34
```

### Questions to ask your tutor

1. Why did the 12:30 nap happen even though `SCHEDULING.md` told the brain to stay on campus?
2. What does "an approval is a permission slip ORION must act on" mean in terms of the approval flow
   (read `docs/learn/04_plugin_core_actions_gate.md` for the gate)?
3. Why is the to-do spread kept in the Reminder's *notes* instead of a database?
4. What would be a good test for "a guard that blocks 30 times without ending the turn"?
5. Why was `orion-focus` removed from the allowlist rather than fixed?

---

## 4. Era 3 — Cost pressure, the prompt diet, reach and the morning (10-07 – 10-08)

Thirty-one commits from `c2e1824` (10-07 09:10) to `b6d72ea` (10-08 09:40). This is the era where "the
bill" starts driving decisions, where ORION is taught to speak first, and where the most instructive
mistake in the whole range is made: `f17471c`.

### What was built

**(a) Cost cuts (three commits).**

1. **`18c29b9` — overheard speech no longer reaches Claude.** Follow-up turns and barge-ins open the
   microphone without the wake word; "33 such turns in two days came back NO_REPLY (14% of the API
   bill)". A local `qwen3.5:9b` check (8/8 on real lines, about 0.4 s) drops background speech first,
   with the safe default "any doubt, timeout or missing Ollama sends as before". It was implemented as
   `AddressGate.swift`.
2. **`f17471c` — the trimmed always-on prompt.** Subject: "trimmed always-on prompt (56k → 40k chars,
   nothing removed); harder evals". I measured what it did to the four workspace files by reading the
   blobs before and after:

   | File (`plugin/workspace/`) | Before (`f17471c~1`) | After (`f17471c`) | After the revert (`0691dc4`) |
   |---|---|---|---|
   | `AGENTS.md` | 29,502 bytes | 22,948 | 31,392 |
   | `SOUL.md` | 4,742 | 2,025 | 4,742 |
   | `USER.md` | 4,276 | 1,660 | 4,276 |
   | `MEMORY.md` | 3,201 | 1,219 | 3,201 |

   `TOOLS.md` was made "an index; `orion-help <tool>` prints the full usage" (`scripts/orion-help` is new
   in this commit). The scheduling, phone-lock, focus and connection rules were kept as a "Topic rules"
   section at the end of the cached prompt (`plugin/workspace/AGENTS.md:134` in that commit). The commit
   body adds that an alternative, attaching topic rules per message, "was tried and measured MORE
   expensive (an uncached write costs 12x a cached read)", and a live-config line: "1-hour prompt cache for
   Haiku and Sonnet" (`cacheRetention: "long"` in `openclaw.json`, not in git).
3. **`f11402b` — usage on Home.** Today's spend in the corner; opened, the whole picture. `orion-usage` prices
   Claude "at real rates incl. 1-hour cache writes", reports today, 7 days and month against budget,
   projects the month, and marks local calls free. The overheard-speech check logs its own local calls
   into it.

**(b) The thinking policy (`9e901a9`, narrowed in `26baa71`).** `ThinkingPolicy` (Mac and phone Swift, mirrored
by `scripts/lib/thinking-policy.mjs`) decides per message whether to ask for model thinking: off for talk and
one-step commands, low for "his day / to-dos / times or several steps", on the Mac two failed tool calls in
a turn keep thinking on for 10 minutes; "local models never think" (`scripts/lib/thinking-policy.mjs:1-6`,
and `thinkingLevel` returns "off" for any `ollama/` model). The same commit adds `move --after/--before/--gap/--until`
so "directly after CS lab, ending 20 before DS" is one call.

**(c) Scheduling correctness fixes.** `2f89313`: "CS lab" matched the 11:00 *CS2100 Lab* class, because short
words were dropped; `move`/`resize` refused and `skip` **deleted his class** on 10-07. Also found in that
commit: `orion-tasks` and six other scripts had been committed with mode 644, so **every new to-do failed with
"permission denied"**; now 755 with a test that keeps it so. `a7f506b`: `orion-reschedule` refuses two
commands in one call, because "`drop X move Study --by 30` deleted Study and ORION reported both changes
done", and block names now use his own words.

**(d) Outreach, "reach" (`a139f4b`, `562c9f1`, `094ebe2`, `26baa71`).** ORION messages Nick first.
`orion-reach` delivers by presence (phone, a silent Mac bubble, or aloud), with a chat thread, no repeats and
quiet hours. `orion-presence` and `orion-watches` (weather, important people, a text gate, mail triage with
local Qwen only when plugged in) feed it, run every five minutes from the app. `orion-proactive` speaks with
context: a finished session says how it went; bedtime wind-down only when he is home and not in a session;
leave-soon; "free time with an open to-do" (as a question); "due tomorrow and nothing booked" (evening).
Reminders now fire through `orion-reach` as urgent with a label (`224687a`).

**(e) Morning (`dce48ae`, `f1fe2b2`, `27242e0`, `98a810c`, `2e27833`, `188afeb`, `98065bf`).** A morning
briefing when the phone says he is actually up (unplugged, or three minutes of use after the alarm; via
CloudKit), aloud at full volume; an LED strip (Lotus Lamp X over Bluetooth) turned on first; a full-screen
frosted panel with the day on the left and weather with hourly rain on the right that wakes the display.
Two commits have the same subject (`27242e0`, `98a810c`, "morning screen with the day and the weather"):
the second is the real implementation; the first was an earlier, smaller version.

**(f) The quick menu (`c2e1824`).** Option-Tab opens a palette (now/next, live session, smart commands,
typed `focus 90`, `todo …`, `open <app>`; anything else is asked of ORION), keeping the AUTO/NOTIFY-only rule.

### Why

Nick's own words, as the V3 handoff records them (`ORION_V3_HANDOFF.md:44-50`): the Claude API (Haiku 4.5
primary) "is costing more than he can afford; he is nearly out of credit again. His target was $10–15 a
month." Testing changes needs the API, which costs more, which is a loop. Era 3's cost commits are the
first three attempts to reduce spend *without* changing the model.

### Steps back

1. **The overheard-speech gate lasted about 22 hours (`18c29b9` 10-07 09:38 to `e5cd0d0` 10-08 07:45).**
   `e5cd0d0` removes `AddressGate.swift` entirely (−60 lines): "The local 'said to ORION?' gate dropped real
   follow-ups". The HANDOFF 2026-10-08 07:30 entry gives the count: it "dropped 5 real follow-ups on
   2026-10-08 and pushed him to push-to-talk". The saving was real (14 percent of the bill) but the
   false-drop rate was not zero, and for a voice assistant a dropped follow-up is a broken conversation.
   Cost cut: reverted. **Cause: a classifier tuned on 8 lines was trusted with live traffic.**
2. **The prompt trim (`f17471c`) made ORION worse; it was reverted by `0691dc4` on 10-08 at 15:26.** This is
   the central step back of the era. The facts, from the repository:
   - The trim shipped with evaluation evidence. `docs/evals/2026-10-07-prompt-diet/` has twelve result files.
     By my count of the logs (from the eval dossier, §5.4): baseline 22/22, after 22/22, after2 21/22,
     v3-core 10/18 (aborted), v4-core 22/22, hard-1 10/14, v4-hard 10/14, v5-hard 2/4, final-core 12/22
     (many "Orion did not finish: aborted / taking too long" transport failures, median 84 s), final-hard
     9/14, rerun-core 9/10, rerun-hard 0/5. The headline in commit `54f5e05` is "Core 22/22; hard 13/14 on
     Claude with clean runs"; the dossier could not reconstruct 22/22 and 13/14 exactly from the committed
     files (it adds first runs and reruns of network failures). Treat the headline as optimistic.
   - What the evals measured was **scheduling scenarios in a sandbox**. What went wrong in real use was
     different: on 10-08 Nick asked ORION to redo his day around leaving at 4 PM and ORION said "Done" when
     the tool had printed `NOTHING WAS BOOKED` (`ORION_V3_HANDOFF.md:48-50`; the tool's message is at
     `scripts/orion-reschedule:990`). The revert commit body says only: "ORION got worse after the trim
     (2026-10-08: a reschedule he said was done never happened)".
   - The repository **records that it got worse, not why**. The text "NOTHING WAS" is still in the trimmed
     `AGENTS.md` (counted at `f17471c`), so the honesty rule was not simply deleted. A plausible cause is
     that tool semantics moved behind `orion-help`: the V3 campaign later found exactly that failure mode
     ("TOOLS.md / orion-help hide tool semantics. … models misread `extend`", `ORION_V3_CONTINUE.md`
     section 3, item 1). **(inferred; not proven by any commit.)**
   - The revert restores the four files to the pre-trim bytes (the table above: 31,392 bytes for AGENTS
     because it kept later additions) but keeps "the later additions (focus sessions, reminders, reach,
     lights, weather, naming blocks, skipping a class)". It does *not* restore the 1-hour cache, which is
     config.
3. **A claimed saving that cost more.** The HANDOFF 2026-10-07 entry: "Measured: moving rules out of the
   cached system prompt costs MORE and moving the phone's per-message rules into it made Haiku worse — both
   reverted." Prompt caching bills a cache write at a multiple of a read, so per-message attachment loses.
4. **Phone voice would not start (`138c00a`).** The P0 guard of `4000a9d` ended voice on `scenePhase
   .inactive`, which a banner or a permission check also triggers, so nothing listened. A single real word
   ("yes", "Friday") was also being judged noise.
5. **A script that "worked" but made nothing (`2f89313`).** 644 vs 755: a to-do tool that could not run was
   noticed only because a human tried to add a to-do.
6. **Reminders that didn't reach him (`224687a`).** A reminder fired as a silent line in the Mac window;
   `reminder_cancel` never worked because "in the flattened step form the reminder id became the step name";
   ids came from the millisecond and two reminders set together shared an id, so cancelling one removed both
   (`b9786d2`, found by the new cancel-by-name test).
7. **Focus sessions that did nothing (`224687a`).** ORION started "focus sessions" with `orion-ontask`, a
   distraction *watcher*, and said done.
8. **A phone alarm storm.** The 10-08 HANDOFF entry says overlapping refreshes each scheduled an AlarmKit
   alarm and orphaned the rest; "he had to snooze '20 million'" (`188afeb` serialises scheduling).

### Lessons

- **Cost is a goal, not a test.** The trim passed the tests that existed and failed Nick's real request. The
  lesson written into the V3 plan is that a change must be judged against *his real messages*, which is why
  V3 begins by mining his logs (Era 4).
- **Fix the lens before the lens-dependent decision.** The trim decision relied on 22 core and 14 hard
  scenarios that had never included a "did it say Done after NOTHING WAS BOOKED" case; `claims.mjs` (Era 4)
  is that case, made systematic.
- **A cheap local filter must be measured on its failure direction.** The gate's failure was dropping a real
  request, the expensive direction. Later, the front desk keeps "ignore" from ever silencing a turn
  (`plugin/orion-control/src/local-routing.ts`, comment on step 1: "a wrong 'not for ORION' must never
  swallow a real request").
- **Reverting is a success.** `0691dc4` landed about 29 hours after the trim (10-07 10:10 to 10-08 15:26) and
  the project did not defend the trim.

### Walk it yourself

```bash
# the trim and its revert, side by side
git show --stat --format=%B f17471c | head -40
git show --stat --format=%B 0691dc4
for c in f17471c~1 f17471c 0691dc4; do echo $c; for f in AGENTS SOUL USER MEMORY; do printf "%s %s\n" $f $(git show $c:plugin/workspace/$f.md | wc -c); done; done
# the same scenarios as the trim eval
cat docs/evals/2026-10-07-prompt-diet/AGENTS-before-after.md | head -40
```

Note the "before/after" doc describes a design (topic notes attached per message, once every 30 minutes)
that the shipped commit rejected; read the doc as the *plan*, the commit as the *outcome*
(`docs/learn/_fragments/raw/eval-system.md` §5.4).

### Questions to ask your tutor

1. Why does prompt caching make "attach rules only when needed" *more* expensive than a bigger always-on prompt?
2. What kinds of failures can a 22-scenario scheduling suite not see?
3. Why was the AddressGate's error direction the wrong one for a voice assistant?
4. What is an "OpenClaw trajectory" and how does `orion-usage` use it to price calls?
5. What would you add to the eval suite so that the next prompt trim is caught before it ships?

---

## 5. Era 4 — The revert, the V3 plan and the eval harness (10-08)

Eighteen commits on one day, `0691dc4` (15:26) to `340527a` (22:10). Seven hours after reverting the trim,
the project had a written plan and most of a measurement harness.

### What was built

**(a) The plan: `ORION_V3_HANDOFF.md` (`23bacbe`, 16:00).** 1,051 lines, written by Claude "from a session with
Nick and reviewed by Nick and his Codex voice assistant" (`ORION_V3_HANDOFF.md:3-5`). It begins with an
unusual statement: "nothing in this plan has been run, built or downloaded yet". Section 1 ("Why this
exists") lists the problem in Nick's terms (lines 44-60): cost ($10 to $15 a month target), the testing loop
(testing needs the API, which costs more), the trim that made ORION worse and the false "Done", and "the
phone's on-device model is too weak, so with the Mac closed he can do nothing from the phone." His direction:

- Local models as the default, "prompt- and context-engineered properly, and evaluated fairly. He believes
  they are being underestimated."
- Claude only where the data shows local cannot do the job.
- A small, fast model as a conversational **front desk** that decides "answer, use one tool, escalate, or
  ask", says "I'm escalating this" out loud, and hands off to a bigger model.
- His selection principle, quoted in the plan (line 68-69): "A 5–10 second difference is significant. About
  2 seconds is small enough that reliability can justify the larger model."

The plan fixes ten phases (0 to 9): day-zero checks, research review, real-use log review, test sets,
harness, downloads and baselines, tuning, held-out finals, energy, end-to-end, report. It states out-of-scope
things explicitly: the autonomous Qwen dev loop, training or fine-tuning weights, and building the
production router, the honesty guard or the monthly cap ("the next build", section 11). **Tuning** is defined
in the plan as changing prompts, context, tool instructions and inference settings, never training
(`ORION_V3_HANDOFF.md:30-34`).

**(b) Phases 0 and 1 (`f1ec2f9`, `ab731fc`, 18:10).** Day-zero checks turned up corrections the plan had
wrong (HANDOFF 2026-10-08 18:10): the live `TOOLS.md` is regenerated by the runtime (90 commands) and the repo
copy is a stale 48-command snapshot; `ioreg`'s `MaxCapacity` is a percent here; and the old harness records
the *requested* thinking, not the applied one. A measured finding that shaped everything after: Ollama 0.34.4
treats `think` values "low", "medium", "high" **exactly like `true` on Qwen** (the same 1,764-character
thought at 724 tokens; `docs/evals/v3/REPORT.md:79-84`), so Qwen thinking is on/off only. `scripts/orion-v3-logs`
flattens Nick's real sessions and chats (excluding evaluation traffic), flags likely failures and counts
requests by job. `docs/evals/v3/REPORT.md:159-172` has the numbers: 886 session files became 151 real
sessions and 600 unique real turns; in the last 30 days, 315 turns on 14 active days, 62 percent voice, 14
percent `NO_REPLY`, reply latency p50 2.3 s (Haiku); and a 26-entry failure catalogue kept outside git. An
independent review found the first extractor "dropped whole real sessions over one probe line"; `f1ec2f9`
is the reworked design.

**(c) The harness, built in five commits between 19:14 and 19:52.** Each commit body lists what it does;
the dossier `docs/learn/_fragments/raw/eval-system.md` Part 2 explains the code. Summary:

| Commit | What it added |
|---|---|
| `aebaa0d` 19:14 | `stats.mjs` (Wilson intervals, rule of three, pass^k, exact McNemar, seeded bootstraps); streaming Ollama client with time to first token; the agent loop; the **sandbox**; the **claim checker** |
| `5013de9` 19:24 | The runner and jobs J1 (front desk), J2 (simple tools), J4 (honesty); `build` splits cases once with a fixed seed into practice and held-out; per-trial records and one ledger line per run |
| `a3aa340` 19:26 | J3 scheduling on private sandbox days (real `orion-agenda`, `-reschedule`, `-tasks`) |
| `cce7bb6` 19:30 | J5 brain and J6 continuity |
| `4c86f63`, `8e5204e` | The tuning ladder, J7 judge, battery sampler |
| `ec9d351` 19:42 | Held-out finals (3 repeats), the decision rule, speed and report commands |
| `1085c2c`, `2a85fca` | Energy from battery telemetry; the Phase 8 end-to-end pipeline |

Cases at the end of the evening (HANDOFF 2026-10-08 20:25): **304** (J1 143, J2 34, J3 37, J4 24, J5 18,
J6 12, J7 36), with the real-derived ones kept outside git. Tests: 136 in `tests/v3-*.test.mjs`. First
baselines on J1 practice (97 cases): llama3.2:3b 14, qwen3.5:4b 29, qwen3.5:9b 53, gpt-oss:20b 54;
qwen3.6:27b stopped at 33/97 because the Mac went on battery at 19:22:53.

**(d) Per-model prompt engineering (`c505cbd`, `f402b9c`, `0f27932`, `340527a`).** At 20:29 Nick relaxed the
fairness rule. The commit `c505cbd` states it: "Per Nick (2026-10-08), tuning may now differ per model: the
ladder is a first pass, then each model gets its own prompt engineering." The plan's original rule had been
the same ladder for every model. From here, each model has its own prompt file (a private per-model file
first, because hand-tuned prompts carry Nick's words as examples, then the repo's per-model file). J1
variants p3 to p5 follow (p4 patterns from his real messages; p5 "a short, example-led prompt for small
models" after `llama3.2:3b` over-applied p4's ignore rule and ignored 8 to 12 real requests).

### Why

The plan's central bet is that a **small, fast front desk plus a mid-sized worker plus a check** might do
ORION's jobs without the API. Before betting live traffic on that, the plan insists on an
**eval-driven prompt-engineering workflow**: define success, build graders, measure a baseline, change one
thing, re-measure, keep what helps. And it chooses real use first: mine the logs, turn each real failure into
a regression case, grade on *outcomes* (the calendar after the change), not paths.

### Key commits

| Commit | Date | What |
|---|---|---|
| `0691dc4` | 10-08 15:26 | Revert of the prompt trim |
| `23bacbe` | 10-08 16:00 | The V3 plan |
| `f1ec2f9` | 10-08 18:10 | Log extractor |
| `aebaa0d` | 10-08 19:14 | Harness core, sandbox, claim checker |
| `5013de9` | 10-08 19:24 | Runner and J1/J2/J4 |
| `ec9d351` | 10-08 19:42 | Finals, decision rule |
| `c505cbd` | 10-08 20:29 | Per-model right/wrong breakdown; tuning per model allowed |

### Steps back

1. **The real-calendar near-miss (`aebaa0d`, then `scripts/lib/eval/v3/sandbox.mjs:8-9`).** "On 2026-10-08 an
   unsplit env string sent orion-reschedule to the real calendar (it changed nothing, verified)." The
   sandbox sets per-trial environment overrides so the real scripts operate on a private day. A string passed
   through a shell instead of an object lost its separation, and the script saw the real calendar. The fix:
   env is passed as an object (no shell), and `preflight()` proves the scripts see the sandbox before a run
   starts and aborts if not. This is the first of two "a test touched the real calendar" incidents in the
   period; the second is the "B4" block in Era 9.
2. **The log extractor's first design dropped real sessions** (`f1ec2f9`): found by an independent review
   before it was trusted. The reworked design excludes only probe turns from real keyed sessions.
3. **Two stale facts in the plan** (live `TOOLS.md`, `MaxCapacity`) found by actually checking, recorded in
   the Phase 0 HANDOFF entry. The plan had a "day-zero verification" phase for exactly this reason, and it
   paid for itself.
4. **A fairness rule that lasted six hours.** The "same ladder for every model" rule (plan lines 299-301) was
   replaced at 20:29 by Nick's per-model direction. The plan's own wording, quoted in the eval dossier:
   "A candidate may be dropped from a job early only if, after the full budget, it is still below the gate
   by more than the uncertainty band." In practice the automatic keep/revert rule rejected big gains over
   one extra critical error, and the campaign switched to choosing configurations by hand
   (`ORION_V3_CONTINUE.md:306-307`).
5. **Battery power killed the first 27B baseline** (19:22:53): the queue was later made to pause on battery
   and runs record the power source at start and end.

### Lessons

- **Hand-written evidence of honesty beats a hope.** The claim checker was validated before use: 65
  hand-labelled real replies plus 32 synthetic ones labelled before the first run; first pass recall on
  false claims was 93 percent, after fixes at least 95 percent recall and 90 percent precision, "enforced by the
  test" (`aebaa0d` body).
- **Test the harness first.** The runner's "oracle dry run" feeds the labelled answer back in and must score
  100 percent: 97/97 practice, 46/46 held-out (`5013de9`). Anything less is a broken case or grader.
- **Keep private data private.** Real-derived cases and prompts with Nick's words stay in
  `~/.openclaw/orion-controlled/evals/v3/` (mode 0600); an `--out-dir` inside the repo is refused (`f1ec2f9`).
- **If it is not in the ledger, it did not happen** (`ORION_V3_HANDOFF.md:22-23`).

### Walk it yourself

```bash
sed -n 1,70p ORION_V3_HANDOFF.md
ls scripts | grep orion-v3
sed -n 1,20p scripts/lib/eval/v3/sandbox.mjs
node --test tests/v3-*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'   # local tests only, no network
```

### Questions to ask your tutor

1. What does "grade outcomes, not paths" mean for a scheduler, and how does the sandbox make that possible?
2. Why does the plan insist on an oracle dry run before any model is evaluated?
3. What is the difference between "false claim", "omitted failure", "false denial" and "wrong detail" in the
   claim checker (`scripts/lib/eval/v3/claims.mjs`)?
4. Why did the plan say tuning is "never training", and what is the cost of that boundary?
5. Why are Wilson intervals more honest than a raw percentage on a 36-case held-out set?

---

## 6. Era 5 — The tuning campaign and its report (10-09 – 10-10)

Twenty-seven commits, `0a21709` (10-09 02:08) to `5993920` (10-10 18:24). The commit messages are short; the
substance is in the ledger (outside git), in `docs/evals/v3/REPORT.md`, and in `ORION_V3_CONTINUE.md`. Use
the eval dossier for the mechanics. This section tells the story and the corrections.

### What was done

**(a) Tuning, mostly by hand, mostly overnight.** A work queue (`scripts/orion-v3-queue`, `0613267`) ran jobs
one at a time, pausing on battery and never overlapping jobs. For each model and job, configurations
(prompt base, "honesty" block, rules, examples, thinking, temperature) were tried on the practice set, the best
was frozen with a prompt hash (`05a1127` automated "freeze the best practice config per model: passes, then
false claims, then speed, and queue its final"), and then the held-out final ran three times.

**(b) The prompts that mattered.**

- `p4`/`p5`/`p6` for the front desk (`0f27932`, `340527a`, `0fc202e`); p6 is "p4 plus the 4B's three remaining
  practice mistakes".
- `pfull` (`7e9430b`): the **full header of `orion-reschedule`** as the scheduling prompt. Reading failure
  transcripts showed the models misread `extend` (it ADDS minutes). The one-line help that ORION's own
  `TOOLS.md` uses hides the worked mappings. Giving the 27B the full header moved it from 6/25 to 16/25 on
  scheduling practice (`ORION_V3_CONTINUE.md` §3, item 1).
- The `honesty` block (`b8a7546`): says what each real output *means* ("Command still running" is not done;
  "Not sent" is not delivered; "needs approval" is pending; `NOTHING WAS …` did not happen).
- `pcoach` (`9fff8bc`): a coaching guide for scheduling written from the 9B's practice failure categories
  (impossible-request check, extend versus resize, one command, check the result, at most four calls, quote
  times only from output). J6 got its own (`8053f6f`).

**(c) The honest numbers (held-out, 3 repeats).** From `docs/evals/v3/REPORT.md` (section 9, lines 344 to 435)
and the dossier Part 5.7:

| Job | Best model and setup | Held-out | Gate |
|---|---|---|---|
| J1 front desk | qwen3.5:4b, p6 plus restate, temp 0 | 123/138 = 89.1 percent, 6 critical misroutes | needs 95 percent: **fails** (no model passes) |
| J2 simple tools | qwen3.5:9b, T2 one-function-per-tool plus rules | 33/33, 0 false claims | passes |
| J3 scheduling | gpt-oss:20b (think high) 27/36; qwen3.5:9b 23/36 | 75 percent / 64 percent | needs 90: **none pass** |
| J4 honesty | qwen3.5:9b 24/24; gpt-oss:20b 23/24 | 0 false claims both | passes |
| J5 brain | qwen3.5:9b 33/36 (91.7 percent) | 0 false claims | passes |
| J6 continuity | qwen3.5:9b and qwen3.6:27b 18/27 | 3 false claims each | **none pass** |
| J7 conversation | qwen3.6:27b then qwen3.5:9b | correctness 4.5 vs 4.3 of 5 | judge only 84 percent vs the 85 percent bar: "provisional" |

And the **Phase 8 end-to-end** through the real route: 4B front desk handing escalations to the 9B passed
**7/21**, median about 35 seconds, "because the gateway runs the 9B on ORION's production instructions, not
the tuned prompts behind section 9.1" (`REPORT.md:381-386`). That sentence is the quiet warning of everything
that follows: the tuned numbers were not reachable through the real route.

**(d) The recommendation (`8fb29b4`, 10-10 18:23).** Routing: 4B front desk; 9B for quick, tools, honesty,
brain (thinking off) and standard scheduling (thinking on); Claude (Haiku) for "deep" work. The 27B "does not
earn its place". Decisions for Nick: adopt the routing for a supervised live day; port the tuned prompts into
production first; register `gpt-oss:20b` in the gateway as an offline fallback; remove the 27B (16 GB);
run a battery session.

### Why

Nick wanted the data. His reaction to the 9B's results, quoted in `ORION_V3_CONTINUE.md` (10-09 16:37 update), was
"incredible how well 9B is doing", and he asked for the 9B to be prioritised (the `1044x…` queue block). The plan's gates, however, were identical for every model and the 4B front desk still missed its
95 percent.

### Key commits

| Commit | Date | What |
|---|---|---|
| `7e9430b` | 10-09 03:03 | Fixes success markers; `pfull` |
| `b8a7546`, `f9e8fb2` | 10-09 06:27 / 06:51 | `honesty` block; checker fixes (partial, pending, modal) |
| `5eb940b` | 10-09 08:32 | gpt-oss "on" → medium (invalid value scored 0/25) |
| `0613267` | 10-09 11:26 | `ORION_V3_CONTINUE.md`; portable queue |
| `53922c4` | 10-09 18:39 | +17 J5 and +16 J6 cases |
| `e9811fa` | 10-09 21:11 | Queue stall fix |
| `05a1127` | 10-10 14:57 | Auto-freeze |
| `b5bdfc7` | 10-10 16:35 | Report regenerated |
| `8fb29b4` | 10-10 18:23 | Phase 9 recommendation |

### Steps back (and the corrections that make the numbers trustworthy)

The CONTINUE file's section 6 ("Corrections and lessons (do not re-learn these)") is the best list. In
chronological order:

1. **Grader bugs found by reading transcripts** (`7e9430b`, `b8a7546`, `f9e8fb2`, `57be797`, `e74d09b`).
   "Logged …" and "Showing …" were not success markers, so honest replies after `orion-log`/`orion-show`
   scored as false claims. Curly apostrophes made "couldn’t" look like no denial; gpt-oss's honest
   refusals scored as omissions. "Lights: sent … Colour not changed" is partial, so "on, but the colour
   didn't change" is honest: **19 spurious false denials across models**. "It was booked from 5:05 instead"
   was read as narration. "moved from <old> to <new>" was flagged as a wrong detail. The rule recorded:
   "A 0% or a whole-model pattern usually means a grader bug — read first." (`ORION_V3_CONTINUE.md:300`).
   After the fixes the claim checker still scored 65/65 on the real labelled set, and J3 finals were
   re-graded on aggregates only (`regrade-final.mjs`, `c35ccd0`).
2. **gpt-oss thinking "on" was an invalid value and scored 0/25** (`5eb940b`): gpt-oss only accepts
   low, medium or high. The code now maps "on" to medium (`scripts/lib/eval/v3/presets.mjs:37`, per the dossier).
3. **A crash that killed runs** (`b12a5ca`): a model sending steps as one object or a JSON string crashed
   `canonicalCall` and killed two J3 tuning runs and an exploration.
4. **Overfitting on a small practice set.** The 4B's J1 practice score rose 89 to 94 of 97 with a prompt
   (p6) written from its last few mistakes; its held-out stayed at 123/138 (`ORION_V3_CONTINUE.md` §2
   and `REPORT.md:407-414`). A 40-example prompt for the 9B scored 88/97 practice but 105/138 held-out,
   *worse* than 25 examples (111/138), and was re-frozen back to 25. Llama's 75-example prompt: 80/97
   practice, 67 percent held-out. The J5 practice set was 12 cases and the 9B scored 10/12 on it but 7/18
   held-out; after tripling the practice set (`53922c4`) the J5 final was 33/36. The lesson: "Prefer adding
   cases over prompt-patching a model's last few practice misses" (`ORION_V3_CONTINUE.md`, 10-09 19:05 update).
5. **The J7 judge, v1 then v2 then back to v1 (`255edb0`, `db6e1ac`, `c95e5d4`).** A local judge scores the
   conversational replies. Calibrated against 240 hand-scored pairs, v1 agreed within one point 82.5 percent
   (later 84 percent); the bar was 85. v2 (stricter anchors, written after seeing disagreements) agreed *less*
   on identical items and was reverted. The 27B as a judge: 62.5 percent and about 8 minutes per reply,
   dropped. The report ships the J7 results as **provisional**. A commit body carries the conclusion: "Rubric
   tightening made the local judge worse, not better" (`REPORT.md:407-414`).
6. **The queue stalled for two hours (`e9811fa`, 10-09 19:04–21:10).** The worker used `pgrep -f
   "scripts/orion-v3-eval"` to detect a running job; a Claude waiter shell whose command line contained that
   text matched. Fixed with `pgrep -f "^node scripts/orion-v3-eval"`. The CONTINUE file records the rule:
   never put that string in a long-running waiter command.
7. **Parallel model jobs starve each other.** "A parallel 4B thinking run starved the queue." Rule: use the
   queue; never run two model jobs at once. Also: thinking ON made the 4B time out (60 s) on 86 percent of
   front-desk messages, so the front desk stays think-off (`ORION_V3_CONTINUE.md` §2).
8. **Thermal and battery caveats.** Speed runs now record `thermal` (`ProcessInfo.thermalState`) and refuse to
   run when serious or critical (`3b56ee3`); the 9B and gpt-oss J1 baseline timings taken on battery on 10-08
   are marked unusable; Nick's backpack hour (about 15:40 to 16:40 BST on 10-09) is a ledger caveat.
9. **The automatic keep/revert rule was set aside.** It "rejected big gains over a +1 critical/omission".
   Under Nick's direction configurations were chosen by hand per model, so the final models have different
   example counts (llama 75, others 25).
10. **The warning was in the report and not yet acted on.** Phase 8's 7/21 said the real route ran different
    instructions than the evals did. The implementation plan of `10-10` (Era 6) ported the tuned prompts, but
    the sampling settings, tool surface and context size of the live route stayed different until 10-12
    (Era 8 and Era 9).

### Lessons

- **Read transcripts before trusting a score.** Six grader bugs were found that way.
- **Held-out means held out.** The campaign never inspected held-out failure details; the overfitting rule
  paid off in the 4B and 9B J1 results.
- **Adding cases beats patching prompts.**
- **Speed and reliability are separate axes.** gpt-oss was the best local scheduler (27/36) but its p90 was
  198 s, unusable live. The 9B was less accurate and far faster.
- **A result that does not transfer through the real route is not a result.** Phase 8 said so on 10-10;
  Era 7 learned it the hard way.

### Walk it yourself

```bash
sed -n 344,440p docs/evals/v3/REPORT.md          # the recommendation
sed -n 290,322p ORION_V3_CONTINUE.md              # corrections and lessons
git show -s --format=%B 57be797 f9e8fb2 e74d09b 5eb940b e9811fa
node --test tests/v3-*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

The ledger itself is private (`~/.openclaw/orion-controlled/evals/v3/ledger.jsonl`); `tail -5` it only on
your own machine and never paste its case text into a chat.

### Questions to ask your tutor

1. Why did a *tighter* judge rubric agree *less* with the hand scores, and what does "agreement within ±1"
   measure?
2. Explain pass^3 and why it is stricter than the pooled pass rate.
3. The 9B's J3 held-out was 23/36 (64 percent) but its false claims were 0. Why is that still a useful tier?
4. What did the Phase 8 result (7/21) say about the whole campaign, in one sentence?
5. Why does the plan refuse to use Claude as a grader or for tuning?

---

## 7. Era 6 — Try, check, escalate: from report to plugin (10-10)

Eight commits, `72f7dbf` (10-10 21:25) to `2afffb8` (10-10 22:40). In 75 minutes the recommendation became
code. This is the most compressed stretch in the whole range, and it is worth reading slowly because the
next era shows what happens when evaluation numbers are ported faster than production conditions.

### What was built

**(a) The cascade replay and the "no deep tier" decision (`72f7dbf`, `0d98a5f`, `1719a48`).** After the
Phase 9 recommendation (which kept Claude for a "deep" tier), Nick rejected a category-based deep tier. His
rule, quoted in `ORION_V3_CONTINUE.md` (10-10 22:40 update): "9B tries, checks its work, and if it doesn't
seem right then it gets escalated" (as the plan doc restates it, `docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md`,
opening). `scripts/eval/v3/ops/cascade.mjs` (106 lines, `72f7dbf`) replays the already-recorded paired
held-out finals as if a runtime check decided when to hand over. Results, from the commit bodies and
`REPORT.md` section 9.7 (lines 416-434):

| J3 scheduling, held-out (36) | Pass | False claims | Escalated | p50 | p90 |
|---|---|---|---|---|---|
| 9B alone | 23 (64 percent) | 0 | none | 15 s | 47 s |
| gpt-oss alone | 27 (75 percent) | 0 | all | 28 s | 198 s |
| 9B, check, then gpt-oss | 27 (75 percent) | 0 | 9 (25 percent) | 21 s | 91 s |
| 9B, **retry**, check, then gpt-oss (`1719a48`) | **28/36** | 0 | **4/36** | p50 21 s | p90 86 s |

On J6 (continuity) the cascade kept the same pass count as the 9B and cut false claims from 3 to 0. The check
caught 7 of the 9B's 13 J3 failures with 1 false alarm. A variant where the **9B reviews its own work** was
rejected: it flagged 22 to 24 of 25 practice attempts, "with or without thinking; ~1 min per check with
thinking".

**(b) Plugin step 1: `work-check.ts` (`7575167`, 22:28).** `plugin/orion-control/src/work-check.ts` is a
TypeScript port of the evaluation's claim checker (`scripts/lib/eval/v3/claims.mjs`, 65/65 on Nick's labelled
replies) plus the mechanical calendar check. Its header comment (lines 1-13) states why it exists and quotes the
28/36 figure; a "parity test" keeps the two implementations identical. Key functions: `outcomeOf` (line 30; what
a tool result *says happened*), `claimsIn` (56; what the reply *claims*), `checkReply` (128), `checkCalendar`
(164), `checkWork` (176), `retryInstruction` (210). Ground truth is "what the tools printed, never the model's
account of it". See `docs/learn/05_plugin_turn_pipeline.md` for where it plugs into the turn.

**(c) Plugin step 2: `front-desk.ts` (`e12def4`, 22:31).** The V3-frozen 4B prompt, exact request shape of the
evaluation, `temperature` 0, and the rule "It must never block a turn: any timeout, HTTP error, unparsable or
invalid output becomes 'escalate' with a `fallback` reason" (`front-desk.ts:14-16`). The moves are `answer`,
`tool`, `escalate`, `ask`, `ignore`, and a menu of 17 tool names (`front-desk.ts:23-25`). One constant matters
later: `FRONT_DESK_CTX = 16384`, with the comment "a different num_ctx makes Ollama reload the model"
(`front-desk.ts:21`). Live smoke test: lights go to a tool, "redo my afternoon" escalates, thanks is answered,
a fragment is ignored; about 1.3 s warm.

**(d) Plugin step 4, shadow half: `local-routing.ts` (`76436dc`, 22:33).** Config `localRouting: off (default) |
shadow | on`. Shadow "never overrides the model, replies or revises; the front desk runs fire-and-forget"
and appends both the front desk's decision and the work-check findings on real turns to a private log
(`~/.openclaw/orion-controlled/local-routing/shadow.jsonl`). Plugin suite: 404/404. "Not deployed: needs a
plugin build, the config flag and a gateway restart (Nick's go-ahead)."

**(e) Plugin step 4, "on" half (`2afffb8`, 22:40).** Seven minutes after the shadow commit, and while the plan's
status section (committed in `f1b882c`, 22:33, headed "Status (2026-10-10 22:40 BST)") still said "'on' not built"
(`docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md:61`), the "on" mode landed: the 4B front desk answers or asks itself; `tool`,
`escalate` and `ignore` go to `ollama/qwen3.5:9b`; `before_prompt_build` appends the frozen scheduling, brain
or general instructions (`job-instructions.ts`, exported from the eval prompts by
`scripts/eval/v3/ops/export-job-instructions.mjs`); the work check revises once with what to fix, then once to
undo and say plainly what did not happen. The hand-off to gpt-oss is **logged as `escalationNeeded`** until
that model is registered and a follow-up turn is proven. Plugin suite 410/410. The hooks used, as they are
in the file now: `before_model_resolve` (`local-routing.ts:269`), `before_agent_reply` (299),
`before_prompt_build` (307), `reply_payload_sending` (380, added later), `after_tool_call` (389) and
`before_agent_finalize` (396). The file header at lines 1-30 explains each; do not re-read all of it, see
`05_plugin_turn_pipeline.md`.

### Why

Nick's rule replaced the earlier design. The earlier design had the front desk pick a "deep" category and send
it to the slowest model, which would have put gpt-oss (p90 198 s) in front of the user. A runtime check that
uses only signals the runtime already has (claims against tool outputs, unmentioned failures,
overlaps/lost/duplicated blocks, unfinished turns, last change incomplete) lets the cheap model try first and
spend the expensive path only on its failures.

### Key commits

| Commit | Date | What |
|---|---|---|
| `72f7dbf` | 10-10 21:25 | Cascade replay |
| `1719a48` | 10-10 22:25 | Cascade with 9B retry: 28/36, 4/36 escalated |
| `7575167` | 10-10 22:28 | `work-check.ts` |
| `e12def4` | 10-10 22:31 | `front-desk.ts` |
| `76436dc` | 10-10 22:33 | Shadow mode |
| `2afffb8` | 10-10 22:40 | "On" mode |

### Steps back

This era's steps back are mostly **prospective**: things shipped without a live proof.

1. **"On" mode was written before shadow mode had produced any data.** The plan said shadow should run "for a
   few days first; it is the safest real-traffic test" (Status section). "On" was built the same night.
2. **The escalation spike (plan step 5) was never done.** "On" logs `escalationNeeded` but cannot actually hand
   a job to gpt-oss; the model is not registered in the gateway.
3. **The "not deployed" statements were true when written.** Four commit bodies say "Not deployed". When "on"
   went live (Era 7) there is no commit or HANDOFF entry that records the deployment itself. The date is
   visible in the private routing log (first entry `2026-10-11T18:40:05Z`, mode `on`, read on 2026-10-14; I read
   only the `at` and `mode` fields) and in `151c27c` (10-11 19:42, "First live turn timed out at 4 s"). The
   memory note says who and why: "On 2026-10-11/12 I switched ORION's live routing to the local 4B/9B … on the
   strength of sandbox eval scores." (The "I" is Claude. The implementation plan says nothing goes live "without Nick's
   explicit go-ahead"; the repo records no such go-ahead for the flip, though he may have given it in chat.)

### Lessons

- A check that uses only runtime signals is cheap, fast and validated; it is the best idea in the whole
  campaign. It is also the piece that kept working (it is still in the flow today).
- A plan's Status section and the commit history can disagree by minutes. Trust commits.

### Walk it yourself

```bash
sed -n 1,40p plugin/orion-control/src/work-check.ts
sed -n 1,30p plugin/orion-control/src/front-desk.ts
sed -n 1,30p plugin/orion-control/src/local-routing.ts
sed -n 416,434p docs/evals/v3/REPORT.md
git show --stat --format='%h %ad %s' --date=format:%H:%M 7575167 e12def4 76436dc 2afffb8
```

### Questions to ask your tutor

1. Why use only runtime signals in the check instead of asking the model to review itself?
2. What can a check *not* see (think about a reply that is true, or a calendar change that is wrong but
   plausible)?
3. Why must the front desk "never block a turn", and what does fall back to "escalate" cost?
4. Why is an unregistered gpt-oss model a blocker for the escalation step?
5. What would "shadow for a few days" have told them that the sandbox could not?

---

## 8. Era 7 — Local routing goes live, fails, and is gated (10-11 – 10-12 morning)

Eleven commits: `151c27c` (10-11 19:42) to `f835b11` (10-12 09:58). This is the main step back of the whole
period, and it is the one the project wrote into Nick's persistent memory so it would not recur
(`no-live-switch-without-real-route-test.md`).

### What happened, in order

All times 2026-10, London. The failures are quoted from the commit bodies (each was written by Claude within
hours of the failure) unless marked otherwise.

| When | Event | Commit |
|---|---|---|
| 10-10 22:40 | "On" mode built (Era 6) | `2afffb8` |
| 10-11 19:40 | **"On" live.** The first line of the private routing log `shadow.jsonl` is `2026-10-11T18:40:05Z`, mode `on` (18:40 UTC is 19:40 BST). No commit or HANDOFF entry records the flip | none |
| 10-11 19:23 | The Anthropic API returns 400 "credit balance is too low" for every call, and no one notices | (found 10-12) |
| 10-11 19:42 | First live turn "timed out at 4 s on a cold 4B and fell through to the worker" | `151c27c` |
| 10-11 20:06 | `before_agent_reply` "does not fire on the agent-CLI/phone route", so "answer" turns went to Haiku and timed out after 95 s; the 4B warm-up used a different `num_ctx`, so every call reloaded the model (7 s) | `e42de88` |
| 10-11 20:19 | The 9B read about 17,000 input tokens per call (186,000 for one calendar turn) and took 60 to 100 s a turn | `b4c8b55` |
| 10-11 23:56 | Nick's real request "fill the time between my classes" fails on **tool mismatches** | `18c8f85` |
| 10-12 00:01 | The 4B calls his real request "ask", so the 9B only gets a drafted question and asks him for times | `966cd63` |
| 10-12 00:09 | Work check learns "asking back on a clear change request with nothing changed" | `fe24f80` |
| 10-12 00:16 | Three live replays: asked, asked, then "let me book that" with the calendar untouched; "Eval agreed: 0/3 for every local model on his real scheduling requests." Calendar changes get an optional cloud route | `0372a72` |
| 10-12 09:51 | **The acceptance gate**: "on" is refused without a recent real-route pass | `612f962` |
| 10-12 09:58 | HANDOFF: local routing back to shadow; API out of credit | `f835b11` |

### What was built (the fixes, by layer)

**1. Warm-up and sizing (`151c27c`, `e42de88`).** Load the front-desk model at gateway start with
`keep_alive` 24 hours, an 8-second cold timeout (it had been 4 s), an optional stage trace
(`localRoutingTrace`). The warm-up must use the front desk's `num_ctx` (16,384) or Ollama reloads the model on
every call; Ollama reloads whenever the context size changes (RESEARCH_IDEAS section 0, finding 3: "138
'evicting' events, `OLLAMA_KEEP_ALIVE` is 5 minutes").

**2. "Never falls through to the cloud model" (`e42de88`).** Because `before_agent_reply` does not fire on the
CLI/phone route, "answer" decisions were not honoured and the configured (cloud) model ran. After the fix
*every* move runs on the 9B, given the front desk's draft for "answer"/"ask" turns. The same
`before_model_resolve` handler (lines 269-296 of `local-routing.ts`) returns the worker override.

**3. A slim worker prompt (`b4c8b55`).** The local worker got "tuned job instructions + time" instead of the
17k-token workspace prompt; general jobs use the evaluated command reference.

**4. Tool-surface fixes in the scripts (`18c8f85`).** The model "failed Nick's request on tool mismatches":
bare script names refused (only full paths allowed), `orion-agenda tomorrow` rejected, `--date tomorrow` gave
"Invalid time value", `&` in a class title refused, and **"CS2101" matched the CS2100 lecture because words
were cut to five letters**. Fixes: course codes stay whole; `--date` takes today/tomorrow/weekday;
`orion-agenda <day word>` reads that day; the worker prompt names the full script paths, today's and tomorrow's
dates, "no & in titles" and the one-call recipe. Life tests 277/277; a dry run on his real Monday gave
"cert courses 12:35-15:25".

**5. Routing fixes (`966cd63`, `fe24f80`, `0372a72`).** Change requests and "ask" moves always reach the
worker with the job's instructions; the work check flags "asked instead of acting" and "promised but did not
act"; an option `localRoutingScheduleToCloud` sends calendar changes to the cloud model. (Live config today:
`localRoutingScheduleToCloud: false`.)

**6. The acceptance gate (`612f962`).** The rule in code, `plugin/orion-control/src/local-routing.ts:212-229`:

```ts
// plugin/orion-control/src/local-routing.ts:218
export const ACCEPTANCE = { minPassRate: 0.85, maxMedianMs: 20000, maxAgeDays: 14, minCases: 20 };
export function acceptanceVerdict(path: string, now = Date.now()): { ok: boolean; why: string } {
  // reads the record at `path`; refuses if too old, too few cases, pass rate or median too poor
```

The record is `~/.openclaw/orion-controlled/local-routing/acceptance.json`, written by
`scripts/eval/v3/ops/local-acceptance.mjs`, which takes the latest Phase 8 pipeline run from the ledger. At the
time: 7/21 and a 35 s median, so refused, so shadow. The comment above the gate carries Nick's words: "clearly
we havent done enough work with the local models to do this. lets make sure this doesnt happen again." The
plugin logs "localRouting "on" REFUSED — <why>. Running shadow: the configured model answers." and sets itself
to shadow (`local-routing.ts:240-246`). `index.ts:1680` passes the acceptance path.

**7. Phone and to-dos on the side.** `a44ce44` (10-12 09:50): "Phone (Nick, 2026-10-12): every message goes to
ORION on the Mac (Claude); the on-device fallback is off" (`RemoteViews.answerOnDevice = false`). Also Mac and
phone to-do tags and drag-to-reorder (`af03211`, `a44ce44`), where tags and order live in the Reminder's notes
(`Tags: school, gym`, `Order: 2.5`) because EventKit exposes neither.

### Why

The local route was the point of V3, and a cost problem sat behind it. The evaluation numbers looked good. The
route was switched on to see it work.

### Key commits

| Commit | Date | What |
|---|---|---|
| `151c27c` | 10-11 19:42 | Warm the front desk, 24 h keep-alive, 8 s timeout |
| `e42de88` | 10-11 20:06 | "On" never falls through to the cloud model |
| `b4c8b55` | 10-11 20:19 | Slim worker prompt |
| `18c8f85` | 10-11 23:56 | Course codes, day words, agenda "tomorrow" |
| `0372a72` | 10-12 00:16 | Optional cloud route for calendar changes |
| `612f962` | 10-12 09:51 | **The gate** |
| `f835b11` | 10-12 09:58 | HANDOFF: back to shadow |

### Steps back

1. **The live switch itself.** From `ORION_V3_CONTINUE.md` (10-12 10:15): "'on' failed Nick's real request
   ('fill the time between my classes') three ways." The eval dossier counts this as lesson 7 and lists the
   reason (`LOCAL_FAILURES.md` #11): **"Eval ≠ production: sandbox scripts by bare name, fixture tools, small
   prompts; eval scores overstated live quality — 89–100% eval vs 0/3 live."**
2. **The same behaviour in the old and new routes was different.** The evaluation harness gave the model
   fixtures: scripts by bare name, scripted outputs, a sandbox day. Production gave full paths, a real
   calendar with `&` in a class title, `tomorrow` words, and a 17k-token system prompt on top of a whole chat
   history ("68k–579k input tokens per turn", `LOCAL_FAILURES.md` #3).
3. **Two tool doors.** The 9B called `orion-agenda` through the catalog (`tool_call`) instead of `exec`, and
   got "Unknown tool id: orion-agenda" (`LOCAL_FAILURES.md` #2). The evaluation's interface T1/T2 never had
   both doors.
4. **A hook that does not fire.** `before_agent_reply` does not fire on the agent-CLI/phone route (`e42de88`),
   so the plan's table row "Front-desk answer / ignore / ask | `before_agent_reply`" was wrong for that route.
5. **The API credit outage was invisible.** Since 10-11 19:23 every Anthropic call failed; the gateway fell back
   to the local models "with the full ~17k-token prompt (60-300 s, timeouts)" (`513276d` body). So failures were
   blamed on the wrong layer: "timeouts blamed on the wrong layer" (`LOCAL_FAILURES.md` #10). Two messages appeared and the sources
   disagree on their order: the HANDOFF says the "reached your specified API usage limits ... regain access on
   2026-11-01" message was the earlier one (10-07) and "credit balance is too low" came on 10-11; the header
   comment of `account-health.ts` (lines 4-9) lists credit first and the usage limit second. A usage-cap
   message that gives a return date of 2026-11-01 means topping up credit alone may not have fixed the cap. The
   HANDOFF says "the account still needs credits / a higher cap (Nick, console.anthropic.com)".
6. **GPU contention (`LOCAL_FAILURES.md` #12).** Evaluation runs, the 4B, the 9B and brain embeddings at once
   caused the first model call to time out. Rule: never run eval jobs while Nick is testing live.
7. **A silent front-desk error disabled the flow** (later fixed in `490535f`, Era 9).

### Lessons

- **The memory note is the lesson** (`~/.claude/projects/-Users-nickmadaio-Desktop-ORION/memory/no-live-switch-without-real-route-test.md`):
  "Before any live model/routing change: run the real-route acceptance … Replay at least one of Nick's real
  requests end to end through the gateway before telling him something works. When ORION misbehaves, check
  the gateway log for provider errors (credit/limit/400) before debugging prompts."
- A gate in code is better than a promise in a note. The gate is 14 lines and cannot be forgotten.
- Instrument failures so they name the right layer (account health, Era 8).
- Evaluate through the **same route, same prompt, same tools, same sampling settings** as production. The
  evaluation had four things wrong (route, prompt, tools, sampling), and the last of them was not found
  until Era 8.

### Walk it yourself

```bash
sed -n 205,245p plugin/orion-control/src/local-routing.ts
cat scripts/eval/v3/ops/local-acceptance.mjs
sed -n 1,50p docs/evals/v3/LOCAL_FAILURES.md
# on your own machine only; this file is private:
cat ~/.openclaw/orion-controlled/local-routing/acceptance.json
```

### Questions to ask your tutor

1. What are the four differences between the evaluation's world and the live route that made 89 percent become
   0 of 3?
2. Why should "on" be *refused* by the plugin itself rather than relying on a human remembering a rule?
3. Why is a 14-day expiry on the acceptance record sensible?
4. Which hook does not fire on the phone route, and what did the code do instead?
5. Why would a dead API account have looked like "the local model is slow"?

---

## 9. Era 8 — Account health, the manual in the brain, and the research (10-12 morning)

Six commits, `513276d` (10:09) to `444cdb5` (11:21), including a merge of `origin/main` (`d049141`).

### What was built

**(a) `account-health.ts` (`513276d`, `05cab3d`).** 244 lines plus 275 lines of tests. It listens on two
hooks, `llm_output` (fires per model attempt, failed ones included, and carries the provider's error body in
`lastAssistant.errorMessage`) and `agent_end` (the run's own `error`). It treats only errors that mean the
**account** is unusable as problems: credit, usage cap, a rejected API key (`classifyAccountError`,
`account-health.ts:92`; types at line 36). Rate limits, overload, timeouts, DNS errors and expired OAuth tokens
are ignored. Notification is one line in `~/.openclaw/orion-controlled/alerts-outbox.jsonl`, which the Mac app's
LinkEngine sends to his phone, once per episode and kind, remembered in `account-health.json` across restarts,
with one "answering again" line on recovery and a 24-hour expiry. The alert text names the fix ("console.anthropic.com
-> Plans & Billing" or "Limits"). Optional **fail fast** (`accountFailFast`, default off): while a problem is
under 10 minutes old, answer real turns at once with the problem and the fix instead of waiting for a slow
fallback; where `before_agent_reply` does not fire, only the fallback attempts get a tiny "say exactly this"
prompt, so a recovered Claude still answers normally. Fail-fast is ignored when `localRouting` is "on"
(`index.ts:1667`). Config flags are declared in `plugin/orion-control/openclaw.plugin.json` and at
`plugin/orion-control/src/index.ts:274`.

An independent code review caught real bugs before shipping (HANDOFF 2026-10-12 10:09): `agent_end.messages`
is the whole session and `lastAssistant` can be an older turn's message, so the first version would have
re-alerted on old failures after recovery. Fixes: only a fresh (under 10 minutes) message from the attempt's
own provider counts; credit/limit alternation could re-alert; unattributable errors were pinned on the active
provider; OAuth expiry was read as a dead key; fail-fast could answer canned text to a recovered Claude.
Verification: 23 new tests, plugin suite 438/438, `tsc --noEmit` clean, every review fix mutation-tested (remove
the fix, a test fails), and a **replay of 231 real assistant attempts since 2026-10-09 gives exactly two alerts
and no false ones**; the classifier over 110 real error messages found 26 credit, 5 usage-limit, 9 genuine July
"API key is invalid" hits, and 0 of 45 aborts, 23 DNS errors and the timeouts and overloads. Not fixed
(pre-existing, in LinkEngine): the app reads then truncates the outbox, so a line appended in between is lost.
The CONTINUE file later says it was deployed (account-health alert deployed, on by default, fail-fast off).

**(b) ORION's manual in the brain (`15f0775`).** Nick's idea (10-12): "a small prompt, and ORION looks up the
rest." `scripts/orion-brain-manual` writes the workspace instruction files into the brain, one note per section
(53 notes plus an index, "90 System/ORION Manual"). The motive is in the commit: "AGENTS.md (31k) was cut at
20k so Dates / Memory and Brain / Safety never reached Claude" (the limit is OpenClaw's
`agents.defaults.bootstrapMaxChars`; raising it was left as "Nick's call", `LOCAL_FAILURES.md` #4). AGENTS.md
now opens with a look-it-up section; the local worker gets `LOOK_IT_UP` plus the message's brain matches
pre-fetched in parallel with the front desk. The same commit adds `localRoutingTestingUntil`: a time-boxed
testing window (maximum 48 hours ahead) in which "on" runs without an acceptance record, so Nick can test
"on" on purpose. It is checked per message (`local-routing.ts:284`, "the testing window closed: back to shadow").

A side finding worth checking yourself: I computed from `git show f17471c:plugin/workspace/AGENTS.md` that the
**trimmed** file was 22,732 characters, so even after the trim the last 2,732 characters were past the 20,000
cut; that is where the second half of "Focus sessions and projects" and the whole "Connections" topic sat
(section offsets: His day 8,202; His phone lock 17,405; Focus 18,627; Connections 20,759). **(inferred: it
assumes the 20,000 limit reported on 10-12 was already in force on 10-07; the repo does not say.)** The
failure that triggered the revert was a scheduling "Done" (section "His day", inside the limit), so this is not
the cause of that incident, but it is a second way the trim could have hurt.

**(c) `docs/evals/v3/LOCAL_FAILURES.md` (`e1eebe9`).** A 12-row table of why the local models failed live and
the fix for each (see Era 7). Of the two experiments listed, "rewrite the whole day as JSON, code applies"
(`scripts/eval/v3/ops/declarative.mjs`) scored 6/25 on practice J3 with the 9B and "steps as a typed form,
code builds commands" (`ops/steps.mjs`) was unfinished; "drive `orion-reschedule` with tools (tuned prompt,
thinking on)" was the eval number, 19/25. The recommended next build: "A typed `schedule_change` tool (steps
form) as the ONLY scheduling tool the local worker sees". That is the seed of Era 9.

**(d) `docs/evals/v3/RESEARCH_IDEAS.md` (`444cdb5`).** A research agent's read of the machine plus the
literature, 8 ideas ranked by effort. Section 0 (lines 7-30) holds the **most important finding of the whole
campaign**:

> The live worker probably runs with Ollama's default sampling settings, not your eval settings. `ollama show
> qwen3.5:9b` reports `temperature 1`, `top_p 0.95`, `top_k 20`, `presence_penalty 1.5`, with thinking on by
> default. … in `~/.openclaw/openclaw.json` the model entry `"ollama/qwen3.5:9b": {}` is empty. … Your evals
> use temperature 0–0.2. (`docs/evals/v3/RESEARCH_IDEAS.md:9-17`, abbreviated)

The ideas, in the document's order: run live with eval settings and serving; scheduling as a fixed sequence in
code; intent-level verbs with the scheduler as the checker; propose, preview, commit; record and replay real
traces as examples; an eval that replays production exactly; distillation; serving (resident models, stable
prompt start, MLX).

### Why

Two separate needs. First, Nick had no idea his account was dead; the system should say so. Second, the
campaign had a result (89 percent in the lab) and a contradiction (0/3 live), and nobody yet had an
explanation.

### Key commits

| Commit | Date | What |
|---|---|---|
| `513276d` | 10-12 10:09 | `account-health.ts` |
| `15f0775` | 10-12 10:35 | Manual in the brain; testing window |
| `e1eebe9` | 10-12 10:49 | LOCAL_FAILURES.md |
| `444cdb5` | 10-12 11:21 | RESEARCH_IDEAS.md |

### Steps back

1. **A harness gap, not a model gap.** Sampling parameters were part of the "same fairness rule", but only on the
   eval side; the live entry was `{}`. The 9B was being measured at one setting and run at another for four
   days.
2. **The "20,000-character cut" had been silent.** Rules for dates, memory and safety were not reaching Claude
   at all. Found by research, not by a test.
3. **The first account-health design would have re-alerted on stale failures.** Found by code review, then
   mutation-tested.

### Lessons

- **Make the model's settings explicit.** If a config entry is `{}`, you are running the vendor's defaults,
  which are tuned for chat, not for copying paths and flags.
- **Detect the failure class, not the symptom.** A dead account looks like slowness unless something reads the
  error body.
- **Mutation-test the fixes of a review.** The commit body says every review fix was proven by removing it.

### Walk it yourself

```bash
sed -n 1,60p plugin/orion-control/src/account-health.ts
sed -n 1,30p docs/evals/v3/RESEARCH_IDEAS.md
sed -n 20,40p docs/evals/v3/LOCAL_FAILURES.md
git show --stat --format=%B 15f0775
```

### Questions to ask your tutor

1. Why does a presence penalty of 1.5 hurt tool calling that must copy paths and flags back exactly?
2. What would it take for the gateway to put the provider's error body in the log instead of only `status=400`?
3. Why are rate limits and OAuth expiry excluded from "account unusable"?
4. What does a testing window (max 48 hours) give Nick that a permanent flag does not?
5. Why is a replay over 231 real attempts a stronger test than the unit tests?

---

## 10. Era 9 — Scheduling as a fixed sequence, and the live gauntlet (10-12 afternoon)

Eleven commits, `f0b2b67` (13:10) to `3389cd4` (16:02). Almost three hours of work, mostly one design.

### What was built

**(a) The settings fix, outside git (about 13:00–13:25).** The research finding of Era 8 was acted on: in
`~/.openclaw/openclaw.json`, `models.providers.ollama.models[qwen3.5:9b].params` was set to temperature 0.2,
top_p 0.9, top_k 20, presence_penalty 0, num_ctx 32768, keep_alive 24 h, with a backup in
`~/.openclaw/backups/` (`ORION_V3_CONTINUE.md`, 10-12 13:25 update). I read the live file on 2026-10-14 and it
still has exactly those values, plus `repeat_penalty: 1`, and `think: false` with `num_predict: 2048` (the last two added at 15:22,
see (e)). Because this is **live config and not in git**, a fresh checkout does *not* reproduce the fix.
The CONTINUE file says "Root cause found by research".

**(b) `schedule-flow.ts`: calendar changes as a fixed sequence (`f0b2b67`, 13:10).** The header comment of
`plugin/orion-control/src/schedule-flow.ts:1-14` is the whole design:

```ts
// plugin/orion-control/src/schedule-flow.ts:1-14 (abridged)
//  1. code reads the whole day (orion-reschedule show --json, past blocks included) and numbers it
//  2. the worker fills ONE small form; every block reference must be one of today's real ids (B1…)
//  3. code compiles the form into exact orion-reschedule arguments (no shell, no paths, no "&"
//     problem, no time arithmetic for the model — "between A and B" = from A's end to B's start)
//  4. the scheduler runs it; the worker only phrases what the scheduler printed
```

The idea comes from research ideas #3 and #4 (TinyAgent, Apple's on-device model, SMCalFlow) and Nick's own
decomposition quoted in the file: "the start time is a because the class ends at b, and the end time is x because
the lab starts at y". The pieces, with line numbers at HEAD:

| What | Where |
|---|---|
| `DayBlock`, `Day`, `Intent` (the form: `fill_between`, `plan`, `clear_after`, `move`, `resize`, `extend`, `add`, `drop`, `skip`, `swap`, `tidy`, `cannot`, `ask`, `answer`) | `schedule-flow.ts:17-31` |
| `blockList`: what the model sees, `B1 09:00–10:30 CS2100 … (FIXED, already happened)` | `schedule-flow.ts:33` |
| `intentSchema`: a JSON schema whose block references are **enums of today's real ids** | `schedule-flow.ts:39` |
| `FORM_OPTIONS`: temperature 0, `num_predict` 500, `num_ctx` 32768 | `schedule-flow.ts:62` |
| `FORM_PROMPT`, `EXTRACT_PROMPT` | `schedule-flow.ts:64`, `92` |
| `compile`: form to argv; `BUFFER` five minutes between activities | `schedule-flow.ts:112` (`BUFFER` at line 30) |
| `runScheduleFlow` | `schedule-flow.ts:225` |
| `spokenReply`: the reply built by code from the scheduler's lines | `schedule-flow.ts:272` |
| `TOMORROW` regex and `meansTomorrow` (after midnight "tomorrow" means today) | `schedule-flow.ts:209-216` |

The compiler **refuses** nonexistent block ids, anchors used as the thing to place, and moving a class; a
broken form gets **one correction round** telling the model the rule it broke; anything the compiler cannot
express falls back to the old worker loop; and there is no tool retry after the flow has acted. The scheduler
itself got a helper: `orion-reschedule show --json` returns the whole day with past blocks included ("'today'
hid DS once it ended"). Offline on Nick's real day with the 9B at temperature 0 and presence 0: **7/8 requests
right and identical across runs** (his message plus two rewordings all gave "cert courses 12:35-15:25"), at
0.3 to 2.2 s per decision.

**(c) Guards, plans and invisible commutes (`110bc80`, `cd91e9d`, `70ebf12`).**
- `110bc80` adds the guards and the correction round, and **makes the real flow unreachable from tests**,
  because of the "B4" incident below. Offline on his real day, two variants: 10/10 handled (9 exact
  commands, 1 correct fallback).
- `cd91e9d` handles *plans*: "after my lab I'm going to Spit, 15 min commute, then four things". Nick's live
  attempt had no change verb, so the flow never ran and "the old loop ended the turn without a reply". Now any
  non-question about his day goes through the flow; a `plan` step (decide the anchor) plus a **separate
  extraction call** (where, travel minutes, items with minutes) compile to one `day --plan` call. Form output
  was capped (`num_predict` 500, `maxItems`, `maxLength`) "after a 14k-token runaway". Offline: 5/5 (plan, move,
  resize, skip, fill).
- `70ebf12` encodes a rule Nick stated in chat: "the 15 min i said is the commute ... commutes should kinda
  be like invisible blocks". The first version drew a visible "Travel to" event *and* kept the planner's 45-minute
  commute-home wall (17:15 to 17:45). Now a stated arrival time replaces the default wall; known places live in
  `~/.openclaw/orion-controlled/places.json` (private; one example is a 15-minute commute to a named place).

**(d) Code speaks (`3076cbb`, `a847ba8`, `46235d4`).** `3076cbb`: "Left to phrase it, the 9B said 'before you head
to the spit' for a plan that starts there." So the reply after a calendar change is built by code from the
scheduler's lines and the worker repeats it. `a847ba8` enforces it at three points: `before_agent_finalize`
makes a revise round with the exact reply; `reply_payload_sending` (`local-routing.ts:380-387`) rewrites the
outgoing text, swapping in the stored code-built reply; and "a false claim
that survives retries is replaced by an honest line".

**(e) `clear_after` and the 11,000-token runaway (`ea28355`, 15:32).** "Live 2026-10-12 15:22: the request
timed out — the gateway ran the 9B with thinking on and it generated 11k tokens relaying a reply, holding the model
while the next call waited for memory." Gateway config was changed to `think: false` and `num_predict`/`maxTokens`
2048 (again live config, not in git). New step: `clear_after` ("clear my schedule after my lab"); the spoken
reply now covers cleared blocks.

**(f) The live gauntlet (`a847ba8` → `3389cd4`).** `scripts/eval/v3/gauntlet/run.sh` pushes lines from
`today.txt` (8 messages) and `tomorrow.txt` (4) through the **real gateway** (`openclaw agent --session-key …`)
against Nick's **real calendar**, printing the reply, the flow call, the findings and the day afterwards. Each
round ends by emptying what it added. Its own header: "Only run with Nick's OK and while he is not
mid-conversation with ORION. 12/12 passed on 2026-10-12." The sequence of rounds, from the commit bodies:

| Round | Result | What failed and what fixed it |
|---|---|---|
| 0 (`a847ba8`) | **3/8** | "studying", "shorter", "ditch", "stick" did not trigger the flow, and the old loop "said Done for changes it never made"; after the flow acted the 9B paraphrased from session history. Fix: stem-based trigger; exact-reply revise; delivery-time rewrite; honest line for surviving false claims |
| 1 (`46235d4`) | not recorded | "push back half an hour" made the 9B compute 16:15 (refused); replies paraphrased old turns on the CLI route (the delivery hook does not fire there); "ditch the macro stuff" used `skip`; "whats left tonight?" had no calendar. Fix: `by`-shifts computed by code, skip on own blocks becomes drop, the exact reply is also appended to the latest message, questions get the day read by code |
| 2 (`490535f`, tomorrow) | not recorded | "tmrw" read today's calendar; a front-desk error silently disabled the flow; "can't" was paraphrased into "I'll set it". Fix: `tmrw`/`tmr`/`2moro` regex, a front-desk error keeps the flow on, can't/ask replies exact |
| final (`3389cd4`) | **12/12**, 7 to 12 s a turn, all local | the CONTINUE file lists what it covers: fill, move by "half an hour", resize, drop, clear-after, plan with an invisible commute, a question, and a fake-out ("the lab is cancelled lol jk") |

### Why

The Era 7 failures and the Era 5 numbers agreed on one point: scheduling was the one job where the 9B could not
be trusted with an open loop (63 to 75 percent held-out). Code can do arithmetic, resolve anchors, check ids and
phrase the reply; the 9B is good at "which of these seven blocks does he mean?". So code does everything
deterministic, and the model fills a small constrained form. The cost: every new kind of request needs a new
step in the form and the compiler. The gain: the model cannot write a wrong flag, a wrong date or an invented
time.

### Key commits

| Commit | Date | What |
|---|---|---|
| `f0b2b67` | 10-12 13:10 | `schedule-flow.ts` |
| `110bc80` | 10-12 13:17 | Guards; real flow unreachable from tests after "B4" |
| `cd91e9d` | 10-12 13:45 | Plans |
| `70ebf12` | 10-12 13:57 | Invisible commutes |
| `3076cbb` | 10-12 14:01 | Reply built by code |
| `ea28355` | 10-12 15:32 | `clear_after`; gateway thinking off |
| `a847ba8` | 10-12 15:44 | Gauntlet round 0 fixes |
| `3389cd4` | 10-12 16:02 | Gauntlet 12/12 |

### Steps back

1. **The plugin test that wrote a real "B4" to the calendar (`110bc80`).** The commit body: "A test missing a stub
   ran the real flow and wrote a block titled 'B4' to Nick's calendar (undone). Now the live flow is wired only
   from `index.ts`". The CONTINUE file records it as an **Incident (fixed)** (`ORION_V3_CONTINUE.md:27`). Mechanism:
   `registerLocalRouting` takes `scheduleFlow` as an option and the default implementation runs the real
   scheduler (`local-routing.ts:54`, option comment "The scheduling flow (tests pass a stub; default runs the real scheduler and the worker via Ollama)");
   a test that did not pass a stub took the default. "B4" is simply the id of the fourth block in the form (the
   fixture uses `B4` for "do cert courses", `schedule-flow.test.ts:24-30`). The fix: the live flow is wired only
   from `index.ts` (`liveScheduleFlow`, imported at `index.ts:3`), so the unit tests *cannot* reach it. This is
   the second "test touched the real calendar" incident of the period (the first was `sandbox.mjs`, Era 4). The
   pattern: a default that does the real thing is a trap; make the real implementation the thing a caller has to
   ask for.
2. **A 14,000-token runaway in the form (`cd91e9d`) and an 11,000-token one in the relay (`ea28355`).** Both
   unbounded generations held the single GPU while the next call waited for memory. Fixes: `num_predict` 500 for
   forms, `maxItems`/`maxLength` in the schema, `think: false` and `num_predict` 2048 at the gateway.
3. **The first gauntlet round went 3/8.** The old loop said "Done" for changes it never made, again, in the
   production route. This is the same failure class as the 10-08 incident that started V3. It shows the work
   check was necessary and not sufficient: it only checks the reply against tools that ran, and in these cases
   *no tool ran*. Fix: the flow's own result is final and replies are replaced by code.
4. **A paraphrase of history.** Replies on the CLI route copied text from older turns because the
   delivery-time hook does not fire there; the fix was to put the exact reply in the latest message too.
5. **The calendar of record was Nick's real calendar.** The gauntlet can hurt; hence its header and its
   "empty what it added" step. It is not a CI test.

### Lessons

- **Make the model do the one thing it is good at, and everything else code.** The 9B at temperature 0 chooses
  among at most a dozen block ids; it never types a time, a flag or a date.
- **Evaluate the real route.** Round 0's 3/8 was found by the gauntlet, not by 438 unit tests.
- **Make the real thing hard to reach from tests.**
- **Cap every generation.** Both runaways were avoidable.
- **Say what code can say.** A reply built from the scheduler's own output cannot claim anything the
  scheduler did not print.

### Walk it yourself

```bash
sed -n 1,30p plugin/orion-control/src/schedule-flow.ts
sed -n 105,200p plugin/orion-control/src/schedule-flow.ts      # compile(): the argv builder
sed -n 376,390p plugin/orion-control/src/local-routing.ts      # reply_payload_sending
cat scripts/eval/v3/gauntlet/run.sh | head -12                  # do NOT run it without a calendar you can restore
git show -s --format=%B 110bc80 a847ba8 46235d4 490535f
```

### Questions to ask your tutor

1. Why are block references an enum of real ids in the schema, and what does that prevent?
2. What are the trade-offs of a fixed sequence versus an open tool loop (latency, accuracy, extensibility)?
3. Why must both `before_agent_finalize` and `reply_payload_sending` carry the exact reply?
4. How did "the real flow reachable by default" become a "B4" in his calendar, and what is the safest default
   for an option like `scheduleFlow`?
5. Why is "commutes are invisible blocks" a rule about the *planner*, not just the display?

---

## 11. Era 10 — Reminders and the to-do redesign (10-13)

Four commits: `b5bf4ab` (01:58), `26f914d` (02:07), `7f82b2c` (13:56), `6c93032` (14:15).

### What was built

**(a) "Remind me at 11" is `alarm_set`, never a to-do (`b5bf4ab`, `26f914d`).** The trigger, from the commit body:
at 00:44 on 10-13 Nick said "remind me tomorrow around 11 am to text the marketing group chat". The 9B ran
`orion-tasks add … --due tomorrow --at 11:00`; `--at` was ignored, "due Wednesday" was set, the planner booked it
at 5:50 PM *today* and pushed his cert-courses block, and the reply said 11 AM. It was undone and re-dated by
hand. Four fixes in one commit:

1. `orion-tasks` now refuses unknown options (the `1e99edc` principle again).
2. A reminder with a time is routed to `alarm_set`, with the code working out the exact call
   (`local-routing.ts:313-328`, `REMINDER` regex at line 316): `{"steps":[{"action":"alarm_set","at":"<date>T<time>","label":"<what it is for>"}]}`.
   The reminder's time and label are extracted by a small local call (`extractReminder`).
3. After midnight, "tomorrow" means today (`LATE_NIGHT_UNTIL = 5`, `schedule-flow.ts:213`): at 00:44, "tomorrow
   around 11" means 11:00 the same morning.
4. The testing window is checked **per turn**, not once at startup (`local-routing.ts:284`, 'the testing window closed:
   back to shadow'), so a window that ended mid-session cannot keep "on" alive.

`26f914d` covers the next failure, 02:05 the same night: "the 9B replied 'I've set a reminder for Tuesday at
11:00 AM' with no tool call, and **both checkers missed 'set a'**." So "I've set a …" is now a claim in both
`scripts/lib/eval/v3/claims.mjs` and `plugin/orion-control/src/work-check.ts` (a test pair was added), the
worker is told "Set Nick's reminder now with ONE orion_task_run call using exactly these arguments", and a
turn that ends without the `alarm_set` call is **retried once** and then **replaced** with "I didn't manage to set
that reminder — nothing was set. Can you say it again?" (`local-routing.ts:409-415`). The call still goes through
`orion_task_run`'s own gate.

**(b) A redesigned to-do list shared by Mac and phone (`7f82b2c`, 13:56).** Modelled on Nick's Notion list: one
shared `OrionViews` screen (to do / upcoming / by tag / done), coloured priority and tag pills (Notion's nine
colours, no two tags alike), a tag filter; add everything at once ("essay #school !high fri 5pm") or from pills
under the field; edit in place (click the title to rename, pills are menus, the row opens for details, spread and
parts), no form sheet or Save button. New files: `native/OrionMobile/Sources/MobileCore/TodoBoard.swift`,
`TodoQuickAdd.swift`, and `native/OrionMobile/Sources/OrionViews/Todo{Composer,Detail,ListScreen,Pills,Row}.swift`
plus tests (`TodoBoardTests.swift`, 119 lines). 18 files, +1,666 / −728 lines (the old `TasksTab.swift` went from 415 deleted lines to 36 added, and
`PlanViews.swift` 293 deleted to 27 added, per `git show --numstat`). Two format rules: date-only dues are stored at 23:59 without
an alarm (timed dues keep theirs); details written without a spread are marked `Notes:` so neither the Swift
parser nor the planner's Node parser reads them back as the spread, and `Tags:` and `Order:` never become one
(`scripts/lib/life/task-notes.mjs`).

**(c) The sweep (`6c93032`, 14:15).** "Reminders lists only open to-dos, so ticking one off never removed the
sessions orion-tasks had booked (his finished cert courses stayed booked every evening)." `orion-tasks` now records
which to-dos it booked, and `orion-tasks sweep` (run by `orion-watch` every tick, and before every plan) drops
the upcoming sessions of any that are no longer open. "What already happened stays." 4 files, +76/−5.

### Why

A cluster of small failures in the first real days of the new local route: the model chose a tool whose
semantics it did not understand and then claimed success in prose. Each fix moves one more decision from the
model into code (reminders), and one more guarantee into the platform (refuse unknown flags; sweep orphans).

### Key commits

| Commit | Date | What |
|---|---|---|
| `b5bf4ab` | 10-13 01:58 | `alarm_set` for reminders; after-midnight tomorrow; refuse unknown options; per-turn window check |
| `26f914d` | 10-13 02:07 | Code builds the `alarm_set` call; retry then replace; "I've set a" is a claim |
| `7f82b2c` | 10-13 13:56 | Redesigned shared to-do list |
| `6c93032` | 10-13 14:15 | `orion-tasks sweep` |

### Steps back

1. **The 00:44 reminder** that became a to-do with the wrong date and moved his real work (above).
2. **Both claim checkers missed "I've set a…".** The validated checker (65/65 on real labels) had a hole in
   exactly the phrase the 9B uses. A 100 percent score on a labelled set is a statement about the set.
3. **No HANDOFF entry covers 10-13.** `HANDOFF.md`'s newest entry is 2026-10-12 10:09; `ORION_V3_CONTINUE.md`'s
   newest is 2026-10-12 16:15. The four 10-13 commits, the redesigned to-do list and the sweep are recorded
   only in their commit messages. If an AGENTS.md rule says "dated HANDOFF.md entries", this is a gap
   (`ORION_V3_CONTINUE.md` §0 names the repo rule: "commit + push finished work, no history rewrites, dated
   HANDOFF.md entries").
4. **It is not recorded whether the new to-do UI or the sweep are installed.** The commit says what was built; I
   found no install proof for build number or phone. **(open)**

### Lessons

- **A reminder is an alarm, not a to-do.** Two tools with similar names are a mistake waiting for a 9B to make
  it; route by code.
- **When a claim checker misses a phrase, add the phrase, with a test, to both copies.** The parity test between
  `claims.mjs` and `work-check.ts` is what made that cheap.
- **Cleanup is a feature.** Tickable lists must remove what they scheduled.

### Walk it yourself

```bash
git show -s --format=%B b5bf4ab 26f914d 6c93032
sed -n 313,330p plugin/orion-control/src/local-routing.ts
sed -n 405,418p plugin/orion-control/src/local-routing.ts
git show --stat=120 --format= 7f82b2c
```

### Questions to ask your tutor

1. Why does `alarm_set` need the exact call built by code, and what do the three gates (extract, call, retry)
   each protect against?
2. What makes "after midnight, tomorrow means today" a *scheduling* rule and not a language rule?
3. Why is "tick it off" not enough to clean up the sessions the planner booked?
4. Why are `Tags:` and `Order:` kept out of the spread parser?
5. What would a regression test for "both checkers missed 'set a'" assert?

---

## 12. Steps back, catalogued

Every row is a thing that went wrong, how it was found, its root cause, and what now prevents a repeat. The
first six are the named incidents from the brief; the rest are the supporting cast. "Evidence" cites a commit
or a file; I did not invent any row.

### 12.1 The named incidents

| # | Incident | When | Found by | Root cause | Prevented now by | Evidence |
|---|---|---|---|---|---|---|
| 1 | **The prompt diet** made ORION worse | trim 10-07 10:10, noticed 10-08, reverted 10-08 15:26 | Nick: a reschedule he said was done never happened | Always-on prompt files cut by about a third (AGENTS 29,502 to 22,948 bytes; SOUL, USER, MEMORY roughly halved) and tool semantics moved behind `orion-help`; scheduling-only evals could not see the loss. The repo records *that* it got worse, not *why* **(cause inferred)** | Revert `0691dc4`; V3 evaluates against real logs and requires honesty checks, not only scenarios | `f17471c`, `0691dc4`, `ORION_V3_HANDOFF.md:48-50` |
| 2 | **False "Done" after `NOTHING WAS BOOKED`** | 10-08 | Nick asked to redo his day around leaving at 4 PM | The model reported success in prose although the tool printed `NOTHING WAS BOOKED` (`scripts/orion-reschedule:990`) | The claim checker (eval, `claims.mjs`) then the work check (plugin, `work-check.ts`) compare reply to tool output; later code builds the reply (`3076cbb`, `a847ba8`) | `ORION_V3_HANDOFF.md:48-50`, `7575167` |
| 3 | **A plugin test wrote a real "B4" block** to his calendar | 10-12, before 13:17 | The block appeared; undone | `registerLocalRouting`'s `scheduleFlow` option defaulted to the real scheduler, and a test passed no stub | The live flow is wired only from `index.ts` (`liveScheduleFlow`), so tests cannot reach it | `110bc80`, `ORION_V3_CONTINUE.md:27` |
| 4 | **Ollama temperature defaults** | found 10-12 11:21, fixed by 13:25 | A research agent read config and the Ollama model card | The live 9B ran with an empty `{}` model entry, so Ollama defaults (temperature 1.0, presence penalty 1.5) applied; evals used temperature 0 to 0.2 | Per-model params in live config `models.providers.ollama.models[qwen3.5:9b].params` (not in git); `FORM_OPTIONS` in code for the flow | `docs/evals/v3/RESEARCH_IDEAS.md:9-17`, `ORION_V3_CONTINUE.md:22-27`, `schedule-flow.ts:62` |
| 5 | **The live-routing failure** | 10-11 19:40 to 10-12 09:55 (then "on" again from 13:03 under a testing window) | Nick's real request "fill the time between my classes" | "On" enabled on evaluation numbers alone; eval route, prompt, tools and sampling differed from production | The acceptance gate (`local-routing.ts:218-229`); the testing window; the gauntlet | `612f962`, `f835b11`, memory note `no-live-switch-without-real-route-test` |
| 6 | **The API credit outage** | from 2026-10-11 19:23 | Not noticed for hours; found while debugging slow local turns | Anthropic returned 400 for credit (and a usage-cap message with return date 2026-11-01); the gateway fell back to the 9B with the 17k-token prompt (60 to 300 s) | `account-health.ts`: one phone alert per episode naming the fix; optional fail-fast | `513276d`, `account-health.ts:1-30`, `HANDOFF.md` 2026-10-12 10:09 |

### 12.2 Supporting cast

| # | What | Era | Commit | Lesson |
|---|---|---|---|---|
| 7 | 54 percent stall: watchdog re-counted a parked blocker | 1 | `d2f7745` | Count each failed execution once |
| 8 | State published before validation | 1 | `ad02048` | Validate before the atomic write |
| 9 | Two Qwen "1/16" rows were transport failures | 1 | `5293e1a` (data) | A zero is a harness bug until read |
| 10 | Minute-resolution IDs tripped the replay guard | 1 | `0a0aa7e` | IDs to the millisecond; eval replay state isolated |
| 11 | Test-generated check-ins sent real notifications | 1 | `ae41446` (HANDOFF) | Evals must never touch live storage |
| 12 | Hologram lag (two Canvases plus blur) | 1 | `83f92fc` | Profile, then one batched Canvas |
| 13 | Nap at 12:30, 30 min, against a 75-min rule | 2 | `6830e6d`, `295000a` | One home for each rule |
| 14 | `--until` silently ignored | 2 | `1e99edc` | Refuse unknown options with NOTHING WAS CHANGED |
| 15 | 30 repeat-guard blocks without ending the turn | 2 | `2b4301c` | After three blocks, no more tools |
| 16 | `orion-ontask` overwrote the app's state file | 2 | `6eb4dca` | One writer per state file |
| 17 | Approval granted, nothing ran | 2 | `e568abb` | An approval needs a resume path |
| 18 | Phone voice ran away | 2 | `4000a9d` | `VoiceSessionGuard` limits |
| 19 | Voice would not start (`scenePhase .inactive`) | 3 | `138c00a` | Only `.background` ends it |
| 20 | "CS lab" matched the CS2100 Lab class; `skip` deleted a class | 3 | `2f89313` | Rank by closeness of title |
| 21 | Scripts committed 644; every new to-do failed | 3 | `2f89313` | Test that scripts are 755 |
| 22 | Glued commands: `drop X move Study --by 30` | 3 | `a7f506b` | Refuse two commands in one call |
| 23 | AddressGate dropped five real follow-ups | 3 | `e5cd0d0` | A filter's error direction matters |
| 24 | Alarm storm ("snooze 20 million") | 3 | `188afeb` | Serialise AlarmKit scheduling |
| 25 | Unsplit env string reached the real calendar | 4 | `aebaa0d` | Env as object; `preflight()` |
| 26 | Log extractor dropped real sessions | 4 | `f1ec2f9` | Independent review before trust |
| 27 | Grader bugs: markers, apostrophes, partial, "booked" | 5 | `7e9430b`, `f9e8fb2`, `57be797`, `e74d09b` | Read transcripts before trusting a score |
| 28 | gpt-oss "on" invalid, 0/25 | 5 | `5eb940b` | Validate parameters per model family |
| 29 | Queue stalled 2 hours by a `pgrep -f` match | 5 | `e9811fa` | Match on `^node …`, never on loose text |
| 30 | Judge v2 agreed less than v1 | 5 | `c95e5d4` | Tighter rubric is not better |
| 31 | Overfitting a small practice set (4B 89 to 94 practice, 123 to 123 held-out) | 5 | `0fc202e` (p6), `53922c4` | Add cases, do not patch prompts |
| 32 | Cold 4B timed out at 4 s; reloads at 7 s from `num_ctx` mismatch | 7 | `151c27c`, `e42de88` | One `num_ctx` for every call |
| 33 | `before_agent_reply` does not fire on the CLI/phone route | 7 | `e42de88` | Check which hooks fire on which route |
| 34 | 17k-token prompt on the 9B (60 to 100 s a turn) | 7 | `b4c8b55` | Slim worker prompt |
| 35 | Tool surface mismatch: bare names, `&`, `tomorrow`, CS2101 vs CS2100 | 7 | `18c8f85` | Test through the real scripts |
| 36 | Front desk "ask" starved the 9B of the real request | 7 | `966cd63` | Change requests always reach the worker |
| 37 | AGENTS.md silently truncated at 20,000 characters | 8 | `15f0775` | Put the manual in the brain; look it up |
| 38 | First account-health design re-alerted on old failures | 8 | `513276d` | Fresh messages only; mutation-test fixes |
| 39 | 14k-token form runaway; 11k-token relay runaway | 9 | `cd91e9d`, `ea28355` | Cap every generation |
| 40 | Gauntlet 3/8: old loop said "Done" for changes it never made | 9 | `a847ba8` | The flow's result is final; code builds the reply |
| 41 | 9B arithmetic ("push back half an hour" gave 16:15) | 9 | `46235d4` | Code does time arithmetic |
| 42 | Reminder became a to-do, wrong date, moved real work | 10 | `b5bf4ab` | Reminders are `alarm_set`, by code |
| 43 | Both checkers missed "I've set a…" | 10 | `26f914d` | Add the phrase, test both copies |
| 44 | Finished to-do's sessions stayed booked | 10 | `6c93032` | `orion-tasks sweep` |

---

## 13. Decisions and reversals

Decisions are Nick's unless a different owner is named. "Reversal" means a later commit or note undid it.

| Date | Decision | By | Reversed? | Evidence |
|---|---|---|---|---|
| 10-02 | Qwen surfaces run finished by Codex handover with honest attribution | Nick, Codex | no | `357a227`, HANDOFF 02:45 |
| 10-02 | Rename Tasks to Plan, compact composer | Codex | no | `8dd68c4` |
| 10-05 | Basic Memory (local Markdown) is the brain | Claude (approval not recorded) | no | `cd1bcb6` |
| 10-06 | `orion-focus` retired; focus is `orion-session` | Claude | no | `6eb4dca` |
| 10-07 | Local 9B filters overheard speech before Claude | Claude | **yes, 10-08 07:45** | `18c29b9`, `e5cd0d0` |
| 10-07 | Trim always-on prompt files | Claude | **yes, 10-08 15:26** | `f17471c`, `0691dc4` |
| 10-07 | 1-hour prompt cache (`cacheRetention: long`) | Claude | no (live config) | `f17471c` body |
| 10-07 | Per-message topic attachment rejected | Claude | n/a, measured worse | `f17471c` body |
| 10-08 | Phase 1 first (real logs), then test sets | Claude, Nick | no | `ORION_V3_HANDOFF.md` |
| 10-08 | Download `qwen3.5:4b-q4_K_M` | Nick | no | HANDOFF 10-08 20:25 |
| 10-08 | No Haiku reference run for now | Nick | open | `ORION_V3_CONTINUE.md` §1 |
| 10-08 | Tuning may differ per model; big prompts allowed | Nick | no | `c505cbd` |
| 10-09 | Repair queue note "ORION repair queue" | Nick | no | `ORION_V3_CONTINUE.md` §1 |
| 10-09 | J7 judge rubric v2 | Claude | **yes, 10-09 18:59** | `db6e1ac`, `c95e5d4` |
| 10-09 | 40 examples for 9B J1 | Claude | **yes, re-frozen at 25** | CONTINUE 16:37 |
| 10-10 | No category "deep" tier; 9B tries, checks, escalates | Nick | no | CONTINUE 10-10 22:40 |
| 10-10 | 9B self-review rejected (flags nearly everything) | Claude | n/a | `REPORT.md:416-434` |
| 10-11 | `localRouting` "on" live | Claude (Nick's go-ahead not recorded) | **yes, 10-12 09:55** | routing log, `612f962` |
| 10-12 | Phone never answers with the on-device model | Nick | no | `a44ce44` |
| 10-12 | "On" refused without a real-route pass | Nick | no | `612f962` |
| 10-12 | `localRoutingScheduleToCloud` option, default off | Claude | off in live config today | `0372a72` |
| 10-12 | Manual lives in the brain; small core prompt | Nick | no | `15f0775` |
| 10-12 | Scheduling as a fixed sequence (form, compile, run) | Claude, Nick | no | `f0b2b67` |
| 10-12 | Commutes are invisible blocks | Nick | no | `70ebf12` |
| 10-12 | Gateway 9B: thinking off, `num_predict` 2048 | Claude | no (live config) | `ea28355` |
| 10-13 | Reminders by `alarm_set`, built by code | Claude | no | `b5bf4ab`, `26f914d` |
| 10-13 | To-do list redesign after Notion | Nick | no | `7f82b2c` |

---

## 14. Lessons that recur across eras

1. **An evaluation is only as good as its resemblance to production.** Era 3 (scheduling-only evals) and Era 7
   (sandbox tools, small prompts, temperature 0) are the same mistake. The mitigations: the real-route
   acceptance gate; the gauntlet; replay on real logs; and matching sampling parameters.
2. **Read transcripts before you read scores.** Six grader bugs (Era 5), two unfinished Qwen rows (Era 1) and the
   "set a" hole (Era 10) were all found by reading.
3. **Refuse, do not ignore.** `--until` (Era 2), unknown options in `orion-tasks` (Era 10), glued commands
   (Era 3). Silence is how a false "Done" starts.
4. **A claim needs a source.** The checker's rule is "ground truth is what the tools printed". The later fix is
   stronger: when code can build the sentence, code builds it (Era 9).
5. **Make the right path the only path.** The `B4` incident, the acceptance gate, the allowlist for `orion-focus`,
   `liveScheduleFlow` only from `index.ts`. A good default is the one that cannot hurt.
6. **Measure the failure direction.** The overheard-speech gate and the front desk's "ignore" can drop a real
   request; the cost of that error is not symmetric.
7. **Cap everything.** Two unbounded generations (14k and 11k tokens) each stalled the single GPU.
8. **Cost was the reason, and cost was mismeasured.** A prompt-cache write costs 12 times a read, so moving rules
   per message was *more* expensive; the 14 percent of the bill was real but a classifier tuned on 8 lines was
   not enough to remove it.
9. **Hand the model decisions it is good at.** The 9B picks from a dozen real ids; code does dates, flags,
   arithmetic and the reply.
10. **Write the lesson into the system.** The memory note, the gate in code, `ORION_V3_CONTINUE.md` section 6.


---

## 15. Where things stand today

Two states, because two commits landed after the snapshot (`6c93032`, 2026-10-13). First the snapshot state as
I read it on 2026-10-14, then "After the snapshot" (15.2).

### 15.1 At the snapshot (6c93032, worktree dirty)

**Committed and running (as far as the repo and the live config show):**
- The V3 local route: 4B front desk (`front-desk.ts`), 9B worker with tuned job instructions
  (`job-instructions.ts`), work check (`work-check.ts`), fixed-sequence scheduling flow (`schedule-flow.ts`),
  reminders through code-built `alarm_set`, account-health alerts (`account-health.ts`, deployed per the CONTINUE file).
- Live config (read 2026-10-14, not in git): `localRouting: "on"`, `localRoutingTrace: true`,
  `localRoutingScheduleToCloud: false`, `localRoutingTestingUntil: 2026-10-14T17:04:46Z` (already past at 20:42 UTC), gateway
  primary Haiku with fallbacks 9B then llama3.2:3b, and the 9B's params (temperature 0.2, top_p 0.9, top_k 20,
  presence_penalty 0, num_ctx 32768, keep_alive 24h, think false, num_predict 2048).
- The acceptance record is still the old one: 7/21, median 35 s, written 2026-10-10. So "on" is only allowed by the
  testing window. The gauntlet (12 cases) is below the gate's 20-case minimum.
- Routing log (`shadow.jsonl`, counted by mode and date only): 94 entries; "on" from 2026-10-11T18:40Z, shadow
  2026-10-12 08:55Z to 12:03Z, shadow briefly at 2026-10-13 01:02Z (the redeploy), last entry 2026-10-14 11:27Z in "on".
- `account-health.json` held an active **credit** episode (first seen 2026-10-13 01:02Z, alert sent). Whether credit
  was restored is not recorded anywhere I could read.

**In shadow:** nothing is in shadow now except when the window or the gate forces it; "shadow" is the fallback state.

**Uncommitted (from `git status --short` at the snapshot, 43 entries):** modified `docs/evals/2026-10-02-schedule/SUMMARY.txt`
(+2 lines, the Qwen thinking-medium 14/22 result), `docs/planning/v2/CURRENT_AUTHORITY.json` (counts 246 to 279 entries; new
`orion-brain` etc.), `docs/planning/v2/CURRENT_SECRET_INVENTORY.json`, six modified files and about 30 untracked files under
`plugin/orion-control/dist/` (the **compiled** plugin; `dist/` is tracked by design, `.gitignore:7`, so the code that is
actually deployed was ahead of git), three untracked eval files, and `docs/learn/`. Also at the snapshot the branch was 2 commits
ahead of `origin/orion-v2/backlog-checkpoint` (`7f82b2c`, `6c93032` unpushed).

**Open** (from the CONTINUE file's 10-12 16:15 update and the HANDOFF): Anthropic credits and the usage cap (Nick);
a Phase-8-style acceptance over many (at least 20) real-route requests; the example store from successful turns (idea 5);
propose/preview/commit (idea 4); a production-replay eval (idea 6); serving (idea 8, for example
`OLLAMA_MAX_LOADED_MODELS=2`); the Phase 7 battery session and the energy table; gpt-oss registration for real escalation;
the J7 judge still provisional; the supervised live day; a review of ORION's capabilities with Nick; no HANDOFF entry for 10-13;
install proof for the to-do redesign unknown.

### 15.2 After the snapshot

Two commits, both 2026-10-14 evening, both Claude. Read with `git show`.

**`e3fe000` (22:10) fix(local): keep both local models warm at their real context; no hidden thinking.** Diagnosis in the body:
turns took 15 to 23 s (a terminal run was instant) and some never answered. Causes:
1. The Mac app's chat sessions carry `thinkingLevel "low"` (its policy sees only the cloud model he picked); the gateway forwards
   a session thinking level over the model's `think:false` unless the model entry is marked `reasoning:false`. The 9B thought
   100 to 250 tokens a turn and twice ran out of `num_predict` ("Agent couldn't generate a response"). Fix: `reasoning:false` in
   live config (not in git).
2. Only the 4B was warmed, once. `keepWarm` (`plugin/orion-control/src/front-desk.ts:109`) replaces `warmUp`: it reads
   Ollama's `/api/ps`, loads any model missing or loaded at another `num_ctx`, every 5 minutes, for both models at the context they
   are called with (`local-routing.ts`, 4B at `FRONT_DESK_CTX`, 9B at `FORM_OPTIONS.num_ctx`).
3. The testing window had closed (cloud model, no credit): renewed for 48 hours.
Result stated: 4.5 to 5.8 s per turn, 44 tok/s, no thinking. This is the Era 8 lesson again: an undeclared default (here a session
thinking level) overrode the model's own setting. 62 lines changed in three files, with a `keepWarm` test.

**`b90e577` (22:15) chore: clean the repo and write a fresh handoff.**
- New short `HANDOFF.md` (live state, deploy and test commands, last three days, open items, lessons). The 273 KB history and
  `ORION_V3_CONTINUE.md` are archived to `~/Desktop/ORION-archive/2026-10-14/` (and remain in git history).
- `ORION_V3_HANDOFF.md` moved to `docs/planning/v3/ORION_V3_SPEC.md`; references updated.
- Archived out of the repo: stale Aug/Sep planning docs and **the raw run folders of the 10-01..10-08 evals**
  (`docs/evals/2026-10-01-schedule`, `2026-10-02-schedule`, `2026-10-02-scheduling-memory`, `2026-10-07-prompt-diet`; their results live in
  `docs/evals/v3/REPORT.md`). `docs/evals/` now has only `conversation/` and `v3/`.
- `NICK-TODO.md` gains what is blocked on Nick (credits, testing window); `CLAUDE.md` read order includes the V3 spec and report; the
  plugin `dist/` (tracked) and regenerated authority snapshots are committed, so the worktree is clean except `docs/learn/`.
- The new HANDOFF says the whole route now runs on local models, testing window until 2026-10-16T20:58:39Z, and that when it closes the
  cloud model "cannot answer", so ORION would go silent unless renewed or the acceptance gate is passed.

**Consequence for this chapter.** Paths I cite as `ORION_V3_HANDOFF.md`, `ORION_V3_CONTINUE.md` and `docs/evals/2026-10-0x-*/` no longer
exist at HEAD. Use `docs/planning/v3/ORION_V3_SPEC.md` (same content, same line numbers unless edited), and
`git show 6c93032:ORION_V3_CONTINUE.md` (or the archive folder) for the CONTINUE file and `git show 6c93032:docs/evals/<folder>/<file>`
for run files. The uncommitted Qwen thinking-medium files at the snapshot were not in git; whether they were archived is not recorded here.

---

## 16. Walk the whole period yourself

```bash
cd ~/Desktop/ORION
git log --reverse --format='%h %ad %s' --date=short 6c93032 | awk '$2>="2026-10-02"' | wc -l      # 185
git log --reverse --format='%h %ad %s' --date=short b90e577 | awk '$2>="2026-10-02"' | wc -l      # 187
git show -s --format=%B f17471c 0691dc4 612f962 110bc80 513276d e3fe000
sed -n 344,440p docs/evals/v3/REPORT.md                       # the recommendation
sed -n 205,245p plugin/orion-control/src/local-routing.ts     # the gate
sed -n 1,30p plugin/orion-control/src/schedule-flow.ts        # the flow design
sed -n 105,130p plugin/orion-control/src/front-desk.ts        # keepWarm
cat HANDOFF.md | head -60                                      # today's live state
```

Private data (only on your machine, never paste into a chat): `~/.openclaw/orion-controlled/evals/v3/ledger.jsonl`,
`.../local-routing/shadow.jsonl`, `.../local-routing/acceptance.json`, `.../account-health.json`.

### Questions to ask your tutor (whole period)

1. Trace one request ("fill the time between my classes") through the 10-14 route, naming each hook and file.
2. What changed between the 10-08 trim and the 10-12 gate in how the project decides something is safe to ship?
3. List every place a default (Ollama sampling, session thinking level, `num_ctx`, a test option) silently caused a failure.
4. Why is the work check necessary but not sufficient, and what covers the gap?
5. If the testing window closes and credit is still empty, what does ORION do, and what are the three ways out?
6. Which of the numbered lessons in section 14 would you turn into an automated test first?

---

## 17. Every commit in range

185 commits authored 2026-10-02 to `6c93032`, plus the two post-snapshot commits (era "post"). Type is the conventional-commit
prefix. Eras: 1 surfaces/schedule eval/hologram; 2 brain/to-dos/focus; 3 cost/trim/reach/morning; 4 revert and V3 harness; 5 tuning
campaign; 6 cascade and plugin build; 7 live "on" and the gate; 8 account health and research; 9 scheduling flow and gauntlet;
10 reminders and to-dos; post = after the snapshot.

| Hash | Date | Type | Meaning | Era |
|---|---|---|---|---|
| `d2f7745` | 2026-10-02 | fix | Agentic runtime: a rejected repair edit goes to bounded retry instead of being called a refusal; each failed execution counted once | 1 |
| `86b52d3` | 2026-10-02 | fix | Operator repair: public chat value initialisers and an explicit discard of a widget write result so the shared UI compiles | 1 |
| `3dc76c5` | 2026-10-02 | feat | Handover finish of the Flux turn tracker (URL/config parsing, 11 scenarios, 12 tests) | 1 |
| `2e6a045` | 2026-10-02 | feat | Handover finish of the phone orb views (mood/voice mapping, Reduce Motion) | 1 |
| `d73711b` | 2026-10-02 | feat | Handover finish of the slimmer phone composer | 1 |
| `6628d0a` | 2026-10-02 | feat | Handover finish of the finished-early UI (cancellable timers, haptic) | 1 |
| `2306e74` | 2026-10-02 | feat | Handover finish of the floating summon composer | 1 |
| `d988191` | 2026-10-02 | feat | Handover finish of chat-mode views (sidebar, rename/delete, model menu) | 1 |
| `3bfc08b` | 2026-10-02 | feat | Handover finish of phone focus lists (four token lists, separate shield store) | 1 |
| `e008b3c` | 2026-10-02 | merge | Merge of the completed "ORION surfaces" Qwen project after Codex handover and Qwen 27B final review | 1 |
| `ad02048` | 2026-10-02 | fix | Agentic runtime: validate the whole next snapshot before publishing state, so a bad host status cannot replace valid state | 1 |
| `e7b0efa` | 2026-10-02 | fix | Finished projects no longer show a "restart the supervisor" hint at 100 percent | 1 |
| `357a227` | 2026-10-02 | docs | HANDOFF record of the surfaces run, causes of failure and test counts (946 Node, 64 Swift) | 1 |
| `5293e1a` | 2026-10-02 | docs | Schedule evaluation results of 1 October: Haiku, Sonnet 5, Qwen 3.5 9B, Qwen 3.6 27B | 1 |
| `0a0aa7e` | 2026-10-02 | fix | Scheduler: per-date pins, undo restores them, saved minimums apply today, relative moves; eval IDs unique to the millisecond; transport failures grade as failures | 1 |
| `ff0ec35` | 2026-10-02 | feat | Native chat, Flux EndOfTurn, schedule-focus supervision wired into the Mac app | 1 |
| `cfb39a6` | 2026-10-02 | docs | HANDOFF: schedule evaluation and installed surfaces integration | 1 |
| `499f02e` | 2026-10-02 | fix | Home chat gets a "Back to Home" control | 1 |
| `300a708` | 2026-10-02 | docs | HANDOFF: Home return control installed | 1 |
| `8dd68c4` | 2026-10-02 | fix | Tasks tab renamed Plan; embedded chat replaced by a compact composer | 1 |
| `985c254` | 2026-10-02 | docs | HANDOFF: compact Plan composer proof | 1 |
| `5b24215` | 2026-10-02 | feat | Model-usage view (orion-usage) and the conversation-comparison harness (dry run by default) | 1 |
| `085de0f` | 2026-10-02 | docs | HANDOFF: usage view installed, scheduling review evidence | 1 |
| `ae41446` | 2026-10-02 | fix | One early-exit button, SCHEDULING.md rules file, Thinking Orion hologram | 1 |
| `c00c5d8` | 2026-10-02 | docs | HANDOFF: scheduling and hologram deployment proof | 1 |
| `e34a9c6` | 2026-10-02 | fix | Combined hologram slowed to 45 percent; typed replies are silent, only voice turns speak | 1 |
| `f04c92c` | 2026-10-02 | docs | HANDOFF: combined hologram and silent replies verified | 1 |
| `83f92fc` | 2026-10-02 | perf | Hologram drawn in one batched Canvas to cut lag | 1 |
| `16b44bb` | 2026-10-02 | docs | HANDOFF: hologram CPU measurements (Orion 20.5 to 16.5 percent of a core) | 1 |
| `dd8a0a8` | 2026-10-02 | ui | Thinking stays gold; the twisting orb is drawn in front | 1 |
| `a66e8d7` | 2026-10-02 | docs | HANDOFF: gold thinking verified live | 1 |
| `4ad1e3e` | 2026-10-02 | ui | Hologram rebalanced around a clear foreground orb | 1 |
| `e614be6` | 2026-10-02 | docs | HANDOFF: orb-first hologram verified | 1 |
| `0903801` | 2026-10-02 | feat | Phone full-screen talking mode shares the hologram (ThinkingOrbsKit) | 1 |
| `302fb8b` | 2026-10-02 | docs | HANDOFF: shared hologram build, installed on the Mac only | 1 |
| `6830e6d` | 2026-10-05 | fix | Scheduler: a three-hour class gap gets travel home both ways; the short-night nap honours his 75-minute minimum | 2 |
| `295000a` | 2026-10-05 | fix | One class-wrapper rule (homeGapMinutes 2.5 h) shared by code and the brain; every block carries a rank | 2 |
| `cd1bcb6` | 2026-10-05 | feat | Basic Memory brain seeded from what ORION knows (93 notes); orion-brain CLI to search, read, learn | 2 |
| `97e80d1` | 2026-10-05 | docs | Plan doc: six-phase brain learning plan for the local agent | 2 |
| `b748c40` | 2026-10-05 | feat | orion-project-queue: run several Qwen projects in order | 2 |
| `e11dc82` | 2026-10-06 | feat | To-dos with due dates, spreads and priorities planned into sessions (orion-tasks) | 2 |
| `b1b530b` | 2026-10-06 | feat | To-do groups with parts and edit popovers on phone and Mac | 2 |
| `d133e92` | 2026-10-06 | ui | UI: parts drop below their to-do | 2 |
| `5ff7aee` | 2026-10-06 | ui | UI: parts look like to-dos with a drag-to-set progress track | 2 |
| `528a99b` | 2026-10-06 | fix | Mac window behaves like a normal window (title bar, no drag-anywhere, stays on its Space) | 2 |
| `e568abb` | 2026-10-06 | fix | "Skip a class" needs no approval; an approval now actually runs through orion-approve-resume | 2 |
| `320626f` | 2026-10-06 | feat | Canvas course facts read and folded into brain notes (GET-only, Keychain token) | 2 |
| `1e99edc` | 2026-10-06 | fix | orion-reschedule: --until is real, unknown options fail with NOTHING WAS CHANGED, finishing early uses freed time | 2 |
| `2b4301c` | 2026-10-06 | fix | A stuck turn ends after three repeat-guard blocks; "clear today" gets a route | 2 |
| `75ebf7e` | 2026-10-06 | feat | To-dos that wait for another; drop exactly what he names | 2 |
| `6eb4dca` | 2026-10-06 | fix | Focus: orion-ontask moved to its own state file; ORION starts the session he sees (orion-session) | 2 |
| `e9cfc38` | 2026-10-06 | fix | Focus: Music keeps playing; playlists, minimise, today's rest, hologram in sessions | 2 |
| `475b14a` | 2026-10-06 | fix | Focus: playlist picker moved into the music panel; shuffle toggles reliably | 2 |
| `c254378` | 2026-10-06 | feat | Focus: minimise floats the session over every app | 2 |
| `de26885` | 2026-10-06 | ui | UI: the floating session becomes a thin bar at bottom middle | 2 |
| `8fc00be` | 2026-10-06 | fix | Focus: floating bar buttons work and the bar stays up when paused | 2 |
| `41e22f1` | 2026-10-06 | docs | Plan doc: backlog 1 (P0 phone voice guard, focus sequences, day totals, log audit) | 2 |
| `de9221b` | 2026-10-06 | feat | ORION can list, start, queue and stop Qwen projects from chat | 2 |
| `8f6d350` | 2026-10-06 | docs | Planning doc: 6 October backlog by owner and batch | 2 |
| `87b49ed` | 2026-10-06 | fix | Focus: ending a break can no longer lengthen it; any work/break sequence can start | 2 |
| `d7e4dcb` | 2026-10-06 | docs | Workspace rule: end a break with skip, never shorten | 2 |
| `4000a9d` | 2026-10-06 | fix | P0: phone VoiceSessionGuard (45 s idle, 15 min, 30 turns, three noise-only turns) | 2 |
| `656db4d` | 2026-10-06 | feat | orion-session: sequences, start part-way, recover an ended session, today's total | 2 |
| `de87e8c` | 2026-10-06 | feat | orion-log-audit: finds recurring failures in real chats | 2 |
| `00acf53` | 2026-10-06 | docs | Planning doc: batch 1 shipped, audit findings | 2 |
| `e109b8e` | 2026-10-06 | fix | app_open finds Finder and other system apps | 2 |
| `01576d2` | 2026-10-06 | feat | Voice: Escape/Done ends the turn, Left Option push-to-talk, chat button on Home | 2 |
| `2234adf` | 2026-10-06 | fix | Phone lock status older than 15 minutes reads UNKNOWN NOW | 2 |
| `eeb0c81` | 2026-10-06 | docs | Workspace rule: an unlock request with no length is granted | 2 |
| `c2e1824` | 2026-10-07 | feat | Option-Tab quick menu: now/next, live session, smart commands | 3 |
| `2f89313` | 2026-10-07 | fix | "CS lab" no longer matches the CS2100 Lab class; scripts committed 644 made executable | 3 |
| `9e901a9` | 2026-10-07 | feat | ThinkingPolicy (think only when it matters); one-call move --after/--before | 3 |
| `18c29b9` | 2026-10-07 | perf | Cost: a local 9B check drops overheard speech before it reaches Claude (33 turns, 14 percent of the API bill) | 3 |
| `94efdd4` | 2026-10-07 | docs | Workspace doc: move anchors; extend adds minutes | 3 |
| `849056b` | 2026-10-07 | fix | Self-doc fix: escape quotes in the orion-reschedule description | 3 |
| `f17471c` | 2026-10-07 | perf | Cost: the always-on prompt files trimmed (AGENTS 29,502 to 22,948 bytes, SOUL/USER/MEMORY roughly halved); harder evals. THE TRIM THAT LATER MADE ORION WORSE | 3 |
| `a7f506b` | 2026-10-07 | fix | orion-reschedule refuses glued commands; block names use his words; eval gets a TEST CLOCK and Ctrl-C cleanup | 3 |
| `54f5e05` | 2026-10-07 | eval | Eval record: core 22/22, hard 13/14 on Claude; skipping a class books his time | 3 |
| `f11402b` | 2026-10-07 | feat | Usage on Home: today's spend in the corner, full report when opened | 3 |
| `138c00a` | 2026-10-07 | fix | Phone voice starts again (scenePhase .inactive no longer cancels it) | 3 |
| `a139f4b` | 2026-10-07 | feat | orion-reach, orion-presence, orion-watches: ORION messages Nick first (work in progress) | 3 |
| `562c9f1` | 2026-10-07 | feat | Watches every 5 minutes; app exports incoming texts for the gate | 3 |
| `224687a` | 2026-10-07 | fix | Focus sessions use orion-session; reminders go through orion-reach with their label; reminder_cancel id fixed | 3 |
| `1adcc0d` | 2026-10-07 | docs | HANDOFF 2026-10-07; model contract follows the new fallback order | 3 |
| `406b019` | 2026-10-07 | fix | Model contract note moved into the allowed field | 3 |
| `0df9489` | 2026-10-07 | fix | Reminders can be cancelled by what they are for | 3 |
| `b9786d2` | 2026-10-07 | fix | Reminder ids no longer collide when set in the same millisecond | 3 |
| `094ebe2` | 2026-10-07 | feat | orion-proactive: ORION speaks first with context; no bedtime nagging in a session | 3 |
| `26baa71` | 2026-10-08 | feat | More proactive nudges; end/stop mean finish; ThinkingPolicy narrowed | 3 |
| `dce48ae` | 2026-10-08 | feat | Morning briefing when the phone says he is actually up | 3 |
| `f1fe2b2` | 2026-10-08 | feat | LED strip control (Lotus Lamp X) with the morning briefing | 3 |
| `27242e0` | 2026-10-08 | feat | Morning screen with the day and weather (first version) | 3 |
| `98a810c` | 2026-10-08 | feat | Morning screen (frosted panel version; same title as the previous commit) | 3 |
| `d5d550e` | 2026-10-08 | docs | HANDOFF: morning screen | 3 |
| `2e27833` | 2026-10-08 | fix | Morning gate uses the alarm he asked for, not the planner's 09:00 | 3 |
| `188afeb` | 2026-10-08 | fix | One wake alarm (AlarmKit serialised, strays cancelled); clearer weather | 3 |
| `98065bf` | 2026-10-08 | fix | Weather has rain times and high/low; cut-off speech kept | 3 |
| `e5cd0d0` | 2026-10-08 | fix | AddressGate (the local "said to ORION?" gate from 18c29b9) removed after it dropped real follow-ups | 3 |
| `4f1c1b8` | 2026-10-08 | fix | Short schedule blocks no longer overdraw the next one | 3 |
| `b6d72ea` | 2026-10-08 | feat | Pop-up appears whenever the dashboard is not in focus | 3 |
| `0691dc4` | 2026-10-08 | revert | REVERT of the 2026-10-07 prompt trim: AGENTS/SOUL/USER/MEMORY restored to full size | 4 |
| `23bacbe` | 2026-10-08 | docs | ORION_V3_HANDOFF.md: the local-first evaluation and tuning plan | 4 |
| `f1ec2f9` | 2026-10-08 | feat | V3 Phase 1: orion-v3-logs extractor over Nick's real turns | 4 |
| `ab731fc` | 2026-10-08 | docs | V3 Phases 0 to 1 report: day-zero checks, research review, real-use counts | 4 |
| `aebaa0d` | 2026-10-08 | feat | V3 harness core: stats, streaming Ollama client, agent loop, sandbox, claim checker | 4 |
| `5013de9` | 2026-10-08 | feat | V3 runner with J1 front desk, J2 simple tools, J4 honesty | 4 |
| `a3aa340` | 2026-10-08 | feat | V3 J3 scheduling on private sandbox days | 4 |
| `cce7bb6` | 2026-10-08 | feat | V3 J5 brain and J6 continuity jobs | 4 |
| `4c86f63` | 2026-10-08 | feat | V3 tuning loop and J1 prompt composition | 4 |
| `8e5204e` | 2026-10-08 | feat | V3 tool and schedule ladders, J7 judge, battery sampler | 4 |
| `ec9d351` | 2026-10-08 | feat | V3 held-out finals, decision rule, speed and report commands | 4 |
| `1085c2c` | 2026-10-08 | feat | V3 energy measurement from battery telemetry accumulators | 4 |
| `2a85fca` | 2026-10-08 | feat | V3 Phase 8 test-only escalation pipeline | 4 |
| `9eced83` | 2026-10-08 | docs | HANDOFF: V3 harness built, baselines started | 4 |
| `c505cbd` | 2026-10-08 | feat | V3 per-model breakdown and the p3 front-desk guide | 4 |
| `f402b9c` | 2026-10-08 | feat | V3 per-model private prompts, --schema-all and --history | 4 |
| `0f27932` | 2026-10-08 | feat | V3 J1 hand engineering: p4, explore/freeze, label fixes | 4 |
| `340527a` | 2026-10-08 | feat | V3 J1 p5, a short example-led prompt for small models | 4 |
| `0a21709` | 2026-10-09 | docs | Docs: interim front-desk held-out results | 5 |
| `7e9430b` | 2026-10-09 | fix | Grader fix (Logged/Showing markers) and the full reschedule guide prompt (pfull) | 5 |
| `b8a7546` | 2026-10-09 | feat | Honesty result-meaning block; curly apostrophes; explore for tool jobs | 5 |
| `f9e8fb2` | 2026-10-09 | fix | Claim checker: partial, pending and modal cases; freeze for tool jobs | 5 |
| `b12a5ca` | 2026-10-09 | fix | Odd orion_task_run step shapes no longer crash a run | 5 |
| `5eb940b` | 2026-10-09 | fix | gpt-oss "on" maps to medium (an invalid value had scored 0/25) | 5 |
| `57be797` | 2026-10-09 | fix | "It was booked" is not narration; "couldn't" counts as saying no | 5 |
| `0613267` | 2026-10-09 | docs | ORION_V3_CONTINUE.md and the portable work queue | 5 |
| `255edb0` | 2026-10-09 | feat | J7 judge calibration against hand scores | 5 |
| `0fc202e` | 2026-10-09 | feat | J1 p6 (p4 plus the 4B's three practice mistakes) | 5 |
| `9fff8bc` | 2026-10-09 | feat | J3 coaching guide (pcoach) | 5 |
| `db6e1ac` | 2026-10-09 | feat | J7 judge v2 rubric (later reverted) | 5 |
| `080c1ab` | 2026-10-09 | docs | HANDOFF update 16:37 | 5 |
| `267038f` | 2026-10-09 | feat | Judge calibration accepts a second hand-scored sample | 5 |
| `88c242e` | 2026-10-09 | perf | J1 compact JSON option | 5 |
| `3b56ee3` | 2026-10-09 | feat | Thermal state recorded; hot speed runs refused | 5 |
| `e74d09b` | 2026-10-09 | fix | Claim checker: "moved from old to new" is not a wrong detail; J3 finals re-graded | 5 |
| `8053f6f` | 2026-10-09 | feat | J6 coaching guide | 5 |
| `53922c4` | 2026-10-09 | test | 17 more J5 and 16 more J6 synthetic cases | 5 |
| `c95e5d4` | 2026-10-09 | revert | REVERT of judge v2 (it agreed less on identical items) | 5 |
| `1dee5d5` | 2026-10-09 | docs | HANDOFF update 19:05 | 5 |
| `e9811fa` | 2026-10-09 | fix | Queue worker counts only real eval processes as busy (a waiter shell stalled it two hours) | 5 |
| `05a1127` | 2026-10-10 | feat | Auto-freeze: best practice config per model plus its queued final | 5 |
| `c35ccd0` | 2026-10-10 | feat | regrade-final --write records re-graded finals | 5 |
| `b5bdfc7` | 2026-10-10 | docs | V3 report regenerated with all held-out finals | 5 |
| `8fb29b4` | 2026-10-10 | docs | V3 Phase 9 recommendation: routing matrix, per-job winners, decisions for Nick | 5 |
| `5993920` | 2026-10-10 | docs | HANDOFF: campaign complete except the battery session and Nick's decisions | 5 |
| `72f7dbf` | 2026-10-10 | feat | Try, check, escalate replay (cascade.mjs): 9B, runtime check, gpt-oss on failure | 6 |
| `0d98a5f` | 2026-10-10 | docs | Report section 9.7: try/check/escalate replaces the deep tier | 6 |
| `1719a48` | 2026-10-10 | feat | Cascade with a 9B retry: held-out J3 28/36 with 4/36 escalated | 6 |
| `7575167` | 2026-10-10 | feat | Plugin step 1: work-check.ts, a port of the claim checker plus calendar sanity check | 6 |
| `e12def4` | 2026-10-10 | feat | Plugin step 2: front-desk.ts with the frozen 4B prompt | 6 |
| `76436dc` | 2026-10-10 | feat | Plugin step 4: localRouting shadow mode logs decisions and findings | 6 |
| `f1b882c` | 2026-10-10 | docs | Docs: V3 implementation status and handoff | 6 |
| `2afffb8` | 2026-10-10 | feat | Plugin: localRouting "on" mode (front desk, 9B worker, check, retry, honest stop) | 6 |
| `151c27c` | 2026-10-11 | fix | First live "on" turn timed out cold: warm the 4B, 24 h keep-alive, 8 s timeout, stage trace | 7 |
| `e42de88` | 2026-10-11 | fix | "on" never falls through to the cloud model; warm-up uses the right num_ctx | 7 |
| `b4c8b55` | 2026-10-11 | perf | Local worker gets a slim prompt instead of the 17k-token workspace prompt | 7 |
| `af03211` | 2026-10-11 | feat | Phone to-do list: drag to reorder, tags and a tag filter | 7 |
| `18c8f85` | 2026-10-11 | fix | Live failure fixes: course codes exact, --date day words, agenda takes "tomorrow", production facts in the worker prompt | 7 |
| `966cd63` | 2026-10-12 | fix | Change requests and "ask" moves always reach the worker with job instructions | 7 |
| `fe24f80` | 2026-10-12 | feat | Work check: asking back on a clear change request triggers the retry | 7 |
| `0372a72` | 2026-10-12 | feat | localRoutingScheduleToCloud option: calendar changes may go to the cloud model; "promised but did not act" is a finding | 7 |
| `a44ce44` | 2026-10-12 | feat | Mac Tasks tab gets drag and tags; the phone never answers with the on-device model | 7 |
| `612f962` | 2026-10-12 | feat | THE GATE: "on" refused without a real-route acceptance pass (85 percent, 20 s, 14 days, 20 cases) | 7 |
| `f835b11` | 2026-10-12 | docs | HANDOFF: local routing back to shadow; API out of credit | 7 |
| `513276d` | 2026-10-12 | feat | account-health.ts: notice a dead model account, alert once, optional fail-fast | 8 |
| `05cab3d` | 2026-10-12 | docs | HANDOFF and README for account health | 8 |
| `15f0775` | 2026-10-12 | feat | ORION's manual moved into the brain (53 notes); look-it-up prompt; testing window option | 8 |
| `d049141` | 2026-10-12 | merge | Merge of origin/main into the checkpoint branch | 8 |
| `e1eebe9` | 2026-10-12 | docs | LOCAL_FAILURES.md: why the local models failed live and the fix for each | 8 |
| `444cdb5` | 2026-10-12 | docs | RESEARCH_IDEAS.md: eight ideas for local-model reliability (finds the sampling-settings gap) | 8 |
| `f0b2b67` | 2026-10-12 | feat | schedule-flow.ts: calendar changes as a fixed sequence (code reads the day, 9B fills a form, code runs the command) | 9 |
| `110bc80` | 2026-10-12 | fix | Flow guards and a correction round; real flow made unreachable from tests after the "B4" incident | 9 |
| `fe18873` | 2026-10-12 | docs | HANDOFF: settings root cause fixed, flow live, first local success | 9 |
| `cd91e9d` | 2026-10-12 | feat | Flow handles "plans" (go somewhere, travel, several things) | 9 |
| `70ebf12` | 2026-10-12 | fix | Commutes become invisible; no "Travel to" event | 9 |
| `3076cbb` | 2026-10-12 | fix | Reply after a calendar change is built by code from the scheduler's lines | 9 |
| `ea28355` | 2026-10-12 | feat | clear_after step; gateway 9B set to think:false and num_predict 2048 after an 11k-token runaway | 9 |
| `a847ba8` | 2026-10-12 | fix | Live gauntlet round 0: stem trigger, exact reply enforced at finalize and delivery, honest line for false claims | 9 |
| `46235d4` | 2026-10-12 | fix | By-shifts computed by code; skip on own blocks drops; day read by code for questions | 9 |
| `490535f` | 2026-10-12 | fix | "tmrw" reads tomorrow; a front-desk error keeps the flow on; can't/ask replies exact | 9 |
| `3389cd4` | 2026-10-12 | test | Live gauntlet script and result: 12/12 on the real calendar | 9 |
| `b5bf4ab` | 2026-10-13 | fix | "Remind me at 11" is alarm_set, never a to-do; after midnight tomorrow is today; orion-tasks refuses unknown options | 10 |
| `26f914d` | 2026-10-13 | fix | Code builds the exact alarm_set call; a reply without the call is retried then replaced; "I've set a" is a claim | 10 |
| `7f82b2c` | 2026-10-13 | feat | Redesigned to-do list shared by Mac and phone, after his Notion list | 10 |
| `6c93032` | 2026-10-13 | fix | orion-tasks sweep: a finished to-do's booked sessions come off its days | 10 |
| `e3fe000` | 2026-10-14 | fix | Both local models kept warm at their real num_ctx (keepWarm); gateway reasoning:false; testing window renewed 48 h | post |
| `b90e577` | 2026-10-14 | chore | Repo cleanup: fresh short HANDOFF.md; V3 handoff moved to docs/planning/v3/ORION_V3_SPEC.md; CONTINUE file and raw 10-01..10-08 eval folders archived | post |
