# Live audit: awareness and curiosity, 2026-10-16 18:50 BST to 2026-10-19 09:25 BST

Read-only audit. Nothing was changed and nothing was sent. Times are BST (outreach.jsonl and the JSON ledgers store UTC; add 1 h).
Sources: `~/.openclaw/orion-controlled/` (outreach.jsonl is the single ledger of every send, held and dropped row),
`~/.openclaw/logs/orion-app.log` (lines 944614 onward), `~/Library/Logs/orion/remote-bridge.log`, installed scripts in
`~/.openclaw/orion-remote/scripts`, `pmset -g log`.

## Summary

The loop works mechanically but it is badly tuned and it starves the one thing Nick asked for.

1. The 20-a-day "runaway guard" (`orion-reach:112-118`) is eaten by low-value ladder pings, so the daily gym (a must) was never nudged on 10-17 or 10-18.
2. After the ceiling trips, the loop retries every tick: 477 dropped rows (172 on 10-17, 305 on 10-18) for 12 distinct messages. Nothing reached Nick, but it is a runaway.
3. When the ceiling resets at midnight, the stale backlog is released: "Time to start: Gym" at 00:00 on 10-19 (planned 17:08 the day before), then "It's been 508 min" at 01:45, 12 minutes after he said "going to bed now".
4. The nightly review is not at 22:00 (it is bedtime minus 30), was never delivered on 10-17, and the 10-18 one was sent at 00:01 with wrong content.
5. The phone has produced no signals since 10-16 17:14. Location is unknown, so ORION never speaks except for the morning brief.
6. No curiosity ask ("what are you up to?") was ever delivered. `curiosity.json` has `asks: []`.

## 1. Proactive messages

Counts per local day (outreach.jsonl, rows with `at` >= 2026-10-16T17:50Z; 542 rows in total):

| Day | Delivered | Held (sleep) | Dropped by ceiling |
|---|---|---|---|
| 10-16 (from 21:12) | 7 | 0 | 0 |
| 10-17 | 21 | 1 | 172 |
| 10-18 | 22 | 2 | 305 |
| 10-19 (to 09:25) | 11 | 1 | 0 |

Channels delivered: phone 4+20+22+1, mac-bubble 3+0+0+9, mac-voice 0+1+0+1. Every phone push also posts a silent Mac bubble
(`[reach] silent bubble` x60 in orion-app.log). Voice was used only for the two morning briefs.

### Full log of what Nick actually received

10-16
- 21:12:15 bubble "Time to start: Gym." (planned 21:05, outreach.jsonl:256 area). 21:22 bubble "still not started"; 21:32 bubble "It's been 21 min. Gym, now. Phone down."; 21:37 phone "You've been avoiding Gym for 26 min. Get up."; 21:42 phone "I'll stop pinging about Gym - I've moved what I could."
- 23:32:21 phone "Bed at 12:00 AM. Start wrapping up." and the day review (see section 4).

10-17
- 00:02:33 bed-now: held (sleep), later expired unreleased (correct, it was stale).
- 10:41:32, 10:51:16, 11:01:32, 11:06:27, 11:11:19 phone: ladder for "finish resume" (planned 09:33). Nick's first wake signal was 11:04 (morning.log). The 11:06 text "You've been avoiding finish resume for 25 min. Get up. We're doing it now." landed two minutes after he woke.
- 11:05:05 VOICE morning brief (319 chars), then `[question] sending to phone after silence` (orion-app.log, 11:05:50). No matching outreach row, so I cannot confirm the phone copy was created.
- Four more five-message ladders, each ending "I'll stop pinging... I've moved what I could.": CS Lab 12:16-12:46, Review spending 13:07-13:41, DO MACRO TEST 13:57-14:37. That is 20 counted messages by 14:37.
- 17:08:43 onward: Gym ping attempted every 36 s for 6 h 24 min, 168 rows, every one `status: dropped, reason: ceiling`. Nothing delivered. The 90-min must-do gym (planned 17:08-18:38) got no nudge.
- 23:32:58 and 23:50:02: bed-wind and the day review, both dropped by the ceiling.

