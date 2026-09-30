# plan-parse — what Nick said, as plan items

## Where you start
Nick tells ORION his plans in plain words; the model then writes a command line with title, minutes, time and date — and gets it wrong (no date for "tomorrow", asking how long dinner lasts). You write `scripts/lib/life/plan-parse.mjs` and `tests/tighten-plan-parse.test.mjs`: a deterministic parser the tools can use instead.

## Interface
```
export function parsePlans(text, now)
  // now = { date: "YYYY-MM-DD", minute: int, weekday: 0..6 }
  // -> [{ title, kind, date, start: int|null, minutes: int, fixed: boolean, assumed: [string] }]
export const DEFAULT_MINUTES = { class: 90, social: 120, meal: 45, gym: 60, study: 60, errand: 45, side_project: 60, rest: 30, other: 60 };
```
Split the text into clauses on ", then", "then", " and then ", ";", and ", " before a clause that has its own time or activity. Each clause with an activity becomes one item; clauses without one are ignored.

## Decisions
- **Date**: "today"/"tonight" → now.date; "tomorrow"/"tmrw" → +1; weekday names → the next such day (today if it is that day and the time is still ahead, else next week); "next <weekday>" → the one after that; none → now.date.
- **Time**: "at 7", "7pm", "7:30", "19:00", "noon", "midnight"; "from 10 till 2" / "10-2" / "10 to 2" gives start AND end (minutes = end − start, crossing midnight allowed: 10 PM to 2 AM = 240). Bare hours without am/pm: 1–6 are PM (nobody means 2 AM study); 7–11 are AM unless the activity is social or dinner, or the clause says "tonight"/"this evening", or the date is today and that morning time has already passed — then PM; 12 is noon. "after class"/"after lunch"/"this afternoon"/"this evening" with no clock time → start null, and add "afternoon"/"evening" to `assumed`.
- **Duration**: "for an hour", "for 2 hours", "45 minutes", "like 45 min", "an hour and a half" override; "from…till…" gives it; else DEFAULT_MINUTES[kind], and push `"<N> min"` to `assumed`.
- **Kind** by words: with/friends/party/club/drinks/date/meet → social; dinner/lunch/breakfast/meal prep → meal (but "with <someone>" makes it social); gym/run/workout/lift → gym; study/revise/homework/problem set/reading → study; groceries/laundry/clean/errand/haircut → errand; side project/vlog/video/youtube/editing → side_project; nap/rest/break → rest; lecture/seminar/lab/class → class; else other.
- **fixed**: true for class and social (people are involved); false otherwise.
- **title**: the activity words from the clause, trimmed of the time/date/duration words and leading verbs ("I'm going to", "I have", "add", "going"), first letter capitalised: "Dinner with friends", "Ministry of Sound", "Clean", "Meal prep with a friend".
- An item with no activity words is dropped; an empty result is [].

## Tests (titles exact)
now = { date: "2026-09-29", minute: 900, weekday: 2 } (Tuesday 3 PM) unless stated.
1. `dinner with friends tomorrow at 7` → one item: title "Dinner with friends", kind social, date 2026-09-30, start 1140, minutes 120, fixed true, assumed ["120 min"].
2. `club from 10 till 2 tonight` — "tonight I'm going to Ministry of Sound from 10 till 2" → start 1320, minutes 240, kind social, date 2026-09-29.
3. `three plans in one sentence` — "going home after class to clean, then meal prep with a friend at 6, then the club at 10" → 3 items in order: Clean (errand, start null, assumed includes "afternoon"), Meal prep with a friend (social, 1080), Club (social, 1320).
4. `durations in words` — "gym for an hour and a half at 7am tomorrow" → minutes 90, start 420, kind gym, fixed false.
5. `weekday names` — "study macro thursday at 2" → date 2026-10-01, start 840, kind study.
6. `a passed bare hour today means pm` — now minute 900: "groceries at 5" → start 1020.
7. `no activity gives nothing` — "tomorrow at 7" → [].
8. `invalid now throws` — parsePlans("x", null) throws TypeError.

## Exchange plan
FILE module with the exports and a clause splitter + tests; EDIT dates; EDIT times; EDIT kinds/titles; DONE.

## Traps
- "10 till 2" at night: the end is the next morning; minutes must be positive.
- "at 6" after "meal prep with a friend" is 6 PM (social), not 6 AM.
- Do not treat the "a" in "an hour" as an activity word.

## For the reviewer
Check each test item field by field; titles are compared exactly.
