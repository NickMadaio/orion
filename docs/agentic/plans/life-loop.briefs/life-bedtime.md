# life-bedtime

## Interface
`export function bedtimeNudge({ state, minutesPastBedtime, nudgesSent, firstFixedTomorrow, sleepNeedMinutes = 480, now }) -> { level, recheckInMinutes, message }`
- state from sleep-state. firstFixedTomorrow: minute of tomorrow's first fixed block (e.g. class at 540) or null. now: minute of day.

## Decisions
- state not "awake_late" and not "winding_down" → level "none", recheck 30.
- minutesPastBedtime < 15 → "gentle", recheck 15.
- < 60 or nudgesSent < 2 → "firm", recheck 10.
- otherwise → "escalated", recheck 5.
- message (plain, direct, not motivational fluff) must include, when firstFixedTomorrow is known, the sleep Nick can still get: minutes from now until firstFixedTomorrow minus 60 (getting ready), shown as "Xh Ym". Example: "It's 03:00. Class at 09:00 — go to sleep now and you still get 5h 0m."
- If available sleep < 240 minutes, message also says tomorrow will be adjusted (ORION will plan a nap/lighter afternoon).

## Tests (tests/life-bedtime.test.mjs)
1. "daytime is none" 2. "just past bedtime is gentle" 3. "an hour past with nudges ignored escalates" 4. "message counts the sleep left before class" — now 180, class 540 → contains "5h 0m". 5. "short nights promise an adjusted tomorrow" 6. "unknown class time leaves sleep count out".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
