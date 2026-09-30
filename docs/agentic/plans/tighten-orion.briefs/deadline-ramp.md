# deadline-ramp — how much study each day before a deadline

## Where you start
Nick's calendar has one-off deadlines ("Macro (ECON1115) — Quiz 1", "DUE 13:00 — Marketing: Panopto presentation"). ORION books study only when asked. Priority 4 is "deadlines and study for them", so ORION should know, every day, how much study each deadline still needs. You write `scripts/lib/life/deadline-ramp.mjs` and `tests/tighten-deadline-ramp.test.mjs`.

## Interface
```
export const NEEDS = { exam: 600, quiz: 240, presentation: 300, essay: 480, assignment: 300, other: 120 }; // total minutes
export function deadlineKind(title)   // -> key of NEEDS, from the title
export function ramp(deadlines, { today, done = {}, horizonDays = 14, maxPerDay = 180 } = {})
  // deadlines: [{ id, title, date }]   done: { [id]: minutesAlreadyStudied }
  // -> [{ date, items: [{ id, title, minutes, reason }], total }]   one entry per day from today, only days with items
```
`today` is a `YYYY-MM-DD` string (required, else TypeError). A deadline is considered when it is after `today` and within `horizonDays + 10` days; deadlines on or before `today` are ignored. The output covers only the days today … today + horizonDays − 1.

## Decisions
- `deadlineKind`: case-insensitive: "exam", "final", "midterm" → exam; "quiz", "test" → quiz; "presentation", "panopto", "slides" → presentation; "essay", "report" → essay; "assignment", "coursework", "submission", "due" → assignment; else other. First match in that order.
- Remaining = max(0, NEEDS[kind] − done[id]). Spread over the study days = the days from `today` up to the day BEFORE the deadline (none on the deadline day itself), but at most the last `window` days: exam 10, quiz 5, presentation 6, essay 8, assignment 6, other 3.
- Ramp up: weights 1, 2, 3, … across the window (the day before the deadline weighs most). minutes_i = remaining × w_i / Σw, rounded to the nearest 15, minimum 30 for any day that gets study; drop days that round to 0; adjust the last day so the total equals remaining rounded to 15.
- Days before the window get nothing for that deadline.
- Per day, if items total more than `maxPerDay`, scale that day's items down proportionally (rounded to 15, minimum 30 each) and add the cut minutes to the previous day that exists in range (if any); never exceed maxPerDay by more than 15.
- `reason`: "<kind> on <weekday> <day> <month> — <N> min left" e.g. "quiz on Friday 16 October — 240 min left".
- Output sorted by date; items within a day by deadline date then title.

## Tests (titles exact)
1. `kinds from real titles` — "Macro (ECON1115) — Quiz 1" → quiz; "DUE 13:00 — Marketing: Panopto presentation" → presentation; "DUE 13:30 — Marketing (MKTG2201) submission" → assignment; "Dentist" → other.
2. `a quiz ramps over the five days before it` — today 2026-10-11, quiz 2026-10-16, done {} → days 10-11..10-15, never decreasing (30, 30, 45, 60, 75), total 240, none on 10-16.
3. `studied time is subtracted` — done { q1: 180 } → total 60.
4. `a finished deadline needs nothing` — done { q1: 240 } → [].
5. `far deadlines wait for their window` — today 2026-10-01, quiz 2026-10-16, horizon 14 → the first output date is 2026-10-11 and the last is 2026-10-14 (the output stops at the horizon).
6. `busy days are capped and spill earlier` — two exams two days apart with maxPerDay 180 → no day exceeds 195 and total minutes are preserved.
7. `past and out-of-horizon deadlines are ignored` — deadline dated today → [].
8. `invalid input throws` — ramp([], {}) throws TypeError (missing today).

## Exchange plan
FILE module + tests; EDIT kinds; EDIT spreading; EDIT capping; DONE.

## Traps
- Date arithmetic: add days with `Date.UTC(y, m-1, d + n)` and format back; never use local time zones.
- Rounding: round each day, then fix the LAST day so totals match exactly (to 15).

## For the reviewer
Check totals are preserved (to the nearest 15) and no study lands on a deadline day.
