# life-cli

## Interface
- `orion-next --day FILE --now HH:MM [--state STATE] [--json]` — FILE holds { "date": "...", "blocks": [...], "done": [...] }.
- `orion-study --day FILE --now HH:MM --window HH:MM-HH:MM [--json] -- "<request text>"` — parses with parseStudyRequest (today = FILE's date), fits with fitStudy, prints { placed, moved, unplaced } (text mode: one line per placed/moved/unplaced item).
- Both: executable Node scripts (#!/usr/bin/env node), import from ./lib/life/. Exit 2 with a usage line on bad arguments; exit 1 with a message on unreadable/invalid files. They read ONLY the file given.

## Tests (tests/life-cli.test.mjs)
1. "orion-next prints the current block" 2. "orion-next json output parses" 3. "orion-study places a session" 4. "bad arguments print usage and exit 2" 5. "a missing file exits 1".

## Exchange plan
FILE the scripts and the test in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
