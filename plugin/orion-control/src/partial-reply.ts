/*
 How a scheduler run that only partly fit is worded (wave 9 B, gate run-1101085557: sch-fixed-plan-protect). The old line was
 "Partly done. Not done: Side project didn't fit. What did change: cleared Gym, Side project; Gym 9:50 PM–11:20 PM." It read as a
 form, named a clear-and-rebook as two changes, and never said the classes and the plan with people had been left alone.
 Now it goes done first, then what could not happen, then (when the flow knows them) what was deliberately kept, then "undo".
 Every clause is read from the scheduler's own lines or the day the flow already read; nothing here claims a change of its own.
*/
import { compoundReply } from "./compound-reply.js";
import type { DayBlock } from "./schedule-flow.js";

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ampm = (t: string): string => { const [h, m] = t.split(":").map(Number); return `${(((h ?? 0) + 11) % 12) + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };

/** "SHIFTED: Gym could not go at 18:00 (dinner with Annika is there) — booked 21:40 instead" by title: why it is not where it was asked. */
export function shiftReasons(lines: string[]): Map<string, { at: string; because: string }> {
  const out = new Map<string, { at: string; because: string }>();
  for (const l of lines) {
    const m = l.match(/^SHIFTED: (.+?) could not go at (\d{2}:\d{2}) \((.+?)\) — booked/);
    if (m) out.set(norm(m[1]!), { at: ampm(m[2]!), because: m[3]!.replace(/ is there$/, "") });
  }
  return out;
}

/** Titles the scheduler cleared and that came back neither as a planned line nor as a NOT BOOKED one ("cleared 2 prior schedule blocks: Gym, Side project"). */
export function clearedNotReplanned(lines: string[], planned: string[], notBooked: string[]): string[] {
  const gone = lines.flatMap((l) => { const m = l.match(/^cleared \d+ prior schedule blocks?: (.+)$/i); return m ? m[1]!.split(/,\s+/) : []; });
  const back = new Set([...planned, ...notBooked].map(norm));
  return gone.filter((t) => !back.has(norm(t)));
}

/** "Classes and dinner with Annika stay put." from the fixed blocks the flow read, or "" when none are still ahead. */
export function keptLine(blocks: DayBlock[], nowHHMM: string | null): string {
  const ahead = blocks.filter((b) => (b.fixed || b.kind === "class") && (!nowHHMM || b.end > nowHHMM));
  const classes = ahead.some((b) => b.kind === "class");
  const plans = [...new Set(ahead.filter((b) => b.kind !== "class").map((b) => b.title.replace(/\s+—.*$/, "")))].slice(0, 2);
  const names = [...(classes ? ["Classes"] : []), ...plans];
  if (!names.length) return "";
  const lower = names.map((t, i) => (i === 0 ? t : t.replace(/^./, (c) => c.toLowerCase())));
  return `${lower.join(" and ")} ${names.length === 1 && !classes ? "stays" : "stay"} put.`;
}

/** What he hears when some of a run is booked and some did not fit. `did` are the booked items as already worded. */
export function partialReply(p: { did: string[]; failures: string[]; kept?: string; when?: string }): string {
  const text = compoundReply({ did: p.did, knock: [], couldnt: p.failures, ...(p.kept ? { tail: p.kept } : {}), undo: true });
  return p.when ? text.replace(/^Done —/, `Done for ${p.when} —`) : text;
}

/** A dry run that would drop the Gym (a must): the scheduler's own line naming it, else undefined. */
export function dropsGym(dryOutput: string): string | undefined {
  return dryOutput.split("\n").map((l) => l.trim()).find((l) => /^(?:MUST-HAVE )?NOT BOOKED: gym\b/i.test(l));
}
