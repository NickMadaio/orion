# life-study-parse

## Interface
`export function parseStudyRequest(text, today) -> { minutes, subject, byDate, splitMinutes } | { error }`
today: "YYYY-MM-DD".

## Decisions
- minutes: "2 hours", "2h", "90 min", "90 minutes", "an hour", "half an hour", "1.5 hours". Missing → 60.
- subject: word(s) after "for" or "on" up to "before"/"by"/end, lowercased and trimmed; known aliases map: macro/macroeconomics/econ → "ECON1115", marketing/mktg → "MKTG2201", discrete/cs1800 → "CS1800", programming/cs2100 → "CS2100". Unknown subject is kept as typed. Missing → null.
- byDate: "today", "tomorrow", a weekday name (the NEXT such day after today; if today is that weekday, 7 days later), or "YYYY-MM-DD". Missing → today.
- splitMinutes: sessions longer than 120 minutes are split into chunks of at most 90 → e.g. 180 → [90, 90]; 150 → [90, 60]; otherwise [minutes].
- minutes outside 15..600 → { error: "minutes out of range" }.

## Tests (tests/life-study-request.test.mjs)
today = "2026-09-29" (a Tuesday).
1. "hours and subject alias" — "schedule 2 hours of study for macro" → 120, ECON1115. 2. "minutes form" — "90 min on discrete". 3. "before a weekday" — "before friday" → 2026-10-02. 4. "same weekday means next week" — "by tuesday" → 2026-10-06. 5. "defaults" — "study" → 60, null, 2026-09-29. 6. "long sessions split" — 3 hours → [90,90]. 7. "out of range is an error" — "10 minutes".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
