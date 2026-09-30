# claims — does a reply claim an action, or an inability?

## Where you start
ORION's gateway wrapper re-asks the model once when a reply claims something was done but no tool ran, or claims it cannot do something without looking. Its current single regexes misfire both ways (examples below). You write `scripts/lib/remote/claims.mjs` and `tests/tighten-claims.test.mjs`; Claude swaps the wrapper over after review.

## Interface
```
export function classifyClaim(reply, { toolsRun = 0 } = {})
  // -> { kind: "done" | "cant" | "none", phrase: string | null, needsCheck: boolean }
```
- `reply` must be a string (else TypeError); `toolsRun` a non-negative integer (else TypeError).
- `phrase`: the matched words (≤ 60 chars) or null.
- `needsCheck`: true when the wrapper should re-ask: `kind === "done" && toolsRun === 0`, or `kind === "cant" && toolsRun === 0`.

## Decisions (first match wins, in this order)
1. **Data absence is "none"**, even though it reads like "can't": "I don't have a location for that event", "there's no location on that calendar event", "no events tomorrow", "nothing on the calendar", "I don't see anything due", "not enough data yet".
   Rule: a negation followed within 4 words by a data noun (`location, events?, data, anything, deadline, forecast for, record, entry, reminders? due`) and NOT followed by a capability noun (below) is data absence.
2. **cant** — claims of inability: "I can't / cannot / am unable to / am not able to / don't have a way to / have no way to / don't have access to / don't have the ability to", or "I don't have a (direct|dedicated|built-in)? (\w+ )?(tool|capability|integration|way)", or "(that's|it's) (outside|beyond) what I can do", or "can't (list|see|read|check|open|send|set) … (through|from) the phone".
3. **done** — claims completion: "done.", "all set", "I've (set|added|scheduled|created|opened|sent|logged|moved|booked|blocked|put|removed|cleared|ticked)", "(it's|that's) (set|scheduled|added|booked|in)", "booked", "set for", "reminder set", "alarm set", "added (it|that) to", "Reverted", "Removed".
4. Otherwise "none".
- Questions back to Nick ("Want me to…?", "Should I…?") do not count as done even if they contain "add".

## Tests (titles exact) — every reply below is real, from 29 September
1. `data absence is not an inability` — "Confirmed: there's no location on that calendar event" → none; "Not enough data yet—you haven't logged bedtimes." → none; "Day's wide open — nothing on the calendar." → none.
2. `a missing tool claim is cant` — "I don't have a direct weather tool available right now." → cant; needsCheck true with toolsRun 0.
3. `phone-only excuse is cant` — "Can't list them through the phone, but the desktop view is there." → cant.
4. `purchases refusal is cant but looked` — "I don't have the ability to make purchases." with toolsRun 2 → cant, needsCheck false.
5. `completion claims are done` — "Booked two one-hour macro study sessions: Wednesday at 12:40 PM" → done; "Done. Reminder set for 10 AM tomorrow" → done; "Reverted. The macro study sessions are off the calendar." → done.
6. `done with no tools needs a check` — "Alarm set for 8:15 AM tomorrow." toolsRun 0 → needsCheck true; toolsRun 1 → false.
7. `offers are not claims` — "Want me to add it to your to-do list?" → none.
8. `plain answers are none` — "Macro Quiz 1 is Friday, October 16." → none.
9. `invalid input throws` — classifyClaim(null) and classifyClaim("x", { toolsRun: -1 }) throw TypeError.

## Exchange plan
FILE module + tests; EDIT the rules in order; DONE.

## Traps
- The old regex treated every "I don't have" as inability; that made ORION narrate its tool search to Nick. Data absence must win.
- The old narrowing then missed "I don't have a direct weather tool". Both tests 1 and 2 must pass together.

## For the reviewer
Check each test's replies verbatim. Order of rules matters; do not reorder.
