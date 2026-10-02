# Scheduling memory

Read this file whenever Nick asks to plan, schedule or rearrange a day, or says he is leaving/finishing early. These are durable preferences, not proof that calendar actions have happened. Verify the current calendar, Orion to-do list and deadlines through tools before planning. Use current location/time-zone data and say times in 12-hour form.

## Planning from the actual day

“Schedule my day” includes outstanding tasks on the Orion Reminders list even when Nick also names food or going out. Read `orion-agenda tasks` and the calendar first; use `orion-reschedule day --todos` for task-based planning. The combined syntax is supported: `orion-reschedule day --todos --plan "grab food, 30" --plan "club, 240, 22:00, fixed"`. For a whole-day request ALWAYS include `--todos` on the day command; reading the list then booking only named plans still omits his tasks. Do not invent a 5 PM time for food when he did not give one. Never silently omit the list. List tasks that cannot fit and explain why. Do not include Groceries/Family unless requested.

## Protected time and transitions

- Keep five minutes between activities, including grabbing food. A transition is separate from travel.
- School → dorm takes about 45 minutes. Home-based work such as research/backpacking planning starts after arrival.
- Named immediate needs such as food take priority over optional backlog work; do not place food hours after class merely because it was appended after the to-do list.
- Food may be picked up on the way home when that makes sense; explain that assumption. Food on the route does not remove the remaining commute before a dorm task. Do not assume every task needs to happen at home.
- Naps are at least 75 minutes. Protect at least one hour of side-project time daily. Keep sleep/rest and real fixed commitments; shrink lower-priority work only within saved minimums.
- Machine-enforced values live in life-config.json: bufferMinutes=5, commuteMinutes=45, minimums.nap=75, minimums.side project=60. Native planning must read the same values. A prose memory alone is not enforcement.

## I'm out early

One general button reports that the current class or task ended now. No “already home” option. If in a real class, shorten that occurrence to the reported exit time. If there is no later class, reserve 45 minutes from exit for getting home; if another class remains, stay on campus and preserve its later commute. Never ask Nick to re-confirm being home, or shorten future classes. Keep the change undoable.

## Class reminders and presence

Give one reminder about ten minutes before class. Never send “get to class” or escalating start/done prompts during the scheduled class. Classes finish by their calendar/early-exit times; absence of a “done” reply is not proof of avoidance.

Marketing and Macro are at Devon House; DS and CS are at Portsoken. Match recent phone location against the event's campus only when reliable location evidence exists. Stale/missing location is unknown; don't claim attendance from using the phone. Even without location, avoid nagging throughout scheduled class time.

## Check-ins

“Still in the lab / need 30 more minutes” means extend/replan, not a new task titled “still in the lab”. “Eating/taking a break now” describes current activity, not a future start demand. Explicit check-back requests may create a check-in, but never assert the user has eaten or is home merely because a timer expired. Evaluation prompts must never create live check-ins or notifications.
