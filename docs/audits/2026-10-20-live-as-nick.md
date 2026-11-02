# 2026-10-20 live test as Nick: rescheduling after fix 57fd443

Real chat route (`openclaw agent --json`, session keys `orion-chat-live-<id>-<n>`, live app-context prefix), run under launchd (calendar access). Real calendar, real journal.
Runner and raw results: scratchpad `live/live.mjs`, `live/out/*.result.json`. Latency = wall time of the CLI call. Day at start: CS Lab 9:00-11:15 (pinned, past), ECON 1:30-3, MKTG 3:30-5, finish resume 5:50-7:20 PM (already over), Gym 8:15-9:45 PM (90). Clock about 8:55-9:03 PM.
Because the resume block and CS Lab were already over, "the rest of the day" was only Gym.

## Results

| # | Said | Reply (exact) | ms | Calendar change | Verdict |
|---|---|---|---|---|---|
| 1 | reschedule the rest of my day, gym first | "Done, from now: Gym 8:55-10:25 PM." | 10809 | Gym 8:15-9:45 -> 8:55-10:25 (90 min, now). Code path (`code-first`, 1 write, no model). | PASS |
| 2a | can u redo my evening, gym first then resume | "Not done: finish resume is already on today's calendar (5:50 PM-7:20 PM). If it is running long: orion-reschedule extend ..." | 9809 | none | PARTIAL: safe, but the reason is wrong-ish. The plan tried to re-add resume (90 min at 10:30 PM) and the scheduler refused as a duplicate of the finished 5:50 block. The extend hint does not fit; it should say resume already passed and offer to add it after gym. |
| 2b | actually do resume before gym | "Gym is happening now (8:55-9:45 PM). Resume before gym cannot fit today because gym is already in progress. Want to move gym later or do resume tomorrow?" | 22799 | none | FAIL (no harm). Went to the 9B worker, not the replanner. The 4B desk first read "resume" as `session resume` (not executed; focus session untouched, still the 10-15 finished one). The answer is wrong: resume-then-gym fits fine if gym moves later. |
| 2c | ok and push everything 30 min | "Done: Gym now 9:25 PM-10:15 PM." | 15753 | Gym 8:55-9:45 -> 9:25-10:15 (kept its 50 min) | PASS (only Gym remained) |
| 3 | should i do gym first tonight? | "Your gym session is scheduled for 20:55 to 21:45 tonight, so you should do it now." | 13708 | none | PASS (no change, sensible). Minor: 24-hour times in a typed reply. |
| 4 | reschedule my night, gym first. actually no nvm | "You said "gym first" but then "nvm" (never mind), so I didn't change anything. Your gym is still happening now at 8:55 PM." | 23460 | none | PASS. Flow fell back "a question, not a change". |
| 5 | put cs lab from now until ten thirty | "Done: CS Lab 9:00 PM-10:30 PM; Gym ends at 9:00 PM." | 14235 | added a 2nd CS Lab 9:00-10:30; Gym 8:55-9:45 cut to 8:55-9:00 (5 min!). `add "CS Lab" 90 --at 21:00 --again` | PARTIAL. Did what the words say, but did not mention that the real CS Lab (9:00 AM) is already over, and silently squeezed Gym to 5 minutes. Not the new code path. |
| 6 | ok so reschedule my day and put gym frist then whatevers left by priorty, im kinda tired tho | "What time or how long do you mean? I haven't changed anything." | 30217 | none | FAIL (safe). Typo + preamble + run-on defeats the parser; the question asked is irrelevant. |
| 7 | reschedule the rest of my day, put piano practice first | "I didn't manage to make that change - nothing on your calendar changed. Can you say it again?" | 16801 | none | PARTIAL (safe). Does not say there is no "piano practice" on his day. |

