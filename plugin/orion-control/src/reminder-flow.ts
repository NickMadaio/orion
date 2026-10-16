/*
 Reminders, worked out by code (live sweep 2026-10-15).

 The old reminder branch could only do one thing: build alarm_set from "the time and a label" the 9B
 pulled out of his words, on today's date. So "cancel the 3pm reminder" SET an alarm called "cancel
 the 3pm reminder" (q035); "no wait make it 5:30" set a second one and left the 5 PM one (q030);
 "whats my reminders today" read him his to-dos (q034); "dont let me forget that" (a fact, q058) and
 "remind me about the thing" (q091) became alarms at a made-up noon; "in like 10 min" at 23:32 was
 filed for 11:10 that morning (q033), and "weekdays" became one alarm on Thursday (q038).

 Here code decides what he asked for — list, cancel, move the one just set, or set — and works out
 the exact time (relative times are arithmetic, a time already past goes to the next day, no time
 means asking). The worker still makes the one orion_task_run call, through the normal gate; code
 only reads the reminder store (to list, and to find the id to cancel).
*/
import { meansTomorrow } from "./schedule-flow.js";

export type StoredReminder = { id: string; label: string; dueAt: number };
export type Extracted = { time: string | null; label: string } | null;
/** What the reminder turn is: a fixed reply (no tool), or one orion_task_run call for the worker to make. */
export type ReminderPlan =
  | { kind: "say"; text: string; pending?: boolean }
  | { kind: "call"; args: string; reply: string; action: "alarm_set" | "reminder_cancel"; label?: string; at?: string };
export type ReminderInput = {
  message: string;
  now: Date;
  extract: (message: string) => Promise<Extracted>;
  list: () => Promise<StoredReminder[]>;
  /** The reminder this session set last (for "make it 5:30"), if recent. */
  last?: { label: string; at: string };
};

