# att-src-calendar

## Where you start
`scripts/orion-agenda upcoming --json` prints the bridge's events unchanged. Real events use `start` or `startDate` (ISO strings), `end` or `endDate`, `title`, `identifier`, and sometimes `isAllDay`/`allDay`. Treat every field as optional.

## Interface
`export function fromCalendarEvents(events, { now, horizonMinutes = 90 }) -> { items: item[], skipped: number }`

## Decisions
- events not an array -> TypeError("events must be an array").
- For each event: startMs = Date.parse(event.start ?? event.startDate). Not an object, or NaN start -> skipped += 1.
- Skip silently (not counted) when `event.isAllDay === true || event.allDay === true`, when startMs < now - 5*60_000, or when startMs > now + horizonMinutes*60_000.
- key = event.identifier if a non-empty string, else the first 12 hex chars of sha256(`${title}|${startMs}`). id = dedupKey = `calendar:${key}` lowercased, with any character outside [a-z0-9:._-] replaced by "-".
- minutes = Math.max(0, Math.round((startMs - now) / 60_000)); title = minutes === 0 ? `${eventTitle} starts now` : `${eventTitle} starts in ${minutes} min` (eventTitle = trimmed title or "Untitled event"), cut to 200 chars.
- item: source "calendar", kind "starting_soon", detail "", observedAt now, dueAt startMs, expiresAt startMs + 15*60_000.
- signals: urgency (minutes <= 10 ? 0.95 : minutes <= 30 ? 0.8 : 0.6), actionability 0.7, confidence 0.9, novelty null, importance null, interruptibility null.

## Tests (tests/attention-src-calendar.test.mjs)
1. "an event inside the horizon becomes a starting-soon item" — start now+20min -> one item, title "... starts in 20 min", urgency 0.8.
2. "startDate is read when start is absent".
3. "all-day, past and far-future events are ignored" — none become items, skipped 0.
4. "unreadable events are counted" — {title: "x"} and "junk" -> skipped 2.
5. "ids are stable and safe" — identifier "ABC/123:x" twice -> same id, matches /^[a-z0-9][a-z0-9:._-]{1,95}$/.

## Exchange plan
FILE both in exchange 1; DONE when green.
