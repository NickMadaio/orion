# ops-incident-timeline

## Where you start
Real rows (do not read the real files in tests):
- permission-audit.jsonl: `{"changedAt": ISO, "previous": {...}, "next": {...}, "context": "...", ...}` (previous/next may carry `profile`)
- remote-audit.jsonl: `{"at": ISO, "from": "...", "text": "...", "decision": "accepted"|"refused"|"rejected"|"error", "verb": "...", "reason"?: "..."}`
- repair-audit.jsonl: `{"at": ISO, "kind": "...", "surface": "...", "target": "...", "outcome": "..."}`
- location-audit.jsonl: `{"at": ISO, "action": "...", ...}`

## Interface
`export function buildIncidentTimeline({ permission = [], remote = [], repair = [], location = [] }, { since = 0 } = {}) -> { events: { at: ms, iso, source, summary, severity }[], skipped: number }`

## Decisions
| source | time field | summary | severity |
|---|---|---|---|
| permission | changedAt | `permission ${previous?.profile ?? "unknown"} -> ${next?.profile ?? "unknown"}` | high |
| remote | at | `${decision} ${verb ?? "?"}: ${String(text ?? "").slice(0, 80)}` | medium if decision is refused/rejected/error, else low |
| repair | at | `${kind} ${surface} ${target} -> ${outcome}` | high |
| location | at | `location ${action}` | low |
Events before `since` are left out (not skipped). Ties by source name then summary. iso = new Date(at).toISOString().

## Tests (tests/ops-incident-timeline.test.mjs)
1. "all four logs merge in time order".
2. "each source is summarized with its severity".
3. "since filters and bad times are counted".

## Exchange plan
FILE both in exchange 1; DONE when green.
