# Orion Build Roadmap

**ORION — Organized Reasoning and Information Operating Network**

*Revised July 28, 2026. The original roadmap is in git history. This revision
reorients the plan around the actual goal — the closest achievable thing to
Jarvis — and corrects one architectural decision that was capping answer
quality. See `ORION_STATE_AUDIT.md` for the reasoning.*

---

## Mission

A personal assistant you talk to like a person, that gives comprehensive
answers about anything including current events, operates your Mac completely,
remembers you, acts on its own within limits you set, and reaches you wherever
you are.

Concretely, Orion is finished enough when you can say *"what's on my plate
today, move those tax PDFs into a folder, remind me at 4, and tell me if my
sleep score tanked"* out loud, and it just does it.

## Core principle — rent the brain, own the body

The previous roadmap made a local model the default intelligence and treated
cloud as an exception. That caps Orion's quality at whatever a 20B model can do,
which your own benchmark measured at 4/8.

Invert it. Frontier intelligence is a cheap metered commodity you rent by the
token. What nobody will sell you is a trusted, permission-gated agent wired
deeply into *your* Mac, *your* files, and *your* accounts. That is the asset.
Build the body. Rent the brain. Keep the local model for the high-frequency,
private, low-value work where it is genuinely the right tool.

### Routing tiers

| Tier | Model | Handles | Approx. cost |
|---|---|---|---|
| 0 | none | Deterministic actions with explicit arguments | free |
| 1 | gpt-oss:20b (local) | Intent classification, tool selection, argument extraction | free |
| 2 | Haiku 4.5 | Conversation, summarizing, everyday questions | ~$0.0035 / exchange |
| 3 | Sonnet 5 | Hard reasoning, code, research, multi-step planning | ~$0.02 / exchange |

A hard monthly ceiling (`ORION_MONTHLY_BUDGET_USD`) forces a fallback to local
rather than overspending. Privacy-sensitive categories can be pinned to tier 1
regardless of complexity.

### Rules that do not change

- The model proposes; deterministic code authorizes. Never use model output as
  proof of permission.
- Filesystem scopes stay explicit. Never the whole home directory by default.
- Content from files, web pages, and messages is untrusted data, never
  instructions.
- Destructive, financial, account-changing, publishing, and
  speaking-on-your-behalf actions always require explicit approval.
- Every tool execution is audited: timestamp, tool, arguments, permission
  decision, result, model, cost.
- Separate "can propose" from "can execute."

---

## Status summary

| Phase | State |
|---|---|
| 0. Architecture contract | Complete, revised today |
| 1. Local conversational core | Complete |
| 2. Agent runtime | Substantially complete |
| 3. Memory | Basic; needs summarization and decay |
| 4. Local computer tools | Complete for files; needs app control |
| 5. Tiered routing | **Implemented today, needs live verification** |
| 6. Web access | **Implemented today, needs a Brave key** |
| 7. Background service | Partial — companion app runs, launchd untested |
| 8. MCP client | Not started — highest leverage remaining work |
| 9. Full Mac control | Not started |
| 10. Voice | Not started |
| 11+ | Not started |

---

## Phase 5 — Tiered routing *(implemented, unverified)*

Replaces the old "Phase 5 — Cloud escalation."

Done: `ModelRouter` with local/fast/deep tiers, Anthropic tool-use support,
prompt caching on the system prefix, per-call cost estimation, monthly budget
enforcement, provider audit in SQLite.

**Remaining:** verify live against the API. Add per-category pinning so
anything touching a sensitive scope stays local. Surface running spend in the UI.

**Milestone:** a trivial question is answered by Haiku for a fraction of a cent,
a hard one goes to Sonnet, both are logged with cost, and hitting the budget
ceiling degrades to local instead of failing or overspending.

## Phase 6 — Fresh information *(implemented, needs a key)*

Was buried inside old Phase 7. Promoted, because "answers about current things"
is a primary requirement and had zero implementation.

Done: `web_search` (Brave API, free tier 2,000/month), `fetch_url` with HTML
text extraction, a real agent loop so Orion can search *then* read *then*
answer, and a system prompt that instructs it to search rather than guess.

**Remaining:** add `BRAVE_SEARCH_API_KEY` to `.env`. Then consider result
caching, and citation formatting in replies.

