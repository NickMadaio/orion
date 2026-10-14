# Things only you can do

Work that is blocked on you rather than on code — accounts, money, taste, or a
password I must not handle. Kept here so it is one list you can pick off when you
have time, instead of scattered through old chat.

Each item says what it unblocks, so you can judge whether it is worth an evening.

---

## Now — 2026-10-14

1. **Top up Anthropic credits / raise the usage limit** (console.anthropic.com).
   The API has refused every call since 2026-10-11 ("credit balance too low",
   "usage limits … 2026-11-01"). Unblocks every cloud model; until then ORION
   runs only on the local models.
2. **The local testing window ends 2026-10-16 21:58 BST.** After that ORION falls
   back to the cloud model and goes quiet unless (1) is done, the window is
   renewed, or the local acceptance gate passes. Say "renew the local window" to
   any assistant session.
3. Optional: `OLLAMA_MAX_LOADED_MODELS=2` for Ollama, so nothing else (a
   12 GB `gpt-oss:20b`) squeezes ORION's two models out of memory.
4. Optional: should the scheduler's default 45-minute commute home follow your
   real travel times (`places.json`: Spitalfields 15 min)?

---

## Turning the unattended local agent on — 2026-09-21

The local development loop is built and tested but **disabled**. Four steps, in
order, and step 4 is the one that matters:

1. **Rebuild and deploy the plugin.** Five new deny-list surfaces protecting the
   agent runtime are in the TypeScript source but not in the installed build,
   and the installed build is the one the boundary consults. The runtime carries
   its own copy meanwhile, so this is belt-and-braces rather than a blocker.

2. **Create `~/.openclaw/orion-controlled/agentic-config.json`** containing at
   least `{"enabled": true}`. Nothing runs until this exists. It is outside the
   repository on purpose: the agent cannot write it, so it cannot turn itself on.

3. **Run the smoke plan** — it only touches a sandbox directory:
   ```
   scripts/orion-agent plan docs/agentic/plans/smoke-run.json
   scripts/orion-agent init docs/agentic/plans/smoke-run.json
   scripts/orion-agent run --hours 1
   ```

4. **Watch one full run before you leave it overnight.** Everything about this
   system is designed for you being asleep, and none of it has been proven with
   you asleep.

### Decisions that are yours

- **Models are chosen and measured** — `qwen3.6:27b` in both roles, from eight
  candidates across two evals (3/3 planted defects, zero false positives, every
  run; 77.2% SWE-bench Verified). One model means it loads once and is never
  evicted. Change either role from the Projects tab, or:
  `scripts/orion-project-agent set-model reviewer <model>`.
- **Whether an Astra review comes before or after the first real run.** My
  recommendation is before: this changes real code while you are asleep.
- **Disk.** `~/.ollama/models` is ~150 GB after the model comparison.
  `orion-reviewer:80b` (31 GB) failed the reviewer eval four times out of four
  and can go. `gpt-oss:20b` cannot drive the worker protocol at all.

---

## Current v2 decisions — Phase 32.5, 2026-08-27

The product charter and proposed implementation order now live in
`docs/planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md` and
`docs/planning/v2/ROADMAP_AMENDMENTS.json`. Before setting up the new backend, choose
the hosting/database/authentication approach, a running-cost budget and the
first read-only feature to make visible. Distinguish the provider's operations
dashboard from Orion's own home/control UI. No provider or plan has been chosen.

The Phases 11–20 review is **done (2026-08-28)** — five of ten were not complete
as claimed, 64 defects, 62 repaired. See `docs/planning/v2/PHASE_11_20_REVIEW_REPORT.md`.
What is still a coding-assistant task: the mixed-backlog commit plan, which needs
**your approval of the grouping before anything is staged**. Nothing has been
committed or pushed. UI taste, call/text delegation rules, presence signals and model
budgets remain explicit choices; initial discussion is recorded in the charter.

