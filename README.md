# ORION

A local-first, privacy-preserving personal assistant for macOS. Orion runs its
reasoning locally, keeps its own memory and knowledge on disk, and asks before
doing anything consequential.

This is a monorepo: the Python runtime, the native macOS app, the OpenClaw
control plugin, the agent's operating context, and the knowledge vault all live
here together.

## Layout

| Path | What it is |
|---|---|
| `orion/` | Python runtime — planner, executor, scheduler, memory, permissions, tool registry, HTTP server |
| `native/` | The macOS app (SwiftUI), the Mac bridge, and the launchd agents |
| `openclaw-plugins/orion-control/` | OpenClaw plugin exposing Orion's action catalog and executors |
| `openclaw-workspace/` | Orion's operating context — `SELF`, `SOUL`, `MEMORY`, `USER`, `PLAYBOOK`, `AGENTS` |
| `var/brain/` | The knowledge vault (Obsidian, PARA-structured) — concepts, sources, operating principles |
| `scripts/` | Operational scripts — TTS daemon, identity checks, repair, cron delivery |
| `launchers/` | Double-clickable `.command` entry points for everyday use |
| `tests/` | Python test suite, plus `tests/workspace/` — artifacts from controlled live runs |
| `docs/planning/` | Design docs and phase plans, current and archived |
| `docs/` | Roadmap, game plan, integration handoff |
| `web/privacy/` | The public privacy page |
| `vault/`, `archive/` | Legacy notes and earlier prototypes |

## Key documents

- `AGENTS.md` — how agents working in this repo should behave
- `HANDOFF.md` — current state and what comes next
- `NICK-TODO.md` — decisions and actions waiting on a human
- `var/brain/Home.md` — map of the knowledge vault

## Running it

```bash
uv run python main.py serve        # start the persistent local runtime
uv run python main.py "..."        # send one message
```

The local database is created at `var/data/orion.db` and is not tracked.

## What is deliberately not in this repo

Build outputs (`.build/`, `.builds/`), dependencies (`node_modules/`, `.venv/`),
the vendored Ollama runtime, and all local state — `var/data/orion.db`, logs, and
the sandbox directories. Secrets live in `.env`, which is ignored; copy
`.env.example` to start.

## Status

Private and in active development. Branch `orion-v2/phase-0-inventory` is the
working line; `master` is the last stable point.
