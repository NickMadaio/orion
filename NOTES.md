# fix/live-rerun-1020: calendar intent layer (progress notes)

## 2026-10-20 23:00 — what the re-run really shows (routing log, read only)

- 2a "can u redo tomorrow after my first class, gym first then resume" and 7 "reschedule tomorrow, put piano practice first":
  the code path WORKED (`code-first`, flow `say`, the exact line "Resume isn't on your day…" / "Piano practice isn't on your day…").
  `before_agent_finalize` then ran the claims checker on the code's own sentence ("…I'll put it first" reads as a claim),
  revised twice and replaced it with the generic `honestLine`. Root cause 1: a code-built `say` reply was not final.
- 2b "actually do resume before gym": the follow-up memory is only set after a WRITE; 2a wrote nothing, so the desk got it
  and read "resume" as `session resume`.
- 5 "put cs lab from now until ten thirty" at 22:42: `clockAfter` rolled 10:30 to the next morning (past midnight) and
  printed it as "10:30 AM is past midnight". Root cause: no "already passed" rule.
- 9b "dinner then gym": not a reorder of the remembered request (right), but then the form invented a time and the guard
  asked "what time?".
- 10 "can u put a 45 min walk tomorrow at 5": no code reader for a timed add; the form dropped "at 5".

## Design

One layer, `calendar-intent.ts`, reads the sentence into
`{ verb: add|move|replan|reorder|remove|extend, items[{name,start,end,minutes,fromNow}], anchor, day: today|tomorrow }`
or a refusal reason. Shared pieces:
- `intent-gate.ts`: the allow-only gate (imperative start, take-backs, doubt, hearsay, questions), on raw and typo-fixed text.
- `intent-time.ts`: spoken times, clock rules per day (at 5 = 17:00; evening 10:30 = 22:30; passed = refused, never rolled
  to tomorrow; tomorrow 7-11 without am/pm = ask).
- `intent-run.ts`: intent + day -> one scheduler argv and a specific reply, or a specific "say".
`day-replan.ts` keeps the replan planning (resolveItem, fitAround, replanReply); `direct-add.ts` keeps its exports as
wrappers. `runScheduleFlow` calls the layer once instead of the two readers. A code `say` is final in finalize.

## 23:20 — layer in place, existing suite green (1398)

- New: `intent-gate.ts` (gate moved from day-replan, plus the handoff's follow-up refusals: unless / if it / decide later /
  kiddin / jkjk / i guess / meh), `intent-time.ts` (clock + length rules), `calendar-intent.ts` (reader), `intent-run.ts` (executor).
- `day-replan.ts`: `planReplan(ask, day)` split out; stated lengths ("dinner for 30 min"); tomorrow with no anchor starts after
  the first class (an evening: after the last class + the trip home). Test updated: "another day with no anchor" is no longer the form's.
- `direct-add.ts`: `readUntilShape`; an end time already behind him today says "has already passed (it's …)" (test updated from
  "too close to now").
- `runScheduleFlow`: one intent branch replaces the replan + direct-add branches; times re-read against the day's own clock.
- `local-routing.ts`: code-first = `runsFirst(intent)` (replan, reorder, add at a time / until) or a take-back; the code-first
  flow runs before the session/wake/reminder flows; a code `say` is final in finalize; a replan `say` is remembered for a follow-up.
- Changed test: cslab "reading at 10:30" — read by code it now refuses to book over Annika 22:30 (the form-path variant kept).

## 23:40 — execution tests, a false "Done", review fixes

- Script-level test (`tests/calendar-intent-run.test.mjs`, real orion-reschedule on the fake bridge, through the built
  `runScheduleFlow`) found a real honesty bug: a run headed `NOTHING WAS CHANGED: must-haves could not fit: Gym.` that lists
  the plan it tried ("planned CS Lab 21:55–22:30") was reported as "Done: cleared Gym; CS Lab 9:55 PM…". Now a run whose first
  line is NOTHING WAS CHANGED/BOOKED is never "done" and its plan lines are never said (`schedule-reply.ts`, moved out of
  schedule-flow.ts to keep it under 800 lines).
- Code review (subagent) fixes: other sentences after a "put X until T" are read strictly ("… Actually make it 11."); "morning"
  beats the 1-6 PM rule; any other-day word (thurs, fri, weekend, next month, the 25th, in two days) is refused; junk titles
  (for now, just in case) refused; a follow-up naming another day is not a reorder of the remembered one; a move onto a class is
  refused with the class's times; two different blocks by one name go to the normal path; a "say" with worker tool calls is
  still work-checked.
- Left to the normal path on purpose: class skips/overruns, adds with no time (the form previews them), anchored adds
  ("after my lab"), compound requests ("move gym to 7 and push the resume back"), "push everything N min" (late flow),
  weekdays/other days, before-5AM "tomorrow", and anything the gate refuses (except a take-back of a readable request, which
  is said back).

## 23:55 — done (not pushed, not deployed)

- `npx tsc --noEmit && npm test` (plugin): 72 files, 1598 tests pass (was 1396). New: calendar-intent.test.ts 172 (table of
  every audit and review phrasing), intent-run.test.ts 29 (execution and what reaches Nick through finalize).
- `node --test tests/*.test.mjs`: 1700 pass (was 1691, 1 flaky agentic-halts at baseline). New: calendar-intent-run.test.mjs 9
  (real scheduler on the fake bridge, today and tomorrow).
- dist rebuilt. Deploy is Nick's step (scripts/orion-deploy).
