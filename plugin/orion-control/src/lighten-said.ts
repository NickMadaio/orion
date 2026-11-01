/*
 What a lightening step actually did, said from the calendar after the write (wave 6 B, gate run-1101003318, hea-sleep-adjust-v).

 "slept like garbage, fix my day" planned a 30-minute nap after CS2100. The scheduler raised it to his nap minimum (life-config
 `minimums.nap`, 75) and placed it at 13:20, after the next class plus the commute. The reply repeated the plan ("30-minute nap at
 10:30 AM after CS2100"), which his calendar never held. Each step is now said from the day re-read after the writes, else from the
 scheduler's own "planned X: HH:MM–HH:MM" line; a raised length names the minimum that raised it. Pure.
*/
import type { Day } from "./schedule-flow.js";
import { ampm, toMin } from "./intent-time.js";

export type SaidStep = { args: string[]; said: string };

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the block titled `title` sits after the write: the re-read day first, else the scheduler's "planned" line. */
export function bookedSpan(title: string, stdout: string, day: Day | undefined): { start: string; end: string } | undefined {
  const planned = new RegExp(String.raw`planned ${esc(title)}: (\d{2}:\d{2})[–-](\d{2}:\d{2})`, "i").exec(stdout);
  const same = day?.blocks.filter((b) => b.title.toLowerCase() === title.toLowerCase()) ?? [];
  const block = same.find((b) => b.start === planned?.[1]) ?? same.at(-1);
  if (block) return { start: block.start, end: block.end };
  return planned ? { start: planned[1]!, end: planned[2]! } : undefined;
}

const hm = (t: string) => ampm(toMin(t));

/** The clause for one step that wrote, true to the calendar. Falls back to the planned wording only when nothing says otherwise. */
export function spokenAfterWrite(step: SaidStep, stdout: string, day: Day | undefined): string {
  const [verb, title = "", to = ""] = step.args;
  if (verb === "add") {
    const span = bookedSpan(title, stdout, day);
    if (!span) return step.said;
    const minutes = (toMin(span.end) - toMin(span.start) + 1440) % 1440;
    const i = step.args.indexOf("--after");
    const after = i >= 0 ? step.args[i + 1] : undefined;
    const follows = after !== undefined && (day?.blocks.some((b) => b.title === after && b.end === span.start) ?? false);
    const raised = new RegExp(String.raw`${esc(title)} (\d+) → (\d+) min \(his minimum\)`, "i").exec(stdout);
    const why = raised ? ` (${raised[2]} minutes is your set minimum for a ${title.toLowerCase()})` : "";
    return `${minutes}-minute ${title.toLowerCase()} at ${hm(span.start)}${follows ? ` after ${after}` : ""}${why}`;
  }
  if (verb === "rename") {
    const b = day?.blocks.find((x) => x.title === to);
    return b ? `${title} is now "${to}", still at ${hm(b.start)}` : step.said;
  }
  return step.said;
}
