# ORION brain learning — shared brief

## Goal
ORION's brain is a Basic Memory vault (plain Markdown that Obsidian graphs) at
~/Documents/orionBrain. On 5 October 2026 it was seeded from what ORION already knew
(93 notes). Nick wants it to (1) grow from his real material — his Atlas lecture notes —
and (2) LEARN about him on its own every night from his conversations with ORION. This
batch builds those pieces as small, pure, tested Node modules plus thin CLIs. Claude/Codex
installs the nightly schedule afterwards.

## The note format (Basic Memory) — every note this batch writes looks like this
```
---
title: <Title>
type: <type>
permalink: <folder-slug>/<title-slug>
tags: [<tag>, <tag>]
source: <atlas|learned>
---

# <Title>

<optional body>

## Observations
- [category] a fact
## Relations
- relation_name [[Other Note Title]]
```
- Slug: lowercase, every run of non `a-z0-9` characters becomes one `-`, trimmed.
- Observations are `- [category] text`; relations are `- relation [[Title]]`.
- A note whose frontmatter has `seeded: true` belongs to the seeder; a note with
  `source: atlas` belongs to the Atlas importer; never overwrite a note that has neither
  (Nick or ORION wrote it).

## Existing tools you call (do not edit them)
- `scripts/orion-brain learn "<note>" "<category>" "<fact>"` appends a dated line to the
  note's `## Learned` section, or creates the note (folder `20 Areas/Learned`, linked to
  [[Nick]]). Exit 0 on success. Tests replace it with a fake via `ORION_BRAIN_BIN`.
- Daily memory files: `~/.openclaw/workspace/memory/YYYY-MM-DD.md`; each fact Nick or ORION
  said is a line starting `- ` (example: `- 02:22 PM — [auto] First, naps should be at least
  an hour and 15 minutes long ALWAYS.`).
- Node `~/.openclaw/tools/node-v24.15.0/bin/node`; tests `node --test`, `node:assert/strict`.

## Conventions
- Library code is pure: no clock, no filesystem, no network; arguments in, new objects out,
  never mutate. CLIs do the I/O. TypeError on bad arguments.
- Tests write only inside `mkdtemp(join(tmpdir(), "orion-brain-"))`, removed in `t.after`.
  Never touch the real vault, the real memory files or a real model in tests.
- No new npm dependencies. No console.log in library modules.

## Working in this loop
- Write first: `### FILE` the module with its exported functions and the test file in the
  first exchange; then `### EDIT`. Never more than two exchanges without writing.
- READ at most 3–4 files per exchange. Keep code compact. No triple backticks in files.
