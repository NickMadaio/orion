# Style guide for writers of the ORION Learning Guide (docs/learn/)

Audience: Nick (the owner). He'll study ORION by pasting these files into any AI (Claude, ChatGPT, whatever)
and having it walk him through the code. So every file has to stand on its own, be precise enough for an AI
tutor that CAN'T see the repo to explain things right, and be anchored firmly enough that a tutor that CAN
see the repo can open the exact lines.

Snapshot: branch `orion-v2/backlog-checkpoint`, HEAD `6c93032`, date 2026-10-14. The worktree is dirty
(uncommitted work exists, e.g. plugin dist files, docs/evals). Say so when you describe something that
only exists uncommitted.

## Hard rules
1. READ-ONLY on the repo. Write ONLY the file(s) you were assigned under docs/learn/ (plus your fragment).
   Never edit code, never git commit/stash/checkout/reset, never run deploy/install/restart scripts, never
   run anything that calls a paid API or touches live config (~/.openclaw). Reading ~/.openclaw files is OK
   but NEVER copy secrets: API keys, tokens, OAuth secrets, passwords, phone numbers, email addresses
   other than generic placeholders. Refer to secrets by Keychain item / env var NAME only.
2. Ground every claim. Cite code as `path/from/repo/root.ext:LINE` (or `:START-END`). Cite history as
   commit short hashes (`a1b2c3d`) with date. If you inferred something rather than read it, mark it
   **(inferred)**. If docs and code disagree, say so and trust the code.
3. Quote real code in short excerpts (usually ≤ 25 lines) in fenced blocks with the language tag and a
   `// path:line` comment on top. Quote real prompt text when documenting system prompts (it's Nick's own
   text; quote the important parts verbatim, summarise the rest).
4. Explain WHY, not just what: the choice made, alternatives that were rejected, the commit or incident
   that caused it, and what it costs.
5. No marketing tone. Plain, specific, concrete. Use numbers.

## Section template (use for every major component)
### <Component name>
- **What it is** — one paragraph.
- **Where** — files, with line ranges for the key functions.
- **How it works** — a step-by-step code walk, with excerpts.
- **Contracts** — inputs/outputs, data shapes, file paths on disk, env vars, config flags.
- **Calls out to** — APIs, tools, other components (with exact endpoints / CLI argv where they exist).
- **History** — the commits that built it, changed it or broke it (hash, date, one line why).
- **Gotchas & lessons** — things that have bitten the project.
- **Walk it yourself** — 2–5 read-only commands or "open X at line Y and look for Z" steps.
- **Questions to ask your tutor** — 3–6 good study questions.

## File header (top of each file)
```
# <NN> — <Title>
> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: <paths>. Read after: <previous files>. 
```
Then a short "In this file" table of contents.

## Fragment file (REQUIRED, in addition to your main file)
Write `docs/learn/_fragments/<your-id>-index.md` with these tables (empty table = write "none found"),
one row per item, so the editor can merge them into a master reference:

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
### Glossary terms
| Term | Meaning |

Be exhaustive within your scope. Length is fine; correctness matters more than brevity.
Aim for a main file of roughly 1,500–4,000 lines of Markdown, depending on the scope.
