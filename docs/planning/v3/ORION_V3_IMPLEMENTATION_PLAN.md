# ORION V3 — implementation plan (local-first routing with try → check → escalate)

Written 2026-10-10 by Claude, from `docs/evals/v3/REPORT.md` §9 (results) and Nick's direction:
"9B tries, checks its work, and if it doesn't seem right then it gets escalated" — no category-based
"deep" tier. Nothing here goes live without Nick's explicit go-ahead (plugin deploy + gateway restart +
model registration are live changes).

## Target behaviour

1. **Front desk (qwen3.5:4b, every message)** — one JSON move: answer / tool / escalate / ask / ignore,
   plus a `say` line. `answer`, `ask`, `ignore` are finished by the front desk; `tool` and `escalate` go
   to the 9B. (Eval: 89% held-out, 0.5 s warm first token.)
2. **Worker (qwen3.5:9b)** does every tool and scheduling job, with the tuned instructions for that job
   (honesty/result-meaning block always; the scheduling coach guide + examples for calendar work;
   thinking on for scheduling, off otherwise).
3. **Check** after the worker's final answer, runtime signals only: claim vs tool outputs (false claim,
   unmentioned failure, wrong times), last change incomplete (NOT BOOKED / error), calendar after the
   change (overlaps, lost or duplicated blocks), unfinished turn.
4. **Retry once** with the check's findings as the instruction (`before_agent_finalize` → revise).
5. **Escalate** if the retry is still flagged: undo the change, say "let me take another look", hand the
   job to gpt-oss:20b (thinking high). If that is flagged too: undo and tell Nick plainly what could not
   be done (no Claude call unless Nick later wants a third level).

Replay on held-out scheduling: 28/36 (78%), 0 false claims, gpt-oss used on 4/36, p50 21 s, p90 86 s
(vs 9B alone 23/36; gpt-oss alone 27/36 with p90 198 s). Continuity: false claims 3 → 0.

## OpenClaw seams (v2026.7.1-2, `docs/plugins/hooks.md`)

| Behaviour | Hook | Return |
|---|---|---|
| Front desk decision | `before_model_resolve` (runs the 4B directly via Ollama) | `modelOverride` |
| Front-desk answer / ignore / ask | `before_agent_reply` | synthetic reply or silence |
| Per-job tuned instructions | `before_prompt_build` | `appendSystemContext` |
| Check + one retry | `before_agent_finalize` | `{ action: "revise", retry: { instruction, idempotencyKey, maxAttempts: 1 } }` (15 s budget) |
| Escalation turn on gpt-oss | queued plugin turn (`agent_turn_prepare`) + `modelOverride` on that turn | — must be proven in a spike |

Non-bundled plugins need the raw-hook permission in `plugins.entries` (live config).

## Build steps (each: tests first, review, commit; no deploy)

1. **Work check module** (`plugin/orion-control/src/work-check.ts`): port the validated claim checker
   (`scripts/lib/eval/v3/claims.mjs`, 65/65 real labels) and the mechanical calendar check
   (`scripts/eval/v3/ops/cascade.mjs`) to TypeScript, with the same test cases.
2. **Front-desk module** (`front-desk.ts`): prompt p6 + restate, JSON schema, temp 0, Ollama call with a
   2 s timeout; on timeout or bad JSON → fall through to the worker (never block a turn).
3. **Instructions per job** (`job-instructions.ts`): honesty block; scheduling coach guide + examples;
   brain examples; reschedule full usage text (also fixes TOOLS.md gaps from the report §9.5).
4. **Hook wiring** behind a plugin config flag `localRouting: off | shadow | on`.
   `shadow` logs what the router WOULD do on every real turn without changing anything — run it for a
   few days first; it is the safest real-traffic test.
5. **Escalation spike**: prove a queued follow-up turn can run on gpt-oss with the undo + handoff.
6. **Phase 8 re-run** through the real route with `localRouting: on` in eval mode (sandbox).
7. **Supervised live day** — Nick's go-ahead.

## Live changes Nick must approve (none made yet)

- Register `ollama/gpt-oss:20b` (and the 4B) in the gateway's Ollama provider.
- Grant the plugin raw conversation hooks.
- Deploy the plugin build and restart the gateway; set `localRouting: shadow`, later `on`.
