// What undo needs to put one of his events back as it was (split out of move-own.mjs so calendar-write.mjs can journal it too).
/**
 * What undo needs to put the occurrence back where it was (REV5 SHOULD 5): its own calendar, location, notes and link, as the bridge
 * reported them when it came off. EventKit cannot restore a removed occurrence of a series, so undo re-creates it there as a single
 * event. A bridge that reports none leaves only the location the day read gave.
 */
export function originalDetails(gone, target) {
  const pick = (v) => (typeof v === "string" && v.trim() ? v : undefined);
  const out = { calendar: pick(gone?.calendar), location: pick(gone?.location) ?? pick(target?.location), notes: pick(gone?.notes), url: pick(gone?.url) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
