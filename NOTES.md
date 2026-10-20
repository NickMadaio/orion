# fix/intent-followups (from 8f8bc92; origin/main did not have it yet)

1. resolveEnd: an exact end after midnight from a start late today (>= 18:00, end < 06:00) is "past-midnight", not "already
   passed"; said plainly, nothing booked (a block can't cross midnight), with "until 11:55 PM" offered.
2. resolveStart: before 5 AM, a small hour within the next 3 hours is this early morning ("a walk at 5" at 2 AM = 05:00);
   a 1-6 hour further off is asked (AM or PM). "tonight" still means PM.
3. A crash, a kill, or a non-zero exit that is not one of the scheduler's own refusals is an unknown outcome: the day is read
   back and compared with before (`dayDiff`, `uncertainReply` in schedule-reply.ts): what changed, or "reads the same, but I
   can't be sure", or "couldn't compare, may have changed"; always with undo, which the session now allows. Never
   "nothing changed", never a read-back "Done".
4. Doubt: idek, idk, or smth / or sth / or something, and trailing ish / kinda / sorta / maybe / probably / i think / idk tho.
   Doubt is checked before the question test ("kinda?"). Mid-sentence "im kinda tired tho" still fires.
5. Past-tense reports ("we did resume then gym") are refused on the follow-up path (PAST_REPORT).

Tests: intent-followups.test.ts (45 rows), calendar-intent-run.test.mjs +2. Plugin 1643 pass. Scripts 1701/1702: the one failure
(delivery-senders "held queue during focus") also fails on 8f8bc92 after midnight; clock-dependent, unrelated.
