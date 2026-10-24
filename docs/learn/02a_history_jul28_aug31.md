# 02a — History, part 1: from a Python prototype to an 85-phase program (2026-07-28 → 2026-08-31)
> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: the first 125 commits, `1abb90b` (2026-07-28) through `16ba5e9` (2026-08-20), plus the empty stretch to 2026-08-31. Sources: commit messages and diffs, `docs/GAME_PLAN.md`, `docs/planning/ORION_AUDIT_2026-08-08.md`, and the planning/handoff documents as they stood in git history. Read after: `01_*` (the system overview). Read before: `02b_*` (history from 2026-09-01).

This chapter is a narrative history. Its job is to tell you *why* ORION is shaped the way it is: which ideas were tried, which broke, which were reversed, and which lessons came out of each failure and were written into the code. Every claim is tied to a commit hash so a tutor with the repo open can check it.

## In this file

1. [How to read this chapter](#1-how-to-read-this-chapter)
2. [The month at a glance](#2-the-month-at-a-glance)
3. [Era 1 — The ChatGPT-built Python origin (2026-07-28)](#era-1--the-chatgpt-built-python-origin-2026-07-28)
4. [Era 2 — Claude's review, and the adopt-vs-build whiplash (2026-07-28)](#era-2--claudes-review-and-the-adopt-vs-build-whiplash-2026-07-28)
5. [The invisible gap (2026-07-28 → 07-30)](#the-invisible-gap-2026-07-28--07-30)
6. [Era 3 — The 2026-07-30 marathon: voice, a native app, signing, and trust](#era-3--the-2026-07-30-marathon-voice-a-native-app-signing-and-trust)
7. [Era 4 — More powers, a toolbox, and the permissions reversal (2026-07-30 → 08-05)](#era-4--more-powers-a-toolbox-and-the-permissions-reversal-2026-07-30--08-05)
8. [Era 5 — The dashboard and the connectors (2026-08-05 → 08-08)](#era-5--the-dashboard-and-the-connectors-2026-08-05--08-08)
9. [Era 6 — Orion edits himself (2026-08-08)](#era-6--orion-edits-himself-2026-08-08)
10. [Era 7 — The audit, and the baseline commits (2026-08-08 → 08-11)](#era-7--the-audit-and-the-baseline-commits-2026-08-08--08-11)
11. [Era 8 — The focus-session engine, Gates 0–10 (2026-08-11)](#era-8--the-focus-session-engine-gates-010-2026-08-11)
12. [Era 9 — The uncommitted fortnight: Sparkle, Keychain, self-repair (2026-08-12 → 08-20)](#era-9--the-uncommitted-fortnight-sparkle-keychain-self-repair-2026-08-12--08-20)
13. [Era 10 — ORION v2: the 85-phase manifest, Phase 0 and Phase 1 (2026-08-15 → 08-20)](#era-10--orion-v2-the-85-phase-manifest-phase-0-and-phase-1-2026-08-15--08-20)
14. [Era 11 — One repo, on GitHub (2026-08-20)](#era-11--one-repo-on-github-2026-08-20)
15. [Epilogue — the empty eleven days (2026-08-21 → 08-31)](#epilogue--the-empty-eleven-days-2026-08-21--08-31)
16. [Cross-era themes and lessons](#cross-era-themes-and-lessons)
17. [Walk it yourself](#walk-it-yourself)
18. [Questions to ask your tutor](#questions-to-ask-your-tutor)
19. [Appendix — every commit in range](#appendix--every-commit-in-range)

---

## 1. How to read this chapter

**Citations.** Current code is cited as `path:LINE`. Code that has since moved or changed is cited at the commit where it existed, as `hash:path:LINE`. To open one, run `git show hash:path | sed -n 'LINE,+20p'`.

**Paths moved after this period.** You will see old paths in the commits below. Two later refactors renamed them:

| Path in July/August | Path at the snapshot | Moved by |
|---|---|---|
| `planning/` | `docs/planning/` | `8cc9cbe` (2026-09-15) |
| `openclaw-plugins/orion-control/` | `plugin/orion-control/` | `ceb6b79` (2026-09-15) |
| `openclaw-workspace/` | `plugin/workspace/` | `ceb6b79` (2026-09-15) |
| `planning/_archive/` | moved out of the repo to `~/Desktop/ORION-archive/2026-09-30/` (still in git history) | per `CLAUDE.md` |

**Who wrote the commits.** Git records three author names in this range: `Claude <noreply@anthropic.com>` (51 commits, 2026-07-30 → 08-06), `Nick Madaio` (73 commits, 2026-07-28 and 2026-08-07 onward), and `Nick` (1 commit, `1abb90b`). The "Claude" commits repeatedly say they were written in a sandbox with no Swift toolchain ("this sandbox is Linux and has no Swift toolchain", `57572be`). From `9f64722` (2026-08-07) on, commits use Nick's git identity, use conventional prefixes (`fix:`, `feat:`), and report building and running the real app. So those were most likely Claude Code sessions running on the Mac under Nick's git config. **(inferred)** The v2 commits of 2026-08-15 → 08-19 were written by Codex (OpenAI's coding agent) in its own "lane". The evidence is `planning/v2/COLLABORATION_BOUNDARIES.md` in `3843620` and the "Codex wrote its handoff at 18:32" story in `93e9a42:AGENTS.md`.

**What "dirty worktree" means here.** For most of this history, a lot of work sat on disk uncommitted, sometimes for weeks. Several commits are catch-up snapshots of that work (`154c3fb`, the eight baseline commits of 2026-08-11, `93e9a42`). So a commit's date is when the work was *recorded*, not always when it was *done*. The project learned this the hard way (see Era 10).

**Snapshot caveat.** At the snapshot (`6c93032`, 2026-10-14) the worktree is dirty again (plugin `dist/` files and `docs/evals/` are uncommitted). That does not affect this chapter, which covers only committed history up to 2026-08-31.

---

## 2. The month at a glance

| Date | Commits | What happened |
|---|---|---|
| 2026-07-28 | 2 | ChatGPT's Python prototype committed; Claude's audit; "adopt OpenClaw" decision |
| 2026-07-29 | 0 | OpenClaw installed and the `orion-control` plugin started, all outside git **(inferred)** |
| 2026-07-30 | 34 | One long day: warm voice daemon, native `Orion.app`, signing/TCC fights, trust regression, gate fixes, API-key tools, mic debugging, 19 new actions |
| 2026-08-04 | 7 | Ops scripts, new app surfaces, plugin 0.11/0.12 (taint fix, composed-tool workshop), GAME_PLAN |
| 2026-08-05 | 5 | Visual language, Apple Reminders as the task store, Calendar, Keychain, OAuth, Whoop |
| 2026-08-06 | 5 | Health tracking, Plaid, Whoop refresh fix, two transparency attempts |
| 2026-08-07 | 14 | Third/fourth transparency attempts, OrionDay, morning brief, local-model narratives, Plaid fixes, Finances, Tasks + day timeline, calendar editing |
| 2026-08-08 | 14 | iMessage + Contacts read, permissions audit, `orion-forge` self-modification, "Orion changed his own code" |
| 2026-08-11 | 28 | Eight baseline commits of uncommitted work, then the whole focus-session engine (Gates 0–10) in about ten hours, then one consolidated handoff |
| 2026-08-15 | 3 | ORION v2 Phase 0 begins: secret scanner, live smoke, authority snapshot |
| 2026-08-18 | 6 | v2 collaboration lane, source inventory, phase-gate checker, Keychain migration prep, 85-phase manifest registered |
| 2026-08-19 | 1 | Deferred key-migration safety |
| 2026-08-20 | 6 | Checkpoint of all outstanding work (232 files), one repo, first push to GitHub, git rules rewritten |
| 2026-08-21 → 08-31 | 0 | No commits. Phases 2–32 were built on disk and committed on 2026-09-01 (covered in `02b`) |

Net change across the range: 512 files changed, +120,525 / −1,069 lines (`git diff --shortstat 1abb90b 16ba5e9`). The tree went from 50 files to 547.

A rough shape to keep in mind:

```text
Python prototype ─► Claude review ─► OpenClaw brain + TS plugin "body" ─► native Swift app
   (07-28)            (07-28)              (07-29/30)                         (07-30)
                                                  │
              ┌───────────────────────────────────┴────────────────────────────┐
     trust & permissions            dashboard & connectors           focus-session engine
     (07-30 → 08-04)                (08-05 → 08-08)                  (08-11)
                                                  │
                         audit (08-08) ─► v2 manifest, phases & gates (08-15 → 08-20) ─► GitHub (08-20)
```

---

## Era 1 — The ChatGPT-built Python origin (2026-07-28)

### What was built

The first commit, `1abb90b` (2026-07-28, "Snapshot: Orion state at ChatGPT handoff, before Claude review"), records the project as ChatGPT had left it. It has 50 files and 4,237 lines:

- **A Python runtime** in `orion/`. `server.py` (475 lines) is a `ThreadingHTTPServer` on `127.0.0.1:8765`. `runtime.py` holds the model loop, `store.py` (359 lines) the SQLite store, and `planner.py`, `executor.py`, `computer.py`, `scheduler.py`, `timers.py` and `memory.py` the rest. `main.py` is the entry point (`uv run python main.py serve`).
- **A local model.** It is Ollama `gpt-oss:20b` on `http://127.0.0.1:11434/api/chat` (`a4a4809:orion/provider.py:10-17`).
- **A tiny web UI** in `orion/ui/` and an older prototype in `archive/orion-ui-prototype/`.
- **Two Swift helpers.** `native/OrionCompanion/` is a menu-bar companion that hosted the web UI in a `WKWebView`. `native/OrionMacBridge/` is a 246-line Swift CLI over EventKit for calendar and reminders. The bridge survives to this day; the companion was superseded within two days.
- **A launchd plist**, `native/launchd/com.nickmadaio.orion.plist`.
- **Planning documents.** `planning/IMPLEMENTATION_HANDOFF.md` (330 lines) and `planning/ORION_BUILD_ROADMAP.md` (584 lines) lay out a roadmap of **Phases −1 through 13**: local core, agent runtime, memory, computer tools, cloud escalation, background service, email/calendar, messaging, watches, away-tasks, voice and phone calls. This is the first time the word "phase" appears in the project. Do not confuse these 15 phases with the 85-phase v2 manifest of 2026-08-18.
- **Tests.** `tests/test_runtime.py` (354 lines) and a two-model benchmark in `planning/benchmarks/` (`gpt-oss_20b.json`, `qwen3_30b.json`).

### Why it looked like this

`IMPLEMENTATION_HANDOFF.md` lists the "user decisions that should be preserved". These are the values that shaped everything later, even after the code was replaced:

- **"Local first."** GPT-OSS 20B via Ollama; "Cloud is supplemental, not the default."
- **"Planner and executor are separate."** The model proposes a structured plan, and deterministic code validates, checks policy and executes. This principle survived every rewrite. It is the core idea of the TypeScript plugin and of the v2 manifest.
- **"Standing permissions"** for small, reversible actions; conversational approval for consequential ones.
- **"Native means native."** Use real macOS services, not browser imitations.

The original permission text is short enough to quote. It shows where the "explicit target" idea came from:

```python
# 1abb90b:orion/permissions.py:4-8
LOCAL_CAPABILITY_SUMMARY = """Local capability policy:
- Orion can read permitted workspaces, create folders, and move or rename files when the user gives an exact target.
- Orion can create and cancel local timers without confirmation.
- Orion must ask before deletion, overwriting an existing file, system-setting changes, installing software, external network actions, account access, or bulk actions.
- If a request is incomplete, Orion asks only for the missing location or detail. It must never claim it lacks local file access when a permitted workspace action is available."""
```

### Steps back (found in the very next commit)

Claude's audit (`a4a4809:planning/ORION_STATE_AUDIT.md`) read every file and found that the handoff overstated what was built:

| Handoff claimed | Code actually did |
|---|---|
| "Complete model → tool → result → model loop" | One round trip: model, tools once, model once more, stop |
| Planner/executor separation, no brittle phrase parsers | `_handle_chat` was "five regexes in a cascade, matched before the planner is ever consulted" |
| "Chat with saved conversations" | Messages were written to SQLite but never read back, so the model had zero history |
| A tool registry with schema and description | `RegisteredTool` had no schema field; exactly one tool existed (`get_current_time`) |
| "GPT-OSS 20B beat the comparison model" | The benchmark was a tie, 4/8 each |

It also found "no web access of any kind", "no version control" ("852MB of untracked work"), and a live API key in `.env` and `.env.save` (the audit names no value).

### Lessons

1. **A handoff written by a model summarising itself drifts optimistic.** This is the first entry in a pattern that recurs all month (see Era 10 and the Phase 11–20 review in `02b`).
2. **The design values outlived the code.** "Model proposes, code disposes" is still the core rule.
3. **Secret hygiene started late.** The repo's first secret-handling tool arrived only on 2026-08-15 (`c33d5bf`).

---

## Era 2 — Claude's review, and the adopt-vs-build whiplash (2026-07-28)

### What was built

`a4a4809` (2026-07-28 18:46, authored from Nick's Mac) added real features to the Python runtime:

- **A multi-round tool loop with replayed history** (`orion/runtime.py`, 208 lines changed).
- **Tool schemas and descriptions in the registry** (`orion/registry.py`).
- **Tiered, cost-aware cloud routing** to `https://api.anthropic.com/v1/messages` (`a4a4809:orion/cloud.py:118`).
- **Web search** through Brave (`a4a4809:orion/web.py:10`, `BRAVE_ENDPOINT`). Without the env var `BRAVE_SEARCH_API_KEY` it says plainly "Orion has no web access" (`a4a4809:orion/web.py:82`).

It also added four planning documents. Together they record a decision made and reversed on the same day.

### The whiplash, in order

1. **`planning/ADOPT_VS_BUILD_DECISION.md`.** Its verdict: *"keep building Orion. Mine OpenClaw's security research for design requirements rather than adopting its code."* The evidence was a peer-reviewed security analysis of OpenClaw (arXiv:2603.27517) covering 470 advisories in ten weeks. The analysis found three things: the sandbox "was never actually enforced", the approval allowlist itself was remotely writable, and a malicious skill shipped on the public registry and worked.
2. **`planning/OPENCLAW_MIGRATION_PLAN.md`**, written the same day, reversed it: *"Decision, July 28, 2026: adopt OpenClaw as the runtime."* It says outright: *"Supersedes the 'keep building' recommendation… That document was written from the security literature before reading OpenClaw's actual macOS documentation."* The capability overlap was "near total". OpenClaw already shipped a menu-bar app, TCC prompts, launchd service, exec approvals, Apple skills, voice wake, MCP skills, 15 messaging adapters and tiered model routing.
3. **`planning/ORION_STATE_AUDIT.md` §3** made a second reversal. ChatGPT's "local-first, escalate to cloud on failure" was called *"backwards for what you are building"*. A 20B model is good at picking a tool and filling arguments, and bad at open-ended reasoning. So the brain should be cloud and the hands local.

> **Jargon: OpenClaw.** OpenClaw is an open-source, local-first agent runtime (the analysis calls it the most-starred project on GitHub). It runs a **gateway**, a background service, which by 2026-07-30 was LaunchAgent `ai.openclaw.gateway` on loopback `127.0.0.1:18789`. The gateway hosts an agent loop, model routing, "skills" and **plugins**. ORION from here on *is* an OpenClaw agent: OpenClaw is the brain and runtime, and ORION adds its own plugin (`orion-control`), workspace instructions and a native app. The agent is driven by the CLI `openclaw agent --json` (`2f6bc6e:native/Orion/Sources/Orion/GatewayClient.swift:104-107`).

### What survived of the "keep building" document

It was overruled on adoption, but its security findings became design rules. Its five "steal the designs" items show up later almost word for word:

| ADOPT_VS_BUILD recommendation | Where it landed |
|---|---|
| "Direct-argv exec, never a shell wrapper" | The `orion-*` wrapper toolbelt launched with argv, no `shell:` (`d9cf665`, and the 08-14 audit note in `93e9a42:HANDOFF.md`) |
| "Provenance tags on every string entering the context window… condition tool authorization on origin rather than on content" | Plugin 0.7.0 trust minted from host provenance (`807ee86`); transcript provenance (`0d3fd57`); taint checks (`399c036`) |
| "Identity checks on immutable IDs only" | Calendar delete by identifier only (`fd343df`); later remote-channel work |
| Hermes's three-layer memory | 2026-08-14 layered memory design (`93e9a42:openclaw-workspace/MEMORY.md`) |
| "Treat MCP servers as untrusted code" | Plugin allowlisting (`plugins.allow` pinned, `docs/planning/ORION_AUDIT_2026-08-08.md` addendum) |

### Steps back

- **A decision document reversed within hours** because one side had read papers and the other had read the product docs. The second document says so honestly, which is why the history is easy to follow.
- **The Python runtime stopped being the product.** Nothing in git says so on 07-28. But the workspace memory file committed later records: *"2026-07-28 — … The active runtime is OpenClaw plus the native app and `orion-control`; the older Python package is not the implementation path."* (`93e9a42:openclaw-workspace/MEMORY.md:13-15`). This sentence is the root of the "interpretation rule" in today's `AGENTS.md` and `CLAUDE.md`.
- **The planning docs were deleted two days later.** `807ee86` deleted `CLAUDE_CODE_KICKOFF_PROMPT.md`, `IMPLEMENTATION_HANDOFF.md` and `OPENCLAW_MIGRATION_PLAN.md`, and replaced `ORION_BUILD_ROADMAP.md`. One archived plan (`planning/_archive/OPENCLAW_IMPLEMENTATION_PLAN.md`, dated 07-29) proposed **Gemma 4 31B as the executive model** with GPT-OSS as a "low-authority utility". That model plan was never adopted: by 07-30 the primary was Claude Haiku 4.5 (`807ee86:planning/ORION_FINALIZE_ACCESS_HANDOFF.md`). **(inferred from the absence of any later Gemma configuration in range)**

### Lessons

1. **Read the product docs before deciding from the threat literature, and the other way round.** Both documents were partly right. The final shape is "adopt the runtime, keep a small, strict, self-owned trust layer on top of it". That is exactly what `orion-control` is.
2. **Model role split: cloud brain, local hands.** It was decided here and reconfirmed many times, for example in the 2026-08-16 decision to "keep Haiku as the single conversational/tool orchestrator" (`93e9a42:HANDOFF.md`).

---

## The invisible gap (2026-07-28 → 07-30)

There are no commits on 2026-07-29, but a lot happened. By `807ee86` (07-30 13:25) the `orion-control` plugin already existed at **version 0.7.0**, with "26 → 35 tests". Versions 0.1–0.6 were therefore built and deployed outside git. **(inferred)** `807ee86:planning/ORION_FINALIZE_ACCESS_HANDOFF.md` describes the state then:

- OpenClaw `2026.7.1-2` running as LaunchAgent `ai.openclaw.gateway`, loopback-only.
- The plugin lived in two copies: the source at `~/Desktop/ORION/openclaw-plugins/orion-control`, and an installed copy at `~/.openclaw/extensions/orion-control`. "A rebuild must be copied to the installed path, then the gateway reloaded." That two-copy arrangement causes a bug on 08-05 (`e575cce`).
- **Model routing:** primary `anthropic/claude-haiku-4-5-20251001`; fallbacks `ollama/qwen3.6:27b`, then `ollama/llama3.2:3b`. The local 3B "emits malformed tool JSON", so the 27B goes first offline.
- **Two early fixes:** risk/verify/reversible were derived server-side from the catalog, which "killed the `verification_mismatch` retries". And the workspace `AGENTS.md`/`TOOLS.md` were rewritten from stock boilerplate because Orion "invented tools (`exec`, `siri`, `openClaude`)". The error flood went from 14+ to 0.

> **Jargon: `orion-control`, the action catalog, TaskGraph, ledger.** `orion-control` is ORION's OpenClaw plugin, written in TypeScript. It exposes a few tools to the model, chiefly `orion_task_run` (`93e9a42:openclaw-plugins/orion-control/src/index.ts:731`). The model calls it with a **TaskGraph**: a list of steps, each naming an action from the **action catalog** (`src/catalog.ts`) plus arguments. The plugin **validates** the graph (`validator.ts`), checks **capability tiers** (groups of actions that each have an on/off switch) against the **permission profile** (a named level such as `approved_root_edit` or `consequential_local` that decides which tiers may run). It then executes with fixed executors, **independently verifies** the outcome, and appends a row to an append-only JSONL **ledger**. "The gate" in this history usually means this whole validate → profile → execute → verify → ledger path.

---
## Era 3 — The 2026-07-30 marathon: voice, a native app, signing, and trust

Thirty-four commits in one day, `807ee86` (13:25) through `401dbe9` (21:09), plus two late ones that open Era 4. This is the densest and most instructive day in the history. The commit messages read like an incident log. The same failure shape shows up in nearly every one: **something degrades silently instead of failing loudly.**

To keep it readable, the day is split into five threads.

### 3a. Voice and the first faces (807ee86, 2f6bc6e, f8ac320, 8cf62aa, bc5139c, e4c3ba2)

**Built.**

- **`807ee86` "Warm TTS daemon, standalone Orion interface, structural trust hardening".** At +21,329 lines this is the biggest commit of the month, because it also brought the whole plugin into git. On voice: the old path spawned a fresh Python process and loaded a 250M-parameter Marvis model "from disk on every single spoken reply". `scripts/orion_tts_daemon.py` (1,677 lines) replaced it with a resident daemon on a unix socket (`~/.openclaw/orion-tts.sock`). It splits sentences, cancels on barge-in, and falls back to `/usr/bin/say`. A browser UI followed (`orion/interface/`: a Canvas-2D "Age of Ultron" hologram, push-to-talk, a loopback-only bridge that shells out to `openclaw agent --json`). The commit also brought **plugin 0.7.0**, the trust hardening covered in 3c. 112 Python tests.
- **`2f6bc6e` "Add Orion.app native menu-bar interface".** This is `native/Orion/`, SwiftUI plus AppKit with Apple frameworks only: a non-activating floating panel, global Right-Option push-to-talk, on-device `SFSpeechRecognizer`, and the hologram ported to SwiftUI Canvas. The commit message says *"NOT COMPILED. No Swift toolchain was available where this was written."* The same commit fixes a self-inflicted browser-UI breakage: the server sent `script-src 'self'`, which blocks inline scripts, and all the JS was inline, so "Nothing ran".
- **`8cf62aa`.** Wake word ("Orion"), corner summon, a menu-bar text window, and ElevenLabs/Deepgram as swappable providers. One design rule appears here for the first time: *wake-word detection is on-device only, "never Deepgram, even when Deepgram is the selected ear, because an always-on microphone that streams to a vendor is a different product than this one."* 204 tests.
- **`e4c3ba2`.** The app icon is rendered by `scripts/orion_make_icon.py`, which walks the same geometry as the hologram code so it "cannot drift". This commit also added `scripts/orion-login-item` and `scripts/orion-permissions`.

> **Jargon: MLX, ElevenLabs, Deepgram.** MLX is Apple's on-device machine-learning framework, used here for local text-to-speech. ElevenLabs is a cloud TTS vendor (`/v1/text-to-speech/{voice}/stream`, `93e9a42:scripts/orion_tts_daemon.py:1112`). Deepgram is a cloud speech-to-text vendor, reached over a WebSocket (`wss://api.deepgram.com/v1/listen`, `93e9a42:native/Orion/Sources/Orion/DeepgramSpeech.swift:57`).

**Steps back — the three silent degradations.** The commits say outright that the same mistake happened three times in a row:

1. **`f8ac320` "Fix the two faults that made a working build not work".** The "warm" daemon launched under Homebrew Python 3.13.14, which has no `mlx_audio`. It "degraded to the mlx-cli engine — a process spawn and a 250M model reload per chunk", logged a warning, and kept working, just slowly. The fix: `scripts/orion-python` reads the shebang of the `mlx_audio` console script to find the right interpreter, and `scripts/orion-doctor` *asks the daemon which engine it is really using*.
2. **`dff87ea` "Stop trusting a socket file to mean a daemon is alive".** The daemon died with its Terminal window (SIGHUP) and left the socket file behind. Every health check tested for the *file*, so everything reported healthy while voice fell back to system speech. Checks now open the socket and send a ping.
3. **`73aa6a4` "Pin MLX to one thread — the warm engine was never actually being used".** The live log read `engine mlx-warm failed: There is no Stream(gpu, 0) in current thread -- falling back to say` and `first_ms=3244`. MLX streams are thread-local. The model loaded on one thread and generated on others, so *every* call failed. The fix is a single-worker executor that owns load, generate and convert. Message: *"a fallback that works badly is harder to find than a failure."*

Then two reversals within minutes:

- **`dff87ea` (18:44) moved the daemon under launchd. `1d82682` (18:53) moved it back.** `~/Desktop` is TCC-protected and "a LaunchAgent does not inherit the Desktop access Terminal has". It could not read its own launcher, died instantly, and `KeepAlive` restarted it "several times a second — a crash-loop, which is worse than no daemon." The real cause of the original death was "a missing `</dev/null`, not a missing supervisor."
- **`d1955f1`.** The daemon had *installed its own SIGHUP handler* that treated a closing terminal as shutdown, which overrode `nohup`. "Every Terminal window closed tonight killed Orion's voice." SIGHUP is now ignored.

> **Jargon: launchd / LaunchAgent.** launchd is macOS's service manager. A LaunchAgent is a per-user service definition (a `.plist`) that launchd starts, for example at login, and can keep alive.

**Lessons (written into the commits).** "A component that degrades instead of failing has to say so loudly, and a probe beats a file test" (`dff87ea`). This is the start of the project's top rule, restated on 08-11 as "Every external dependency needs a visible unavailable/denied/stale state" (`4937b72:planning/HANDOFF.md` §8).

### 3b. Code signing, TCC, and the microphone (f8ac320, 08923f5, dfc403d, f018255, 2d33c21, 3c60325, c2c4347, 51518c4, a187595, d1955f1)

> **Jargon: TCC, cdhash, ad-hoc signing, designated requirement, hardened runtime, entitlements.** **TCC** (Transparency, Consent and Control) is the macOS subsystem that records which app may use the microphone, Accessibility, Calendars and so on. It identifies an app by its code signature. An **ad-hoc** signature carries no identity, so TCC falls back to the binary's **cdhash** (content hash), which changes on every build. A real signing certificate gives a stable **designated requirement** (bundle identifier plus certificate). The **hardened runtime** is a signing option that restricts what a process may do unless it carries **entitlements**: signed key/value claims such as `com.apple.security.device.audio-input`.

**Built and fixed, in order:**

1. **`f8ac320`.** Duplicate "Orion" rows in Accessibility, and push-to-talk dying after each rebuild. Cause: ad-hoc signing, so cdhash identity, so "each build is a new app". Fix: `scripts/orion-sign-setup` creates a self-signed identity once.
2. **`08923f5`.** Nick: *"every time orion opens it prompts me to give it accessibility perms when i already have."* `orion-setup` rebuilt unconditionally on every launch, so it reset its own permission every time. It now skips the build when sources have not changed.
3. **`dfc403d`.** But skipping builds meant a newly created certificate never took effect, so setup now also rebuilds when an identity exists and the bundle is still ad-hoc. Adds `scripts/orion-mic-doctor`.
4. **`f018255` "Stop creating untrusted certificates".** `security find-identity` showed *"7 identities found — every one CSSMERR_TP_NOT_TRUSTED"*. The scripted import cannot mark a certificate trusted, so every setup run created another useless one. Setup no longer creates certificates. It explains the single manual trust step instead, and `make_app_bundle.sh` signs by SHA-1 hash, because duplicate names made `-s <name>` ambiguous.
5. **`2d33c21`.** The Microphone pane has no remove button, so a launcher wraps `tccutil reset`, scoped to Orion's bundle id.
6. **`3c60325`.** A new app log (`OrionLog.swift`) answered in one line what had been "inferred all night": *never-asked → DENIED inside one second, no prompt.* macOS refuses a mic request from an app with no UI context, and Orion is `LSUIElement` with a non-activating panel. The fix: `NSApp.activate` before asking.
7. **`c2c4347` "the hardened runtime was denying the mic".** *"I broke this."* The switch to the stable identity had also added `--options runtime`, and under the hardened runtime the Info.plist usage string is not enough. The binary needs `com.apple.security.device.audio-input`. *"Every tccutil reset was correct and immediately re-denied for this reason."* A side note in the same commit: an XML comment cannot contain `--`, and the first entitlements file was unparseable because its comment quoted the flag.
8. **`51518c4`, `a187595`, `d1955f1`.** The mic was granted but nothing was heard. Instrumentation showed audio level 0.456 and the Deepgram socket open, yet zero transcripts. Cause 1: `converter?.data(from:)`. The failable converter was optional-chained, so a nil converter silently dropped every buffer. Cause 2: the converter's input block returned `.endOfStream` after the first buffer, which retired it; `.noDataNow` is the correct status. Meanwhile the ear was switched to Apple on-device recognition.

The entitlement trap recurs three more times: calendars (`a79bb89`), contacts (`5444062`), camera (`d623dab`). The entitlements file at the snapshot still tells the story in four numbered comments:

```xml
<!-- native/Orion/Resources/Orion.entitlements:5-17 -->
  <!--
    Required because the bundle is signed with the hardened runtime.

    Under the hardened runtime an Info.plist usage string is NOT enough: the
    binary must also be entitled to reach the device, or macOS denies the
    request outright. No prompt appears, no TCC row is created, and
    AVCaptureDevice.authorizationStatus reports .denied for a permission the
    user was never asked about. That is exactly what happened here, and it
    began the moment the hardened runtime was switched on alongside the new
    signing identity.
  -->
	<key>com.apple.security.device.audio-input</key>
	<true/>
```

**Lessons.**

- **Signing identity is permission identity.** This becomes "The one invariant" in `AGENTS.md` by 2026-08-20: *"The app's code-signing identity must never change."* `make_app_bundle.sh` now hard-fails rather than falling back to ad-hoc; only a typed `--allow-adhoc` produces an unsigned build (`native/Orion/make_app_bundle.sh:10`).
- **Instrument the app before theorising from outside.** "The app knew the answer the whole time and had no way to say it" (`3c60325`).
- **Busywork that looks like progress is worse than nothing** (the seven dead certificates, `f018255`).

### 3c. Trust: the regression, the side door, and "you are allowed to be vague" (807ee86, c17689d, b95df55, 0d3fd57, ef324db, 7f281f1)

This thread is the origin of ORION's trust model. Study it closely.

**Step 1: hardening (807ee86, plugin 0.7.0).** Before this, `trusted_user` was a tag *the model supplied* inside the TaskGraph. So "a malicious instruction inside a file Orion read… could get the model to stamp `trusted_user` on an action you never asked for" (`807ee86:planning/ORION_SESSION_2026-07-30_VOICE_UI_TRUST.md` §3). 0.7.0 rebuilt model inputs as untrusted and minted trust only from harness provenance hooks, failing closed.

**Step 2: the side door (c17689d, 19:08).** A probe found Orion's real tool list was `exec, tool_call, tool_describe, tool_search`, and watched it *create a Desktop folder while the orion-control ledger stayed completely empty*. OpenClaw's `tools.profile "coding"` grants `group:runtime` (exec, process, code_execution) and `group:fs` (read, write, edit, apply_patch). Both were denied in `~/.openclaw/openclaw.json`, which is live config outside the repo, backed up to `openclaw.json.bak.pre-toolgate`. That left `orion_task_run` as the only route to the filesystem. The commit message: *"The gate was not bypassed so much as unused, because a shortcut was sitting right there. AGENTS.md and TOOLS.md both told Orion it had no shell; it had one, so it believed the tools and not the docs."* `scripts/orion-verify-gate` checks the thing that matters: "not whether the folder appeared, but whether the ledger grew."

**Step 3: the regression (b95df55).** After 0.7.0, every gated action failed with `no_authenticated_user_turn`. Measured live: `channelMessageHookFired: false, promptHookFired: false, toolCallHookFired: true, retainedTurns: 0`. The hooks that carry *user text* do not fire for locally initiated runs (`message_received` is a channel event). So the fail-closed check had no input and rejected everything. `planning/TRUST_REGRESSION.md` records "both fix options": a third provenance source, or a temporary revert to the model-supplied tag. The revert was *not* taken.

**Step 4: the fix (0d3fd57, plugin 0.8.0).** `src/transcript.ts` reads the session JSONL that the *host* writes. That file still exists:

```ts
// plugin/orion-control/src/transcript.ts:21-30
 * OpenClaw writes every turn to `~/.openclaw/agents/<agent>/sessions/<id>.jsonl`
 * as newline-delimited JSON:
 *
 *     {"type":"message","id":"…","timestamp":"…",
 *      "message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 *
 * The security property that makes this a legitimate source: **the model cannot
 * author a `role: "user"` entry.** It emits assistant messages and tool calls;
 * the host writes the user turns. So a `user` entry is evidence of a real
 * instruction in exactly the way a model-supplied `trusted_user` tag never was.
```

and it ignores tool-result blocks inside a user turn:

```ts
// plugin/orion-control/src/transcript.ts:106-111
        const block = part as Record<string, unknown>;
        // Only plain text. A tool_result block is model-influenced data, not
        // the user speaking, and must never be read as an instruction.
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
```

The same commit fixed a second rejection, `direct_user_authorization_required`. That check required `content.includes(relativePath)` plus the catalog's own verb, so "make a folder called awesome" failed because the catalog says "create". 0.8.0 instead required every path *segment* to appear in the user's words, with verb synonyms.

**Step 5: the poisoned session (ef324db).** After the fix, Orion *still* said the tool was broken, "with no error object and no tool call." The session had 56 messages, most of them real failures, and the model had learned from them: *"ordinary in-context learning working correctly."* `scripts/orion-reset-session` archives a poisoned transcript. Its first version archived only the `.trajectory.jsonl` file and "reported success and changed nothing". After the reset: `folder: YES … ledger: 17 -> 18`. Lesson: *"when a capability is restored, any session that watched it fail may need retiring too."*

**Step 6: "you are allowed to be vague" (7f281f1, plugin 0.9.0).** "make a text file of some sort" was refused with "I need you to explicitly name the file". The commit's verdict: *"That is not a security boundary, it is a spelling test, and it was my design error."* The new `instructionAuthorizesTarget` authorises by scope: you named the target, or its containing folder, or you asked generically and it lands in an approved root. The key argument: *"Specificity was never what stopped an injected instruction — injected text is not in your turn at all, which is the boundary doing the work."*

**What happened to all this later.** Four days later the whole wording-match machinery was deleted (`399c036`, 2026-08-04): `instructionAuthorizesTarget` and `directUserAuthorizationRequired` went to zero references, and the validator shrank from 679 lines (at `0e5ef84`) to 528. It was replaced by a *data* taint check, `target_from_untrusted_content`, which is still in the current validator at `plugin/orion-control/src/validator.ts:686`. `docs/GAME_PLAN.md` §1.3 explains why: deleting the wording check first opened a real hole ("`exfil.txt` written. Status: succeeded."). Provenance proves a real user turn *exists*, not that a step came from it. So the boundary was re-bound on data: a write target that appears in untrusted content and nowhere in Nick's own turns is refused.

**Lessons.**

1. **Trust must come from something the model cannot write.** That is host-written transcript turns, not model-supplied flags.
2. **A gate is only as good as its exclusivity.** An unused gate next to an open side door enforces nothing. The test is "did the ledger grow?"
3. **Fail-closed checks need a real input channel, or they become a denial of service.**
4. **Usability bugs dressed as security** ("a usability bug wearing a security costume", `0d3fd57`) erode trust in the gate and push people to bypass it.
5. **Agent sessions remember failures.** Reset them after fixes.

### 3d. Keys and the cloud voice (14cf030, 74d2c5c, 95a9cac, 0fe5762, b0b21be, e43537b, 51070fb, 401dbe9)

**Built.** `scripts/orion-keys`: it checks each key against the vendor, takes replacements with hidden input, verifies them *before* saving, and replaces every existing line for a variable instead of appending a second one. Launchers moved into version control (`launchers/*.command`).

**Steps back.**

- `ELEVENLABS_API_KEY` held 40 characters. An ElevenLabs key is about 51, and "the Deepgram key sitting next to it is exactly 40" (`14cf030`).
- **`95a9cac` "Test the endpoint Orion actually uses, not a convenient one".** The check hit `/v1/user`, which needs a "User: Read" scope a TTS-only key can lack. It "produced confident wrong answers" for hours. It now synthesises two characters against the real TTS endpoint (`93e9a42:scripts/orion-keys:71`).
- **`0fe5762`.** Once the real endpoint was tested, a 402 (billing) appeared. Nick found it "by pushing back on my diagnosis".
- **`b0b21be`.** "SUPER choppy" cloud voice. Every engine was chunked into 90/240-character pieces with 60 ms of stapled silence, which is right for local MLX and wrong for an engine that already streams. Engines now declare `streams_natively`. The same commit found that `_env()` ignored every `ORION_*` setting in `.env`.
- **`51070fb`.** The voice picker failed because zsh globbed an unquoted `?` in a URL. Its fallback then needed a `voices_read` scope the key lacked. It was rewritten "at a third the size" around pasting a voice id: *"I had patched the old one three times… that is the signal to rewrite rather than patch again."*
- **`401dbe9`.** The test suite broke the moment a real `ORION_ELEVEN_MODEL` landed in `.env`: *"A unit test that reads the developer's live configuration is not testing anything."*

**Lesson.** *"A health check that tests something adjacent to the real thing is worse than no health check"* (`95a9cac`). This is the ancestor of the 2026-10-12 memory rule "No live switch without a real-route test".

### 3e. Summary of Era 3

| Problem | Visible symptom | Real cause | Commit |
|---|---|---|---|
| Warm TTS never warm | Slow voice | Wrong Python, no `mlx_audio` | `f8ac320` |
| Daemon "running" | System voice | Stale socket file | `dff87ea` |
| Warm engine unused | 3.2 s to first audio | MLX thread-local streams | `73aa6a4` |
| launchd crash-loop | Many restarts/sec | Desktop is TCC-protected | `1d82682` |
| Accessibility resets | Prompt every launch | Ad-hoc cdhash identity + unconditional rebuild | `08923f5` |
| No valid identity | Signing silently ad-hoc | 7 untrusted certs | `f018255` |
| Mic denied, no prompt | Instant `.denied` | Hardened runtime, missing entitlement | `c2c4347` |
| Deepgram silent | Open socket, no text | Optional-chained converter; `.endOfStream` | `a187595`, `d1955f1` |
| Every action refused | `no_authenticated_user_turn` | Hooks never fire for local runs | `0d3fd57` |
| Gate bypassed | Empty ledger | Shell and fs tool groups enabled | `c17689d` |
| "Tool is broken" after fix | No tool call at all | Poisoned 56-message session | `ef324db` |
| Reply parser empty | "nothing this app could read" | Reply under `result.payloads` | `8f1f4e5` |
| Music sounds worse with Orion open | Low-quality audio | `AVAudioEngine` kept the device | `8f1f4e5` |

---

## Era 4 — More powers, a toolbox, and the permissions reversal (2026-07-30 → 08-05)

### What was built

- **`0e5ef84` plugin 0.10.0.** 19 new actions in four tiers:
  - `browser_control`: http/https only. `javascript:`, `data:`, `file:` and URLs with embedded credentials are refused.
  - `media_control`: volume clamped to 0–100.
  - `home_read`: dotfiles, keychains, `.env` and escaping symlinks are refused.
  - `file_mutate`: delete moves to `~/.Trash` and never unlinks, and the ledger records the inverse operation.

  The tier **shipped disabled**: "a capability that deletes should still be a deliberate switch rather than something that arrived while he read a summary." The type system enforced the write scope: `MutableRoot` versus `ControlledRoot`, "kept the parameter narrow rather than widening the type." The commit is honest about its limits: *"UNVERIFIED: no AppleScript has been executed."*
- **`588f6a1` "Generate the tool description from the catalog".** Orion told Nick "I don't have a browser tool" while holding 19 new actions, because the tool description was a hardcoded string. `CATALOG_SUMMARY` is now generated from `ACTION_CATALOG` at module load. **Lesson: a hand-written self-description will drift, and the model believes the description over reality.** The same idea later produces `orion-selfdoc`, which generates `TOOLS.md`.
- **`154c3fb`, `3a87a71`, `08cfaa8`** (2026-08-04). "Five days of operational glue that had never been committed": `orion-daily` (a daily summariser run by launchd), `orion-enroll-voice` + `orion_voiceid_daemon.py` (speaker verification), Gmail and Discord notification scripts, and `orion-selfdoc`. `3a87a71` added the app's new surfaces (dashboard, home launcher, quick-open, the black-hole hologram, audio ducking, reminders, `SpeakerVerifier`). It also fixed two timing bugs: endpointing was a hardcoded 300 ms that "clipped constantly" (now 900 ms and tunable through `VoiceTuning`), and the speaking phase could never end when audio completion callbacks went missing, so a watchdog now ends it.
- **`399c036` plugin 0.11.0.** "Stop his own audit trail from locking him out of his own files." Every `orion_task_run` result was recorded as untrusted comparison data, and it names every path the run touched. So a file Orion created "poisoned itself for the rest of the session." The fix is *not* to trust run results. It is a session-scoped registry of artifacts Orion authored *through a step that already passed the full gate*, matched on path suffix. Also new: the `self_tuning` tier (`voice_tuning_read/set`, a closed key list, range-checked, off by default), and the removal of the wording-match machinery (see 3c).
- **`f09edfd` plugin 0.12.0** — the **workshop**. "Let him make it live after I review it." A composed tool is *not code*: it is a named recipe over existing catalog actions, expanded into a normal TaskGraph and run through `runAuthorizedGraph`. So "an approved tool can never do more than Orion could already do." Approval binds to a SHA-256 of the exact bytes reviewed (`plugin/orion-control/src/workshop.ts:33-34,89`), computed identically by the Python reviewer (`scripts/orion-tools`) and the TS loader. Tools: `orion_tool_propose`, `orion_tool_list`, `orion_tool_run`.
- **`e575cce`** "The gateway never restarted for a new plugin build: etimes is not a BSD keyword." `ps -o etimes=` is GNU-only. BSD `ps` printed its whole keyword list instead, which was interpolated into Python, caused a `SyntaxError`, and was read as "already current". *"The error was visible in last-setup.log the whole time, one line above an 'ok'."*

### The GAME_PLAN and the permissions reversal (ea2fffe, 2026-08-04)

`docs/GAME_PLAN.md` (374 lines, committed in `ea2fffe`) is the most important document of this era. It reframed the target as "Codex / Claude Code levels of functionality" and argued that the ceiling was *architecture*, not permissions:

> 43 hand-declared actions, each with typed arguments, a capability tier, a verifier and a matcher. No shell and no file tools — `openclaw.json` denied `group:fs` and `group:runtime` outright. And no loop… (`docs/GAME_PLAN.md:21-24`)

Its "Batch 1 — Hands" **reversed `c17689d` from five days earlier**:

- `tools.deny` emptied. File tools, shell and the agentic loop were turned on, with shell gated by OpenClaw's `exec-approvals.json` set to `{ "security": "allowlist", "ask": "on-miss", "askFallback": "deny" }`. About 36 read-only commands are allowlisted and **no interpreters** (`python`, `node`, `bash -c`), since allowlisting one "is `security: "full"` with extra steps."
- Profile raised to `consequential_local`, `enableFileMutateActions` on, home writable, approval dropped from reversible writes.
- A new one-sentence safety model: **"Block what cannot be undone. Log everything else."** (`docs/GAME_PLAN.md:135`)

The document is candid about its own wrong turns. Opening the shell was "held back first on the grounds that `rm` bypasses the Trash-and-ledger property… The first half was true. The second half was not: I searched briefly, hit minified bundle code, gave up, and wrote the giving-up into this document as a principle." It also corrects itself on the wording check (the `exfil.txt` hole).

`ORION_PERMISSION_ELEVATION.md` (same commit) answered "every turn I take there's a new permission error". Most of it was the taint bug fixed in 0.11.0, not policy. It argued *against* a spoken password ("voice is not authentication") and for standing grants plus plan-scoped approval.

**How the reversal turned out.** `CLAUDE.md` at the snapshot sums it up: *"`docs/GAME_PLAN.md` — the July plan. Its permission half shipped; its architecture half did not. Read it so the reversal is not re-derived a third time."* Evidence in range:

- On 2026-08-09, the audit found that the `coding` tools profile "strips `file_write`". With `ask: on-miss` and no approver connected, an allowlist miss *waited* 240 s and killed the turn. The fix was `ask: off` ("200s+ hang → 8s"), plus narrow allowlisted wrappers (`orion-remember`, `orion-recall`, `orion-calendar`) (`docs/planning/ORION_AUDIT_2026-08-08.md`, addendum).
- `d9cf665` (2026-08-11): the twelve `orion-*` wrappers "exist because the coding tools profile removes file_write and a non-allowlisted command used to hang the session outright, so the capabilities Orion needs most could not be catalog actions."

So the "general shell plus loop" architecture was replaced in practice by **typed catalog actions plus fixed-argv allowlisted wrappers**. **(inferred from these two sources; the openclaw.json changes themselves are live config and not in git)**

### Lessons

1. **Generated self-knowledge beats hand-written self-knowledge** (`588f6a1`).
2. **Composition over code for agent-authored capability.** A recipe over vetted actions can be safely "live on approval"; arbitrary code cannot (`f09edfd`).
3. **Approvals bind to bytes**, not to names.
4. **Portable shell is a trap on macOS** (BSD `ps`, zsh globbing, `log` as a shell builtin, later). Test on the real shell.

---
## Era 5 — The dashboard and the connectors (2026-08-05 → 08-08)

The center of gravity moved from "can Orion act safely" to "can the app show Nick his life." These commits are mostly Swift in `native/Orion/Sources/Orion/`. Many were written blind ("Not compiled here — still no Swift toolchain in this sandbox", `4fb9ba1`) until the authorship switch on 2026-08-07.

### What was built

| Commit | Date | What |
|---|---|---|
| `57572be` | 08-05 | `OrionUI.swift`, a visual language: rule-prefixed section labels, "one number per idea", ring/zone meters, monospaced digits ("a dashboard whose numbers jitter reads as unstable"). Home deliberately untouched |
| `a79bb89` | 08-05 | **Tasks moved into Apple Reminders**, a list called "Orion", "so a task can actually interrupt you." Orion "no longer owns the tasks. It owns a view of them." A dated task always gets an `EKAlarm`, since a due date alone does not notify |
| `4fb9ba1` | 08-05 | **Connectors.** Calendar via EventKit, *read-only "structurally, not by policy"*. Secrets moved to the **Keychain** (`WhenUnlockedThisDeviceOnly`). Connection state is derived on read, never stored. OAuth through `ASWebAuthenticationSession` with PKCE and `state` checking. Whoop is the first client |
| `865f446` | 08-05 | Instagram had been coded against Basic Display, which Meta shut down on 2024-12-04; replaced. Plaid's Connect button "could only ever fail", so `notBuilt` became an honest state |
| `0b2049b` | 08-06 | Health: a real supplement list, workouts as sets (weight × reps), a `health_tracking` plugin tier (`supplement_take`, `workout_log`…) writing the same JSON file the app reads. **Plaid built** with Hosted Link and polling, Sandbox by default |
| `6b8cd3b` | 08-06 | Whoop daily re-login: `offline` scope was sent on refresh but never on authorize, so no refresh token was ever issued. Whoop v1 API → v2 |
| `4c3bee9` | 08-07 | **OrionDay**: "a day that starts when you wake up", the later of Whoop's wake time and a 4 am floor (`native/Orion/Sources/Orion/OrionDay.swift:19-33`). Morning brief. Narratives from a local model straight to Ollama (`/api/generate`), *not* through the agent |
| `bf88e0f`, `5380480`, `69dd877` | 08-07 | Token budgets for reasoning models (200 → 900 → 1600). llama3.2:3b replaced by gpt-oss:20b for narratives. Takeaway rail with forgiving parsing |
| `8ea60a6`, `f33aaf5`, `559e2cf`, `729dc29`, `30a3d9a` | 08-07 | Plaid: public token nested in `results.item_add_results[]`; Sandbox/Production switch; keys editable after saving; multiple banks (one access token per Item); signed net worth; recurring-charge detection; Finances retries and states why it is empty |
| `04676fd`, `cc7a8e3`, `f251464` | 08-07 | Tasks + the day timeline + week strip. Calendar *writing* (first only Orion-created events, then any event via a user-opened sheet). Calendar diagnostics |
| `5444062`, `53abaf5` | 08-08 | **iMessage reading** (from `chat.db`, which needs Full Disk Access), Contacts, and a permissions audit listing all seven permissions with "what breaks without each". Then a crash fix |

> **Jargon: EventKit, PKCE, Keychain, Plaid Hosted Link, Whoop.** EventKit is Apple's calendar/reminders framework. PKCE (Proof Key for Code Exchange) is an OAuth extension that stops a stolen authorization code from being redeemed. The Keychain is macOS's encrypted secret store. Plaid is a bank-data aggregator; its "Hosted Link" is a Plaid-hosted web page that links a bank, after which the app polls `/link/token/get` and exchanges a public token at `/item/public_token/exchange` (`93e9a42:native/Orion/Sources/Orion/PlaidClient.swift:257,351`). Whoop is a fitness wearable with an OAuth API at `api.prod.whoop.com/developer/v2` (`93e9a42:native/Orion/Sources/Orion/WhoopClient.swift:94`).

### Design choices worth studying

- **Shared store over a third copy.** Reminders became "the shared source of truth between them rather than a third store to keep in sync," because the `apple-reminders` skill already let the agent reach the same list by voice (`a79bb89`). The 08-08 audit later found this only half-done: the agent's `timer_set`/`reminder_list` still wrote a private `reminders.json` (`docs/planning/ORION_AUDIT_2026-08-08.md`, DUPLICATED §2).
- **Derived state over stored flags** (`4fb9ba1`). "A stored flag is how a dashboard ends up cheerfully reporting a connection that died last Tuesday." The same principle reappears on 08-11 as "Nothing derived is stored."
- **Calendar authority widened in steps, each one deliberate.** `4fb9ba1` made it read-only by construction. `04676fd` let it create events and change only its own, tracked in `orion-created-events.json`. `f251464` allowed editing any event from a sheet *the user opened*, with a double confirm on delete and `.thisEvent` for recurring events. `fd343df` (08-11) added bridge delete, by identifier only ("a fuzzy delete against a real calendar… is a bad trade at any convenience").
- **The local model as a writer, not an agent** (`4c3bee9`). Measured: `openclaw agent --model ollama/llama3.2:3b` took 44 s and "stopped on a tool call", because the agent hands a 3B model the whole toolset. Direct Ollama took 1.1 s. Facts render with or without the model.
- **A narrative that contradicts the numbers is worse than none.** llama3.2:3b, given strain 8.4 against a band of 14–18, wrote "you may be pushing yourself too hard", the inverse of what the number says. It was replaced by gpt-oss:20b (`5380480`). Prompts then got hard rules. They are still in the code as of 08-20:

```swift
// 93e9a42:native/Orion/Sources/Orion/MorningBrief.swift:126-141 (prompt text, abridged)
You are Orion, writing Nick's daily brief. Here are today's facts:
…
Write 2 to 3 sentences addressed to him, as one paragraph.
Rules:
- Tie the recovery to what is actually on his calendar today.
- If anything is overdue, name it.
- Never state a number that is not in the facts above.
- If a fact says something is not connected, say you cannot see it. \
Never turn "not connected" into "nothing scheduled" or "nothing due".
- No greeting, no lists, no headings, no sign-off.
- No generic wellness advice. …
```

### Steps back

- **Transparency took four attempts.**
  1. `6b8cd3b` restored alpha and `.ultraThinMaterial`.
  2. `91f4b89`: "`.ultraThinMaterial` cannot see the desktop", so `NSVisualEffectView` with `.behindWindow`; the tint had also been layered *under* the blur.
  3. `88fced5`: "The thing painting over the glass was the ScrollView", fixed with `.scrollContentBackground(.hidden)`.
  4. `9f64722`: that modifier "is a List and Form modifier and not a ScrollView one on macOS — it compiled, read as correct, and changed nothing." The real fix was to switch off `NSScrollView`, `NSClipView` and `NSHostingView` backgrounds, use real alpha with an off-by-default frost toggle, and remove all card boxes.

  `88fced5` says it best: *"I should have looked for what was on top before changing what was underneath. Twice."*
- **Blind Swift was costly.** `2f6bc6e`, `57572be`, `4fb9ba1`, `0b2049b` and others were written without a compiler. The 08-07 authorship switch coincides with commits that build and run. **(inferred)**
- **APIs had moved on.** Instagram Basic Display was dead; Whoop v1 was dead; Plaid nests `public_token` differently from what was assumed; TikTok wants `client_key` not `client_id` (`9f64722`).
- **"LIVE" that lied.** The Brand tab showed a green LIVE for TikTok/Instagram/YouTube tokens that nothing ever read (`9f64722`). The catalog now records which connectors are actually read.
- **A shallow copy bug.** `{ ...EMPTY }` shared one supplements array across every "fresh" health log (`0b2049b`).
- **Type mismatch across a process boundary.** `WorkoutSession.startedAt: Date` failed to decode the plugin's ISO string. "Every field across the boundary is a plain string or number" now (`0b2049b`).
- **Uncatchable crash.** Reading an unfetched `CNContact` key raises an Objective-C `NSException`, which Swift `do/catch` cannot catch, so the app aborted seconds after launch (`53abaf5`). This crash later justified the forge's LAUNCH gate.
- **`DashboardView.swift` grew to about 1,400 lines** holding six tabs and dead layouts. It was split into one file per tab in `9f64722`.

### Lessons

1. **Silent empties are the worst bugs.** "An empty day, a missing account, a denied permission and a calendar Orion simply cannot see all rendered identically" (`cc7a8e3`). Every data surface got an explicit reason line.
2. **Look at the top layer first** when something is invisible (transparency).
3. **Verify vendor API assumptions against current docs**, not memory.
4. **Missing is not zero, and not-connected is not empty.** These are first stated in the brief prompt and made structural on 08-11 (`cefd605`, `694b762`).

---

## Era 6 — Orion edits himself (2026-08-08)

### What was built

Ten commits between 11:50 and 12:32 on 2026-08-08, all under Nick's identity:

- `c97955c` "wip: forge script", `50d02a9`, `dd0d583`: `scripts/orion-forge` and small zsh fixes (`status` is a read-only variable in zsh).
- `96fe6f8` "feat: orion-forge + self_modify action": a new catalog action with `execution: { kind: "self_modify" }` (`93e9a42:openclaw-plugins/orion-control/src/catalog.ts:1286`).
- `57407ee` "forge edit mode": `scripts/orion_forge_edit.py`, find/replace instead of whole-file writes.
- `5f190a5` "feat: Orion can rewrite his own UI, with the build and the launch as gates": the design commit.
- `7ce12ff` "Orion can list and read his own source": a read-tier action, because a find/replace needs the exact current text.
- `164d486` "the tier was never enabled, and three verifications had no verifier": adds the `enableSelfModificationActions` config flag. Reaching the tier needs *both* the flag and the profile.
- Forge test edits: `86908db` (a doc comment), `0ddadbc` (reword the composer placeholder), `b09ea48` (restore it), and finally **`3fdf5de` "Orion changed his own code"**. Each says "Applied by orion-forge. Previous: <hash>".

### How the forge works

The script's header states the design (still at `scripts/orion-forge:11-23`):

```zsh
# scripts/orion-forge:11-23 (abridged)
# THREE GATES, and none of them ask a human anything:
#   1. PATH. Only .swift inside the app target. ... Orion cannot edit the thing that constrains him.
#   2. BUILD. It must compile. A change that does not is reverted and never installed.
#   3. LAUNCH. It must still start. This is the gate that matters most ...
#      an unfetched Contacts key did exactly that, and without this
#      the result is a dead app and no UI left to fix it from. The previous ... is restored.
# Every applied change is a git commit, so "revert it" is one command.
```

The previous bundle is kept at `~/.openclaw/orion-controlled/Orion-previous.app` (`5f190a5:scripts/orion-forge:35`). Each attempt is appended to `~/.openclaw/orion-controlled/forge-ledger.jsonl` (`86908db`). All three gates were "tested for real rather than reasoned about": non-compiling source was reverted and nothing installed; a `fatalError` on launch was installed, the crash detected, and the previous app restored and relaunched.

**What Orion actually changed.** In `3fdf5de` the change was one line of `HomeTab.swift`: the composer placeholder went from `"Ask Orion anything…"` to `"What do you need?"`. It is small, which is the point: a reviewable, revertible, gated first self-edit.

### Steps back and costs

- **The first end-to-end attempt "burned six and a half minutes and never produced a call"** because whole-file contents are "the wrong shape for a small model". It became find/replace that refuses a non-unique find string (`5f190a5`).
- **Approval is off "by Nick's explicit choice"** (`5f190a5`). The commit defends it: "the verifier is mechanical and cannot be talked round, and every applied change is a git commit." The 08-08 audit found the tier was still refused at the profile (`capability_disabled`), "one flag away" (`docs/planning/ORION_AUDIT_2026-08-08.md`, PARTIALLY WORKING).
- **Scope grew later.** By 2026-08-13 "Self-repair beyond Swift" was deployed, covering config, scripts and plugin surfaces, with `enableSelfPluginActions` ON, which "lets Orion edit the source of the plugin that defines what he may do". That contradicts the PATH gate's original promise ("Not the plugin, not the gate"). It was flagged as an open risk needing "sandboxing before trusting plugin self-edit" (`93e9a42:HANDOFF.md`, "Open — needs Nick" item 3 and "Open — engineering" item 2). **This is the most significant safety drift in the range.**
- **Self-modification also wrote git commits under Nick's name** into the same history. That is why several commits in the appendix are one-line UI changes.

### Lessons

1. **Mechanical gates (path, build, launch) can stand in for a human reviewer only for a narrow surface.** Widening the surface reopens the question.
2. **A launch gate is essential.** Compiling is not running (the Contacts crash).
3. **Give small models diff-shaped tools**, not file-shaped ones.

---

## Era 7 — The audit, and the baseline commits (2026-08-08 → 08-11)

### The 2026-08-08 audit

`docs/planning/ORION_AUDIT_2026-08-08.md` (committed later in `7d0a7b8`) is "Phase 0 of the refinement plan". It was checked "against the running system, not inferred from the planning docs." This is a third use of the word "phase", unrelated to both the July roadmap and the v2 manifest. Headline:

> **Orion's memory had been dead for weeks and nothing reported it.** … `memorySearch` was never configured, so it defaulted to OpenAI embeddings. That account has no credits. … `openclaw memory search` answers `No matches.` rather than an error. (`docs/planning/ORION_AUDIT_2026-08-08.md:41-55`)

Other findings:

- `orion-daily` overwrote the memory file that "remember this" also wrote to.
- Dates computed in UTC (fixed in `71d4581`).
- `MEMORY.md` had never existed.
- Daily memory files were tool telemetry, not what Nick said.
- No chat channel; no cron jobs, so "every proactive behaviour … had never run once".
- `AGENTS.md` contradicted itself.
- **The health log had two unlocked writers.**
- Two non-communicating reminder systems.

The **overnight addendum (08-09)**:

- Orion could not save a memory at all, because the `coding` profile strips `file_write`. His `cat >> … <<EOF` attempt hung the session for 240 s.
- With `ask: on-miss` and no approver, an allowlist miss *waited*. Fixed with `ask: off` (200 s+ → 8 s).
- Orion "confabulated from his own plumbing", answering a codename question with his session id.
- `orion-remember` and `orion-recall` were added. Four clean end-to-end live runs.
- `orion-bench --live` "scrubs its own fixtures", after an earlier version polluted memory so that "a test [was] polluting its own input."
- `orion-trace` cut a calendar turn from 121,520 tokens with no answer to 16,310 tokens and a precise question.

**A reversal recorded here.** The audit recommended *"drop Obsidian from the plan rather than wire it up."* That was reversed within four days: on 2026-08-12 `~/Documents/orionBrain` was indexed beside workspace memory (`93e9a42:openclaw-workspace/MEMORY.md`, entry 2026-08-12), and on 2026-08-20 the vault was folded into the repo as `brain/` (`1efd37c`).

### The eight baseline commits (2026-08-11 02:47)

Before the focus-session build, Gate 0 required that "36 uncommitted files [be] preserved in 8 themed commits, tagged `baseline/pre-focus-2026-08-11`" (`4937b72:planning/HANDOFF.md` §3). The annotated tag `baseline/pre-focus-2026-08-11` points at `7d0a7b8`. The eight commits share one timestamp:

- `b35a731`: the health-log lost-update fix. `FileLock.swift` plus a node helper, with the state re-read *inside* the lock. "Measured: 1965 of 5725 updates lost unlocked, zero lost with the lock." The lock protocol is a cross-language contract (`native/Orion/Sources/SessionService/FileLock.swift:36-50`):

```swift
// native/Orion/Sources/SessionService/FileLock.swift:39-49
   • the lockfile is `<path>.lock`, created with O_CREAT|O_EXCL — the atomic
     "create only if absent" that makes this a lock at all;
   • a lock older than 15s is assumed to belong to a process that was killed
     mid-write, and is broken. A crashed helper must never be able to lock Nick
     out of his own supplements permanently;
   • waiting gives up after ~6s.

 Those three numbers, and the lockfile NAME, are load-bearing across the two
 languages. A Swift lock at `<path>.lock` and a node lock at `<path>.lockfile`
 would both "work" and would exclude nothing.
```

- `cefd605`: narratives keyed by *facts* (`NarrativeKey`), not by day. This was why "an 81% sleep score ended up printed beside a 27% tile". `BriefFacts` gained `calendarConnected`/`tasksConnected`.
- `27b0a7e`: a nested same-axis ScrollView that "was a tall picture of a scroll view". And the timeline that started at 6 am drew a 2 am event *on top of the 6 AM row*: "The day was not shortened, it was falsified."
- `d692711`: layout and race harnesses that "exercise the real code" (`native/Orion/Tests/run-layout-test.sh`, `run-race-test.sh`).
- `fd343df`: calendar delete through the Mac bridge, identifier-only.
- `71d4581`: `orion-daily` used `toISOString()` (UTC), so "at 22:30 in New York it already says tomorrow"; fixed with `en-CA` local formatting, which "follows him to London".
- `d9cf665`: the twelve-wrapper toolbelt (`orion-remember`, `-recall`, `-agenda`, `-authority`, `-focus`, `-mission` (1,082 lines), `-notify`, `-standing`, `-learn`, `-remote`, `-trace`, `-bench`). `orion-selfdoc` reads the exec allowlist as a fourth source.
- `7d0a7b8`: the audit, `RISK_SWEEP.md` (589 lines), benchmark, and `learning-proposals.md`.

### Lessons

1. **Silent failure, again.** A dead memory system looked like "a bit forgetful".
2. **Check the running system, not the plan.** The audit is the template for the v2 "Phase 0 inventory" a week later.
3. **Lost updates are invisible without a race harness.** Measure them.
4. **Tests must not pollute live state** (bench fixtures; later, "Never write Nick's real `focus-history.jsonl` from a test").

---

## Era 8 — The focus-session engine, Gates 0–10 (2026-08-11)

> **Jargon: "Gate" (meaning #1).** In this era a "Gate" is a numbered step of one build plan: a focus-session engine (50/10/50/10/50 minute blocks), guided breaks, a factual calendar, and a keyboard Console. The plan lived outside the repo at `~/.claude/plans/alright-this-is-going-eager-blanket.md` (`4937b72:planning/HANDOFF.md:7-9`), and each Gate had to pass before the next. Do not confuse it with **"the gate"** (the plugin's permission path, Era 3) or with **v2 phase gates** (`PHASE_GATES.json`, Era 10).

Twenty commits from 03:03 to 13:36, on top of the eight baseline commits. Test count went 6 → 67 → 93 → 105 → 122 → 141 → 155 → 157 → 161 → 177 → 181 → 202 → 217 → 218.

| Gate | Commit(s) | Outcome |
|---|---|---|
| 0 baseline | the 8 commits above, `df20f1c`, `cad10eb` | Measured, not assumed. Found that "the orion-focus cron guard the plan says to keep … does not exist — there is no crontab at all" |
| 1 audio | `423e90e`, `df20f1c`, `6487373` | **Hypothesis refuted.** The built-in output device accepts 44.1/48/88.2/96 kHz and not 24 kHz, so nothing can pin it there. No change made. Bluetooth deferred to Gate 4 with the A2DP→HFP prediction "written down now so the eventual run confirms or kills it" |
| 2 domain | `8baac06`, `d58ee40` | `SessionDomain` as a separate SwiftPM target, so purity is a compiler constraint. Two clocks (wall for persistence, monotonic for served time). **"Nothing derived is stored."** Effects carry stable IDs and are acknowledged separately from being emitted |
| 3 service | `8d72467`, `5d23d93`, `77f8484` | Single writer (`SessionService`), locked state file, JSONL history, unix-socket IPC, `scripts/orion-session` is a client that "fails loudly" if the app is not running. SIGPIPE would have killed the app; now ignored. SIGKILL test: 17.7 s lost, inside the 30 s heartbeat promise |
| 4 clips | `b4baaa0` | Clip library + looping player. **Heartbeat on `RunLoop.main` produced zero heartbeats in a 5-minute run** → `DispatchSourceTimer`. `.completeFileProtection` made a 0600 file unreadable → removed |
| 5 enforcement | `e23fcab` | Sensors (frontmost app, idle time), Gentle/Firm modes, a six-nudge cap, and **an escape that cannot fail**. The honest claim: it "cannot see drift inside an app you allowed" |
| 6 voice | `d013d8c` | Deterministic exit policy *first*, model second; announcements through `SpeechOutput`, not `say`; `AudioCoordinator` ducks only the clip |
| 7 UI | `22941bd`, `21aa23e` | Session tab, then the break surface with "the escape trade stated out loud" |
| 8 calendar | `1412945` | Month/week/day, visible-interval fetching with real neighbouring-page padding; "Facts only, no scoring" |
| 9 Console | `2030cf4` | ⌥Tab via Carbon `RegisterEventHotKey`, which consumes the keystroke; only AUTO and NOTIFY capabilities, by *whitelist* |
| 10 extras | `694b762`, `d623dab` | Day score (60/40, missing ≠ zero, versioned), quittable apps (user-maintained list, `terminate()` never `forceTerminate()`), Do Not Disturb, Music, reverse lockdown, full-bleed break, camera presence (one frame / 90 s, discarded) |
| UI review | `81cd050` | Tabs folded to home · tasks · health · finance · brand · settings |
| handoff | `4937b72` | One handoff; 13 docs archived |

### The two safety primitives to know by heart

The escape is a pure function with nothing to wait on:

```swift
// native/Orion/Sources/SessionDomain/Enforcement.swift:347-358
    /// The local escape. Ends enforcement for this session, unconditionally.
    ///
    /// Depends on nothing that can be unavailable. That is the whole point: a
    /// user who cannot get out of enforcement because a local model is not
    /// answering is trapped by his own assistant, and no amount of good
    /// intention makes that acceptable.
    public static func release(_ state: EnforcementState) -> EnforcementState {
        var next = state
        next.released = true
        next.driftingSince = nil
        return next
    }
```

And the exit policy puts the deterministic check *before* the model's answer:

```swift
// native/Orion/Sources/SessionDomain/ExitPolicy.swift:75-100 (abridged)
    public static let attemptsBeforeRelease = 3
    public static let window: TimeInterval = 5 * 60
    ...
    /// the ordering inside: the deterministic check runs BEFORE the model's
    /// answer is consulted, so a model that is answering slowly, wrongly, or
    /// adversarially cannot prevent the hatch from opening.
    public static func decide(requests: [ExitRequest],
                              modelVerdict: ModelVerdict?,
                              now: Date) -> ExitVerdict {
        // Deterministic first. Always.
        let recent = requests.filter {
            now.timeIntervalSince($0.at) <= window && $0.modelUnreachable
        }
        if recent.count >= attemptsBeforeRelease {
            return .releasedByFallback(after: recent.count, within: window)
        }
```

### Steps back (the "found by running it, not by reading it" list)

`4937b72:planning/HANDOFF.md` §4 lists ten bugs "invisible to the compiler and to unit tests":

1. the heartbeat never fired;
2. SIGPIPE killed the app;
3. `.completeFileProtection` locked out readers;
4. the grace clock reset on every observation, so drift was never reported;
5. preflight showed misaligned name/bundle-id pairs ("Claude (com.apple.MobileSMS)"), so Nick "would have authorised apps unrelated to the names shown";
6. a completed session ended in silence;
7. a crash at minute 49 voided a 50-minute block, which forced the heartbeat design;
8. calendar padding was four days short;
9. only the "Orion" Reminders list was read;
10. `MessagesReader` was UI-only.

Smaller reversals on the same day:

- **Gate 1 held open for Bluetooth, then closed** (`df20f1c` → `6487373`): "Holding the gate open for a Bluetooth measurement was wrong… the measurement had no code to change."
- **Tabs created, then folded within hours.** Session (`22941bd`) and Calendar (`1412945`) became tabs and were folded into Home and Tasks by `81cd050`. The Messages tab went too, but "Messages loses its tab but GAINS a capability" (`scripts/orion-messages`).
- **Small break surface first, full-bleed later** (`21aa23e` → `d623dab`). The full-bleed version "had to earn it" by proving it hands focus back.
- **Reminders scope.** Writing stays scoped to the "Orion" list, reading widened to every list (`81cd050`), partially reversing `a79bb89`.
- **Gate 10 switches had "working, tested logic and NO SURFACE, which means nobody could turn any of them on"** until `81cd050` added Settings ▸ Focus.
- **Verification method itself was flaky.** A shell-launched instance has a dead main run loop, and `open -n --env` "intermittently produces" one too. So window checks moved into the layout harness against a real window server (`d623dab`).

### Lessons (the handoff's "load-bearing rules", `4937b72:planning/HANDOFF.md` §8)

1. Every external dependency needs a visible unavailable/denied/stale state.
2. Missing is not zero.
3. The model proposes; Nick authorises. The quittable-app list is written *entirely* by him.
4. The escape always works.
5. Nothing derived is stored.
6. Effects are acknowledged separately from being emitted.

Also: **"Enforcement does not run while the app is quit"** is stated as a limit, not hidden. And **the handoff is written "for somebody with no memory of this session — which is the actual test, since the next person on this is a different model."**

---
## Era 9 — The uncommitted fortnight: Sparkle, Keychain, self-repair (2026-08-12 → 08-20)

**There are no app commits between `4937b72` (08-11 13:36) and the checkpoint `93e9a42` (08-20 17:36).** The only commits in that window are Codex's v2 Phase 0 work (Era 10). Yet `93e9a42` adds 232 files and +31,617 lines. So everything below was built on disk and is known from the checkpoint and its documents: `93e9a42:HANDOFF.md`, `93e9a42:OVERNIGHT-LOG.md` (written "by Claude Code while Nick slept", 08-12 → 08-13) and `93e9a42:AGENTS.md`. Dates come from those documents. **(The work itself is not individually committed; treat the dates as self-reported.)**

### What was built (by self-reported date)

| Date | What | Source |
|---|---|---|
| 08-12/13 | Brain fallback bug: an OpenClaw update made `plugins.allow` gate provider discovery, so "Anthropic never loaded" and *every turn ran on a local model*. Fixed via `doctor --fix`. "This was the cause of the original 'errors and timeouts' complaint." | `93e9a42:HANDOFF.md`, "Wider session context" |
| 08-12/13 | Orion "dead and deaf": `applyWakeWord()` auto-disabled and *persisted* `OrionWakeWordEnabled = 0` on a transient mic failure | `93e9a42:OVERNIGHT-LOG.md:8-50` |
| 08-12/13 | Keychain reads moved off the main thread ("any rebuild used to freeze the app before it opened a window"); `StallWatchdog.swift` | same |
| 08-12/13 | Messages *send* (`scripts/orion-messages-send`); profile raised to `external_connected`. Approval→re-run fixed: "the compact call form had no field for the approval hash, so it was mechanically impossible" | same |
| 08-13 | **Self-repair beyond Swift** (`src/selfrepair.ts`, `scripts/orion-repair`): config + scripts + plugin surfaces, four gates, rollback. `enableSelfPluginActions` ON | same; Era 6 |
| 08-12/13 | Proactive delivery: cron jobs had been failing `Channel is required` "~592×/day into the void", now routed through `scripts/orion-cron-deliver` to Discord with dedup and rate limits | same |
| 08-14 | Typedstream decoder for iMessage bodies (`scripts/lib/imessage-typedstream.mjs`). Message bodies had decoded to `NSObject` because "the longest run of printable bytes" was the class name | `93e9a42:HANDOFF.md`, FIX 1 |
| 08-14 | Workspace `AGENTS.md` silently truncated at OpenClaw's 20,000-char injection limit (24,722 → 18,961 chars); `PLAYBOOK.md` split out; a 102-probe check confirms no rule lost | FIX 2 |
| 08-14 | Gmail search output shrunk (~15,000 → 1,608 chars) via shared `scripts/lib/gmail-client.mjs`/`gmail-format.mjs`; `--readonly` and `--gmail-no-send` forced inside the client | FIX 3 |
| 08-14 | Workshop tools had *never worked*: `contracts.tools` undeclared and `tools.alsoAllow` never named them | FIX 4 |
| 08-14 | Automatic episodic memory (`src/episodic.ts`): zero-model-call capture of preferences, corrections and decisions; a repeat-call guard (third identical consecutive call blocked); system prompt cut by 22.5% | "2026-08-14 full diagnostic" |
| 08-16 | Token efficiency: the app session had reached 42,923 tokens; rotated; 45-minute idle reset; local-embedding recall over past sessions; `orion-doctor` stops making a paid turn by default. Decision: "keep Haiku as the single conversational/tool orchestrator" | "2026-08-16" |
| 08-18 | **Sparkle auto-updates** (see below), version `1.2.0` in `native/Orion/VERSION`, `CFBundleVersion` = commit count | `93e9a42:AGENTS.md` |
| 08-18 | Keychain ACL discovery (see below) | same |

### Sparkle and the signing invariant

> **Jargon: Sparkle, appcast, EdDSA.** Sparkle is the standard open-source macOS auto-update framework. An app checks a feed (an **appcast**, an XML list of releases), downloads an update, verifies its **EdDSA** signature against a public key embedded in `Info.plist` (`SUPublicEDKey`), and checks that the new bundle's code signature matches the running app's.

`93e9a42:native/Orion/Package.swift` added Sparkle `from: "2.9.6"` as *the only* third-party dependency. The package comment calls it "a deliberate exception… The next one has to argue for itself." `UpdateController.swift` writes down two non-default policies (`93e9a42:native/Orion/Sources/Orion/UpdateController.swift:23-34`): **nothing on the launch path** (the check starts about 30 s after launch) and **never interrupt a focus session**, checked before the check and again before relaunch, with a six-hour postponement ceiling. `make_app_bundle.sh` embeds the framework and signs it **inside-out** (XPC services → Updater.app → Autoupdate → framework → app), because "Signing the app seals a hash of its contents, so anything signed AFTERWARDS invalidates the seal" (`93e9a42:native/Orion/make_app_bundle.sh:145-150`). It also stamps `CFBundleVersion` from `git rev-list --count HEAD` (`native/Orion/make_app_bundle.sh:69`).

The flip side: **"Do not rewrite published history — the build number would go backwards and updates would stop being offered"** (`93e9a42:AGENTS.md`, Versioning). That one sentence ties git hygiene to the updater.

**What was not done** (self-declared in `93e9a42:AGENTS.md`):

- no rollback if an update crashes on launch;
- no feed (`defaultFeedURL` is a placeholder `ORION_OWNER/ORION_REPO` that 404s);
- no release script;
- not notarized;
- the EdDSA private key "is in Nick's login Keychain and is not backed up yet."

### The Keychain does not behave like TCC

Measured 2026-08-18 and written into `93e9a42:AGENTS.md`: "TCC survives rebuilds. **Keychain ACLs do not.**" Legacy Keychain items bind to the specific binary, so every new build prompts about fifteen times. The prompt-free data-protection Keychain needs `keychain-access-groups`, and "claiming `keychain-access-groups` gets the process SIGKILLed by the kernel" without an Apple team identity. **This undercut the 08-05 decision to put every connector secret in the Keychain** (`4fb9ba1`). It is part of why the v2 secret work routes provider secrets through OpenClaw SecretRefs (Era 10), and why later work pushed toward a Developer ID. **(inferred link)**

### Steps back

- **"`log` is a shell builtin in this environment."** An assertion built on `log show` "passes vacuously", and this "led to a wrong conclusion that the Keychain problem was solved" (`93e9a42:AGENTS.md`, Traps).
- **`set -euo pipefail` + `grep`** made the ad-hoc warning path in `make_app_bundle.sh` unreachable.
- **Whoop pagination 401s on page 2**, so the client fetches two fixed windows.
- **Self-audit has blind spots.** "Orion claimed a text was sent when the task sat at `needs_approval`." That motivated a parked "twin agent" idea, with the recommendation "one boundary, many models behind it" (`93e9a42:HANDOFF.md`, "Parked idea").
- **The learning gap.** "He barely learns… `orion-remember` … fired ~once in four days." This was the motivation for the 08-14 episodic capture.

### Lessons

1. **A big uncommitted fortnight is recoverable only because the handoffs were detailed.** It is also why the 09-30 rule became "commit and push every finished piece of work" (`AGENTS.md` at the snapshot).
2. **Identity questions keep returning.** Signing → TCC → Keychain → Sparkle are one chain, and the weakest link (a self-signed certificate) sets the ceiling.
3. **Context-size limits silently drop rules** (the AGENTS.md truncation). Measure what actually reaches the model.

---

## Era 10 — ORION v2: the 85-phase manifest, Phase 0 and Phase 1 (2026-08-15 → 08-20)

> **Jargon: phases (meaning #3) and phase gates (meaning #2 of "gate").** On 2026-08-18 the project registered an external plan, "ORION v2 — Full Implementation Manifest" (2,642 lines, SHA-256 fingerprinted, kept outside the repo as `~/Desktop/Orion v two implementation plan.md`). It has **85 numbered phases, 0–84**, in ten tracks (`1d1e821:planning/v2/MANIFEST_PHASES.json`). The rule is: *"Phase N may enter only after Phase N-1 exit evidence passes."* A **phase gate** is the machine-readable record of whether a phase's requirements passed, kept in `planning/v2/PHASE_GATES.json` and checked by `scripts/orion_v2_phase_gate.py` (`5b8a2c7`). Today these files live under `docs/planning/v2/`. This is the vocabulary Nick tracks the program in to this day.

### What was built (all by Codex, in its own lane)

| Commit | Date | What |
|---|---|---|
| `c33d5bf` | 08-15 | Phase 0 baseline. `scripts/orion_v2_secret_scan.py` (dependency-free, redacting, scans the tree and full git history), an allowlist of deliberate test fixtures, and a server-lifecycle fix in `orion/server.py` (scheduler stops before SQLite closes) |
| `9248ac6` | 08-15 | `scripts/orion_v2_live_smoke.py`: one uniquely-identified request through the installed `openclaw agent` route, allowed only `system_status`, success *only after a new ledger row appears* |
| `1a9c3f9` | 08-15 | `planning/v2/CURRENT_AUTHORITY.json`: a sanitized snapshot of all 157 live capabilities (`scripts/orion_v2_authority_snapshot.py`) |
| `3843620` | 08-18 | `COLLABORATION_BOUNDARIES.md`: Codex owns `planning/v2/**`, `orion/core/**`, `scripts/orion_v2_*`, `tests/test_v2_*`; treats `native/Orion/**` and the existing plugin as read-only "while Nick may have Claude working on the native Mac UI"; `PHASE_1_PLAN.md` |
| `1515c46` | 08-18 | Source checkpoint (a branch built "through a temporary index without staging, stashing, resetting"), and a redacted secret-location inventory |
| `5b8a2c7` | 08-18 | `PHASE_GATES.json` + the gate checker. Phase 0 `blocked` on `secrets_accounted_for`; `nextPhaseAllowed: false` |
| `e2b5ae3` | 08-18 | Keychain migration prep: `OPENCLAW_SECRETREF_PLAN.json` (value-free), `orion_v2_keychain_seed.py` |
| `1d1e821` | 08-18 | Manifest registered: 85 titles, ten tracks, a traceability test "preventing omissions, gaps, or gate-status drift" |
| `a962541` | 08-18 | "harden selective credential migration" |
| `1169e5b` | 08-19 | Deferred key-migration safety; `orion_v2_anthropic_key_status.py` |

Phase 0's committed status file says plainly: *"Phase 0 is **started and intentionally not closed**… Nothing was pushed, installed, relaunched, or deployed"* and *"External CI was deliberately not enabled because uploading full repository history requires a separate, explicit decision"* (`1169e5b:planning/v2/PHASE_0_STATUS.md`). Its architecture diagram is the first official picture of the live stack. It marks the Python runtime as a **"parallel legacy path"**, and its component table says of `orion`, `main.py` and `data/orion.db`: *"Inventory and retain for regression; do not treat it as the active architecture."*

### Phase 1 and the Python question

Phase 1 ("Establish Repository and Module Boundaries") was built on 08-19/20 and committed only in `93e9a42`. It created **new Python packages**: `orion/core/` (ports, envelopes, JSON Schemas), `orion/shared/`, `orion/security/` and `orion/mac/system_status_adapter.py`. It also added a TypeScript mirror in `openclaw-plugins/orion-control/src/v2/` behind a default-off flag `enableV2SystemStatusAdapter` (`93e9a42:openclaw-plugins/orion-control/src/index.ts:331`).

The tension is resolved on paper in `93e9a42:planning/v2/PHASE_1_RUNTIME_DECISION.md`:

> The active product route is Swift Orion -> OpenClaw -> the TypeScript ORION Control validator/controller/executors. The modules directly under `orion/*.py` are a legacy compatibility runtime. ORION v2 Core must not make every live turn cross into a second Python process merely because the manifest uses the logical path `orion/core`. … The Python dataclasses are executable reference validators and compatibility fixtures, not a new production orchestrator.

So by 08-20 **the Python package had been declared "not the implementation path" three times**: in workspace memory (dated 07-28), in Phase 0's inventory (08-15/18), and in the Phase 1 runtime decision (08-19/20). Yet the manifest's Phase 0 text still told the program to "document the current Python runtime". That mismatch is what the 2026-09-01 "program correction" (`250c0ed`, out of range) tried to turn into a re-sequencing, which was withdrawn the same day. The surviving **interpretation rule** in `CLAUDE.md`/`AGENTS.md` ("interpret … against the LIVE stack … This changes how requirements are READ; it does not change their ORDER") is the end of a thread that starts in this era.

### Steps back

- **The handoff that stopped too early.** "On 2026-08-19 Codex wrote its handoff at 18:32, kept working until 18:47, and then hit zero credits — so the file listed as 'next' a slice that was already built, tested, installed, and proven live" (`93e9a42:AGENTS.md`, Relay protocol). Claude reconstructed the real state on 08-20 from `~/.codex/sessions/*/rollout-*.jsonl`, `~/.openclaw/logs/config-audit.jsonl`, the archived ledger and file mtimes. Rule: **"A handoff's date is when it was written, not when the work stopped."**
- **A bridge that could refuse what the legacy route accepted.** Codex's strict `system_status` adapter threw on an extra argument *before* the legacy call. Claude made it "an observer, never a gate": failures record `contractError` and return the legacy result (`93e9a42:planning/v2/HANDOFF.md`, "The fail-open correction"). Trap recorded: *"A default-off bridge that can throw is not default-off."*
- **Phase 1 closed with a recorded deviation.** It was closed against `PHASE_1_PLAN.md`'s five criteria, "**not** closed against the manifest's literal gate ('Existing desktop ORION must run through ORION Core') — nothing runs through Core." `PHASE_GATES.json` carries the deviation and a test keeps it there (`93e9a42:HANDOFF.md`). This is the start of the `entrySatisfied: false` / `pendingGateAmendments` machinery described in today's `AGENTS.md`.
- **A commit nobody claimed.** `93e9a42:AGENTS.md` notes "something else in this repo commits on its own schedule (a commit landed 2026-08-18 22:11 that no session here authored)". That timestamp matches `a962541` (22:11:54), a Codex v2 commit. **(inferred)** It is a small sign of two assistants with no shared channel except files.
- **A flaky Python test** (1 of 6 runs) was flagged "rather than rounding it off."

### Lessons

1. **Machine-readable gates make claims checkable**, but only for what the checker reads. The later warning that the checker ignores `REC-*` IDs starts here.
2. **Two agents need lanes and a written relay protocol.** Files are the entire channel.
3. **Additive and default-off is the safe way to introduce a new core beside a live system.** But "default-off" must include "cannot throw".
4. **Read requirements against the live stack.**

---

## Era 11 — One repo, on GitHub (2026-08-20)

| Commit | What |
|---|---|
| `93e9a42` | "checkpoint: capture outstanding local work before first push". 232 files, +31,617: the Swift sources of Era 9, `orion/{core,mac,security,shared}`, the v2 suite, `AGENTS.md`, `HANDOFF.md`, `NICK-TODO.md`, `OVERNIGHT-LOG.md`, and `openclaw-workspace/` (Orion's runtime `AGENTS.md`, `MEMORY.md`, `PLAYBOOK.md`, `SELF.md`, `SOUL.md`, `USER.md`) |
| `1efd37c` | "bring the whole Orion project into one repo": `brain/` (the Obsidian vault from `~/Documents/orionBrain`), `web/privacy/` (privacy page), `tests/workspace/`; README rewritten "to describe the whole system rather than the Phase One runtime alone" |
| `36ee439` | stop tracking `.claude/settings.local.json` (per-machine permissions) |
| `66b9e3a` | `AGENTS.md` Version control section + `.claude/skills/orion-git/SKILL.md`. **Reverses** "Do not commit or push unless asked", which "was the right rule" only while "there was nowhere to push" |
| `97523ab` | "do not hardcode the build number in the docs" — wrote '122', and the commit made it 123 |
| `16ba5e9` | "date the secret scan instead of counting commits" |

**Steps back.** The checkpoint briefly tracked `.claude/settings.local.json` (removed 18 minutes later in `36ee439`). Numbers written into docs went stale on the commit that wrote them (`97523ab`). **Lesson:** print volatile facts, do not hardcode them. And publishing history makes it immutable: CFBundleVersion depends on it.

---

## Epilogue — the empty eleven days (2026-08-21 → 08-31)

There are **zero commits** dated 2026-08-21 through 2026-08-31. The next commits, `c26272f` … `250c0ed`, are all stamped 2026-09-01 between 00:47 and 06:51. They commit, in grouped form, the v2 Phases 2–32 that were built on disk in the gap (backends, MobileCore, phase plans 2–32, the Phase 32.5 charter). `2ca9e9c` explains the dates: "this work ran 2026-08-28, the handoff was written 00:00 on the 29th, the machine rebooted at 13:22, and these commits are stamped 2026-09-01." The same commit reports an independent review of Phases 11–20: "Five of ten phases were not complete as claimed; 64 defects." That is the strongest later confirmation of Era 1's first lesson. All of this belongs to chapter `02b`.

---

## Cross-era themes and lessons

| # | Theme | First seen | Repeats |
|---|---|---|---|
| 1 | **Silent degradation is the worst failure.** Make every fallback loud and every empty state explain itself | `f8ac320`, `dff87ea`, `73aa6a4` (07-30) | Deepgram starvation `a187595`; memory dead for weeks (audit 08-08); Finances blank `30a3d9a`; brain on local model (08-12); cron "into the void" (08-13); `log` builtin (08-18) |
| 2 | **Probe the real path, not an adjacent one** | `95a9cac` (ElevenLabs `/v1/user`) | live smoke requires a ledger row (`9248ac6`); `orion-verify-gate` checks ledger growth (`c17689d`) |
| 3 | **Identity is permission.** Signing → TCC → Keychain → Sparkle | `f8ac320` | `f018255`, `c2c4347`, entitlements ×4, the Keychain ACL finding, "the one invariant" |
| 4 | **Trust comes from what the model cannot write** | `807ee86`, `0d3fd57` | taint registry `399c036`; data-bound `target_from_untrusted_content`; Console provenance typed, never inferred (`2030cf4`) |
| 5 | **Self-descriptions drift; generate them** | `588f6a1` | `orion-selfdoc`, AGENTS.md self-contradiction (audit), truncation (08-14) |
| 6 | **Model proposes, code disposes; deterministic first** | `1abb90b` handoff | ExitPolicy, escape, the forge's mechanical gates, quittable-app list by hand |
| 7 | **Missing ≠ zero; not-connected ≠ empty; derived ≠ stored** | `4fb9ba1` | `cefd605`, `d58ee40`, `694b762` |
| 8 | **Self-reports are optimistic** | Claude audit of ChatGPT handoff (`a4a4809`) | Codex handoff timing (08-19); Phase 11–20 review (09-01) |
| 9 | **Two writers corrupt quietly; one writer plus a lock** | health-log race `b35a731` | `SessionService` sole writer, IPC client "fails loudly" |
| 10 | **Reversals are fine when recorded** | adopt-vs-build (07-28) | deny→open tools; Obsidian drop→keep; commit rule; transparency ×4 |

The most consequential reversals, in one line each:

- **Build our own → adopt OpenClaw** (same day).
- **Local-first → cloud brain, local hands.**
- **Python runtime → "not the implementation path"**, kept only as reference validators.
- **Shell denied → shell opened → wrappers in practice.**
- **Wording-based authorization → data taint.**
- **No commits/pushes unless asked → push to GitHub, never rewrite history.**

---

## Walk it yourself

1. `git log --reverse --format='%h %ad %an %s' --date=short --until=2026-08-31T23:59` gives the 125 commits with authors.
2. `git show b95df55:planning/TRUST_REGRESSION.md`, then `git show 0d3fd57 -- openclaw-plugins/orion-control/src/transcript.ts | head -120` show the trust regression and its fix side by side.
3. `git show 399c036 -- openclaw-plugins/orion-control/src/validator.ts | grep -n "instructionAuthorizesTarget\|target_from_untrusted"` shows the wording check being deleted and the taint check arriving.
4. Open `native/Orion/Resources/Orion.entitlements` and read the four comments; then `git log --format='%h %ad %s' --date=short -- native/Orion/Resources/Orion.entitlements`.
5. `git show 4937b72:planning/HANDOFF.md | sed -n '/Bugs found by running/,/The UI as it stands/p'` gives the ten run-only bugs.
6. `git show 93e9a42:planning/v2/PHASE_1_RUNTIME_DECISION.md` is the formal Python decision.

## Questions to ask your tutor

1. Why did the 0.7.0 hardening reject *every* action, and why is the host-written transcript a sound source of user intent when model-supplied tags were not? What can it still not prove?
2. Trace why `c17689d` denied the shell and `docs/GAME_PLAN.md` reopened it. What evidence later showed the "hands instead of a menu" architecture did not really ship?
3. Explain the chain ad-hoc signature → cdhash → TCC reset → self-signed identity → hardened runtime → missing entitlement. Why does the Keychain behave differently?
4. In the focus engine, why is "nothing derived is stored" what made DST, sleep and crash cases testable? What does the heartbeat bound, and why must it be a `DispatchSourceTimer`?
5. What are the three different meanings of "gate" and the three of "phase" in this month, and which one does Nick mean today?
6. How did the forge's PATH gate promise ("Orion cannot edit what constrains him") erode by 08-13, and what would restore it?

---

## Appendix — every commit in range

Types follow the commit's own prefix where one exists. For unprefixed early commits the type is assigned from the content **(inferred)**. Eras: E1 Python origin · E2 Claude review/OpenClaw decision · E3 07-30 marathon · E4 powers & toolbox · E5 dashboard & connectors · E6 self-modification · E7 audit & baseline · E8 focus-session Gates · E10 v2 Phase 0/1 · E11 one repo/GitHub. (E9 has no commits of its own; its work lands in `93e9a42`.)

| Hash | Date | Type | Plain-English meaning | Era |
|---|---|---|---|---|
| `1abb90b` | 07-28 | snapshot | ChatGPT-built Python prototype as handed over: runtime, SQLite, Ollama gpt-oss:20b, roadmap Phases −1–13 | E1 |
| `a4a4809` | 07-28 | feat (inferred) | Real tool loop, schemas, tiered cloud routing, Brave web search; state audit; adopt-vs-build then "adopt OpenClaw" | E2 |
| `807ee86` | 07-30 | feat (inferred) | Warm TTS daemon, browser hologram UI, plugin 0.7.0 trust minted from host provenance; plugin enters git | E3 |
| `2f6bc6e` | 07-30 | feat (inferred) | Native SwiftUI menu-bar Orion.app (written uncompiled); fix CSP that broke the browser UI | E3 |
| `f8ac320` | 07-30 | fix (inferred) | Daemon ran on wrong Python (no MLX); ad-hoc signing reset TCC; adds orion-python, sign-setup, doctor | E3 |
| `8cf62aa` | 07-30 | feat (inferred) | Wake word (on-device only), corner summon, text window, ElevenLabs/Deepgram providers | E3 |
| `bc5139c` | 07-30 | docs (inferred) | OpenJarvis evaluation and "what Orion is missing" | E3 |
| `e4c3ba2` | 07-30 | feat (inferred) | App icon rendered from hologram geometry, login item, permissions diagnosis, PKCS#12 fix | E3 |
| `8f1f4e5` | 07-30 | fix (inferred) | Reply is under `result.payloads`; release audio device after speaking | E3 |
| `dff87ea` | 07-30 | fix (inferred) | Health checks ping the socket instead of trusting the file; daemon to launchd | E3 |
| `73aa6a4` | 07-30 | fix (inferred) | MLX pinned to one thread; the warm engine had never been used | E3 |
| `1d82682` | 07-30 | fix (inferred) | Reverse launchd: Desktop is TCC-protected, agent crash-looped | E3 |
| `08923f5` | 07-30 | fix (inferred) | Only rebuild on change; unconditional rebuild reset Accessibility | E3 |
| `c17689d` | 07-30 | fix (inferred) | Deny shell and fs tool groups; Orion had bypassed the gate with an empty ledger | E3 |
| `b95df55` | 07-30 | docs (inferred) | Document the trust regression and the two fix options | E3 |
| `0d3fd57` | 07-30 | feat (inferred) | Plugin 0.8.0: user turns read from host transcript; path-segment matching | E3 |
| `ef324db` | 07-30 | fix (inferred) | Poisoned session had learned the tool was broken; orion-reset-session | E3 |
| `7f281f1` | 07-30 | feat (inferred) | Plugin 0.9.0: authorization by scope, not exact naming | E3 |
| `14cf030` | 07-30 | feat (inferred) | orion-keys key manager; a wrong-line paste caused two 401s | E3 |
| `74d2c5c` | 07-30 | feat (inferred) | Key-manager launcher; show the body of a 401 | E3 |
| `95a9cac` | 07-30 | fix (inferred) | Test keys on the real TTS endpoint, not /v1/user | E3 |
| `0fe5762` | 07-30 | chore (inferred) | Test Orion Voice launcher; retire throwaway probes | E3 |
| `b0b21be` | 07-30 | fix (inferred) | Stop chunking a streaming cloud voice; read ORION_* from .env | E3 |
| `e43537b` | 07-30 | feat (inferred) | Voice picker searches the shared library and shows model pricing; launchers in git | E3 |
| `51070fb` | 07-30 | fix (inferred) | Set Ollie + Turbo; rewrite picker small after a zsh globbing bug | E3 |
| `dfc403d` | 07-30 | fix (inferred) | Rebuild when a signing identity appears; orion-mic-doctor | E3 |
| `f018255` | 07-30 | fix (inferred) | Stop creating untrusted certificates (7 duds); sign by hash | E3 |
| `2d33c21` | 07-30 | feat (inferred) | Reset Orion Permissions via tccutil | E3 |
| `3c60325` | 07-30 | fix (inferred) | Activate app before mic request; add OrionLog | E3 |
| `c2c4347` | 07-30 | fix (inferred) | Audio-input entitlement; hardened runtime denied the mic | E3 |
| `51518c4` | 07-30 | chore (inferred) | Log audio levels, chosen ear and transcripts | E3 |
| `a187595` | 07-30 | fix (inferred) | Optional-chained converter dropped all Deepgram audio | E3 |
| `d1955f1` | 07-30 | fix (inferred) | Ignore SIGHUP in daemon; `.noDataNow` not `.endOfStream` | E3 |
| `401dbe9` | 07-30 | test (inferred) | Pin model in test fixture; tests must not read live config | E3 |
| `0e5ef84` | 07-30 | feat (inferred) | Plugin 0.10.0: browser, media, home reads, delete-to-Trash tier (off) | E4 |
| `588f6a1` | 07-30 | fix (inferred) | Tool description generated from the catalog | E4 |
| `154c3fb` | 08-04 | chore (inferred) | Commit five days of ops scripts: daily brief, voice ID, alerts, selfdoc | E4 |
| `3a87a71` | 08-04 | feat (inferred) | Dashboard, launcher, ducking, reminders, speaker verification; endpointing and speaking-phase watchdog (accidentally dropped the ops scripts) | E4 |
| `399c036` | 08-04 | feat (inferred) | Plugin 0.11.0: self-authored artifact registry fixes self-taint; self_tuning tier; wording check removed | E4 |
| `ea2fffe` | 08-04 | docs | Capability roadmap, integration handoff, GAME_PLAN, permission-elevation proposal | E4 |
| `08cfaa8` | 08-04 | fix (inferred) | Restore ops scripts lost to a stale-index commit | E4 |
| `f09edfd` | 08-04 | feat (inferred) | Plugin 0.12.0: composed-tool workshop, approval bound to hash | E4 |
| `694e9db` | 08-04 | chore (inferred) | Actually bump version to 0.12.0 | E4 |
| `e575cce` | 08-05 | fix (inferred) | Gateway never restarted: `etimes` is not a BSD ps keyword | E4 |
| `57572be` | 08-05 | feat (inferred) | OrionUI visual language for the tabs | E5 |
| `a79bb89` | 08-05 | feat (inferred) | Tasks stored in Apple Reminders "Orion" list | E5 |
| `4fb9ba1` | 08-05 | feat (inferred) | Calendar read, Keychain credentials, OAuth+PKCE, Whoop client | E5 |
| `865f446` | 08-05 | fix (inferred) | Instagram moved off a dead API; Plaid honestly "not built" | E5 |
| `0b2049b` | 08-06 | feat (inferred) | Supplements, workouts, health_tracking tier, Plaid Hosted Link | E5 |
| `651c7c2` | 08-06 | docs (inferred) | Warn that Plaid Sandbox asks for a phone number | E5 |
| `6b8cd3b` | 08-06 | fix (inferred) | Whoop offline scope and v2 API; workout sheet; transparency attempt 1 | E5 |
| `91f4b89` | 08-06 | fix (inferred) | Transparency attempt 2: behind-window visual effect view | E5 |
| `88fced5` | 08-06 | fix (inferred) | Transparency attempt 3 (ScrollView); bento Health tab | E5 |
| `9f64722` | 08-07 | fix | Real transparency; tabs split into files; Whoop refresh single-flight; honest connector status | E5 |
| `e5a1725` | 08-07 | fix | Home takes the full window | E5 |
| `4c3bee9` | 08-07 | feat | OrionDay (wake-based day), morning brief, local-model narrative | E5 |
| `bf88e0f` | 08-07 | fix | Bigger token budget for reasoning models | E5 |
| `5380480` | 08-07 | feat | Health summary; move to gpt-oss:20b after 3B misread data | E5 |
| `69dd877` | 08-07 | feat | Takeaway rail; launcher clamp; task-module prep doc | E5 |
| `8ea60a6` | 08-07 | fix | Plaid public token nested deeper | E5 |
| `f33aaf5` | 08-07 | feat | Plaid Sandbox/Production switch | E5 |
| `559e2cf` | 08-07 | fix | Connector keys editable after first save | E5 |
| `729dc29` | 08-07 | feat | Multiple banks; real Finances tab; signed net worth | E5 |
| `30a3d9a` | 08-07 | fix | Finances retries and explains empties | E5 |
| `04676fd` | 08-07 | feat | Tasks + day timeline + week strip; create calendar events | E5 |
| `cc7a8e3` | 08-07 | feat | Calendar layer reports what it can see | E5 |
| `f251464` | 08-07 | feat | Real calendar colours; edit any event via user-opened sheet | E5 |
| `5444062` | 08-08 | feat | Read iMessage and Contacts; permissions list | E5 |
| `53abaf5` | 08-08 | fix | Unfetched Contacts key aborted the app | E5 |
| `c97955c` | 08-08 | wip | First orion-forge script | E6 |
| `50d02a9` | 08-08 | fix | Forge status exit code | E6 |
| `86908db` | 08-08 | docs | Forge-applied: OrionLog points at forge ledger | E6 |
| `96fe6f8` | 08-08 | feat | self_modify catalog action | E6 |
| `57407ee` | 08-08 | feat | Forge find/replace edit mode | E6 |
| `0ddadbc` | 08-08 | ui | Forge-applied: reword placeholder (test) | E6 |
| `dd0d583` | 08-08 | fix | `status` is read-only in zsh | E6 |
| `b09ea48` | 08-08 | ui | Forge-applied: restore placeholder | E6 |
| `5f190a5` | 08-08 | feat | Forge design: path, build, launch gates | E6 |
| `7ce12ff` | 08-08 | feat | Orion can list and read his own source | E6 |
| `164d486` | 08-08 | fix | enableSelfModificationActions flag; missing verifiers | E6 |
| `3fdf5de` | 08-08 | (forge) | Orion's first self-edit: one placeholder string | E6 |
| `b35a731` | 08-11 | fix | Health-log lost updates; cross-language FileLock | E7 |
| `cefd605` | 08-11 | fix | Narratives keyed by facts; not-connected kept distinct | E7 |
| `27b0a7e` | 08-11 | fix | Timeline scroll and full 24 hours | E7 |
| `d692711` | 08-11 | test | Layout and race harnesses | E7 |
| `fd343df` | 08-11 | feat | Bridge calendar delete by identifier | E7 |
| `71d4581` | 08-11 | fix | orion-daily used UTC dates | E7 |
| `d9cf665` | 08-11 | feat | Twelve allowlisted orion-* wrappers; selfdoc sees them | E7 |
| `7d0a7b8` | 08-11 | docs | Audit, risk sweep, benchmark, learning proposals (baseline tag) | E7 |
| `423e90e` | 08-11 | test | Gate 1 CoreAudio observation matrix | E8 |
| `8baac06` | 08-11 | feat | SessionDomain pure target; two clocks | E8 |
| `df20f1c` | 08-11 | docs | Gate 0 baseline, Gate 1 findings (hypothesis refuted) | E8 |
| `d58ee40` | 08-11 | feat | Gate 2: reducer, reconcile, heartbeat; 67 tests | E8 |
| `cad10eb` | 08-11 | docs | Record heartbeat requirement for Gate 3 | E8 |
| `6487373` | 08-11 | docs | Close Gate 1; Bluetooth deferred | E8 |
| `8d72467` | 08-11 | refactor | SessionService target; one shared FileLock | E8 |
| `5d23d93` | 08-11 | feat | SessionStore, history, single writer | E8 |
| `77f8484` | 08-11 | feat | Gate 3: command socket, orion-session client | E8 |
| `b4baaa0` | 08-11 | feat | Gate 4: clips; heartbeat off main run loop | E8 |
| `e23fcab` | 08-11 | feat | Gate 5: sensing, Firm enforcement, unconditional escape | E8 |
| `d013d8c` | 08-11 | feat | Gate 6: deterministic exit policy; real voice; ducking | E8 |
| `22941bd` | 08-11 | feat | Gate 7a: Session tab; focus→tasks rename | E8 |
| `21aa23e` | 08-11 | feat | Gate 7: break surface | E8 |
| `1412945` | 08-11 | feat | Gate 8: factual calendar | E8 |
| `2030cf4` | 08-11 | feat | Gate 9: Console on ⌥Tab | E8 |
| `694b762` | 08-11 | feat | Gate 10a: day score, quittable apps, DND, Music | E8 |
| `d623dab` | 08-11 | feat | Gate 10: reverse lockdown, full-bleed, camera presence | E8 |
| `81cd050` | 08-11 | ui | Fold tabs; calendar in Tasks; Focus settings; orion-messages | E8 |
| `4937b72` | 08-11 | docs | One handoff; archive 13 planning docs | E8 |
| `c33d5bf` | 08-15 | chore | v2 Phase 0 baseline; secret scanner | E10 |
| `9248ac6` | 08-15 | test | Live smoke through the real agent route | E10 |
| `1a9c3f9` | 08-15 | docs | Authority map snapshot (157 capabilities) | E10 |
| `3843620` | 08-18 | chore | Codex/Claude collaboration lanes; Phase 1 plan | E10 |
| `1515c46` | 08-18 | chore | Source checkpoint and secret inventory | E10 |
| `5b8a2c7` | 08-18 | chore | PHASE_GATES.json and gate checker | E10 |
| `e2b5ae3` | 08-18 | chore | Keychain / SecretRef migration prep | E10 |
| `1d1e821` | 08-18 | docs | Register the 85-phase manifest | E10 |
| `a962541` | 08-18 | chore | Harden selective credential migration | E10 |
| `1169e5b` | 08-19 | chore | Deferred key-migration safety | E10 |
| `93e9a42` | 08-20 | checkpoint | Commit two weeks of uncommitted work, Phase 1, Sparkle, handoffs | E11 |
| `1efd37c` | 08-20 | feat | Fold brain vault, privacy page, test workspace into the repo | E11 |
| `36ee439` | 08-20 | chore | Stop tracking local Claude settings | E11 |
| `66b9e3a` | 08-20 | docs | Repo on GitHub: push rule reversed; orion-git skill | E11 |
| `97523ab` | 08-20 | docs | Don't hardcode the build number | E11 |
| `16ba5e9` | 08-20 | docs | Date the secret scan instead of counting commits | E11 |
