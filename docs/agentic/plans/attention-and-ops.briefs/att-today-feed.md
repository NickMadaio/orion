# att-today-feed

## Interface
```
export const TODAY_FEED   // join(homedir(), ".openclaw/orion-controlled/attention-today.json") — exported, never used by tests
export function buildTodayFeed(ranked, { now, outages = [] }) -> feed
export async function writeTodayFeed(file, feed) -> void
```
feed = `{ version: 1, generatedAt: ISO string of now, interrupt: ranked.now, today: ranked.later, outages: string[] (source names), note: string | null }`

## Decisions
- note: outages non-empty -> `Could not read: ${sources.join(", ")}. Missing sources are unknown, not quiet.`; else interrupt and today both empty -> "Nothing needs you."; else null.
- writeTodayFeed: mkdir -p (0o700), temp file then rename, mode 0o600, `JSON.stringify(feed, null, 2) + "\n"`.

## Tests (tests/attention-today-feed.test.mjs)
1. "ranked items become the feed".
2. "an outage is named, never 'nothing needs you'".
3. "an empty day with every source read says nothing needs you".
4. "the feed file is written privately".

## Exchange plan
FILE both in exchange 1; DONE when green.