Items 9–10 below are older setup guidance, not the sole remaining blockers.
Inventory existing Google projects/connections before creating another; choose
the OAuth client type for the actual desktop/server flow after backend design.
Real adapters, durable storage, production crypto and end-to-end verification
still require implementation. Verify current provider/platform requirements
when doing account setup; this documentation pass did not re-validate them.

---

## 0-now. One command, on the day you land

**2026-09-08, after you land in London:**

```
orion-timezone set Europe/London --place "London, United Kingdom"
```

That is the whole thing. It re-homes all three cron jobs, switches the weather
default off Montvale, and moves what Orion thinks "today" means — verifying each
one by re-reading it rather than trusting the command that made the change. Run
`orion-timezone plan Europe/London` first if you want to see exactly what it will
touch; it changes nothing.

You should not have to remember this. Orion will raise it in the morning brief
the day after the machine's timezone changes, and the move is tracked with dates
(`orion-project list`). But it is here because the last time this depended on
Orion asking a question, the deadline passed in silence.

**Why it was not just done today:** you are in New York until roughly the 7th.
Re-homing now would put the nightly job at the wrong hour for six days in the
other direction.

**What is actually wrong today, precisely:** only `orion-daily-memory` (02:10 New
York) genuinely fires at the wrong hour in London — it becomes 07:10. The other
two jobs fire every minute and hourly, so their timing is zone-independent, and
their content follows the machine, which macOS auto-timezone corrects for you.
Smaller than the earlier note said.

---

## 0a. Answered on 2026-09-01 — kept for the record

- **London:** moving in ~6 days. **Northeastern starts Sept 7**; Nick lands in
  London Sept 8; welcome week is the buffer. Batch B is now deadline-driven.
  (The archived `USER.md` said "Eastern University" — voice dictation dropped the
  "North". The current `USER.md` lost the university entirely in the 2026-08-14
  rewrite and should have it restored.)
- **iPhone:** coming, within this manifest. Mobile phases are the goal, not
  parked indefinitely.
- **The $99:** later. Build the foundation and test it; pay once it is ready.
- **Channels:** expand them, but the destination is the phone app speaking to
  Orion remotely and dispatching work.
- **Focus feature:** wanted. The two 25-second sessions were Nick testing it.
- **Phases 1 and 5 re-pointing:** delegated to Claude's judgement. Done — see
  Batch C in `PROGRAM_CORRECTION_2026-09-01.md`.

## 0. Six decisions, from the 2026-09-01 program review

Full reasoning in `docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md`. These are the
only things blocking work.

**a. ~~Have you moved to London, and has term started?~~ ANSWERED and BUILT, 2026-09-01.**
Northeastern is restored to `USER.md`, the move is recorded in `location.json`
as a dated expectation, and it is tracked with milestones. Nothing here is
blocking any more; the one remaining action is the command in section 0-now.
The original text follows for the record.

**a. Have you moved to London, and has term started?** `USER.md` says "Moving to
London before the end of August 2026" and "Default timezone: America/New_York
until his move; ask once afterward." It is now September and the machine is still
on EDT, with all three cron jobs pinned to New York. Orion was told to ask you
this and the deadline passed. If you have moved, the morning brief has been
firing at the wrong hour.

**There is a memory regression attached to this.** The archived
`docs/planning/_archive/workspace-before-2026-08-14/USER.md:42-44` recorded the move
as being **"to attend Eastern University"**, and told Orion to treat both the
Montvale address *and* the timezone as expiring. The current
`plugin/workspace/USER.md` lost the university entirely in the 2026-08-14
rewrite — it now says only "Moving to London."

That matters more than a missing detail usually would. The Phase 32.5 charter
carefully preserved a school/day-planning capability (`CAP-SCHOOL-DAY`), the
85-phase manifest dropped university mode altogether, and the live assistant no
longer knows which university, in which city, or that term is starting now. If
you confirm it, I will restore the fact to `USER.md` — I have not edited it
unprompted, because it is your personal record and it is live runtime context.

