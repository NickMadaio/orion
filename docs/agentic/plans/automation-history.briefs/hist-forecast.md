# hist-forecast

## Where you start

- `plugin/orion-control/dist/automation.js` `simulate(proposal, { windowDays = 30, from = new Date() })` returns `{ fireCount, suppressedCount, messageCount, windowDays, cappedByRiskLimit, notes }`.
  - Its first note starts `This is a CEILING, not a forecast`.
  - When `proposal.conditions.skipDuringFocus` is set, it adds EXACTLY this note: `Firings during a focus session are not modelled — there is no history of past sessions to replay against.` (with an em dash).
- `scripts/orion-automation` (182 lines, ESM, top-level await allowed):
  - `ROOT = join(HOME, ".openclaw/orion-controlled/automations")`;
  - `const [command = "list", name, ...options] = process.argv.slice(2);`;
  - its `simulate` block (around line 125) prints `forecast.windowDays`, `fireCount`, `suppressedCount`, `messageCount`, then each note.
- hist-ledger gives `readAutomationHistory(file, { since, until })`, returning `{ entries, skipped }`.
- hist-summary gives `summarizeAutomationHistory(entries, { from, windowDays })`, returning `{ windowDays, from, entries, observedDays, firings, suppressed, refused, succeeded, failed, unknown, delivered, withheld, byReason, perDay }`.

## Interface

```
export const NO_HISTORY_NOTE =
  "No history has been recorded for this automation yet, so the numbers above are the ceiling only."
export const FOCUS_NOT_MODELLED =
  "Firings during a focus session are not modelled — there is no history of past sessions to replay against."
export function withHistory(forecast, summary) -> forecast'
```

## Decisions

**withHistory**

1. If `summary` is null or undefined, or `summary.observedDays === 0`, return `{ ...forecast, notes: [...forecast.notes, NO_HISTORY_NOTE] }`.
2. Otherwise, return `{ ...forecast, observed, notes }`, where:
   - `observed = { windowDays: summary.windowDays, observedDays: summary.observedDays, firings: summary.firings, suppressed: summary.suppressed, delivered: summary.delivered }`;
   - `notes` is `forecast.notes` with every note equal to FOCUS_NOT_MODELLED replaced by `` `Focus sessions suppressed ${n} firing(s) in the observed days.` ``, where `n = (summary.byReason.focus_active ?? 0) + (summary.byReason.focus_unknown ?? 0)`;
   - then append `` `Observed on ${observedDays} of the last ${windowDays} day(s): fired ${firings}, suppressed ${suppressed}, delivered ${delivered}.` ``.
3. `fireCount`, `suppressedCount` and `messageCount` are never changed. The ceiling stays the ceiling.
4. Never mutate `forecast`, `forecast.notes` or `summary`.

**CLI (`scripts/orion-automation simulate`)**

1. Add imports for `readAutomationHistory`, `summarizeAutomationHistory` and `withHistory`, from `./lib/...`.
2. After `const forecast = simulate(proposal);`:
   - `const now = Date.now()`;
   - read `join(ROOT, "history", \`${name}.jsonl\`)` with `{ since: now - forecast.windowDays * 86400000, until: now }` inside `try/catch`, treating an error as `null`;
   - summarize with `{ from: now, windowDays: forecast.windowDays }` when it was read;
   - then `const shown = withHistory(forecast, summary)`.
3. Print exactly what it printed before, but from `shown`.
4. When `shown.observed` exists, print after the "At most" line: `` `  Observed: fired ${o.firings}, suppressed ${o.suppressed}, delivered ${o.delivered} on ${o.observedDays} day(s) with history.` ``.
5. Then print the notes from `shown.notes`.

## Tests (`tests/automation-hist-forecast.test.mjs`)

These test the module only. The CLI loads the installed plugin, so it is not run in tests.

Use a forecast of `{ fireCount: 30, suppressedCount: 0, messageCount: 30, windowDays: 30, cappedByRiskLimit: false, notes: ["This is a CEILING, not a forecast: x", FOCUS_NOT_MODELLED] }`.

1. **"no observed days keeps the ceiling and adds the no-history note"**
   - With a summary where `observedDays: 0`: the numbers are unchanged, there is no `observed` key, and the last note is NO_HISTORY_NOTE.
2. **"observed days add an observed section and note"**
   - Summary: observedDays 5, windowDays 30, firings 4, suppressed 3, delivered 2, byReason `{}`.
   - `observed` deep-equals the five fields, and the last note is `Observed on 5 of the last 30 day(s): fired 4, suppressed 3, delivered 2.`
3. **"the focus note is replaced when history exists"**
   - byReason `{ focus_active: 2, focus_unknown: 1 }`: the notes contain `Focus sessions suppressed 3 firing(s) in the observed days.` and do not contain FOCUS_NOT_MODELLED.
4. **"does not mutate the forecast or the summary"**
   - Deep-freeze both and call the function. It must not throw, and the originals are unchanged.
5. **"a missing summary is treated as no history"**
   - `withHistory(forecast, null)`: the last note is NO_HISTORY_NOTE.

## Exchange plan

1. FILE the module.
2. FILE the tests.
3. EDIT the CLI's imports, then its simulate block.
4. DONE.

## Traps

- The em dash in FOCUS_NOT_MODELLED must match the dist string byte for byte. Copy it from `plugin/orion-control/dist/automation.js`.
- Don't reorder the existing notes. Replace in place, then append.

## For the reviewer

- The CLI edit is untested by design; judge it against CLI Decisions 1–5.
- No other command's output may change.
