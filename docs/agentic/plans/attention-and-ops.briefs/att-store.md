# att-store

## Interface
```
export function emptyQueue() -> { version: 1, items: [] }
export async function loadAttentionQueue(file) -> queue
export async function saveAttentionQueue(file, queue) -> void
export function addToQueue(queue, items, now) -> queue
export function ackQueueItem(queue, id, now) -> queue
export function snoozeQueueItem(queue, id, until) -> queue
export function pruneQueue(queue, now) -> queue
export function openItems(queue, now) -> entry[]
```
An entry is `{ ...item, state, surfaced, ackedAt, snoozedUntil }` (common.md).

## Decisions
- load: ENOENT -> emptyQueue(). Invalid JSON, or version !== 1, or items not an array -> `throw new Error("attention queue unreadable")`. Other fs errors rethrow.
- save: mkdir dirname recursive mode 0o700; write `JSON.stringify(queue, null, 2) + "\n"` to `${file}.${process.pid}.${Date.now()}.tmp` with mode 0o600, then rename onto file.
- addToQueue: for each item: if an entry with the same dedupKey has state "open" or "snoozed", replace it with `{ ...item, state: existing.state, surfaced: existing.surfaced, ackedAt: null, snoozedUntil: existing.snoozedUntil }`; otherwise append `{ ...item, state: "open", surfaced: 0, ackedAt: null, snoozedUntil: null }`. `now` is accepted for symmetry and unused.
- ack: state "acked", ackedAt now. snooze: state "snoozed", snoozedUntil until. Unknown id -> `throw new Error(\`no attention item ${id}\`)`.
- prune: remove entries with `expiresAt !== null && expiresAt <= now`, and acked entries with `ackedAt <= now - 7 * 86_400_000`.
- openItems: entries with state "open", plus "snoozed" whose snoozedUntil <= now; unexpired only.
- Every operation returns a NEW queue; the input is never modified.

## Tests (tests/attention-store.test.mjs)
1. "a missing file loads as an empty queue".
2. "save then load round-trips and the file is private" — mode & 0o777 === 0o600.
3. "corrupt content is refused" — write "{" -> rejects with "attention queue unreadable".
4. "adding the same dedupKey replaces the open entry and keeps surfaced" — add, set surfaced to 2 via a new queue object, add again with new title -> one entry, new title, surfaced 2.
5. "ack, snooze and open items" — ack one, snooze another until now+1000 -> openItems at now excludes both; at now+1000 includes the snoozed one.
6. "prune drops expired and old acknowledged entries".
7. "unknown ids throw" — ack("nope") throws /no attention item nope/.
8. "operations never mutate the queue they are given" — deep-freeze input.

## Exchange plan
FILE store.mjs and tests in exchange 1; EDIT from check output; DONE.
