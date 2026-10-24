# 00 — Start Here: the ORION Learning Guide

> Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, written 2026-10-14.
> 644 commits, 2026-07-28 → 2026-10-13. ~79k lines Swift, ~27k TypeScript, ~29k Node, ~48k Python.

This folder teaches you ORION: what every part does, why it was built that way, what was
tried and abandoned, and where the code is, line by line. It is written so **any AI that can
read text** (Claude, ChatGPT, a local model) can act as your tutor, with or without access to the
repo.

---

## 1. The files, and the order to read them

| # | File | What you learn | Rough size |
|---|------|----------------|-----------|
| 00 | `00_START_HERE.md` | How to use this guide; tutor prompts; study plan | this file |
| 01 | `01_big_picture.md` | What ORION is, the stacks, how a message moves, the vocabulary | short |
| 02a–d | `02a_history_jul28_aug31.md` … `02d_history_oct02_now.md` | Every commit, era by era: steps forward, steps back, why | long |
| 03 | `03_brain_prompts_memory.md` | OpenClaw, every system prompt and skill, model routing, every memory store | long |
| 04 | `04_plugin_core_actions_gate.md` | The TypeScript plugin: hooks, every action/tool, permissions, approvals, the ledger | long |
| 05 | `05_plugin_turn_pipeline.md` | One chat turn: front desk, local routing, schedule-flow, truth checks, account health | long |
| 06 | `06_scripts_life_loop.md` | The Node life loop: scheduler, reach, attention, focus, connectors, every CLI | long |
| 07 | `07_mac_app_swift.md` | The Mac app: reducer, voice pipeline, gateway client, integrations, signing | long |
| 08 | `08_phone_bridge_python_backend.md` | iPhone, widgets, CloudKit, EventKit bridge, launchd, the Python and v1 backend | long |
| 09 | `09_evals_tests_dev_process.md` | Evals, tests, the Qwen dev loop, phases/gates, handoffs, signing, deploy | long |
| 10 | `10_end_to_end_walkthroughs.md` | Debugger-style traces of real requests through every layer, with exercises | long |
| 11 | `11_reference_index.md` | Master tables: every API call, prompt, memory op, tool, config flag, glossary | reference |
| 12 | `12_decisions_and_lessons.md` | Every major decision and reversal, and the lessons the project keeps re-learning | medium |

`_fragments/` holds the raw per-chapter indexes that were merged into `11`. You can ignore it.

**Suggested path**

1. **Day 1, orientation:** 01, then skim 12. You will know the shape and the scars.
2. **Day 2, the story:** 02a → 02d. Read for the narrative. Don't memorise hashes.
3. **Days 3–5, the core loop:** 03 → 05 → 06. This is the brain, the turn, and the tools it calls.
4. **Days 6–7, the surfaces:** 07, 08.
5. **Day 8, how it's built:** 09.
6. **Then, hands on:** 10, one trace per sitting, with the repo open. Use 11 as the lookup table.

---

## 2. How to use this with an AI tutor

### A. Tutor that can see the repo (Claude Code, Codex, Cursor, …)

Paste this as your first message:

```text
You are my tutor for ORION, a codebase I own at ~/Desktop/ORION. A study guide lives in
docs/learn/. We're studying chapter <NN> today.

Rules:
- Read docs/learn/00_START_HERE.md and docs/learn/<NN>_*.md first.
- When the guide cites path:line, OPEN THE FILE and show me the real code. The guide is a
  snapshot from commit 6c93032 (2026-10-14), so if the code has moved, say so and show me
  the current version.
- Walk me through one section at a time. After each section, ask me 1–2 questions to check
  I understood before moving on. Don't dump the whole chapter.
- When I ask "why", answer from the commit history (git show <hash>) and the HANDOFF.md,
  not from guesses. Label anything you infer as inferred.
- Read-only. Don't edit, commit, deploy, restart anything, or call paid APIs while tutoring.
- Never print secrets from ~/.openclaw or the Keychain.
```

### B. Tutor that can't see the repo (ChatGPT web, phone, voice mode)

Upload or paste `01_big_picture.md` plus the chapter you want. Then:

```text
You are my tutor for ORION, my personal-assistant codebase. I've attached chapters of a
study guide written from the real code and git history. Treat the guide as ground truth.
If I ask something the guide doesn't cover, say "the guide doesn't say", and tell me what
file I should open to find out (the guide's path:line citations tell you where).
Teach one section at a time, use the code excerpts in the guide, and quiz me after each
section. When the guide marks something "(inferred)", tell me it's inferred.
```

### C. Good study prompts (any tutor)

- "Trace T1 from chapter 10 with me hop by hop. At each hop, make me predict the next file
  before you show it."
- "Explain this commit like a code review: `git show <hash>`. What problem, what fix, what risk?"
- "Quiz me: give me 10 questions on chapter 05, mixing 'what does X do' and 'why was it
  built this way'."
- "What would break if I deleted <file>? Answer using the call graph in the guide."
- "Compare how a turn worked on 2026-09-01 versus today, using chapters 02 and 05."
- "Pick a 'Gotchas & lessons' item and show me the commit where we learned it."
- "I want to change <behaviour>. Using chapters 04–06, which files and tests would I touch,
  and which gate or approval would it hit?"

---

## 3. Conventions used throughout

