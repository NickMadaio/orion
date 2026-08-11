# Gate 0 — baseline and decisions

Recorded 2026-08-11. Everything below was measured on this machine, not assumed.

---

## 1. Baseline preserved

The repo had **13 modified and 23 untracked files on `master`**, uncommitted.
Preserved as eight themed commits rather than one snapshot, so the health-log
race fix stays independently revertable from the rest:

| Commit | What |
|---|---|
| `b35a731` | fix: health-log lost updates when the app and the plugin write together |
| `cefd605` | fix: narratives outliving their facts, and empties that meant "not connected" |
| `27b0a7e` | fix: a timeline that would not scroll, and a day that hid its own night |
| `d692711` | test: layout and race harnesses that exercise the real code |
| `fd343df` | feat: remove a calendar event through the Mac bridge |
| `71d4581` | fix: orion-daily filed every day's memory under a UTC date |
| `d9cf665` | feat: the orion-* wrapper toolbelt, and a self-doc that can see it |
| `7d0a7b8` | docs: audit, risk sweep, benchmark and learning proposals |

Tagged **`baseline/pre-focus-2026-08-11`**. Working tree clean.

Checked before committing: no secrets in any pending file. The only `sk-ant-`
matches were prose in `RISK_SWEEP.md` describing the prefix. `.env` is gitignored.

## 2. Installed bundle identity

- Path `/Applications/Orion.app`, bundle id **`com.nickmadaio.orion.app`**, version 1.0.
- Binary built **Aug 10 00:02:57**; every source file's mtime predates it.
- The installed binary contains `FileLock` (36 symbols) and `HealthLog.publish`,
  so **source, commit and installed app are in sync**. Verified by symbol, not assumed.
- Running as pid 73064 at the time of writing.

## 3. Launch at login — confirmed, but not via login items

Not a login item. A LaunchAgent: `~/Library/LaunchAgents/com.nickmadaio.orion.dashboard.plist`,
`RunAtLoad` true, running `/usr/bin/open -na Orion`. `launchctl list` shows it
loaded with last exit 0. `com.nickmadaio.orion.daily` is also loaded.

(`osascript … login items` times out with AppleEvent -1712 on this machine, so
the LaunchAgent is the authoritative answer, not the System Events list.)

## 4. Calendar and Reminders

- **Calendar: granted and live.** `orion-app.log` records a successful read every
  5 minutes — 12 calendars, 2 events in window — most recently 02:52:52 today.
  This is the app's own observation, not a terminal's grant.
- **Reminders: not independently confirmed.** `AppleRemindersSync.swift` contains
  **no `OrionLog.write` at all**, so a denial there is invisible in the log while
  Calendar's state is logged every five minutes.

  That asymmetry is itself a finding, and it violates the house rule that every
  external dependency needs a visible unavailable/denied/stale state. Logged as
  an open item below.

  Note the trap recorded in `scripts/orion-agenda`: macOS attributes EventKit
  access to the **responsible process**. Running the bridge from a terminal
  inherits the terminal's grant and says nothing about Orion.app's. So it was
  not "confirmed" by that route on purpose.
- TCC.db could not be read directly — that needs Full Disk Access, which was not
  taken for this.

## 5. The real audio route

Measured with CoreAudio, not guessed:

- Output: **MacBook Pro Speakers, 48000 Hz, 2 ch**, built-in.
- Input: **MacBook Pro Microphone, 48000 Hz, 3 ch**, built-in.
- Output device accepts **44100, 48000, 88200, 96000** only.

**The built-in output device does not accept 24 kHz at all.** It therefore cannot
be pinned there by anything. See Gate 1.

The Bluetooth route has **not** been tested — the headset was not connected.
Gate 1 is not complete without it.

## 6. Toolchain

- Swift 6.3.3, target arm64-apple-macosx26.0.
- `xcode-select -p` → `/Library/Developer/CommandLineTools`, which has **no XCTest**.
- Xcode *is* installed at `/Applications/Xcode.app`.
- Resolved with `DEVELOPER_DIR` per invocation in `Tests/run-domain-test.sh` —
  no `sudo xcode-select -s`, nothing about the machine changed.
- This is why the existing tests are standalone `swiftc` harnesses. That
  convention was an adaptation to a missing framework, not a preference.

## 7. Pure-domain test target — created

- `Sources/SessionDomain/` — a real SwiftPM library target, so its purity is a
  compiler constraint rather than a convention.
- `Tests/SessionDomainTests/` + `Tests/run-domain-test.sh`.
- Seeded with the two-clock rule (plan correction #4). **6 tests, all passing.**

---

## Corrections to the plan's assumptions

Three things the plan asserts that this machine contradicts. None of them
change the plan's direction; all of them change specific work.

**1. The orion-focus cron guard does not exist.**
The plan says "Keep the cron guard behind a rollback switch — do not remove it
until the app-owned guard has passed a full soak." There is no crontab at all:
`crontab: no crontab for nickmadaio`. `scripts/orion-focus` documents that cron
calls `orion-focus check`, but nothing calls it.

Consequence for Gate 3: there is nothing to keep, and nothing to remove. More
importantly, **the existing focus enforcement is not running today**, so the
app-owned guard is not replacing a working thing — it is the first one. That
removes the rollback risk and raises the stakes on getting it right.

`~/.openclaw/orion-controlled/focus.json` exists and reads `{"session": null}`.

**2. Gate 1's candidate A is described wrongly.**
The plan calls A "the current implicit connection" and says the hypothesis is a
*missing* `mainMixerNode → outputNode` connection. Neither matches the code.
`SpeechOutput.swift:244` makes an **explicit** connection with a **hardcoded
24 kHz mono format**, and `outputNode` is never referenced anywhere in the app.
The harness models the real graph. See Gate 1's record.

**3. `AppleRemindersSync` has no logging at all**, so Reminders access has no
visible denied state. Calendar has one. Open item.

---

## Open items carried out of Gate 0

| Item | Where it lands |
|---|---|
| Bluetooth route not yet measured | **Blocks Gate 1 completion** — needs the headset connected |
| **`SessionService` must write a heartbeat every 30 s** | **Gate 3 — required, not optional. See below.** |
| Reminders access has no visible denied/stale state | Fix before Gate 7 (Session UI) at the latest |
| Apple Music Automation consent — acceptable or not? | Gate 10; not needed before then |
| Terminal gained microphone access mid-session | Noted, not requested — see Gate 1 record |

### The heartbeat requirement (Gate 3)

Gate 2 added something the plan did not have, because the tests demanded it.

Downtime is the gap before a `processStarted` event — but the domain only ever
learns when the app came *back*, never when it died. Without a liveness
watermark that whole gap is ambiguous, and the conservative reading writes all
of it off. A crash at minute 49 of a 50-minute block then voids the block.

So `SessionService` **must** call `SessionReducer.noteHeartbeat` on a timer
while a session is running. `Harness.heartbeatInterval` is 30 s and the domain
tests assert the loss is bounded by exactly one interval. If the service does
not write heartbeats, the domain still behaves correctly — it just charges every
crash the maximum. Use the `.common`-runloop timer pattern from `ReminderService`
so it survives window drags.

Heartbeats coalesce (a heartbeat replacing a trailing heartbeat), so this costs
one event per run stretch, not one per interval.
