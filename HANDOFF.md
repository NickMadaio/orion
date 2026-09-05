# HANDOFF

## 2026-09-05 03:19 — Discord dispatch audit: connected and working; one leak found and fixed, not yet deployed

Scoped task: verify and repair the Discord remote path only (Nick's #1
priority — "make sure dispatch and texting orion from discord work"). Did
not touch `native/Orion/` or `openclaw-plugins/orion-control/src/` — two
other agents own those this session; their in-progress edits are visible in
`git status` and untouched here. Full detail, every command and output, in
`planning/v2/REMOTE_DISPATCH_AUDIT_2026-09-05.md`. Short version:

**State found.** The launchd bridge (pid 46201) was connected, `presence:
online`, current gateway session stable since 01:08 EDT with zero failed
attempts — proven live, not assumed, via `remote-link.json` and
`orion-remote-bridge status`. `~/Library/Logs/orion/remote-bridge.log` has
**no timestamps at all** — every `say()`/`warn()` line is bare
`console.log`/`console.error` — so reconnect frequency (36 socket errors, 36
session invalidations, 18 Discord-initiated reconnects logged) could not be
correlated to wall-clock time. Read the backoff code
(`orion-remote-bridge:513-521`): Discord-initiated reconnects (op 7) reset
the failure counter and retry with 0ms delay by design, which is correct,
not a bug — but the log's missing timestamps make that hard for anyone to
confirm after the fact. Not fixed (see below).

The 2026-09-02 addendum's "concurrent uncommitted `orion-remote` edit"
(higher rate cap, bare-verb-to-brain fallthrough, fabricated-approval-id
refusal) worried it might have been lost. `git log -p` shows it landed in
commit `80a6e46`, **one minute after** the addendum was written (another
instance of the "handoff date lies" pattern) — all three are live in the
current file, verified against the tree, not assumed from the commit
message.

**What changed and why.** `askBrain()`'s catch-all branch
(`scripts/orion-remote`) replied with execFile's own `"Command failed: <node
path> <openclaw path> agent --session-key orion-app-v2 ..."` on any hard
CLI failure (crash, or the exec-level timeout past the agent's own
`--timeout`) — leaking this Mac's absolute paths and the live session key
into a Discord DM. The far more likely "provider overloaded" case (a
structural `status:"error"` envelope from `openclaw agent` itself) was
already clean (`"Orion did not finish: provider overloaded (529)"`) and is
now pinned by a regression test so it can't regress alongside the fix.
Fixed: a hard exec failure (`error.killed`, or a message starting `Command
failed:`) now replies `"Orion is taking too long to answer — try again in a
moment."` instead.

Also measured, not just read: `RATE_CAP = 40` per sender per 10-minute
window — sending 41 messages rapid-fire, message 41 was the first refusal.
That is one message every 15 seconds sustained; a person texting at normal
pace will not hit it.

