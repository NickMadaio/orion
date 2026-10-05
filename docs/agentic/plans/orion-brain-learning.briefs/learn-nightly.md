# Task learn-nightly — `orion-brain-learn`, the nightly learner

## Files
- `scripts/orion-brain-learn` (new, `#!/usr/bin/env node`).
- `tests/brain-learn-nightly.test.mjs` (new).

## Behaviour
```
orion-brain-learn [--date YYYY-MM-DD] [--dry-run] [--model <ollama model>]
```
1. Date default: yesterday (local). Memory file `~/.openclaw/workspace/memory/<date>.md`
   (env `ORION_MEMORY_DIR` overrides the directory). No file or no `- ` lines → print
   `Nothing to learn from <date>.` exit 0.
2. Already learned: state file `~/.openclaw/orion-controlled/brain-learned.json`
   (env `ORION_BRAIN_STATE`) `{ "dates": ["…"] }`; a date in it → print `Already learned <date>.`
   exit 0 (unless `--force`).
3. Note titles: every `*.md` file name (without `.md`) under the vault (env `ORION_BRAIN_VAULT`,
   default `~/Documents/orionBrain`), recursively.
4. Ask the model: POST `${ORION_OLLAMA_URL ?? "http://127.0.0.1:11434"}/api/chat` with
   `{ model: --model ?? "qwen3.5:9b", stream: false, format: "json", messages: [system, user] }`
   from `buildPrompt`; timeout 300 s; read `message.content`. Use `fetch`.
   Unreachable → print `Ollama is not running; nothing learned.` exit 1.
5. `parseFacts` → `planLearning` (notes read from disk by title → file text).
6. For each fact to add: unless --dry-run, run `${ORION_BRAIN_BIN ?? "<repo>/scripts/orion-brain"} learn
   "<note>" "<category>" "<fact> — he said: \"<quote>\""` with `execFileSync`; count failures.
7. Print one line per fact (`learned` / `would learn` / `skipped (why)`), rejected count, then
   record the date in the state file (not on --dry-run, not if every learn failed).

## Tests (titles exactly) — start a fake Ollama with `node:http` on port 0 returning canned
## `{ message: { content } }`; fake orion-brain = a small script in the temp dir that appends
## its argv to a file
- "learns grounded facts from the day and records the date"
- "an already learned date is not learned again"
- "dry run calls nothing and records nothing"
- "ungrounded model output learns nothing"
- "Ollama down exits 1 without recording the date"
- "a day with no memory file learns nothing"
