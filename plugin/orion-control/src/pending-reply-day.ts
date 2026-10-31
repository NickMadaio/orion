/*
 Day arithmetic for pending replies (pending-reply.ts): free slots, the block he named, what is on now and next, and the exact words
 handed to the scheduler, in the shapes calendar-intent.ts reads in code ("add a 60 min X tomorrow at 7pm", "move X to 8pm").
 Pure: a Day (orion-reschedule show --json) and minutes in, values out.
*/
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import { spokenReply } from "./schedule-reply.js";

export const BUFFER = 5;
export const DAY_END = 22 * 60;
export const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const two = (n: number) => String(n).padStart(2, "0");
/** "7:45 PM". */
export const h12 = (min: number): string => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${(h + 11) % 12 + 1}:${two(m)} ${h < 12 ? "AM" : "PM"}`; };
/** "7:45pm" / "8am", the form the calendar intent reads. */
export const cmdTime = (min: number): string => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${(h + 11) % 12 + 1}${m ? `:${two(m)}` : ""}${h < 12 ? "am" : "pm"}`; };
export const nowMinOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** Before 5 AM "tomorrow" is the day he wakes into, which is today's date (schedule-flow LATE_NIGHT_UNTIL). */
export const LATE_NIGHT = 5;
export const wakeDayIsToday = (now: Date): boolean => now.getHours() < LATE_NIGHT;
export type Which = "today" | "tomorrow";
export const dayArgs = (which: Which, now: Date): string[] => (which === "tomorrow" && !wakeDayIsToday(now) ? ["--date", "tomorrow"] : []);
export const dayWord = (which: Which, now: Date): string => (which === "tomorrow" && !wakeDayIsToday(now) ? " tomorrow" : "");

/**
 A clock time he said, on the day it is for (REV4 8). "at 8" said after 8 AM today is 8 PM; a time with am/pm is kept as said. Undefined
 when that time has already gone today: nothing is placed in elapsed time. Another day's time is kept as said.
*/
export function clockOn(at: number, meridiem: boolean | undefined, which: Which, now: Date): number | undefined {
  const nowMin = nowMinOf(now);
  if (which === "tomorrow" && !wakeDayIsToday(now)) return at;
  const t = !meridiem && at < 12 * 60 && at <= nowMin && at + 12 * 60 > nowMin ? at + 12 * 60 : at;
  return t > nowMin ? t : undefined;
}

/** How far (minutes) the calendar's start may sit from the one asked for and still be the block just written. */
const READ_BACK_MIN = 30;
/** After a write: where the block called `title` now starts on the day, read back; undefined when no such block sits near `asked`. */
export function placedAt(day: Day | undefined, title: string, asked: number): number | undefined {
  const want = norm(title);
  const near = (day?.blocks ?? []).filter((b) => (norm(b.title) === want || norm(b.title).includes(want)) && Math.abs(toMin(b.start) - asked) <= READ_BACK_MIN)
    .sort((a, b) => Math.abs(toMin(a.start) - asked) - Math.abs(toMin(b.start) - asked));
  return near[0] ? toMin(near[0].start) : undefined;
}

/** A class or a plan with people (the scheduler marks both fixed); a title "with <someone>" counts when there is no block to read. */
export const isProtected = (title: string, block?: DayBlock): boolean =>
  !!block?.fixed || block?.kind === "class" || /\bwith\s+(?!me\b|myself\b)[a-z]/i.test(title);

const isSleep =(b: DayBlock): boolean => b.kind === "sleep" || /^sleep\b/i.test(b.title);
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The block on the day he named: the exact title, else one whose title holds every word he used ("marketing" → "MKTG2201 Marketing"). */
export function blockNamed(day: Day | undefined, name: string): DayBlock | undefined {
  if (!day) return undefined;
  const want = norm(name).replace(/^(?:my|the|your)\s+/, "");
  if (!want) return undefined;
  const exact = day.blocks.find((b) => norm(b.title) === want);
  if (exact) return exact;
  const ws = want.split(" ").filter((w) => w.length > 2);
  return day.blocks.find((b) => ws.length > 0 && ws.every((w) => norm(b.title).includes(w)))
    ?? day.blocks.find((b) => ws.some((w) => norm(b.title).split(" ").includes(w)));
}

/** The first start in [from, to) where `minutes` fit with his five-minute buffer around every other block; undefined when none. */
export function freeSlot(day: Day | undefined, minutes: number, from: number, to: number, skip?: DayBlock): number | undefined {
  const blocks = (day?.blocks ?? []).filter((b) => b !== skip && !isSleep(b) && toMin(b.end) > toMin(b.start))
    .map((b) => ({ s: toMin(b.start), e: toMin(b.end) })).sort((a, b) => a.s - b.s);
  let start = Math.ceil(from / 5) * 5;
  for (const b of blocks) {
    if (b.e + BUFFER <= start) continue;
    if (start + minutes + BUFFER <= b.s) return start + minutes <= to ? start : undefined;
    start = Math.max(start, Math.ceil((b.e + BUFFER) / 5) * 5);
  }
  return start + minutes <= to ? start : undefined;
}

/** The fixed block that anchors the day he wakes into (his first class), for "CS2100 at 9:00 AM stays". */
export const firstFixed = (day: Day | undefined): DayBlock | undefined =>
  (day?.blocks ?? []).filter((b) => b.fixed && !isSleep(b)).sort((a, b) => toMin(a.start) - toMin(b.start))[0];

/** What is on now and what comes next, from the real day. */
export function nowAndNext(day: Day | undefined, nowMin: number): { current?: DayBlock; next?: DayBlock } {
  const blocks = (day?.blocks ?? []).filter((b) => !isSleep(b)).sort((a, b) => toMin(a.start) - toMin(b.start));
  const current = blocks.find((b) => toMin(b.start) <= nowMin && nowMin < toMin(b.end));
  const next = blocks.find((b) => toMin(b.start) > nowMin);
  return { ...(current ? { current } : {}), ...(next ? { next } : {}) };
}

/** A title the calendar intent reads as a name: no course numbers, nothing but words ("MKTG2201" → "MKTG"). */
export const safeTitle = (s: string, fallback: string): string => {
  const t = s.replace(/\d+/g, " ").replace(/[^A-Za-z' -]+/g, " ").replace(/\s+/g, " ").trim();
  return t || fallback;
};

export const addCommand = (title: string, minutes: number, which: Which, start: number, now: Date): string =>
  `add a ${minutes} min ${title}${dayWord(which, now)} at ${cmdTime(start)}`;
export const moveCommand = (title: string, which: Which, start: number, now: Date): string =>
  `move ${dayWord(which, now) ? "tomorrow's " : ""}${title} to ${cmdTime(start)}`;

/** What the scheduler said, as his reply: its own built reply, its lines read out, or its refusal. */
export function flowText(flow: FlowResult | undefined): string | undefined {
  if (!flow || flow.outcome === "fallback") return undefined;
  if (flow.outcome === "say") return flow.text;
  return flow.reply ?? spokenReply(flow.outputs);
}
/** Whether the scheduler wrote (a "done" that is not an unknown outcome). */
export const flowWrote = (flow: FlowResult | undefined): flow is Extract<FlowResult, { outcome: "done" }> => flow?.outcome === "done" && !flow.uncertain;
