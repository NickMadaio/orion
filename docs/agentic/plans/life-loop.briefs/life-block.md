# life-block

## Interface
- `export const KINDS` — the nine kinds in the common brief's priority order (frozen array).
- `export const SOURCES` — ["calendar","template","orion","nick"] (frozen).
- `export function validateBlock(value) -> { ok: true } | { ok: false, errors: string[] }`
- `export function normalizeBlock(value) -> block` — trims title, returns a NEW object with only the eight known fields; throws `TypeError("invalid block")` if the result is invalid.
- `export function blockMinutes(block) -> number` — end - start.

## Decisions
- errors name the field, e.g. "id", "title", "kind", "date", "start", "end", "fixed", "source".
- date must match /^\d{4}-\d{2}-\d{2}$/ AND be a real date (2026-02-30 is invalid; check by constructing Date.UTC and reading it back).
- start integer 0..1439; end integer, start < end <= 1440. fixed must be boolean.

## Tests (tests/life-block.test.mjs)
1. "a valid class block passes" 2. "each bad field is named" — one case per field. 3. "impossible dates are rejected" — 2026-02-30, 2026-13-01. 4. "normalize trims and drops unknown fields" 5. "normalize never mutates its argument" 6. "normalize throws on an invalid block" 7. "blockMinutes is end minus start".

## Exchange plan
FILE both files in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
