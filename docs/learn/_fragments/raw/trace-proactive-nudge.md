<!-- prompt: Read-only research in /Users/nickmadaio/Desktop/ORION (personal assistant: scripts/ wrapper CLIs, scripts/lib/life, scripts/lib/remote, OpenClaw TS plugin plugin/orion-control/src, Swift Mac app native/Orion). You may also READ (never write) ~/.openclaw/cron/jobs.json or similar cron config and ~/Library/LaunchAgents/*orion* / *openclaw* plists, but never copy secrets, phone numbers or emails. Ver -->

I traced the main nudge path end to end, plus the cron path beside it. The surprise is that **the nudge is not started by cron or launchd at all.** It runs on a 5-minute timer inside the ORION Mac app's dashboard.

There are two paths:
- **Path A (the main one):** `LifeWatch` → `orion-proactive` → `orion-reach` → Mac voice or bubble, or a phone push through CloudKit.
- **Path B:** three OpenClaw cron jobs → `orion-cron-deliver` → `orion-discord-alert`, a Discord webhook.

Nothing on these paths runs `openclaw message send`. The only code that uses it is `orion-notify`, and `~/.openclaw/openclaw.json` has no `channels` block, so that path always falls back to Discord.

I found six bugs, listed at the end. The most serious: **the quiet-hours "hold" never triggers.**

## Path A: the dashboard timer → proactive → reach

**Hop 1 — The app keeps the timer alive.** `~/Library/LaunchAgents/com.nickmadaio.orion.dashboard.plist` runs `["/usr/bin/open","-na","Orion"]` with `RunAtLoad=true`. That is the only launchd involvement on this path.

**Hop 2 — Dashboard ticker.** `native/Orion/Sources/Orion/DashboardView.swift:39` and `:245-247`
```swift
@StateObject private var phoneTicker = RefreshTicker(interval: 3)
...
.onReceive(phoneTicker.$tick) { _ in
    phonePlans.check(model: todayPlan, agenda: agenda, reminders: reminders)
    lifeWatch.tick()
```
It fires every 3 s, and `LifeWatch` throttles itself to once every 5 minutes.

**Hop 3 — `LifeWatch.tick`.** `native/Orion/Sources/Orion/LifeWatch.swift:18-52`
```swift
private let every: TimeInterval = 5 * 60
guard now >= next, !running else { return }
let node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-watch")
...
proactive.arguments = [script.deletingLastPathComponent().appendingPathComponent("orion-proactive").path, "tick"]
```
- It runs three things in order: `orion-watch tick --json`, then `orion-watches tick`, then `orion-proactive tick`. All output is discarded.
- It runs the **installed copies** under `~/.openclaw/orion-remote/scripts`, not the repo.
- Why it lives in the app (comment, lines 9-11): "Run from this app because this app holds the Calendar permission the calendar bridge needs."
- If node or the script is missing, it silently returns.
- The installed copies of `orion-proactive`, `orion-reach` and the reach libs match the repo byte for byte. **`orion-watch` does not:** the installed copy lacks the `orion-tasks sweep` block at repo lines 137-145 (commit 6830e6d... no, commit 6c93032, 2026-10-13).

**Hop 4 — `orion-proactive` start-up and eval guard.** `scripts/orion-proactive:34`, `:44`
```js
// A night belongs to the evening it started: until 6 AM it is still "yesterday".
const dayKey = new Date(now.getTime() - 6 * 3600000).toLocaleDateString("en-CA");
...
if (sandbox()) process.exit(0);
```
`sandbox()` (`scripts/lib/life/bridge-path.mjs:23-26`) returns non-null only when eval mode is on **and** a sandbox calendar exists. If eval mode is on with no sandbox calendar, it carries on and `orion-reach` refuses later (Hop 9).

**Hop 5 — Gathering context.** `scripts/orion-proactive:48-72`
- `presence(now)`, then `orion-session status --json`.
- `focus-history.jsonl`: a session that ended under 15 minutes ago (`15 * 60000`) is treated as "finished".
- `orion-now --json` supplies the sleep bedtime and wake time.
- `liveDay()` supplies the day's blocks, and `commuteWalls()` the travel windows.
- `bridgeRequest("list_incomplete_reminders")` supplies the to-dos.
- Every source is wrapped in `try {} catch {}`, so a failed source becomes empty.

**Hop 6 — Presence and channel facts.** `scripts/lib/reach/facts.mjs:27-34` reads idle time and lock state (`ioreg`), power (`pmset`), headphones (`system_profiler SPAudioDataType`) and volume (`osascript`), each with a 4 s timeout.

`scripts/lib/reach/presence.mjs:15-22`
```js
const on = blocks.find((b) => b.fixed && b.start <= minute && b.end > minute);
...
try { quiet = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, "../../orion-now"), "--json"], ...)).sleep?.state === "night"; } catch {}
```
**Bug:** `orion-now` never outputs `"night"`. `scripts/lib/life/sleep-state.mjs:7-18` only returns `day`, `unknown`, `awake_late`, `probably_asleep` or `winding_down`, and `orion-now:39` maps `unknown` to `awake_late`. So `quiet` is always false and the `"hold"` channel can never be chosen. The ledger agrees: `outreach.jsonl` has 35 rows (17 mac-voice, 15 phone, 3 mac-bubble) and zero `hold`.

**Hop 7 — What to say.** `scripts/lib/reach/proactive.mjs:17-77` is a pure function: context in, a list of `{key, text, kind, urgent?}` out. Each `key` is said at most once a day, via `ctx.sent`. The rules:

| Key | When it fires |
|---|---|
| `session-done-<id>` | Within 10 min of a session ending. If within 180 min past bedtime it becomes an urgent reminder. |
| `leave-<start>` | Travel starts in 5-15 min and he is not out. Fires even mid-session. |
| `gap-<minute/180>` | Not in a session, at home, 09:00-20:30, nothing on now, at least 60 min free, and an open to-do exists. |
| `due-<title>-<date>` | 17:00-21:00, the to-do is due today or tomorrow, and nothing is booked for it. |
| `bed-wind` | 0-30 min before bedtime. |
| `bed-now` | 0-20 min past bedtime. Urgent. |
| `bed-late` | 40-150 min past bedtime and idle under 300 s. Urgent. |

- Defaults are bed 23:45 and wake 07:45 (line 22).
- Why the bedtime rules skip sessions (lines 65-66): "never while he's in a session or out; the session's end or his getting home brings it instead."

**Hop 8 — Hand-off to `orion-reach` and the daily ledger.** `scripts/orion-proactive:77-86`
```js
const r = spawnSync(process.execPath, [join(here, "orion-reach"), m.text, "--kind", m.kind, "--why", `proactive: ${m.key}`, ...(m.urgent ? ["--urgent"] : [])], { encoding: "utf8", timeout: 30000 });
if (r.status === 0) sent[m.key] = true;
...
const keep = Object.fromEntries(Object.entries({ ...state, [dayKey]: sent }).sort().slice(-7));
writeFileSync(`${STATE}.tmp`, JSON.stringify(keep, null, 2)); renameSync(`${STATE}.tmp`, STATE);
```
- It writes `~/.openclaw/orion-controlled/proactive-sent.json` as `{ "<YYYY-MM-DD>": { "<key>": true } }`, keeping 7 days.
- **Bug:** `orion-reach` also exits 0 for `NOT SENT: …` and for the eval refusal, so a message that was held back is marked as said for the whole day.
- Ledger counts of `why: "proactive: …"`: bed 11, gap 10, leave 5, due 1, session 1.

**Hop 9 — `orion-reach` eval refusal and rate gate.** `scripts/orion-reach:36`, `:44-45`
```js
if (!dry) refuseDuringEval("reaching Nick");
...
const gate = allowed(text, history);
if (!gate.ok) { console.log(`NOT SENT: ${gate.reason}.`); process.exit(0); }
```
- `scripts/lib/eval-mode.mjs:12-20`: eval mode is on while the `eval-mode` marker file is under 2 hours old. When on, it prints "Not sent: …" and exits 0. Why (comment): a scenario run "asked 'do I need an umbrella?'… and a real message reached Nick's Discord."
- `scripts/lib/reach/route.mjs:33-37`: identical normalised text within 2 hours is blocked, and at most 6 non-hold messages go out per hour.

**Hop 10 — Choosing the channel.** `scripts/lib/reach/route.mjs:6`, `:14-21`
```js
export const IDLE_AWAY_SECONDS = 5 * 60;
...
if (facts.quiet && !urgent) return { channel: "hold", reason: "quiet hours — it waits until morning" };
if (away) return { channel: "phone", ... };
if (facts.headphones) return { channel: "mac-voice", ... };
if (facts.out) return { channel: "mac-bubble", ... };
return { channel: "mac-voice", reason: "he's at the Mac at home" };
```
- "Away" means locked, display asleep, or idle for 300 s or more.
- `--channel phone` and `--channel mac` force a channel, and `--silent` turns mac-voice into mac-bubble (`orion-reach:47-54`).
- Even if "hold" were reachable, nothing ever releases held messages. The only reference is the comment "held until morning", and `orion-reach:68` simply skips the outbox.

**Hop 11 — Ledger, Mac hand-off and phone outbox.** `scripts/orion-reach:62-68`
```js
appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
if (decision.channel.startsWith("mac")) {
  try { execFileSync("/usr/bin/open", ["-g", `orion://reach?id=${encodeURIComponent(id)}`], { timeout: 5000 }); }
  catch { entry.channel = "phone"; entry.reason = "the ORION app isn't running"; appendFileSync(LOG, `${JSON.stringify(entry)}\n`); }
}
if (entry.channel !== "hold") appendFileSync(OUTBOX, `${JSON.stringify({ id, text: entry.text, kind, push: entry.channel === "phone" })}\n`);
```
- `outreach.jsonl` row: `{id:"reach-<ms>-<6hex>", at, text, kind, why, channel, reason, urgent, headphones, loud, listen}`.
- `outreach-outbox.jsonl` row: `{id, text, kind, push}`.
- Failure behaviour: if `open` fails, it falls back to the phone and writes a second ledger line with the same id.

**Hop 12 — The Mac receives `orion://reach`.** `native/Orion/Sources/Orion/AppDelegate.swift:173-177`, `:205-219`
```swift
if url.scheme == "orion", url.host == "reach", let id = ..., let entry = Self.outreach(id: id) {
    state.deliverReach(entry.text, aloud: entry.channel == "mac-voice", headphones: entry.headphones,
                       loud: entry.loud, listen: entry.listen)
```
- It looks the id up in `outreach.jsonl`, newest first, retrying 10 × 0.2 s.
- The comment at line 207 ("opens the URL before it appends the line") is stale: `orion-reach` now appends first. The retry makes this harmless.

**Hop 13 — Bubble or speech, and `ReachVolume`.** `native/Orion/Sources/Orion/AppState.swift:493-518`
```swift
reachMessage = text
onWantsSummon?()
...
OrionLog.write("[reach] \(aloud ? "aloud" : "silent bubble") — \(text.count) chars")
guard aloud else { return }
if loud { ReachVolume.raiseToFull(restoreAfter: 180) } else { ReachVolume.prepare(headphones: headphones) }
...
speak(text, origin: .voice)
```
- If the dashboard is visible, the message goes into its chat instead of a pop-up. The bubble clears after 120 s.
- `native/Orion/Sources/Orion/ReachVolume.swift:7-12`: target volume is 35 with headphones, 45 without, used when muted or below 20; above 70 it drops to 55. This mirrors `route.mjs speakingVolume` (lines 25-30).
- `raiseToFull` sets 100 and restores the old level after 180 s. It is only used for `--loud` (the morning briefing).
- Speech then goes through `AppState.swift:762 speak` → `TTSClient.swift:160` (`~/.openclaw/orion-tts.sock`, the `com.nickmadaio.orion.tts` launchd daemon).

**Hop 14 — Phone push via the ORION Link app.** `native/OrionLink/App/LinkEngine.swift:74-90`, `:188-220`
- It ticks every 4 s and calls `deliverOutreach()` each time. `deliverCheckins()` runs every 8th tick (about 30 s).
- Each outbox line becomes a `LinkCommand` chat record (`device:"orion"`, `status: done`, `reply: text`).
- When `push == true`, it also creates a `LinkAlert` (`kind:"orion"`, `level:1`, text capped at 240 chars).
- On a CloudKit save failure (lines 216-219) it re-appends the text to the outbox and sets `problem`.
- `deliverCheckins` (lines 144-180) runs the installed `orion-checkin tick --json`, then reads and truncates `alerts-outbox.jsonl`, which is fed by `orion-watch` (line 195) and the plugin's `account-health.ts:168-170`. It creates `LinkAlert kind:"checkin"`.
- **Bug:** unlike outreach, a failed check-in save is not re-queued, so those alerts are lost.
- Both outboxes use read-then-truncate, so a line appended between the read and the write is lost.

**Hop 15 — The iPhone notification.** `native/OrionMobile/App/CloudLink.swift:88-106`
```swift
let alertSub = CKQuerySubscription(recordType: LinkSchema.alertType, predicate: NSPredicate(value: true),
                                   subscriptionID: "orion-link-alerts", options: [.firesOnRecordCreation])
visible.alertLocalizationKey = "%1$@"
visible.alertLocalizationArgs = [LinkSchema.alertText]
visible.category = PhoneAppDelegate.checkinCategory
visible.shouldSendMutableContent = true
visible.desiredKeys = [LinkSchema.alertKind, "level"]
```
The record type is `"LinkAlert"` (`MobileCore/LinkSnapshot.swift:43`).

## Feeders into the same outboxes

- **`orion-checkin tick`** (`scripts/orion-checkin:151-182`), run by the Link app about every 30 s:
  - Skips entirely in eval mode (line 152).
  - Skips during class (line 162), and cancels check-ins whose title looks like a class (line 159).
  - Escalation gaps are `GAPS = [10, 10, 5, 5]` minutes up to level 4 (`lib/life/follow-through.mjs:3`). A defer is clamped to 5-45 min.
  - Gives up after `MAX_ALERTS = 8`. State lives in `checkins.json`.
- **`orion-watch`** (`scripts/orion-watch:33`, `:160-195`):
  - Exits in eval mode.
  - Morning or after-class questions when 180+ min of the day are free.
  - Morning cutoff is `minute < 780` (13:00). After-class window is the class end + 45 min.
  - The day turns at 4 AM. State lives in `watch.json`, keeping 7 days.

## Path B: OpenClaw cron → `orion-cron-deliver` → Discord

**Hop B1 — The cron jobs.** The definitions live in OpenClaw's store (`~/.openclaw/state/openclaw.sqlite`; there is no `~/.openclaw/cron/jobs.json`). I did not query it, so the exact commands and `--match` patterns are unverified. From the docs (`docs/planning/v2/HANDOFF.md:82-84`, `docs/planning/RISK_SWEEP.md:195`, `:279`):

| Job | Schedule | Delivery label | Notes |
|---|---|---|---|
| `orion-focus-guard` | `* * * * *` | `focus-guard` | runs `orion-focus check` |
| `orion-standing-orders` | `0 * * * *` | `standing-orders` | runs `orion-standing` |
| `orion-daily-memory` | `10 2 * * *` | `daily-memory` | runs `orion-daily && openclaw memory index`; re-homed to Europe/London per PHASE_GATES |

- The labels come from `cron-delivery-history.jsonl`.
- These run inside the `ai.openclaw.gateway` launchd agent (KeepAlive, port 18789).
- There is also a separate launchd job, `com.nickmadaio.orion.daily`: 00:20 plus `RunAtLoad`.

**Hop B2 — Deciding whether to deliver.** `scripts/orion-cron-deliver:63`, `:191-219`
```js
const DEFAULT_MIN_INTERVAL_MINUTES = 10;
if (spoken.length === 0) { await recordOutcome("silent", result.code); ... }
if (match && !match.test(spoken)) { await recordOutcome("no_match", result.code); ... }
if (previous.message === message && sinceLast < 6 * 60 * 60 * 1000) { ... "duplicate" ... }
if (sinceLast < minIntervalMinutes * 60 * 1000) { ... "held_back" ... }
```
- Why it exists (header): "announce -> last (last -> no route, will fail-closed" — the cron jobs were running and delivering nowhere.
- The message body is capped at 1200 chars and prefixed `[label]`.
- The wrapped command's exit code is preserved, and a delivery failure never fails the job.

**Hop B3 — The ledgers.** `scripts/orion-cron-deliver:173-177`, `:234`
- `cron-delivery-history.jsonl`: `{v:1, at, label, outcome, exitCode}`.
- `cron-delivery.json`: `{label: {at, message}}`.
- Live counts: focus-guard 17,518 `no_match` and 1 `delivered`; standing-orders 303 `silent`, 60 `no_match`, 29 `delivery_failed`; daily-memory 13 `delivered`, 4 `delivery_failed` (DNS: "Could not resolve host").

**Hop B4 — What `orion-focus` prints.** `scripts/orion-focus:368-401`
- Speaking cooldown by strike count: `{1: 6 min, 2: 4 min, 3+: 2 min}`.
- Strikes go down by one for each on-task minute (`:345-346`).
- Quiet hours deliberately do not apply (`:364-366`): "Nick started this session on purpose."
- `announce` only writes to stdout (`:94-95`: "speech is reserved for native voice replies"), so Discord is its only outlet.

**Hop B5 — What `orion-standing` prints.** `scripts/orion-standing:66-69`, `:797-798`
- Quiet hours are 23:00-08:00; during them only `severity === "urgent"` findings get through, unless `--force`.
- `auto` mode is `morning` at 08:00, `evening` at 21:00, and `check` otherwise.
- With `--notify` it routes through `orion-notify`. I can't tell if the cron job passes that flag.

**Hop B6 — `orion-notify`, when used.** `scripts/orion-notify:68-71`, `:204-240`, `:345-376`
- Hourly cap of 6, dedupe window of 30 min, quiet hours 23-08. Messages in quiet hours are deferred to a `flush` digest. Nothing in the repo ever calls `flush`.
- Transport is `openclaw message send --channel/--target` if `ORION_NOTIFY_CHANNEL`/`ORION_NOTIFY_TARGET` or a configured channel exists, otherwise Discord.
- **Bug:** it has no eval-mode check of its own, so the `openclaw` transport is unguarded during evals.

**Hop B7 — `orion-discord-alert`.** `scripts/orion-discord-alert:18`, `:37-49`
- `refuseDuringEval` runs first.
- Requires `ORION_DISCORD_NOTIFICATIONS=true` and a valid webhook in `.env`.
- Sends `allowed_mentions: {parse: []}`; `ORION_DISCORD_SILENT=1` adds flag 4096 (no phone ping).
- Capped at 1500 bytes. A curl failure exits 1.
- **Bug:** the eval refusal exits **0**, so `orion-cron-deliver` records `delivered` and saves state, which then suppresses the same real message for 6 hours. `orion-notify` likewise counts it as sent.

## Bugs found

1. **Quiet hours never hold anything.** `presence.mjs:22` checks for `"night"`, which `orion-now` never outputs. Only the `bed-now` and `bed-late` nudges are explicitly urgent; the rest would be held if this worked.
2. **Gated messages are marked as said.** `orion-proactive:80` treats exit 0 as sent, but `orion-reach` also exits 0 for `NOT SENT` and for the eval refusal.
3. **Check-in alerts can be lost.** `alerts-outbox` is truncated before the CloudKit save and not restored on failure. Both outboxes have a read-then-truncate race.
4. **Eval refusals look like successes.** `orion-discord-alert` exits 0 when it refuses, so callers record "delivered".
5. **`orion-notify` has no eval guard** on its `openclaw message send` path.
6. **Installed `orion-watch` is behind the repo.** It is missing the to-do sweep from commit 6c93032.

## Git history
- `orion-proactive` and `lib/reach/proactive.mjs`: 26baa71 2026-10-08 "more proactive…"; 094ebe2 2026-10-07 "ORION speaks first with context…"
- `orion-reach`: dce48ae 2026-10-08 "morning briefing when Nick is actually up"; a139f4b 2026-10-07 "ORION messages Nick first… (WIP)"
- `lib/reach/route.mjs` and `presence.mjs`: a139f4b 2026-10-07
- `lib/eval-mode.mjs`: c2eda84 2026-09-30
- `orion-cron-deliver`: 4a2816d 2026-09-27; 9c36b1c 2026-09-26; 93e9a42 2026-08-20
- `orion-standing`: 3f05780 2026-09-03; 50f7110 2026-09-01; d9cf665 2026-08-11
- `orion-notify`: d9cf665 2026-08-11
- `LifeWatch.swift`: 094ebe2 2026-10-07; 562c9f1 2026-10-07; 7724c43 2026-09-30
- `ReachVolume.swift`: dce48ae 2026-10-08; a139f4b 2026-10-07
- `LinkEngine.swift`: dce48ae, a139f4b, ae41446, ff0ec35, 017d51c, 51e0b56, b59bdca (2026-09-30 to 10-08)
- `orion-checkin`: ae41446 2026-10-02; 37c29fd 2026-09-30

## Environment variables and config
- **Env vars:**
  - Paths and state: `ORION_CONTROLLED_DIR`, `ORION_EVAL_MARKER`, `ORION_CHECKIN_FILE`, `ORION_WATCH_FILE`, `ORION_HEALTH_LOG`, `ORION_ENV_PATH`.
  - Test seams: `ORION_STANDING_AGENDA`, `ORION_BRIDGE_BIN`.
  - Delivery: `ORION_NOTIFY_CHANNEL`, `ORION_NOTIFY_TARGET`, `ORION_DISCORD_SILENT`.
  - In `.env`: `ORION_DISCORD_NOTIFICATIONS`, `ORION_DISCORD_WEBHOOK_URL`.
- **Files under `~/.openclaw/orion-controlled/`:**
  - Path A: `proactive-sent.json`, `outreach.jsonl`, `outreach-outbox.jsonl`, `alerts-outbox.jsonl`, `checkins.json`, `watch.json`, `focus-history.jsonl`, `eval-mode`.
  - Path B: `cron-delivery.json`, `cron-delivery-history.jsonl`, `remote.json` (orion-notify state).
- **Elsewhere:** `~/Library/Application Support/ORION Link/status.json`.
- **launchd agents:** `ai.openclaw.gateway`, `com.nickmadaio.orion.dashboard`, `com.nickmadaio.orion.remote` (the integrity verifier, then `orion-remote-bridge run`), `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`. The repo's `native/launchd/` also has `com.nickmadaio.orion.daily`.