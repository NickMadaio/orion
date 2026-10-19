# 2026-10-19 CS Lab incident

Tonight (about 21:00 to 22:05 BST, 20:00 to 21:05 UTC) ORION could not put "CS Lab" on the calendar from now until 22:30, in five
attempts over an hour, and told Nick things that were not true. Branch `fix/cslab-flow` (worktree `ORION-worktrees/cslab-flow`).
Times below are UTC; BST is +1.

## What happened, step by step

| UTC | What | Why it went wrong |
|---|---|---|
| 20:00:38 | "im not at the gym, im just doing cs lab right now, prob finish right before annika" ran `log "cs lab" --from 17:50 --to now` (group `log-mvfoiormsxep`). It deleted the planned CS Lab, moved the Gym, created `cs lab`, and said "Gym has no room today; CS Lab has no room today." | `log` treated the planned CS Lab as something he had been *kept from* by his own `cs lab`. It was the same thing. It also put the Gym (planned 19:20-20:50, 40 min already under way) on its re-entry list while leaving its remaining 50 minutes where they were, then could not "re-enter" it: two slips "no-room", for a Gym that was still on the calendar. |
| 20:53:02 | ORION's blank ask: "Nothing planned till 10:30 - what are you up to? I could put CS Lab there." (blank ask about 17:00-now) | The ask read a day with no `cs lab` and no Gym in it (its gap started at 17:00, the end of the lab class). The to-do "CS Lab" was not seen as booked or logged, so it was offered. |
| 20:54:27 | "yes, put cs lab until 10:30" | `answersAsk` took it (10:30 is a time), so the schedule flow ran, but the flow had no idea what "yes" or ORION's offer meant: the 9B form chose `move` on the fixed lab class, `compile` refused ("does not move"), the turn fell to the worker. |
| 20:54:38 | Worker ran `orion-reschedule add "CS Lab" 120 --at 10:30` | 10:30 as morning, and 120 minutes. The tool guard refused: "describe the change in words to Nick (say what you would move and ask him to confirm)". The worker obeyed that sentence: "I need to ask you to confirm the change first", to a man who had just said yes. |
| 21:03:02 | Review: "Nothing logged today. Slipped: CS Lab (no room), Gym (no room). 8-9, 12:30-3:30, 5-10:03 unknown." | No logged block was visible (below), and the two slips from 20:00 were read as written. |
| 21:03:24 and :37 | Speech-to-text "I'm can kill you. Orion, I'm going to die. I can't…", then the continuation "…Put CS for right now until ten thirty." Both got the same crisis paragraph. | The continuation is joined to its first half, so the joined text matched the crisis phrases again and the request was never read. |
| 21:04:23 | "I'm fine… I'm just annoyed. Can you please put CS lab from now until ten thirty?" -> "I can't add that to your calendar right now, but I'll log that you're annoyed" | A request that ends in "?" counted as a question: the flow was skipped and the worker, with no tool, answered. |
| 21:04:49 | "just leave it" | |

## The calendar tonight (read-only checks)

