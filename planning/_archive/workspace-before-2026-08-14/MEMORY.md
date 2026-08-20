# MEMORY.md — long-term

Curated. Decisions, lessons, and durable context — the distilled essence, not
raw logs. Daily files under `memory/` are the raw notes; this is what survives
them.

Rules for this file, so it stays worth reading:

- **Distilled, not logged.** "Ran clock_now ×3" belongs in a daily file and
  nowhere else. A decision, a reason, or a lesson belongs here.
- **Dated entries.** Every line carries the date it became true.
- **Supersede, don't silently rewrite.** When something stops being true, mark
  the old entry superseded and add the new one. Being able to see that the
  picture changed is worth more than a tidy file.
- **Facts about Nick go in `USER.md`,** not here. This file is about the work,
  the system, and what Orion has learned.
- **Nothing sensitive.** No credentials, no financial detail, no health data.

---

## What this project is

- 2026-07-28 — Orion is Nick's local-first voice assistant on his Mac, built on
  OpenClaw as the execution runtime plus a custom plugin, `orion-control`, that
  is the actual distinctive work: propose → guarded execute → independent
  verify → append-only JSONL ledger.
- 2026-07-29 — The older Python `orion/` package in the repo is abandoned. The
  live path is OpenClaw. Do not add features there.

## Architecture decisions

- 2026-07-29 — **Tiered brain.** Cloud Haiku 4.5 is primary; local Ollama models
  are fallbacks, so Orion degrades to offline instead of failing. The perceived
  slowness in July was the 27B local model at ~14 tok/s, *not* the permission
  gate. Never remove the gate to make Orion feel faster — that trade was already
  examined and rejected.
- 2026-08-08 — **Memory embeddings are local.** `memorySearch` runs on Ollama
  with `nomic-embed-text`. It previously defaulted to OpenAI, whose account has
  no credits, so indexing and recall both failed silently for weeks. Keeping
  embeddings local also keeps them free, which is the standing cost constraint.
- 2026-08-12 — **The Obsidian vault is part of memory now.** Nick's
  `~/Documents/orionBrain` is in `memorySearch.extraPaths`, so all 39 notes are
  in the same local-embedding index as MEMORY.md and the daily files, and
  `orion-recall` returns them with their note path. It had been sitting there
  unreferenced since July — the vault existed, Orion did not know about it, and
  nothing in the config mentioned it. Embeddings stay on Ollama; the bundled
  `obsidian` skill was NOT the route, because it drives an `obsidian` CLI that is
  not installed. Vault notes are reference knowledge and are read-only to Orion.
- 2026-08-12 — **Self-modification is ON, and has been since 2026-08-08.**
  `enableSelfModificationActions` is true, the `consequential_local` profile
  includes the `self_modification` tier, and `orion-authority check self_modify`
  returns NOTIFY — do it, then say so. `scripts/orion-forge` builds the edit and
  rolls back on compile failure. It is still the highest-risk capability in the
  project, so it announces itself; it does not refuse itself.
- 2026-08-08 — **The daily summariser owns one block, not the file.**
  `scripts/orion-daily` writes between `orion-daily:begin/end` markers and copies
  everything else through untouched, so anything Orion journals during the day
  survives it.

## Lessons

- 2026-07-31 — **Do not trust prose about your own abilities.** Orion told Nick
  he had no shell and no app control on days when he had both, because a
  hand-written list in `AGENTS.md` said so and he believed it without checking.
  `TOOLS.md` is generated from the live catalog; it is the answer. Check before
  saying you cannot do something.
- 2026-08-08 — **A summary that only counts tool calls is not a memory.** The
  daily files recorded which macOS actions fired and nothing Nick ever said, so
  there was nothing meaningful to recall later. Episodic memory has to capture
  what was said and decided, not what executed.
- 2026-08-12 — **A generated file is only as honest as its generator.** For four
  days `TOOLS.md` filed `self_modification`, `self_tuning` and `health_tracking`
  under "Switched off right now" while all three were live, because
  `orion-selfdoc` carried a hand-copied duplicate of the plugin's tier tables
  that predated those tiers. The 2026-07-31 lesson said "trust the generated
  list, not the prose" — but a generator with a stale table in it IS prose, and
  it lies with more authority. The tables are gone: both `orion-selfdoc` and
  `orion-authority` now derive from `scripts/lib/orion-plugin.mjs`, which reads
  the installed plugin, and an unrecognised tier is announced rather than
  silently filed as off. When a capability list says no, verify with
  `orion-authority check <name>` before repeating it.
- 2026-08-08 — **Dates must be local dates.** `toISOString()` is UTC and rolls
  over mid-evening in New York, which filed memory under tomorrow. Anything that
  names a day should use the host timezone so it follows Nick to London.

## Open threads

- **CLOSED 2026-08-12 — self-modification. It works; it always did.** The
  correction leads this entry on purpose: recall truncates long excerpts, and the
  stale claim below was being read back without it. `self_modify` is enabled,
  permitted, and has applied real edits — see Architecture decisions above. The
  original entry, kept per the supersede rule and **no longer true**:
  ~~2026-08-08 — Self-modification is built (there is a `self_modification`
  capability tier and the config enables it) but the permission profile still
  refuses it: a real attempt today returned `capability_disabled`. It is the
  highest-risk capability in the project and stays off until deliberately
  opened.~~ That attempt was at ~11:45 on 2026-08-08, minutes before the profile
  wiring landed; by 11:52 the same morning it was applying edits, and
  `forge-ledger.jsonl` records four successful applies that day with
  build-failure rollback working.
- 2026-08-08 — No chat channel is configured, so Discord is outbound-only
  through a webhook script. Remote status and remote commands are not possible
  until a real channel exists.
- 2026-08-08 — Nothing is scheduled. There is no cron job and `HEARTBEAT.md` is
  intentionally empty, so every proactive and memory-maintenance behaviour
  described in `AGENTS.md` has never actually run.