**b. Is an iPhone coming, and when?** Six manifest phases and the charter's
`REC-USABLE-CLIENT` gate all hang on this single fact. If the answer is "not
soon", we should say so and stop carrying mobile work as though it were pending.

**c. ~~The $99 Apple Developer Program.~~ CLOSED 2026-09-01.** It comes at the
very end of all the phases; it is not a blocker and not a question. See item 2
for what "build the foundation" concretely means and the one place it is
currently missing.

**d. A bot token for an inbound channel — you asked what this means on
2026-09-01, so here it is properly.**

**It is free, and it has nothing to do with the $99.** Different company,
different thing. Discord and Telegram both hand these out at no cost.

**What you already have.** `.env` holds `ORION_DISCORD_WEBHOOK_URL`. A Discord
*webhook* is a one-way pipe: a program can POST a message into one channel and
that is the whole of it. It cannot read. That is exactly why Orion can tell you
things and cannot hear you answer.

**What is missing.** To read a reply, something has to log in to Discord as an
account and listen. Discord's mechanism for that is a **bot** — you register one
in their developer portal, it gives you a secret string (the "bot token"), and a
program holding that string can read and send messages wherever you have invited
the bot. A webhook cannot be upgraded into one; they are separate things.

**Why it matters.** `orion-notify` can already tell you a mission is BLOCKED and
needs approval `ap-1a2b3c4d`. Today that is a dead end — the mission sits until
you walk back to the Mac. With an inbound channel you reply `approve ap-1a2b3c4d`
from your phone and it proceeds.

**The receiving half is already written and deliberately paranoid.**
`scripts/orion-remote`: seven fixed verbs matched exactly, no fuzzy matching and
no fallthrough to a model; every id must already name something Orion minted, so
inbound text can only point at his own state and never introduce a new noun;
inbound text never reaches a shell, a model, or a subprocess argv. It already
knows how to reply through OpenClaw's channel system
(`ORION_REMOTE_REPLY_CHANNEL` / `ORION_REMOTE_REPLY_TARGET`). Its transport is a
pair of local files today precisely so the channel could be attached later
without touching any of that.

**What I would need from you:** create a Discord application + bot at
<https://discord.com/developers/applications>, invite it to a server only you are
in (or use a DM), and give me the token. It is a credential, so put it in `.env`
yourself rather than pasting it into chat — I will tell you the exact variable
name when we wire it. Telegram works equally well via @BotFather if you prefer.

**What it unblocks:** your own #4 ranked gap, "reach beyond the Mac". It is also
the interim step toward what you actually said you want — the phone app talking
to Orion and dispatching work — and it is one free credential away.

**e. Do you want the focus feature at all?** `FocusSessionHome.swift` is 1,192
lines plus an entire domain/service split and 26 test files. `focus-history.jsonl`
records **two** completed sessions ever, both abandoned after under 25 seconds,
and one session has been wedged open since 2026-08-12. Before anyone builds on
it, it is worth knowing whether you want it.

**f. Accept re-pointing Phases 1 and 5 onto the live TypeScript gate.**
`PHASE_GATES.json` records that the Phase 1 "runs through Core" reading was
"granted once, for Phase 1" and that any later phase inheriting it must say so
explicitly. The review found that ORION Core already exists on the live route --
`permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` + the ledger --
and that `orion/security/profiles.py` already concedes this in its own docstring.
Accepting this closes Phase 1's gate by naming what is true, rather than by a
cross-language rewrite that the runtime decision record already forbids.

---

## 1. Pick the break ambience clips

**Why:** the synthesised rain/waves/wind sounded synthetic, because it is. Real
recordings are the fix and they are a taste decision — you will know in five
seconds whether a clip is right and I will not.

**What to do:** grab three loops — rain, waves, wind — and drop them in
`native/Orion/Resources/Ambience/` named `rain.m4a`, `waves.m4a`, `wind.m4a`.
Anything 30–90 seconds that loops without an obvious seam. I will wire the
loader, crossfade and settings around whatever is in that folder.

