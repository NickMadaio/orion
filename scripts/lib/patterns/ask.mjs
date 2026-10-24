// The one light question before a confident routine night: "Out tonight like usual Fridays?" (pure). At most once per
// evening, early (1-4 h before it usually starts), never while he sleeps or focuses. His reply confirms or refutes the
// night (orion-inbound-turn -> store.recordAnswer) and is evidence for the next nightly learn.
import { nightMinute } from "./time.mjs";

export const ASK_TYPE = "routine-check";
export const ASK_LATEST = 60;   // minutes before the usual start

export function askText(r) {
  const word = !r.label || r.label === "out" || r.label.startsWith("out ") ? "Out" : `${r.label[0].toUpperCase()}${r.label.slice(1)}`;
  return `${word} tonight like usual ${r.weekdayName}s?`;
}

/**
 * @param routine  routineNow() result
 * @param ctx      { aw, now, sent, ledger }
 * @returns an orion-proactive "ask" action, or null
 */
export function routineAsk(routine, { aw = {}, now = new Date(), sent = {}, ledger = { asks: [] } } = {}) {
  if (routine?.state !== "expected" || routine.phase !== "before" || routine.confirmed) return null;
  if (nightMinute(now, routine.date) > routine.start - ASK_LATEST) return null;
  if (aw.sleep?.state === "asleep" || ["focus", "paused"].includes(aw.session?.state)) return null;
  const key = `routine-check-${routine.date}`;
  if (sent[key] || (ledger.asks ?? []).some((a) => a.type === ASK_TYPE && a.window?.date === routine.date)) return null;
  return { key, type: ASK_TYPE, action: "ask", kind: "question", text: askText(routine),
    ask: { type: ASK_TYPE, routineId: routine.routineId, window: { date: routine.date, start: routine.start, end: routine.end }, place: null, cell: null } };
}
