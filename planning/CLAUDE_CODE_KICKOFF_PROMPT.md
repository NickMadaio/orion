# Paste this into Claude Code

Open Claude Code in `~/Desktop` and paste the block below.

---

I'm Nick. Read these three files first for full context — they explain a
decision I already made, so don't relitigate it:

- ~/Desktop/ORION/planning/OPENCLAW_MIGRATION_PLAN.md  (the plan — follow this)
- ~/Desktop/ORION/planning/ORION_STATE_AUDIT.md        (what I built and why I'm moving off it)
- ~/Desktop/ORION/planning/ADOPT_VS_BUILD_DECISION.md  (background; note it was superseded by the migration plan)

Short version: I spent ~6 weeks building a local-first Mac assistant called
Orion in ~/Desktop/ORION. I've decided to stop building my own runtime and
adopt OpenClaw instead, because it already ships everything I was going to
build. My hard constraint is cost — I'm a college student, target is $0-10/mo,
so the local Ollama path must be the default and cloud models are for hard
questions only. My Mac is an M5 Pro MacBook with 48GB unified memory.

Do these in order, checking with me between major steps:

1. Housekeeping in ~/Desktop/ORION: there's a stuck git lock from a sandboxed
   session. Run `rm -f .git/index.lock && find .git/objects -name 'tmp_obj_*'
   -delete`, then commit the staged work. Confirm .env is NOT tracked.

2. Set yourself up using ~/Desktop/everything-claude-code-main — it's a
   collection of Claude Code agents, skills, hooks, commands, and MCP configs.
   Read its README, then tell me which pieces are worth installing for my use
   case before installing anything. I don't want all of it blindly.

3. Install OpenClaw following the migration plan:
   - macOS app from https://github.com/openclaw/openclaw/releases (the .dmg)
   - Choose "This Mac" for a local Gateway
   - Point it at Ollama FIRST so the free path is the default:
     `openclaw models set ollama/qwen3.6:27b`
     (pull the model if needed; also keep gpt-oss:20b at Q8_0 — it produces
     cleaner tool-call JSON for agent loops)
   - Verify tool calling actually works against Ollama's /api/chat before moving on
   - Only then add cloud tiers: Haiku 4.5 for escalation, Sonnet 5 for deep work
   - Install the five official Apple skills: Mail, Calendar, Reminders, Notes, Shortcuts

4. Remind me to rotate my Anthropic API key — the old one has been sitting in
   plaintext at ~/Desktop/ORION/.env. Don't print the key.

5. Test with: "open Spotify, set a 25 minute timer, and remind me at 4 to email
   my advisor."

Rules:
- Don't install ClawHub skills I haven't vetted — official skills and known
  authors only. A malicious skill shipped there before.
- Don't rebuild any part of Orion. If something seems missing, check for an
  existing skill or MCP server first.
- Don't bind messaging channel adapters yet.
- Explain things simply. I'm learning this, not just shipping it.

Start with step 1 and show me what you find.
