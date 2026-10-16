/*
 Answers to day questions that code can give itself. Live sweep 2026-10-16 (r8):
 q004 "whats on today like all of it": the read of his day had only timed blocks, so the all-day quiz was never said.
 q015 "how much time do i have before my nap block ends": there is no nap block today; the 9B invented "ends at 04:00".
 When a question names a kind of block and nothing in the day read matches, code says so (and what is there).
 Written by Claude on 2026-10-16.
*/
import { blockList, type Day } from "./schedule-flow.js";

/** The day as the worker and code read it: numbered blocks, then an "All day:" line (q004). */
export function dayRead(day: Day & { allDay?: string[] }): string {
  const lines = day.blocks.length ? [blockList(day)] : [];
  const allDay = (day.allDay ?? []).filter((t) => typeof t === "string" && t.trim());
  if (allDay.length) lines.push(`All day: ${allDay.join("; ")}`);
  return lines.join("\n");
}

type Kind = { label: string; asked: RegExp; title: RegExp };
// "class" is any lecture-like title or a course code, the same words live-day.mjs classify uses for a class.
const KINDS: Kind[] = [
  { label: "nap", asked: /\bnap\b/i, title: /\bnap(s|ping)?\b/i },
  { label: "gym", asked: /\b(gym|workout)\b/i, title: /\b(gym|workout|lift(ing)?)\b/i },
  { label: "lab", asked: /\blabs?\b/i, title: /\blab\b/i },
  { label: "meal prep", asked: /\bmeal\s*prep\b/i, title: /\bmeal\s*prep\b/i },
  { label: "lunch", asked: /\blunch\b/i, title: /\blunch\b/i },
  { label: "dinner", asked: /\bdinner\b/i, title: /\bdinner\b/i },
  { label: "breakfast", asked: /\bbreakfast\b/i, title: /\bbreakfast\b/i },
  { label: "study", asked: /\b(study|studying)\b/i, title: /\b(study|studying|revis\w*|homework)\b/i },
];

const BLOCK = /^B\d+ (\d{2}):(\d{2})–(\d{2}):(\d{2}) (.*?)(?: \(FIXED\))?(?: \(already happened\))?$/;
type Row = { hour: number; minute: number; title: string; over: boolean };
function rows(day: string): Row[] {
  return day.split("\n").flatMap((line) => {
    const m = BLOCK.exec(line.trim());
    return m ? [{ hour: Number(m[1]), minute: Number(m[2]), title: m[5]!, over: /\(already happened\)\s*$/.test(line.trim()) }] : [];
  });
}

export const spokenTime = (hour: number, minute: number): string => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
// "MKTG2201 Introduction to Marketing — Lecture" is said without its trailing "— Lecture".
const spokenTitle = (t: string): string => t.replace(/\s+—\s+Lecture$/i, "");
const joinList = (xs: string[]): string => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);

// A question about when something is on his calendar, not advice about it ("how long should my naps be").
const ABOUT_TIME = /\b(when|what time|how (?:long|much time|many minutes|soon)|until|till|before|after|ends?|starts?|next|is today|is there|do i have|have a)\b/i;
const ADVICE = /\b(should|supposed to|recommend\w*|ideal|healthy|best)\b/i;

/** The reply when the question names a kind of block and none is on the day; null when one is, or none is named. */
export function noBlockReply(message: string, day: string, tomorrow: boolean): string | null {
  const kind = ABOUT_TIME.test(message) && !ADVICE.test(message) ? KINDS.find((k) => k.asked.test(message)) : undefined;
  const all = rows(day);
  if (!kind || !all.length && !day.trim()) return null;
  if (all.some((r) => kind.title.test(r.title))) return null;
  const when = tomorrow ? "tomorrow" : "today";
  const head = `There's no ${kind.label} block on your calendar ${when}.`;
  const left = all.filter((r) => !r.over);
  if (!all.length) return head;
  if (!left.length) return `${head} Everything on it has already happened.`;
  return `${head} You have ${joinList(left.map((r) => `${spokenTitle(r.title)} at ${spokenTime(r.hour, r.minute)}`))}.`;
}
