/*
 A break is on the plan, not only a nudge (live bug 2026-11-05 11:47: "can you give me a 15 min break before my next work block" got
 "Break till 12:03 PM. I'll nudge you then; then it's back to DS Lab 05." and the calendar was never touched, so the plan still showed him in
 a normal work block).
 Here the Break block goes in from now, in one scheduler call (`orion-reschedule now "Break, N"`: booked from now, everything not yet done
 slides after it, a class or a plan with people never moves and the scheduler routes around it). What is said is read back from the day
 afterwards: when the break ends, and each block that moved with the times it now has. A refusal is said, with nothing claimed. One undo
 puts the calendar back (the scheduler's own journal). Focus state is break-intent.ts's (orion-session break) and is not touched here.
*/
import type { Day, DayBlock } from "./schedule-flow.js";
import type { BreakMove } from "./break-intent.js";
import { refused, sideNotes } from "./scheduler-out.js";
import { whyNot } from "./day-requests.js";

export type BreakCalendar = { line?: string; note?: string; calls: string[]; outputs: string[]; writes: number };
type Run = (script: "orion-reschedule", args: string[]) => Promise<{ stdout: string; code: number }>;

const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const ampm = (t: string): string => { const h = Math.floor(toMin(t) / 60) % 24; return `${(h + 11) % 12 + 1}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`; };
const label = (b: DayBlock): string => b.title.replace(/\s+[—–-].*$/, "");
const isBreak = (b: DayBlock): boolean => /^break$/i.test(b.title.trim());

export async function breakOnCalendar(move: BreakMove, deps: { run: Run; readDay: () => Promise<Day | undefined>; now: Date }): Promise<BreakCalendar> {
  const out: BreakCalendar = { calls: [], outputs: [], writes: 0 };
  const nowMin = deps.now.getHours() * 60 + deps.now.getMinutes();
  const before = await deps.readDay().catch(() => undefined);
  if (!before) return { ...out, note: "I couldn't read your calendar just now, so your schedule is unchanged." };
  const under = before.blocks.find((b) => isBreak(b) && toMin(b.start) <= nowMin && toMin(b.end) > nowMin);
  if (under) return { ...out, line: `You're already on a break till ${ampm(under.end)}, so I haven't added another.` };
  const args = ["now", `Break, ${move.minutes}`];
  const ran = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  out.calls.push(`exec orion-reschedule now "Break, ${move.minutes}"`); out.outputs.push(ran.stdout);
  if (refused(ran)) { const why = whyNot(ran.stdout); return { ...out, note: `I couldn't put the break on your calendar${why ? ` (${why})` : ""}, so your schedule is unchanged.` }; }
  out.writes = 1;
  const after = await deps.readDay().catch(() => undefined);
  if (!after) return { ...out, note: "I put the break on your calendar but couldn't read it back to check the times. Say \"undo\" to take it off." };
  const mine = after.blocks.filter((b) => isBreak(b) && toMin(b.end) > nowMin).sort((a, b) => Math.abs(toMin(a.start) - nowMin) - Math.abs(toMin(b.start) - nowMin))[0];
  if (!mine) return { ...out, note: "I tried to put the break on your calendar but can't see it there, so check your day." };
  const moved = after.blocks.filter((b) => !isBreak(b) && before.blocks.some((x) => x.title === b.title && (x.start !== b.start || x.end !== b.end)))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  const said = moved.slice(0, 3).map((b) => `${label(b)} now ${ampm(b.start)}–${ampm(b.end)}`);
  const more = moved.length > 3 ? ` and ${moved.length - 3} more moved` : "";
  const clash = after.blocks.find((b) => !isBreak(b) && (b.fixed || b.kind === "class") && toMin(b.start) < toMin(mine.end) && toMin(b.end) > toMin(mine.start));
  const clashNote = clash ? ` It runs into ${label(clash)} (${ampm(clash.start)}), which doesn't move, so you'll be back for it before the break is over.` : "";
  const sides = sideNotes(said.join(" "), [ran.stdout]).filter((n) => !/ \d{1,2}:\d{2} → /.test(n));
  out.line = `Break till ${ampm(mine.end)}.${said.length ? ` ${said.join("; ")}${more}.` : ""}${sides.length ? ` ${sides.join("; ")}.` : ""}${clashNote}`;
  return out;
}
