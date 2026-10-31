/*
 The worker's scheduler writes never take gym or study he did not name (REV2 finding 18, 2026-10-31).

 When the form misreads a request, the turn falls back to the worker model, which can run orion-reschedule itself. The scheduler protects
 classes and plans with people, but not gym (the daily anchor) or a study block (deadline work). A drop / move / resize / swap / rename of
 one of those, or a `drop --after` that sweeps one up, runs only when his message names it. Pure: the caller supplies the day.

 REV5 MUST 1 (2026-10-31): since wave 5 the scheduler moves a class or plan with people for one day when the call says --named, so the
 worker could pass that flag itself. A worker write that touches one of his fixed events is refused unless it is a move and his own
 message names that event as the thing he is moving (movesThisOne, the same check compile makes before it adds --named).
*/
import type { DayBlock } from "./schedule-flow.js";
import { movesThisOne } from "./own-event-writes.js";

const VERBS = new Set(["drop", "move", "resize", "swap", "rename", "displace"]);
const STOP = new Set(["the", "and", "for", "with", "block", "session", "time", "today", "tonight"]);
const kindOf = (b: DayBlock): "gym" | "study" | null => (b.kind === "gym" || /\bgym\b|\bworkout\b/i.test(b.title) ? "gym"
  : b.kind === "study" || /\b(?:study|revis\w*|homework|problem set)\b/i.test(b.title) ? "study" : null);
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** He named this block: its kind word ("gym", "study"/"studying"/"revision") or a distinctive word of its title. */
export function namesBlock(message: string, b: DayBlock): boolean {
  const said = message.toLowerCase();
  const kind = kindOf(b);
  if (kind === "gym" && /\b(?:gym|workout|lift(?:ing)?|training)\b/.test(said)) return true;
  if (kind === "study" && /\b(?:study|studying|revision|revise|homework|problem set)\b/.test(said)) return true;
  return words(b.title).filter((w) => !["study", "gym"].includes(w)).some((w) => new RegExp(`\\b${w}`).test(said));
}

const find = (title: string, blocks: DayBlock[]) => blocks.find((b) => b.title.toLowerCase() === title.toLowerCase())
  ?? blocks.find((b) => b.title.toLowerCase().includes(title.toLowerCase()));

/** The gym or study block this write would take or move without his naming it, or null when the write is fine. */
export function unnamedAnchorWrite(message: string, args: string[], blocks: DayBlock[]): DayBlock | null {
  const [verb, ...rest] = args;
  if (!verb) return null;
  const titles = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--")) && !/^\d+$/.test(a));
  let touched: DayBlock[] = [];
  if (verb === "drop" && rest.includes("--after")) {
    const anchor = find(rest[rest.indexOf("--after") + 1] ?? "", blocks);
    touched = anchor ? blocks.filter((b) => !b.fixed && toMin(b.start) >= toMin(anchor.end)) : [];
  } else if (VERBS.has(verb)) {
    touched = (verb === "rename" || verb === "resize" || verb === "move" || verb === "displace" ? titles.slice(0, 1) : titles).map((t) => find(t, blocks)).filter((b): b is DayBlock => !!b);
  }
  return touched.find((b) => (b.fixed ? !(verb === "move" && movesThisOne(message, b, blocks)) : kindOf(b) && !namesBlock(message, b))) ?? null;
}
