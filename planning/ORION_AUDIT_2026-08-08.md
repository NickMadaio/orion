# Orion audit — 2026-08-08 (+ overnight addendum)

## Do these three things when you wake up

1. **Grant Calendar access.** *System Settings → Privacy & Security → Calendars*
   → enable **Full Access** (not Add Only) for the responsible app — accli says
   it is usually `osascript` and/or your terminal. Then:
   ```bash
   accli calendars && accli config set-default "<your main calendar>"
   ```
   That is the only thing standing between Orion and a working calendar, and the
   `set-default` is what stops him asking "which calendar?" every time.

2. **Rotate the Anthropic API key.** It sits in plaintext in `openclaw.json` and
   was printed to a terminal during this audit. Local file, low risk, but free to
   rotate and one less thing to think about.

3. **Run the benchmark yourself once**, so you have seen it pass rather than
   taking my word for it:
   ```bash
   node ~/Desktop/ORION/scripts/orion-bench --live
   ```

Optional but recommended: skim the **Still open** section — the health-log write
race is the one thing here that can silently lose your data.

---


Phase 0 of the refinement plan. Everything below was checked against the running
system, not inferred from the planning docs. Where something is broken, the
evidence is the command output that showed it.

Environment: OpenClaw `2026.7.1-2 (0790d9f)`, gateway healthy on 127.0.0.1:18789,
one plugin (`orion-control`), 53 catalogued agent actions, one agent (`main`).

---

## The headline

**Orion's memory had been dead for weeks and nothing reported it.**

```
Indexed: 0/5 files · 0 chunks
[memory] sync failed: openai embeddings failed: 429 credit_balance_exhausted
```

`memorySearch` was never configured, so it defaulted to OpenAI embeddings. That
account has no credits. Every index attempt and every search failed — and failed
*quietly*: `openclaw memory search` answers `No matches.` rather than an error,
which is indistinguishable from "nothing relevant found". So the symptom Nick
would have felt is not "memory is broken", it is "Orion is a bit forgetful".

That is the single most important finding, because it means every judgement
about Orion's memory quality made before today was made against a system that
was not retrieving anything at all.

**Fixed and verified tonight.** Details in *What changed* below.

---

## WORKING

- **The permission gate and ledger.** Propose → guarded execute → independent
  verify → append-only JSONL. Today's ledger shows it doing its job, including
  refusing a self-modification attempt with `capability_disabled` and failing a
  verification that did not observe the expected state. It reports honestly.
- **The provenance / taint defence.** Trust anchors are harness-owned; a target
  that appears only in content Orion *read* is refused. Visible in the record:
  `refused: target_from_untrusted_content`.
- **SOUL.md.** Genuinely good — concise, behavioural, example-driven, no
  corporate filler. The refinement plan assumed this file would need cleaning
  out. It does not. I left it alone deliberately.
- **USER.md.** Good structure and, unusually, good *rules* — durable-only,
  dated appends, his words not inferences, never silently rewrite. Three real
  learned facts, including the London move flagged as expiring the timezone.
- **Tiered model fallback.** Cloud Haiku primary, local Ollama fallbacks.
- **TTS / voice ID / wake word services** are up (sockets present, daemons
  running).

## BROKEN (fixed tonight)

- **Memory indexing and retrieval.** As above. `0/5 files, 0 chunks`.
- **The daily summariser overwrote memory.** `scripts/orion-daily` called
  `writeFile()` on the whole of `memory/YYYY-MM-DD.md`. AGENTS.md tells Orion
  that "remember this" means writing to that same file. So the one instruction
  for capturing what Nick says wrote to a file the summariser destroyed on its
  next run. Nothing has been lost yet only because nothing was scheduled.
- **Dates were computed in UTC.** `toISOString()` in a New York timezone rolls
  over at 20:00 local, so a summariser run in the evening — the only sensible
  time to run one — files the day under *tomorrow*. Confirmed live: asked for
  `--today` at 22:30, it wrote `2026-08-09`. The runtime loads "today and
  yesterday" by filename, so this silently misfiles memory every night.

## MISSING

- **`MEMORY.md` did not exist.** AGENTS.md references it six times, startup
  context is documented to load it, and the heartbeat is instructed to fold
  daily files into it. It had never been created. The entire curated long-term
  layer was a dangling reference.