10-18
- 02:18:50 daily-memory update, held ("Discord failed" fallback); released with the held watcher alerts at 09:04:58-59 (two bubbles, the same memory line twice: 97 and 515 chars).
- 09:25:59 "Time to start: Gym.", 09:43, 10:27 "It's been 1039 min. Gym, now.", 10:45 "You've been avoiding Gym for 1057 min", 11:28 "I'll stop pinging". This is yesterday's gym block (cal-4-adf0e6...) replayed the next morning.
- 11:28-14:31: ladders for finish resume, CS Lab, Review spending, DO MACRO TEST, delivered in hourly bursts (13:29:50, 14:30:51) because the Mac was asleep and only wakes now and then (pmset DarkWake entries; the Mac slept from 10-17 17:57).
- 14:31:27 onward: ceiling reached. 305 dropped rows until 23:59, covering Review spending, DO MACRO TEST, Gym (planned 17:08), bed-wind (23:28), bed-now (23:45, 23:50, 23:56) and the review. Gap with no delivered message: 14:31 to 00:00 (9.5 h).

10-19
- 00:00:12 bubble "Time to start: Gym." (the 10-18 gym, 7 h late), 00:01:01 bed-now and the review (phone), 00:10:32 gym "still not started".
- 00:34:03 bed-late: held (sleep). Never released; it is now stale.
- 00:43 Nick types "going to bed now" (chats/E929E67E...json). The alarm is set to 07:00.
- 01:45:16 "It's been 508 min. Gym, now. Phone down.", 01:50:06 "You've been avoiding Gym for 513 min", 01:55:33 "I'll stop pinging". Silent Mac bubbles, but inside his sleep window and after he said he was going to bed.
- 08:04:40 "Leave in 11 min for CS2100", 08:19:40 "You should be out the door now", 08:22:19 VOICE morning brief, 08:23:09 the whole brief repeated aloud plus a duplicate 359-char bubble (cut by barge-in at 08:23:27), 08:29:43 "starts in 31 min. Up now - you can still make most of it." The last one came seven minutes after his wake signal and after the brief. Class reminders are allowed to bypass quiet, so this is by design but redundant.
- No message since 08:29 (class 09:00-10:30 is on the calendar). The class hold is not contradicted, but it was also not exercised: held.jsonl is empty.

### Flags

- Sleep window or focus: no focus session has run since the deploy (session restored "finished (abandoned)" at 18:51:29, awareness session.state none, focus-history.jsonl last written 10-16 03:08), so focus hold and break release were never exercised live. Sleep hold worked four times (10-17 00:02, 10-18 00:07, 10-18 02:18, 10-19 00:34) and the 10-18 02:18 item was released at 09:04. Inside the window and not held: 10-19 01:45-01:55 gym bubbles (Mac awake, "late-awake" rule).
- Duplicates: the morning brief on 10-19 (voice, voice again, bubble); the held daily-memory line on 10-18 09:04; the same blank-fill question repeated about 50 times on 10-18 (dropped).
- More than about 20 a day: 21 and 22 delivered on 10-17 and 10-18. The ceiling is 20 counted, plus the uncounted morning and class messages, so it did not trip until the 21st.
- Long silent gaps where the loop should have acted: 10-17 14:37-23:32 and 10-18 14:31-00:00, exactly when the gym was planned (17:08 both days). Also no morning brief at all on 10-18: the phone's unplugged signal (11:57Z) was processed at 20:00 BST by morning.log ("not the morning"), eight hours late.
- Wrong counts and wording: "It's been 1039 min" and "508 min" count from the block's original start, a day old.

## 2. Asks and replies

