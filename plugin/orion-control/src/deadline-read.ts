/*
 "whats due this week", answered by code. Live sweep 2026-10-16 (r8) q041: the 9B ran `orion-agenda deadlines` itself
 (lectures, holidays and people in the output) and said the all-day Macro Quiz 1 was "today at 1:30 PM" (the lecture's line).
 Code reads the deadlines (orion-agenda deadlines --json marks them with live-day.mjs's rule) and the dated to-dos
 (orion-tasks list), and builds the reply. All-day items are "(all day)", never a time. Written by Claude on 2026-10-16.
*/
import { execFile } from "node:child_process";
import { spokenTime } from "./day-read-answers.js";

const AGENDA = "/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda";
const TASKS = "/Users/nickmadaio/Desktop/ORION/scripts/orion-tasks";

export type DeadlineEvent = { title: string; start: string; allDay?: string; isDeadline?: boolean };
export type DeadlineTask = { title: string; due: string };
export type DeadlineRead = { events: DeadlineEvent[]; tasks: DeadlineTask[] };

const ASKS = /\b(?:what'?s|whats|what is|what are|which|any|anything|do i have|how many)\b[^.?]*\b(?:due|deadlines?)\b|\b(?:my|upcoming|any) deadlines?\b/i;
const CHANGES = /\b(?:make|set|move|push|change|add|remind|schedule|cancel|drop|skip)\b/i;
/** A question about what is due; a change ("make the essay due friday") is not one. */
export const asksDeadlines = (message: string): boolean => ASKS.test(message) && !CHANGES.test(message);

const ymd = (d: Date): string => d.toLocaleDateString("en-CA");
const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** [first day, last day] offsets from today, and how it is said. */
function windowOf(message: string): { from: number; to: number; label: string } {
  if (/\btomorrow\b/i.test(message)) return { from: 1, to: 1, label: "tomorrow" };
  if (/\btoday\b|\btonight\b/i.test(message)) return { from: 0, to: 0, label: "today" };
  if (/\bnext week\b/i.test(message)) return { from: 7, to: 13, label: "next week" };
  return { from: 0, to: 6, label: "this week" };
}

type Item = { text: string; date: Date; minute: number };
function describe(item: Item, today: Date): string {
  const days = Math.round((dayStart(item.date).getTime() - dayStart(today).getTime()) / 86400000);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? WEEKDAY[item.date.getDay()]! : `${WEEKDAY[item.date.getDay()]} ${item.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function items(read: DeadlineRead, today: Date): Item[] {
  const events = read.events.filter((e) => e.isDeadline).flatMap((e) => {
    const at = new Date(e.start);
    if (Number.isNaN(at.getTime())) return [];
    const allDay = e.allDay === "true";
    return [{ date: at, minute: allDay ? -1 : at.getHours() * 60 + at.getMinutes(), text: e.title, tail: allDay ? "all day" : `at ${spokenTime(at.getHours(), at.getMinutes())}` }];
  });
  const tasks = read.tasks.flatMap((t) => {
    const at = new Date(`${t.due}T00:00:00`);
    return Number.isNaN(at.getTime()) ? [] : [{ date: at, minute: 1441, text: `${t.title} (to-do)`, tail: "" }];
  });
  return [...events, ...tasks].sort((a, b) => ymd(a.date).localeCompare(ymd(b.date)) || a.minute - b.minute).map((i) => {
    const where = describe({ text: i.text, date: i.date, minute: i.minute }, today);
    // "Monday at 1:00 PM", "today (all day)", "tomorrow" (a to-do has a day only).
    const when = i.tail === "all day" ? `${where} (all day)` : i.tail ? `${where} ${i.tail}` : where;
    return { text: `${i.text}, ${when}`, date: i.date, minute: i.minute };
  });
}

/** The spoken answer to "what's due …" from the read. */
export function deadlineReply(message: string, read: DeadlineRead, today: Date): string {
  const { from, to, label } = windowOf(message);
  const first = ymd(new Date(dayStart(today).getTime() + from * 86400000 + 3600000));
  const last = ymd(new Date(dayStart(today).getTime() + to * 86400000 + 3600000));
  const all = items(read, today);
  const inside = all.filter((i) => ymd(i.date) >= first && ymd(i.date) <= last);
  if (inside.length) return `Due ${label}: ${inside.map((i) => i.text).join("; ")}.`;
  const next = all.find((i) => ymd(i.date) > last);
  return `Nothing is due ${label}.${next ? ` The next deadline is ${next.text}.` : ""}`;
}

/** Dated open to-dos from `orion-tasks list` ("- title · due 2026-10-17 · medium"). */
export function parseTasks(stdout: string): DeadlineTask[] {
  return stdout.split("\n").flatMap((line) => {
    const m = /^- (.+?) · due (\d{4}-\d{2}-\d{2})\b/.exec(line.trim());
    return m ? [{ title: m[1]!, due: m[2]! }] : [];
  });
}

const run = (file: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => execFile(file, args, { timeout: 30000, maxBuffer: 1 << 20 }, (e, stdout) => resolve(e ? null : String(stdout ?? ""))));

/** Reads the calendar's deadlines and the dated to-dos (read-only); null when the calendar read fails, so the worker takes over. */
export async function liveReadDeadlines(): Promise<DeadlineRead | null> {
  const [agenda, tasks] = await Promise.all([run(AGENDA, ["deadlines", "--json"]), run(TASKS, ["list"])]);
  if (agenda === null) return null;
  try {
    const events = JSON.parse(agenda) as DeadlineEvent[];
    return Array.isArray(events) ? { events, tasks: parseTasks(tasks ?? "") } : null;
  } catch { return null; }
}
