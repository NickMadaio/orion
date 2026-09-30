# life-doc

## What to write
Sections, exactly these headings: "Files", "Verify", "Proven", "Needs wiring".
- Files: every new file under scripts/lib/life/, the two CLIs, one line each saying what it does.
- Verify: one `node --test tests/<file>` line per new test file.
- Proven: only what the tests prove; no claims about live use.
- Needs wiring: phone signals (location, motion, screen activity, charging) feeding sleep-state; notifications and escalation delivery; the class timetable as a weekly template; ORION's brain calling orion-next/orion-study; the phone's offline event log using sync-event/merge/apply; reconciliation into Markdown on the Mac.

## Exchange plan
SEARCH scripts/lib/life/ first, then FILE the document; DONE when the check passes.

## For the reviewer
Check every Decisions rule has a test.
