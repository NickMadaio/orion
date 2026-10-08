// Turn-list helpers for orion-v3-logs: chat copies of session turns, the job of
// each turn (follow-ups inherit), and the summary counts. Kept out of the CLI so
// they are tested (ORION V3 handoff §5.2 step 5).
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { jobOf } from "./jobs.mjs";

const DUP_WINDOW_MS = 3 * 60 * 1000;
const FOLLOW_UP_MS = 2 * 60 * 1000;

export const hasTime = (t) => typeof t?.at === "string" && Number.isFinite(Date.parse(t.at));

/** A chat message usually also has a session turn; keep both, mark the chat copy. */
export function markDuplicates(sessions, chats) {
  const byText = sessions.reduce((m, s) => m.set(s.userText, [...(m.get(s.userText) ?? []), s]), new Map());
  return chats.map((c) => {
    const twin = (byText.get(c.userText) ?? []).find((s) => Math.abs(Date.parse(s.at) - Date.parse(c.at)) <= DUP_WINDOW_MS);
    return twin ? { ...c, dupOf: `${twin.file}:${twin.line}` } : c;
  });
}

/** Chronological turns → each with `job`; a quick follow-up in the same thread takes the previous job. */
export function assignJobs(turns) {
  const last = new Map();
  return turns.map((t) => {
    const prev = last.get(t.file);
    const recent = prev && Date.parse(t.at) - Date.parse(prev.at) <= FOLLOW_UP_MS ? prev.job : null;
    const turn = { ...t, job: jobOf(t.userText, recent) };
    last.set(t.file, turn);
    return turn;
  });
}

export function count(items, keyOf) {
  return items.reduce((acc, x) => acc.set(keyOf(x), (acc.get(keyOf(x)) ?? 0) + 1), new Map());
}
