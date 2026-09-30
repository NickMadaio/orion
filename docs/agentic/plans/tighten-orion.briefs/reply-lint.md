# reply-lint — find and fix reply-quality problems

## Where you start
Nothing under `scripts/lib/remote/` exists. You write `scripts/lib/remote/reply-lint.mjs` and `tests/tighten-reply-lint.test.mjs`. Real replies from 29 September that this must catch are quoted in Tests.

## Interface
```
export const RULES = ["meta_talk", "time_24h", "time_both", "markdown_spoken", "too_long_spoken", "repeated_sentence"];
export function lintReply(text, { spoken = false } = {})
  // -> [{ rule, excerpt }]  in RULES order, at most one finding per rule; [] when clean
export function fixReply(text, { spoken = false } = {})
  // -> { text, changed: [rule, ...] }  deterministic rewrite of what can be fixed safely
export function clock12(hour, minute)   // (20, 11) -> "8:11 PM"; (0, 5) -> "12:05 AM"; (12, 0) -> "12:00 PM"
```
`text` must be a string (else TypeError). `excerpt` is the matched text, at most 60 characters.

## Decisions
- **meta_talk**: the reply talks about ORION's machinery instead of answering. Case-insensitive word matches for: `script`, `the tool`, `a tool`, `no tool`, `tool_call`, `tool_search`, `catalog`, `exec`, `TOOLS.md`, `AGENTS.md`, `this check`, `my previous answer`, `you were right, i did have`, `allowlist`. Not flagged: "tools" inside ordinary phrases like "power tools" is rare enough to ignore — just match the list above.
- **time_24h**: a clock time `H:MM` or `HH:MM` whose hour is 13–23 or 00, and which is not followed by AM/PM. (`9:05` alone is NOT flagged: it is a valid 12-hour time.)
- **time_both**: the same reply contains a 24-hour time (as above) AND a 12-hour time with AM/PM.
- **markdown_spoken** (spoken only): `**`, a line starting with `#`, `- `, `* ` or `1. `.
- **too_long_spoken** (spoken only): more than 320 characters.
- **repeated_sentence**: two sentences with identical normalized text (lowercase, letters/digits/spaces only).
- `fixReply`:
  - time_24h and time_both: rewrite every 24-hour time with `clock12`; if a 12-hour version of the same time follows in brackets or after an em dash, drop the duplicate so only one remains: "It's 20:32 GMT+1 (8:32 PM)." → "It's 8:32 PM." (also remove a timezone token `GMT+1`/`BST`/`UTC` directly after the rewritten time).
  - markdown_spoken: remove `**`, leading `#`, and list markers; join list lines with ", " inside the sentence they follow.
  - repeated_sentence: keep the first occurrence.
  - meta_talk and too_long_spoken are NOT fixable here (they need the model); they are never in `changed`.

## Tests (titles exact)
1. `flags tool narration from the 29 September runs` — "The script *does* print location when the event has one" → meta_talk; "No relevant tool — nothing in the catalog reads Keychain" → meta_talk; "You were right, I did have the tool — messages_send resolves Mom" → meta_talk.
2. `a plain answer is clean` — "Your next class is tomorrow at 9 AM: CS1802 in Portsoken 802." → [].
3. `24-hour times are flagged and 12-hour ones are not` — "I'll reach you at 20:46" → time_24h; "Class at 9:05 tomorrow" → []; "Bed by 11:45 PM" → [].
4. `mixed formats are flagged once each` — "Just past 8 PM—20:11." → time_24h and time_both.
5. `fixReply collapses mixed times` — "It's 20:32 GMT+1 (8:32 PM)." → text "It's 8:32 PM."; changed includes time_24h.
6. `fixReply rewrites a lone 24-hour time` — "I'll check back at 20:56." → "I'll check back at 8:56 PM."
7. `spoken replies flag markdown and length` — "**This week:**\n- Wed: seminar" with spoken:true → markdown_spoken; a 400-char string → too_long_spoken; same texts with spoken:false → neither.
8. `fixReply strips markdown when spoken` — "**This week:** three classes" spoken → "This week: three classes".
9. `repeated sentences are flagged and fixed` — "No umbrella needed. It is clear. No umbrella needed." → repeated_sentence; fixReply → "No umbrella needed. It is clear."
10. `clock12 covers midnight and noon` — (0,5)→"12:05 AM", (12,0)→"12:00 PM", (23,59)→"11:59 PM".
11. `invalid input throws` — lintReply(42) throws TypeError.

## Exchange plan
FILE the module with RULES, clock12 and stub functions + FILE the tests; EDIT lintReply rule by rule; EDIT fixReply; DONE.

## Traps
- Do not flag `9:05` or `11:45` without AM/PM: hours 1–12 are ambiguous, not wrong.
- A time inside a longer number ("10:30:15") — treat `HH:MM:SS` as one token and leave it alone.
- Keep sentence splitting simple: split on `. `, `! `, `? ` and end of text.

## For the reviewer
Judge against the Decisions list. Do not ask for more meta_talk phrases than listed; the list is deliberately narrow to avoid flagging normal speech.
