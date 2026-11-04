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
import { pluginNow } from "./plugin-clock.js";
import { describeDuration } from "./ambient.js";
import { describeRepeat, nextOccurrence, type Repeat } from "./reminder-schedule.js";
import { fixTypos, isImportantAsk, periodTime, repeatOf, wantsHome } from "./reminder-phrases.js";
import { commitmentOf, OFFER_WINDOW_MS, type OfferPort, type PendingOffer } from "./reminder-offers.js";
import { latestFired } from "./reminder-store.js";

export type { OfferPort, PendingOffer } from "./reminder-offers.js";
/** A reminder as the plan reads it: the store's entry, whatever the clock has since written on it. */
export type StoredReminder = { id: string; label: string; dueAt: number; repeat?: Repeat; place?: string; important?: boolean; firedAt?: number | null; snoozedAt?: number | null; kind?: "alarm" | "timer"; createdAt?: number; open?: number | null };
export type Extracted = { time: string | null; label: string } | null;
/** What the reminder turn is: a fixed reply (no tool), or one orion_task_run call for the worker to make. */
export type ReminderPlan =
  | { kind: "say"; text: string; pending?: boolean; askLabel?: boolean }
  | { kind: "call"; args: string; reply: string; action: "alarm_set" | "reminder_cancel" | "reminder_snooze" | "reminder_done"; label?: string; at?: string };
export type ReminderInput = {
  message: string;
  now: Date;
  extract: (message: string) => Promise<Extracted>;
  list: () => Promise<StoredReminder[]>;
  /** The reminder this session set last (for "make it 5:30"), if recent. */
  last?: { label: string; at: string };
  /** Offered reminders (a thing he says he has to do; a deadline ORION suggested). Without it nothing is offered or accepted. */
  offers?: OfferPort;
};

