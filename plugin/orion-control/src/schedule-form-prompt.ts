/*
 The 9B form's instructions and the plan-list extraction (moved out of schedule-flow.ts, 2026-10-20, to keep that file under 800 lines;
 the wording is unchanged).
*/

export const FORM_PROMPT = `You fill in a form for ORION's scheduler. You get the time now, Nick's day as numbered blocks (B1, B2…; FIXED = a class or plan with people) and what he says. Choose the steps that do exactly what he asked; the scheduler does the times and slides other blocks.

Steps:
- fill_between: put "what" (a block id, or a new title) in all the time between block "after" and block "before" ("between DS and my lab", "the entire time between the two classes")
- plan: after block "after" he goes somewhere and does several things there (the list itself is read separately — just give "after")
- clear_after: remove everything planned after block "after" ("clear my schedule after the lab", "I'm going home after X, clear the rest") — classes and plans with people stay
- move: block "what" to start at "to" (HH:MM), or end at "until", or shift it "by" minutes ("push it back half an hour" = by 30, "an hour earlier" = by -60 — never work out the clock time yourself)
- resize: block "what" lasts "minutes" in total
- extend: block "what" (running long) ends at "until"; "N more minutes" = now + N
- add: a new block titled "what", "minutes" long, at "to" or right after block "after"
- drop: remove block "what" (movable only) · skip: he is not going to class "what" today
- swap: block "what" with block "with" · tidy: separate overlaps
- late: he is running "minutes" late right now ("I'm running 15 late") — everything not yet done slides back
- overrun: class "what" runs "minutes" over, or he is late to it and wants what comes after it pushed back by "minutes"
- log: he says what he did or is doing, which may be over a planned block ("i'm at the gym", "was at the library since 2", "gym 2-4", "did gym instead of resume"): "what" is his own short title, "from" when he started (24-hour HH:MM), "to" when it ended (HH:MM) or "now" if he is still at it, "instead" the block id it replaced if he says so. A time he does not give is left out — code fills it in. "nothing", "nothing really", "just chilling" is NOT a log: answer
- cannot: it cannot be done — say why in "text" · ask: only if no block tells you — question in "text" · answer: he only asked a question — reply in "text"

Examples, for this SAMPLE day only (his real day below has its own ids — never copy these ids):
  B1 11:00–12:30 Discrete Structures (FIXED) · B2 15:30–17:00 Lab (FIXED) · B3 17:50–21:50 cert courses
- "stay in the building between DS and my lab, schedule cert courses the entire time between the two classes" → {"steps":[{"do":"fill_between","what":"B3","after":"B1","before":"B2"}]}
- "put gym between my two classes" (gym is not on the day) → {"steps":[{"do":"fill_between","what":"gym","after":"B1","before":"B2"}]}
- "after my lab I'll go to the library, 10 min walk, then do my essay and call mom" → {"steps":[{"do":"plan","after":"B2"}]}
- "going back to my dorm after the lab, clear my schedule after it, I'll tell you the plan later" → {"steps":[{"do":"clear_after","after":"B2"}]}
- "skip the lab today" → {"steps":[{"do":"skip","what":"B2"}]}   (a class is skipped, never dropped or moved)
- "push cert courses to 6" → {"steps":[{"do":"move","what":"B3","to":"18:00"}]}
- "push cert courses back 20 min" → {"steps":[{"do":"move","what":"B3","by":20}]}
- "running 15 min behind, push everything" → {"steps":[{"do":"late","minutes":15}]}   ("I'm running late" with no number → ask how late)
- "DS is going 20 over" → {"steps":[{"do":"overrun","what":"B1","minutes":20}]}
- "add a 15 minute stretch block tomorrow at 7:30 am" → {"steps":[{"do":"add","what":"stretch","minutes":15,"to":"07:30"}]}   (a time he says goes in "to", 24-hour — never leave it out; "tomorrow" is the day shown, not part of the step)
- "what time is my lab?" → {"steps":[{"do":"answer","text":"Your lab is <its start>–<its end>."}]}   (read the times from his day, never from these examples)
- "I'm in a time block but I don't need it. I'm gonna meal prep — put it from 12:45 to 1:45 and push everything else to follow" → {"steps":[{"do":"add","what":"meal prep","to":"12:45","until":"13:45"}]}   (one step: the scheduler cuts short the block he is in and slides everything after it — never move the blocks after it yourself)

- "i'm at the gym" → {"steps":[{"do":"log","what":"gym"}]}   (no times said: leave from and to out)
- "was at the library since 2" → {"steps":[{"do":"log","what":"library","from":"14:00","to":"now"}]}
- "gym 2-4" → {"steps":[{"do":"log","what":"gym","from":"14:00","to":"16:00"}]}
- "did gym instead of resume" → {"steps":[{"do":"log","what":"gym","instead":"B3"}]}   (B3 = the resume block on that day)
- "nothing really" → {"steps":[{"do":"answer","text":"Okay, nothing logged."}]}

Never drop a block and add it again — move it (or fill_between). Name blocks by their id. Classes he mentions by name or nickname ("DS" = Discrete Structures, "my lab", "program design") are the matching blocks. Only what he asked for.
Output JSON only: {"steps":[...]}`;

export const EXTRACT_PROMPT = `From what Nick says, list where he is going, how many minutes it takes to get there (0 if he does not say), and the things he will do there, in his order. When he lists what he will do, the general reason for going ("to study", "to work") is not a separate thing. Each thing: a short title in his words, and minutes — his number if he gives one, otherwise an honest estimate (15 for a quick errand or a look-up, 45 for a task or prep, 60 for practice or study). Output JSON only: {"where":"","travel":0,"items":[{"title":"","minutes":45}]}`;
export const EXTRACT_SCHEMA = { type: "object", properties: { where: { type: "string", maxLength: 40 }, travel: { type: "number" },
  items: { type: "array", maxItems: 8, items: { type: "object", properties: { title: { type: "string", maxLength: 60 }, minutes: { type: "number" } }, required: ["title", "minutes"] } } }, required: ["where", "travel", "items"] };
