# Orion state audit — July 28, 2026

Written after reading every source file in the repo and comparing it against
`IMPLEMENTATION_HANDOFF.md`. The purpose is to give you an accurate picture
before you spend more time building, because a few of the handoff's claims are
optimistic and one architectural decision is pointed away from your actual goal.

Your stated goal, in your words: the closest achievable thing to Jarvis. Talk to
it, get comprehensive answers including about current events, have it operate
your whole Mac, and extend outward to Gmail, wearables, messaging, and voice.
Local model at the base for cost reasons.

---

## 1. What is genuinely good

Do not throw these away. They are the parts that are hard to get right and that
most hobby projects skip.

**The permission and audit model is real.** Proposal → approval → execute →
rollback, with every step persisted in SQLite. `orion/computer.py` scopes
filesystem access to explicit workspaces instead of the home directory. The
executor, not the model, decides what is allowed. This is the correct design and
it is genuinely implemented, not stubbed.

**The native companion insight is correct and non-obvious.** Discovering that
macOS TCC permissions must be owned by the foreground app rather than a
spawned helper, and then moving the bridge into `Orion.app` with a file-based
request queue, is real engineering. Most people burn a week on this and never
figure out why Calendar access silently fails.

**Durable scheduling works.** Jobs are persisted and claimed, so a restart does
not lose a reminder. `recover_interrupted_tasks` makes crashes visible instead
of leaving tasks stuck in "running" forever.

**The provider boundary exists**, which is what let me restructure model routing
today without touching anything else.

---

## 2. Where the handoff overstates what is built

Not accusations — these are the kind of drift that happens when a long session
summarizes itself. But you should know before you plan around them.

| Handoff says | Reality in the code |
|---|---|
| "Complete model → tool → result → model loop" | It was a single round trip, not a loop. `runtime.respond` called the model, ran tools once, called the model once more, and stopped. Orion could search **or** read a page, never both. |
| "Planner and executor are separate… do not turn Orion into brittle phrase-by-phrase parsers" | `_handle_chat` was exactly that: five regexes in a cascade, matched before the planner is ever consulted. The document's own stated principle was being violated by the code it describes. |
| "Chat with saved conversations" | Messages were written to SQLite but never read back. The model received `[system, user]` on every turn with zero history. Orion could not remember what you said one message earlier. |
| "Registered tool with name, description, schema, permission level…" | `RegisteredTool` had no schema or description field. It was structurally impossible to add a second tool the model could see. Exactly one tool existed: `get_current_time`. |
| "GPT-OSS 20B beat the comparison model" | Your own benchmark: gpt-oss:20b **4/8**, qwen3:30b **4/8**. It tied, and was faster. Both failed the `fresh_information` and `tool_disambiguation` tests. |

**The biggest gap:** your number one requirement is answers about current
things. Orion had **no web access of any kind** — not implemented, not stubbed,
not on the roadmap before Phase 7. A `folder`-matching regex would also swallow
any message containing the word "folder", so "which folder should I use?"
returned a canned capability blurb instead of an answer.

**No version control.** 852MB of untracked work, with a live Anthropic key in
`.env` and `.env.save`. `.env.example` contained the literal string
`replace-with-your-new-key`, which suggests a key leaked once already.

---

## 3. The architectural problem worth fixing now

The roadmap says local-first, escalate to cloud on failure. That is backwards
for what you are building, and it is the reason Orion feels limited.

A 20B local model is genuinely good at one thing: looking at a request, picking
the right tool, and filling in the arguments. It is genuinely bad at open-ended
reasoning, synthesis, and writing. Your benchmark shows this — 4/8, failing on
judgment questions while passing on tool selection.

If a 20B model is the default brain, Orion will always feel like a worse
ChatGPT, no matter how much scaffolding you build around it. And "escalate on
failure" is the worst possible trigger, because a weak model's most common
failure mode is a confident, fluent, wrong answer that never reports failure.

**The fix is to invert it.** Local is not the brain; local is the reflexes.

| Tier | Model | Handles | Cost |
|---|---|---|---|
| 0 | none | Deterministic actions with explicit arguments | free |
| 1 | gpt-oss:20b | Intent classification, tool selection, argument extraction | free |
| 2 | Haiku 4.5 | Normal conversation, summarizing, everyday questions | ~$0.0035 per exchange |
| 3 | Sonnet 5 | Hard reasoning, code, research, multi-step planning | ~$0.02 per exchange |

