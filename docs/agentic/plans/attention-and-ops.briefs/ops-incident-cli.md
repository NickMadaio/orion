# ops-incident-cli

## Interface
`orion-incident-timeline [--dir PATH] [--since ISO] [--severity low|medium|high] [--json]`
Files read from dir: permission-audit.jsonl, remote-audit.jsonl, repair-audit.jsonl, location-audit.jsonl.

## Decisions
- Parse each file line by line (skip blank; bad JSON counted in skipped). Missing file -> [].
- --since default: 7 days before now. --severity keeps that level and above (low < medium < high).
- Text: one line per event `${iso}  ${severity.padEnd(6)} ${source.padEnd(10)} ${summary}`; none -> "Nothing recorded in that window."; skipped > 0 -> final line `(${skipped} unreadable line(s) skipped)`.
- Bad --since or --severity -> exit 2.

## Tests (tests/ops-incident-cli.test.mjs)
1. "the logs in a directory print as one timeline".
2. "--severity high keeps only high events".
3. "missing files and bad lines do not fail".
4. "bad flags are refused".

## Exchange plan
FILE both in exchange 1; DONE when green.
