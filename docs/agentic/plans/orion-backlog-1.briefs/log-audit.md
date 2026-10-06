# Task log-audit — find recurring failures in real ORION conversations

## Files
- `scripts/lib/audit/chat-log.mjs` (new).
- `scripts/orion-log-audit` (new, `#!/usr/bin/env node`, executable).
- `tests/chat-log-audit.test.mjs` (new).

## Input format
ORION session transcripts are `~/.openclaw/agents/main/sessions/*.jsonl` (ignore files ending `.trajectory.jsonl`; also read `~/.openclaw/agents/main/sessions-archive/*.jsonl` when `--archive`). Each line is JSON. Relevant lines: `{"type":"message","timestamp":…,"message":{"role":"user"|"assistant"|"toolResult", "content": string | [{type:"text",text}|{type:"toolCall",name,arguments}] , "isError"?: bool}}`. Other line types (`custom`, `session`, `model_change`, `thinking_level_change`) are ignored except `model_change` (`modelId`) which sets the current model for later turns. Be tolerant: skip lines that fail to parse or lack fields.

## Interface
```
export function readTurns(lines, { file }) -> Array<{ file, index, at, role, text, tools: string[], isError, model }>
export function findIssues(turns) -> Array<{ category, kind, file, at, excerpt, model }>
export function summarize(issues) -> { byCategory: {cat: n}, byKind: {kind: n}, examples: {kind: [up to 5 excerpts]} }
```
## Detection rules (kind → category)
- `cannot-do` → missing-capability: assistant text matching /\b(I can(?:'|no)t|I(?:'m| am) (?:not able|unable)|I don'?t have (?:access|the ability)|isn'?t something I can|not allowed to|is protected|blocked by)\b/i.
- `protected-refusal` → integration-issue: the same text also contains /protected|allowlist|not permitted|sandbox/i (report as this kind instead of cannot-do).
- `tool-error` → tool-issue: toolResult with isError true, or text starting with /error|failed|refused|NOTHING WAS CHANGED/i.
- `repeat-tool` → reasoning-issue: the same tool name called ≥3 times within one user turn.
- `rephrase` → ux-issue: two consecutive user messages (no other user message between) whose word sets overlap ≥ 60% (Jaccard, words ≥ 3 letters) within 10 minutes.
- `user-frustration` → ux-issue: user text matching /\b(again|still (?:not|doesn'?t|isn'?t)|why (?:did|didn'?t|is|isn'?t)|that'?s wrong|no[, ]+i said|i said)\b/i.
- `slow-turn` → latency: assistant reply more than 120 s after the user message it answers.
Excerpts: first 200 chars, newlines collapsed.

## CLI
`orion-log-audit [--dir PATH] [--archive] [--since YYYY-MM-DD] [--json] [--out FILE]` — default dir `~/.openclaw/agents/main/sessions`. Prints a Markdown report: totals by category, then each kind with counts and up to 5 examples (file basename + timestamp). `--json` prints the summary + issues as JSON. `--out` writes the report to a file instead of stdout. Read-only: never writes anywhere except `--out`.

## Tests (titles exactly) — fixtures written to a temp dir
- "reads message lines and ignores other types and bad lines"
- "flags cannot-do and protected refusals separately"
- "flags tool errors and repeated tool calls in one turn"
- "flags rephrased requests and frustration"
- "flags slow replies"
- "the CLI prints a markdown report and honours --since"