| You'll see | Meaning |
|---|---|
| `plugin/orion-control/src/index.ts:120` | File relative to the repo root, line 120 (as of `6c93032`) |
| `:120-160` | A line range |
| `a1b2c3d (2026-09-27)` | A commit. Run `git show a1b2c3d` to see it |
| **(inferred)** | The writer worked it out rather than reading it directly. Verify before relying on it |
| **uncommitted** | Exists in the working tree but not in any commit yet |
| `~/.openclaw/...` | Live runtime state on the Mac, outside the repo |
| "the gateway" | The OpenClaw gateway process the brain runs in |
| "the plugin" | `plugin/orion-control`, the TypeScript OpenClaw plugin |
| "the app" | The Swift Mac app, `native/Orion` |
| "the phone" | `native/OrionMobile` plus widgets |

**Biggest change since the snapshot (read this before chapters 01, 05 and 02d).** On 2026-10-16,
`278d75e` made local routing **"local always"**: the acceptance gate and the 48-hour testing window
were removed (Nick: he never wants the cloud model "unless necessary"), and the acceptance score is
now just logged as a report. Wherever the guide describes local routing as "in shadow mode behind an
acceptance gate", that was true at `6c93032` and is no longer the live design. The status of each open
finding at `7c8f6b1` is recorded in chapter 12 §5.

### Files that moved after the snapshot

The guide was written against `6c93032`. Two commits landed while it was being written:
`e3fe000` (local models kept warm, 2026-10-14) and `b90e577` (repo cleanup, 2026-10-14).
The cleanup moved or archived several files the chapters cite. If a cited path doesn't exist,
look here first:

| Cited as | Now | How to read the cited version |
|---|---|---|
| `ORION_V3_HANDOFF.md` | `docs/planning/v3/ORION_V3_SPEC.md` (same content, renamed) | open the new path |
| `ORION_V3_CONTINUE.md` | archived to `~/Desktop/ORION-archive/2026-10-14/` | `git show 6c93032:ORION_V3_CONTINUE.md` |
| `HANDOFF.md` (the 3,179-line history) | replaced by a short fresh `HANDOFF.md`; old one archived | `git show 6c93032:HANDOFF.md` |
| `docs/evals/2026-10-01-schedule/`, `2026-10-02-schedule/`, `2026-10-02-scheduling-memory/`, `2026-10-07-prompt-diet/`, `2026-10-08-thinking/` (raw runs) | archived; results summarised in `docs/evals/v3/REPORT.md` | `git show 6c93032:docs/evals/<folder>/<file>` |
| `docs/CAPABILITY_ROADMAP.md`, `CONNECTIONS_BRAINSTORM.md`, `INTEGRATION_HANDOFF.md`, `docs/planning/{RISK_SWEEP,GATE-0-BASELINE,GATE-1-AUDIO,ORION_AUDIT_2026-08-08,ORION_PERMISSION_ELEVATION}.md`, `backlog-2026-10-06.md` | archived | `git show 6c93032:<path>` |

Line numbers in code files are as of `6c93032`. To see a cited line exactly as the writer saw it:
`git show 6c93032:<path> | sed -n '<start>,<end>p'`.

Every component section uses the same skeleton, so you always know where to look:
**What it is → Where → How it works → Contracts → Calls out to → History → Gotchas & lessons →
Walk it yourself → Questions to ask your tutor.**

Secrets never appear in this guide. Keys and tokens are referred to by their Keychain item
or environment-variable name only.

---

## 4. Things that will confuse you unless you know them up front

1. **There are three stacks, and only two are live.** The Swift app and the TypeScript plugin
   (plus the Node scripts it calls) are ORION. The Python package `orion/` was the original
   ChatGPT-era runtime. It is **not** the implementation path. Its v2 policy/registry code
   survives as CI checks that keep the live gate honest. (Chapters 01, 08.)
2. **85 numbered phases are the roadmap vocabulary.** The "Batch A–H" scheme from 2026-09-01
   was withdrawn the same day. (Chapters 02b, 09.)
3. **The code-signing identity must never change.** It's how macOS keeps the app's
   permissions. (Chapters 07, 09.)
4. **Two assistants built this, Claude and Codex, relaying through `HANDOFF.md`.** Many
   commits and docs are written to the *other* assistant. (Chapter 09.)
5. **October is the local-first pivot.** API cost pushed ORION toward local Qwen models
   via Ollama. A live switch failed on 2026-10-12, and local routing is back in **shadow** mode
   behind an acceptance gate. (Chapters 02d, 05.)
6. **The working tree is always dirty.** That's normal here. Uncommitted work is called out
   where it matters.

---

## 5. How this guide was made (so you can regenerate it)

On 2026-10-14, twelve AI agents each read one slice of the system end to end: four history
eras (every commit message, and the diffs of the important ones), the brain/prompts/memory,
the plugin core, the turn pipeline, the scripts, the Mac app, the phone/Python side, the
evals/process, and the end-to-end traces. All of them worked from one shared style guide
(`_fragments/STYLE.md`) and were read-only on the repo. An editor then merged their indexes into
chapter 11 and wrote chapters 00, 01 and 12.

To refresh it later, give an agent `_fragments/STYLE.md`, the chapter file and this
instruction: *"Update this chapter from `6c93032` to HEAD. Keep the structure. Add a History
entry for each relevant new commit."*
