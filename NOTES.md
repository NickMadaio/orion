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

## Live run 3 fixes (on 7438dfe)

1. Wrong write ("block 2 hrs for econ homework tonight at 7" -> 1:20 PM): the intent layer reads block / block out / set aside /
   make time / pencil in / schedule / add / book, "for N hrs", and tonight / this evening / this afternoon at T (PM). Backstop
   (`time-backstop.ts`) on every write path: the intent path, the form path (before any preview or "go ahead?"), the worker's
   restatement (it runs through the flow), and the worker's own exec (before_tool_call blocks it). A start he said, after the
   same evening/AM-PM rules, must be a start one of the writes uses (add --at, move --to, day --plan time), or nothing runs and he
   is told "You said 7:00 PM, but that change would have put … at …".
2. A block a `day --plan` created that was not on his day: "Piano practice wasn't on your day, so I added an hour at 1:20 PM."
   plus "you didn't say how long, so that's a default length" when it was, and where it went if not where asked.
3. "Exec failed": the HOST appends it (OpenClaw payloads `resolveToolErrorWarningPolicy`): after a failed mutating exec it shows
   "⚠️ Exec failed: …" unless the final reply acknowledges the failure (MUTATING_FAILURE_INABILITY_PATTERN: couldn't/can't … change/
   move/…). The plugin can't strip it on the agent CLI route. So (a) "push everything N min" is now code (`move` all: every
   block of his still ahead +N, own lengths, one `day --plan`; classes and blocks under way stay; "nothing of yours left to push"
   said with why) and never reaches the worker; `late N` was wrong for it (it only clears the next N minutes); (b) the plugin's
   honest lines now say "I couldn't make that change …" / "I couldn't move anything, so nothing was moved …", which the host
   counts as an acknowledgement (test copies the host's pattern). 5 old tests updated for that wording.
4. Hedges: prolly, i suppose, i think anywhere. "i think resume then gym" is refused on the follow-up path.

Tests: plugin 1693 pass (intent-run3.test.ts 50 new). Scripts 1702/1704 on a clean run: orion-watch "held queue during focus"
fails identically on 7438dfe (clock-dependent after midnight); the check-ins test passes on its own (flaky under load).

## Review of 1c5e0ac (backstop)

- Moves: "to" is the new start, "from" the block's current time ("move gym from 7 to 8" = 20:00).
- Only the item's own start counts: a time whose clause names something else (ends/finishes/home/back/after/before/until/class/
  lecture/lab/meeting/starts…), "I'm/I'll be at …", or "… percent" is not stated. Unclear = not stated, never a refusal.
- Worker exec: `writesIn` finds orion-reschedule / orion-agenda-change / orion-plan-study anywhere in the command (paths, `sh -c`,
  `bash -lc`, quoted, after `cd …;` / `&&`); agenda-change `add T YYYY-MM-DDTHH:mm N` is read as add --at; plan-study --book picks its
  own slots, so with a stated time it is blocked.
- Host check: OpenClaw `agent-tools.before-tool-call` returns a veto ("plugin-before-tool-call") when `hookResult?.block`, and
  `hook-runner-global` merges before_tool_call results with a sticky `block` and stops at the first block: `{ block: true }` is honoured.
- Tests: plugin 1719 pass. Scripts 1700/1704; the 4 failures (check-ins, orion-checkin tick, orion-watch held queue) fail
  identically on 1c5e0ac at this hour (clock-dependent).

## fix/intent-r4 (from f506bba): live run 4

1. False block on "45 min walk today at 5pm" / "need to do laundry, 1 hr, today at 6pm": the routing log showed the desk picked
   `tasks add`, the flow's form wrote `add walk 45` with NO --at, and the backstop (rightly) found no 17:00 in it. Fixes: the intent
   layer reads verbless timed adds (thing + length or day + "at T"; statements like "my class ends at 5 today" are not adds); a lone
   form add/move that only left out the one start he said gets it put in (`repairStart`) instead of refused; a refusal keeps the
   refused argv on the flow result and in the routing log (`flow.blocked`); clearer wording.
2. "move gym from 7 to 8" at 03:47: the backstop read a bare "8" as 8 AM (before-5-AM rule) and refused the right 20:00. Now a move's
   bare times are read against the block's own time (`fromSaid`/`toSaid`, nearest half-day to the block); a "from" that is not where
   the block is is said; the backstop accepts either half for a move's bare "to" (not a contradicted am/pm).
3. "lunch 45 min today at 1pm" started a focus session from the desk's hint. A session now needs a session word in his message
   (focus, lock in, pomodoro, session, timer, deep work); a clock time, a calendar verb, or a meal/activity noun is a calendar item.
   The add is code-first, so the session flow never sees it.
Tests: plugin 1761 pass (intent-r4.test.ts 40). Scripts 1702/1706; the 4 failures are the same clock-dependent ones as on the base.

Review of efc37af: desk-read session starts no longer need a session word (only the calendar-item exclusion stays): "25 min on
resume", "lets get to work on the essay", "work on resume for 25 min", "study econ for 45", "start 25 min on resume" start sessions;
the lunch negatives hold. The time put-back only happens when the stated time is in the item's own clause (comma, and, then, but,
also, plus split clauses): "add stretching, call mom at 5" is not put back and the write is refused, never 17:00 stretching.
Plugin 1772 pass; scripts 1702/1706, the same 4 clock-dependent failures as on the base.