const SET = /\b(remind me|reminder|set an? alarm|alarm (for|at)|wake me|ping me|nudge me)\b/i;
// "dont let me forget that" is something to remember, not an alarm, unless he gives a time (q058).
const FORGET = /\bdon'?t let me forget\b/i;
const FORGET_TO = /\bdon'?t let me forget to\b/i;
const CANCEL = /\b(cancel|delete|remove|stop|clear|scrap|turn off|get rid of|kill)\b/i;
const REMINDER_WORD = /\b(reminders?|alarms?)\b/i;
const LIST = /\b(reminders|alarms)\b|\b(what|whats|what's|which|any)\b.*\b(reminder|alarm)\b/i;
const CREATED_BY_HIM = /\b(i|you|we)\s+(set|made|added)\b/gi;
const CREATE = /\b(set|add|make|create|remind me)\b/i;
const CORRECTION = /\b(make it|change it to|change that to|move it to|push it to|actually|no wait|instead)\b/i;
const RECURRING = /\b(weekdays|weekends|every ?day|daily|every (morning|night|evening|week|weekday|mon|tue|wed|thu|fri|sat|sun)\w*|each (morning|day|night))\b/i;
const TODAY = /\b(today|tonight|this (morning|afternoon|evening))\b/i;
const VAGUE_LABEL = /^(the |that |this |a |my )?(thing|stuff|it|that|this|something|one)$/i;
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i;
const RELATIVE = /\b(?:in|like|about|around)\s+(?:(?:like|about|around|~)\s*)?(\d+|an?|one|half an?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i;
const STOP_WORDS = new Set(["cancel", "delete", "remove", "stop", "clear", "scrap", "turn", "off", "get", "rid", "kill", "the", "my", "a", "an", "that", "this", "for", "to", "about", "at", "of", "and", "me", "can", "you", "please", "pls", "reminder", "reminders", "alarm", "alarms", "one", "am", "pm"]);

// Words that can sit in a correction without naming a new subject ("actually make it 6pm", "no wait, change it to 5:30").
const CORRECTION_FILLER = new Set(["make", "it", "that", "this", "change", "move", "push", "to", "the", "reminder", "alarm", "actually", "no", "wait", "instead", "i", "mean", "sorry", "ok", "okay", "please", "pls", "at", "for", "by", "and", "then", "now", "am", "pm", "oclock", "half", "past", "quarter", "noon", "midnight", "tomorrow", "today", "tonight", "morning", "afternoon", "evening", "later", "earlier", "an", "a", "hour", "hours", "minutes", "minute", "min", "mins", "in", "one"]);
/** A correction names no new subject: a message that names something else ("move gym to 6pm") is a new request (review, 2026-10-16). */
export function isCorrection(message: string): boolean {
  return CORRECTION.test(message) && !SET.test(message) && (message.toLowerCase().replace(/o'clock/g, "oclock").match(/[a-z]+/g) ?? []).every((w) => CORRECTION_FILLER.has(w));
}
/** His whole answer is a time or day ("at 5pm", "tomorrow at 9"): safe to read together with the reminder it answers. */
export function isBareTime(message: string): boolean {
  return (CLOCK.test(message) || /\bat\s+\d{1,2}\b/i.test(message) || RELATIVE.test(message) || meansTomorrow(message, pluginNow())) && (message.toLowerCase().match(/[a-z]+/g) ?? []).every((w) => CORRECTION_FILLER.has(w) || w === "like" || w === "about" || w === "around" || w === "next");
}
/** Cancel, not create: the cancel word comes before the reminder word and no create verb is present (review, 2026-10-16). */
function isCancel(message: string): boolean {
  // A create word counts only before the cancel word, and "the reminder I set" is not one (re-review, 2026-10-16).
  const m = message.replace(CREATED_BY_HIM, " ");
  const c = CANCEL.exec(m), r = REMINDER_WORD.exec(m), k = CREATE.exec(m);
  return !!c && !!r && c.index < r.index && !(k && k.index < c.index);
}

/** Whether this turn is about reminders at all (anything planReminder handles). */
export function isReminderTurn(message: string): boolean {
  // Merge of r2-reminders (FORGET is a fact unless timed) with r2-memory-facts ("don't let me forget to call
  // mom at 5" is a reminder): "forget to <do something>" is an action to be reminded of, timed or not; only
  // "forget that/this/it" is a fact (memory-facts' TELLS rule draws the same line).
  if (FORGET.test(message) && !SET.test(message)) return CLOCK.test(message) || RELATIVE.test(message) || FORGET_TO.test(message);
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

/** Whether his words state a clock time at all; the extractor's time is used only when they do (2026-10-19). */
const STATES_TIME = /\b(?:it|that)\s+(?:to\s+)?\d{1,2}\b(?!\s*(?:pills?|times?))|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b(?:at|by|around|@)\s*\d{1,2}\b|\b(?:in|like|about|around)\s+(?:(?:like|about|around|~)\s*)?(?:\d+|an?|one|half an?)\s*(?:minutes?|mins?|hours?|hrs?)\b|\b(?:noon|midnight|midday|o'?clock|half past|quarter (?:past|to))\b|\b(?:at|by|for|around)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;

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

/** How a stored reminder reads in a list: its schedule, "when you get home", or its time. */
function spokenWhen(r: StoredReminder, now: Date): string {
  if (r.repeat) return describeRepeat(r.repeat);
  if (r.place) return "when you get home";
  const at = spokenDue(r.dueAt, now);
  return /^\d/.test(at) ? `at ${at}` : at;
}

/** What is still to come: recurring and place ones always, a one-off until it is due or has been delivered. */
const pendingOf = (list: StoredReminder[], now: Date): StoredReminder[] => list.filter((r) => r.repeat || r.place || (r.dueAt > now.getTime() && !r.firedAt));

async function listPlan(message: string, now: Date, list: ReminderInput["list"]): Promise<ReminderPlan> {
  const live = pendingOf(await list(), now).sort((a, b) => a.dueAt - b.dueAt);
  const wanted = TODAY.test(message) ? live.filter((r) => r.place || ymdOf(new Date(r.dueAt)) === ymdOf(now)) : live;
  if (wanted.length === 0) return { kind: "say", text: TODAY.test(message) ? "You have no reminders left today." : "You have no reminders set." };
  const items = wanted.map((r) => `${r.label} ${spokenWhen(r, now)}`);
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return { kind: "say", text: `You have ${wanted.length === 1 ? "one reminder" : `${wanted.length} reminders`}: ${joined}.` };
}

async function cancelPlan(message: string, now: Date, list: ReminderInput["list"]): Promise<ReminderPlan> {
  const live = pendingOf(await list(), now);
  const clock = namedClock(message);
  const words = (message.replace(CREATED_BY_HIM, " ").toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));
  const named = clock ? live.filter((r) => hhmmOf(new Date(r.dueAt)) === clock)
    : words.length ? live.filter((r) => words.some((w) => new RegExp(`\\b${w}\\b`).test(r.label.toLowerCase())))
    : live;
  const which = clock ? ` at ${ampm12(clock)}` : words.length ? ` for ${words.join(" ")}` : "";
  if (named.length === 0) return { kind: "say", text: which ? `You don't have a reminder${which}, so nothing was cancelled.` : "You don't have any reminders set." };
  if (named.length > 1) return { kind: "say", text: `Which one? ${named.map((r) => `${r.label} ${spokenWhen(r, now)}`).join(", ")}.` };
  const [r] = named as [StoredReminder];
  return { kind: "call", action: "reminder_cancel", args: JSON.stringify({ steps: [{ action: "reminder_cancel", id: r.id }] }), reply: `Cancelled your ${r.repeat || r.place ? spokenWhen(r, now) : spokenDue(r.dueAt, now)} reminder: ${r.label}.` };
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ON = /\b(?:(on|this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?<=\b(?:on|this|next)\s+)(?:mon|tues?|wed|thu|thurs|fri|sat|sun))\b(?!'s)/i;

/** "ill leave at 1:05 for marketing" (loop-leave-nudge-c): a time he will leave is a leave reminder, said as one. Undefined otherwise. */
const LEAVE_AT = /^(?:(?:ok(?:ay)?|so|yeah|fine|alright|orion)[,\s]+)*(?:i'?ll|ill|i will|i'?m gonna|im gonna|gonna|i'?m going to|im going to|i'?m leaving|im leaving|leaving)\s+(?:leave\s+)?(?:at|by|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(?:for|to)\s+(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ]{1,30}?))?\s*[.!]*$/i;
export function leaveAsReminder(message: string): string | undefined {
  const m = LEAVE_AT.exec(message.trim());
  return m ? `remind me to leave${m[2] ? ` for ${m[2]}` : ""} at ${m[1]}` : undefined;
}

/** The exact due time: relative times by arithmetic, a time already past today moved to the next day. */
// REV2 finding 15: a weekday counts only when it is next to the time ("on friday at 6", "at 6 on friday", "6pm friday").
// "remind me at 6 to study for the quiz on friday" names the quiz's day, not the reminder's: that is asked.
const CLOCK_WORD = String.raw`\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?`;
function weekdayNextToTime(message: string, wd: RegExpExecArray): boolean {
  const before = message.slice(0, wd.index); const after = message.slice(wd.index + wd[0].length);
  return new RegExp(String.raw`^\s*(?:at|@|around|by)?\s*${CLOCK_WORD}\b`, "i").test(after)
    || new RegExp(String.raw`(?:at|@|around|by)?\s*\b${CLOCK_WORD}\s*$`, "i").test(before) && /\d/.test(before.slice(-12));
}
// 2026-10-31 gate (cha-phone-call-c): "on sunday at 6" was filed for 6:00 AM. A bare hour with no am/pm is read from his words, never the
// extractor's guess: 1-6 is the afternoon or evening, 7-11 the morning, 12 noon, unless he says morning or evening / tonight / afternoon.
// REV3 6: the time read is the reminder's own (the one the extractor picked, else the first), its am/pm or period word only when it sits
// next to that time ("at 9 to call about tonight's dinner" is 9 AM; "dinner at 7pm" says nothing about "at 6"), "o'clock" is still bare,
// twelve at night is midnight, and "afternoon" lifts only 1-6.
const TIME_AT = /\b(?:at|by|around|@)\s*(\d{1,2})(?::(\d{2}))?(?![\d:])(\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z]))?/gi;
const PERIOD_AFTER = /^\s*(?:o'?clock\s*)?(?:,\s*)?(?:(?:in|at|this|on)\s+(?:the\s+)?)?(morning|afternoon|evening|night|tonight)\b/i;
const PERIOD_BEFORE = /\b(morning|afternoon|evening|night|tonight)\s*,?\s*$/i;
function sensibleHour(message: string, [h, m]: [number, number]): [number, number] {
  const times = [...message.matchAll(TIME_AT)].filter((t) => Number(t[1]) <= 23);
  if (!times.length) return [h, m];
  const own = times.find((t) => Number(t[1]) % 12 === h % 12) ?? times[0]!;
  const n = Number(own[1]);
  const minutes = own[2] ? Number(own[2]) : 0;
  if (n > 12) return [n, minutes];
  if (own[3]) return [n % 12 + (/p/i.test(own[3]) ? 12 : 0), minutes];
  if (n < 1) return [h, m];
  const after = message.slice((own.index ?? 0) + own[0].length);
  const before = message.slice(0, own.index ?? 0);
  const period = (PERIOD_AFTER.exec(after)?.[1] ?? PERIOD_BEFORE.exec(before)?.[1] ?? "").toLowerCase();
  if (period === "morning") return [n % 12, minutes];
  if (period === "afternoon") return [n <= 6 ? n + 12 : n, minutes];
  // Twelve at night is the midnight that ends today: hour 24 rolls to 00:00 tomorrow.
  if (period) return [n % 12 + 12 + (n === 12 ? 12 : 0), minutes];
  return [n <= 6 ? n + 12 : n, minutes];
}
function dueFor(message: string, time: string | null, now: Date, baseDay?: string, fromPeriod = false): { at: string; day: Date } | { past: string } | { which: string } | undefined {
  const rel = relativeTime(message, now);
  if (rel) return { at: `${ymdOf(rel)}T${hhmmOf(rel)}`, day: rel };
  if (!time) return undefined;
  let [h, m] = fromPeriod ? (time.split(":").map(Number) as [number, number]) : sensibleHour(message, time.split(":").map(Number) as [number, number]);
  // 2026-10-31 gate (cha-phone-call-c): "remind me to call my mom on sunday at 6" was filed for Saturday: the weekday was never read.
  const wd = RECURRING.test(message) ? null : WEEKDAY_ON.exec(message);
  if (wd && !baseDay && !weekdayNextToTime(message, wd)) return { which: wd[2]!.replace(/^./, (c) => c.toUpperCase()) };
  const target = wd ? WEEKDAY_NAMES.findIndex((d) => d.startsWith(wd[2]!.toLowerCase().slice(0, 3))) : -1;
  const ahead = target >= 0 ? ((target - now.getDay() + 7) % 7) || (/^next/i.test(wd![1] ?? "") ? 7 : 0) : 0;
  // A bare clock with no am/pm that already passed this morning is this afternoon ("ill leave at 1:05" at 12:47 is 1:05 PM).
  const meridiem = /\d\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i.test(message) || /\b(?:1[3-9]|2[0-3]):\d{2}\b/.test(message);
  if (!fromPeriod && !meridiem && target < 0 && !baseDay && !meansTomorrow(message, now) && h < 12 && h * 60 + m <= now.getHours() * 60 + now.getMinutes() && (h + 12) * 60 + m > now.getHours() * 60 + now.getMinutes()) h += 12;
  const base = baseDay && !meansTomorrow(message, now) ? new Date(`${baseDay}T00:00`) : new Date(now.getTime() + (meansTomorrow(message, now) ? 86400000 : ahead * 86400000));
  const day = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h ?? 0, m ?? 0);
  if (day.getTime() <= now.getTime()) {
    if (TODAY.test(message)) return { past: `${pad(h)}:${pad(m)}` };
    day.setDate(day.getDate() + (target >= 0 ? 7 : 1));
  }
  return { at: `${ymdOf(day)}T${hhmmOf(day)}`, day };
}

// ---- w19-reminders: wording, snooze and done, offers ---------------------------------------------------------------------------------

/** "to call mom", "about my meds": the label as it follows "I'll remind you …". */
function toLabel(label: string): string {
  const l = label.trim();
  if (/^(about|that|of|for)\b/i.test(l)) return l;
  if (/^(my|the|a|an|our|his|her|this|these|those)\b/i.test(l)) return `about ${l}`;
  return `to ${l.replace(/^to\s+/i, "")}`;
}

/** "at 5:00 PM", "tomorrow at 9:00 AM", "Friday at 5:00 PM" — the reminder's day against now. */
function whenWords(due: Date, now: Date, saidTomorrow = false): string {
  const time = ampm12(hhmmOf(due));
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (ymdOf(due) === ymdOf(now)) return `at ${time}`;
  // He said "tomorrow", so it is said that way; any other day is named ("Friday at 5:00 PM"), never left for him to work out.
  if (saidTomorrow && ymdOf(due) === ymdOf(tomorrow)) return `tomorrow at ${time}`;
  return `${weekdayOf(due)} at ${time}`;
}

const isoOf = (d: Date) => `${ymdOf(d)}T${hhmmOf(d)}`;
const setCall = (step: Record<string, unknown>, reply: string, label: string, at: string): ReminderPlan => ({ kind: "call", action: "alarm_set", args: JSON.stringify({ steps: [step] }), label, at, reply });

const MINUTES = String.raw`(\d{1,3}|an?|one|half an?|a few|a couple|five|ten|fifteen|twenty|thirty)\s*(?:more\s*)?(minutes?|mins?|m|hours?|hrs?|h)\b`;
const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, "a few": 5, "a couple": 2, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const SNOOZE_WORD = /\bsno{1,4}[sz]{1,2}e?d?\b/i;
const BARE_LATER = /^(?:ok(?:ay)?\s+)?(?:later|not now|give me a bit|in a bit|a bit later|gimme a min)$/i;
const AGAIN = /\b(?:remind me again|ping me again|ask me again|nudge me again|again in|remind me later|push it back|push it off)\b/i;
const DONE = /^(?:ok(?:ay)?\s+)?(?:i\s+)?(?:did it|done|done with (?:it|that)|got it|handled it|finished|already did it|already done|i did it|dismiss|mark (?:it |that )?(?:as )?done|thanks got it)$/i;
const BARE_WINDOW_MS = 45 * 60_000;

/** How many minutes he asked to be given: "10 min", "an hour", "half an hour", "like 5". Undefined when he named no length. */
function snoozeMinutes(message: string): number | undefined {
  const m = message.toLowerCase();
  const withUnit = new RegExp(MINUTES, "i").exec(m);
  if (withUnit) {
    const raw = withUnit[1]!.toLowerCase();
    const n = /^half/.test(raw) ? 0.5 : /^\d/.test(raw) ? Number(raw) : (WORD_N[raw] ?? NaN);
    const minutes = /^h/i.test(withUnit[2]!) ? n * 60 : n;
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? Math.round(minutes) : undefined;
  }
  const bare = /\b(?:in|for|by|again in|another|like)\s+(?:like\s+)?(\d{1,3})\b/.exec(m) ?? /\bsnooze\s+(?:it\s+|that\s+)?(?:for\s+)?(\d{1,3})\b/.exec(m);
  return bare ? Number(bare[1]) : undefined;
}

/** "snooze", "done" and their cousins, about the reminder that just went off. Undefined when the message is not about one. */
function answerPlan(message: string, now: Date, stored: StoredReminder[]): ReminderPlan | undefined {
  const m = message.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[!.,…]+/g, " ").replace(/\s+/g, " ").trim();
  if (!m || m.split(" ").length > 9 || /\?/.test(message)) return undefined;
  const target = latestFired(stored as never, now) as StoredReminder | null;
  const recent = !!target && now.getTime() - Math.max(target.firedAt ?? 0, target.snoozedAt ?? 0) <= BARE_WINDOW_MS;
  const explicit = SNOOZE_WORD.test(m) || (AGAIN.test(m) && !/\bto\b/.test(m));
  const bareRelative = new RegExp(`^(?:ok(?:ay)?\\s+)?(?:in|give me|another|about|gimme)?\\s*(?:like\\s+)?${MINUTES}$`, "i").test(m) || /^(?:in|give me|another) (?:like )?\d{1,3}$/.test(m);
  if (explicit || (recent && (BARE_LATER.test(m) || bareRelative))) {
    if (!target) return explicit ? { kind: "say", text: "There's nothing to snooze right now." } : undefined;
    const minutes = snoozeMinutes(m) ?? 10;
    const when = ampm12(hhmmOf(new Date(now.getTime() + minutes * 60_000)));
    return { kind: "call", action: "reminder_snooze", args: JSON.stringify({ steps: [{ action: "reminder_snooze", id: target.id, minutes }] }), reply: `Snoozed. I'll remind you again at ${when}: ${target.label}.` };
  }
  if (recent && DONE.test(m)) {
    return { kind: "call", action: "reminder_done", args: JSON.stringify({ steps: [{ action: "reminder_done", id: target!.id }] }),
      reply: target!.repeat ? `Done for today. It comes back ${describeRepeat(target!.repeat)}.` : `Done, marked off: ${target!.label}.` };
  }
  return undefined;
}

const YES_WORDS = new Set(["yes", "yeah", "yea", "yep", "yup", "sure", "ok", "okay", "please", "pls", "plz", "alright", "aight", "definitely", "absolutely", "sounds", "good", "great", "do", "it", "go", "ahead", "set", "that", "works", "thing", "why", "not", "thanks", "thank", "you", "orion", "of", "course", "lol", "perfect"]);
const AFFIRM = new Set(["yes", "yeah", "yea", "yep", "yup", "sure", "ok", "okay", "please", "pls", "plz", "alright", "aight", "definitely", "absolutely", "sounds", "perfect"]);
/** A short yes, in however he says it ("yeah sure", "yes please", "do it", "sounds good"): at most five words, all of them yes-words. */
const saysYes = (message: string): boolean => {
  const words = message.toLowerCase().replace(/[!.,…]+/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.every((w) => YES_WORDS.has(w)) && (words.some((w) => AFFIRM.has(w)) || /^(?:do it|go ahead|set it)$/.test(words.join(" ")));
};

/** His "yes" to a reminder ORION offered: set exactly what was offered, once. */
async function acceptOffer(message: string, now: Date, offers: OfferPort): Promise<ReminderPlan | undefined> {
  if (!saysYes(message)) return undefined;
  const offer = await offers.pending().catch(() => null);
  if (!offer || now.getTime() - offer.offeredAt > OFFER_WINDOW_MS) return undefined;
  const [y, mo, d, h, mi] = offer.at.split(/[-T:]/).map(Number) as [number, number, number, number, number];
  const due = new Date(y, mo - 1, d, h, mi);
  if (due.getTime() <= now.getTime()) return undefined;
  await offers.clear(offer.key).catch(() => undefined);
  return setCall({ action: "alarm_set", at: offer.at, label: offer.label }, `I'll remind you ${whenWords(due, now, true)} ${toLabel(offer.label)}.`, offer.label, offer.at);
}

/** Something he says he has to do: offer a reminder for it (a few a day, never the same one twice). */
async function offerPlan(message: string, now: Date, offers: OfferPort): Promise<ReminderPlan | undefined> {
  const c = commitmentOf(message, now);
  if (!c) return undefined;
  const key = `chat-${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${c.at.slice(0, 10)}`;
  if (!(await offers.record({ key, label: c.label, at: c.at, offeredAt: now.getTime(), source: "chat" }).catch(() => false))) return undefined;
  return { kind: "say", text: `Want a reminder ${c.when} ${toLabel(c.label)}?` };
}

/** "twelve thirty" style clocks he types without a colon: "530pm" -> "5:30 pm". */
const unclock = (message: string): string => message.replace(/\b(1[0-2]|[1-9])([0-5]\d)\s*(am|pm)\b/gi, "$1:$2 $3");

const WHEN_HOME_TAIL = /[,\s]*(?:when|once|as soon as|after)\s+(?:i|we)\b.*$/i;
const IMPORTANT_TAIL = /[,.\s]*(?:it'?s |this is )?(?:really |very )?important\s*$/i;

/** What to do with a reminder turn, or undefined when it is not one (or the extractor is unavailable). */
export async function planReminder(input: ReminderInput): Promise<ReminderPlan | undefined> {
  const { now, extract, list, last, offers } = input;
  const message = unclock(fixTypos(input.message));
  const stored = await list().catch(() => [] as StoredReminder[]);
  const listed = async () => stored;
  if (isCancel(message)) return cancelPlan(message, now, listed);
  if (LIST.test(message) && !CREATE.test(message)) return listPlan(message, now, listed);
  const answered = answerPlan(message, now, stored);
  if (answered) return answered;
  if (offers) { const yes = await acceptOffer(message, now, offers); if (yes) return yes; }
  const correcting = !!last && isCorrection(message);
  if (!correcting && !isReminderTurn(message)) return offers ? offerPlan(message, now, offers) : undefined;
  const rep = repeatOf(message);
  if (rep && "unsupported" in rep) return { kind: "say", text: "I can only repeat a reminder daily, on weekdays or weekends, or on named days (like every Monday), so nothing was set. Want a one-off for the next one instead?" };
  const got = await extract(message).catch(() => null);
  if (!got) return undefined;
  const important = isImportantAsk(message);
  const label = (correcting && last ? last.label : got.label.trim().replace(WHEN_HOME_TAIL, wantsHome(message) ? "" : "$&").replace(IMPORTANT_TAIL, "")).trim();
  if (!label || VAGUE_LABEL.test(label)) return { kind: "say", text: "What should I remind you about, and when?", pending: true, askLabel: true };
  const flags = important ? { important: true } : {};
  const importantNote = important ? " It's marked important, so it gets through even during focus." : "";

  // When I get home: fires on arrival, with a day-long expiry as the backstop.
  if (!correcting && wantsHome(message)) {
    const expiry = isoOf(new Date(now.getTime() + 86_400_000));
    return setCall({ action: "alarm_set", at: expiry, label, place: "home", ...flags }, `I'll remind you when you get home ${toLabel(label)}.${importantNote}`, label, expiry);
  }

  // The extractor's time counts only when his words state one (or a relative time, which code works out): never a time it invented.
  // With no clock time a part of the day is a default ("tomorrow morning" is 9), said back so he can correct it.
  const stated = STATES_TIME.test(message);
  const period = stated ? undefined : periodTime(message);
  const time = stated ? got.time : period ?? null;

  if (rep && "days" in rep) {
    if (!time) return { kind: "say", text: rep.days.length === 7 ? "What time each day?" : "What time on those days?", pending: true };
    const [h, m] = stated ? sensibleHour(message, time.split(":").map(Number) as [number, number]) : (time.split(":").map(Number) as [number, number]);
    const repeat: Repeat = { days: rep.days, time: `${pad(h % 24)}:${pad(m)}` };
    const first = nextOccurrence(repeat, now);
    if (first === null) return { kind: "say", text: "I couldn't work out when that repeats, so nothing was set." };
    const firstAt = isoOf(new Date(first));
    return setCall({ action: "alarm_set", at: firstAt, label, repeat, ...flags }, `I'll remind you ${describeRepeat(repeat)} ${toLabel(label)}.${importantNote}`, label, firstAt);
  }

  const due = dueFor(message, time, now, correcting && last ? last.at.slice(0, 10) : undefined, !!period);
  if (!due) return { kind: "say", text: correcting ? "What time should I move it to?" : "What time should I remind you?", pending: !correcting };
  if ("which" in due) return { kind: "say", text: `Is that ${due.which} at ${ampm12(STATES_TIME.test(message) && got.time ? got.time : "00:00")}, or today? Say "${due.which.toLowerCase()} at …" or "today at …" and I'll set it. Nothing's set yet.` };
  if ("past" in due) return { kind: "say", text: `It's already past ${ampm12(due.past)} today, so nothing was set. Want it tomorrow instead?` };
  const old = correcting && last ? stored.find((r) => r.label === last.label && r.dueAt > now.getTime()) : undefined;
  const steps = [...(old ? [{ action: "reminder_cancel", id: old.id }] : []), { action: "alarm_set", at: due.at, label, ...flags }];
  const rel = relativeTime(message, now);
  const when = rel ? `in ${describeDuration((rel.getTime() - now.getTime()) / 1000)}, at ${ampm12(due.at.slice(11))},` : whenWords(due.day, now, meansTomorrow(message, now));
  return { kind: "call", action: "alarm_set", args: JSON.stringify({ steps }), label, at: due.at, reply: `${old ? "Moved it. " : ""}I'll remind you ${when} ${toLabel(label)}.${importantNote}` };
}
