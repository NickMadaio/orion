# att-src-waiting

## Where you start
`plugin/orion-control/src/waiting.ts` (read it): the store is `{ version: 1, items: WaitingItem[] }`; a WaitingItem has id, what, who, expect, since, dueBy (YYYY-MM-DD), status ("open" | "resolved" | "dismissed"), optional snoozedUntil (ISO instant), surfaced (number). The real file is ~/.openclaw/orion-controlled/waiting.json; do NOT read it — tests use fixtures.

## Interface
`export function fromWaitingStore(store, { now, maxSurfaced = 3 }) -> item[]`

## Decisions
- store not an object with version 1 and an items array -> TypeError("invalid waiting store").
- today = new Date(now).toISOString().slice(0, 10). Skip entries that are not objects, status !== "open", Date.parse(snoozedUntil) > now, or dueBy not /^\d{4}-\d{2}-\d{2}$/.
- dueBy < today -> kind "overdue", title `Still waiting on ${who}: ${what}`, urgency 0.85. dueBy === today -> kind "due_today", title `Due today from ${who}: ${what}`, urgency 0.6. Later -> no item.
- id = dedupKey = `waiting:${entry.id}`; source "waiting"; detail `Ends when: ${expect}`; observedAt now; dueAt Date.parse(`${dueBy}T23:59:59Z`); expiresAt null; titles cut to 200 chars.
- signals: urgency above, actionability 0.8, confidence 0.8, novelty null, importance null, interruptibility (surfaced >= maxSurfaced ? 0.1 : 0.5).

## Tests (tests/attention-src-waiting.test.mjs)
1. "an overdue entry becomes an overdue item".
2. "due today is a gentler item".
3. "resolved, dismissed, snoozed and future entries are skipped".
4. "a much-surfaced entry stops interrupting" — surfaced 3 -> interruptibility 0.1.
5. "an invalid store is refused" — {items: []} and null -> TypeError.

## Exchange plan
FILE both in exchange 1; DONE when green.