- **The observation → memory step.** This is the real Priority 1 gap. The daily
  files were auto-generated *tool telemetry*:

  ```
  9 requests, 5 actions verified, 4 refused.
  ## What was done
  - step-1 ×5
  ## Asked for
  - Run browser_open_url
  ```

  That is a record of which macOS actions fired. It contains nothing Nick said,
  nothing decided, nothing learned. The pipeline the plan describes —
  OBSERVE → IDENTIFY → CLASSIFY → STORE — had no observe step at all. Retrieval
  was broken; but even once fixed, there was nothing worth retrieving.
- **Traces.** No per-interaction record of context selected, memories retrieved,
  tools chosen, or corrections. Priority 4 is genuinely greenfield.
- **Capability registry.** Orion cannot answer "what can you control?" truthfully
  from a queryable source. `TOOLS.md` is generated and is the closest thing.

## NOT CONFIGURED

- **No chat channel.** `openclaw channels list` → none. Discord is **outbound
  only**, via a webhook shell script. Remote status, approvals, and the
  `status/pause/resume/approve` commands in Priority 9 are not possible until a
  real channel exists. This is the one item tonight that is blocked on Nick.
- **Nothing was scheduled.** `openclaw cron list` → empty, and `HEARTBEAT.md` is
  comments-only, which switches heartbeat calls off by design. So every
  proactive behaviour and every memory-maintenance routine described at length
  in AGENTS.md had never run once. **This is why the memory pipeline never
  self-corrected** — the step that would have folded daily notes into MEMORY.md
  was scheduled to never happen.
- **Obsidian.** The skill is disabled and the vault holds a single file. The
  plan's "Obsidian brain" does not meaningfully exist. Given OpenClaw already
  has a real memory subsystem — index, search, promote, REM reflection — I would
  not build one. Recommendation: drop Obsidian from the plan rather than wire it
  up.

## PARTIALLY WORKING

- **Self-modification.** Built (there is a dedicated `self_modification`
  capability tier and the config enables it) but refused at the permission
  profile: today's attempt returned `capability_disabled`. Correct posture for
  the highest-risk capability in the project; worth knowing it is one flag away.
- **AGENTS.md.** 16KB of always-on context, and it contradicted itself. Line 93
  says *"Do not trust prose about your own abilities, including this prose. Read
  the generated file."* — then a hundred lines later hand-wrote a capability
  list. That list is the exact failure mode it warns about, and it is how Orion
  told Nick he had no shell on days when he had one.

## DUPLICATED

Priority 3 says the UI and the AI should call the same underlying actions. They
do not. Three of these are real bugs, not just architectural untidiness:

1. **The health log has two independent read-modify-write implementations on the
   same file, with no locking.** Swift `HealthLog.mutate()` and TypeScript
   `health.ts` both do read → mutate → replace on
   `~/.openclaw/orion-controlled/health-log.json`. The Swift side also polls it
   on a timer. A UI edit and a voice edit in the same window can clobber each
   other. This will lose data eventually.
2. **Two parallel, non-communicating reminder systems.** The Tasks tab writes
   real EventKit reminders; the agent's `timer_set`/`reminder_list` write a
   private `reminders.json`. Both are "remind me at a time", implemented twice,
   neither able to see the other's items. So "mark my task done" is impossible
   *and* misleading — Orion has reminder actions, they just address a different
   store than the one Nick is looking at.
3. **Voice tuning bounds are declared twice** — the same four keys and ranges in
   Swift `VoiceTuning.swift` and TypeScript `catalog.ts`, kept in sync by hand.

Also duplicated with differing safety postures: URL opening (the TS path
validates heavily, the Swift path not at all) and app launching (two resolvers).

## GAPS — things Nick can do in the UI that Orion cannot

The full inventory is long; these are the ones that matter:

- **Calendar: total gap.** Orion cannot create, read, edit or delete a single
  real calendar event. Every "cross-module reasoning" example in the plan
  ("you have an exam tomorrow…") depends on this.
- **Apple Reminders / the Tasks tab: total gap.** See above.
- **Hydration: total gap** — asymmetric and odd, since supplements and workouts
  both got agent actions and water did not.
- **No removal anywhere in health.** He can add a supplement forever but never
  remove one; he can log a workout set but not delete a misheard one.
- **Connections: total gap.** He cannot reconnect Whoop or refresh Plaid —
  exactly the failure those buttons exist for.
- **His own voice.** He cannot toggle his own wake word or switch STT provider
  when one is failing.

---

## What changed tonight

All verified, not assumed.

