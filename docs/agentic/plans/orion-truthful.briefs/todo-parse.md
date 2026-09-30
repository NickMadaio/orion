# todo-parse — turn a texted to-do list into tasks

## Where you start
Nick texts things like the real 30 September message below. ORION turned every item into a FIXED calendar block at a time Nick never said, and created no reminders. You write `scripts/lib/life/todo-parse.mjs` and `tests/truthful-todo-parse.test.mjs`. Claude wires it into `orion-reschedule` (reminders + movable blocks).

## Interface
```
export function parseTodos(text, { now } = {})
  // -> { tasks: Task[], leftover: string }
  // Task = { title, minutes, optional, due: "YYYY-MM-DD"|null, at: minute|null, fixed }
```
- `text` must be a non-empty string; `now` = `{ date, minute }` required (TypeError otherwise).
- `leftover`: any words that were not part of a task, trimmed ("" if none).

## Decisions (in order)
1. **Strip the request wrapper**: leading "can you / could you / please / add / put / i need to / todo: / to do: / add to my todo list / add to my schedule" and trailing "to my todo list / to my schedule / today / please". Case-insensitive.
2. **Split** on commas, semicolons, newlines, bullet markers (`-`, `*`, `•`, `1.`), and a final " and " / " & " / " then ". Drop empty pieces.
3. **Title**: strip leading joining words (and, then, also, plus, maybe, probably, possibly, try to, I should, gotta). Lower-case first letter unless the word is all-caps or an acronym/proper noun already capitalised mid-sentence in the input (keep "Orion", "CS2100"). Title keeps its words otherwise.
4. **optional**: true if the piece contained "maybe", "if I have time", "if there's time", "possibly", "probably", "try to", "ideally".
5. **minutes**: an explicit duration wins ("30 min", "1h", "an hour", "2 hours", "90m", "half an hour", "for 45"). Otherwise defaults by keyword, first match: apply/application(s)/resume/cv/cover letter → 90; email/reply/text/call/send → 30; study/revise/homework/assignment/problem set/coursework/essay → 60; gym/workout/run → 60; laundry/clean/tidy/groceries/shop → 45; fix/build/code/debug/project → 60; else 45. Clamp 10..240.
6. **at / fixed**: only an explicit clock time in the piece ("at 3", "at 3pm", "at 15:00", "at noon") sets `at` (3 with no am/pm → 15:00 if 1..7, else as said) and `fixed: true`. Otherwise `at: null, fixed: false`. NEVER invent a time.
7. **due**: "today" → now.date; "tomorrow" → next day; weekday names → the next such date strictly after today (today if the piece says "this <weekday>" and it is today); "by friday" same. Otherwise null. Due words are removed from the title.
8. Duplicate titles (case-insensitive) collapse to the first.

## Tests (titles exact)
1. `nicks real message` — now 2026-09-30 10:00; "add fix Orion stuff, finish my resume, send internship applications and maybe study to my todo list" → 4 tasks: "fix Orion stuff" 60 not optional; "finish my resume" 90; "send internship applications" 90 (applications is checked before send); "study" optional true, 60. All `fixed:false`, `at:null`.
2. `explicit time makes it fixed` — "call mum at 6" → at 1080, fixed true, minutes 30.
3. `explicit duration wins` — "gym for 45, study 2 hours" → 45 and 120.
4. `due words` — now Wednesday 2026-09-30: "essay by friday" → due 2026-10-02; "laundry tomorrow" → due 2026-10-01, title "laundry".
5. `bullets and newlines` — "- groceries\n- reply to Sam\n• revise CS1802" → 3 tasks.
6. `no invented times` — every task from test 1 and 5 has at null.
7. `optional words` — "if I have time clean room" → optional true, title "clean room".
8. `duplicates collapse` — "study, Study" → 1 task.
9. `invalid input throws` — parseTodos("") and parseTodos("x") without now throw TypeError.

## Traps
- The failure this fixes was invented fixed times. Test 6 is the one that matters.
- "Orion" must keep its capital.

## For the reviewer
Check test 1 against the Decisions order literally: "applications" (90) is matched before "send" (30).
