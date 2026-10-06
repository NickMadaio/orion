# Scheduling memory

Read this file whenever Nick asks to plan, schedule or rearrange a day, or says he is leaving/finishing early. These are durable preferences, not proof that calendar actions have happened. Verify the current calendar, Orion to-do list and deadlines through tools before planning. Use current location/time-zone data and say times in 12-hour form.

## To-dos with due dates (orion-tasks, 2026-10-06)

A to-do on his Orion list can carry a due date, a spread in its notes ("2 hours a
day until it's due", "two 2-hour blocks, Tuesday and Thursday", "four 1-hour blocks
this week", "about 5 hours total") and a priority (high/medium/low). ORION books
the sessions from those — high priority or due within a day is a must; low is
optional — and re-plans every morning. `orion-tasks` (allowlisted) does all of it:
- "Add X, due Friday, 2 hours a day, high priority" → `orion-tasks add "X" --due friday --spread "2 hours a day" --priority high`.
- "Instead of two 2-hour blocks do four 1-hour blocks" → `orion-tasks set "X" --spread "four 1-hour blocks"`
  (changes the to-do's notes AND re-plans its sessions).
- "Push X's due date to Monday" → `orion-tasks set "X" --due monday`; "X matters more" → `--priority high`.
- "What's on my list / when am I doing X" → `orion-tasks list`. Re-plan everything → `orion-tasks plan`.
- Groups: one to-do can hold parts (subtasks) — "complete cert courses" with its three courses.
  ONLY the parent is scheduled (e.g. 2.5 hours a day); the parts record progress.
  "Add AWS to the cert courses" → `orion-tasks sub "cert courses" add "AWS Cloud Practitioner"`;
  "I'm 40% through AWS" → `orion-tasks sub "cert courses" set "AWS" 40`; remove → `… remove "AWS"`.
  Never schedule the parts separately; use their progress to suggest which part to work on.
Moving or resizing ONE session today is still `orion-reschedule move|resize`. Never book a
spread to-do with `day --plan` by hand; `day --todos` already leaves those to orion-tasks.

## Planning from the actual day

“Schedule my day” includes outstanding tasks on the Orion Reminders list even when Nick also names food or going out. Read `orion-agenda tasks` and the calendar first; use `orion-reschedule day --todos` for task-based planning. The combined syntax is supported: `orion-reschedule day --todos --plan "grab food, 30" --plan "club, 240, 22:00, fixed"`. For a whole-day request ALWAYS include `--todos` on the day command; reading the list then booking only named plans still omits his tasks. Do not invent a 5 PM time for food when he did not give one. Never silently omit the list. List tasks that cannot fit and explain why. Do not include Groceries/Family unless requested.

## The class wrapper (Nick, 2026-10-05)

His class day is wrapped in travel. 45 minutes before his FIRST class of the day
and 45 minutes after his LAST class are travel, not free time. If two classes are
2.5 hours or more apart, he goes home and back: 45 minutes after the earlier class
and 45 minutes before the later one are travel too. Less than 2.5 hours apart, he
stays on campus between them. Nothing (a nap, work, food at home) goes into travel
time. The live facts list today's travel lines; the planner enforces them from
life-config (`commuteMinutes`, `homeGapMinutes`). Never plan from this paragraph
alone: if the travel line and the calendar disagree, trust the tools.
(Why this is written down: on 2026-10-05 the short-night nap was booked at 12:30,
the minute a lecture ended, because the code only knew about the first and last
class and this file said "stay on campus" between classes.)

## Shrinking, and finishing early (2026-10-06)

When Nick says to shrink, cut, lengthen or move something, just do it
(`resize`, `move`, `extend`) — even a block he set the time of. ORION never shrinks
his blocks on its own except breaks, side projects and optional items when the day
overflows. "I'm done with X early" / the "I'm out early" button → `orion-reschedule
early`: X ends now, a 15-minute break goes in if he worked an hour or more, the freed
time goes to whatever later is short of time (below its minimum, or the side project
under its hour), and the rest of the day moves up. Tell him what it did.

## Removing things

Remove exactly what he names: "delete finish resume and send internship applications" →
`orion-reschedule drop "finish resume" "send internship applications"` (one call).
"Delete everything after the resume" → `drop --after "finish resume"`.
Only "clear/wipe everything" means `clear`.

## To-dos that wait for another

A to-do whose notes say to wait for another ("only schedule this once … \"do cert
courses\" is complete", "don't schedule unless \"finish resume\" is completed") is not
scheduled until that one is ticked off; orion-tasks and day --todos both enforce it and
say "waits until X is done". When X is done, `orion-tasks plan` picks it up.

## Clearing the day

"Delete/clear all my scheduled tasks for today", "wipe my plan" → `orion-reschedule clear`
(every block ORION planned that is still ahead today; classes and plans with people stay).
Another day: `clear --date YYYY-MM-DD`. Undo puts them back.

## Skipping a class or plan (2026-10-06)

Classes never move — unless Nick says so. "I'm skipping Marketing", "cancel my lab
today", "I'm not going to soccer" → `orion-reschedule skip "Marketing"` (add
`--date` for another day). It removes just that occurrence, needs no approval, and
`undo` puts it back. Then plan the freed time the normal way (`now`, `add`, …).
Every change to his schedule goes through orion-reschedule / orion-tasks: NEVER the
generic calendar actions (calendar_event_remove, orion_task_run calendar steps) —
those need approval and can hit the wrong occurrence of a repeating class. And never
`undo` your own earlier change to work around a refusal; read the refusal instead.

## Priority scale

Every item in the live facts carries a rank. Use it when something has to give.
- **fixed**: real classes. Never moved, shortened or dropped unless Nick
  explicitly says so for that occurrence.
- **high**: sleep (naps, wind-down), the gym, deadlines and study for them,
  anything he called a must. Protected; move rather than drop, and ask first.
- **medium**: his to-dos, the daily side-project hour (at least 60 minutes
  overall), meals. Can move; tell him.
- **low**: breaks, optional and "if there's time" items. Move or shrink first,
  never below saved minimums.
His own words override the defaults: when he says something matters more or less
("the gym is important", "YouTube isn't a priority today"), save it with
`orion-life rank <thing> high|medium|low` (a lasting preference) or treat it as
today-only when he says so. Use what you know about him to rank new kinds of
items, and say which rank you gave when it changes the plan.

## Protected time and transitions

- Keep five minutes between activities, including grabbing food. A transition is separate from travel.
- School → dorm takes about 45 minutes (see the class wrapper). Home-based work such as research/backpacking planning starts after arrival.
- Named immediate needs such as food take priority over optional backlog work; do not place food hours after class merely because it was appended after the to-do list.
- Food may be picked up on the way home when that makes sense; explain that assumption. Food on the route does not remove the remaining commute before a dorm task. Do not assume every task needs to happen at home.
- Naps are at least 75 minutes. Protect at least one hour of side-project time daily. Keep sleep/rest and real fixed commitments; shrink lower-priority work only within saved minimums.
- Machine-enforced values live in life-config.json: bufferMinutes=5, commuteMinutes=45, homeGapMinutes=150, ranks (orion-life rank), minimums.nap=75, minimums.side project=60. Native planning must read the same values. A prose memory alone is not enforcement.

## I'm out early

One general button reports that the current class or task ended now. No “already home” option. If in a real class, shorten that occurrence to the reported exit time. Reserve 45 minutes from exit for getting home unless his next class is less than 2.5 hours away (then he stays on campus); the trip back before that next class stays. Never ask Nick to re-confirm being home, or shorten future classes. Keep the change undoable.

## Class reminders and presence

Give one reminder about ten minutes before class. Never send “get to class” or escalating start/done prompts during the scheduled class. Classes finish by their calendar/early-exit times; absence of a “done” reply is not proof of avoidance.

Marketing and Macro are at Devon House; DS and CS are at Portsoken. Match recent phone location against the event's campus only when reliable location evidence exists. Stale/missing location is unknown; don't claim attendance from using the phone. Even without location, avoid nagging throughout scheduled class time.

## Check-ins

“Still in the lab / need 30 more minutes” means extend/replan, not a new task titled “still in the lab”. “Eating/taking a break now” describes current activity, not a future start demand. Explicit check-back requests may create a check-in, but never assert the user has eaten or is home merely because a timer expired. Evaluation prompts must never create live check-ins or notifications.
