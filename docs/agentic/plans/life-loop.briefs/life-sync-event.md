# life-sync-event

## Interface
- `export const EVENT_KINDS` — ["capture.add","reminder.add","reminder.complete","reminder.update","tracking.log","plan.change","note.append"].
- `export function validateEvent(value) -> { ok } | { ok:false, errors }`
- `export function makeEvent({ device, clock, kind, payload, at }) -> event` — id = `${device}:${clock}`.

Event: `{ id, device, clock, kind, at, payload }` — device /^[a-z0-9-]{1,40}$/; clock positive safe integer (a per-device counter); at ms safe integer; payload a plain object, JSON size <= 8000 bytes.

## Tests (tests/life-sync-event.test.mjs)
1. "a valid event passes" 2. "id is device and clock" 3. "unknown kinds are rejected" 4. "oversized payloads are rejected" 5. "each bad field is named".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