**Verification.** TDD with mutation proof (test names in
`scripts/orion_v2_remote_check.sh`): added the leak-detection assertion
first, confirmed it failed with the actual leaking message
(`Orion could not answer: Command failed: /var/.../crash-brain.sh agent
--session-key orion-app-v2 --timeout 90`), implemented the fix, confirmed
green, then re-broke it by wrapping the fix in `if (false && ...)` to
confirm the *same* named assertion fails identically before restoring.
Also newly proved (all now permanent checks, not just this session's
scratch commands): a non-allowlisted sender gets silence and never reaches
`askBrain` (proven by name, `an-attacker-9999`); a replayed envelope id is
refused on its second delivery with exactly one reply in the outbox, not
two; `approve` from a `local` sender is still refused at **two** independent
layers (`orion-remote` itself, and the plugin's `approvals.js:209`
regardless); a fabricated but correctly-shaped gate approval ID
(`A-9999`) is refused with zero side effect against the real approval
store (confirmed no grant file written). `bash
scripts/orion_v2_remote_check.sh`: 49 ok / 0 FAIL (was 46/0 before this
session's three new checks).

**`files desktop` through the installed launchd bridge** — the addendum's
one specifically-unproven item — proved via the same `inject`→`poll`→
outbox-by-envelopeId sequence `orion-remote-bridge`'s `dispatch()` itself
uses, run against the **installed** copy with the real allowlisted sender,
without sending anything to actual Discord: queued, polled, correct
27-item Desktop listing (names/sizes/dates only) landed in `outbox.jsonl`
keyed by the exact envelope id. What is *not* proven is the last hop —
`dispatch()`'s caller POSTing that text to Discord's REST API and it
rendering on Nick's phone — which needs either a real inbound DM from him
or trust in `send()`'s six lines, which I read but did not execute.

**Live/installed state.** The running bridge (pid 46201) is still on the
**pre-fix** code — I fixed the repo (`scripts/orion-remote`) but did
**not** run `scripts/orion-remote-install`, because that reloads the live
launchd job (kills and restarts the one currently-stable Discord
connection), and `CLAUDE.md` reserves restarts/installations as needing
their own authorization beyond this task's standing checkpoint
authorization:

```
$ bash scripts/orion-remote-install --status
  installed  [00f709fa5d64]   repo  [6194c553b123]
  DRIFTED — the running copy is not the repo copy. Re-run this script.
```

**Rollback path.** Everything is uncommitted in the working tree (per this
task's instructions — the moderator commits). `git diff -- scripts/orion-remote
scripts/orion_v2_remote_check.sh` shows the full change; reverting either
file is a plain `git checkout` of those two paths (not run by me — rule
against `git checkout` in this session). No live state was mutated except
appending to `~/.openclaw/orion-controlled/{remote-audit.jsonl,outbox.jsonl,
inbox.jsonl,remote-inbound.json}` by exactly one `files desktop` test
envelope each (auditable, timestamped, attributed to the real allowlisted
sender id, used deliberately to prove the installed-bridge round trip —
see the audit report for the exact lines added).

**Exact next step.** (1) Nick (or whoever he tells to) runs `bash
scripts/orion-remote-install`, confirms `--status` shows matching
fingerprints, and sends one real Discord DM to confirm the round trip and
close the addendum's last open item. (2) Whoever picks up reconnect-log
work should add timestamps to `orion-remote-bridge`'s `say()`/`warn()` — I
found no safe way to unit-test that change without either mocking the
gateway socket or restarting the live bridge, so I left it as a documented
finding rather than an unverified repair. Needs: `scripts/orion-remote-bridge`,
`~/Library/Logs/orion/remote-bridge.log`.

## 2026-09-02 18:50 — The manifest was amended; stopped at Phase 50

### The manifest changed, and that is not tampering

**Requirements were ADDED to phases 46, 48 and 49 on Nick's explicit
instruction**, and the source was re-fingerprinted rather than left looking
altered. Old sha `f9fceb60…`, new sha `7cb01a57…`, both recorded in
`MANIFEST_PHASES.json` → `source.amendments` with the reasoning. Nothing was
removed, reworded, renumbered or reordered.

The additions came from an independent agent's diagnosis of a failed live
conversation. Three classes of defect the manifest required nothing about, so
fixing them quietly would have meant building outside the requirements source.

### What that diagnosis found, ranked

1. **My own channel brief was disarming a security gate.** The host records
   `CHANNEL_BRIEF + Nick's message` as ONE user turn, so every word I wrote
   counted as something *he* said — and the brief contained "enable" and
   "permission", both in the plugin's `AUTHORITY_INSTRUCTION` regex. The
   self-modification gate therefore passed on **every Discord turn**. Fixed, and
   the check now reads the regex out of the plugin so it cannot drift.
2. **"pause the music"** parsed as `pause(music)` → "no mission called music".
   Mission-shaped arguments naming no mission are conversation now.
3. **The gate Nick looped on was unsatisfiable.** `normalizeForOrigin` strips
   dots from both sides, so "executors.ts" needs the token `executorsts`. Saying
   "executors" could never work. NOT FIXED — Phase 49.
4. **Approval is satisfiable by the agent.** Orion passed `approvalHash` himself
   and the gate cleared; no human yes ever reached the plugin. NOT FIXED —
   Phase 49, and the most consequential open item.
5. **Music pause**: verification cost the action. The pre-flight snapshot takes
   **120 seconds** against Apple Music and consumed the whole 10s budget, so the
   playpause was never sent. Bounded to 3s and deployed. **But Music is not
   answering AppleEvents at all** — a bare playpause also times out at 120s — so
   the fix is necessary and not sufficient. A media-key route measured 291ms and
   was deliberately NOT shipped: `key code 16` is plausibly the "y" key and
   nothing could confirm a pause actually happened.

### Position — stopped at 50 as instructed

Complete: 0–39, 41, 42, 44, 45. Open: **40** (the 2026-09-08 move), **43**
(reauthentication), **46** (6/9 after the amendment), **47** (8/9 — only
`files.copy` missing; everything else already existed). Surveyed and largely
unbuilt: **48**, **49**, **50**.

47 needed almost nothing built — nineteen file actions already existed across six
scoped tiers, delete already trashes and verifies. That is the third phase this
programme has nearly rebuilt; grep first.

---

## 2026-09-02 17:42 — Orion is persistent, and talking

Two things changed today that the earlier entries below do not reflect.

### 1. A DM reaches the BRAIN, not just a verb

Nick: *"the idea isnt i just say a word or two, the idea is that its a remote way
to directly speak to the orion brain."* Anything that is not one of the ten verbs
now goes to `openclaw agent --session-key orion-app-v2` — the exact key
`GatewayClient.swift` uses, so a DM lands in the conversation standing at the
Mac. **One Orion, one memory.** Proven live: *"hi Orion, I'm now talking
remotely. Cool right?"* → *"Hey! Remote and working—that's the setup."*

**This reverses a documented decision.** `orion-remote`'s header still states its
founding property — seven verbs, NO FALLTHROUGH TO A MODEL. Nick was shown the
trade (with the brain attached, whoever holds that Discord account holds the Mac)
and chose full authority. Registered in `scopeNotInManifest`. What survives:
every guard still runs FIRST — allowlist, LOCK ORION, routing, replay, expiry,
rate limit — and text reaches the model as a FILE, never argv. Mutation-proven,
including that a locked Orion will not think.

### 2. launchd CAN run it — the ~/Desktop constraint is solved

**This is the one worth carrying forward.** AGENTS.md has said for weeks that
launchd cannot read `~/Desktop`, which is why the TTS daemon's agent has never
been installable and why it stayed dead for nineteen days. The answer is not to
fight TCC, it is to stop needing it: **install a copy outside `~/Desktop`.**

`scripts/orion-remote-install` puts one under `~/.openclaw/orion-remote` with
`WorkingDirectory=~/.openclaw` — exactly how OpenClaw's own gateway agent has run
for weeks. No TCC grant, no Full Disk Access. Verified: launchd starts it, it
connects, and `kill -9` is followed by an automatic restart in ~12s and a
reconnect. **The same recipe would revive the TTS daemon's agent.**

The cost, and `--status` reports it: the COPY is what executes. It prints both
fingerprints and says DRIFTED when they differ, so re-run the installer after
touching `orion-remote` or the bridge. The installed `.env` carries 2 values,
not the repo's 8 — a second copy of a secret is a second thing that can leak.

### Still open

- **Phase 40** — the cron re-home, waiting on the 2026-09-08 move.
- **Phase 43** — reauthentication, the only one of nine left.
- **`files desktop` over the launchd bridge is UNVERIFIED.** The job inherits
  launchd's TCC context, so reading `~/Desktop` may fail there even though it
  works from a terminal. The handler names the permission error clearly if so.
  One DM settles it.

---

## 2026-09-02 13:35 — The Discord bridge is live. One line from a round trip.

Nick created the bot, added it to the ORION guild and put the token in `.env`.
The transport is built, connects, and the three phases that were waiting on it
are closed except for two named gaps (`0af5235`).

**It really connects.** `scripts/orion-remote-bridge probe` reaches
wss://gateway.discord.gg, IDENTIFYs and gets READY: *connected as orion (1
guild(s))*.

### The one thing left

`ORION_REMOTE_ALLOW` refuses everyone by default, so no inbound message is
obeyed yet. The candidate id — `732025545549807666`, owner of the ORION guild,
found with `orion-remote-bridge whoami` — is in `.env` **commented out**.
Granting an account authority over this Mac is Nick's decision, not an inference
from who owns the guild. Uncomment it and the channel is on.

### What was found

**A permission not taken.** The first attempt asked for `MESSAGE_CONTENT` and
Discord closed the socket with 4014. That privileged intent would let the bot
read every message in every channel it can see. Dropping it was the better fix:
Discord delivers content for DMs and @mentions without it, which is exactly how
Orion is addressed. He hears you when you talk TO him and is deaf otherwise.

**"Running application" took three definitions.** Any bundle in the process
table gives 62, nearly all agents like `AirPlayUIAgent`. The outermost bundle
reports News, Stocks and Home as running — their *widget extensions* are always
alive while the apps are not. The honest one: an executable directly in a
top-level bundle's `Contents/MacOS`. Eleven names, all genuinely open.

**A test that could never fail**, mine. `grep -qv "hello"` inverts *per line*, so
on multi-line output some line always fails to match and it exits 0. Caught by
mutating the handler to print file contents and watching the assertion pass.

**The two guards that did not exist now do, in the LIVE path.** `orion-remote`
finally reads back the `at` it has always written (>10 min → refused, audited
with the age), and an envelope addressed to another Mac is refused *before any
state is written* — so it consumes no replay slot. That second half is the one a
naive implementation gets wrong and is separately mutation-proven.

**The lock reaches the channel.** `lock.json` is a real flag rather than an
inference from `profile == restricted_read_only`. Locking stops dispatch,
advances the inbox cursor past queued jobs (leaving them on disk for the audit),
expires pending approvals — the one thing a lockdown must not leave redeemable —
and drops the gateway session so a reconnect must IDENTIFY, not RESUME.
`orion-lock release` restores listening and deliberately **not** authority.

### Position

0-39, 41, 42, 44 complete. Open: **40** (9/10, the 2026-09-08 move), **43** (8/9,
reauthentication is the only gap left), **45** (11/12, one Discord round trip).
Phase 46 must not start until that round trip happens.

Two new checks: `orion_v2_remote_check.sh` (25 assertions) and the extended
`orion_v2_lock_check.sh`, both running the real scripts against a scratch HOME
with live state hashed and asserted untouched. Eleven mutations, all killed.

---

## 2026-09-02 12:55 — The 34-40 review, and what it caught

An oblivious reviewer checked every requirement in phases 34-40 against the
code. **No dropped requirements. 34, 38, 39 and 40 sound. Real defects in 35, 36
and 37**, all repaired and mutation-proven, recorded under each phase in
`postReviewCorrections` (`4c800d9`).

**The two that mattered.**

*Phase 37: an experiment's finding was not computed over the experiment.*
`window` and `observed` were computed and used for `stage`, `observedDays` and
`confoundedDays` — then the association was built from `days`, the whole
history. A 14-day experiment printed "34 with, 14 without" beside "14 days
observed" on the same screen; out-of-window data **inverted the sign** of the
finding; `durationDays` had no effect at all. Nothing could catch it — mutating
`days:` to `window:` left the suite at 665/0.

*Phase 35: "late" contains "ate".* The meal row is checked before stress,
unwell, travel, screen and social, so it won: "Really stressed and worked late."
→ meal. "I procrastinated." → meal. The recorded limitation claimed the failure
mode was an honest low-confidence note. It was not, and Phase 36 eats these
categories directly. The vocabulary already carried `"ran "`, `"run "`, `"saw "`
with trailing spaces — the same bug patched one word at a time. Now word-boundary
matching with one inflection allowed; both halves proven by mutating in opposite
directions ("Had 2 coffees" breaks one way, "ranch" matches "ran" the other).

**Four assertions that could not fail** — the 40-vs-2 floor fixture (no jitter →
pooled spread 0 → returned before the floor was consulted), `originalText`
preservation (fixtures never changed the notes), the unreadable-journal check
(`!entries.isEmpty || lastError != nil`), and a zone precondition using
`?? TimeZone("UTC")` whose premise was false for `Mars/Olympus` anyway.

Also: the most common finding sentence read "Caffeine **is tends to coincide
with** lower recovery"; and Phase 35's clarification rule was narrower than its
record, so "Worked out late today." resolved to yesterday and asked nothing.

Counts: domain 394, sections 130, journal store 27, MobileCore 693, firewall 38,
location 20, timezone 18, Python 1,445. Secret scan clean, iOS build clean.

**Not reviewed: phases 41-45.** Same oblivious pass is worth running on them.

---

## 2026-09-01 23:45 — Phases 41-45, and one credential that unblocks three of them

The git failure below was TCC and the restart fixed it. Phase 40's seven files
are committed (`36ae8a0`); nothing is uncommitted now. Then 41 through 45 ran in
numeric order. Everything is pushed to `orion-v2/backlog-checkpoint`.

**Phases 41 and 42 are complete. 43, 44 and 45 are open, and not one of them is
open on unwritten logic.** Three of them are waiting on the same thing.

| Phase | | State |
|---|---|---|
| 41 Notification Engine | `4b49482` | complete, 6/6 |
| 42 Security Center | `0fd0f6b` | complete, 7/7 |
| 43 LOCK ORION | `40ee6e3` | 5 of 9 — three blocked need a transport |
| 44 Remote Connection | `9dda027` | 7 of 9 — **needs a Discord bot token** |
| 45 Remote Read-Only | `3a06d1f` | 9 of 10 — nothing serves the capabilities |

### The one thing Nick has to do

A **Discord bot token**, free, unrelated to the $99. It goes in the gitignored
`.env` as `ORION_DISCORD_BOT_TOKEN`, next to the existing
`ORION_DISCORD_WEBHOOK_URL` (which is the one-way OUTBOUND webhook and is not an
inbound channel). He adds it himself; no assistant should handle it in plaintext.

That single credential closes Phase 44's two blocked requirements, Phase 43's
three transport-dependent ones, and Phase 45's serving requirement.

**No transport was stubbed, deliberately.** A fake connector that pretended to
connect would make every policy test in Phase 44 meaningless.

### What was found, phase by phase

**41.** A near-miss assertion, caught by mutation and fixed by changing the
TEST. The next-brief time is a civil time, and the first test used 22:00 on the
London spring-forward night — where adding 86,400 seconds still lands on the
right day, so the mutant survived. The two only diverge in the last hour before
midnight: 23:30 GMT + 86,400s is 00:30 BST on the THIRTIETH, so the naive
version skips 29 March and the morning brief never fires. Also: urgency was
being decided TWICE (a `mayBreakThrough` switch beside the new level routing);
it is now derived, same answers, but it cannot disagree with itself.

**42.** A real defect, found by refusing to use a fixture. The automation panel
decodes the live `CURRENT_AUTHORITY.json`, and the new cross-language check fed
it the actual file: it failed on the first run because the `simulation` tier
emits `"flag": null`. A hand-written fixture would never have had a null, and
the symptom would have been a BLANK automation panel — which reads as "nothing
is allowed", the most dangerous wrong answer on a security screen. Also: all
seven actions the manifest allows take authority away or read, so
`SecurityActionEffect` has no `grantsAuthority` member, and locking ORION
removes nothing from that screen.

**43.** The panic button worked and was not rebuilt. What it lacked was a test —
it had been verified once by hand and left. It now has 14 assertions against the
real script through the real writer, in a scratch HOME. Measured rather than
asserted: the lock takes ORION from **78 of 78 catalogued actions reachable to
15**, across 3 tiers instead of 24. Four blocked requirements are registered
honestly; the one that does NOT depend on a later phase is that there is no
locked FLAG, only an inference — "is ORION locked" and "is ORION at its most
restrictive" are being treated as the same question and they are not.

**44.** The security test I wrote was itself the defect. "Never expose a public
server" is a negative, so it is scanned for — and the first scan looked for the
address alone and flagged `orion/web.py`'s SSRF denylist, a guard that names
`0.0.0.0` because it REFUSES it. A test that reports a security control as a
vulnerability is worse than none: the cheapest way to pass it is to delete the
control. The detector now needs a bind token too, and is itself tested against
lines it must catch and must not.

**45.** Two real gaps in live code. `scripts/orion-remote` stamps every envelope
with `at` and **never reads it back** — no age check anywhere in the file, so a
three-week-old envelope executes on delivery if its id is unseen. And it has no
device routing at all: an envelope has a sender but no target. Both are Phase 45
requirements the live inbound path does not meet. Close them when the transport
lands.

### Position

Phases 0-39, 41, 42 complete. Open: **40** (9/10, waiting on the 2026-09-08
move), **43** (5/9), **44** (7/9), **45** (9/10). Phase 46 must NOT start before
the read-only path actually works — registered as a blocked requirement so the
validator enforces it.

An independent review sweep over phases 34-40 was requested and launched.

---

## 2026-09-01 22:55 — UNCOMMITTED WORK, and why (read this first)

**Phase 40 work is finished, builds and passes, and could NOT be committed.**
Claude Code auto-updated mid-session: the running binary was
`claude-code/2.1.247`, and by 22:54 the only installed version was `2.1.255`.
macOS resolves the responsible process when granting access to a protected
folder, so with that binary gone every process spawned under `~/Desktop` started
getting `Operation not permitted` — including `git`, which cannot read
`.git/config`. AGENTS.md documents this trap; the fix is to restart Claude Code.
Nothing is wrong with the files or the permissions.

Diagnosed rather than assumed: plain file writes and `touch .git/.probe` both
still work, and the failure reproduces with the tool sandbox disabled, so it is
TCC and not the harness. `swift build --scratch-path <somewhere outside Desktop>`
is the workaround that let the work be finished and verified.

**First thing the next session should do**, after `git fetch && git status -sb`:

```
git add -A && git commit    # the seven files below
```

| File | State |
|---|---|
| `native/Orion/Sources/SessionDomain/AgendaPlacement.swift` | new |
| `native/Orion/Sources/SessionDomain/TravelMode.swift` | new |
| `native/Orion/Tests/SessionDomainTests/AgendaPlacementTests.swift` | new, 11 tests |
| `native/Orion/Tests/SessionDomainTests/TravelModeTests.swift` | new, 15 tests |
| `native/Orion/Sources/Orion/AppleCalendarSync.swift` | modified — uses AgendaPlacement |
| `planning/v2/PHASE_GATES.json` | phase 40 now 9 passed / 1 blocked |
| `CLAUDE.md` | position corrected to 0-39 complete |

Verified at 22:55: `swift build` clean, **393 domain tests, 0 failures** (was 367).

### What it delivers

Three of Phase 40's four blocked requirements, on Nick's instructions of
2026-09-01.

**A real calendar defect.** `AppleCalendarSync.events(on:)` decided which day an
event belonged to by comparing INSTANTS against `Calendar.current`. Right for a
timed event; wrong for an all-day one, which has no instant and gets given one
anyway — midnight in some zone. "8 September, all day" written in London is
stored as `2026-09-07T23:00Z`, which a New York calendar reads as the SEVENTH.
The event is simply on the wrong day and nothing errors. `AgendaPlacement` now
compares CIVIL DAYS for all-day events and instants for timed ones, and the span
is recovered once at fetch time in the event's own zone. Mutation-proven: the
old rule fails 445 assertions across the 443-zone sweep. The all-day end
off-by-one is DETECTED (is the end exactly on a day boundary?) rather than
assumed, so inclusive-end sources still come out right.

**Travel Mode** — a reading layer only. It never re-homes anything, because
`orion-timezone` is deliberately the only thing that touches live cron, and that
division is what makes it safe to switch on automatically. Displacement is read
AT THE INSTANT, so the fortnight when London has left BST and New York has not
reports four hours rather than five.

**Flights, and why they needed no new type.** Nick's call was that in-air
precision is not worth building for, and checking showed he was right about more
than that: EventKit stores a flight as two instants, already correct at both
ends. `Journey` is two `ZonedInstant`s — the existing type, used twice — and
adds only that each end is read in its own zone. The one genuine bug is pinned:
duration comes from the instants, because New York 18:00 to London 06:00 is
SEVEN hours and the wall clocks say twelve.

### Still blocked, and not code

`the_live_cron_weather_and_day_boundary_are_re_homed`. The cron jobs stay on
`America/New_York` until Nick actually moves. One command closes it:
`orion-timezone set Europe/London --place "London, United Kingdom"`.

### Then

Nick asked for **phases 41-45** next, and for an independent review sweep over
the 34-40 work afterwards. Neither has started.

**Position: Phases 0-33 complete, Phase 40 partially done, next work is Phase 34
onward in numeric order.** The program is tracked in the manifest's phase
NUMBERS and always has been.

The three 2026-09-01 entries below are titled "Batch A" and "Batch B". Those are
the names that day's sessions gave to two bundles of work, and they are kept
because the entries describe what actually happened. **They are not a plan and
there is no Batch C onward.** A lettered re-sequencing was proposed on 2026-09-01
and withdrawn the same day; `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`
explains what survived it. In phase numbers, Batch A was Phase 33 plus Phase 43,
and Batch B was Phase 40.

Each dated entry ends with the "Exact next step" that was true when it was
written. **Only the topmost one is live**; the others are kept so the reasoning
of the day survives. Entries before 2026-08-27 are in
`planning/_archive/HANDOFF-pre-2026-08-27.md`.

## 2026-09-01 BATCH B — London and the timezone, and a day key that was already wrong

Written 2026-09-01, same day as Batch A; the machine last booted 2026-08-29 13:22
and this session did not span a reboot or a day boundary.

Full reasoning: `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`, Batch B.

### The state I found, and where the record was imprecise

**Only ONE of the three cron jobs actually fires at the wrong hour.** The Batch A
handoff and the program correction both say "all three cron jobs are pinned
`America/New_York`", which is true, and then read that as "his morning brief
fires at the wrong hour in London", which is not. Measured:

    orion-focus-guard      * * * * *     every minute — zone-independent
    orion-standing-orders  0 * * * *     hourly — zone-independent for FIRING
    orion-daily-memory     10 2 * * *    02:10 New York = 07:10 London  <- the real one

`orion-standing`'s morning/evening choice and its quiet hours read the MACHINE's
clock, and macOS auto-timezone is on (`com.apple.timezone.auto Active = 1`), so
that half self-corrects on landing. The nightly memory rollup does not: it moves
from the dead of night to breakfast. Smaller than recorded, and worth stating
precisely so the next reader does not go looking for three bugs.

### A real defect, found while building the vocabulary and dormant until the move

`CutoffDayKeys` computed the 4am day boundary in its INJECTED calendar's zone and
then rendered it with a shared static `DateFormatter` that set a locale and **no
time zone** — so it rendered in the machine's. Measured, London calendar on this
New York machine:

    instant  2026-09-08T04:30Z   (05:30 in London, past the cutoff)
    dayStart 2026-09-08T03:00Z   key() -> "2026-09-07"     off by one

It survived 322 tests because those tests inject `America/New_York` on a machine
that IS `America/New_York`. The injection proved nothing — the same
self-verifying shape `AGENTS.md` already records three times. It goes live the
moment Orion's home zone and the machine's zone differ.

Fixed by deleting the formatter: the key goes through `CivilDay`, which has no
instant to render and therefore no zone to pick wrongly. The regression test
sweeps all 443 zones this system knows, so it fails on any machine rather than
only on one in the wrong zone.

### Phase 40 — the vocabulary, in SessionDomain

`ZonedTime` is a sum type and the enforcement is that **it has no `instant`
property**. A `.moment` carries `ZonedInstant` (UTC instant + anchoring zone +
original zone); a `.day` carries `AllDaySpan`, which has no instant at all.
Getting time out of an all-day value requires naming a zone at the call site,
where it can be reviewed. That is "never rely on plain local datetime strings"
made structural rather than aspirational.

`rezoned(to:)` keeps the moment and `reanchored(to:)` keeps the wall clock. Both
exist, with names that cannot be confused, because picking the wrong one shifts
an appointment by the offset between the zones and nothing complains.

**Alternatives rejected.** An `isAllDay` flag beside an instant is the obvious
model and it is the bug: an all-day value that has an instant has already had a
zone chosen for it invisibly. Storing a fixed offset instead of an IANA name is
the other one — `GMT+0500` is right for half the year.

### Five facts measured rather than assumed, each now pinned by a test

- **Foundation's `JSONEncoder` escapes forward slashes**, so a stored zone reads
  `Europe\/London`. Legal JSON, but this format is a cross-language contract and
  anything reaching for a substring rather than parsing will miss it.
- **`TimeZone(identifier: "UTC").identifier` answers `"GMT"`.** Storing `UTC`
  means reading back a name nobody wrote, so it is refused. All 443 accepted
  names round-trip byte for byte; that is the invariant the strict set buys.
- **Foundation and ICU canonicalise 47 zone names differently, in BOTH
  directions.** ICU says `America/Buenos_Aires` and has never heard of
  `America/Argentina/Buenos_Aires`; Foundation is the exact opposite, and ICU
  rewrites Foundation's `America/Nuuk` to `America/Godthab`. The safe direction
  is that Foundation preserves everything ICU canonicalises, but not vice versa.
- **Round-tripping is not a safe validation rule in Foundation**: `GMT+0500`,
  `EST`, `Zulu` and `Etc/GMT+5` all round-trip. So the accepted set stays the
  strict known list.
- **`Calendar.date(from:)` is lenient**: 2026-02-29 rolls forward to 1 March, and
  then asking that date's month whether it has a 29th says yes — so the obvious
  validation accepted every invalid date it was written to reject.

### The operational half

`scripts/orion-timezone` — `status`, `plan`, `set`, `expect`, `clear-expected`.
Idempotent, dry-runnable, and it verifies by RE-READING the cron jobs rather than
trusting exit codes; if any job did not move, the record is not written, because
a record ahead of the world is the failure this whole batch is about.

`location.json` holds home, place and an `expectedMove`, in exactly
`TimeZonePolicy`'s Codable shape. A trip and a move are indistinguishable to the
OS, so the move is a fact recorded in advance and arriving at the recorded
destination is what makes a mismatch a move.

`orion-standing` now reports a home-versus-machine mismatch — in the morning and
evening checks only, **never** in the hourly one. An hourly "your timezone is
wrong" is exactly the nag that gets a proactive assistant muted.

`orion-weather-alert` no longer hardcodes `"Montvale, New Jersey"`; it reads
`location.json`'s place, with Montvale kept only as the no-record fallback.

`scripts/orion-project` plus `projects.json` — the London move with four dated
milestones, surfaced by the morning check three days out and reported as
unaccounted-for rather than silently rescheduled if a date passes. Kept
deliberately tiny (milestones with dates; no dependency graph, no scheduling) and
registered in `scopeNotInManifest`, because no phase defines a project and adding
modules with no live consumer is how this repo got three stacks.

`USER.md`, both copies — **Northeastern restored.** The 2026-08-14 rewrite lost
the university; the archive says "Eastern University" because it was dictated by
voice. The timezone line now points at the record instead of promising to ask
once, since the 2026-07-31 promise expired in silence: a date written in prose
has nothing watching it.

### Verification

native/Orion **367** (was 322), location contract **20**, timezone set **18**,
Python **1,437**, plugin **146/146**, phase-gate validator clean.

**The one command Nick actually runs was exercised, not just written.**
`run-timezone-set-test.sh` drives the real script against a fake gateway over 18
checks — happy path, idempotence, a job the gateway refuses, and five zones that
must be refused before anything is touched. The load-bearing assertion is that a
failed re-home **does not write the record**; both mutations of that path are
caught.

And once for real, reversibly, against the live gateway at 12:41–12:43 EDT,
because a fake cannot prove `openclaw cron edit --tz` does what I assumed:

    set Europe/London     -> all three moved; orion-daily-memory's next run went
                             from 02:10 to 21:10 New York local, which IS 02:10
                             London. The gateway honours the pin.
    set America/New_York  -> all three back; next run 2026-09-02 02:10 local
    expect ... restored   -> location.json diffs byte-identical to the pre-test copy

This is the lesson `orion-lock` already paid for: a command nobody has run is a
command with a bug in it.

**Mutation tested, eight mutations.** Seven caught. The one that survived was a
flaw in my code, not a gap in the tests: `verdict` had two identical branches,
which made `arrivedOnTime` look like it gated the destination case when it never
did, and made a comment claiming the device-zone reading was load-bearing simply
false. Collapsed to one branch, comment corrected to say what is actually true,
and the collapsed branch is now itself mutation-covered.

The contract harness is mutation-proven in the way that matters: removing the
zone translation table makes `orion-timezone` write `America/Buenos_Aires` and
the Mac app then REFUSES the file — the exact silent breakage it exists to stop.

### Live and installed state

Changed on the live machine: `location.json` and `projects.json` created,
`~/.openclaw/workspace/USER.md` rewritten. **No cron job was touched, no
permission changed, no rebuild, no install.** The installed app is still build
121 and contains none of today's Swift changes — Batch A's or Batch B's.

Rollback, all in-repo:

    git revert <this commit>                       # the code
    git show 184c4a5:openclaw-workspace/USER.md > ~/.openclaw/workspace/USER.md
    rm ~/.openclaw/orion-controlled/location.json ~/.openclaw/orion-controlled/projects.json

`location-audit.jsonl` records every change with its previous value, and
`orion-timezone` prints the undo command after every `set`.

### What is deliberately NOT done, and why

**The cron jobs are still on `America/New_York`.** Nick is in New York until
about 09-07; re-homing today would be wrong for six days. The single command is
`orion-timezone set Europe/London --place "London, United Kingdom"`, it is
dry-runnable with `plan`, and `orion-standing` will raise it the morning after he
lands. Recorded as a blocked requirement, not quietly omitted.

Also blocked and registered: the existing calendar UI still uses
`Calendar.current` and a bare `Date` plus an `isAllDay` flag — the vocabulary
exists, migrating the app to it is bigger than Batch B; and flights, an event
anchored to two different zones, which the travel tests do NOT cover (they cover
a device changing zones, which is a different thing).

### Exact next step

**Phase 34 — ORION Health UI**, and then 35, 36, 37, 38, 39 in order. Phase 33
closed on 2026-09-01 and 34 is simply next. Read the manifest text at
`~/Desktop/Orion v two implementation plan.md` line 1200, write
`planning/v2/PHASE_34_PLAN.md`, then build.

One thing to carry into Phase 34: the health work of 2026-09-01 built Phase 33's
firewall against the live Mac app and, in passing, delivered some of the shape
Phase 38 asks for. Phase 38 has **no** record in `PHASE_GATES.json`, so treat it
as not started and check what already exists before rebuilding it.

Two open items that are NOT next, and must not be mistaken for the head of the
queue:

- **Re-pointing the Phase 1 and Phase 5 records onto the live TypeScript gate**
  (`permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` + the
  ledger), demoting `orion/security` to a conformance oracle. Nick delegated
  this call on 2026-09-01. It is a correction to two CLOSED phases' records, not
  a position in the sequence, so it does not block Phase 34 and Phase 34 does not
  block it. Do NOT route the live route through the Python engine —
  `planning/v2/PHASE_1_RUNTIME_DECISION.md` forbids it. Widen
  `orion_v2_policy_check.py` first: its "390 combinations" is parity at one point
  in a five-dimensional space, and at `external_connected` with
  `external_data_involved=True` it gives 54 stricter and 25 DENY, including
  `messages_send` and every `self_*` action.
- **The 2026-09-08 re-homing**, which is on a clock rather than in the queue. The
  London milestone comes due that day and
  `orion-timezone set Europe/London --place "London, United Kingdom"` is the one
  command that moves the cron jobs, the weather default and the record together.
  Whatever phase is running then, do not let it swallow this — it is the reason
  the timezone work was pulled forward at all.

## 2026-09-01 BATCH A COMPLETE — Phase 33 built against the live app, and an off switch

Everything here was verified against the running system, not the v2 backend.
Full reasoning: `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`.

### ElevenLabs, fixed — and it was never the credential

Two faults. The TTS daemon was killed 2026-08-18 (`signal 15 -> shutting down`)
and nothing restarted it: its launch agent has never been installable, because
**launchd cannot read `~/Desktop`** and that is where the repo lives. And even
running, it needs `ORION_TTS_CLOUD_VOICE=1` — without it the daemon logs
`elevenlabs key found but not selected` and quietly serves the local MLX voice,
which is why it sounded wrong rather than silent. Started the way
`launchers/Choose Orion Voice.command` does. First success since 2026-08-13:
`ok provider=elevenlabs engine=elevenlabs first_ms=633`.

**Still open:** nothing supervises that daemon. It will stay dead next time.

### Phase 33 — the health privacy firewall, against v1

The live Mac app was violating it. `HealthSummary.swift:71,76` emitted
`"- HRV 116ms"` and `"- Resting heart rate 54"` into a model prompt;
`MorningBrief.swift:86-92` added sleep score, recovery and an HRV delta and then
asked the model to tie recovery to the calendar — Phase 38 shipped before Phase
33's firewall existed, fed exactly what the firewall withholds.

`PlanningSignal` is the boundary. Categories cross it; numbers do not.

- Vocabulary is MobileCore's **by type**, which required adding
  `.package(path: "../OrionMobile")` to the Mac app — **the first real wire
  between the two stacks.** MobileCore had no consumer but its own harness.
- The reason string is deliberately NOT `HealthStateReading.reason`, which embeds
  raw values and would have leaked through the reason field after the numbers
  were stripped everywhere else.
- Type-narrowed: `HealthFacts` no longer HAS the raw fields. `BriefFacts` keeps
  them nested under `.readings` for the ring meter, and `prompt()` never mentions
  `readings`.
- Two deviations REGISTERED rather than improvised: the manifest's
  `confidence = 0.81` would reopen Phase 32's categorical gate, and
  `cognitive_capacity` is a projection of `EnergyState`, not a seventh state.

Enforcement is numeric: `run-health-firewall-test.sh` pulls every number out of
the generated prompt and compares it against the day's measurements. 38 checks,
mutation-proven. It also asserts a POSITIVE, so deleting the health block fails.

### Focus sessions expire

Yours was not stuck — it was **paused**, and a paused session waits forever by
design. Right for an hour, wrong for twenty days: started 2026-08-12, last
state-change 08-19, still accruing heartbeats on 09-01. `SessionStatus` gains
`readyToAbandon`, mirroring `readyToComplete`. Measured from the last event, not
`dayKey`, because a day key needs a timezone. 318 -> 322 tests, mutation-proven.

### LOCK ORION (Phase 43) — `scripts/orion-lock`

The manifest's own precondition for anything dangerous, and it did not exist.
Drops the profile to `restricted_read_only` and disables every cron job. It does
NOT kill the gateway (a dead gateway cannot be asked why it is dead) and does NOT
write `permission-state.json` itself — it calls the plugin's own
`changePermissionProfile`, so the audit lands before the state under the same
lock. Verified against COPIES: `external_connected v3 -> restricted_read_only
v4`, audit written, second run `unchanged`.

That test caught a bug in the script: it checked for a status of `"applied"`,
which the writer never returns. A successful lockdown would have reported failure.

### Two things I deliberately did not "fix"

**Camera presence.** 504 failures, 0 successes, authorised throughout. The
likely cause is that 1.5s covers both warm-up and first frame. Raising it to 4s
broke `testTheDutyCycleIsUnderTwoPercentAsClaimed` — the privacy promise is a
TESTED invariant, not prose. Reverted; the diagnosis and the two real fixes are
recorded at the constant. Kept the improved failure message, which now names the
device.

**Sparkle.** The feed is a literal `ORION_OWNER/ORION_REPO`. Pointing it at the
real repo would not help — it is private and there is no appcast or release. So
automatic checks are now left off when the feed is a placeholder, and the log
says what is actually missing rather than blaming the network.

### Verification

native/Orion **322**, health firewall **38**, MobileCore **335**, Python
**1,437**, plugin **146/146**, secret scan clean over full history.

### Live and installed state

The TTS daemon is now RUNNING (started by this session, serving ElevenLabs). No
rebuild, no install, no gateway restart, no permission change — the lockdown path
was proven against copies, never against live state. The installed app is still
build 121 and does NOT contain any of today's Swift changes; they take effect on
the next `make_app_bundle.sh`.

### Exact next step

**Batch B — London and the timezone**, and it has a real deadline. Nick moves
around 2026-09-07, Northeastern starts 09-07, he lands 09-08 with welcome week as
buffer. All three cron jobs are pinned `America/New_York`. Also: the archived
`USER.md` recorded the move as being to attend **Northeastern** — the current one
lost the university entirely in the 2026-08-14 rewrite, and the archived copy
says "Eastern University" because it was dictated by voice.

## 2026-09-01 PROGRAM CORRECTION — the ordering was derived from a fiction

Seven independent fresh-context audits: the Mac app, the live execution path, the
v2 stack, manifest phases 33-84, the plan lineage, a Core-convergence design and
a full re-sequencing. Full record: **`planning/v2/PROGRAM_CORRECTION_2026-09-01.md`**.

Nothing live was changed. No code was written. This is a re-planning pass.

### Found state, and where the previous record was wrong

There are **three** systems and the manifest describes none of them. The Mac app
(35,433 lines, 40 SwiftUI files) plus the OpenClaw plugin (12,079 lines, 78
actions, 24 tiers all reachable) is the live product. The Python package is dead
-- the running assistant's own `MEMORY.md` declared it "not the implementation
path" on 2026-07-28. The v2 backend cannot serve a request.

**The manifest contains zero occurrences of "OpenClaw" in 2,644 lines.** Its
Phase 0 says "Document the current Python runtime" and "Document how the current
UI communicates with Python." The UI talks to a Node gateway by CLI subprocess.
Phase 0 inventoried a system that was not running, three weeks after the
assistant had recorded that fact. Every phase number downstream inherits it.

**The requirements are sound. The ordering is not.**

### The correction that matters most

ORION Core is not missing. It exists, in TypeScript, on the live route:
`permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` + the
append-only ledger. Five ordered layers with documented incidents behind each.
`orion/security/profiles.py` already concedes it: *"permissions.ts stays the
authoritative gate on the live route."*

So Phase 1's exit gate closes by **re-pointing the record**, not by a
cross-language rewrite -- which `planning/v2/PHASE_1_RUNTIME_DECISION.md`
already forbids ("must not make every live turn cross into a second Python
process"). The Python engine becomes a conformance oracle, and
`orion_v2_policy_check.py` -- which already shells into the compiled live plugin
-- becomes a blocking CI gate.

### A third self-verifying mechanism, and the sharpest one yet

`orion_v2_policy_check.py:baseline()` pins `external_data_involved=False` and
`request_source="user_direct"`. Its docstring is honest. The headline is not
wrong either -- but "never more permissive across 390 combinations" reads as
system-wide parity when it is parity at one point in a five-dimensional space.
Measured at `external_connected`:

    baseline                        stricter= 14   DENY=  0
    external_data_involved=True     stricter= 54   DENY= 25
    request_source=model_initiated  stricter= 19   DENY=  0

The 25 denials include `browser_open_url`, `messages_send`, `calendar_event_add`,
`file_delete` and every `self_*` action. Recorded in `AGENTS.md`: state the SCOPE
of a parity result, not just its verdict.

### Nick's own ranked gaps, re-checked -- two are already done

From `WHAT_ORION_IS_MISSING.md` (2026-07-30). #1 proactivity is **LIVE**:
`orion-focus-guard` every minute, `orion-standing-orders` hourly,
`orion-daily-memory` nightly, all reporting `ok`. #2 memory retrieval is **DONE**:
`orion-recall` does semantic search with `nomic-embed-text` local; the
`content LIKE '%query%'` he diagnosed is dead code in the dead package. #5 taint
was done pre-manifest. The program has delivered more than its records show --
just not through the manifest.

### Live defects found, dated

- **Timezone.** Three cron jobs pinned `America/New_York`. `USER.md`: "Moving to
  London before the end of August 2026" / "ask once afterward." It is 2026-09-01,
  machine still EDT. Orion was told to ask and the deadline passed.
- **The live app violates Phase 33.** `HealthSummary.swift:71,76` emit raw HRV
  and resting heart rate into a model prompt; `MorningBrief.swift:86-92` adds
  sleep score, recovery %, HRV delta; `:133` ties recovery to the calendar. That
  is Phase 38 shipped before Phase 33's firewall exists.
- **A focus session wedged open since 2026-08-12**, last heartbeat
  2026-09-01T01:25:46Z. Two completed sessions ever, both abandoned under 25s.
- Camera presence: 504 failures, 0 successes, enabled. Sparkle on a placeholder
  feed. `Info.plist` claims calendar is read-only while the code deletes events.
  Installed app 14 commits behind.

### The corrected sequence

A stop the lying + an off switch (3-5d) · B London/timezone (3-4d) · C close the
1/5 gate honestly (8-12d) · D situational awareness + explainability (4-6d) ·
E proactivity widened (10-15d) · F cost then reach (4-6d + credential) ·
G delegation, gated · H the register.

Proactivity is fifth **because it already works** and building it before the off
switch, the timezone fix and the interruptibility signals would ship the version
that gets muted -- which his own document names as the failure mode.

### Corrected, from the previous session's framing

I had said closing the Phase 1/5 gate unblocks 44-56. It does not. Those are
blocked by a transport, a credential only Nick can create, and a phone. Phase 5's
precondition is a self-imposed policy gate. Conflating them would put a large
refactor on a critical path it does not sit on.

### Live and installed state

Unchanged. No plugin edit, no rebuild, no install, no gateway restart, no config
write. `~/.openclaw` was read only. The gateway is running (PID observed) and the
three cron jobs continue.

### Exact next step

Nick answers the six questions now at the top of `NICK-TODO.md`. Batch A needs
none of them and can start immediately; Batch B needs question (a).

## 2026-08-28 Phases 11-20 REVIEWED and repaired -- REC-REVIEW-11-20 closed

**Dates, and why three of them appear.** The review and repairs ran 01:20-23:59
on **2026-08-28** (`date` checked at both ends). The handoff was written at 00:00
on the 29th. The machine then rebooted — `kern.boottime` says Sat 2026-08-29
13:22 — and this session resumed afterwards, so the **commits are stamped
2026-09-01**. Nothing was back-dated and no commit date was faked: the documents
carry the date the work happened, git carries the date it was saved, and they
differ by three days. `AGENTS.md` warns that a long session can span a day
boundary; this one spanned a reboot and three of them, which is the same trap
with more room in it.

Full report: **`planning/v2/PHASE_11_20_REVIEW_REPORT.md`**. Per-claim
corrections: `PHASE_GATES.json` -> each phase -> `postReviewCorrections`, with
every original claim preserved verbatim beside them.

### Found state, and where the previous record was wrong

The 32.5 checkpoint's tail was accurate for once — nothing in the tree was newer
than `planning/v2/HANDOFF.md` at 23:54 on the 27th, and the only later Codex
activity was guardian-review threads for an unrelated project. Both baselines it
claimed reproduced exactly: **1,375 Python, 293 Swift**.

What it could not know: five of the ten phases were not complete as claimed, and
**64 defects** were waiting. Six independent reviewers, one to three phases each,
given the manifest, the exit claims as claims under audit, the tree and the
commands — and none of the implementer's narrative.

### The finding worth carrying forward

Three mechanisms verified themselves **against themselves**, all three cited as
evidence: the migration checksum was assigned from the live checksum (`x == x`),
`is_wall_clock_free` compared two identical objects, and `MIGRATIONS` is
generated from the `SCHEMA` that `drift()` checks it against. A fourth pattern —
counts pinned instead of contents — let two manifest sections be replaced by
"Steps" and "Calories" with all 293 checks green.

That is a different failure from a wrong claim. It is infrastructure built to
produce a green result, and it survives review by looking like evidence. All of
it, plus five other recurring shapes, is now in `AGENTS.md` under "Traps that
have already bitten".

### Worst defects (all repaired, all mutation-proven)

- **13**: `sign_in` verified `account` and minted the session for a separate
  caller-supplied `user_id`. `routes.py` declares that route unauthenticated —
  full account takeover once a handler filled it from a request body.
- **14**: `adopt()` produced a `DeviceTrust.PAIRED` device with no signature and
  no verifier, on the registry where `register()` raises `VerifierUnavailable`.
  The requirement it falsifies is named `nothing_is_trusted_without_a_verifier`.
- **14**: `_key_id` truncation made two device ids collide on `signing_key_id`,
  defeating the origin-device binding in `rules.py:300`.
- **15**: `confirm()` never checked `revoked`, so revoking a compromised Mac
  mid-pairing still handed the attacker a permanent new device.
- **17**: `acknowledge()` silently deleted a re-queued offline edit — the user's
  own correction, on the path the class exists for. `since(cursor)` never
  returned edits at all.
- **18**: untrusted scraped text became durable memory for a year, by three
  independent routes.
- **20**: the classifier auto-saved ambiguous captures at 0.76 against a 0.75
  floor, because `contains("my ")` matches inside "Jimmy", "academy", "enemy".
- **19**: a full Today screen could never be refreshed, and four of eight
  sections could never appear.

### Verification

| | before | after |
|---|---|---|
| Python | 1,375 | **1,437** |
| Swift (MobileCore) | 293 | **335** |

iOS simulator build clean. `schema`, `policy`, `audit`, `capability` and `sync`
checks all OK. Secret scan clean (25 reviewed findings, with
`--allowlist planning/v2/secret-scan-allowlist.json` — without it, it reports
them as unexpected).

Every repair was mutation-tested. Two nearly lied and are recorded in the report:
a Phase 15 mutation first hit the wrong `if offering.revoked:` and an *existing*
test caught it; and the Phase 18 fix is two guards, so the type invariant was
mutated out alone to prove the direct-construction tests stand on their own.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no install, no gateway
restart, no config write, no account touched. `~/.openclaw` was read only.

### Not repaired, registered instead

Three items in `PHASE_GATES.json` under the review entry: MobileCore's `Message`
has no `revision` field (so the phone resolves conflicts by arrival order while
the server resolves by revision), `Throttle`'s `source_hash` is caller-declared
and needs a request pipeline to fix, and no repository checks that a referenced
row belongs to the same owner.

Two historical claims are irreconcilable and no replacement numbers were
invented: gates 14 and 15 both claim `867/867` though 831 + 36 = 867 means
Phase 14's count already included Phase 15's tests; gates 19 and 20 both claim
`103 Swift checks` on the same day though Phase 20 added 19 after Phase 19.
Neither is reconstructible — the batch is uncommitted.

### Rollback

File-level; nothing was committed. The touched files are listed in the report's
section 7. Note `git checkout` does nothing for the untracked ones (`backend/`,
`native/OrionMobile/`, most of `tests/`) — reverting those means deleting them.

### Commit checkpoint — 2026-09-01

Seven commits on branch **`orion-v2/backlog-checkpoint`**. `main` is untouched
at `1efd37c`, so this is reversible with `git branch -D` and nothing else.

```
1c9c503 feat: Keychain-backed provider secrets, a strict-argument flag, and TTS work
2ca9e9c docs(v2): phase records, capability charter, and the Phases 11-20 review
e1651a3 test(v2): read-only check scripts and the unit suites
6899867 feat(v2): MobileCore domain layer and its self-check
4ab0f9a feat(v2): task, planning, calendar, Gmail and connector backends
5819ca8 feat(v2): backend foundations -- database, vault, auth, devices, pairing, sync, memory
c26272f feat(v2): core contracts, security vocabulary and Mac ledger adapters
```

231 files, 49,061 insertions. Working tree is clean for the first time in this
program's history.

**This is a LOCAL commit, not a remote backup.** Nothing was pushed. If this Mac
dies, this work dies with it. Pushing is a separate decision Nick has not made.

Grouped by subsystem rather than by phase, deliberately. Nothing here was ever
committed, so there is no earlier state to reconstruct a per-phase history from,
and manufacturing one would fabricate a sequence that did not happen — which the
Phase 32.5 charter explicitly forbids. The real sequence lives in
`PHASE_GATES.json`.

The non-v2 work (Keychain secrets, the strict-argument flag, TTS and
orion-doctor) is the other assistant's, committed last and alone so it can be
reverted on its own. Nick confirmed it was in scope. Verified rather than
assumed before committing: plugin **146/146**, native/Orion **318/318**, and
`openclaw.plugin.json` matches its source, so the generated manifest was
regenerated properly rather than hand-edited.

Also cleared on the way: a **zero-byte `.git/index.lock` dated 2026-08-20 13:57**
had been blocking every write to the index for twelve days. No git process was
holding it -- it is a leftover from the crash-era commits `AGENTS.md` records
around the 18th-20th. Checked for a live process before removing it.

Secret scans clean before and after: source, and full history across all
reachable commits (37 reviewed findings allowlisted). `.env`, `.env.save` and
`.builds/openclaw.json.*` remain untracked; only `.env.example` is in history,
which is the intended template.

### Exact next step

`REC-REVIEW-11-20` is closed. `REC-OPERATIONS` is not: the mixed-backlog
grouping plan still needs Nick's approval before anything is staged. The
inventory is done — **230 stageable paths**, not the 136 that `git status
--short` shows, because it collapses whole untracked directories into one line.
`native/OrionMobile/.build/` (2,637 files) is correctly gitignored, verified with
`git check-ignore`.

Non-v2 work is tangled in and must be separated, some of it possibly Nick's:
`VoiceProviders.swift` (+42), `orion_tts_daemon.py` (+116), `orion-doctor` (+21)
and 104 added lines across the OpenClaw plugin `src/`.

After that checkpoint: the connected-product batch, which is blocked on Nick's
provider/budget decision and the Google Cloud project in `NICK-TODO.md` item 9.
Phase 33 (Health Privacy Firewall) remains the next numbered phase and is still
not started.

## 2026-08-27 Phase 32.5 COMPLETE — capability charter and product gap review

Documentation and guidance only; no product code, live configuration, install,
restart, account connection, permission, provider choice, Phase 33 work, commit
or push occurred.

The new source of truth is
`planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md`, with stable additive recovery and
capability IDs in `planning/v2/ROADMAP_AMENDMENTS.json`. It records the product
goal and direct-request authorization semantics, gives missing backend/client/
connector/authority work explicit homes, and preserves the original 0-84
numbering and manifest fingerprint. Root `CLAUDE.md` and `AGENTS.md` now route
fresh assistants through it.

The consolidated independent-review array names Phases 5-10, 21-30 and 31-32,
not 11-20. Earlier 0-10 summary wording needs Phase 0-4 review provenance
reconciled; implementation/live proof is not the same as independent review.
`REC-REVIEW-11-20` is the next
recovery item before another implementation batch. Phase 33 remains not started.

Current proof remains narrow: MobileCore passed 293 checks and compiled for the
iOS simulator using per-command `DEVELOPER_DIR`; that is not a working iPhone
UI. The new v2 backend still has no proven deployed API/database, durable
repositories, production crypto adapters, real Google transport or real
HealthKit acquisition. Existing Mac/OpenClaw capabilities predate v2 and are not
erased by those limitations. Approval reuse and missing durable authority state
remain pre-live blockers.

The existing phase checker reads the `phases` object, not the separate additive
`REC-*` register. No mechanical enforcement of those checkpoints is claimed.
The charter now specifies the backend/client/read-only integration sequence, UI
acceptance brief, direct-request authorization examples and a mixed-backlog
recovery plan. Future requested batches end with independent review, repairs,
an educational report and authorized local commits; no remote push is implied.
Roll back by removing the three new repository files and only their added
pointers/sections; preserve earlier edits in the dirty tree. Nothing live needs
rollback.

Completed verification after the initial documentation task hit its usage limit:
**10 focused phase/traceability tests passed**, Phase 32's gate passed, document
consistency/fingerprint/link checks passed, and the changed-doc whitespace check
passed. Phase 33 remains unopened, the index is empty and HEAD is unchanged.
See the v2 handoff for reproducible commands. Claude's read path is linked;
an already-running context still needs to explicitly refresh it.

## 2026-08-27 Phases 31-32 COMPLETE — health baselines and derived states, then reviewed

Two phases, then a third independent review. Stopping here at Nick's instruction.

**Dates, corrected before you read this.** The Phase 31 plan was written on
2026-08-26; everything else here -- the review of 21-30, all 36 repairs, both
of Phases 31 and 32, and the review of them -- happened on **2026-08-27**. The
first draft of this entry and the gate records said the 26th, because the
session opened on the 25th and I carried that date forward instead of running
`date`. That is the trap `AGENTS.md` records verbatim, and it caught me. All
affected records are corrected.

### What was built

**Phase 31 — Health Baseline Engine** (`MobileCore/HealthBaseline.swift`). Six
personal baselines, computed locally. Below seven observations there is **no**
baseline — `nil`, not a low-confidence number. Median and MAD throughout, so one
two-hour night after a flight does not move anything. **There is no population
table**: the usual implementation of "do not compare users against generic
population scores" is a fallback, which then gets used every time the personal
baseline is missing — exactly when the comparison is least useful and most likely
to be believed.

**Phase 32 — ORION Health State** (`MobileCore/HealthState.swift`). Six derived
states, all categories, no scores. `reason`, `baseline`, `confidence` and
`freshness` are required — the initialiser is failable and an empty reason
returns nil. "Not a diagnosis" is enforced by a 23-stem clinical word list run
over **ORION's own** vocabulary, values and reasons both. A state that cannot
spell a diagnosis cannot deliver one.

### The review, and what it found

**Verdict: 31 complete with one requirement untrue as written; 32 not complete as
claimed.** Eleven corrections, each mutation-tested.

**A crash.** `trainingLoad` had no `isFinite` filter — unlike `baseline()`
twenty lines above it — so an infinite sample made acute and chronic both
infinite, `chronic > 0` passed, and the ratio was NaN. Phase 32's
`Int((ratio * 100).rounded())` then trapped. The requirement's own sentence says
it: *"a division that can produce a special value is a division that will."*

**A defect that inverted the rule both phases are built around.** The gate said
"values **and spreads** are quantised", which was true and was the bug. A person
sleeping 466–494 minutes has a real spread of 14; quantised at low confidence it
reported **0**, the consumer's `max(spread, 1)` floor made that one minute, and a
fifteen-minute difference became `wellBelowBaseline`. That fabricates
*certainty* — the same sin as fabricating precision, pointed the other way, in
the phase written to prevent it. The spread is no longer quantised;
`reportedSpread` is for display and `comparisonSpread` floors on the kind's own
finest step rather than a bare `1`, because one bpm and one step are not
comparable quantities.

**The structural finding, which is the useful one.** 23 of 42 Phase 32 guards
survived mutation — the whole of `energyState` (hardwiring `.high` went
unnoticed), `stressTrend`'s direction, all four divide-by-zero floors. The cause
was named exactly: **no Phase 32 assertion consumed a Phase 31-produced
`Baseline`.** Every fixture was hand-built with a hand-chosen spread, so nothing
exercised what the engine actually emits — which is also why the quantised-spread
defect was invisible. Forty-one assertions now run over real baselines.

**And a fixture that lied.** The check hedged `acuteSamples == 8 || == 7`. That
OR was covering an off-by-one whose real cause was that the most recent fixture
night *ended seven hours after `now`* — so "twenty sessions" contributed
nineteen, and a baseline made entirely of future-dated samples read as perfectly
fresh. Both the code and every fixture are fixed and the hedge is an equality.

### Three reviews, three times the same lesson

| Review | Scope | Verdict |
|---|---|---|
| 2026-08-25 | Phases 5-10 | 3 not complete as claimed |
| 2026-08-26 | Phases 21-30 | 5 not complete as claimed |
| 2026-08-26 | Phases 31-32 | 1 not complete as claimed, 1 with a false requirement |

Every one has found claims **false at the moment they were written** rather than
code that drifted: a cited test that did not exist, a count that was wrong, a
guard tested for "without either" while claiming "without both". The gate prose
is written by whoever did the work and nothing checks it, which is the whole
reason this ritual exists.

### Verification

| | before this session | now |
|---|---|---|
| Python | 925 | **1,375** |
| Swift checks (MobileCore) | 103 | **293** |
| native/Orion XCTest | 318 | **318** (untouched) |
| Plugin | 146 | **146** (untouched) |

iOS simulator build clean, import boundaries clean, secret scan clean.

### Live and installed state

**Nothing live changed, at any point.** No plugin edit, no rebuild, no install,
no gateway restart, no config write, no live smoke, no Anthropic spend. Nothing
committed; HEAD is still `1efd37c`.

### Rollback

Delete `MobileCore/{HealthBaseline,HealthState}.swift` and
`planning/v2/PHASE_3{1,2}_PLAN.md`, revert the health-baseline and health-state
blocks in `MobileCoreCheck/main.swift`, and the 31-32 blocks in
`PHASE_GATES.json`, `MANIFEST_PHASES.json` and `MANIFEST_TRACEABILITY.md`.

### Next

**Phase 33 — Health Privacy Firewall.** It must pass DERIVED states to the
planner and never a `Baseline`: a Baseline still carries a raw value and a unit,
which is exactly what the firewall exists to stop reaching the planner. Phase 32
already produces the right shape.

Two things ahead of it in importance, neither of them a phase:

1. **An approval is still not consumed by use** (Phases 25 and 29). The same
   approved preview authorises the same action indefinitely, so a retry loop
   becomes a mailing. This should close before any transport exists.
2. **Nothing persists.** Authorization ledgers, baselines, tasks, classifications
   — all in memory. Several rules (incremental permission requests especially)
   are not real until they survive a restart.

`NICK-TODO.md` items 2 and 10 are one purchase: the Apple Developer Program
unlocks both the Keychain fix and the HealthKit entitlement, without which none
of Phases 30-32 can read a single sample.

## 2026-08-27 Independent review of Phases 21-30 — five phases were not complete as claimed

Ran 2026-08-26, repairs applied 2026-08-27. Three oblivious agents were given
the manifest, the repo and the commands, and
told to verify claims rather than trust them. They ran ~190 mutations, fuzzed the
planner over 400 random populations, and attacked both approval fingerprints and
the reply-addressing path directly.

**Verdict: 23, 24, 26, 28 and 30 were not complete as claimed.** 36 corrections
applied, each mutation-tested. Python **1375/1375** (was 1322), Swift **152**
(was 140).

### The one that is not a code defect, and matters most

**Phase 26's gate cited evidence that did not exist.** It claimed the URL encoder
was "differential-tested against `quote` on 3,000 random strings". That run
happened — in a shell, in a session that no longer exists — and the repository
contained nine hard-coded cases. The conclusion was right; the reviewer re-ran it
at 5,000 strings and found zero mismatches. But evidence nobody can re-run is not
evidence, and this program's gate prose is written by whoever did the work with
nothing checking it. The test now exists and is seeded.

This is the second review in a row to find claims that were **false at the moment
they were written**, rather than code that drifted.

### The two real bugs

**`plan()` dropped a task whose dependency was in the plan** and told the person
*"waits on a_dep, which is not in this plan"* — while a_dep was right there.
`sort_key` is not topological and `placed_ids` was built in its order. **227 of
400** random populations. The original test missed it by luck: its two objects
had equal durations, so the id tiebreak ordered them correctly. Fixed with Kahn's
algorithm taking the sort_key-smallest ready object, so determinism survives.

**`replan()` deleted an already-placed task from the day after a thirty-minute
meeting** — with eleven free hours in the window. Kept placements went to the
sub-plan as opaque time blockers and never as settled ids, so a dependent of a
kept object was reported BLOCKED and vanished. **20 of 400.** This is the exact
failure the manifest's "avoid reshuffling the user's day" exists to prevent.

### Guards attached to the wrong thing

A pattern across three phases: the guard existed, was mutation-tested, and was
attached to a *function* while the *type* stayed reachable.

- `ReplyContext` was a public dataclass, so
  `ReplyContext(permitted={"attacker@evil.example"})` was three lines and the
  whole "recipients come from headers" property evaporated.
- `revise()` cleared a draft's review; `dataclasses.replace` — the same API
  `revise()` itself calls, and the only way to change recipients — did not.
- Every `Preview` invariant lived in the `preview()` function, so a hand-built
  one could claim a DELETE was undoable.

All three now hold on the type. The draft's review is bound to a fingerprint of
its content, so any path that changes what was read invalidates it.

### The approval that ORION could grant itself

Phase 29's every enumerated requirement was literally true while ORION reviewed
its own draft, approved it as `granted_by="orion"`, and the audit recorded
`actor: "user"`. Nothing checked a person was involved. `require_person` now
refuses system actor names and requires both reviewer and approver to be the
account holder.

### Things that were quietly not what they looked like

- **U+212A KELVIN SIGN lowercases to ASCII "k"**, so `nic\u212a@example.com` in a
  `From` header folded into the permitted set as `nick@example.com` — a real
  third party who was never on the message. `egress.py` names this exact trick in
  its own comments.
- **`json.dumps(ensure_ascii=True)` escapes an astral character as a surrogate
  pair**, so a lone-surrogate string hashed identically to the real one — a
  collision in both approval fingerprints, reaching the recipient field.
- **`$` also matches before a trailing newline in Python**, so `"abc\n"` passed
  `ID_PATTERN` and reached a URL unencoded.
- **`LABEL_PATTERN` admitted 128 characters of hyphen-joined prose**, and nothing
  capped the label count: ~5KB of injection text went into the type whose whole
  purpose is having nowhere to put text.
- **`applies_to` never read `self.scope`** — a constant function of its argument.
- **Swift's `HealthSample` not being Codable** prevents only the *synthesised*
  encoder. A reviewer exfiltrated one four ways, including
  `extension HealthSample: @retroactive Encodable` in another module, which the
  in-process assertion cannot see. Restated rather than repaired: Swift has no
  way to prevent that.

### Eight repairs had no test that bit

Every fix was mutation-tested. Eight passed with the fix removed and were
reworked; two of those needed the scenario rebuilt because something else was
masking the branch — in one case the *cost* check refused a move before the
dependency guard was reached, so the guard was never exercised.

### Live and installed state

Unchanged. Nothing committed, nothing deployed, no spend. HEAD is still
`1efd37c`.

### Next

**Phase 31 — Health Baseline Engine.** `planning/v2/PHASE_31_PLAN.md` is written
and the implementation is drafted but not yet in the tree; it goes in
`native/OrionMobile/Sources/MobileCore/HealthBaseline.swift`.

The highest-priority follow-up is not a phase: **an approval is still not
consumed by use**, in Phases 25 and 29 both. The same approved preview authorises
the same action indefinitely, so a retry loop becomes a mailing. That should
close before any transport exists.


---

Entries before 2026-08-27 were moved to
`planning/_archive/HANDOFF-pre-2026-08-27.md` on 2026-09-01. Nothing was deleted.

---

## 2026-09-02 — the approval gate got a person in it, and a second authority axis

**The two defects this started from**, both live, both found by looking rather
than by a test failing:

1. `validator.ts:648` accepted `approval.canonicalHash` **supplied on the
   step**. The first call returned `needs_approval` carrying that hash; the
   model copied it into a second call; the gate opened. The transcript read
   like a real approval — refusal, grant, action — and no person was ever
   consulted. Phase 49 names this in one line and it was true of this system
   when the line was written.
2. `orion-remote` is on the exec allowlist, and `orion-remote handle -- approve
   ap-1a2b3c4d` presents `sender = "local"`, which is an allowed sender. Orion
   could answer his own approval requests over the channel built for Nick.

**What now exists.**

- `orion-approve` — the human's tool. Lists what is waiting, grants one id.
- `orion-mode` — the strictness ladder: `contained | guarded | open |
  sovereign`. `guarded` is the default and is byte-identical to what shipped.
- `openclaw-plugins/orion-control/src/approvals.ts` — tickets, grants, nonce,
  single use, 15-minute expiry, bound to this hostname.
- `.../src/strictness.ts` — the modes, and the FLOOR no mode may lower.
- `scripts/orion_v2_strictness_check.sh` — 27 checks against the live machine.

**The boundary, stated the way it actually is.** Orion runs as Nick's user;
there is no kernel privilege boundary and pretending otherwise would be worse
than having none. The boundary is that nothing Orion can invoke writes to the
grant directory, and that is four claims, each re-checked by the suite:

1. `orion-approve` and `orion-mode` are absent from the exec allowlist, so with
   `ask: off` / `askFallback: deny` the call is refused, not prompted.
2. Both are in `FORBIDDEN_SCRIPTS`, so the repair engine will not edit them.
3. `~/.openclaw/orion-gate/` is not a mutable root for any catalog action, and
   is deliberately NOT under `orion-controlled`, where his writes are AUTO.
4. `approvalRoot` and `strictnessStatePath` are in `FORBIDDEN_CONFIG`, so the
   directory cannot be redirected somewhere he can write.

**The compatibility claim, and how it is held.** `planning/v2/GUARDED_BASELINE.json`
is a FIXTURE pinned from commit `2cf0445`: every action's level before any of
this existed. Check 6 compares the live map against it. It is deliberately not
`CURRENT_AUTHORITY.json` — that file is regenerated by the same command the
check runs, so comparing against it would pass no matter what changed.

**What is still open**, and it is not small:

- Voice has no approval path. A spoken "yes" reaches the model, and the model
  is what was removed from the loop. Terminal and Discord are the two channels
  that can prove a human act today. Under `sovereign` most common cases stop
  needing approval at all, which is the practical answer — and the reason the
  modes are worth having rather than a nicety.
- Phase 49's phone half — Face ID, Secure Enclave signing, independent
  signature verification — remains blocked on there being an iPhone app.
- Phase 50's `resources` field: there is no way to say "sovereign, but only
  under ~/Projects". Scoping a delegation to a path needs the mode to reach the
  execution roots, which it deliberately does not.

**If you change any of this, re-run:** the plugin suite (170), then
`orion_v2_strictness_check.sh`, then deploy — `cp dist/*.js
~/.openclaw/extensions/orion-control/dist/` and `./scripts/orion-remote-install`.
The INSTALLED copies are what run; `--status` tells you when they have drifted.

---

## 2026-09-03 — voice into the gate, then phases 51–60

**Voice.** The gap left open yesterday is closed, and not the way I first
intended. `SpeakerVerifier.swift` forbids the obvious design in its own header
— *"IT IS NOT AUTHENTICATION… nothing security-relevant should ever be
conditioned on it"* — and it fails OPEN, so an approval built on it would
succeed whenever the daemon was down. The mechanism that works was already
here: `authorizeTaskGraph` mints `trusted_user` inputs from OpenClaw host
provenance, which is the same proof `argumentNotFromUser` already uses. **If
Nick's own turn says approve, a person said yes** — and it is not a voice
feature: speech, a typed line and a Discord DM arrive identically, and none is
trusted for being speech. A mention is not a decision; ambiguity grants nothing.

**Phase 51 — structured development operations. Built and live.** Seven typed
actions against a closed repository table. The manifest's six restrictions are
enforced by construction: repo named by key (no path to traverse), cwd is the
repo root, argv is a constant (`git pull` is `--ff-only`; `package_install` is
`npm ci`), environment built from an allowlist of five variables, SIGKILL
timeouts, output cut in the middle. Enabled in `openclaw.json`.

**Phases 57/58 — automation. Built and live.** `automation_propose` /
`_list` / `_simulate` / `_withdraw`, and **no install operation, deliberately**
— installing is `scripts/orion-automation`, off the exec allowlist. "The model
may not silently install permanent automation" was already true by absence and
is now structural, with two live checks holding it.

**52, 54 recorded as passed-by-absence**, which is a real verdict here rather
than a dodge: zero raw-shell execution kinds, and zero screen-capture calls
anywhere in the repo. Both were verified by enumeration, not by reading a list.

**What is genuinely open, in the order I would take it:**

1. **Phase 60's preparation half** — `orion-focus` enforces a session; nothing
   opens the apps or loads project context at the start of one. Phase 51 just
   made the "project context" half honest (`git_status`/`git_log` against a
   named repo is what a work session opens with), so this is now unblocked to
   build rather than blocked on anything.
2. **The bare `git` allowlist entry** is now redundant and is the last raw-shell
   route into a repository. Removing it is one line in `exec-approvals.json` —
   left for Nick, because taking capability away unasked is as much a surprise
   as adding it.
3. **Phase 59's scoring.** Three of the six factors (novelty, confidence,
   interruptibility) are already enforced structurally in `orion-standing`.
   Urgency, actionability and importance have no input to compute from, so a
   six-factor score today would be arithmetic over three constants.
4. **Phase 58's history.** Simulation replays the calendar, not the past. It
   needs `orion-cron-deliver`'s delivery decisions retained and queryable.

**Two checks were wrong and are now derived rather than pinned.** The strictness
baseline check failed on Phase 51's seven new actions — adding an action is not
a regression, and it now distinguishes changed/removed from added. The lock
check pinned `"top":78,"total":78`, three lines below its own comment saying to
pin contents and not counts; it now asserts the *reduction* against the live
catalogue. Both were mutation-tested after the change.

---

## 2026-09-03 (later) — phases 60–70

**60 — the preparation half, closed.** `orion-focus` enforced a session and
never opened one. `orion-focus start` now prepares before it speaks: raises the
named apps (`open -a`, idempotent, no new permission), reads `git status` and
`git log` against a repo named by **key** through Phase 51's closed table, and
reports today's agenda — with a calendar that cannot be read named as a blind
spot rather than as an empty day. This is why it was blocked on 51.

**63/64 — why, and how sure.** `src/explain.ts` + `scripts/orion-why`. The rule
that shaped it: *"do not expose private hidden chain-of-thought"* taken in its
strongest form — **the model does not answer this question at all.** `orion-why`
assembles recorded facts from the ledger and the catalog and has no reasoning to
leak because it does none. Confidence is **derived**, never a field a model can
fill, and a run's confidence is the *weakest* of its steps so one verified read
cannot vouch for an unchecked write.

**67 — cost.** `orion-budget` reads the usage records OpenClaw already writes.
It found a 6.4M-token day on 2026-08-09 nobody knew about. Dollar figures are
deliberately blank: the gateway records `cost: 0` (subscription billing), so the
rate table ships at **zero** rather than with prices invented here, and every
derived figure is labelled an estimate. Per-task budgeting is impossible from
outside — the usage log carries no task id.

**69 — attack surface.** `planning/v2/ATTACK_SURFACE.json` maps all 19 classes:
11 to tests **by literal title**, 8 argued not-applicable with a *reason* and a
*residual*. `orion_v2_attack_check.py` fails when a claimed test is renamed —
mutation-tested. The manifest's class list lives in the **checker**, so the map
cannot satisfy the check by shortening itself.

**70 — CI.** `.github/workflows/ci.yml` + `scripts/orion_v2_ci_check.sh` run the
same set. Security invariants run **first** so a failure never appears below a
column of green ticks. The five machine-bound suites are written into the job
summary — *"a green CI is not a green machine."*

**One thing I got wrong and want on the record.** My first CI secret scan grew
its own regexes and failed on fourteen fake credentials inside tests that assert
credentials get refused. Widening an exclusion would have been fragile; a second
scanner would have been the duplication this repo keeps paying for.
`scripts/orion_v2_secret_scan.py` already existed and is better — it allowlists
by path + rule + **fingerprint**, so a real key replacing a fake one in the same
file still fires. It now runs over full history too.

**Everything above that I listed as a "next build" was then built.** 60, 61,
62, 63, 64, 67, 68, 69 and 70 are closed. What follows is what is left and why.

**Phase 62** — six `waiting_*` actions over one JSON file. Every item must name
`expect`, the observable event that ends it: "waiting on the professor" is a
feeling, "waiting for a reply to my email of the 20th" either happened or did
not, and only the second makes *overdue* mean something other than *old*.
`draft` writes text onto the record and **cannot deliver it** — that was the
gate decision this phase needed, and a test asserts nothing in the tier reaches
a person.

**Phase 61** — `prep_card` fans out to five sources and writes nothing. Search
terms are extracted *mechanically* from the event: a title is
attacker-controllable if anyone can put something on your calendar.

**Phase 68's hang test found a real bug in code shipped hours earlier.**
`runDevOperation` killed the child and waited on `close`, but `npm test` is a
shell that spawns vitest — SIGKILL on npm left vitest holding the stdout pipe,
and `close` waits for stdio EOF, not exit. **A timed-out test run would have
hung the tool call forever**, which is the failure the timeout exists to
prevent, reached through the timeout itself. Fixed with a detached child, a
process-*group* kill, and settling on `exit` as well as `close`.

**Phase 70's deploy** replaces the `cp dist/*.js …` I had typed by hand several
times that day. Its load check was wrong first time — importing `index.js`
standalone fails on `openclaw`, which resolves from the gateway's module graph,
so a healthy deploy got rolled back. A verification that fails on a healthy
system is worse than none: it trains you to pass the flag that skips it.

**What is genuinely left, and why it is not "I chose not to":**

- **65 (App Intents) and 66 (Live Activities).** Xcode 26.6 *is* installed and
  the mobile package builds for the simulator every check run — so the blocker
  is not tooling. It is that adding a target changes the app bundle, and every
  TCC grant and Keychain item on this machine is bound to the bundle's
  **designated requirement** (which is exactly what `orion-identity-check`
  exists to protect). Getting it wrong costs the microphone grant, the
  accessibility grant and the Gmail refresh tokens, and leaves a second "Orion"
  in Privacy & Security. **That is a change to make with Nick at the keyboard.**
- The seven reliability scenarios and eight attack classes still uncovered each
  name, in their map entry, the specific thing that would make them live.

---

## 2026-09-04 — phases 71–80

**71 — the data inventory, enforced instead of remembered.** Fifteen entries,
ten fields each, and `orion_v2_inventory_check.py` holds it to the *live*
system: every capability tier in the installed catalog must appear in exactly
one entry, every field must be non-empty, every configured store path must be
named. It proved itself the same day — enabling the Phase 78 travel tier failed
the check until the entry was written. That is what "update the inventory with
every feature" was supposed to mean.

**72 — `orion-privacy`.** All ten controls in one place. The four that aren't
this machine's to do are *listed* with the URL rather than omitted, because a
control people can't see is worse than one they can't use here. Deletion is
real deletion. Nothing destructive runs without `--yes` — verified live.

**73 — `orion-backup`, and no secret is in it at all.** A backup is a second
copy, and a second copy of a credential is a second thing that can leak. Every
secret is recoverable by rotating it at the issuer, so the archive carries a
rotation checklist instead. **The fixture check found a real bug:** the first
version piped `tar | passphrase | openssl -pass stdin`, putting the passphrase
*in the pipe* — tar's output was discarded and openssl encrypted nothing but
the passphrase. It produced a plausible 12K archive containing no data. The
passphrase now goes over fd 3.

**74 — `orion-incident`.** Freeze is one command, loudest first, so a half-run
is still the half that mattered. **`thaw` didn't thaw** — it ran `orion-mode
guarded` without `--yes`, got refused, and printed that it had lifted
containment while Orion stayed contained. Two fixes: pass the flag, and *check
afterwards* rather than assume. Also fixed `orion-mode`: returning to the
default is not a standing grant needing an expiry.

**75 — the workflow check fails on this repository, and that is correct.**
Between 2026-09-02 and 2026-09-04 one model designed, implemented, tested,
reviewed and approved the approval gate, the strictness ladder, the structured
terminal operations, the automation framework and the backup encryption. All
security-sensitive, none independently reviewed. It is wired into CI as
`continue-on-error` and reported as **DEBT**, not hidden — a check that fails
every run is one people scroll past.

**76 — the deferral list as a smoke alarm.** Structural scan of action names,
tiers, execution kinds, script names and allowlist entries. The first version
regexed source prose and immediately produced two false positives (`send` inside
`email_send`, `diagnos` inside `diagnostic`) — a line that *mentions* an effect
is not one that performs it.

**78 — travel.** Detection proposes and never creates; every leg is `inferred`
and says so; the timezone shift is *reported*, never applied, and is computed at
the trip's start because New York↔London differs by an hour depending on the
date. Nothing in the tier can book anything.

**80 — the call policy**, which is this phase's actual deliverable. Seven rules
with reasoning. Recording is a flat no: the applicable law depends on where each
party is physically standing, and a system that can't determine that can't
lawfully record.

**Open, with reasons:**

1. **Phase 75's independent review** — owed, on everything built since
   2026-09-02. This is the one to clear first.
2. **73** — credential rotation and device loss are documented, not exercised;
   the end-to-end backup needs a Keychain passphrase only Nick can create.
3. **77, 79** — blocked behind the same walls as 65/66 (app bundle) and
   53/54/55 (no computer-use surface). Their prohibitions hold structurally.

---

## 2026-09-04 (later) — phases 81–84, and the manifest's closing sections

**The manifest ends at Phase 84.** There is no 85–90. After 84 come three
unnumbered sections that had never been checked by anything: PERMANENT
ARCHITECTURAL RULES, REQUIRED BUILD ORDER, FINAL SUCCESS CONDITION.

**The twenty-four architectural rules are now assertions**
(`scripts/orion_v2_rules_check.py`). Not a document — a rule like *"never expose
a public control port"* is a fact about a socket, and it is either true right
now or it is not. **21 held, 2 recorded as judgement with a position rather than
a score, 1 violated.** It found two real problems on its first run:

- The installed extension was **shipping compiled test files** carrying
  synthetic credential fixtures. Fixed by not shipping tests — which also
  removed a third of the installed bytes. Not by allowlisting the finding: a
  scanner you have to tell to ignore the shipped artefact is one nobody trusts
  next time.
- The public-port assertion was too broad and flagged **macOS's own** AirPlay
  and Continuity listeners. Narrowed to ORION's processes, with the OS's
  reported as context rather than silently excluded — you may want to turn
  AirPlay Receiver off, but it isn't a violation of an ORION rule.

The one violation is **rule 24** — one agent as sole designer, implementer and
security reviewer. That is the same debt Phase 75 records, and the manifest
treats it as more serious than a workflow step: the heading says these rules are
not to be violated without an explicit architecture review.

**81 — location was already right.** No CoreLocation anywhere; location is a
city name and an IANA zone a person sets. The minimal permission turned out to
be *none*. Open: the location audit trail is unbounded.

**82/83/84 are correctly not started.** 82's trigger (anyone beyond trusted dev
users) hasn't occurred; 83 has one tenant; 84 needs the app. One part of 83 was
verifiable now and is: **nothing authorizes on an identifier being unguessable**
— an approval ticket id is four characters *on purpose*, and grants nothing
without a 128-bit nonce, a matching hash, a matching device and a non-local
grantor.

**`scripts/orion-readiness`** answers the sixteen final success conditions:
**8 met, 5 partly, 1 not met, 2 not applicable yet.** The one NOT MET is the
iPhone as trusted approval device. A report that rounded "no cloud exists" up to
"the cloud is not omnipotent" would be exactly the scoring that condition warns
against.

**REQUIRED BUILD ORDER: followed in substance, not in sequence**, and recorded
as a deviation rather than claimed as compliance. The order assumes a backend,
database, credential vault and mobile shell early; none exists, and the
local-first path did capability system → policy engine → audit before any remote
work.

---

## 2026-09-04 (end) — the oblivious review, and what it found

An independent agent reviewed phases 49–80 with the manifest, the repo, the
commands, and no narrative. **It found two things with real safety cost, and
both were things this session wrote and believed.**

**1. The strictness ladder was never wired to enforcement.** `strictness.ts` was
imported by exactly two non-test files — `index.ts` for a status readout and
`orion-authority` for documentation. **`validator.ts` had never seen a mode.**
So `orion-mode contained` reported "everything else asks first" and gated
nothing, and `orion-incident freeze` then declined to drop the permission
profile *on the stated grounds that "contained already stops every write."*
That premise was false.

Fixed: `baseLevelFor` moved into the plugin (removing orion-authority's
duplicate ladder rather than adding one), `ValidationOptions` gained a
strictness field, and the mode is threaded into the *authoritative* validation.
`contained` now refuses a non-read action without a grant — verified against the
installed plugin. The summaries were also corrected: **a mode raises to APPROVAL
and never lowers from it**, because a validator can refuse and cannot make a
model narrate. What `open` and `sovereign` free is *announcement*, not gates.

**2. A live credential was inside the backup.** `exec-approvals.json` is staged
and holds `socket.token`. Both exclusion layers matched **filenames only**, and
the archive's own MANIFEST asserted *"No secret is in this archive."* The check
couldn't have caught it — it planted a `.env` in its own sandbox and never
touched the real `sources()` list.

Fixed: a content pass redacts credential-shaped *values* from staged JSON while
keeping the structure a restore needs; the MANIFEST no longer asserts its own
correctness; the check now extracts the real redaction code from the script and
runs it against a file shaped like the one that leaked.

**Also found and fixed:** `trusted_user` is wider than "Nick's own words" — the
transport's own briefing contains the literal words *"yes, approve A-7F3K"* and
was held back only by which occurrence `exec` matched first. Machine-authored
blocks are now stripped and every occurrence is examined. And `automation.ts`
used `in`, which walks the prototype chain, so `constructor` and `__proto__`
passed a check whose whole job is to say the table is closed.

**Corrected rather than defended:** Phase 49's evidence claimed four failing
assertions where there are three; Phase 67's model counts were pinned and are
stale; `orion-authority` claimed the unclassified rung stops silent execution
when with `ask: off` there is no ask state to reach.

Every finding is recorded under its phase in `postReviewCorrections` rather than
by editing the original evidence — *the fact that a claim was wrong is itself
evidence about the evidence*. Each repair has a named failing test,
mutation-verified.

**Phase 75 is closed and all 24 architectural rules now hold** (22 held, 2
judgement, 0 violated) — because the review happened, not because anything was
written down.

---

## 2026-09-04 — audit of planning/v2

**Verified first:** the manifest has 85 `# PHASE` headings (0–84), the last is
84, and the three closing sections follow it. `PHASE_GATES.json` records all 85
with none missing and none invented past 84. 60 are closed.

**Nothing in `planning/v2` turned out to be unneeded.** Every JSON in it is read
by live code or tests — `capability-registry.json` by four scripts and five test
modules, `secret-scan-allowlist.json` by six, `model-roles.seed.json` by five,
and so on down. The 32 `PHASE_N_PLAN.md` files are referenced only by other
planning docs, but they are the design record for the phases they cover and
deleting them would lose the reasoning, which is the one thing this repo is
built to keep. No tracked `.bak`, `.tmp`, `.orig` or duplicate files exist.

**What the audit did find was drift, not clutter.**

**Two checks had been failing silently since Phase 51.** Adding five capability
tiers across phases 51–78 drifted `capability-registry.json` and the Python
policy engine's tier tables. Both checks *correctly refused to classify a tier
nobody had recorded* — `orion_v2_build_capability_registry.py` raised rather
than guessing a domain, and `orion/security/risk.py` raised `UnknownTier`
rather than defaulting. **But nothing ran them**, so nobody heard. A check that
exists and is never run is a check that is not there.

Fixed: registry rules and effect mappings for the five new tiers, tier reach and
profile membership in the Python engine, registry regenerated (101 actions), and
**the whole read-only Python contract suite wired into `orion_v2_ci_check.sh`
and the workflow** so this cannot recur unheard. `dev_operations` is graded R5
alongside the `self_*` family, not R1 with the filesystem tiers — it executes
code out of a repository, and grading it by the paths involved would be wrong
about the four operations that are not reads.

**The secret inventory was missing a credential.** The reviewer's Phase 71 note
was right: `socket.token` in `exec-approvals.json` was in no inventory. A file
whose whole job is to say where the credentials are was missing one — and that
is the same token `orion-backup` was staging in the clear. Now listed, with a
pointer to why the backup redacts it rather than excluding the file.

**`planning/v2/HANDOFF.md` was stale and pointed at as current.** It ends
2026-09-01 at Phase 33; AGENTS.md told the next agent to read it for v2 work. It
is not a duplicate of the root handoff — they do not overlap, and it holds the
only account of phases 1–33 — so it is marked CLOSED at the top with a forward
pointer, and AGENTS.md now says which one is live. That is the rule AGENTS.md
already states, applied to itself: a handoff's date is when it was written, not
when the work stopped.
