# Learning ORION

A complete study guide to this codebase lives in this folder.
It covers the architecture, every commit and why it happened, every prompt, memory store, tool and API call,
and debugger-style walkthroughs of real requests through the code.

**Start here: [`docs/learn/00_START_HERE.md`](00_START_HERE.md).** It has the reading order and
ready-to-paste prompts that turn any AI (Claude, ChatGPT/Codex, a local model) into a tutor for the guide.

| File | What |
|---|---|
| `00_START_HERE.md` | How to use the guide, tutor prompts, study plan, files that moved |
| `01_big_picture.md` | The whole system on one page |
| `02a`–`02d` | History, Jul 28 → Oct 14, every commit |
| `03`–`09` | Brain/prompts/memory · plugin core · turn pipeline · scripts · Mac app · phone/Python · evals and process |
| `10_end_to_end_walkthroughs.md` | Seven traced requests, hop by hop, with exercises |
| `11_reference_index.md` | Lookup tables: API calls, prompts, memory, tools, config, glossary |
| `12_decisions_and_lessons.md` | Decisions, reversals, recurring lessons, open findings |

**Biggest change since the snapshot (read this before chapters 01, 05 and 02d).** On 2026-10-16,
`278d75e` made local routing **"local always"**: the acceptance gate and the 48-hour testing window
were removed (Nick: he never wants the cloud model "unless necessary"), and the acceptance score is
now just logged as a report. Wherever the guide describes local routing as "in shadow mode behind an
acceptance gate", that was true at `6c93032` and is no longer the live design. The status of each open
finding at `7c8f6b1` is recorded in chapter 12 §5.

**Snapshot note.** The guide was written against commit `6c93032` (2026-10-14), and its `path:line`
citations are pinned to that commit. To see a cited line exactly as written:
`git show 6c93032:<path> | sed -n '<start>,<end>p'`. Later work is in `HANDOFF.md` and `git log 6c93032..HEAD`.
