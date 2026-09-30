# life-sync-apply

## Interface
`export function applyEvents(state, events) -> state`
state: { captures: [], reminders: { [id]: { id, title, due, done } }, tracking: [], notes: { [file]: string[] }, applied: string[] }

## Decisions
- capture.add → push payload.text. reminder.add → set by payload.id (ignored if it exists). reminder.complete → done true. reminder.update → merge title/due only. tracking.log → push payload. note.append → push payload.line to notes[payload.file] (file must match /^[a-z0-9-]+\.md$/; otherwise skip). plan.change → store as state.lastPlanChange = payload.
- An event whose id is already in applied is skipped (idempotent). applied keeps every applied id.
- Never mutate the input state.

## Tests (tests/life-sync-apply.test.mjs)
1. "captures and reminders apply" 2. "applying twice changes nothing" 3. "completion after add" 4. "update only changes title and due" 5. "unsafe note paths are skipped" 6. "input state is not mutated".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