| Change | Evidence |
|---|---|
| `memorySearch` → local Ollama embeddings (`nomic-embed-text`) | `Indexed: 7/7 files · 11 chunks`, provider `ollama` |
| Created `MEMORY.md` with the curated long-term layer | indexed; retrieved at 0.55–0.60 on six queries |
| `orion-daily` now owns one delimited block, not the file | ran twice against a hand-written note; note survived both, no duplicate block |
| `orion-daily` dates are local, not UTC | asked for `--today` at 22:30 EDT, now correctly writes `2026-08-08` |
| Ledger row matching and archival made local-day consistent | same rule on read, write and compress paths |
| Nightly cron: summarise + reindex, 02:10 America/New_York | job created, executed once manually to prove it runs |
| AGENTS.md: removed the self-contradicting capability list | replaced with a pointer to `TOOLS.md` plus a truthful gap list |
| AGENTS.md: memory instruction now tells Orion to journal what was *said* | the file it writes to is no longer destroyed |
| AGENTS.md: marked the heartbeat section inert, dropped dead branches | so Orion stops claiming background work he never did |
| Personal benchmark: 44 cases, 6 executable | `6/6 recall cases passed` |

The end-to-end test the plan calls critical now passes: a preference stated in
passing ("Nick prefers the desk lamp warm, not white") is stored in a daily
file, indexed, and retrieved at **0.604** by a question that shares no keywords
with it — *"what kind of light does Nick like at his desk"*.

## What I did not do, and why

- **Discord.** Needs a bot token and a channel. Blocked on Nick.
- **Proactive outreach.** I scheduled memory consolidation, which is internal,
  but deliberately did not switch on anything that messages him unprompted.
  AGENTS.md already requires his explicit approval of an alert policy, and
  turning that on while he was out would have been the wrong read.
- **SOUL.md.** The plan said to audit it for corporate vagueness. It does not
  have any. Churning a good file to satisfy a checklist is how good files get
  worse.
- **Obsidian.** Recommending removal from the plan rather than integration.

---

# Addendum — 2026-08-09, overnight

The first pass fixed the *plumbing* and verified it with CLI tools. It never
drove a real conversation. Doing that immediately exposed three bugs that no
amount of index-checking could have found, because indexing was green the whole
time.

## Orion could not save a memory at all

The `coding` tools profile strips `file_write`, so Orion has no file-writing
tool. Told to journal what Nick said, he improvised the only thing left — `exec`
with a `cat >> … <<EOF` heredoc — which is not on the exec allowlist. Observed
live: he correctly decided the fact was worth keeping, said so
(*"Now let me capture that fixture name in today's memory"*), and the attempt
**hung the session for the full 240-second timeout and killed the turn.**

So the honest state before tonight was worse than "memory is sparse": Orion had
the instinct to learn, no mechanism to do it, and trying killed the conversation.

**Fixed** — `scripts/orion-remember`: narrow, append-only, allowlisted, writes
either today's memory file or `USER.md --user`. Guards against newline injection
(a note becomes one line, so it cannot forge headings in a file that is loaded
into every session) and refuses credential-shaped strings.

## A denied command hung the assistant for minutes

The deeper bug. Exec policy was `security: allowlist, ask: on-miss,
askFallback: deny` — but with no approver connected, a miss *waited* rather than
denying, until the agent timeout killed the turn. Orion hit this constantly: he
invented `session_status`, he wrote English prose into `exec`
(`find files named "*.md" in ~/… -> show first 20 lines`). Each one cost minutes
of total silence.

For a voice assistant this is the worst possible failure: ask a question, get
nothing at all for four minutes.

**Fixed** — `ask: off`. This does not widen the allowlist by a single entry;
`askFallback: deny` already declared that denial was the intended outcome. It
only removes the wait. Measured: **200s+ hang → 8s**, with Orion quoting the
real error (`exec denied: allowlist miss`) exactly as SOUL.md instructs.

## Orion confabulated from his own plumbing

Asked for a codename he had never been told, he answered with his own session
identifier — `"the fixture codename is orionbench1786255892849-b"` — because the
key contained the word "bench". Confidently, formatted as fact.

**Fixed** — a rule in AGENTS.md: session ids, run ids, paths and model names are
wiring, never an answer; "I don't have that" is a complete answer. Verified: he
now declines and asks a narrowing question instead.

## Learning was non-deterministic, and now is not

Even with a write path, storage fired only sometimes — the journaling rule was
one bullet among fourteen in a 16KB always-on file, which a small model follows
intermittently. Recall was flaky for a different reason: with no search path,
Orion improvised `find` against the memory directory, and when that failed he
told Nick he had no record of something he had been told an hour earlier.

