# att-cli-collect

## Interface
```
orion-attention-collect --queue FILE --feed FILE [--calendar-json FILE] [--waiting-json FILE] [--focus-history FILE]
                        [--now ISO] [--hour N] [--quiet S-E] [--dry-run]
```
Live readers (calling orion-agenda etc.) are deliberately NOT part of this task: the host wires them after review.

## Decisions
- now = Date.parse(--now) or Date.now(); hourOfDay = --hour or new Date(now).getUTCHours(); quiet "22-7" -> [22, 7].
- readers: each given flag becomes a reader that reads the file and JSON.parses it (focus history: split lines, parse each, skip bad lines).
- { items, outages } = await collectAttention(...); queue = addToQueue(loaded, items, now); ranked = rankAttention(openItems(queue, now), { now, hourOfDay, quietHours, focusActive: null }).
- feed = buildTodayFeed(ranked, { now, outages }); print attentionDigest(feed).
- Unless --dry-run: saveAttentionQueue and writeTodayFeed.
- Missing --queue or --feed -> exit 2 with usage.

## Tests (tests/attention-cli-collect.test.mjs)
1. "a pass writes the queue and the feed and prints the digest".
2. "dry run writes nothing".
3. "a missing input file is an outage in the digest".
4. "missing required flags are refused".

## Exchange plan
FILE the script and tests in exchange 1; EDIT from checks; DONE.
