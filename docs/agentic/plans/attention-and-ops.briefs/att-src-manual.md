# att-src-manual

## Interface
`export function parseManualAttention(argv, { now }) -> item`

## Decisions
- argv is an array of strings. The first element not starting with "--" is the title (trimmed, 1..200 chars) — missing -> TypeError("title is required").
- Flags take the next element as value: --due, --expires (Date.parse; NaN -> TypeError("--due must be a date") / "--expires must be a date"); --urgency, --importance (Number in [0,1]; else TypeError("--urgency must be between 0 and 1")). Unknown flag -> TypeError(`unknown flag ${flag}`). A flag with no value -> TypeError(`${flag} needs a value`).
- id = `manual:` + first 12 hex of sha256(`${title}|${now}`); dedupKey = `manual:` + title.toLowerCase() with runs of non [a-z0-9] replaced by "-", cut to 100 chars.
- source "manual", kind "reminder", detail "", observedAt now, dueAt/expiresAt from flags or null.
- signals: urgency from flag or null, importance from flag or null, actionability 0.8, confidence 1, novelty null, interruptibility null.

## Tests (tests/attention-src-manual.test.mjs)
1. "a bare title makes a reminder".
2. "flags set due, expiry, urgency and importance".
3. "each bad flag is named" — --due nope, --urgency 2, --colour red, trailing --due.
4. "the same title shares a dedupKey" — two calls with different now -> same dedupKey, different id.

## Exchange plan
FILE both in exchange 1; DONE when green.
