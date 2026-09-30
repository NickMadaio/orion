# att-cli-read

## Interface
`orion-attention list [--json] [--file PATH]`, `orion-attention show <id> [--file PATH]`
Default file: `join(homedir(), ".openclaw/orion-controlled/attention.json")`.

## Decisions
- list: load the queue; take `openItems(queue, Date.now())`; score each; sort by score desc (null last) then id. Text: one line per item `  ${score === null ? " —  " : score.toFixed(2)}  ${title}  (${source})`; none -> "No attention items.". --json: print `JSON.stringify(rows, null, 2)` where rows are `{ id, title, source, score, state }`.
- show: print the entry as JSON; unknown id -> stderr `no attention item ${id}`, exit 1.
- Unknown command -> stderr usage line, exit 2. Unreadable queue -> stderr message, exit 1.
- The file is executable (the worker writes it; the host commits it; include the shebang).

## Tests (tests/attention-cli-read.test.mjs)
Write the queue fixture with `saveAttentionQueue`.
1. "list prints open items by score".
2. "list --json is machine-readable".
3. "a missing queue is simply empty".
4. "show prints one entry and refuses unknown ids".
5. "an unknown command is refused".
Run with `spawnSync(process.execPath, [SCRIPT, ...])`.

## Exchange plan
FILE the script and tests in exchange 1; DONE when green.