**Milestone:** ask about something from this week and get a correct, sourced
answer. Ask with no key configured and get an honest "I can't search right now"
instead of a hallucination.

## Phase 7 — Always-on background service

The companion app starts the runtime; `native/launchd/` exists but is unproven.

**Build:** verified launch-at-login, crash recovery, health endpoint monitoring,
clean startup and shutdown, and confirmation that scheduled jobs fire with the
window closed.

**Milestone:** reboot the Mac, touch nothing, and a reminder set yesterday still
fires today.

## Phase 8 — MCP client *(highest leverage remaining work)*

**This one phase replaces the old Phases 7 and 14 entirely.**

Rather than hand-writing a Gmail connector, then a Calendar connector, then
GitHub, then Whoop — implement the Model Context Protocol client once. Every
MCP server ever written becomes an Orion capability, and the ecosystem grows
without you.

**Build:** MCP client (stdio and HTTP transports), server config in `.env` or a
config file, dynamic tool registration into the existing `ToolRegistry`, and —
critically — mapping every discovered MCP tool into Orion's existing permission
levels. An MCP tool must not bypass the approval path just because it arrived
dynamically. Default unknown tools to "requires approval."

**Milestone:** add a Gmail MCP server to config, restart, and Orion can search
and summarize your inbox without a line of Gmail-specific code — but still
cannot send anything without approval.

## Phase 9 — Full Mac control

Files already work. This is the "open anything, control anything" layer.

**Build, in order of preference:**

1. **Apple Shortcuts** — `shortcuts run <name>` reaches an enormous amount of
   macOS and iOS with no private APIs. You already proved the pattern with the
   Clock timer. Generalize it: a shortcut registry Orion can enumerate and call.
2. **AppleScript / JXA** — scriptable apps: Mail, Notes, Music, Finder, Safari.
3. **`open` and URL schemes** — launching apps and deep links. Cheap, covers
   "open Spotify."
4. **Accessibility API** — last resort, for apps with no scripting interface.
   Powerful and brittle; gate it behind approval.

**Milestone:** "open Spotify and play my focus playlist, then set a 25 minute
timer" works end to end, by voice or text.

## Phase 10 — Voice

Moved up sharply. Voice is the single feature that makes this *feel* like
Jarvis rather than a chat window, and the pieces are now cheap and local.

**Build:** push-to-talk first, `whisper.cpp` locally for speech-to-text
(fast on an M5 Pro, free, private), macOS `AVSpeechSynthesizer` or a hosted
voice for output, short spoken responses, interruption handling, then optional
wake word.

Voice is another client of the same runtime. It must not bypass approvals — a
spoken "yes, do it" is a valid approval; silence is not.

**Milestone:** hold a key, speak, Orion acts and answers aloud.

## Phase 11 — Remote channels

Reach Orion from your phone. Telegram is the easiest first channel; iMessage is
the nicest and the most fragile.

**Milestone:** text Orion from class, get an authenticated answer from the same
runtime, approve a queued action from your phone.

## Phase 12 — Proactive watches

Bounded monitoring with explicit scope, thresholds, quiet hours, and expiration.
A casual mention must never create an indefinite watch.

**Milestone:** define a trip and a weather threshold; get alerted only when it
matters.

## Phase 13 — Autonomous away-tasks

Bounded work while you are gone, with checkpoints, runtime limits, approval
pauses, and no silent failure.

## Phase 14+ — Everything else

Wearables (Whoop), school systems, smart home, phone calls. Each follows the
same progression: read-only → summarize → propose → approval-gated write →
narrow trusted automation. If an MCP server exists, use it instead of building
a connector.

---

## Recommended order from here

1. Verify today's changes on your Mac; get a Brave key; rotate the Anthropic key.
2. Finish Phase 7 so Orion is genuinely always on.
3. **Build the MCP client (Phase 8).** Nothing else comes close on leverage.
4. Shortcuts bridge (Phase 9) — this is where it starts feeling like Jarvis.
5. Voice (Phase 10) — this is where it stops feeling like a chat app.

## Open decision

Whether to keep building the runtime yourself or adopt an existing one
(OpenClaw, Hermes Agent, OpenJarvis) and contribute Orion's macOS permission
layer as an MCP server. Section 5 of `ORION_STATE_AUDIT.md` lays out the
tradeoff. Decide before Phase 8, because Phase 8 is where the duplicated effort
becomes expensive.
