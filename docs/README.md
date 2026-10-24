# Docs

ORION was built in numbered phases, with coding agents (Claude, Codex, and a
local Qwen loop) doing most of the implementation under written plans and review
gates. These docs are that engineering record.

| Where | What |
|---|---|
| `learn/` | **Study guide to the whole codebase**: start at `learn/00_START_HERE.md` (snapshot `6c93032`) |
| `vision/` | What ORION is for: `ORION_PURPOSE.md` (external executive function) and the original wishlist |
| `planning/v2/` | The 85-phase program: `PHASE_GATES.json` (gate state, read by `scripts/orion_v2_phase_gate.py`), capability registry, security invariants, and dated design/proof notes for each slice |
| `planning/offline-roadmap-results/` | Per-phase implementation packets that the agent plans are built from |
| `planning/benchmarks/` | Local-model benchmark harness and results (Qwen 3 30B, gpt-oss 20B) |
| `planning/v3/` | ORION V3 (local models): the spec `ORION_V3_SPEC.md` and the implementation plan |
| `evals/v3/` | Local-model results (`REPORT.md`), live failures and research ideas |
| `agentic/` | The local agentic dev loop: architecture, operating guide, plan standard, and every work plan with its task briefs |
| `handoffs/` | Hand-over documents between agents working on the runtime |
| `GAME_PLAN.md` | The July plan, kept for the reasoning behind later reversals (older planning is in `~/Desktop/ORION-archive/`) |

The live state of the project is always the newest entry in `../HANDOFF.md`.