Sources worth a look, cleanest licence first:

| source | licence | note |
|---|---|---|
| [Selekt](https://selektaudio.com/sound-lab/textures/wind) | explicitly CC0 | safest if Orion is ever published |
| [BigSoundBank](https://bigsoundbank.com/search?q=ambient) | free + royalty-free worldwide | long clean recordings; attribution not addressed |
| [Pixabay](https://pixabay.com/sound-effects/search/cc0/) | no attribution needed | licence restricts redistributing files *as standalone files* — grey area for an app bundle |

**Unblocks:** ambience stops being a placeholder. Until then the break is silent
by default rather than sounding cheap.

---

## 2. Apple Developer Program — $99/year — DEFERRED TO THE END, 2026-09-01

**Your call, recorded so nobody asks again:** this comes at the very end of all
the phases. It is not a blocker, not an open decision, and no future session
should surface it as one. The app gets built without it.

What that leaves as a real obligation is the FOUNDATION — building so that when
a Team ID does arrive, it is a configuration change rather than a rewrite. I
audited that on 2026-09-01 rather than assuming it:

**Already foundation, genuinely:**

- **HealthKit.** `MobileCore/Health.swift` declares a `HealthStore` protocol with
  `RefusingHealthStore` as its only implementation. A real HealthKit-backed one
  drops in behind the protocol. This is the pattern to copy.
- **Code signing.** `Orion.entitlements` exists and `make_app_bundle.sh` already
  signs with the hardened runtime and entitlements, choosing the identity via
  `security find-identity` rather than a hardcoded name — so a Developer ID
  certificate is discoverable without touching the script.

- **The Keychain, and I got this wrong at first.** My first pass said there was
  no seam and the migration would mean editing every call site. That was wrong —
  I grepped for a `protocol` and missed that `Connections.swift` already has
  `enum SecretStore`. The truth is better: the whole app touches the Keychain in
  **exactly two places, four calls total**. `SecretStore` is a proper chokepoint
  (set/get/clear plus an off-main-thread snapshot, built after a launch hang),
  and `VoiceProviders.valueFromKeychain` is a separate read-only reader against
  the items the Phase 0 migration created. Switching to the data-protection
  Keychain is four query dictionaries in two files.

**NOT foundation yet:**

- **Sparkle still has no feed**, no appcast and no release script, so distribution
  is blocked by more than the $99 anyway.

**What I added instead of a speculative refactor.**
`tests/test_keychain_call_sites.py` pins which files touch the Keychain and how.
The migration was never the risk; a *third* call site appearing quietly between
now and then was, because that is what turns "two small edits" into an
archaeology exercise. It also refuses `kSecUseDataProtectionKeychain` and
`keychain-access-groups` while the app is self-signed, since claiming them today
gets the process SIGKILLed on launch — a failure that would look like a crash,
not like a configuration mistake.

The original write-up follows, because the *technical* facts in it are still
true and worth keeping — only its urgency has changed.

---

### Original entry (2026-08-18), kept for the record

**Why:** it is the single fix for the Keychain prompt storm. A Team ID makes
`keychain-access-groups` valid, which unlocks the data-protection Keychain, where
access is granted by entitlement rather than by per-item ACL — **zero prompts,
ever, for you and for anyone else**. Measured 2026-08-18: self-signed cannot do
this. Claiming the entitlement gets the process SIGKILLed; without it every call
returns `-34018`.

It is also required for notarization, without which nobody but you can run Orion
at all — Gatekeeper blocks it outright.

**What to do:** enrol at developer.apple.com/programs (Apple ID with 2FA; must be
legal age of majority). Then Xcode → Settings → Accounts → Manage Certificates →
**+** → Developer ID Application. Tell me the ten-character Team ID — that is all
I need, nothing secret.

**One-time cost when you do:** the signing identity changes, so macOS sees a new
app once. Re-grant mic/accessibility/speech, and the first launch reads your
existing secrets one last time before moving them. After that it never asks again.

**Unblocks:** no more Keychain dialogs; notarization; anyone else being able to
install Orion.

---

## 3. ~~Link GitHub~~ — DONE 2026-08-20

You did this yourself: `https://github.com/NickMadaio/orion.git`, private, first
push 2026-08-20. `.env` and the config backups stayed untracked, and the
full-history secret scan is clean.

**Still open, and smaller than it was:** the updater's feed URL is still the
`ORION_OWNER/ORION_REPO` placeholder, so "Check for Updates" still 404s. What it
needs now is an appcast and one published release — no account work, no decision
from you. Say the word and I'll cut it.

<details><summary>original item, kept for context</summary>

## 3. Link GitHub, so updates have somewhere to live

**Why:** the updater works end to end — proven against a local feed — but points
at a placeholder URL, so "Check for Updates" fails. It needs a real feed.

**What to do:**

```bash
brew install gh && gh auth login
```

I cannot run that second command for you — it is a browser sign-in to your
account. Afterwards tell me your GitHub username, what to call the repo, and
whether it should be public or private, and I will create it and cut the first
release.

**Unblocks:** updates that actually arrive, instead of you rebuilding by hand.

</details>

---

## 4. Back up the Sparkle signing key

**Why:** the EdDSA private key in your login Keychain is the only thing that can
sign an update Orion will accept. Lose it — dead disk, wiped Keychain — and no
future version can ever be installed by any copy of the app already out there.
There is no recovery path; that is the design.

**What to do:** export it once and put it somewhere that is not this Mac (a
password manager entry is ideal).

```bash
native/Orion/.build/artifacts/sparkle/Sparkle/bin/generate_keys -x ~/Desktop/orion-sparkle-key.txt
```

Then move that file off the machine and delete the local copy.

**Unblocks:** nothing today. Prevents a specific unrecoverable failure later.

---

## 5. Two v2 policy questions (2026-08-24)

**Why:** Phase 5 built the policy engine and both of these are yours to answer,
not mine. Neither blocks the phases that follow — I have kept going and recorded
both in `docs/planning/v2/PHASE_GATES.json` — but the second one is a live security
posture question and I would rather you saw it now than in a handoff you read
next month.

**a. Does the Phase 1 reading still hold for Phases 5–10?**

You accepted, on 2026-08-20, that "runs through Core" means the live route
honours Core's contracts, not that Core's code executes the work. That
acceptance was granted once, for Phase 1, on Phase 1's evidence. Phase 5's engine
is in the same position: all 78 live actions are *evaluated* by it and it is
proven never more permissive than the live gate across 390 combinations, but
`validator.ts` and `permissions.ts` still make the actual call.

Say yes and the rest of the local-core track proceeds the same way. Say no and
the closing work is: wire the controller to call the engine behind a default-off
flag, prove parity flag-off then flag-on on the live route. That is a coordinated
window on `src/index.ts`, `src/controller.ts` and `src/validator.ts`.

**b. Seven self-modification actions require no approval.**

Under `consequential_local`, these rewrite Orion's own plugin, wrapper scripts,
Swift source or settings with `approvalRequired: false`:

```text
self_modify           self_plugin_modify    self_plugin_revert
self_script_modify    self_script_revert    self_config_set
self_config_revert
```

Only the three `*_authority_*` variants ask you first. The engine rates every one
of them R5 and would confirm each one; the live gate does not. The repair path
does build, test, health-check and auto-roll-back — that is real mitigation and
it is why this is a question rather than an alarm — but "Orion rewrote his own
plugin and told you afterwards" is a posture, and it should be one you picked.

**Unblocks:** (a) how Phases 6–10 close. (b) nothing; it is a decision, not a
blocker.

---

## 6. ~~Does the backend track proceed without a host?~~ ANSWERED 2026-08-25

**You said: continue with phases 11-15.** Taken as *declaration-first* — schema,
migrations, vault contract, auth and pairing built and tested, nothing deployed
and no new dependency added on that instruction alone. Left below for the record.

(2026-08-24)

**Why:** Phase 10 is "Backend Foundation" and the manifest recommends Python,
FastAPI, PostgreSQL. This repo's Python has had **zero third-party dependencies**
since day one. I built everything that is decidable without a server — the
seventeen-module graph and its boundary checks, DEV/STAGING/PRODUCTION separation,
the rule that a local runtime cannot resolve a production secret, server-side
ownership, and the SSRF guard — and did **not** install FastAPI, add a database,
or stand up a process. That is recorded as a deviation in `PHASE_GATES.json`, not
smoothed over.

**What to decide:** either

- **declaration-first** — Phase 11 designs migrations and tables against the
  ownership layer, still with nothing deployed, and the dependencies arrive when
  a host does; or
- **pause the cloud track** — stay on the Mac-local phases and come back to
  10–15 when you actually want a server.

I have not entered Phase 11 either way; you asked for through 10.

**Unblocks:** Phase 11, and whether `pyproject.toml` stops being dependency-free.

---

## 7. Does one proof per device satisfy Phase 15's "both devices"? (2026-08-25)

**Why:** the manifest says pairing needs "possession proofs from both devices". It
has them — but not symmetrically, and I would rather you knew which shape you have.

- The **joining** device (phone) signs the pairing nonce when it claims.
- The **offering** device (Mac) signs the nonce *plus the joining device's public
  key* when it confirms — so it is attesting to which key it is admitting, which
  is what stops a photographed code being redeemed by a stranger.

My first attempt asked the phone to sign a second challenge at confirm time. That
is impossible: the phone is not online at that moment and would have to sign
something that did not exist when it last was. So the phone proves possession
once.

**What to decide:** if you want a second proof from the phone, it has to stay
connected through confirm (a socket or a poll) and the challenge has to be issued
at claim time. That is a real change to the flow and to the mobile app, so it is
better decided before Phase 16 than after.

**Unblocks:** nothing today. It is recorded as a deviation on Phase 15 either way.

---

## 8. ~~Xcode is not installed~~ ANSWERED 2026-08-25

**You said: "you can compile whatever you want, I don't care."** Taken as: the
mobile track proceeds as a compiled, self-checked Swift domain layer.

**Then you said you do have Xcode — and you were right, I was wrong.** Xcode 26.6
was installed all along; `xcode-select` pointed at CommandLineTools, so every
probe I ran reported no iOS SDK. `DEVELOPER_DIR` fixes it without sudo, and the
mobile check now builds for the simulator on every run.

**One new question, and it is small:** MobileCore is verified to compile for iOS,
so the SwiftUI views are the only missing piece — no longer blocked, just not
built. Say the word and a session can add the view layer, the Keychain adapter
and push registration behind the ports that already exist. Until then the app
still cannot be installed on a phone.

**Nothing for you to run.** I had drafted a `sudo xcode-select -s` suggestion here
and then found `AGENTS.md` already says, in the `native/Orion` section: *"Do not
'fix' this by changing the machine's active developer directory."* The override
is per-command and that is deliberate — your existing test wrapper has worked
that way for months. The mobile check now does the same.

Left below for the record.

(2026-08-25)

**Why:** Phase 16 onwards builds the iPhone app. This Mac has Command Line Tools
only — no Xcode — which means:

```text
no iOS SDK        → SwiftUI cannot be compiled
no simulator      → nothing can be run
no XCTest         → the Swift checks are an executable that exits non-zero
```

So `native/OrionMobile/MobileCore` is real Swift that compiles and self-checks
(103 assertions), and there are no views, no app bundle, no Keychain adapter and
no push registration. Phases 19 and 20 added to the same layer on the same terms.

**What to decide:** install Xcode when you want an app you can hold, or let the
mobile phases keep producing a compiled domain layer until then. The second is
what is happening and it is not wasted — the decisions and their tests are the
part that is expensive to get wrong, and the views are thin once they exist.

When Xcode does arrive, the first check is whether MobileCore still compiles for
iOS **unchanged**. If it does not, something platform-specific crept in and the
compiler was the only thing stopping it.

**Unblocks:** an installable app. Nothing else — phases 21 onward are Python.

---

## 9. A Google Cloud project, so Calendar and Gmail can ever run (2026-08-26)

**Why:** Phases 22 and 25–29 built the whole Google side — connector broker,
webhook validation, incremental sync, calendar reads and writes, Gmail search,
read, draft and send. Every one of them builds a request and none of them can
send it, because there is no OAuth client and no consent screen. This is the
single thing standing between eight completed phases and anything actually
happening.

It is account work, not a decision about the code.

**What to do:**

1. console.cloud.google.com → new project (name it whatever; `orion` is fine).
2. Enable two APIs: **Google Calendar API** and **Gmail API**.
3. OAuth consent screen → **External**, publishing status **Testing**, and add
   your own address as a test user. Testing mode is the right choice: it avoids
   Google's verification review entirely, and the only cost is that refresh
   tokens expire every seven days — fine until this is something you use daily.
4. Credentials → **OAuth client ID** → *Desktop app*. Tell me the **client ID**.

**About the client secret:** a Desktop-app client's secret is not actually a
secret — Google says so, because the binary ships with it. I still do not want
it pasted into chat. Put it in the login Keychain yourself and tell me the item
name, the same shape as the existing ORION credentials, and the vault will read
it by reference.

**The scopes it will ask for**, so the consent screen holds no surprises:

```text
calendar.calendarlist.readonly    calendar.events.readonly    calendar.freebusy
calendar.events                   (only when Phase 25 writes are turned on)
gmail.readonly                    gmail.compose               gmail.send
```

`calendar.readonly` and `gmail.modify` are deliberately **not** requested —
they are recorded in `backend/connectors/scopes.py` as never-requested with the
reason. The narrow trio does the same job as `calendar.readonly` and grants less.

**Unblocks:** every phase from 22 to 29 stops being a set of request builders.
It also unblocks the first real prompt-injection test against actual mail rather
than the fourteen-payload corpus.

**Not urgent.** Phases 30–38 are health and are entirely local, so the program
does not stall waiting for this.

---

## 10. HealthKit needs the same thing Google does — an entitlement (2026-08-27)

**Why:** Phases 30, 31 and 32 built the whole local health layer — authorization
ledger, six personal baselines, six derived states — and none of it can read a
single sample. `RefusingHealthStore` is the only implementation, because reading
health data needs `HKHealthStore`, which needs the **HealthKit entitlement**,
which needs the Apple Developer Program from item 2.

So this is not a separate decision. It is one more thing item 2 unblocks, and I
am noting it here so the list shows the true cost of that $99 rather than only
the Keychain fix.

**What it unblocks when you do enrol:**

- HealthKit capability in Xcode, plus the two Info.plist usage strings
  (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`) — an app
  without them crashes on first read rather than being denied.
- The eight data types ORION asks for: sleep, resting heart rate, HRV,
  respiratory rate, steps, active energy, workouts, exercise minutes. It asks for
  nothing else, and the five categories it deliberately never requests —
  clinical records, mental health, reproductive health, blood glucose,
  medications — are recorded with reasons in `Health.swift`.

**One thing worth knowing before you approve the sheet:** HealthKit will not tell
an app whether you granted a *read*. A refusal and an empty data set are
deliberately indistinguishable, so if you decline something quietly, ORION cannot
tell you why a number is missing — it can only say it has none. That is Apple's
design and the right one; it is modelled as `unknowable` rather than pretended
away.

**Nothing is blocked meanwhile.** Phases 33 onward are the privacy firewall, the
UI and the journal, all of which are built against the local layer.