- `curiosity.json`: `{"asks": [], "blankGapMinutes": 60, "pausedUntil": null}`. No blank-fill ask was ever recorded.
- Blank-fill questions ("Quick one for tonight's review - what was 8 to 10:34? Gym, library, nothing?") were generated on 10-18 20:05-23:08 at least 25 times, every one dropped by the ceiling. Because exit 3 means "not recorded, no backoff" (`orion-reach:162-166`), the loop retries on every tick. The span also drifts ("8 to 10:34", then "6:30 to 10:13") and starts at 08:00 even though he was asleep until 12:57.
- Mismatch asks: every ladder row carries an `askId` equal to the reach id and `category: mismatch` (e.g. reach-1792181535592-139691). The only evidence of a reply is the check-in log: Review spending and DO MACRO TEST were marked "started" at 21:58 on 10-18 (life-history.jsonl, actualStart 1318), and their pings stopped at 21:58:07. Gym kept going. The "started" event carries no askId.
- `inbound-turns.jsonl` has two rows, both bare `{at}` (that is the designed format): 10-16 18:47:13 (this is the local `approve A-7F3K` retry that remote-audit.jsonl refused, not Nick; it is logged as an inbound turn) and 10-19 01:43:15 ("going to bed now"). Neither resolved an ask. No row carries a replyTo.
- `checkins.json` still holds Review spending and DO MACRO TEST as `phase: active` from yesterday, so they are stale (and the 10-18 review listed Review spending as slipped although it had been started).
- Backoff: there is none for questions held or dropped. The ladder itself is fixed-interval (5 steps, about 10 min apart on a live Mac) and then "given_up". It repeated the same three tasks for three days.

## 3. Phone

