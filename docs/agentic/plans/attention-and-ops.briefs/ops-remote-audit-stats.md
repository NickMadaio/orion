# ops-remote-audit-stats

## Where you start
Real rows (do not read the real file): `{"at": ISO, "from": "...", "text": "...", "decision": "accepted"|"refused"|"rejected"|"error", "verb": "brain", "reason": "..."}` — verb and reason may be missing.

## Interface
`export function remoteAuditStats(rows, { from, to }) -> { total, byDecision: { [decision]: n }, byVerb: { verb, count }[], perDay: { [YYYY-MM-DD]: n }, topRefusalReasons: { reason, count }[], skipped }`

## Decisions
- A row counts when Date.parse(at) is in [from, to) and decision is a string; rows with a bad at or decision are skipped (outside the window is excluded, not skipped).
- Missing verb counts as "(none)". Refusal reasons only from decisions refused/rejected/error with a string reason, cut to 120 chars.
- Sorting: count desc, then name asc.

## Tests (tests/ops-remote-audit-stats.test.mjs)
1. "decisions and verbs are counted".
2. "only the top verbs and reasons are kept".
3. "per-day counts use UTC dates".
4. "the window and bad rows are respected".

## Exchange plan
FILE both in exchange 1; DONE when green.
