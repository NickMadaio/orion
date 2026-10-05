# Task atlas-import — `orion-brain-atlas`, write Atlas notes into the vault

## Files
- `scripts/orion-brain-atlas` (new, `#!/usr/bin/env node`).
- `tests/brain-atlas-import.test.mjs` (new).

## Behaviour
```
orion-brain-atlas [--dry-run] [--store <path>] [--vault <path>]
```
- Store default: `~/Library/Containers/com.nickmadaio.atlas.local/Data/Library/Application Support/AtlasLibrary.store`.
  Vault default: `~/Documents/orionBrain` (env `ORION_BRAIN_VAULT` overrides).
- Read it ONLY with `execFileSync("sqlite3", ["-readonly", "-json", store, SQL])` where SQL is:
  `SELECT d.ZID AS id, d.ZTITLE AS title, d.ZCATEGORY AS category, c.ZTITLE AS collection, d.ZBODYMARKDOWN AS body, d.ZPARENTDOCUMENTID AS parentId, d.ZISAGENTONLY AS agentOnly, d.ZUPDATEDAT AS updatedAt FROM ZATLASDOCUMENTRECORD d LEFT JOIN ZATLASCOLLECTIONRECORD c ON c.ZID = d.ZCOLLECTIONID`
  (`agentOnly` arrives as 0/1: convert to boolean). Never open the store any other way:
  opening it with the wrong app destroys data.
- Convert with `atlasToNotes` (task atlas-notes) and write each to `<vault>/<folder>/<title>.md`.
  Skip (and count as "kept") any existing file that does not contain `source: atlas` in its
  frontmatter. Create folders as needed.
- Print `Atlas: <n> notes written, <k> kept (not ours), <s> skipped` and, unless --dry-run,
  run `basic-memory reindex` (path `~/.local/bin/basic-memory`; if missing or failing, print
  `run: basic-memory reindex` and still exit 0). Env `ORION_SKIP_REINDEX=1` skips it (tests).
- A missing store: print a clear message, exit 1.

## Tests (titles exactly) — build a tiny SQLite store in a temp dir with the `sqlite3`
## CLI (create the two tables with the columns used above, insert 3–4 rows)
- "imports lectures and deep dives into the vault folders"
- "an existing note without source: atlas is never overwritten"
- "a second run rewrites its own notes without duplicating them"
- "dry run writes nothing"
- "a missing store exits 1"
