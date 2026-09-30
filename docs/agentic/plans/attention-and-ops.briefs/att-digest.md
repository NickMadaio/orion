# att-digest

## Interface
`export function attentionDigest(feed, { max = 5 } = {}) -> string`
feed = `{ interrupt: row[], today: row[], outages: string[], note: string | null }`, row has `title`.

## Decisions
Lines, joined by "\n":
- If interrupt non-empty: "Now:" then `- ${title}` for the first max, then `…and ${n} more` if more.
- If today non-empty: "Later today:" then the same pattern.
- If outages non-empty: the feed note as the last line.
- If both lists are empty: outages empty -> exactly "Nothing needs you."; otherwise `Nothing to show, but ${note}`.

## Tests (tests/attention-digest.test.mjs)
1. "now and later are listed".
2. "long sections are capped" — 7 rows, max 5 -> "…and 2 more".
3. "an outage is always said".
4. "an empty, fully read day is quiet" — exactly "Nothing needs you.".

## Exchange plan
FILE both in exchange 1; DONE when green.
