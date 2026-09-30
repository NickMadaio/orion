# morning-brief — the first thing ORION says each morning

## Where you start
ORION's watcher asks about an empty day but sends no real morning message. The mission says ORION should plan, remind and reach out. You write `scripts/lib/life/morning-brief.mjs` and `tests/tighten-morning-brief.test.mjs`: a pure function that turns the day's facts into one short phone message.

## Interface
```
export function morningBrief(facts)
  // facts = {
  //   now: { date, minute },
  //   blocks: [{ title, kind, start, end, fixed }],          // today, any order
  //   deadlines: [{ title, date }],                           // upcoming, any order
  //   sleep: { hours: number|null, recovery: number|null } | null,
  //   weather: { summary: string, rainChance: number|null } | null,
  //   sideProjectLabel: string | null
  // }
  // -> { text: string, parts: [string] }   text = parts joined with " ", ≤ 300 chars
export function clock12(minute)   // 540 -> "9:00 AM"; 780 -> "1:00 PM"
```
Throws TypeError when `facts.now` or `facts.blocks` is missing.

## Decisions (parts, in this order; skip any that does not apply)
1. **Sleep** — if hours < 6: "Short night — <h>h." (one decimal, trailing .0 dropped); else if recovery !== null and < 34: "Recovery's low (<r>%) — go easy.". Otherwise nothing.
2. **First fixed thing** — earliest block with fixed true starting after now.minute: "<Title> at <clock12>." If there is none: "Nothing fixed today.".
3. **Day shape** — count fixed blocks after now: 0 → nothing (part 2 already said it); 1 → nothing; ≥2 → "<n> things fixed, last ends <clock12(end)>.".
4. **Deadline** — the nearest deadline within 7 days (by date, then title): today → "<Title> is today."; tomorrow → "<Title> is tomorrow."; else "<Title> in <n> days.". Shorten the title: drop a leading "DUE HH:MM — ".
5. **Side project** — if no block of kind side_project today: "Side project hour isn't booked — want it after <clock12 of the last fixed block's end, or 1:00 PM if none>?" using `sideProjectLabel` if given ("London vlog hour isn't booked…").
6. **Weather** — only if rainChance ≥ 50: "Rain likely — take a jacket.".
- If the joined text is longer than 300 chars, drop parts from the end (weather first, then side project, then day shape) until it fits.

## Tests (titles exact)
now = { date: "2026-09-30", minute: 450 } (7:30 AM) unless stated.
1. `a normal class day` — blocks seminar 540–630 fixed, lab 660–750 fixed; no deadlines; sleep 7.5h → text starts "CS1802 Seminar at 9:00 AM." and contains "2 things fixed, last ends 12:30 PM."
2. `a short night leads` — sleep { hours: 4.5 } → first part "Short night — 4.5h."
3. `low recovery when sleep was fine` — { hours: 7.2, recovery: 20 } → "Recovery's low (20%) — go easy."
4. `nearest deadline wording` — deadlines [{ "DUE 13:00 — Marketing: Panopto presentation", date 2026-10-02 }] → "Marketing: Panopto presentation in 2 days."
5. `side project nudge uses the label` — sideProjectLabel "London vlog" → contains "London vlog hour isn't booked".
6. `no fixed events` — blocks [] → contains "Nothing fixed today." and the side project question with "1:00 PM".
7. `rain is mentioned only when likely` — rainChance 70 → "Rain likely — take a jacket."; 20 → absent.
8. `long briefs drop the least important parts` — a 250-char deadline title → text ≤ 300 chars and weather part absent.
9. `clock12 edges` — 0 → "12:00 AM", 720 → "12:00 PM", 1439 → "11:59 PM".
10. `missing facts throw` — morningBrief({}) throws TypeError.

## Exchange plan
FILE module + tests; EDIT parts 1–3; EDIT parts 4–6 and trimming; DONE.

## Traps
- Deadline day difference is by calendar date, not 24-hour periods.
- Do not mutate `facts.blocks` when sorting.

## For the reviewer
Wording is user-facing and exact; compare to the Decisions.
