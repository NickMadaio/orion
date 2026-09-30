# hist-summary

## Where you start

`scripts/lib/orion-automation-history-summary.mjs` does not exist. Entries have the shape in common.md, but this module must NOT import the ledger module: it takes entries as a plain array.

## Interface

```
export const SUPPRESSION_REASONS // ["quiet_hours","focus_active","focus_unknown","mode_mismatch","expired","daily_limit"]
export function summarizeAutomationHistory(entries, { from, windowDays }) -> Summary
```

`Summary` has exactly these keys:

```
{ windowDays, from, entries, observedDays, firings, suppressed, refused,
  succeeded, failed, unknown, delivered, withheld, byReason, perDay }
```

- `entries`: the number of entries in the window.
- `byReason`: `{ [reason]: count }`, for in-window entries with a non-null reason.
- `perDay`: `{ "YYYY-MM-DD": { firings, suppressed, delivered } }` by UTC date, only for dates that have entries.

## Decisions

1. Throw `new TypeError("invalid summary options")` when any of these holds:
   - `entries` is not an array;
   - `from` is not a safe integer ≥ 0;
   - `windowDays` is not an integer from 1 to 366.
2. An entry is in the window when it is a non-null object with a safe-integer `at` and `from - windowDays*86400000 <= at < from`. Ignore anything else silently.
3. Classify each in-window entry by status:

| status | reason | counts toward |
|---|---|---|
| succeeded | any | firings, succeeded |
| failed | any | firings, failed |
| outcome_unknown | any | firings, unknown |
| refused | in SUPPRESSION_REASONS | suppressed |
| refused | anything else, or null | refused |

4. Count deliveries separately:
   - `delivery === "delivered"` adds to `delivered`;
   - `delivery === "withheld"` adds to `withheld`.
5. The UTC day key is `new Date(at).toISOString().slice(0, 10)`.
6. Build `byReason` and `perDay` with a `Map`, then `Object.fromEntries`. A reason like `__proto__` must stay an ordinary key.
7. `observedDays = Object.keys(perDay).length`.
8. `from` and `windowDays` are echoed back unchanged.

## Tests (`tests/automation-hist-summary.test.mjs`)

Use `from = Date.parse("2026-09-26T00:00:00Z")` and `windowDays = 7`.

1. **"counts firings, suppressions, refusals and deliveries in the window"**
   - Inside the window:
     - succeeded with delivery `"delivered"`;
     - failed;
     - outcome_unknown;
     - refused with `quiet_hours`;
     - refused with `focus_active`;
     - refused with `duplicate_or_old_trigger`;
     - succeeded with delivery `"withheld"`.
   - Expect:
     - firings 4, succeeded 2, failed 1, unknown 1;
     - suppressed 2, refused 1;
     - delivered 1, withheld 1;
     - `byReason.quiet_hours === 1`.
2. **"ignores entries outside the half-open window"**
   - Entries at exactly `from`, at `from - 7*86400000`, and at `from - 7*86400000 - 1`.
   - Only the middle one counts: `entries === 1`.
3. **"counts observed days by UTC date"**
   - Two entries on 2026-09-24, one on 2026-09-25.
   - `observedDays === 2`.
   - `perDay["2026-09-24"].firings === 2`, when both are succeeded.
4. **"rejects invalid options with a TypeError"**
   - Each must throw: entries `"x"`; from `-1`; windowDays `0`; windowDays `367`; windowDays `2.5`.
5. **"does not mutate its input"**
   - Deep-freeze the entries array and its objects, then call the function. It must not throw.
   - `JSON.stringify` of the input is the same before and after.
6. **"empty input gives zero counts and no observed days"**
   - Every count is 0, and `byReason` and `perDay` deep-equal `{}`.

## Exchange plan

1. FILE the module.
2. FILE the tests.
3. Fix from the check output.
4. DONE.

## Traps

- Suppression is a kind of refusal, but it is counted ONLY as `suppressed`, never also as `refused`.
- Don't use `toLocaleDateString`: it depends on the machine's timezone.
- `Number.isInteger(2.5)` is false. The range check must still reject 0 and 367.

## For the reviewer

- The table above is the specification.
- A plain object built with `Object.fromEntries` is expected. Don't flag it as a missing null prototype.
