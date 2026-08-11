# Orion — current state & handoff (2026-07-30)

The single source of truth for where Orion is. Supersedes the earlier
implementation/migration/roadmap docs (removed 2026-07-30; recoverable from git
history). Historical references kept alongside this file: `ORION_STATE_AUDIT.md`
(the deep source audit), `ADOPT_VS_BUILD_DECISION.md` (why OpenClaw), and
`ORION_COGNITIVE_ARCHITECTURE.md` (design thinking).

## Architecture (unchanged, correct)

- **Runtime/brain/channels:** OpenClaw `2026.7.1-2`, running as LaunchAgent
  `ai.openclaw.gateway`, loopback-only `127.0.0.1:18789`.
- **Orion's distinctive piece:** the `orion-control` plugin — a permission-gated
  Mac "body." Every action flows proposal → validate → guarded execute →
  independent verify → append-only JSONL audit ledger. Source:
  `~/Desktop/ORION/openclaw-plugins/orion-control`; installed (separate copy):
  `~/.openclaw/extensions/orion-control`. A rebuild must be copied to the
  installed path, then the gateway reloaded (`openclaw daemon restart`).

## Model routing — tiered (changed 2026-07-30)

Configured in `~/.openclaw/openclaw.json` (`agents.defaults.model`):

- **primary:** `anthropic/claude-haiku-4-5-20251001` — fast (~1.3s/turn), streams.
- **fallbacks:** `[ollama/qwen3.6:27b, ollama/llama3.2:3b]` — used when the API
  is unreachable. **Offline → automatic fallback to local**, self-healing per turn.
- **utilityModel:** `ollama/llama3.2:3b` (titles/internal only).

Why qwen (27B, slow) is the first offline fallback, not the 3B: the 3B is too weak
to drive tools or reliably decline — it emits malformed tool JSON. qwen follows
instructions and drives `orion_task_run` correctly, just slowly. Offline is the
exception, so correctness > speed there. Flip the order if fast offline *chat*
matters more than offline *actions*.

The Anthropic key lives in `~/Desktop/ORION/.env` (`ANTHROPIC_API_KEY=`) and is
mirrored into `models.providers.anthropic.apiKey`. The earlier key was dead (401);
a fresh one was added 2026-07-30 and verified (HTTP 200 + live Haiku turn).

## Tools & how to use

Orion's only Mac-action tool is **`orion_task_run`** (+ `orion_task_status`,
`orion_permission_status`, `orion_permission_change`). Usage: open the OpenClaw
app, **hold Right Option to talk**, speak, release. For actions, name the target
explicitly ("create the folder X on my Desktop") — that explicit instruction is
the authorization.

Two fixes on 2026-07-30 made tools actually usable:
1. **Drivability** (plugin `src/index.ts`): `risk`/`verify`/`reversible` are now
   optional and **derived from the action catalog server-side**, so the model
   only supplies action + arguments + authorization. Killed the
   `verification_mismatch` retries. Plugin rebuilt + redeployed.
2. **Capability awareness** (`~/.openclaw/workspace/AGENTS.md` + `TOOLS.md`):
   these were stock OpenClaw boilerplate that never told Orion its real toolset,
   so it invented tools (`exec`, `siri`, `openClaude`) and error-flooded. They now
   state the real toolset and forbid inventing tools. Error flood gone (14+ → 0).

## Permission / friction model (Nick's rule)

"If I specifically say to ('do this', 'download this'), that is permission;
otherwise confirm irreversible." This maps onto the gate's
`directUserAuthorizationRequired`: an explicit instruction naming the exact
operation + target authorizes it; irreversible actions not explicitly named are
stopped. Current profile: `approved_root_edit` (file/folder create/read/list in
Desktop + workspaces). No shell/force-quit/install/settings/credential tools exist yet.

## Remaining work (priority order)

1. **Trust-tag hardening (do before any dangerous capability).** The
   `trusted_user` tag is currently supplied by the model inside the TaskGraph, so
   the anti-injection boundary is model-enforced, not structural. The harness
   should stamp the real user turn as the only trusted source.
2. **Capabilities through the gate:** force-quit → system settings → shell
   (allowlisted) → app install → credentials (via the installed 1Password skill,
   not raw Keychain). Full file-by-file plan exists from this session's design pass.
3. **File-write UX:** create/append/replace require the model to compute SHA-256
   hashes — smooth this (derive/relax) like the risk/verify fix.
4. **User-side (can't be done for you):** grant OpenClaw Input Monitoring +
   Accessibility + Microphone (System Settings → Privacy) — likely the cause of
   flaky push-to-talk; investigate the `orion-mac-bridge` crash (2026-07-28).
5. **Housekeeping:** delete stale `~/Desktop/ORION/.env.save` (old key); set
   `plugins.allow: ["orion-control"]` (silences a warn — confirm the ollama
   provider plugin needn't be listed first); the `main` session collides when two
   clients talk at once (avoid concurrent turns on `main`).

## Verified this session

- Haiku live: `served_by=anthropic/claude-haiku-4-5-20251001`, ~1268ms.
- Gated action end-to-end: folder created, scoped, independently verified, ledgered.
- Offline (forced local qwen): declined an impossible request cleanly, 0 tool errors.
- Gateway healthy: single loopback listener, connectivity probe ok, config valid.