**Fixed** — the journaling rule is now the first thing under `## Memory`, with a
grammatical trigger (*he stated something rather than asked something*) rather
than a judgement call; and `scripts/orion-recall` gives semantic search over the
real index as one allowlisted command.

**Result — four consecutive clean runs of the full end-to-end loop:**

```
pass  live-01  stores a fact stated in passing, unprompted
pass  live-02  recalls it in a brand-new session
pass  live-03  does NOT surface it when irrelevant
pass  live-04  does not invent a codename it was never told
```

`orion-bench --live` now drives real agent turns and scrubs its own fixtures out
of Nick's memory afterwards. That last part matters: an earlier version left
codenames behind, and by the third run Orion was answering with the *oldest* one
— a test polluting its own input, scoring a working system as broken.

Also done: `plugins.allow` pinned (any plugin dropped into the extensions
directory previously auto-loaded), `active-memory` enabled so relevant memory is
injected before a reply rather than depending on Orion choosing to search, and
the gateway restarted — it was at 1.06 GiB against a 512 MiB threshold.

## Calendar was never a total gap

I had this wrong in the first pass. `accli` — a full Apple Calendar CLI — is
installed at `/opt/homebrew/bin/accli` and has a skill in the workspace. Orion
could not reach it because it was not allowlisted, so he improvised, hung, and
eventually told Nick he had no calendar. The gap was one wrapper and one
permission wide, not a build project.

`scripts/orion-calendar` now exposes `calendars`, `agenda`, `free` and `create`.
Update and delete are deliberately absent: allowlist patterns match the binary,
not the subcommand, so allowlisting `accli` itself would have handed Orion
destructive calendar access as a side effect of wanting to answer "what's on
tomorrow".

**One thing is waiting on Nick:** macOS Calendar access. accli returns
`NOT_AUTHORIZED` until Full Access is granted in *System Settings → Privacy &
Security → Calendars*. Everything else is wired and tested; the wrapper reports
that specific blocker in plain words instead of letting Orion conclude he has no
calendar. After granting it, `accli config set-default <calendar>` will also stop
him having to ask which calendar to use.

## The Brain Inspector

`scripts/orion-trace` renders what OpenClaw already records — it is not a new
tracing system. The runtime writes a `.trajectory.jsonl` per session carrying the
compiled context, model, tool inventory and final status; what was missing was a
way to read it. Priority 4 was mostly already provided.

```
orion-trace              the last session
orion-trace --failures   only aborted / timed out / errored turns
orion-trace --last 10
```

It paid for itself immediately. On the calendar turn it showed Orion retrying the
same failing command five times, then aborting having said nothing useful —
121,520 cached tokens for no answer. Adding a two-attempts-then-ask rule to
AGENTS.md changed that turn to **one tool call, 16,310 tokens, and a precise
question** ("Need to know which calendar to use. Which one?"). Roughly 87% cheaper
and actually helpful.

It also surfaced Orion inventing a tool id (`ambient_info`) and, separately, that
adding `2>&1` or piping into `head` can turn an allowed command into an allowlist
miss — both now noted in AGENTS.md.

## Still open

- The exec-prose habit is reduced but not gone. It now fails in a second instead
  of hanging, so it costs latency rather than the conversation.
- Apple Reminders remains a real gap with no CLI installed. The likely path is a
  Shortcuts bridge via `/usr/bin/shortcuts`, which needs a Shortcut authored in
  the app — Nick's call, not something to do unattended.
- `--live` costs a few cents per run and takes ~4 minutes. Run it after brain
  changes, not on every commit.

## Where I would go next

In this order, and not the plan's order:

1. **Calendar + Apple Reminders actions.** The single biggest capability gap,
   and a hard prerequisite for the cross-module reasoning that is the whole
   point of the north star. Build them as *one* implementation the UI also
   calls — do not add a third reminder store.
2. **Fix the health-log race** before it eats data. One writer, or a lock.
3. **Traces.** Priority 4 is correctly placed in the plan: without it, Priority 5
   (adaptive learning) has no material to learn from, and there is no way to
   tell whether a change made Orion better or worse.
4. **Then** autonomy and Discord.

The plan's ordering puts conversation (P2) above the action layer (P3). I would
swap them. Conversation quality is already decent because SOUL.md is good; the
thing that actually breaks trust is asking Orion to do something he appears to
support and getting a confident answer about the wrong data store.
