# Task graph-doctor — keep the graph healthy (`orion-brain-doctor`)

## Files
- `scripts/lib/brain/graph.mjs` (new, pure): `export function graphReport(notes)` where
  `notes` is `[{ path, title, text }]` → `{ notes, links, orphans: [title], broken: [{ from, to }], noRelations: [title], topLinked: [{ title, count }] }`.
- `scripts/orion-brain-doctor` (new CLI): reads every `*.md` under the vault (env
  `ORION_BRAIN_VAULT`, default `~/Documents/orionBrain`; skip `.obsidian/`), prints the report
  in plain lines; `--json` prints the object. Read-only: never writes.
- `tests/brain-graph-doctor.test.mjs` (new).

## Decisions
1. Title = frontmatter `title:` if present, else the file name without `.md`.
2. Links = every `[[Target]]` or `[[Target|alias]]` (target before `|`), anywhere in the text.
3. `broken`: a link whose target matches no title (case-insensitive).
4. `orphans`: notes that link to nothing AND nothing links to them.
5. `noRelations`: notes with no `## Relations` section or an empty one.
6. `topLinked`: the 10 notes most linked to, count descending, then title.

## Tests (titles exactly)
- "links and alias links are counted"
- "a link to a missing note is broken"
- "a note nobody links and that links nowhere is an orphan"
- "frontmatter title wins over the file name"
- "the CLI prints the report for a temp vault and writes nothing"