const SET = /\b(remind me|reminder|set an? alarm|alarm (for|at)|wake me|ping me|nudge me)\b/i;
// "dont let me forget that" is something to remember, not an alarm, unless he gives a time (q058).
const FORGET = /\bdon'?t let me forget\b/i;
const CANCEL = /\b(cancel|delete|remove|stop|clear|scrap|turn off|get rid of|kill)\b/i;
const REMINDER_WORD = /\b(reminders?|alarms?)\b/i;
const LIST = /\b(reminders|alarms)\b|\b(what|whats|what's|which|any)\b.*\b(reminder|alarm)\b/i;
const CREATE = /\b(set|add|make|create|remind me)\b/i;
const CORRECTION = /\b(make it|change it to|change that to|move it to|push it to|actually|no wait|instead)\b/i;
const RECURRING = /\b(weekdays|weekends|every ?day|daily|every (morning|night|evening|week|weekday|mon|tue|wed|thu|fri|sat|sun)\w*|each (morning|day|night))\b/i;
const TODAY = /\b(today|tonight|this (morning|afternoon|evening))\b/i;
const VAGUE_LABEL = /^(the |that |this |a |my )?(thing|stuff|it|that|this|something|one)$/i;
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i;
const RELATIVE = /\b(?:in|like|about|around)\s+(?:(?:like|about|around|~)\s*)?(\d+|an?|one|half an?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i;
const STOP_WORDS = new Set(["cancel", "delete", "remove", "stop", "clear", "scrap", "turn", "off", "get", "rid", "kill", "the", "my", "a", "an", "that", "this", "for", "to", "about", "at", "of", "and", "me", "can", "you", "please", "pls", "reminder", "reminders", "alarm", "alarms", "one", "am", "pm"]);

/** Whether this turn is about reminders at all (anything planReminder handles). */
export function isReminderTurn(message: string): boolean {
  if (FORGET.test(message) && !SET.test(message)) return CLOCK.test(message) || RELATIVE.test(message);
  return SET.test(message) || REMINDER_WORD.test(message);
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const ampm12 = (t: string): string => { const [h, m] = t.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${pad(m ?? 0)} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
const weekdayOf = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long" });

/** "in like 10 min" → now + 10 minutes; undefined when he gave no relative time. */
export function relativeTime(message: string, now: Date): Date | undefined {
  const m = RELATIVE.exec(message);
  if (!m?.[1] || !m[2]) return undefined;
  const n = /^half/i.test(m[1]) ? 0.5 : /^(an?|one)$/i.test(m[1]) ? 1 : Number(m[1]);
  const minutes = /^h/i.test(m[2]) ? n * 60 : n;
  return new Date(now.getTime() + Math.round(minutes) * 60_000);
}

/** The clock time he named ("3pm", "15:00") as HH:MM, if any. */
function namedClock(message: string): string | undefined {
  const m = CLOCK.exec(message);
  if (!m) return undefined;
  if (m[4]) return `${pad(Number(m[4]))}:${m[5]}`;
  const hour = Number(m[1]) % 12 + (m[3]?.toLowerCase() === "pm" ? 12 : 0);
  return `${pad(hour)}:${m[2] ?? "00"}`;
}

/** When a stored reminder is due, said out loud: "5:00 PM", or "Friday at 5:00 PM" on another day. */
function spokenDue(dueAt: number, now: Date): string {
  const due = new Date(dueAt);
  const time = ampm12(hhmmOf(due));
  return ymdOf(due) === ymdOf(now) ? time : `${weekdayOf(due)} at ${time}`;
}

async function listPlan(message: string, now: Date, list: ReminderInput["list"]): Promise<ReminderPlan> {
  const live = (await list()).filter((r) => r.dueAt > now.getTime()).sort((a, b) => a.dueAt - b.dueAt);
  const wanted = TODAY.test(message) ? live.filter((r) => ymdOf(new Date(r.dueAt)) === ymdOf(now)) : live;
  if (wanted.length === 0) return { kind: "say", text: TODAY.test(message) ? "You have no reminders left today." : "You have no reminders set." };
  const items = wanted.map((r) => `${r.label} at ${spokenDue(r.dueAt, now)}`);
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return { kind: "say", text: `You have ${wanted.length === 1 ? "one reminder" : `${wanted.length} reminders`}: ${joined}.` };
}

async function cancelPlan(message: string, now: Date, list: ReminderInput["list"]): Promise<ReminderPlan> {
  const live = (await list()).filter((r) => r.dueAt > now.getTime());
  const clock = namedClock(message);
  const words = (message.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));
  const named = clock ? live.filter((r) => hhmmOf(new Date(r.dueAt)) === clock)
    : words.length ? live.filter((r) => words.some((w) => r.label.toLowerCase().includes(w)))
    : live;
  const which = clock ? ` at ${ampm12(clock)}` : words.length ? ` for ${words.join(" ")}` : "";
  if (named.length === 0) return { kind: "say", text: which ? `You don't have a reminder${which}, so nothing was cancelled.` : "You don't have any reminders set." };
  if (named.length > 1) return { kind: "say", text: `Which one? ${named.map((r) => `${r.label} at ${spokenDue(r.dueAt, now)}`).join(", ")}.` };
  const [r] = named as [StoredReminder];
  return { kind: "call", action: "reminder_cancel", args: JSON.stringify({ steps: [{ action: "reminder_cancel", id: r.id }] }), reply: `Cancelled your ${spokenDue(r.dueAt, now)} reminder: ${r.label}.` };
}

/** The exact due time: relative times by arithmetic, a time already past today moved to the next day. */
function dueFor(message: string, time: string | null, now: Date, baseDay?: string): { at: string; day: Date } | { past: string } | undefined {
  const rel = relativeTime(message, now);
  if (rel) return { at: `${ymdOf(rel)}T${hhmmOf(rel)}`, day: rel };
  if (!time) return undefined;
  const [h, m] = time.split(":").map(Number);
  const base = baseDay && !meansTomorrow(message, now) ? new Date(`${baseDay}T00:00`) : new Date(now.getTime() + (meansTomorrow(message, now) ? 86400000 : 0));
  const day = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h ?? 0, m ?? 0);
  if (day.getTime() <= now.getTime()) {
    if (TODAY.test(message)) return { past: time };
    day.setDate(day.getDate() + 1);
  }
  return { at: `${ymdOf(day)}T${hhmmOf(day)}`, day };
}

/** What to do with a reminder turn, or undefined when it is not one (or the extractor is unavailable). */
export async function planReminder(input: ReminderInput): Promise<ReminderPlan | undefined> {
  const { message, now, extract, list, last } = input;
  if (CANCEL.test(message) && REMINDER_WORD.test(message)) return cancelPlan(message, now, list);
  if (LIST.test(message) && !CREATE.test(message)) return listPlan(message, now, list);
  const correcting = !!last && CORRECTION.test(message) && !SET.test(message);
  if (!correcting && !isReminderTurn(message)) return undefined;
  if (RECURRING.test(message)) return { kind: "say", text: "I can't set repeating alarms yet, so nothing was set. Want a one-off for the next one instead?" };
  const got = await extract(message).catch(() => null);
  if (!got) return undefined;
  const label = correcting && last ? last.label : got.label.trim();
  if (!label || VAGUE_LABEL.test(label)) return { kind: "say", text: "What should I remind you about, and when?", pending: true };
  const due = dueFor(message, got.time, now, correcting && last ? last.at.slice(0, 10) : undefined);
  if (!due) return { kind: "say", text: correcting ? "What time should I move it to?" : "What time should I remind you?", pending: !correcting };
  if ("past" in due) return { kind: "say", text: `It's already past ${ampm12(due.past)} today, so nothing was set. Want it tomorrow instead?` };
  const old = correcting && last ? (await list().catch(() => [])).find((r) => r.label === last.label && r.dueAt > now.getTime()) : undefined;
  const steps = [...(old ? [{ action: "reminder_cancel", id: old.id }] : []), { action: "alarm_set", at: due.at, label }];
  const when = `${weekdayOf(due.day)} at ${ampm12(due.at.slice(11))}`;
  return { kind: "call", action: "alarm_set", args: JSON.stringify({ steps }), label, at: due.at, reply: `${old ? "Reminder moved to" : "Reminder set for"} ${when}: ${label}.` };
}
