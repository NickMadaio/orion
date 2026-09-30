# hist-ledger

## Where you start

`scripts/lib/orion-automation-history.mjs` does not exist. Nothing else in the tree reads or writes automation history. The entry format is in common.md.

## Interface

```
export const HISTORY_STATUSES  // ["succeeded","failed","refused","outcome_unknown"]
export const HISTORY_DELIVERIES // ["not_requested","withheld","delivered","not_delivered","unknown","not_attempted"]
export function isHistoryEntry(value) -> boolean
export async function appendAutomationHistory(file, entry, { now = Date.now } = {}) -> { recorded: true }
export async function readAutomationHistory(file, { since = 0, until = Number.MAX_SAFE_INTEGER } = {}) -> { entries, skipped }
```

- `entry` is exactly `{ at, name, status, reason, delivery }`. The caller never passes `v` or `recordedAt`.
- `isHistoryEntry(value)` checks a full stored line object: all seven keys, `v === 1`, `recordedAt` a safe integer ≥ 0, and the five entry fields valid.

## Decisions

**appendAutomationHistory**

1. Throw `new TypeError("invalid history entry")` when any of these holds:
   - `entry` is not a plain object;
   - it has any key other than the five;
   - `at` is not a safe integer ≥ 0;
   - `name` fails the regex;
   - `status` is not in HISTORY_STATUSES;
   - `reason` is neither null nor a regex-matching string;
   - `delivery` is neither null nor in HISTORY_DELIVERIES.
2. Build the line as `JSON.stringify({ v: 1, at, name, status, reason, delivery, recordedAt: now() }) + "\n"`, in that key order.
3. Create the directory with `mkdir(dirname(file), { recursive: true, mode: 0o700 })`.
4. Write with `appendFile(file, line, { mode: 0o600, flag: "a" })`. Never read, rewrite or truncate the file.
5. Return `{ recorded: true }`.

**readAutomationHistory**

1. Read the whole file as UTF-8. On `ENOENT`, return `{ entries: [], skipped: 0 }`. Rethrow any other error.
2. Split on `"\n"`. Ignore empty lines entirely: they are neither entries nor skipped.
3. A non-empty line counts as skipped when:
   - it is longer than 4096 characters;
   - it fails `JSON.parse`;
   - or it parses but fails `isHistoryEntry`.
4. Keep only entries with `since <= at < until`, sorted ascending by `at`. Sort a copy; the sort must be stable.
5. Return `{ entries, skipped }`, where `skipped` counts every skipped line in the file, whatever the window.

## Tests (`tests/automation-hist-ledger.test.mjs`)

1. **"appends one line per entry and reads them back in time order"**
   - Append at=3000, then at=1000, then at=2000, with `now: () => 42`.
   - Read: `at` order is [1000, 2000, 3000], every `recordedAt` is 42, `v` is 1.
2. **"rejects invalid entries with a TypeError"**
   - Each of these must throw a TypeError: `null`; a missing name; name `"../x"`; status `"done"`; at `-1`; at `1.5`; reason `"Quiet Hours"`; delivery `"sent"`; an extra key `output`.
   - Use `assert.rejects(..., TypeError)`. Afterwards the file does not exist.
3. **"never rewrites earlier lines"**
   - Append one entry and read the raw file bytes. Append a second entry.
   - The raw file starts with the first bytes, unchanged.
4. **"missing file reads as empty"**
   - Read a path that was never written: `{ entries: [], skipped: 0 }`.
5. **"corrupt and invalid lines are skipped and counted"**
   - Write a raw file containing, in order:
     - a valid line;
     - `{broken`;
     - a valid-JSON line with `"status":"done"`;
     - a blank line;
     - a second valid line.
   - Expect 2 entries and `skipped === 2`.
6. **"window is half-open: since inclusive, until exclusive"**
   - Entries at 1000, 2000, 3000. `{ since: 1000, until: 3000 }` returns [1000, 2000].
7. **"creates the file 0600 and its directory 0700"**
   - Append into `<temp>/history/x.jsonl`.
   - `(await stat(file)).mode & 0o777` is `0o600`, and the directory's is `0o700`.

A valid entry for the tests: `{ at: 1000, name: "hist-test", status: "succeeded", reason: null, delivery: "not_requested" }`.

## Exchange plan

1. FILE the module.
2. FILE the tests.
3. Read the check output, then fix with EDIT.
4. DONE.

## Traps

- `typeof null === "object"`: check for null explicitly.
- `Number.isSafeInteger(1.5)` is false. Use it for `at`, not `Number.isInteger`.
- Don't use `writeFile`: an append must never replace the file.
- The directory mode check needs a fresh directory. The test's temp root already exists, so create a subdirectory.

## For the reviewer

- Judge against the Decisions above.
- `isHistoryEntry` being exported is intended.
- Umask can't widen 0o600/0o700 into something looser, so the mode test is reliable.