- `get_calendar_event` for the `cs lab` block (4BF94D16…) and the Gym (7F6DE8F6…) both return `exists: false`, and the bridge lists
  **no** ORION-marked event in the next seven days. The write at 20:00:38 reported success and the undo journal still ends with that
  group (no later undo). They were already missing at 20:53 (the blank ask's gap began at 17:00). **I did not find what removed them.**
  Nick should check Calendar. This is why tonight's review saw nothing, and why the fix below does not rely on the calendar alone.
- The Mac bridge in use (`~/.openclaw/orion-remote/bin/orion-mac-bridge`, built 10-06) is older than the source: it writes only
  `[orion:kind]` and returns no `orionTags`, so the `logged` tag `log` writes is dropped on write and read. Even a surviving block would
  not have counted as logged. Rebuilding and installing the bridge (`native/OrionMacBridge`) is Nick's step; it is not done here.

## Fixes

| | Fix | Where | Test |
|---|---|---|---|
| a | `parseAskContext` reads ORION's own words in the context label: the offer ("I could put CS Lab there") and the end of the free stretch ("Nothing planned till 10:30"). `answersAsk` takes a yes only when something was offered. | `schedule-flow.ts`, `local-routing.ts` | `cslab-incident-2026-10-19.test.ts` |
| a | New `direct-add.ts`: "yes", "yes, put X until T", "put X from now until T", "Put CS for right now until T", "put X from 9:55 PM to 10:30 PM" are read by code and run as one `add X <minutes> --at <now rounded up>` (`--again` when the same title already ran today). The form is not asked. | `direct-add.ts`, `runScheduleFlow` | same |
| a | A clock said with no am/pm is the next time it shows: 10:30 at 21:55 is 22:30. The form's add/move/extend times get the same correction unless he said am/pm. | `direct-add.ts`, `compile` | same |
| a | Spelled-out times ("ten thirty", "eleven forty five", "three o'clock") become digits, only after a time word. | `spokenTimesToDigits` | same |
| a | "Can you please put … ?" is a request, not a question (judged on the last sentence); real questions are unchanged. | `isQuestion` | same |
| a | An add of something that already happened today (the logged `cs lab`) is another session, not a duplicate. | `compile` add | same |
| b | The guard no longer says "ask him to confirm". It says a requested change is already confirmed, never to say "can't", and to restate the exact change in one sentence. Backstop: if the worker was refused and no flow acted, code runs the schedule flow on the worker's restatement (if it states a time), else says "I couldn't make that change just now, so nothing was changed. Tell me the block, the day and the start and end times". | `tool-guards.ts`, `local-routing.ts` | same |
| c | `log` writes `logged.jsonl` (calendar id, title, minutes) and `undo` removes the rows. Calendar events whose id is in it are marked logged whatever the bridge returned; the review and the blank asks also see a logged row the calendar no longer has. | `lib/life/logged.mjs`, `live-day.mjs`, `calendar-write.mjs`, `orion-reschedule`, `orion-day-review`, `orion-proactive` | `tests/incident-cslab-2026-10-19.test.mjs` |
| c | A slip "CS Lab replaced by cs lab" (an older `log`'s) is not shown as Slipped. | `day-review.mjs` | same |
| d | The blank ask never offers a to-do he logged today, and waits 45 minutes after a log. | `decide.mjs` | same |
| e | `log` of the same activity as the planned block is fulfilled: no slip, no re-entry. A displaced block with a piece still ahead keeps it (the elapsed part is a "reality" slip, never "no-room"), and the day is not re-laid for it, so a log of the past never removes a future must. | `reality.mjs` | same |
| f | See below. | `local-routing.ts`, `distress.ts` | same |

## f. The crisis reply (what changed, exactly)

Produced by the plugin only (`distress.ts` `CRISIS_REPLY`, used in `local-routing.ts`); it is not in the workspace `AGENTS.md`.

- **Unchanged:** `CRISIS`, `CRISIS_REPLY`, and every path where a message with danger words gets the fixed reply, before any flow, tool or model.
  A first message, a message with danger words and a request together, and a continuation that itself has danger words all still get it.
- **Changed:** when a spoken continuation ("(Continuing — my last message was cut off…)") follows a turn that got the crisis reply, and the
  continuation by itself has no danger words, it is no longer joined to the first half. It is read alone (`run.afterCrisis`), its request
  runs through the normal flow, and its reply gets one added line, `SUPPORT_LINE`: "If things ever feel unsafe, call 999, or Samaritans free on 116 123."
  For a turn that goes to the worker, the same line is added through `AFTER_CRISIS_NOTE`.
- "I'm fine… I'm just annoyed" has no danger words, so it was never a crisis turn; it is now simply an ordinary request.

## Not fixed

- What removed the `cs lab` block and the Gym from the calendar tonight (not in any log I could read).
- The deployed bridge is the 10-06 build (above): rebuild and install it.
- The two bad slip rows from 20:00 (`CS Lab` and `Gym`, "no-room") are live data and were left alone; the review now hides the CS Lab one, the Gym one stays until the day rolls over.
- Nick's CS Lab 21:55-22:30 was not put on the calendar by this work (no live changes were made).