- No evidence the new phone build is running. Last phone sample in `health-log.json` phoneSignals: 2026-10-16T16:14:29Z (17:14 BST), 1483 samples, no place or audio fields, none since the deploy.
- `awareness.json`: `location.state: unknown`, `placeId: null`, `at 2026-10-16T16:14:29Z`; `phone.state: unknown`, `lastSampleAt` the same; `audio.phone.route: unknown`; `derived.atHome: null`. `homeKnown: true` is only the seeded default home (`orion-awareness place list` prints a "nick-confirmed address" with a 150 m radius, which is not on disk). So home is known but he is never placed at it.
- The phone is alive for Shortcuts-style signals only: sleepLog got `unplugged`/`used` from iphone on 10-17 12:36Z, 10-18 11:57Z and 11:58Z, 10-19 07:22Z. ORION Link status.json says Connected, `commandsHandled: 6`, last command the 07:22Z unplugged event.
- No `orion.ask` category use, no replyTo values anywhere (remote-audit.jsonl stops at 10-16 18:47; there is no phone chat message since). `outreach-outbox.jsonl` does not exist (consumed by Link), so delivery to the phone cannot be proven. Phone-history.json shows the pushes as device "mac".
- `remote-link.json` is the Discord bridge (botUser orion#0259), online, lastSeen 09:19:10, not the phone.
- Effect: `reason` on every Mac send reads "home is not known and no headphones - bubble only", so nothing is spoken except the morning brief.
- HANDOFF "pending live steps" (relaunch the phone app, Always location, geofences) look undone.

## 4. Day review

- Implemented as bedtime minus 30 (`orion-proactive:231-235`), not 22:00 as the spec and HANDOFF say.
- 10-16: ran 23:32:21, sent to the phone (text): "Nothing logged today. Slipped: Gym, finish resume, CS Lab. 8-1:30, 5-5:50, 9-9:42, 10:35-11:32 unknown." (outreach.jsonl:64). Blank list includes times he was in class.
- 10-17: attempted 23:32:58 and 23:50:02, both dropped by the ceiling. Never delivered. Nick never saw a review for 10-17.
- 10-18: attempts at 23:50:58 and 23:56:01 dropped; sent at 00:01:01 on 10-19: "Nothing logged today. 8-12 unknown." It was computed for the new day, so it did not say anything about 10-18. Marked as `review-2026-10-18` in proactive-sent.json.
- Spoken: never. It is forced to the phone ("asked for the phone") because location is unknown.

## 5. Calendar writes

Undo journal (`reschedule-undo.json`, 10 entries, oldest 10-17 09:00):
- 10-17 09:00:39-40 `fill --anchors`: created finish resume (09:33), CS Lab, Review spending, DO MACRO TEST, and Gym (17:08). The gym was planned.
- 10-17 11:11, 12:46, 13:41, 14:37 (`log-mvc8l51...`, `log-mvcbz77...`, `log-mvcdygl...`, `log-mvcfxs0...`): each gave-up `displace` deletes the old block and creates one new one. Nothing says where the new one went and it is not in slips.jsonl `replacedBy` (null each time).
- 10-18 09:04:57-59: the same four tasks and the Gym (17:08) created again.
- 10-19 07:04:32: Gym created at 17:50; 09:05:01 the Gym moved and CS Lab, Review spending, DO MACRO TEST created for the third day in a row.
- The gym was planned on 10-16 (21:05), 10-17, 10-18 and 10-19: the anchor works. It was done on none of them.

slips.jsonl: five rows, all `reason: gave-up`: Gym 10-16 (53 min), finish resume 10-17 (52), CS Lab (7), Review spending (5), DO MACRO TEST (5). Nothing for 10-18: the 10-18 gave-ups (finish resume, CS Lab at 14:31; Gym) wrote life-history rows but no slips and no journal entry, so the day review and `displace` lost them. The 10-18 09:25 "Gym" replay is also recorded as life-history `plannedStart 1028` for 10-18 and is really yesterday's gym.

Wrong-looking moves and states:
- Each day the same overdue to-dos (finish resume, CS Lab, Review spending, DO MACRO TEST) are re-planned, three days running, and the standing-morning mission says "3 already past its date".
- "I've moved what I could" is sent on give-up even when nothing moved (10-18 14:31, 01:55 10-19).
- The 10-17 first block was planned at 09:33 for a 09:00 alarm that he slept through.
- Stale checkins (`ci-44de4d`, `ci-5ae963`) remain active.

## 6. Errors since the deploy (most frequent first)

1. Ceiling-dropped retries: 477 rows, 12 distinct messages (outreach.jsonl, status "dropped").
2. Discord bridge: 277 "socket error", 418 "session invalidated" (whole file, not dated; the file is not time-stamped), 49 heartbeat-not-acknowledged, 44 reconnects in the last 400 lines.
3. TTS `cancel -> N job(s)`: 170 info lines (orion-tts.err.log); 2 warn "elevenlabs request failed: nodename nor servname" falling back to mlx-warm (offline).
4. Offline Mac: WHOOP GET failures 12 (10-17 21:32, 10-19 08:37), "token refresh failed" 4 and "no usable token ... Reconnect it" 4 (10-18 00:34, 06:30, 18:34, 10-19 08:52), "empty result" 2. WHOOP sleep data last updated for the 10-15 night (`sleep-actual.json`), so sleep source is stale; the token was also renewed 37 times.
5. Delivery: two "Discord failed" fallbacks (10-18 02:18:50 and 09:04:59); 1 reminder dropped as 24689 s late (10-16 18:51:29); lights failed once (10-17 17:57:34, "Bluetooth is off").
6. Mission state: `standing-check` is `blocked` (remote.json).
7. Zero "run failed" strings in any log or ledger since the deploy.
8. Process list: all ORION launchd jobs loaded; `com.nickmadaio.orion.remote` last exit -15 (SIGTERM) but running (pid 80571).

Note: the Mac slept from 10-17 17:57 and woke only in short DarkWake windows. The check-in ladder only advances while it is awake, so ping spacing is arbitrary and bunched in hourly bursts.

## What is working

- Gate: sleep hold and release works (four holds, one verified release). Class hold is unexercised but nothing was sent during class.
- Ceiling is a real guard: it capped the damage.
- `fill --anchors` plans the gym daily; `log/displace` writes in one undo step with a journal.
- Class and leave reminders arrived on time; the morning brief works on a wake signal.
- No "run failed" anywhere; WHOOP token renewal works when online.

## Fix list, ranked by how much it hurts Nick

1. Make the ceiling count by importance, not by arrival. A must (gym) must beat lower items; cap each ladder to one block at a time.
2. On ceiling or hold-exit-3, record the attempt as handled with backoff, so the loop stops retrying every tick.
3. Never replay a block from a previous day at midnight; compute minutes from today's start and expire ladders when the block ends.
4. Fix the review: send at 22:00 as specced, take the date from the key, never within the ceiling.
5. Stop pushing while the Mac sleeps or after "going to bed"; skip the wake/leave ladders once the wake signal is in.
6. Get the phone app updated and opened; set up a real home so location can arrive.
7. Do not repeat the entire morning brief aloud.
8. Process the phone's wake signal even when the Mac was asleep (10-18 had no brief).
