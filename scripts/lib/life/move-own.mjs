// Moving one of HIS events he names: "marketing is moved to 2pm today", "move my MKTG2201 class from 1:30 to 2pm"
// (gate run-1031224700, sch-move-fixed-named). Classes and plans with people never move on their own; when he names one and
// says where, that occurrence moves.
//
// Not move_calendar_event: on a repeating event the identifier names the series, and EventKit's .thisEvent save moved its
// FIRST occurrence (the reason `move` refused his events until now). Instead, the same pair `skip` already uses:
//   1. the new time goes on his calendar as his own event (no ORION marker, so it stays fixed for the planner);
//   2. that day's occurrence comes off by its start (delete_calendar_event { start } removes only that occurrence);
//      a read-only class feed cannot be changed, so then it is skipped in ORION's planning instead (skips.mjs).
// ORION's blocks that the new time now overlaps are moved in the same write, and all of it is one undo step.
import { applyPlan, appendUndoSteps, bridge, iso, undoLast } from "./calendar-write.mjs";
import { addSkip } from "./skips.mjs";

/**
 * What undo needs to put the occurrence back where it was (REV5 SHOULD 5): its own calendar, location, notes and link, as the bridge
 * reported them when it came off. EventKit cannot restore a removed occurrence of a series, so undo re-creates it there as a single
 * event. A bridge that reports none leaves only the location the day read gave.
 */
function originalDetails(gone, target) {
  const pick = (v) => (typeof v === "string" && v.trim() ? v : undefined);
  const out = { calendar: pick(gone?.calendar), location: pick(gone?.location) ?? pick(target?.location), notes: pick(gone?.notes), url: pick(gone?.url) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/**
 * @param opts { date, target: the block as it is now, start, end (minutes), moves, removed: ORION's blocks the cascade changed,
 *               blocksById, config, group }
 * @returns { how } a plain note on how the old occurrence came off
 */
export async function moveOwnEvent({ date, target, start, end, moves = [], removed = [], blocksById, config = {}, group }) {
  const created = [{ id: `own-${target.id}`, title: target.title, kind: target.kind, date, start, end, fixed: true }];
  await applyPlan({ date, moves, created, removed, blocksById, group, config });
  const from = iso(date, target.start); const to = iso(date, target.end);
  try {
    const gone = await bridge("delete_calendar_event", { identifier: target.calendarId, start: from });
    appendUndoSteps(group, [{ op: "delete", identifier: target.calendarId, title: target.title, start: from, end: to, ...originalDetails(gone, target) }]);
    return { how: "" };
  } catch (error) {
    if (!/read-only/i.test(String(error?.message))) {
      // The new time is written but the old one could not come off: take the whole change back rather than leave him two.
      await undoLast().catch(() => null);
      throw new Error(`could not take the ${target.title} at its old time off his calendar (${error?.message}); nothing was changed`);
    }
    addSkip(target.title, from);
    appendUndoSteps(group, [{ op: "unskip", title: target.title, start: from }]);
    return { how: "its old time is skipped in ORION's planning (that calendar is read-only, so it still shows there)" };
  }
}