Every turn was code-first or desk-routed; no turn hit a timeout; slowest 30 s (#6). Turns 1 and final took 9-11 s total, 4.5-6.4 s of it in the plugin.

## Surprises

- Something other than me changed his calendar during the run: at 19:55:29 UTC (during #1) a background process logged Gym as "gave-up" (missed 50 min, txn `log-mvh3rxkq77tk`), trimming Gym to 8:55-9:45 PM, with a new slips.jsonl row and a journal entry. This is not from my turns (session keys differ; no turn at that time). From #2 on, Gym was 50 min, but the replanner still used its 90 min anchor (#1, final), correctly.
- Moving an in-progress Gym "to now" (#1, final) restarts it. Consistent with "from now", not mentioned in the reply.
- Phrasings the allow-list parser does not accept fall to the old path: "actually do resume before gym" (#2b), the typo run-on (#6), a block that does not exist (#7).
- "resume" is ambiguous with the focus-session word "resume" at the desk.

## Final REAL request (kept)

Sent: "reschedule the rest of my day, put gym first" (9289 ms, code path, 1 write).
Reply: "Done, from now: Gym 9:05-10:35 PM."
Now on his calendar: CS Lab 9:00-11:15 AM; ECON1115 1:30-3:00 PM; MKTG2201 3:30-5:00 PM; finish resume 5:50-7:20 PM; **Gym 9:05-10:35 PM** (was 8:55-9:45; 90 min, starts at now+5, pinned). Classes untouched, nothing with people, no to-do, alarm or message touched. Correct per the criteria. Undo: `orion-reschedule undo` puts Gym back to 8:55-9:45.
The only state file changed was pins.json (a pin for the new Gym, as the scheduler does).

## Cleanup

- #1-#7: each undone through launchd (`Undone: restored Gym; removed Gym.`, `put Gym back.`, `put Gym back; removed CS Lab.`); the day was re-read and matched its pre-conversation state each time (`dayMatchesBefore: true`); reminders, watches, wake-request, pins, slips and created-events unchanged by my turns.
- Journal: restored to the snapshot after each test. At the end it holds the 10 original entries plus 2 new ones: the background Gym "gave-up" log (not mine) and the kept final change. I deliberately did not cut back to 10 (the cap would have evicted his 10-18 and 10-19 entries), so it has 12 entries. Capped copy saved in scratchpad `live/snap/undo-final-capped.json`; original in `live/snap/reschedule-undo.json`.
- slips.jsonl has the background "gave-up" row (not mine, left as is). watches.json differs from the snapshot only by `mailCheckedAt` (a background poller).
- No turns by other session keys appeared except the earlier `orion-probe-plugin` probes (before I started).

## Re-run (main 7193492, about 22:40-22:47 BST)

Same route, fresh keys (`orion-chat-live-r*`), undo after each. His kept Gym (9:05-10:35 PM) was never touched. It was past 10:35 PM, so "tomorrow" (10-21: CS1802 9:00-10:30, CS2100 11:00-12:30, no gym/resume/piano) was used wherever a change was needed. #6 was sent as the same typo'd run-on with "tomorrow after my first class" inserted. Turns of #2 were 20 s apart.

| # | Said | Reply | ms | Change | Verdict |
|---|---|---|---|---|---|
| 2a | can u redo tomorrow after my first class, gym first then resume | "I didn't manage to make that change - nothing on your calendar changed. Can you say it again?" | 14006 | none | FAIL (safe) |
| 2b | actually do resume before gym | same generic line (desk again read "resume" as `session resume`; not executed) | 21226 | none | FAIL (safe) |
| 2c | ok and push everything 30 min | "Not done: nothing could be booked." | 12773 | none | PASS-ish: nothing to push, wording poor |
| 5 | put cs lab from now until ten thirty (22:42) | "That doesn't fit: 10:30 AM is past midnight, so I haven't booked it. Tell me an earlier end time." | 11659 | none | PARTIAL: right outcome (no change, no 5-min Gym squeeze), garbled reason; should say 10:30 PM has passed |
| 6 | typo run-on, tomorrow | "Done, but not as asked, after your first class: Gym 1:20-2:50 PM. Gym couldn't go first at 10:35 AM because CS2100 ... is in the way, so it's the first thing after that." | 11133 | Gym 1:20-2:50 PM added (90 min, after the second class + trip home) | PASS (honest about the miss) |
| 7 | reschedule tomorrow, put piano practice first | generic "didn't manage" line | 13627 | none | PARTIAL: safe, still does not name piano practice |
| 8 | resched my day, gim frist, nvrmind | "Not done: there's no movable block by that name." | 11235 | none | PASS (no change), reply irrelevant |
| 9a | reschedule tomorrow after my first class, gym first | same as #6 | 10148 | Gym 1:20-2:50 PM | PASS |
| 9b | dinner then gym | "What time or how long do you mean? I haven't changed anything." | 16624 | none (nothing reordered; classes and Gym untouched) | PARTIAL: safe, but did not act |
| 10 | can u put a 45 min walk tomorrow at 5 | "Done for tomorrow: walk 1:20 PM-2:05 PM." | 12107 | walk added 1:20-2:05 PM | FAIL: ignored "at 5" (the call was `add walk 45 --date tomorrow`, no `--at`); honest about the time, wrong time |

No timeouts; slowest 21 s.

Cleanup: every change undone ("removed Gym", "removed walk"); both days re-read and equal to their snapshots; reschedule-undo.json, pins.json, slips.jsonl, reminders.json and wake-request.json byte-identical to the pre-run copies (journal 12 entries, as before the run). watches.json had only the background `mailCheckedAt` poll. No other session keys turned up in the routing log.

## Run 3 (main 29226e4, calendar-intent layer, 00:11-00:19 BST on 10-21)

Same route and safety rules; fresh keys `orion-chat-live-t*`; "today" = 10-21 (CS1802 9:00-10:30, CS2100 11:00-12:30, nothing else). Mac on **battery** throughout (29% to 26%, about 1 h left, not plugged in). Nothing here pushes or speaks. Gym on 10-20 (9:05-10:35 PM) not touched.

| # | Said | Reply (short) | ms | Change | Verdict |
|---|---|---|---|---|---|
| 2a | redo my day after my first class, gym first then resume | "Resume isn't on your day, so I haven't changed anything. How many minutes should it be? ..." | 10491 | none | PASS (honest, asks the one thing it needs) |
| 2b | actually do resume before gym | same question | 9986 | none | PASS-ish (consistent, but did not move on) |
| 2c | ok and push everything 30 min | "Nothing was changed on your calendar." plus a raw "Exec failed: orion-reschedule day --rebuild --date today" line | 22436 | none (flow: class does not move) | PARTIAL: no change, but the tool error leaks into the reply |
| 3 | 45 min walk today at 5 | "A 45-minute walk is booked for 5 PM today." | 16660 | 5:00-5:45 PM "45 min walk" (title keeps "45 min") | PASS; desk's guess was a `log_intake water 45` call, but health-log changed only by a background strain sync, so no water log was written |
| 4 | piano practice first after class | "Done: piano practice 1:20-2:20 PM." | 17282 | piano practice 1:20-2:20 PM | PARTIAL: it was asked for first after class (10:35); landed after the second class + trip home with no "not as asked" note, unlike Gym |
| 5 | reschedule my day after class gym first (no comma) | "Done, but not as asked, after your class: Gym 1:20-2:50 PM. Gym couldn't go first at 10:35 AM because CS2100 ... is in the way..." | 11379 | Gym 1:20-2:50 PM | PASS |
| 6a | reschedule my day after my first class, gym first | same as 5 | 12302 | Gym 1:20-2:50 PM | PASS |
| 6b | dinner then gym | "Dinner wasn't in the plan I just made and isn't on your day, so I haven't changed anything: Gym is still 1:20-2:50 PM. To change the order, say ..." | 11031 | none | PASS (no reorder, best answer of the three runs) |
| 7 | resched my day, gim frist, nvrmind | "Okay, you took that back, so I've left your day as it is." | 7737 | none | PASS |
| 8 | can u block 2 hrs for econ homework tonight at 7 | "Done: econ homework 1:20 PM-3:20 PM." | 14160 | econ homework 1:20-3:20 PM | FAIL: ignored "tonight at 7" (call `add "econ homework" 120`, no `--at`); the reply is honest about the time, but it is not the time he asked for |

**(a) Where new blocks land:** read from the Calendar database through launchd (the bridge list does not return a calendar name): the new blocks are on the iCloud calendar "Calendar": 45 min walk, piano practice, Gym (twice) and econ homework, each `Calendar|iCloud`, none on "School". Checked before each undo. (Both "Calendar" and "School" are iCloud-store calendars; his old "finish resume" and Gym rows from 10-15/10-18 were on School.)

**(b) Latency:** 7.7-22.4 s per turn on battery (median about 11.4 s). Code-first turns took 3.3-7.4 s inside the plugin (7.7-12.3 s end to end); the two slowest (#2c at 22 s, #4 at 17 s and #3 at 17 s) were the ones that still touched the desk or worker.

Cleanup: every change undone ("removed 45 min walk", "removed piano practice", "removed Gym" x2, "removed econ homework"); the day was re-read and matched its snapshot after every conversation; reschedule-undo.json, pins.json, slips.jsonl, reminders.json, wake-request.json, orion-created-events.json and today-plan.json byte-identical to the pre-run copies. watches.json differs only by the background `mailCheckedAt`. No other session keys in the routing log.

## Run 4 (main f506bba, 03:45-03:54 BST on 10-21)

Same route and safety rules; fresh keys `orion-chat-live-u*`; "today" = 10-21 (only CS1802 9:00-10:30 and CS2100 11:00-12:30 on it). **Battery 9% falling to 7%, about 30-40 min left**; a guard would have stopped the chain at 6%, it never fired. No reply contained "Exec failed" or any error text (checked all 14 turns).

| # | Said | Reply (short) | ms | Calendar diff | Verdict |
|---|---|---|---|---|---|
| 1 | block 2 hrs for econ homework tonight at 7 | "Done: econ homework 7:00 PM-9:00 PM." | 8314 | +19:00-21:00 econ homework | PASS (fixed) |
| 2a | add gym at 7pm today | "Done: Gym 7:00 PM-8:30 PM." | 7128 | +19:00-20:30 Gym | PASS |
| 2b | move gym from 7 to 8 | "You said 8:00 AM, but that change would have put Gym at 8:00 PM, so I haven't changed anything. Say it again with the time..." | 13408 | none | FAIL (safe): garbled message; reads 8 as AM, then refuses because it would be PM; the move did not happen |
| 3 | push everything 30 min | "There's nothing of yours left on your day to push..., so nothing changed." | 7696 | none | PASS (clean, correct for this day) |
| 4 | piano practice first after class | "Done: piano practice 1:20-2:20 PM. Piano practice wasn't on your day, so I added an hour at 1:20 PM... default length... couldn't go at 10:35 AM..." | 18994 | +13:20-14:20 piano practice | PASS (fully honest now) |
| 5 | add reading at 7pm, my class ends at 5 | "Reading is booked for 7 PM tonight." | 20207 | +19:00-20:00 Reading | PASS (class end ignored harmlessly; no class ends at 5 today) |
| 6a | redo my day after my first class, gym first then resume | "Resume isn't on your day... How many minutes should it be?" | 9781 | none | PASS |
| 6b | actually do resume before gym | same question | 9078 | none | PASS-ish (repeats, does not carry the order) |
| 7 | 45 min walk today at 5pm | "You said 5:00 PM, but that change would have put walk at a time of its own, so I haven't changed anything. Say it again with the time, like "put walk at 5 PM"." | 13664 | none | **FAIL**: a regression from Run 3, where it booked 5 PM; the "stated-time backstop" misfires on a plain add and the message is nonsense |
| 8a | reschedule my day after my first class, gym first | "Done, but not as asked, after your first class: Gym 1:20-2:50 PM. ...Gym wasn't on your day, so I added an hour and a half at 1:20 PM, its usual length." | 11077 | +13:20-14:50 Gym | PASS |
| 8b | dinner then gym | "Dinner wasn't in the plan I just made and isn't on your day, so I haven't changed anything: Gym is still 1:20-2:50 PM. To change the order, say ..." | 9705 | none | PASS |
| 9 | need to do laundry, 1 hr, today at 6pm (mine) | same "You said 6:00 PM, but that change would have put laundry at a time of its own..." | 13644 | none | FAIL (same misfire as #7) |
| 10a | lunch 45 min today at 1pm (mine) | "Your focus session is running: 45 minutes." | 10871 | none on calendar | **FAIL, side effect**: started a real focus session ("lunch") instead of a calendar block |
| 10b | make it an hour | "Your lunch session is now set for 60 minutes." | 28188 | none | FAIL: restarted the focus session at 60 min (ended the 45-min one as "early") |

Calendar check (before each undo, Calendar database via launchd): econ homework, Gym (twice), piano practice and Reading all landed on iCloud calendar "Calendar", none on School.

Latency 7.1-28.2 s (median about 11 s), on battery.

### Cleanup, and one mess I made

- All calendar changes undone (removed econ homework, Gym x2, piano practice, Reading); day re-read equal to its snapshot after each conversation, and at the end. Journal, pins, slips, reminders, wake-request, created-events and today-plan byte-identical to before (journal restored after each conversation).
- #10 was not on the calendar. It started and re-started a **focus session**; the runner's undo did not know about it. I found it from the reply, abandoned it (`orion-session abandon` + `release`: "40s of focus"; status finished) and removed its two lines (45 s "early", 40 s "abandoned") from focus-history.jsonl, which was otherwise untouched (20 lines again; 22-line copy in scratchpad `live/snap4/focus-history.after.jsonl`). focus-state.json now holds that abandoned "lunch" session in place of the 10-15 finished one (I had not snapshotted it; status is "finished" either way). The session ran about 1.5 minutes, Firm enforcement off.
- Lesson for the harness: add focus-state.json, focus-history.jsonl and `orion-session status` to the snapshot, as the original sweep did.

## Run 5 (main 7358a39, 22:42-22:52 BST on 10-21; tests for tomorrow, 10-22)

Mac on **AC** (81%, charging). 10-22 holds only CS1800 9:00-10:30 and "finish resume" 2:00-3:00 PM (a School-calendar item the scheduler treats as fixed). Nick was awake with **his own focus session running** (id 81FB0AA5, "Focus", 3 blocks, guided, started 22:38). The runner paused for any foreign session key (none appeared; the routing log shows no turns but mine) and recorded his focus session's status, event count and focus-history length before and after every turn.

**Not run, on purpose:** "lunch 45 min tomorrow at 1pm" then "make it an hour" / "make it 30", and "make it N" on any block. The old bug was exactly "make it an hour" resizing a focus session, and with his real session running a misroute would have edited it, which cannot be undone cleanly. Re-run those when no session is running.

| # | Said | Reply (short) | ms | Diff (10-22) | Verdict |
|---|---|---|---|---|---|
| 1 | 45 min walk tomorrow at 5pm | "Done for tomorrow: walk 5:00 PM-5:45 PM." | 9354 | +17:00-17:45 walk | PASS |
| 2 | laundry, 1 hr, tomorrow at 6pm | "Done for tomorrow: laundry 6:00 PM-7:00 PM." | 6442 | +18:00-19:00 laundry | PASS |
| 3a | add gym tomorrow at 7pm | "Done for tomorrow: Gym 7:00 PM-8:30 PM." | 5476 | +19:00-20:30 Gym | PASS |
| 3b | move gym from 7 to 8 | "That doesn't fit: There's no gym on your day, so I haven't moved anything." | 5506 | none | FAIL (safe): searched today, not the gym it had just made for tomorrow |
| 3c | (retry) add gym tomorrow at 7pm, then "move tomorrow's gym from 7 to 8" | "Not done: moving it would break the day rules - Gym (8:00 AM-9:30 AM) overlaps CS1800..." | 5441 / 8150 | +Gym 7-8:30 PM, then none | FAIL (safe): read "7 to 8" as AM and quoted a Gym at 8:00 AM that was never booked; PM is not inferred from the block it is moving |
| 4 | block 2 hrs for econ homework tomorrow at 7pm | "Done for tomorrow: econ homework 7:00 PM-9:00 PM." | 7394 | +19:00-21:00 econ homework | PASS |
| 5a | reschedule tomorrow after my first class, gym first then resume | "That doesn't fit: finish resume is a class or a plan with people, so it doesn't move. I haven't changed anything." | 5127 | none | PARTIAL (safe): resume exists tomorrow but as a fixed School item; the reason is wrong for a to-do style block, and gym was not placed first |
| 5b | actually do resume before gym | same line | 5395 | none | PARTIAL (same) |
| 6 | add stretching, call mom at 5 | "You said 5:00 PM, but the change I worked out would have put stretching wherever there was room ... Say it again with the time" | 12992 | none | PARTIAL (safe): it did not book a call with Mom (good) but did not ask which item "at 5" belongs to, and the message is clumsy |
| 7 (mine) | add 30 min emails tomorrow at 10am | "That doesn't fit: CS1800 ... is 9:00-10:30 AM tomorrow, so emails can't go at 10:00 AM. I haven't booked it. Tell me another time." | 6054 | none | PASS (correct, clear) |
| 8a (mine) | add reading tomorrow at 8pm | "Done for tomorrow: reading 8:00 PM-8:30 PM." | 5108 | +20:00-20:30 reading | PASS |
| 8b (mine) | push it 15 min | "I couldn't make that change - nothing on your calendar changed. Can you say it again?" | 12961 | none | FAIL (safe): the block it just made is not resolved for "it" |

Latency on AC: 5.1-13.0 s (median about 6.4 s); on battery in Run 4 it was 7-28 s. No reply contained "Exec failed" or error text.

**No focus session started anywhere:** across all 15 turns Nick's focus status, event count and focus-history length (20 lines) were identical before and after every turn (`focusChanged: false` throughout). His running session was never touched; no new session id appeared.

Calendar check: walk, laundry, Gym, econ homework and reading all landed on iCloud calendar "Calendar", none on "School".

Cleanup: every created block was undone; 10-21 and 10-22 re-read equal to their snapshots after each conversation; reschedule-undo.json, pins.json, slips.jsonl, reminders.json, wake-request.json, orion-created-events.json and today-plan.json byte-identical to the pre-run copies. watches.json differs only by the background mail poll.
