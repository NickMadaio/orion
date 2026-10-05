# Task learn-extract — what did ORION learn about Nick today? (pure)

## Why
Every night a local model (Qwen via Ollama) reads the day's conversation lines and proposes
lasting facts about Nick. This module builds the prompt and, more importantly, refuses any
proposal that is not grounded in his own words.

## Interface — `scripts/lib/brain/extract.mjs`
```
export const CATEGORIES = ["like", "dislike", "habit", "goal", "preference", "person", "schedule", "health", "school", "project", "rule"];
export function buildPrompt(lines, noteTitles)      → { system: string, user: string }
export function parseFacts(modelText, lines, noteTitles) → { facts: [{ note, category, fact, quote }], rejected: [{ item, why }] }
```
- `lines`: the day's memory lines (strings). `noteTitles`: existing brain note titles.

## Decisions
1. `buildPrompt`: the system text tells the model to return ONLY JSON
   `{"facts":[{"note":"…","category":"…","fact":"…","quote":"…"}]}` with at most 10 facts;
   only lasting things about Nick (likes, habits, goals, people, how he wants things done),
   never one-off events or ORION's own status; `quote` must be copied exactly from one line;
   `note` should be one of the given titles when one fits (list them, at most 200), else a
   short new title (a person's name, a habit). The user text is the numbered lines.
2. `parseFacts`: accept the JSON even if wrapped in prose or code fences (take the first
   `{` … matching last `}`); invalid JSON → `{ facts: [], rejected: [{ item: null, why: "not json" }] }`.
3. Reject an item (with a reason) when: a field is missing or not a string; category not in
   CATEGORIES; `quote` (case-insensitive, whitespace-collapsed) is not a substring of any line;
   `fact` longer than 300 characters; `note` longer than 60 characters or contains `[`, `]`, `/`.
4. Keep at most 10 accepted facts; trim strings; snap `note` to an existing title when it equals
   one case-insensitively.

## Tests — `tests/brain-learn-extract.test.mjs` (titles exactly)
- "the prompt lists note titles and numbered lines"
- "a grounded fact is accepted and snapped to an existing note"
- "a fact whose quote is not in the day is rejected"
- "JSON wrapped in prose or code fences is still read"
- "garbage output gives no facts"
- "unknown categories and oversized fields are rejected"
- "never more than ten facts"
