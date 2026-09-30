# att-collect

## Where you start
Converters: `fromCalendarEvents(events, { now }) -> { items, skipped }`, `fromWaitingStore(store, { now }) -> items`, `fromFocusHistory(rows, { now }) -> items`.

## Interface
`export async function collectAttention({ now, readers = {} }) -> { items: item[], outages: { source: string, message: string }[] }`
readers: `{ calendar?: async () => events, waiting?: async () => store, focusHistory?: async () => rows }`.

## Decisions
- For each of calendar, waiting, focusHistory in that order: if the reader is absent skip it. Otherwise await it and convert; any throw (reader or converter) -> outage `{ source, message: error.message.slice(0, 200) }` where source is "calendar", "waiting" or "focus".
- Calendar skipped > 0 is not an outage.
- Readers run sequentially (simple and deterministic).

## Tests (tests/attention-collect.test.mjs)
1. "items from every source are combined".
2. "a failing source is an outage, not silence" — calendar reader throws -> outages [{ source: "calendar", ... }], waiting items still returned.
3. "an invalid store is an outage" — waiting returns {} -> outage source "waiting".
4. "unconfigured sources are ignored" — readers {} -> { items: [], outages: [] }.

## Exchange plan
FILE collect.mjs and tests in exchange 1; DONE when green.
