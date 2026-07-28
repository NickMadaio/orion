# Orion on OpenClaw — migration plan

**Decision, July 28, 2026:** adopt OpenClaw as the runtime. Keep the Orion name
and the parts that are specific to Nick. Stop rebuilding the parts OpenClaw
already ships.

Supersedes the "keep building" recommendation in `ADOPT_VS_BUILD_DECISION.md`.
That document was written from the security literature before reading
OpenClaw's actual macOS documentation. The capability overlap turned out to be
near total, and the cost model turned out to be better than what Orion had.

---

## What OpenClaw already does that Orion was going to build

| Orion roadmap item | OpenClaw status |
|---|---|
| Native menu bar companion app | Ships one |
| TCC-owning permission prompts (screen, mic, automation, accessibility) | Ships them |
| Always-on background service via launchd | Ships it |
| Exec approval prompts before running commands | Ships them (`tools/exec-approvals`) |
| Calendar, Reminders, Notes, Mail | Five official Apple skills, zero config, no API keys |
| Shortcuts bridge (Phase 9) | Official Shortcuts skill — exposes every shortcut you own |
| Voice, push-to-talk, wake word (Phase 10) | Voice wake + voice overlay, shipped |
| Web access | Built in |
| MCP client (Phase 8) | The skill system *is* MCP |
| Messaging channels (Phase 11) | 15 adapters |
| Tiered model routing for cost | Per-agent and per-task routing, built in |

Remaining genuinely-Orion work after adoption: roughly a weekend, not a year.

---

## Cost model — the reason this started

`--auth-choice ollama` auto-discovers local models and sets **all costs to $0**.
Ollama serves over HTTP and runs fully offline once weights are on disk.

Recommended tiering on a 48GB M5 Pro:

| Tier | Model | Use | Cost |
|---|---|---|---|
| Local | `qwen3.6:27b` (Q6_K) or `gpt-oss:20b` (Q8_0) | Default. Chat, tool calls, routine actions | $0 |
| Fast cloud | Haiku 4.5 | When local is clearly struggling | ~$0.0035 / exchange |
| Deep cloud | Sonnet 5 | Code, research, hard reasoning | ~$0.02 / exchange |

Keep gpt-oss:20b at Q8_0 specifically for agent loops — cleaner JSON tool calls
than a larger model at Q4. Use the 27B for conversation quality. Temperature
0–0.2 for agent tasks; higher values produce hallucinated tool calls.

Realistic bill at your usage: **$0–8/month**, most months near zero.

---

## Setup steps

Run these on the Mac. They cannot be run from a sandboxed session.

1. **Install the macOS app.** Grab `OpenClaw-<version>.dmg` from
   [GitHub releases](https://github.com/openclaw/openclaw/releases). Launch it,
   choose **This Mac** for a local Gateway, let it install the CLI and runtime,
   then walk the macOS permission checklist.

2. **Point it at Ollama first**, before configuring any paid provider, so the
   default path is free:
   ```bash
   openclaw models set ollama/qwen3.6:27b
   ```
   Confirm tool calling works — OpenClaw needs the gateway pointed at Ollama's
   native `/api/chat` endpoint.

3. **Add cloud tiers second**, with a fresh Anthropic key (rotate the old one —
   it has been sitting in plaintext in `~/Desktop/ORION/.env`). Configure Haiku
   as the escalation tier and Sonnet as the deep tier.

4. **Install the five official Apple skills** — Mail, Calendar, Reminders,
   Notes, Shortcuts. These replace `native/OrionMacBridge` and
   `native/OrionCompanion` entirely.

5. **Test the Jarvis sentence:** *"open Spotify, set a 25 minute timer, and
   remind me at 4 to email my advisor."*

### The one discipline rule

Do not install skills from ClawHub that you have not vetted. A real malicious
skill (`yahoofinance`) shipped there — it worked by telling the agent a
prerequisite binary was needed and getting the user to run a curl one-liner. No
exploit required, and static scanning missed it by design. Stick to official
skills and well-known authors. That is a five-second habit, not an architecture
decision.

Also reasonable while you get comfortable: don't bind messaging channel
adapters yet, and keep email at read-only scopes.

---

## What to harvest from Orion

**Keep and port:**

- `vault/` and the memory model — becomes OpenClaw memory / skill files.
- `orion/profile.py` — home timezone, location, personal defaults.
- The **thinking** in `planning/` — the permission taxonomy, the tiering table,
  and the audit are still the right ideas. They now describe how to *configure*
  OpenClaw rather than what to build.
- Any workflow specific to you (school, Whoop, personal file conventions) —
  these become custom skills, which are just a folder with a `SKILL.md`:
  YAML frontmatter plus step-by-step instructions in plain English.

**Retire:**

- `orion/runtime.py`, `server.py`, `planner.py`, `executor.py`, `cloud.py`,
  `provider.py`, `registry.py`, `web.py`, `tools.py` — superseded.
- `native/OrionCompanion`, `native/OrionMacBridge` — superseded by the OpenClaw
  macOS app and the Apple skills.
- `orion/ui/` — superseded by WebChat.

Do not delete any of it. It is committed in git; leave the repo as a reference
and as evidence of what you learned. The native bridge work in particular taught
you why TCC identity has to belong to the foreground app, which is exactly the
kind of thing that makes the OpenClaw permission docs read as obvious instead of
mysterious.

**Build custom, after the basics work:**

- An Orion MCP server for anything genuinely yours that no skill covers.
  Official SDK: `@modelcontextprotocol/sdk` (TypeScript) or the `mcp` Python
  package. Define tools with schemas, implement async handlers, connect over
  stdio, register in `openclaw.json`.
- Whoop integration — check ClawHub first; build a small MCP server if nothing
  exists.

---

## Honest accounting

Roughly six weeks of work is superseded. What is not wasted: you now understand
agent architecture, permission models, macOS TCC, and structured planning well
enough to evaluate a framework instead of just installing it — which is the
reason this decision took twenty minutes instead of six months of drifting.

The goal was never to write an agent runtime. It was to have Jarvis. That is
now a weekend away instead of a year.
