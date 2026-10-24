# 12 — Decisions, Reversals and Lessons
> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: the decision record of the whole project, drawn from chapters 02a–02d and their fragment indexes, plus the open findings collected while writing the guide. Read after: `01_big_picture.md` and the history chapters `02a`–`02d` (chapters 04, 07, 09 and 10 help for section 5).
> The worktree is dirty at the snapshot (uncommitted plugin `dist` files, `docs/evals`, `docs/learn`). Anything described as live config (for example `~/.openclaw/openclaw.json`) is not in git.

## In this file
1. [How to use this chapter](#1-how-to-use-this-chapter)
2. [The decisions that shaped ORION](#2-the-decisions-that-shaped-orion) (26 entries, ADR style, by date)
3. [Reversals](#3-reversals)
4. [Lessons ORION keeps re-learning](#4-lessons-orion-keeps-re-learning)
5. [Open findings from writing this guide (2026-10-14/15)](#5-open-findings-from-writing-this-guide-2026-1014-15)
6. [Questions to ask your tutor](#6-questions-to-ask-your-tutor)

---

## 1. How to use this chapter

This is the "why" chapter. Chapters 03 to 10 say what the code does at HEAD. The history chapters say what happened, in order. This one cuts across both: each decision that still shapes the code, what it replaced, what it cost, and whether it still holds.

**Conventions.**
- Dates are `MM-DD` of 2026 unless a year is given. Commits are short hashes; I checked each one I cite with `git show -s --format='%h %ad %s' --date=short <hash>`.
- "Still true?" means: does the code at HEAD still behave this way. It is based on the chapters' reading of the code, not on a fresh test.
- **(inferred)** marks a reason or consequence I could not find stated in a commit or handoff.
- Where a decision lives in a document that was later moved out of the repo (for example the 2026-07-28 planning docs, now in git history only), I cite the commit that holds it.
- Section 5 is different in kind. Everything there is an **unverified observation from reading code**. Nothing was run live and nothing was fixed.

**Three ways to study with it.**
1. Read section 2 in order. It is the project's design argument, in about 26 steps.
2. Read section 4 when you are about to change something. Most bugs here are one of about 15 repeat shapes.
3. Paste one ADR or one lesson plus the cited file into your AI tutor and ask it to defend the opposite choice.

---

## 2. The decisions that shaped ORION

Format per entry: **Context / Decision / Alternatives considered / Consequences / Still true?**

### ADR-01 — Hand the Python prototype to Claude for review (2026-07-28)
- **Context.** ChatGPT had built a local Python assistant: `orion/` runtime, SQLite store, Ollama `gpt-oss:20b`, a roadmap of Phases -1 to 13 (`1abb90b`, 07-28). Nick's handoff note claimed a full model-tool-model loop, planner/executor separation and saved conversations.
- **Decision.** Have Claude audit it before building on it. The audit (`planning/ORION_STATE_AUDIT.md`, in `a4a4809`, 07-28) read every file.
- **Alternatives considered.** Keep building on ChatGPT's own account of its work.
- **Consequences.** The audit found the handoff overstated the code: one tool round trip, not a loop; five regexes before the planner; messages saved but never read back; one registered tool; a benchmark tie (4/8 each); a live API key in `.env` files. It set the pattern "a model's summary of its own work drifts optimistic", and it produced the audit-then-fix loop used ever since. The design values did survive: "planner and executor are separate" is still the core of the plugin.
- **Still true?** The Python runtime is no longer the product (ADR-02, ADR-12). The principle of independent review is still used (see lesson L4).

### ADR-02 — Adopt OpenClaw as the brain's runtime (2026-07-28)
- **Context.** The same day, `planning/ADOPT_VS_BUILD_DECISION.md` recommended "keep building Orion", citing a security analysis of OpenClaw with 470 advisories. `planning/OPENCLAW_MIGRATION_PLAN.md`, written afterwards, reversed it: "adopt OpenClaw as the runtime", after reading OpenClaw's real macOS docs (both in `a4a4809`).
- **Decision.** ORION becomes an agent inside the OpenClaw gateway (LaunchAgent `ai.openclaw.gateway`, loopback `127.0.0.1:18789`), extended by one TypeScript plugin, `orion-control`. Keep a small, strict, self-owned trust layer on top.
- **Alternatives considered.** Keep building the Python runtime; mine OpenClaw's security research only.
- **Consequences.** Menu bar app, model routing, cron, memory index and channels came for free. The cost is a second copy of everything: repo source versus installed copy under `~/.openclaw` (lesson L2). The "keep building" document's five security recommendations still shaped the plugin: direct-argv exec, provenance-conditioned trust, identifier-only identity checks, layered memory, untrusted-by-default extensions.
- **Still true?** Yes. `orion-control` is the product's spine.

### ADR-03 — Cloud brain, local hands (2026-07-28, reconfirmed 08-16 and 09-29)
- **Context.** ChatGPT's design was "local first, escalate to cloud on failure". The audit (`a4a4809`) called this "backwards for what you are building": a 20B local model is good at picking a tool and filling arguments, bad at open-ended reasoning.
- **Decision.** A cloud model reasons and orchestrates; local code and local models act. By 07-30 the routing was primary `anthropic/claude-haiku-4-5-20251001`, fallbacks `ollama/qwen3.6:27b` then `ollama/llama3.2:3b` (`807ee86`). On 09-29 Nick chose to stay on Haiku 4.5 and escalate only truth-check retries to Sonnet 5, rejecting Sonnet for every turn (about $20 a month) (HANDOFF 09-29 15:42, per `02c`).
- **Alternatives considered.** Local-first with gpt-oss:20b default (the original handoff); Gemma 4 31B as executive model (an archived 07-29 plan, never adopted).
- **Consequences.** Quality and tool use are good, cost is real, and the system fails badly when the API account fails (the 2026-10-11 credit outage, `513276d`). It also set up ADR-21: when cost pressure came, the answer was to bring local models back as a front desk and worker.
- **Still true?** Partly. Haiku is still the default brain, but V3 routes some turns to local models when `localRouting` is on (ADR-21, ADR-22).

### ADR-04 — Plain JSON/JSONL files, not a database (07-28 onward; reason inferred)
- **Context.** The Python prototype used SQLite (`orion/store.py`, eleven tables, `1abb90b`). After the move to OpenClaw, ORION's own state appears as JSON and JSONL files under `~/.openclaw/orion-controlled/` (`01_big_picture.md` section 5): `life-config.json`, `task-ledger.jsonl`, `reminders.json`, `focus-state.json`, `remote-audit.jsonl` and dozens more.
- **Decision.** Keep each kind of state in a small human-readable file, written atomically (tmp + rename), with a lock where two writers exist. **(inferred: I found no commit that states this as a decision; it is the observed design.)**
- **Alternatives considered.** SQLite (what ChatGPT built); OpenClaw's own sqlite store is used for cron and the memory index but not for ORION data.
- **Consequences.** Every file can be read with `cat` and `node -e`, which is why so many "walk it yourself" steps in this guide are one-liners. The price is concurrency: the health log lost updates when the Mac app and the plugin both wrote it (`b35a731`, 08-11; the race test later measured 34% of updates lost unlocked). The fix was a lock, not a database. Plugin and Mac app also have to keep two readers of one schema in sync by hand.
- **Still true?** Yes. The phone backend's SQLite (`backend/local_today`, `964fd64`) was built and then superseded (ADR-17).

### ADR-05 — A native macOS app, not a browser UI (2026-07-30)
- **Context.** The prototype hosted a web UI in a `WKWebView` companion (`native/OrionCompanion`).
- **Decision.** Replace it with a native SwiftUI menu-bar app, `Orion.app` (`2f6bc6e`, 07-30), so macOS permissions (Accessibility, microphone, Calendars) belong to a real app. The handoff value was "native means native".
- **Alternatives considered.** Keep the browser UI; the browser stayed as a fallback only briefly.
- **Consequences.** About 79k lines of Swift now. It forced ADR-06, because macOS ties every permission to the app's code signature.
- **Still true?** Yes.

### ADR-06 — The signing identity is an invariant (2026-07-30)
- **Context.** Ad-hoc signing made macOS treat each build as a new app: duplicate "Orion" rows in Accessibility and push-to-talk dying after every rebuild (`f8ac320`, 07-30).
- **Decision.** Sign every build with one stable identity, so TCC grants and later Keychain access survive rebuilds. `scripts/orion-sign-setup` first created a self-signed certificate; after it created seven untrusted ones, setup stopped creating certificates and `make_app_bundle.sh` signs by SHA-1 hash (`f018255`, 07-30). The hardened runtime then needed explicit entitlements, found the hard way four times: microphone (`c2c4347`), calendars (`a79bb89`), contacts (`5444062`), camera (`d623dab`).
- **Alternatives considered.** Ad-hoc signing; a scripted certificate import (it cannot mark the certificate trusted).
- **Consequences.** A scripted check, `scripts/orion-identity-check`, and `Tests/run-update-test.sh` guard it. The $99 Apple Developer Program was deferred "to the end" by Nick (`79623cd`, 09-01). Keychain still prompts per build, a measured limitation.
- **Still true?** Yes. It is called "the one invariant" in the history.

### ADR-07 — Trust comes from what the model cannot write (2026-07-30)
- **Context.** A model can claim anything in its own output, including that Nick approved something.
- **Decision.** Plugin 0.7.0 minted trust from host-provided provenance, not from model-written tags (`807ee86`). It broke every action until the plugin read the session transcript for the user's real words (`0d3fd57`, 07-30). Later the "your words must name every path segment" rule was loosened (`7f281f1`) and then replaced by a data-taint registry (`399c036`, 08-04).
- **Alternatives considered.** Content-based wording checks (rejected after they locked Nick out of his own audit trail).
- **Consequences.** The gate is harder to talk around, and more brittle when the host's transcript format changes.
- **Still true?** Yes, with the open finding in section 5 (F3) about permission raises.

### ADR-08 — Typed actions, a permission ladder and approvals (2026-07-30 to 09-04)
- **Context.** The model must act, but not with open-ended shell access.
- **Decision.** The model calls one tool, `orion_task_run`, with a TaskGraph of steps. Each step names an action in a catalog (`plugin/orion-control/src/catalog.ts`) with a risk tier, an expected verification and a reversible flag. A permission profile and a strictness mode decide which tiers run, ask, or refuse; consequential steps need an approval bound to the arguments by hash. Risk, verify and reversible were derived server-side from the catalog, which "killed the `verification_mismatch` retries" (`807ee86`).
- **Alternatives considered.** Free `exec`/`fs` tools (denied, see ADR-09); model-declared risk levels.
- **Consequences.** Three reviews found the gate was weaker than it looked: the approval gate "had nobody in it" because the agent could approve its own call (`0e0036d`, 09-02, now needs a human grant), and the strictness ladder was "a description" until it was wired (`f8f69d2`, 09-04, which also found a live token in a backup). The ladder still has a known edge (F2) and a known weak approval (F3).
- **Still true?** Yes in shape. Live: permission profile `external_connected`, strictness `guarded` (chapter 04).

### ADR-09 — Deny raw shell, then open it through wrappers (2026-07-30 to 08-11)
- **Context.** With an empty ledger, `group:runtime` and `group:fs` let the model bypass the gate entirely.
- **Decision.** Deny both (`c17689d`, 07-30). Later the GAME_PLAN (`ea2fffe`, 08-04) reopened an exec allowlist, and in practice access became a toolbelt of audited `orion-*` wrappers launched with argv and no shell (`d9cf665`, 08-11). Rule from the GAME_PLAN: "Block what cannot be undone. Log everything else."
- **Alternatives considered.** Keep the denial; permit raw exec with approval prompts (`ask: on-miss` hung for 240 s, so `ask: off` was kept, 08-09).
- **Consequences.** Most of ORION's behaviour is 30-odd Node CLIs in `scripts/`. A permission half shipped; the architecture half of the GAME_PLAN did not (`CLAUDE.md`).
- **Still true?** Yes.

### ADR-10 — The 85-phase v2 manifest (2026-08-18)
- **Context.** Nick wrote an external "ORION v2 implementation plan" (2,642 lines, fingerprinted) of 85 numbered phases.
- **Decision.** Register it (`1d1e821`, 08-18) as `docs/planning/v2/MANIFEST_PHASES.json`, with a gate checker, `scripts/orion_v2_phase_gate.py`, and `PHASE_GATES.json` for state. Phase numbers are the only vocabulary for "what comes next".
- **Alternatives considered.** Lettered batches (ADR-11); organising by product route (tried 09-07, undone 09-17).
- **Consequences.** A clear program, and a pressure to enumerate rather than build: on 09-03 one session "built the rest of them" in two days (`3f05780`), recording phases that had no consumer, and Phase 39 was marked complete with none (`d0eeebb`, 09-07). The checker does not enforce the additive `REC-*` register; `CLAUDE.md` says to check it by hand.
- **Still true?** Yes.

### ADR-11 — Replace the phases with lettered batches A to H (2026-09-01), then withdraw it
- **Context.** A review on 09-01 found the manifest's Phase 0 had inventoried `orion/*.py`, a stack that was no longer running. `250c0ed` ("the manifest's ordering was derived from a fiction") replaced the numbered phases with batches A to H.
- **Decision.** Proposed, then withdrawn the same day, silently, inside a Phase 35 commit (`53cd339`, 09-01). `CLAUDE.md` now records it as withdrawn: "There is no Batch C."
- **Alternatives considered.** Keep the numbers (chosen).
- **Consequences.** The work labelled "Batch A" and "Batch B" really happened (Phase 33 plus 43, and Phase 40, e.g. `9c511d2`, `50f7110`), and handoff entries keep those names. A reader meeting "Batch" must not infer a lettered plan.
- **Still true?** The withdrawal holds; see ADR-12 for what survived.

### ADR-12 — Interpret requirements against the LIVE stack (2026-09-01)
- **Context.** The surviving finding of the withdrawn correction.
- **Decision.** Where a phase says "Python runtime" or `orion/*.py`, read it as the Swift app in `native/Orion` and the TypeScript plugin in `plugin/orion-control`. This changes how a requirement is read, not the order of phases (`CLAUDE.md`; `docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md`).
- **Alternatives considered.** Re-sequence the program (ADR-11); port the Python (never done).
- **Consequences.** Phases 34 to 39 turned out to have no Python dependency to inherit, so no re-sequencing was needed. Python survives only as reference validators and, until 09-30, the phone backend.
- **Still true?** Yes; it is a standing rule.

### ADR-13 — Approval needs a human grant, not an echoed hash (2026-09-02)
- **Context.** An independent review found `orion_task_run`'s approval could be satisfied by the model echoing back the hash it had just been given.
- **Decision.** Require a grant that the model cannot produce (`0e0036d`, 09-02).
- **Alternatives considered.** Keep the hash echo with a stricter prompt (a related "honesty brief" had already disarmed the self-modification gate, `f2c1c34`, fixed by `68d1b5e`).
- **Consequences.** Task approvals are sound. The same echo pattern still exists for `orion_permission_change` (finding F3).
- **Still true?** For tasks yes; for permission raises see section 5.

### ADR-14 — Remote channels: a verb is not a conversation (2026-09-02)
- **Context.** The Discord bridge (`0af5235`, 09-02) first dropped the MESSAGE_CONTENT intent (least privilege), refused to fall through to a model, and treated a known verb with bad arguments as a usage error, with a 12 per 10 minute rate limit.
- **Decision.** Nick reversed all four in a day: a DM reaches the brain, not just a verb (`c5c5175`); a bare verb is conversation, rate limit raised to 40 (`80a6e46`); the intent was restored (`0d67b37`).
- **Alternatives considered.** The strict version.
- **Consequences.** A usable phone line, plus a stored safety question: the fallthrough to a model is now guarded by ADR-13 style checks and later by the truth checks (ADR-18).
- **Still true?** Yes.

### ADR-15 — A local agentic development runtime ("Qwen builds ORION") (2026-09-21 to 10-01)
- **Context.** Nick wanted unattended overnight development on a local model, at no API cost.
- **Decision.** Build a supervised loop: worker and reviewer roles addressed by role, one resident model on 48 GiB (`a32a8ae`, 09-21, 20.7 GiB measured); `enabled` lives outside the repo and is file-only; streaming inference; a trace in a disposable `activity.json` (`a63f1f2`). Task-level escalation so one hard task cannot end the night (`c9ddbec`, 09-22, Nick: "make sure this loop is able to be continuous"); `qwen3.6:27b` for both roles, measured over eight candidates; the reviewer re-runs checks itself and a contradiction escalates (`d1e7e98`); context is bounded, not compacted; `### EDIT` hunks instead of whole-file rewrites (HANDOFF 09-25 14:12); a soft task hour with a reviewer-granted extension.
- **Alternatives considered.** An 80B quantised reviewer (reviews badly under quantisation); trusting the worker's report; run-level halt on a blocked task; whole-file rewrites (7 to 11 minutes each).
- **Consequences.** Qwen wrote real parts of ORION (life-loop libraries, the "ORION truthful" modules). Failures in the harness looked like failures of the model for a week (lesson L11). Some Qwen output was never wired (F11). The Qwen "surfaces" project was finished by Codex handover with honest labelling (`357a227`, 10-02), and the Mac app (`native/Orion`) is closed to it.
- **Still true?** The runtime exists and works; it is run on request, not as the main development path. A UI Start button turns unattended execution on (F8).

### ADR-16 — Eval mode: a marker file that blocks real sends (2026-09-30)
- **Context.** Evaluations push scenarios through the real phone handler, which can send real messages. A real message had once gone out during a test (chapter 09 section on eval mode).
- **Decision.** A marker file (`~/.openclaw/orion-controlled/eval-mode`, env override `ORION_EVAL_MARKER`) makes outbound senders refuse. It blocks sends, not state changes (calendar, reminders and health changes still happen, so snapshot and undo them yourself). Introduced with the truthful-reply work (`c2eda84`, 09-30); callers include `orion-messages-send`, `orion-discord-alert` and `orion-reach`.
- **Alternatives considered.** A mock transport (would not test the real route).
- **Consequences.** Real route evals are possible. The marker "on while under 2 hours old" is also a hazard: a stale marker silently stops real messages (lesson L12).
- **Still true?** Yes.

### ADR-17 — CloudKit, not the Python backend, for the phone (2026-09-28, shipped 09-30)
- **Context.** 09-14 to 09-17: a Python backend with owner-scoped SQLite snapshots and device pairing (`964fd64`, `1076c2b`) was built for phone pairing.
- **Decision.** Nick chose CloudKit as the phone backbone, with Tailscale optional later (HANDOFF 09-28 09:33). The phone ships as a real iPhone app (`b59bdca`, 09-30); phone commands go through the same `orion-remote handle --from phone` path, not a new API (HANDOFF 09-28 10:00).
- **Alternatives considered.** Tailscale/HTTP pairing to the Python backend.
- **Consequences.** The Python backend is now reference code (chapter 08). Offline phone: rules for actions, the model only chats (HANDOFF 09-29). 10-12: the phone never answers with the on-device model (`a44ce44`). A phone grant is "sent" until the phone confirms (`900bcaa`, `1801a69`, 10-01).
- **Still true?** Yes.

### ADR-18 — Claims need tool calls: classifier, work check, truth check (2026-09-30 to 10-13)
- **Context.** A model that can say "Done" will say it. On 10-08 ORION said it had rescheduled when the tool printed `NOTHING WAS BOOKED` (`scripts/orion-reschedule:990`, per `02d`).
- **Decision.** Compare the reply with what tools printed. Stages: a claim classifier and reply linter on the chat path with escalation on false claims (`c2eda84`); the eval-side `claims.mjs` (`aebaa0d`, 10-08); the plugin's `work-check.ts` (`7575167`, 10-10); then where code can build the sentence, code builds it (ADR-23, ADR-25). Truth-check retries run on Sonnet 5 (ADR-03).
- **Alternatives considered.** Trust the model; ask the model to double-check itself (a 9B self-review flagged nearly everything and was rejected, `REPORT.md:416-434`).
- **Consequences.** False-"done" rates fell (J6 false claims 3 to 0). The checks themselves have phrase lists that miss new phrasings ("I've set a...", `26f914d`), and a copy in two places.
- **Still true?** Yes.

### ADR-19 — Day rules by construction (2026-09-30 to 10-01)
- **Context.** Schedule bugs were fixed one case at a time: overlaps, gym before soccer, a day filled with 13 stale blocks (`4205b85`, `752ac71`, `afe697b`, `1bcf4ad`).
- **Decision.** One invariant checked before every write: no overlaps, a cascade, true-size drawing (`2602593`, 10-01, Nick). Verbs for single blocks (`now`, `extend`) and standing rules saved by code, not remembered by the model (`3034d64`). Replacement of a day is one tool, not the default (`afe697b`). Schedule by time order; importance decides what to drop (`752ac71`).
- **Alternatives considered.** Per-symptom fixes; ordering by importance.
- **Consequences.** The scheduler (`scripts/orion-reschedule`) became the one place calendar rules live. Rules still exist in two places at times (nap rule, `6830e6d`, `295000a`).
- **Still true?** Yes.

### ADR-20 — The prompt diet, and its revert (2026-10-07 to 10-08)
- **Context.** Cost pressure: the always-on prompt files were a large share of each cloud turn (about 14 percent of the bill, per `02d`).
- **Decision.** Trim AGENTS, SOUL, USER and MEMORY (56k to 40k characters, "nothing removed" per the message) and move tool semantics behind `orion-help` (`f17471c`, 10-07). Reverted the next day after Nick's reschedule never happened (`0691dc4`, 10-08 15:26).
- **Alternatives considered.** Per-message topic rules (rejected before shipping: a prompt-cache write costs 12 times a read, so it was more expensive). A 1-hour cache (`cacheRetention: long`, live config) was kept.
- **Consequences.** The evals used (22 scheduling scenarios) could not see the loss. The cause of the regression is inferred, not recorded. Out of it came the V3 rule that evaluation must resemble production (L5).
- **Still true?** The revert holds. The manual later moved into the brain instead (ADR-24).

### ADR-21 — V3: local-first routing, with try, check, escalate (2026-10-08 to 10-12)
- **Context.** Cost and reliability: bring local models back, but honestly measured.
- **Decision.** A front desk (4B `qwen3.5:4b-q4_K_M`) decides, a worker (9B) acts, and a work check escalates failures to a bigger model. Nick: tuning may differ per model and big prompts are fine (`c505cbd`, 10-08); no category "deep" tier, the 9B tries, checks, escalates (`72f7dbf`, 10-10); both local models stay warm (`e3fe000`, 10-14). A repair queue note and an eval harness (`aebaa0d`) came first.
- **Alternatives considered.** A larger local model alone (gpt-oss, 27B: slower or no better), a Haiku reference run (declined by Nick), 9B self-review.
- **Consequences.** Held-out numbers: J3 scheduling 28 of 36 with cascade plus retry; J4 honesty 24 of 24. They did not predict the real route (ADR-22). After `e3fe000` a live turn was 4.5 to 5.8 s, down from 15 to 23 s.
- **Still true?** The code is shipped. Whether `localRouting` is "on" or "shadow" is live config (F13).

### ADR-22 — "On" requires a real-route acceptance record (2026-10-12)
- **Context.** `localRouting` was set to "on" on evaluation numbers (89 to 100 percent) and failed live: "fill the time between my classes" scored 0 of 3. The Mac also had no API credit, so Haiku fallbacks became 60 to 300 s local turns.
- **Decision.** Refuse "on" unless an acceptance record from the real route has at least 20 cases, at least 85 percent passed, a median of at most 20 s, at most 14 days old (`612f962`, 10-12; `plugin/orion-control/src/local-routing.ts:218-229`). A testing window lets Nick try it. A memory note, `no-live-switch-without-real-route-test`, records the rule. Local routing also never falls through to the cloud model (`e42de88`).
- **Alternatives considered.** Trust the eval numbers; a manual checklist.
- **Consequences.** The record at HEAD is the 10-10 result, 7 of 21 at about 35 s, so "on" outside a window is refused. A new gauntlet (3 of 8 then 12 of 12, `a847ba8`, `3389cd4`) was run on the real route.
- **Still true?** Yes. Caveat: finding F5, and F13 on the unrecorded 10-11 flip.

### ADR-23 — Schedule-flow: code, not the model, builds argv (2026-10-12)
- **Context.** The 9B could not reliably choose block ids, do time arithmetic ("push back half an hour" gave 16:15, `46235d4`) or build shell arguments.
- **Decision.** A fixed sequence (`plugin/orion-control/src/schedule-flow.ts:1-14`, `f0b2b67`): code reads the numbered day; the worker fills one form whose block references are enums of today's real ids; code compiles the form into exact `orion-reschedule` arguments; the scheduler runs; the worker only phrases what it printed. Commutes are invisible blocks (`70ebf12`). Guards and one correction round (`110bc80`); the reply is built by code from the scheduler's lines (`3076cbb`); the flow's result is final (`a847ba8`).
- **Alternatives considered.** Let the worker call tools freely (the old loop said "Done" for changes it never made, gauntlet 3 of 8); calendar changes to the cloud model (kept as an option, `localRoutingScheduleToCloud`, `0372a72`, off in live config).
- **Consequences.** Offline replay of Nick's real day went from 7 of 8 to 10 of 10; gauntlet 12 of 12 at 7 to 12 s. It is only reachable from `index.ts`, so tests cannot book real blocks (the 10-12 "B4" incident, `110bc80`).
- **Still true?** Yes.

### ADR-24 — The manual lives in the brain, not the prompt (2026-10-12)
- **Context.** `AGENTS.md` was silently truncated at 20,000 characters when loaded, and a 17k-token prompt made the 9B take 60 to 100 s a turn (`b4c8b55`).
- **Decision.** A small core prompt, with the manual stored as notes in the Basic Memory brain (`cd1bcb6`, 10-05) that the model looks up and that are pre-fetched for the local worker (`15f0775`, 10-12, Nick).
- **Alternatives considered.** Topic rules per message (ADR-20, rejected); a bigger prompt (truncated).
- **Consequences.** A short always-on prompt, at the cost that behaviour now depends on a lookup that can be skipped.
- **Still true?** Yes.

### ADR-25 — Code builds the `alarm_set` call (2026-10-13)
- **Context.** "Remind me at 11" became a to-do, with a wrong date, and moved real work (`b5bf4ab`, 10-13). Then both truth checkers missed "I've set a..." (`26f914d`).
- **Decision.** Reminders are `alarm_set`, never a to-do; `orion-tasks` refuses `--at`. Code builds the exact `alarm_set` call; a reply without the call is retried and then replaced; "I've set a..." counts as a claim (`26f914d`).
- **Alternatives considered.** Teaching `orion-tasks` to accept `--at` (a to-do and a timed reminder are different things).
- **Consequences.** Reminders no longer depend on the model's tool choice. An edge remains for ambiguous times (F7).
- **Still true?** Yes.

### ADR-26 — Commit in groups, push, never rewrite history (2026-09-30)
- **Context.** A dirty tree of about 44,000 lines accumulated from 09-21 to 09-30; nothing in between could be bisected, and CI had been red 27 days (four independent causes).
- **Decision.** Nick: commit in groups and push; `main` fast-forwarded; no trailers (`AGENTS.md:140-150`); the archive moved out of the repo and `var/brain` untracked (`a27103b`, 09-30). The remote is `github.com/NickMadaio/orion`; history is never rewritten (skill `orion-git`).
- **Alternatives considered.** The 08-18 rule "do not commit or push unless asked" (reversed by `66b9e3a`).
- **Consequences.** A green CI and a readable repo. The attribution lines asked for in this session's commit instructions conflict with "No Co-Authored-By lines"; three early commits broke the rule (`55c5648`, `3034d64`, `7e1ea26`).
- **Still true?** Yes.

---

## 3. Reversals

A reversal is a decision a later commit or note undid. Reversals are not failures here: the project's habit is to record them. Rows are in date order. "Commit" is the commit that did the undoing (or the first record of it).

| Date | From → to | Why | Commit |
|---|---|---|---|
| 07-28 | Keep building Orion → adopt OpenClaw | The "keep building" paper was written from the security literature before reading OpenClaw's real docs | `a4a4809` |
| 07-28 | Local-first (gpt-oss:20b default) → Haiku primary, local as fallback | Audit: a 20B model picks tools well, reasons badly; "backwards" | `a4a4809`, `807ee86` |
| 07-28 | Python runtime is the product → Python is reference only | OpenClaw plus the Swift app and the plugin are the running system | memory text in `93e9a42`; ruling `250c0ed` |
| 07-30 | Voice daemon under launchd → run from the app | launchd cannot run code under `~/Desktop` (Desktop TCC); undone in 9 minutes. The same cause killed Mac voice for 3 weeks, found 09-29 | `dff87ea` → `1d82682` |
| 07-30 | Setup auto-creates a self-signed certificate → setup only explains the manual trust step | Seven untrusted certificates | `f8ac320` → `f018255` |
| 07-30 | Deepgram as the default ear → Apple on-device recognition | A silently failing audio converter gave zero transcripts | `a187595` |
| 07-30 | "User's words must name every path segment" → scope check → data taint | Locked Nick out of his own audit trail | `7f281f1`, `399c036` |
| 07-30 | Deny `group:runtime` and `group:fs` → exec allowlist, in practice `orion-*` wrappers | The deny was too blunt for real work | `ea2fffe`, `d9cf665` |
| 08-05 | Calendar read-only → own events → any event via approval sheet → id-only delete | Real use needed writes; deletes stayed identity-checked | `04676fd`, `f251464`, `fd343df` |
| 08-08 | Audit: drop Obsidian → the Brain was indexed and a vault kept in repo | OpenClaw memory alone was not enough | `1efd37c` |
| 08-11 | Tasks, Calendar and Messages as separate tabs → folded into one | Too many surfaces | `81cd050` |
| 08-11 | Heartbeat on the main run loop → `DispatchSourceTimer` | Timer stalled with the UI | `b4baaa0` |
| 08-18 | "Do not commit or push unless asked" → push to GitHub; later "commit and push every finished piece" | A remote now existed | `66b9e3a`, `AGENTS.md:140-150` |
| 08-19 | Strict v2 bridge throws on mismatch → an observer, never a gate | Contract fidelity was blocking real use | `93e9a42` |
| 09-01 | Phases 0-84 → lettered batches A to H → numbered phases again | Phase 0 had inventoried a dead stack; the order did not need to change | `250c0ed` → `53cd339` |
| 09-01 | "No Keychain seam" → corrected in 20 minutes | A grep missed `enum SecretStore` | `79623cd` → `6261878` |
| 09-02 | Drop the MESSAGE_CONTENT intent → restore | Nick wanted DMs read | `0af5235` → `0d67b37` |
| 09-02 | Remote: no fallthrough to a model → a DM reaches the brain | A verb-only channel was not useful | `c5c5175` |
| 09-02 | Known verb plus bad args is a usage error, rate limit 12 → conversation, 40 | A conversation is not twelve commands | `80a6e46` |
| 09-02 | Approval by echoing a hash → a human grant | The agent could approve its own call | `0e0036d` |
| 09-02 | Strictness ladder "built" → wired | It was a description only | `f8f69d2` |
| 09-07 | Flight model qwen3.6:27b → gpt-oss:20b → qwen3.6:27b for the agentic loop | Wrong metric (wall-clock), then a measured comparison | `0353057` → `c9ddbec` (09-22) |
| 09-07 | Typecheck as the bar → `npm test` plus orphan exports | A typecheck rewards dead code | `3cef4f2` |
| 09-07 | Organise by product route (REC gates) → numbered audit | Phase 39 "complete" had no consumer | `d0eeebb`, 09-17 numbered audit |
| 09-14 | Phone pairing on the Python backend → CloudKit | Simpler, and Nick's call | `964fd64` → `b59bdca` |
| 09-15 | Repo reorganisation → repaired | It broke packages, paths and shipped tests | `8cc9cbe` → `3941e8f` |
| 09-22 | Run-level escalation → task-level | "make sure this loop is able to be continuous" | `c9ddbec` |
| 09-25 | Whole-file writes → `### EDIT` hunks | 7 to 11 minutes per rewrite at local speed | HANDOFF 09-25 14:12 |
| 09-28 | Mac Home = Today-first → orb Home restored, Today moved to Tasks | Nick wanted the pre-Astra Home | HANDOFF 09-28 11:16 |
| 09-30 | Replacement as the default for rescheduling → one tool, incremental first | Replacement was not transactional | `afe697b` |
| 09-30 | Schedule by importance → by time order | Gym before soccer | `752ac71` |
| 10-01 | 75-minute get-ready → 105 | "i usually wake up at 7:15 for 9 classes" | `44c1443` |
| 10-01 | Thinking off for text → low for text, off for voice | Day-changing requests need it | `7e1ea26` |
| 10-01 | Plan from pasted to-do text → one block per to-do | Four to-dos merged into one | `936b695` |
| 10-07 | Local 9B filters overheard speech → removed | The filter dropped five real follow-ups | `18c29b9` → `e5cd0d0` (10-08) |
| 10-07 | Trim the always-on prompt → full files restored | A reschedule Nick said was done never happened | `f17471c` → `0691dc4` (10-08) |
| 10-09 | Judge rubric v2 → v1 | v2 agreed less on identical items | `db6e1ac` → `c95e5d4` |
| 10-09 | 40 J1 examples for the 9B → 25 | Held-out 111 vs 105 of 138; more examples overfit | CONTINUE (archived) |
| 10-11 | `localRouting` "on" → shadow, gated | Live 0 of 3 on a real request | `612f962`, `f835b11` (10-12) |
| 10-12 | Old worker tool loop for schedules → fixed sequence (form, compile, run) | The loop said "Done" for changes it never made (gauntlet 3 of 8) | `f0b2b67`, `a847ba8` |
| 10-13 | "Remind me at 11" as a to-do → `alarm_set` built by code | A reminder became a to-do on the wrong date | `b5bf4ab`, `26f914d` |
| 10-14 | Models loaded per call → both kept warm at their real context, no hidden thinking | 15 to 23 s a turn down to 4.5 to 5.8 s | `e3fe000` |

---

## 4. Lessons ORION keeps re-learning

Each lesson gives 2 to 4 incidents, then the rule or code that came out of it. The chapters' own per-era lesson lists (02a section "Cross-era themes", 02b section 14, 02c section 15, 02d section 14) are the source; I merged them and checked the hashes.

### L1. Silent degradation is the worst failure
- 07-30: the "warm" TTS daemon ran under a Python without `mlx_audio`, degraded to spawning a process and reloading a model per chunk, logged a warning and "kept working, just slowly" (`f8ac320`); MLX was pinned to one thread because the warm engine "was never actually being used" (`73aa6a4`).
- 07-30: a failable audio converter was optional-chained, so a nil converter dropped every buffer: audio level 0.456, socket open, zero transcripts (`51518c4`, `a187595`, `d1955f1`).
- 08-12 to 09-01: Sparkle pointed at a literal `ORION_OWNER/ORION_REPO` placeholder, so 38 automatic update checks failed unheard; a focus session sat wedged open from 08-12 (fixed `9c511d2`, 09-01).
- 09-04: two contract checks had failed for three days "because nothing ran them" (`b78391d`). 09-29: Mac voice dead for three weeks because launchd cannot run `~/Desktop` code.
- 10-11: the API account ran out of credit and the gateway silently fell back to a local 9B with a 17k-token prompt (60 to 300 s a turn); nobody noticed for hours.
- **Rule/code.** Make every fallback loud and every empty state explain itself. `account-health.ts` alerts once per episode and names the fix (`513276d`). Unknown options are refused (L13).

### L2. The repo copy is not the live copy
- 07-30: the plugin has two copies, source in the repo and a compiled one under `~/.openclaw/extensions/orion-control`; "a rebuild must be copied, then the gateway reloaded" (`807ee86` handoff).
- 08-05: the gateway never restarted for a new plugin build because `etimes` is not a BSD `ps` keyword (`e575cce`). The workspace `AGENTS.md` that the gateway reads is a separate installed copy of `plugin/workspace/`.
- 10-12: the live 9B's sampling parameters (temperature 0.2, `num_ctx` 32768, `think: false`, `num_predict` 2048) exist only in `~/.openclaw/openclaw.json`, not in git: "a fresh checkout does not reproduce the fix" (02d Era 7).
- Now: `plugin/orion-control/dist/` in git lags `src/` (chapter 04, section 27 item 7); and `scripts/orion-eval` still points at the old `planning/` path (F10).
- **Rule/code.** `scripts/orion-deploy` and `orion-selfdoc` (generated self-description, `588f6a1`); always check the installed copy before claiming a route works (`CLAUDE.md`: "Verify the installed route before claiming it works").

### L3. A check that verifies itself always passes
- 09-01: `orion-lock` was tested for a status the code never returned (`d9cc23d`); a camera fix was reverted by a privacy-invariant test (`d9cc23d`).
- 09-02: the approval gate was satisfied by the agent echoing the hash (`0e0036d`); the honesty brief disarmed the self-modification gate (`f2c1c34` fixed by `68d1b5e`).
- 09-07: a typecheck "rewards dead code", so the bar became the test suite (`3cef4f2`). Injected time zone equals machine time zone; a checksum computed from itself (02b section 14).
- **Rule/code.** Mutation-checked tests ("Verified on real data"), independent check re-runs by a reviewer that does not take the worker's report (`d1e7e98`), and absent enum members in place of runtime checks for prohibitions.

### L4. Self-reports are optimistic; independent review finds what self-review cannot
- 07-28: the ChatGPT handoff claimed a loop that was one round trip (`a4a4809` audit).
- 09-02 to 09-04: four independent reviews each found a security-relevant defect: sender forgery via `--` and a LOCK that failed open (`0d67b37`), two review passes with fixes in `4c800d9` and `f8f69d2` (which also found a live token in a backup).
- 10-08: the log extractor dropped real sessions until reviewed (`f1ec2f9`). 09-22: five review findings despite 77 green tests (HANDOFF 09-22 22:01).
- **Rule/code.** Review is a step (`code-reviewer`, `security-reviewer` agents); "installed proof is the bar" (Astra's contribution from 09-07, 02b).

### L5. Eval is not production
- 10-07: the prompt diet passed 22 of 22 scheduling scenarios and made ORION worse (`f17471c`, reverted `0691dc4`).
- 10-11/12: `localRouting` "on" scored 89 to 100 percent in evals and 0 of 3 live; eval route, prompt, tools and sampling differed from production (`612f962`). Sandbox tools, small prompts and temperature 0 to 0.2 versus Ollama's defaults of temperature 1.0 and presence penalty 1.5 in production (`RESEARCH_IDEAS.md:9-17`).
- 10-12: the live gauntlet scored 3 of 8, then 12 of 12 after changes (`a847ba8`, `3389cd4`).
- **Rule/code.** The acceptance gate (`local-routing.ts:218-229`); the gauntlet; replay on Nick's real logs; the memory note `no-live-switch-without-real-route-test`.

### L6. Dates, mtimes and clocks
- 08-05: `etimes` is not a BSD keyword, so the restart check never worked (`e575cce`).
- 09-01 to 09-25: the cron schedule stayed on New York time "until landing", then was re-homed 17 days late (`50f7110`). 09-02: Phase 37 computed "late" over all history, so a meal counted as late (`4c800d9`). Commits with three different dates and NY/London stamps (02b section 14).
- 10-02: minute-resolution IDs tripped the replay guard (`0a0aa7e`). 10-13: after midnight, "tomorrow" is today (`b5bf4ab`).
- Nick's real clock: the eval marker is "on" while its mtime is under 2 hours old (`scripts/lib/eval-mode.mjs`, chapter 06), and a reminder at an already-passed time is dropped (F7).
- **Rule/code.** Code does time arithmetic (the 9B got "push back half an hour" wrong, `46235d4`); IDs to the millisecond; `ORION_RESCHEDULE_NOW` as an injectable clock; check the date before trusting a doc.

### L7. A claim without a tool call
- 10-08: "Done" after `NOTHING WAS BOOKED` (`scripts/orion-reschedule:990`).
- 10-12: the old loop said "Done" for changes it never made (gauntlet 3 of 8, `a847ba8`). 10-13: "I've set a..." slipped past both checkers (`26f914d`).
- 10-01: the phone said "Done" to a phone that had not changed (an uninstalled build); now "SENT, NOT CONFIRMED" (`900bcaa`, `1801a69`). 09-29: `orion-weather-alert` run to answer a question sent a real Discord message because a send was described as a read.
- **Rule/code.** The claim classifier (`c2eda84`), eval `claims.mjs` (`aebaa0d`), plugin `work-check.ts` (`7575167`), and "when code can build the sentence, code builds it" (`3076cbb`, `26f914d`).

### L8. Pin contents, not counts; count carefully
- 09-18: two rows marked `passed` were downgraded on evidence (`c07dc48`, `bc0bb47`). Three times in 09-01 to 09-20 a test pinned a count instead of the contents (02b section 14).
- Different test suites report 236, 144, 746, 855 or 946 tests; always say which invocation (02c section 15).
- 10-07: scripts committed with mode 644, so every new to-do failed (`2f89313`).
- **Rule/code.** `tests/scripts-executable` pins mode 755; the Keychain test pins call sites by file, not by count (`6261878`).

### L9. A check nobody runs, and modules built but not wired
- 09-04: two contract checks failing for three days (`b78391d`); 09-07 Phase 39 "complete" with no consumer (`d0eeebb`).
- 10-01: `grant-policy`, `reply-times`, `reply-person`, `day-review` and `trace` merged (`5628d2b`, `0a97af5`) with tests and no importers at HEAD (F11); `orion-learn` and the workspace sync were never run.
- 09-02 to 09-04: the strictness ladder existed in `0e0036d` but was unwired until `f8f69d2`.
- **Rule/code.** Orphan-export check added to the bar (`3cef4f2`); "Not yet wired (next)" lists in the handoff; `CLAUDE.md` says never claim the gate checker enforced what it ignores.

### L10. Two writers corrupt quietly; one writer plus a lock
- 08-11: the health log lost updates when the app and the plugin wrote at once (`b35a731`; the race test measured 34 percent lost unlocked).
- 10-06: `orion-ontask` overwrote the Mac app's state file (`6eb4dca`); focus is now `orion-session`.
- 10-01: run state of the life loop corrupted by manual hand-over, repaired the same day (02c section 14.4). 09-24: the first agentic run died on restarts that misclassified a timeout.
- **Rule/code.** `SessionService` is the sole writer of focus state; `run-race-test.sh` runs both real writers; the IPC client "fails loudly".

### L11. Failures in the harness look like failures of the model
- 10-01: two Qwen rows "1/16" were transport failures, not model results (`5293e1a`). 09-26: a roadmap run halted at 2 of 40 because the worker spent every exchange reading.
- 10-01: a model eviction race spent three attempts in three seconds (`5da0855`); 10-09: a queue stalled two hours on a `pgrep -f` match (`e9811fa`); grader bugs ate a week of scores (`7e9430b`, `f9e8fb2`, `57be797`, `e74d09b`).
- 10-09: gpt-oss "thinking on" was an invalid parameter and scored 0 of 25 (`5eb940b`).
- **Rule/code.** Read the journal or transcript before blaming the model; validate parameters per model family; "a zero is a harness bug until read".

### L12. A stale marker or config hijacking live behaviour
- 08-12 to 09-01: a paused focus session accrued 60 heartbeats over twenty days and never expired (`9c511d2`); now it expires 18 hours after its last event.
- 10-12: the live 9B ran with an empty model entry, so Ollama's defaults applied instead of the tuned values. A coding-session probe once threw away 47 of Nick's real turns (`scripts/lib/eval/exclude.mjs` header).
- 10-11: `localRouting` set to "on" in live config with no commit or handoff entry (F13); `on` captured at plugin registration still runs the work check after the testing window (F5).
- The eval marker silences real sends; it now expires after two hours (chapter 06). Unattended Qwen execution is enabled by an `enabled` flag kept outside the repo (`a63f1f2`), but the UI Start button writes it (F8).
- **Rule/code.** Time-bound markers (eval marker, testing window `testingUntil`); `config-audit.jsonl` records every live config change with argv; acceptance gate.

### L13. Refuse; do not ignore
- 10-06: `--until` was silently ignored; unknown options now fail with NOTHING WAS CHANGED (`1e99edc`). 10-07: glued commands `drop X move Study --by 30` are refused (`a7f506b`). 10-13: `orion-tasks` refuses `--at` (`b5bf4ab`).
- 10-06: a turn that spun 30 repeat-guard blocks now ends after three (`2b4301c`).
- **Rule/code.** Refuse unknown options and two commands in one call; make the refusal tell the model the right tool.

### L14. Cap everything
- 10-12: a 14k-token form runaway (`cd91e9d`) and an 11k-token relay runaway (`ea28355`) each stalled the single GPU.
- 10-06: the phone voice conversation ran away (`4000a9d`); 10-08: an alarm storm, "snooze 20 million" (`188afeb`).
- 10-11: a 17k-token prompt on the 9B took 60 to 100 s (`b4c8b55`).
- **Rule/code.** `num_predict: 2048`; `VoiceSessionGuard`; serialised AlarmKit scheduling; a slim worker prompt.

### L15. Model proposes, code disposes; hand the model only what it is good at
- 07-28: the original handoff's own principle, reaffirmed at every rewrite. 10-12: the 9B picks from a dozen real block ids; code does dates, flags, arithmetic and the reply (ADR-23).
- 10-01: "Rearrange now" put dinner earlier because the model retyped the whole day; "extend the DS lab" retyped it three times (fixed by verbs, `3034d64`, `1bcf4ad`).
- 10-13: reminders by code-built `alarm_set` (`26f914d`).
- **Rule/code.** Verbs, not retyping; forms with enums of real ids; the reply built by code.

### L16. A gate the gated party can satisfy is not a gate
- 07-30: provenance tags the model could write (fixed by host provenance, `807ee86`, `0d3fd57`). 09-02: the approval hash echo (`0e0036d`). 09-02: the honesty brief that disarmed a gate (`68d1b5e`).
- Today: the permission raise echoes a hash (F3).
- **Rule/code.** Trust from what the model cannot write; a human grant; independent review of every gate.

### L17. Fix by invariant, not by symptom
- 09-30 to 10-01: five schedule fixes in two days, each "one case at a time" (`4205b85`, `afe697b`, `752ac71`, `1bcf4ad`) until the day-rule invariant (`2602593`).
- 10-12: schedule cases fixed one by one until the fixed sequence (`f0b2b67`). 10-09: adding test cases beat patching prompts (4B practice 89 to 94 but held-out 123 both ways, `0fc202e`, `53922c4`).
- **Rule/code.** An invariant checked before every write; a held-out set; "add cases, do not patch prompts".

### L18. Cost was the reason, and cost was mismeasured
- 10-07: the prompt diet saved on a number that was about 14 percent of the bill and cost the behaviour (`f17471c`, `0691dc4`); topic rules per message would have cost 12 times more per cache write.
- 09-29: Sonnet for every turn would be about $20 a month; the chosen split measured about $7 (HANDOFF 09-29).
- **Rule/code.** `orion-usage`, per-model usage; escalate only on failures.

---

## 5. Open findings from writing this guide (2026-10-14/15)

**Read this first.** Every item below is an **UNVERIFIED observation from reading code**. Nothing was run against the live system, nothing was tested end to end, and nothing was fixed. Some are marked "(verified with the compiled module)" or "(verified)" in the source chapter; that means someone called a pure function or re-read the lines, not that the live behaviour was observed. Treat each as a lead for a safe, read-only check, in this order of how much it could hurt: F3, F8, F13, F6, F1, F2, the rest.

"Where to look" gives the path and line from the chapter the finding came from. Line numbers are as of snapshot `6c93032` and may have moved in the dirty worktree. For each: **Claim / Where to look / Why it matters / How to verify safely.** Safe means: read files, grep, run pure functions with `node -e`, read private logs. Never run a live script, deploy, restart or anything that touches the calendar.

### F1. `selfdev_queue` and `selfdev_status` always report failure (chapter 04)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `verifyAction` still has no `selfdev` branch and falls through to `return { observed: false }` at `plugin/orion-control/src/executors.ts:3074`, while `catalog.ts:3108` still declares `selfdev_task_queued`; no commit touching selfdev landed since 6c93032.
- **Claim.** `verifyAction` has no `selfdev` branch, so verification returns `{observed:false}` and the task is reported as a failed action although the queue file is written. **UNVERIFIED** as live behaviour; chapter 04 says it was confirmed by calling the compiled `verifyAction`, and by one ledger row (2026-09-08T00:16Z, `failed_permanent`, "Independent verification did not observe the expected state.").
- **Where to look.** `plugin/orion-control/src/executors.ts:2648-3074` (`verifyAction`); `runSelfDevelopment` at `:3428-3479`; catalog entry `selfdev_queue` (`catalog.ts:3099`, tier `dev_operations`, expected verification `selfdev_task_queued`).
- **Why it matters.** The model would be told a self-development task failed when it was queued. It may retry, double-queue or report "I couldn't". It also shows how a catalog entry can exist with no verifier (lesson L9).
- **How to verify safely.** `grep -n 'selfdev' plugin/orion-control/src/executors.ts` and read the `verifyAction` switch for a matching case. Then `grep selfdev_queue ~/.openclaw/orion-controlled/task-ledger.jsonl` (read-only) to see the single row. Do not call the tool.

### F2. `strictness.ts` lists `ambient_info` instead of `ambient_read` (chapter 04)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `READ_KINDS` still lists `"ambient_info"` at `plugin/orion-control/src/strictness.ts:245`, while the execution kind is `ambient_read` (`catalog.ts:2492`); no commit since 6c93032 changed it.
- **Claim.** `READ_KINDS` contains the tier name `"ambient_info"` where the execution kind is `"ambient_read"`, so under the `contained` strictness mode, `clock_now`, `weather_now` and `system_status` (and `browser_read_page`, `reminder_list`, the atlas reads) would ask for approval. The live mode is `guarded`, where this has no effect. **UNVERIFIED** live; chapter 04 verified it with the compiled module.
- **Where to look.** `plugin/orion-control/src/strictness.ts:245`; the catalog rows for `weather_now`, `clock_now`, `system_status` (`catalog.ts:2485, 2510, 2527`).
- **Why it matters.** It is a latent bug: someone who switches to `contained` for safety would find the harmless read actions blocked and might switch back. It also shows the permission ladder was wired from a description (ADR-08, `f8f69d2`).
- **How to verify safely.** Read `strictness.ts` around line 245 and `grep -n 'ambient_read\|ambient_info' plugin/orion-control/src/*.ts`. Pure-function check: import the compiled strictness module in `node -e` and ask for the decision for those kinds, if it exports one; do not change the live mode.

### F3. A permission-profile raise is approved by the model echoing a hash (chapter 04)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: a raise still needs only `request.approvalHash === canonicalHash` (`plugin/orion-control/src/permissions.ts:383`); `permissions.ts` has no commits since 6c93032.
- **Claim.** `orion_permission_change` approves a raise when the model passes back the `approvalHash` it was just given, the pattern `0e0036d` removed from `orion_task_run`. The remaining binding to Nick is that his own turn must name the profile and talk about permission. Chapter 04 notes that there is no ticket or grant step and that no test asserts either way (**inferred**).
- **Where to look.** `plugin/orion-control/src/permissions.ts:376-390` (hash compare, then audit to `permission-audit.jsonl` and an atomic state write `:405-429`).
- **Why it matters.** It is the one control that decides what the whole ladder allows, and it is the only approval left that the model can satisfy on its own (lesson L16). The failure case needs Nick's words to mention the profile, for example in pasted content or a long message, so it is narrower than a free bypass, but it is the weakest link.
- **How to verify safely.** Read `permissions.ts:360-430`; `grep -rln permission_change plugin/orion-control` to find the tests and see what they assert; `tail ~/.openclaw/orion-controlled/permission-audit.jsonl` to see real raise history. Do not request a raise.

### F4. The Mac app's context header makes thinking "low" on every cloud turn (chapters 04, 07, 10)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `ThinkingPolicy.needsReasoning` still falls back to `>= 35` words (`native/OrionMobile/Sources/MobileCore/ThinkingPolicy.swift:42`, unchanged since 6c93032) and `AppState.agentRequest` still wraps every message in the ~50-word context header (`native/Orion/Sources/Orion/AppState.swift:2201`) before `GatewayClient.ask` (`GatewayClient.swift:127`).
- **Claim.** `ThinkingPolicy.needsReasoning` returns true for text of 35 or more words. `AppState.agentRequest` wraps every message in an `[Orion app context ...]` block of about 45 to 53 words before `GatewayClient.ask` applies the policy, so the threshold is always crossed and `--thinking low` is passed on every non-Ollama turn. Chapter 07 counted 53 words for a bare "hi" and found 57 log lines "low for this turn" and 0 "off for this turn" as of 2026-10-14. **UNVERIFIED** (counted by reading; the log count is a read-only observation).
- **Where to look.** `native/Orion/Sources/Orion/AppState.swift:2075-2113` (`agentRequest`); `ThinkingPolicy.swift` (last line of `needsReasoning`); `scripts/lib/thinking-policy.mjs:6-26` (the Node twin used by the phone path); `~/.openclaw/logs/orion-app.log`; chapter 07 section 3.6, chapter 10.
- **Why it matters.** Commit `7e1ea26` (10-01) intended "low for text, off for voice" and `thinking-policy` is meant to keep casual chat cheap. Always-low thinking costs latency and tokens on every desktop turn, and it contradicts the policy's stated intent.
- **How to verify safely.** `grep -c 'thinking\] low' ~/.openclaw/logs/orion-app.log` and `grep -c 'thinking\] off' ...`; run the policy in `node -e` on a short sentence with and without the header (see chapter 03, "Walk it yourself" for the command).

### F5. After the testing window closes, Haiku answers but the work check and reply rewrite stay active (chapter 10)
- **Status at 7c8f6b1 (2026-10-24).** MOOT: `278d75e` ("local always") removed the testing window and acceptance gate, so `localRouting: on` is permanent and Haiku no longer takes over mid-session (`plugin/orion-control/src/local-routing.ts:600-607`; HANDOFF.md:23).
- **Claim.** With `localRouting` "on" and a testing window that expires mid-session, the answer hook returns `undefined` so Haiku answers; but `on` was captured as `true` when the plugin registered, so the finalize work-check and the `reply_payload_sending` rewrite stay registered and keep running until the next gateway restart. **UNVERIFIED** (the chapter marks it "inferred from reading; not exercised live").
- **Where to look.** `plugin/orion-control/src/local-routing.ts:216` (window check), `:284` (hook returns `undefined`), `:218-229` (acceptance rule), `:240-247` (the refusal log); `plugin/orion-control/src/index.ts` registration site; chapter 10 T1 hop 8 and Exercise 3. The testing window ended at 17:04:46Z on 2026-10-14.
- **Why it matters.** Checks written for a local worker's replies would also edit Haiku's replies for a while, so behaviour after the window depends on whether the gateway restarted, which is invisible to Nick.
- **How to verify safely.** Read the three line ranges; look in `~/.openclaw/orion-controlled/local-routing/shadow.jsonl` and the gateway log for rewrite events after 17:04Z. Do not restart the gateway.

### F6. Quiet hours never hold a nudge (chapter 10, raw proactive-nudge trace)
- **Status at 7c8f6b1 (2026-10-24).** FIXED: `b0ae920` (with `3719e27`) rewrote quiet hours from his sleep window; `scripts/lib/reach/presence.mjs:15-20` now composes `quietFacts` from `awareness/facets.mjs` and no longer tests for `"night"` (its comment says the old test never matched).
- **Claim.** `presence.mjs` decides quiet hours by testing `sleep.state === "night"`. `orion-now` never emits `"night"` (`sleep-state.mjs` returns `day`, `unknown`, `awake_late`, `probably_asleep` or `winding_down`; `orion-now:39` maps `unknown` to `awake_late`). So `quiet` is always false and the `hold` channel is unreachable. Only `bed-now` and `bed-late` nudges are explicitly urgent. **UNVERIFIED** live (verified by reading the two files).
- **Where to look.** `scripts/lib/reach/presence.mjs:10-25` (line 21 holds the comparison); `scripts/lib/life/sleep-state.mjs:5-18`; `scripts/orion-now:39`.
- **Why it matters.** Nick could be nudged while "probably asleep" or "winding down". That is a promise of the product ("steps in") turned against its own purpose.
- **How to verify safely.** `grep -rn '"night"' scripts/lib/reach scripts/lib/life scripts/orion-now`. Run `node scripts/orion-now --json` (read-only per chapter 10; check its header first) and look at `sleep.state`.

### F7. "Remind me at 11" said in the afternoon can be stored as a time already passed and then dropped silently (chapter 10)
- **Status at 7c8f6b1 (2026-10-24).** FIXED: `f627b7c` made reminders code-built with arithmetic times, and `resolveAlarmTime` now throws "has already passed" for a past timestamp instead of storing it (`plugin/orion-control/src/ambient.ts:425-427`; test `reminder-flow.test.ts:135`); the Mac `staleAfter` drop (`ReminderService.swift:102`) is unchanged but is no longer reachable by this path.
- **Claim.** On the local route, if the 9B returns a bare `11:00` for "remind me at 11 to call mom" at 14:00, the `alarm_set` call has `at:"2026-10-14T11:00"` (3 hours earlier). `resolveAlarmTime` takes the `Date.parse` branch and does not roll forward, `alarm_set` only validates a non-empty string, the reply says "Reminder set for Wednesday at 11:00 AM", and the Mac's 2-second poll drops it as overdue by more than 120 s with only a log line. On the Haiku path, `at:"11pm"` takes the clock form and rolls forward. **UNVERIFIED**; chapter 10 marks it "inferred from code; not tested".
- **Where to look.** `plugin/orion-control/src/ambient.ts:404-416` (`resolveAlarmTime`); `plugin/orion-control/src/catalog.ts:2578-2589` (`alarm_set` validation); `native/Orion/Sources/Orion/ReminderService.swift:99-104` (`staleAfter` 120 s, "dropped" log line); the extraction prompt used by code-built `alarm_set` (`26f914d`).
- **Why it matters.** It is a false "done": the user is told it is set and nothing fires. It sits at the exact seam of ADR-25.
- **How to verify safely.** Read the three ranges; `grep 'late — dropped' ~/.openclaw/logs/orion-app.log` for any past drops. Test `resolveAlarmTime` in `node -e` against the compiled `dist` with the two inputs at a fixed `now`, if it takes an injectable clock; do not create a real alarm.

### F8. Starting a project from the UI passes `--enable` (chapter 07)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `ProjectTab.start()` still appends `--enable` when unattended execution is off (`native/Orion/Sources/Orion/ProjectTab.swift:657`), and `scripts/orion-projects:36-39` still honours it; no commit since 6c93032 touched either.
- **Claim.** `ProjectTab` appends `--enable` to `orion-projects launch` whenever `agentic-config.json` has unattended execution disabled, although the panel says enabling is "deliberately not a switch in this window". So the Start button flips unattended execution on through the CLI. **UNVERIFIED** (read, not run).
- **Where to look.** `native/Orion/Sources/Orion/ProjectTab.swift:649-662`; `scripts/orion-projects:36-39,95-102` (the `--enable` flag writes `enabled:true`); chapter 07 section 8.4; ADR-15 and `settings.mjs:17` (`enabled` kept outside the repo by design).
- **Why it matters.** A deliberate safety property of the Qwen runtime (a file-only switch outside the repo, `a63f1f2`) is bypassed by one button, so an unattended local agent can run with write access to the repo after a single click. Related: stopping Qwen projects from chat is "registered projects only, never --enable" (`de9221b`, `b748c40`).
- **How to verify safely.** Read the two ranges. Check `cat ~/.openclaw/orion-controlled/agentic-config.json` for `enabled` (read-only; it holds no secrets by design, but check). Do not press Start.

### F9. A nudge that `orion-reach` refused is still marked as said for the day (chapter 10, raw proactive-nudge trace)
- **Status at 7c8f6b1 (2026-10-24).** FIXED: `71eb69f` and `9d8bd79` added `deliveryOutcome` in `scripts/orion-proactive` (`:173`, `:208-213`); `orion-reach` now exits 3 for `NOT SENT` (`scripts/orion-reach:134,142,149,153`), and a refusal stays unsaid so the next tick retries, with a drop cooldown and daily give-up cap.
- **Claim.** `orion-proactive` treats exit code 0 as sent. `orion-reach` also exits 0 for `NOT SENT: ...` (and for an eval-mode refusal), so a message that was held back is recorded as said and is not retried until the next day. **UNVERIFIED** live (chapter 10 says "verified" by reading).
- **Where to look.** `scripts/orion-reach:44-45`; `scripts/orion-proactive:80`; chapter 10 section on T4 (the anti-nag gate).
- **Why it matters.** A needed nudge (for example the bedtime one) can be lost silently because a gate said no once, the exact shape of silent degradation (L1). Combined with F6 it makes the proactive path quieter or louder than designed.
- **How to verify safely.** Read both ranges. Compare `~/.openclaw/orion-controlled/` proactive state ("said today" keys) with `remote-audit.jsonl` for `NOT SENT` rows (read-only).

### F10. `scripts/orion-eval` still points `EVALS_DIR` at `planning/v2/evals` (chapter 09, raw eval dossier)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `scripts/orion-eval:48` still sets `EVALS_DIR = REPO / "planning" / "v2" / "evals"` and `planning/` does not exist; the script has no commits since 6c93032.
- **Claim.** `EVALS_DIR = REPO / "planning" / "v2" / "evals"`, but `8cc9cbe` (2026-09-15) moved `planning/` under `docs/`, so as written the script cannot find its fixtures. The script was last touched in that commit. The dossier said `:47`; the line is `:48`. **UNVERIFIED** by running; verified by reading and `ls planning` failing per the chapter.
- **Where to look.** `scripts/orion-eval:48`; `docs/planning/v2/evals/fixtures`; `docs/planning/v2/EVAL_REPORT_2026-09-06.md`.
- **Why it matters.** The first-generation eval harness for the phase gates silently cannot run. It is a lesson L2 case: a refactor `3941e8f` repaired most path references and missed this one.
- **How to verify safely.** `sed -n 40,60p scripts/orion-eval`; `ls planning` (expected to fail); `ls docs/planning/v2/evals/fixtures`. Do not run the script (it can call models).

### F11. The "ORION truthful" modules have no importers at HEAD: built, not wired (chapter 02c, 06)
- **Status at 7c8f6b1 (2026-10-24).** PARTLY FIXED: `dc002a0` wired `day-review.mjs` (imported by `scripts/orion-day-review:17` and `scripts/orion-proactive:29`), but `grant-policy.mjs`, `reply-times.mjs`, `reply-person.mjs`, `lib/eval/trace.mjs` and `scenario-check.mjs` still have no non-test importer under `scripts/`, `plugin/orion-control/src` or `native`.
- **Claim.** `grant-policy.mjs`, `reply-times.mjs`, `reply-person.mjs`, `day-review.mjs`, `lib/eval/trace.mjs` and `scenario-check.mjs` are tested but imported by no script. (`todo-parse.mjs` and `notify/triage.mjs` are wired.) HANDOFF 10-01 06:45 lists them under "Not yet wired (next)". **UNVERIFIED** as of the live tree, since a fresh grep is needed after 10-01.
- **Where to look.** `scripts/lib/life/grant-policy.mjs` (125 lines), `reply-times.mjs`, `reply-person.mjs`, `day-review.mjs`, `scripts/lib/eval/trace.mjs`; commits `e12f128`, `87bc5e5`, `5628d2b`, `0a97af5`; chapter 02c section 12; chapter 06 sections 2.9.11 and the "not wired" list.
- **Why it matters.** The features Nick sees as "ORION truthful" (reply-time checks, grant policy, a day review) may not run in production, so docs that describe them overstate the system (lesson L9). 10-13's `26f914d` and `work-check.ts` did wire a similar idea differently, so these may now be dead rather than pending.
- **How to verify safely.** `grep -rl "grant-policy\|reply-times\|reply-person\|day-review" scripts plugin --exclude-dir=node_modules` (the command in chapter 02c).

### F12. Stale Swift harnesses and test scripts with side effects (chapter 07)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `BreakSurface.swift` still defines only `show(remaining:total:prompt:)` (`:62`) with no `isFullBleed`, while `native/Orion/Tests/LayoutHarness/main.swift:212,215` still calls both; `run-race-test.sh:52` still runs `tsc` and `run-update-test.sh:149-154` still quits the app and runs `defaults write`; none of these files changed since 6c93032.
- **Claim.** (a) `LayoutHarness` and `TasksLayoutHarness` probably no longer compile: `Tests/LayoutHarness/main.swift:212-215` uses `surface.isFullBleed` and `show(prompt:minutesRemaining:)` on `BreakSurface`, which does not define them; `Tests/TasksLayoutHarness/main.swift:27` builds `TasksTab(` with an older initializer than `TasksTab.swift:28-62`. (b) `run-race-test.sh` runs `tsc -p tsconfig.json` inside `plugin/orion-control`, rewriting `plugin/orion-control/dist/` (`run-race-test.sh:52`), which is part of the dirty worktree. (c) `run-update-test.sh` quits the installed `/Applications/Orion.app`, runs `defaults write` for the Sparkle feed and relaunches. **UNVERIFIED**: "found by reading, not by running".
- **Where to look.** The lines above; `native/Orion/Sources/Orion/BreakSurface.swift`; chapter 07 section 12.2 and 12.3 (including the warning that every GUI harness compiles all `Sources/Orion/*.swift`, so one API change can break all of them, as in `89cc8cb`).
- **Why it matters.** A test suite that cannot compile gives no signal (L9), and two scripts are unsafe to run casually: one dirties tracked files, one drives the live app.
- **How to verify safely.** `grep -n 'isFullBleed' native/Orion/Sources/Orion/BreakSurface.swift` (no match expected); `sed -n 40,60p native/Orion/Tests/run-race-test.sh`. Do not run either script.

### F13. `localRouting` "on" was flipped live on 2026-10-11 with no commit or handoff entry (chapter 02d)
- **Status at 7c8f6b1 (2026-10-24).** CHANGED/MOOT: `localRouting: on` is now the permanent design (`278d75e`, HANDOFF.md:23), so the flip itself no longer matters; the missing 10-11 commit/handoff record is not backfilled (no `10-11` entry in HANDOFF.md), so the audit gap itself is UNCLEAR and still needs the private-log check.
- **Claim.** The first line of the private routing log `shadow.jsonl` is `2026-10-11T18:40:05Z` in mode `on` (19:40 BST). No commit or HANDOFF entry records the deployment, and Nick's recorded go-ahead is absent (he may have given it in chat). It went back to shadow at 09:55 on 10-12 through the new gate, then "on" again from 13:03 under a testing window. **UNVERIFIED**: from the chapter's reading of a private log.
- **Where to look.** `~/.openclaw/orion-controlled/local-routing/shadow.jsonl` (first line, mode field); chapter 02d section 8 (Era 7 table) and section 13; commits `612f962`, `f835b11`; the memory note `no-live-switch-without-real-route-test`.
- **Why it matters.** It is the root incident behind ADR-22. Live config changes outside git leave no review trail except `config-audit.jsonl`, so the history can only be rebuilt from logs (L12).
- **How to verify safely.** `head -1 ~/.openclaw/orion-controlled/local-routing/shadow.jsonl`; `grep -i localRouting ~/.openclaw/logs/config-audit.jsonl` (read-only; it records argv and may include config values, so do not paste it anywhere).

### F14. Supervisor sleeps ignore exterminate; `orion-forge` hides git errors and reverts HEAD blindly (raw agentic dossier, chapter 09)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `supervisor.mjs` still defines `sleep = (ms, signal)` (`:57`) and calls `sleep(ms, undefined, { signal })` at `:406` and `:434`; `scripts/orion-forge:172-173` still silences `git add`/`git commit` and `cmd_revert` (`:225-230`) still reverts HEAD unchecked; neither file changed since 6c93032.
- **Claim.** (a) In `supervisor.mjs` the local helper is `sleep = (ms, signal) => ...` (`:57-60`) but is called as `sleep(ms, undefined, { signal })` at `:406-408` (alert retry, 60 s) and `:434-436` (pause poll, 15 s). The real signal lands in an ignored third argument, so exterminate does not cut those sleeps short. (b) `scripts/orion-forge` silences `git add` and `git commit` errors with `2>/dev/null` (`:172-177`), and its `revert` reverts HEAD without checking that HEAD is its own commit (`:230`). **UNVERIFIED** live; (a) was confirmed by opening both ranges.
- **Where to look.** `scripts/lib/agentic/supervisor.mjs:57-60, 406-408, 434-436`; `scripts/orion-forge:172-177, 230`; `plugin/orion-control/src/executors.ts:3090-3135` (`runSelfModify`, which calls it); chapter 09 (Qwen project sections), raw dossier "known issues" list.
- **Why it matters.** Exterminate is the "stop everything now" control; a 15 to 60 s delay is minor, but it is the control meant never to fail on a technicality (`ProjectAgentStatus`, chapter 07). The forge bug can revert a commit Nick made by hand, or leave Orion thinking it committed when it did not.
- **How to verify safely.** Read the lines; for the sleep, write a 10-line `node -e` that calls an identical arrow function with a signal as the third argument and see that it never aborts. Do not run `orion-forge`.

### F15. The installed `AGENTS.md` is over OpenClaw's 20,000-character per-file cap (chapter 03)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `plugin/workspace/AGENTS.md` (and the installed `~/.openclaw/workspace/AGENTS.md`) is 32,154 bytes, over the 20,000-character `bootstrapMaxChars` default, and `~/.openclaw/openclaw.json` has no override; the file has no commits since 6c93032. Whether the local-always route still injects it was not checked.
- **Claim.** OpenClaw's `bootstrapMaxChars` defaults to 20,000 per workspace file. `openclaw.json` doesn't override it. The installed `AGENTS.md` is ~31.9k characters, so a Claude turn sees a head, a tail and digest fragments of the middle, never the whole file. Chapter 03 replayed the trimming function offline and found roughly lines 128–425 reach the model only as fragments. **UNVERIFIED** against a live prompt dump.
- **Where to look.** Chapter 03 §2.2 (`03_brain_prompts_memory.md:167-175`); `wc -c ~/.openclaw/workspace/AGENTS.md`.
- **Why it matters.** A rule added to the middle of AGENTS.md may never reach the model. This may also explain why the 2026-10-07 prompt diet looked fine in phone-route evals (which push their own scheduling text) but made real Mac-app turns worse (chapter 03 §4, chapter 02d).
- **How to verify safely.** Count characters (`wc -c`). Then check OpenClaw's own debug output or session trajectory for the truncation marker `[...truncated, read AGENTS.md for full content...]`.

### F16. AGENTS.md tells ORION to run `orion-agenda-change`, which isn't on the exec allowlist (chapter 03)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `plugin/workspace/AGENTS.md:107-108` still says to use `orion-agenda-change task-add`, and `grep -c orion-agenda-change ~/.openclaw/exec-approvals.json` returns 0; no commit since 6c93032 changed the file.
- **Claim.** `plugin/workspace/AGENTS.md:107-109` says to use `orion-agenda-change task-add` for new to-dos. The `calendar` skill says that script is *deliberately* not allowlisted, and `~/.openclaw/exec-approvals.json` has no entry for it. The working route is `orion-tasks add` (`SCHEDULING.md:12`). **UNVERIFIED** live.
- **Where to look.** `03_brain_prompts_memory.md:338`; `grep -c orion-agenda-change ~/.openclaw/exec-approvals.json` (a count only; don't print the file).
- **Why it matters.** Contradictory instructions waste tool calls, and can produce "I added it" with nothing added. That is exactly the failure the claim checks exist to catch.
- **How to verify safely.** The grep count above. Read both instruction sites side by side.

### F17. 135 Python unit tests error because they still use the pre-`8cc9cbe` `planning/` path (chapter 08)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: re-run at 7c8f6b1 gives `Ran 1527 tests ... FAILED (failures=9, errors=135, skipped=10)`, the same 9/135/10 as the snapshot, and 19 test lines still hard-code `"planning"` (e.g. `tests/test_v2_planner.py`, `tests/test_runtime.py`).
- **Claim.** With system `python3`, `unittest discover` runs 1,520 tests: 9 failures, 135 errors, 10 skips. The errors come from tests hard-coding `REPO_ROOT/"planning"/"v2"`, which `8cc9cbe` (2026-09-15) moved to `docs/planning/v2`. The check *scripts* were updated and pass. The tests that exercise them weren't, and they aren't in CI. **Verified** by running the suite (offline) on 2026-10-15.
- **Where to look.** `08_phone_bridge_python_backend.md:1300-1315`.
- **Why it matters.** The policy oracle that proves the live gate is never more permissive than the policy is healthy, but its own tests have been silently broken for a month. A real regression would be invisible.
- **How to verify safely.** `PYTHONPATH=. python3 -m unittest discover -s tests -t tests -q 2>&1 | tail -5` (offline, writes nothing).

### F18. Leftovers that point at deleted things (chapter 08)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `main.py` is still absent yet `native/launchd/com.nickmadaio.orion.plist:10` and `native/OrionCompanion/Sources/OrionCompanion/main.swift:90` still launch it, and `scripts/orion-ontask-watch:35` still writes outbox lines without `id` while `native/OrionLink/App/LinkEngine.swift:170` still drops entries lacking one.
- **Claim.** `native/launchd/com.nickmadaio.orion.plist` and `native/OrionCompanion` still start `python main.py serve`, but `main.py` was deleted in `a064dcc` (2026-09-15). Neither is installed in `~/Library/LaunchAgents` at the snapshot, so nothing runs it. Separately, `scripts/orion-ontask-watch:35` writes alert-outbox lines with no `id`, and the Link helper's `deliverCheckins` requires one, so those alerts are silently dropped. **UNVERIFIED** live.
- **Where to look.** `08_phone_bridge_python_backend.md:811-825` and `:259`.
- **How to verify safely.** `ls main.py` (fails); `ls ~/Library/LaunchAgents | grep orion`; read `orion-ontask-watch:30-40`.

### F19. Small doc-versus-code drift (chapters 06, 09)
- **Status at 7c8f6b1 (2026-10-24).** STILL PRESENT: `README.md:81` still advertises `orion-usage --all`, which `scripts/orion-usage` does not parse; `report.mjs:7` (3/15) and `usage.mjs:8` (2/10) still price Sonnet differently; `AGENTS.md:255` still says 367 Swift tests; recent commit bodies carry no Co-Authored-By, so the last item is only drift against this session's attribution rule.
- `README.md` advertises `orion-usage --all`, which the code doesn't handle. The two cost modules price Sonnet differently: `scripts/lib/usage/report.mjs` uses 3/15 and `usage.mjs` uses 2/10 per Mtok.
- `AGENTS.md` says 367 Swift unit tests, but a static count finds 543. `MANIFEST_PHASES.json`'s `current` map lags `PHASE_GATES.json`.
- The `orion-relay` skill (outside the repo, in `~/.claude/skills`) still says "never commit or push unless asked", which conflicts with AGENTS.md's 2026-09-30 commit-and-push rule. It also names paths that `b90e577` moved.
- `AGENTS.md:140-150` says "no Co-Authored-By lines", but recent commits carry them (see ADR-26).

---

## 6. Questions to ask your tutor

Paste this chapter plus the file named in brackets.

1. ADR-02 and ADR-03: argue for the original "keep building, local-first" design. Which of its consequences would have been cheaper than the OpenClaw dependency, and which would not? [`02a_history_jul28_aug31.md`]
2. ADR-04: why would ORION have been harder to debug on SQLite? What does the health-log race (`b35a731`) say about the cost of plain files? [`01_big_picture.md`, `07_mac_app_swift.md`]
3. ADR-06: walk through how an ad-hoc signature turns into "Accessibility prompts on every launch". Which later invariant (Keychain, Sparkle) depends on it? [`07_mac_app_swift.md`, `09_evals_tests_dev_process.md`]
4. ADR-08 and ADR-13: list every way the model could approve its own action in the current code. Which of them are F3-shaped? [`04_plugin_core_actions_gate.md`]
5. ADR-11 and ADR-12: what is the difference between changing the order of phases and changing how a requirement is read? Why was only the second kept?
6. ADR-20 and ADR-22: design an evaluation that would have caught the prompt diet's regression before it shipped. Then explain why the acceptance gate needs a median-latency threshold as well as a pass rate. [`09_evals_tests_dev_process.md`]
7. ADR-23 and ADR-25: pick any other model-built shell command in the repo. Could it be built by code from a form? What would the form's enums be? [`05_plugin_turn_pipeline.md`]
8. Section 3: which reversals were forced by a failure and which by Nick's preference? Does the distinction predict anything about which decisions are safe to undo?
9. Section 4: choose three lessons and find a current file in the repo that is still exposed to each. (Hint: L2, L9, L12.)
10. Section 5: for F3, F6 and F9 each, write a one-paragraph, read-only verification plan and then a minimal test that would fail today. Which of them would you fix first, and why?
11. Which of the 14 findings are the same lesson in a different place? Group them under L1 to L18 and say which lesson has no finding yet.
12. If you had to delete half of this chapter's ADRs because they no longer matter, which would you keep and why?
