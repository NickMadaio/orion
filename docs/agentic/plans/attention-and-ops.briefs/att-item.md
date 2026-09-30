# att-item

## Where you start
Nothing exists. The item shape is in common.md.

## Interface
```
export const ATTENTION_SOURCES = ["calendar", "waiting", "focus", "standing", "automation", "manual"];
export const ATTENTION_SIGNALS = ["urgency", "actionability", "novelty", "confidence", "importance", "interruptibility"];
export function validateAttentionItem(value) -> { ok: boolean, errors: string[] }
export function normalizeAttentionItem(value) -> item   // throws TypeError("invalid attention item")
```

## Decisions
validateAttentionItem adds one error string per failing field, in the form `"<field>: <why>"` (e.g. `"title: must be 1-200 characters"`). A field fails when:
- not a plain object at all -> errors `["item: must be an object"]`
- `id` not matching `/^[a-z0-9][a-z0-9:._-]{1,95}$/`
- `source` not in ATTENTION_SOURCES; `kind` not matching `/^[a-z_]{1,40}$/`
- `title` not a string of 1..200 chars after trim; `detail` not a string of at most 1000 chars
- `observedAt` not a safe integer >= 0; `dueAt`/`expiresAt` neither null nor a safe integer >= 0
- `dedupKey` not a string of 1..120 chars
- `signals` not an object with EXACTLY the six keys, each null or a finite number in [0,1] (error names the signal: `"signals.urgency: ..."`)
- any extra top-level key -> `"<key>: unknown field"`
normalizeAttentionItem builds a NEW object: trims title and detail (missing detail becomes ""), clamps finite signal numbers into [0,1], leaves null as null, then validates; if invalid, throws `new TypeError("invalid attention item")`.

## Tests (tests/attention-item.test.mjs)
1. "a well-formed item is valid" — the example item from common.md -> ok true, errors [].
2. "each invalid field is named" — one bad value at a time for id, source, kind, title, observedAt, dueAt, dedupKey, a signal (urgency 1.5), a missing signal key, an extra field; each result's errors contains a string starting with that field name.
3. "normalize trims and clamps without mutating" — title "  Hi  ", urgency 1.4, importance -0.2, confidence null -> title "Hi", urgency 1, importance 0, confidence null; original object deep-equals its copy taken before.
4. "normalize throws on what cannot be fixed" — source "email" -> throws TypeError.
5. "a non-object is rejected" — null and "x" -> ok false.

## Exchange plan
FILE item.mjs and the test file in exchange 1; fix from the check output; DONE.

## Traps
- `typeof null === "object"`; arrays are objects too.
- Exact key set for signals: `Object.keys(signals).sort()` compared with the sorted list.

## For the reviewer
The Decisions list is the specification; error wording beyond the leading field name is free.
