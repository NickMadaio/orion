// Which undo-journal entries a bare `orion-reschedule undo` may still reach (live gate run 4: six undos by the tester reached entries from
// earlier days and removed and restored real blocks). An entry expires when it is older than 24 hours, or is from a previous calendar day
// and more than 6 hours old (so an undo at 00:30 still reaches a change made at 23:50). A stamp given explicitly (`undo --id <at>`) reaches
// any entry. Pure.
export const MAX_AGE_MS = 24 * 3600_000;
export const PREVIOUS_DAY_GRACE_MS = 6 * 3600_000;

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function undoExpired(at, now = new Date()) {
  const t = at ? new Date(at) : null;
  if (!t || Number.isNaN(t.getTime())) return true;
  const age = now.getTime() - t.getTime();
  if (age > MAX_AGE_MS) return true;
  return !sameDay(t, now) && age > PREVIOUS_DAY_GRACE_MS;
}

/** Index of the entry a bare undo takes (the newest one with steps, if it has not expired), or of the one named by `id`; -1 when none. */
export function pickUndoIndex(history, now = new Date(), id) {
  if (id) return history.findIndex((e) => e?.at === id && (e.steps ?? []).length);
  let i = history.length - 1;
  while (i >= 0 && !(history[i]?.steps ?? []).length) i -= 1;
  return i >= 0 && !undoExpired(history[i].at, now) ? i : -1;
}