At your $5–15/month ceiling, tier 2 covers roughly 2,000–4,000 real exchanges a
month. That is more than you will use. You get answer quality in the same class
as a paid chat subscription, for a fraction of the price, and the local model
still does the private, high-frequency, low-value work for free.

This preserves everything you cared about — privacy for local operations, no
vendor lock-in, cheap — while removing the constraint that was capping quality.

---

## 4. Changes made today

All 25 tests pass (up from 17; the 8 new ones cover the new behavior).

- **`git init` plus a real `.gitignore`.** First commit is a snapshot of the
  pre-review state, so everything below is reviewable as a diff. Excluded the
  vendored `Ollama.app` (561MB) and Swift `.build` output (266MB); the tracked
  repo is now ~50 files.
- **`registry.py`** — tools now carry a description and JSON Schema. Registering
  a tool is the only step needed to expose it to every provider.
- **`web.py`** (new) — `web_search` via the Brave API (free tier, 2,000
  queries/month) and `fetch_url` with an HTML-to-text extractor. Zero new
  dependencies. Loopback and non-HTTP URLs are refused, and fetched content is
  explicitly labeled untrusted so it is never treated as instructions.
- **`runtime.py`** — real agent loop, up to 6 tool rounds, so Orion can search,
  read the best result, and then answer. Conversation history is replayed on
  every turn. System prompt now instructs it to search rather than guess.
- **`cloud.py`** — tiered `ModelRouter`, Anthropic tool-use support, prompt
  caching on the system prompt, per-call cost estimation, and a hard monthly
  budget that forces a fallback to local rather than overspending.
- **`store.py`** — `conversation_messages`, `recent_conversations`,
  `spend_this_month`.
- **`server.py`** — action-detection regex now requires a filesystem noun, so
  "write me an essay" no longer gets routed into the filesystem planner. Removed
  the catch-all `folder` responder. `/health` reports tools, spend, and budget.

### What you must verify on your Mac

I cannot reach Ollama or macOS from here, so these are unverified:

1. `uv run python main.py serve`, then confirm `/health` lists three tools.
2. Ask something current. Without a Brave key it should say plainly that it
   cannot search — that honest failure is the behavior to check first.
3. Add `BRAVE_SEARCH_API_KEY` and ask again; confirm it searches, fetches, then
   answers.
4. Multi-turn memory: tell it something, then ask about it next message.
5. **Rotate your Anthropic key.** It sat in an untracked folder in plaintext and
   `.env.example` implies one has leaked before. Rotating costs you a minute.

---

## 5. The decision you should make before building further

There is now a mature open-source ecosystem doing exactly what Orion does, and
it did not exist when this roadmap was written.

- **OpenClaw** — local-first agent runtime, persistent background operation,
  MCP support, messaging gateways for iMessage/Telegram/WhatsApp/Slack, file
  and terminal and calendar access. Roughly 347,000 GitHub stars as of April
  2026, the most-starred project on the platform. There is also a published
  security analysis worth reading before you give it your whole machine.
- **Hermes Agent** — Nous Research, model-agnostic runtime with persistent
  memory, single-command install, bring-your-own-model.
- **OpenJarvis** — local-first on-device framework with tools, memory, learning.
- **jarvis_ai** — Iron-Man-style voice layer and HUD built on Hermes, with
  local Whisper speech-to-text.

This does not make Orion pointless. But it changes what the valuable part of
Orion is. Nobody else has your permission model wired into a properly
TCC-owning native macOS app. That is the piece worth owning. The agent loop,
the connectors, and the messaging gateways are commodity now — you would be
spending months rebuilding what you can install.

The strongest version of this project is probably: **Orion becomes the macOS
body — a permission-gated MCP server exposing your Mac — and something else
provides the brain and the channels.** You would keep everything you have built
that is distinctive, delete the parts that duplicate the ecosystem, and have a
working Jarvis in weeks instead of a year.

That is a real fork in the road and it is your call, not mine. Both branches are
defensible; building it yourself is slower but you learn vastly more, which for
a CS student mid-degree is not a small consideration.
