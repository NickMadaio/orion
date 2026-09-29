// ORION's standing question: given the plan, the time and what happened, what
// should Nick do next? (life-next)
import { comparePriority } from "./priority.mjs";

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const CATCH_UP = new Set(["study", "deadline", "side_project"]);

export function nextAction({ blocks, now, done = [], state = "day" }) {
  const minute = typeof now === "number" ? now : now.minute;
  if (state === "awake_late" || state === "winding_down") {
    return { action: "sleep", blockId: null, reason: "It is past your bedtime.", startsIn: 0 };
  }
  const open = blocks.filter((b) => !done.includes(b.id));
  const current = open.filter((b) => b.start <= minute && minute < b.end).sort(comparePriority)[0];
  if (current) return { action: "do", blockId: current.id, reason: `${current.title} is on now, until ${hhmm(current.end)}.`, startsIn: 0 };
  const soon = open.filter((b) => b.start > minute && b.start - minute <= 15).sort((a, b) => a.start - b.start)[0];
  if (soon) return { action: "prepare", blockId: soon.id, reason: `${soon.title} starts at ${hhmm(soon.start)}.`, startsIn: soon.start - minute };
  const missed = open.filter((b) => !b.fixed && CATCH_UP.has(b.kind) && b.end <= minute).sort((a, b) => a.start - b.start)[0];
  if (missed) return { action: "do", blockId: missed.id, reason: `You planned this for ${hhmm(missed.start)} and it hasn't happened yet.`, startsIn: 0 };
  const next = open.filter((b) => b.start > minute).sort((a, b) => a.start - b.start)[0];
  if (next) return { action: "free", blockId: next.id, reason: `Free until ${next.title} at ${hhmm(next.start)}.`, startsIn: next.start - minute };
  return { action: "free", blockId: null, reason: "Nothing else is planned today.", startsIn: null };
}
