# Docs

ORION was built in numbered phases, with coding agents (Claude, Codex, and a
local Qwen loop) doing most of the implementation under written plans and review
gates. These docs are that engineering record.

| Where | What |
|---|---|
| `vision/` | What ORION is for: `ORION_PURPOSE.md` (external executive function) and the original wishlist |
| `planning/v2/` | The 85-phase program: `PHASE_GATES.json` (gate state, read by `scripts/orion_v2_phase_gate.py`), capability registry, security invariants, and dated design/proof notes for each slice |
| `planning/offline-roadmap-results/` | Per-phase implementation packets that the agent plans are built from |
| `planning/benchmarks/` | Local-model benchmark harness and results (Qwen 3 30B, gpt-oss 20B) |
| `planning/*.md` | Audits and risk sweeps: permission elevation, audio gate, baseline |
| `agentic/` | The local agentic dev loop: architecture, operating guide, plan standard, and every work plan with its task briefs |
| `handoffs/` | Hand-over documents between agents working on the runtime |
| `GAME_PLAN.md`, `CAPABILITY_ROADMAP.md`, `CONNECTIONS_BRAINSTORM.md` | Earlier planning, kept for the reasoning behind later reversals |

The live state of the project is always the newest entry in `../HANDOFF.md`.
