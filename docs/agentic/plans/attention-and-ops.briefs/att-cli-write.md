# att-cli-write

## Where you start
`scripts/orion-attention` exists with list/show and a --file option (read it first and EDIT it).

## Interface
```
orion-attention add "title" [--due ISO] [--expires ISO] [--urgency n] [--importance n] [--file PATH]
orion-attention ack <id> [--file PATH]
orion-attention snooze <id> --until ISO [--file PATH]
orion-attention prune [--file PATH]
```

## Decisions
- add: item = parseManualAttention(args without --file/--file value, { now: Date.now() }); queue = addToQueue(...); save; print `added ${item.id}`. A parse TypeError -> stderr message, exit 2.
- ack: print `acknowledged ${id}`. snooze: --until parsed with Date.parse; NaN -> exit 2; print `snoozed ${id} until ${iso}`.
- prune: print `pruned ${removed} item(s)`.
- --file is stripped from arguments before parsing.

## Tests (tests/attention-cli-write.test.mjs)
1. "add then list shows the new item".
2. "ack removes an item from the open list".
3. "snooze hides an item until its time".
4. "bad input is refused with a message" — add --urgency 3 exits 2; ack nope exits 1.
5. "prune counts what it removed".

## Exchange plan
EDIT the script (add the commands) and FILE the tests in exchange 1; DONE when green.

## Traps
Do not rewrite the file with ### FILE; EDIT it.
