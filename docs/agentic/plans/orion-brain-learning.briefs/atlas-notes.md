# Task atlas-notes — Atlas documents → brain notes (pure)

## Why
Atlas (Nick's lecture app) holds his real course material: lectures and short "Deep Dive"
notes per topic. Turning them into linked brain notes is the honest way to make the brain big.

## Interface — `scripts/lib/brain/atlas-notes.mjs`
```
export const COURSE_FOR_COLLECTION = { "Marketing": "MKTG2201", "ECON101 Macroeconomics": "ECON1115" };
export function slugify(text)                       → string
export function atlasToNotes(rows, { now })         → [{ folder, title, text }]
```
`rows`: `[{ id, title, category, collection, body, parentId, agentOnly, updatedAt }]` — one
per Atlas document (category is "Lecture", "Deep Dive", "Lecture Source" or other).

## Decisions (in order)
1. Skip rows with `agentOnly` true and rows whose category is "Lecture Source".
2. Folder: `30 Resources/Lectures/<collection>` (collection "Unsorted" when empty).
3. Title: the row title with `/`, `\`, `:` replaced by `-`; a Deep Dive title like
   "Marketing · Value Proposition" keeps its full text.
4. Text: the note format from common.md with `type: lecture` or `type: concept` (Deep Dive),
   `source: atlas`, tags `[atlas, <slug of collection>]`, the body copied as is (trimmed,
   at most 20000 characters), then `## Relations`:
   - `- part_of [[<COURSE_FOR_COLLECTION[collection]>]]` when mapped, else `- part_of [[<collection>]]`;
   - a Deep Dive whose `parentId` is another row's id: `- explains [[<that row's title>]]`;
   - a Lecture: `- has_concept [[<title>]]` for every Deep Dive whose parentId is its id.
5. Collections with no course mapping also get one note `30 Resources/Lectures/<collection>/<collection>`
   (`type: collection`, `source: atlas`) with `- contains [[<title>]]` for each of its notes.
6. Output sorted by folder then title; pure, inputs never mutated.

## Tests — `tests/brain-atlas-notes.test.mjs` (titles exactly)
- "lecture sources and agent-only rows are skipped"
- "a marketing lecture links to MKTG2201 and lists its deep dives"
- "a deep dive explains its parent lecture"
- "an unmapped collection gets its own collection note"
- "titles with slashes and colons are made safe"
- "the input rows are not mutated"
