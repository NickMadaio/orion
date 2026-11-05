/*
 Reading what Nick says about ONE morning's alarm (W18 wake, 2026-11-04). Pure; alarm-flow.ts acts on it.

 He wants ORION to change what time he wakes up, including the phone's alarm, with no asking:
   "wake me up at 7 tomorrow"      → set 07:00 tomorrow      "move my alarm to 6:45"  → set 06:45 (the next one)
   "no alarm saturday"             → off Saturday            "what time is my alarm"  → read
   "push it back 20 min"           → the next alarm 20 min later ("it" needs an alarm in play: said just before, or night)
 A standing time ("every weekday", "from now on") is the sleep plan's (readHabit), a reminder or a timer is neither.
 A wake time is a morning time: 3 AM to noon. "alarm for 3pm" is not a wake-up.
*/
import { clean } from "./sleep-plan-slots.js";
import { numeralizeTimes } from "./alarm-words.js";

export type AlarmDay = "today" | "tomorrow" | string;   // or a weekday: mon..sun
export type AlarmReq =
  | { kind: "set"; time: string; day?: AlarmDay }
  | { kind: "off"; day?: AlarmDay; days?: string[] }     // days: a standing "no alarm on weekends"
  | { kind: "shift"; minutes: number }                  // + later, - earlier
  | { kind: "read" };

const pad = (n: number): string => String(n).padStart(2, "0");
const ALARM = /\b(?:alarms?|wake[- ]?up|wake ?time|waking up|wake me|get me up)\b/;
const REMINDER = /\b(?:remind(?:er)?s?|ping me|nudge me|timer|stopwatch|countdown)\b|\balarm\b.{0,12}\bin\s+\d+\s*(?:min|mins|minutes|hours?|hrs?)\b/;
const REPEATS = /\b(?:every|each|daily|weekdays?|weekends?|from now on|always|all week|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/;
const DAY_NAMES: Array<[RegExp, string]> = [[/\bmon(?:day)?\b/, "mon"], [/\btue(?:s|sday)?\b/, "tue"], [/\bwed(?:s|nesday)?\b/, "wed"], [/\bthu(?:r|rs|rsday|rsd)?(?:sday)?\b/, "thu"],
  [/\bfri(?:day)?\b/, "fri"], [/\bsat(?:urday)?\b/, "sat"], [/\bsun(?:day)?\b/, "sun"]];
const PLURAL_DAYS = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\b|\bweekends?\b|\bweekdays?\b/;

/** "tomorrow", "today", a weekday, or undefined. "tonight" is the coming morning, so tomorrow. */
function dayOf(m: string): AlarmDay | undefined {
  if (/\b(?:tomorrow|tmrw|tmr|tomorow|tmw|tonight|tn)\b/.test(m)) return "tomorrow";
  if (/\btoday\b|\bthis morning\b/.test(m)) return "today";
  for (const [re, d] of DAY_NAMES) if (re.test(m)) return d;
  return undefined;
}

/** HH:MM from "6:45", "645", "7am", "at 7", "0645". 3 AM to noon only; undefined otherwise. */
export function morningTime(m: string): string | undefined {
  const t = m.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?![a-z0-9])/)
    ?? m.match(/\b(\d{1,2})()\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/)
    ?? m.match(/\b(?:to|for|at|by|around|till|until)\s+(\d{1,2})(\d{2})()(?![\d:]|\s*(?:min|mins|minutes|hours?|hrs?|h)\b)/)
    ?? m.match(/\b(?:to|for|at|by|around|till|until)\s+(\d{1,2})()()(?![\d:]|\s*(?:min|mins|minutes|hours?|hrs?|h|%)\b)/);
  if (!t) return undefined;
  const h = Number(t[1]); const min = Number(t[2] || 0); const mer = t[3];
  if (min > 59 || h > 23) return undefined;
  if (mer) { if (h < 1 || h > 12) return undefined; const hour = (h % 12) + (/^p/.test(mer) ? 12 : 0); return hour >= 3 && hour <= 12 ? `${pad(hour)}:${pad(min)}` : undefined; }
  return h >= 3 && h <= 12 ? `${pad(h)}:${pad(min)}` : undefined;
}

const NUMWORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const AMT = String.raw`(\d+|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|half an?|couple(?: of)?|few)\s*(?:and a half\s*)?(h|hrs?|hours?|m|mins?|minutes?)?\b`;
const SHIFT_BACK = String.raw`(?:back|later|out|further|off)`;
const SHIFT_UP = String.raw`(?:up|forward|earlier|ahead|sooner)`;

/** Minutes in "20 min", "half an hour", "an hour", "1h", "hour and a half"; undefined when none. */
export function minutesIn(m: string): number | undefined {
  if (/\bhalf an? hour\b|\bhalf hour\b/.test(m)) return 30;
  if (/\bhour and a half\b|\b1\.5 ?h/.test(m)) return 90;
  // Fractions of an hour (w20 r5, gate 3 #62: "another quarter of an hour" was read as "an hour").
  if (/\b(?:an? )?hour and a quarter\b/.test(m)) return 75;
  if (/\bthree quarters?\b|\b3\/4 (?:of )?an? hour\b/.test(m)) return 45;
  if (/\b(?:a |an |another )?quarter(?: of)?(?: an?)?(?: hour)?\b/.test(m) && !/\bquarter (?:to|past|after)\b/.test(m)) return 15;
  const a = m.replace(/\banother\s+(?=\d)/g, "").replace(/\banother\b/g, "an").replace(/\ba (couple|few)\b/g, "$1").match(new RegExp(AMT));
  if (!a) return undefined;
  const raw = a[1]!;
  const n = /^couple/.test(raw) ? 2 : raw === "few" ? 3 : /^half/.test(raw) ? 0.5 : NUMWORD[raw] ?? Number(raw);
  const unit = a[2] ?? "";
  const minutes = /^h/.test(unit) ? n * 60 : /^m/.test(unit) ? n : n >= 5 ? n : undefined;   // a bare number is minutes only when it is plausibly so
  return minutes !== undefined && minutes >= 5 && minutes <= 360 ? Math.round(minutes) : undefined;
}

export type AlarmCtx = { recentAlarm?: boolean; hour?: number };
const NIGHTLY = (hour?: number): boolean => hour !== undefined && (hour >= 22 || hour < 11);

function readShift(m: string, named: boolean, ctx: AlarmCtx): AlarmReq | undefined {
  const verb = String.raw`(?:push|pushing|move|moving|bump|slide|delay|put|shift|bring|pull|make)`;
  const obj = String.raw`(?:it|that|the alarm|my alarm|alarm|my wake ?up|wake ?up|my wake time|wake time|my alarm clock)`;
  const back = new RegExp(String.raw`\b${verb}\s+${obj}\s+${SHIFT_BACK}\b`).test(m) || new RegExp(String.raw`\b(?:delay|snooze)\s+${obj}\b`).test(m)
    || new RegExp(String.raw`\b${verb}\s+${obj}\s+(?:by\s+)?(?:${AMT})\s*(?:later)\b`).test(m);
  const up = new RegExp(String.raw`\b${verb}\s+${obj}\s+${SHIFT_UP}\b`).test(m) || new RegExp(String.raw`\b${verb}\s+${obj}\s+(?:by\s+)?(?:${AMT})\s*(?:earlier|sooner)\b`).test(m);
  if (!back && !up) return undefined;
  if (back && up) return undefined;
  if (!named && !ctx.recentAlarm && !NIGHTLY(ctx.hour)) return undefined;
  const minutes = minutesIn(m);
  if (minutes === undefined) return undefined;
  return { kind: "shift", minutes: up ? -minutes : minutes };
}

/** What he asked of his alarm, or undefined when it is not about it. */
export function readAlarm(message: string, ctx: AlarmCtx = {}): AlarmReq | undefined {
  const m = numeralizeTimes(clean(message)).replace(/[.!]+$/, "");
  if (!m || m.length > 160 || REMINDER.test(m)) return undefined;
  const named = ALARM.test(m);
  const shift = readShift(m, named, ctx);
  if (shift) return shift;
  if (!named && !(ctx.recentAlarm && /^(?:make|move|change|set|put)\s+(?:it|that)\b/.test(m))) return undefined;
  const day = dayOf(m);
  // off: "no alarm saturday", "skip my alarm tmrw", "dont wake me up sunday", "cancel the alarm"
  const off = /\bno (?:wake[- ]?up )?alarms?\b|\b(?:skip|cancel|kill|delete|remove|drop|clear|disable|without)\b.{0,16}\balarms?\b|\bturn(?:ing)? (?:off|the)\b.{0,14}\balarms?\b|\balarms?\b.{0,10}\boff\b|\b(?:don'?t|dont|do not) (?:need|want)\b.{0,12}\balarms?\b|\b(?:don'?t|dont|do not) wake me\b|\bno wake[- ]?up\b/.test(m);
  if (off && !morningTime(m)) {
    if (PLURAL_DAYS.test(m) || /\bevery\b/.test(m)) return { kind: "off", days: standingDays(m) };
    return { kind: "off", ...(day ? { day } : {}) };
  }
  if (REPEATS.test(m)) return undefined;
  const time = morningTime(m);
  const question = /\?\s*$/.test(message.trim()) || /^(?:what|whats|what's|when|which|how|is|do|does|am|are|should|will|whens)\b/.test(m);
  // A request can follow a sentence of its own ("try and scratch that. can you push my wake time to six thirty?").
  const askForm = /(?:^|[.!?]\s+)(?:(?:alright|ok|okay|so|well|actually|no|wait|orion)[,\s]+)*(?:(?:can|could|would|will|pls|please)\b|hey\b|yo\b|ok\b|orion\b)/.test(m) && /\b(?:set|move|change|make|put|wake|push)\b/.test(m);
  if (time && (!question || askForm)) return { kind: "set", time, ...(day ? { day } : {}) };
  if (question && named && (!time || /\b(?:is|set|at)\b/.test(m))) {
    if (/\b(?:what|whats|what's|when|whens|which|is|do|show|tell|check|any|how many)\b/.test(m) && !/\b(?:should|could|would i)\b/.test(m)) return { kind: "read" };
  }
  if (!question && /\b(?:show|tell|check|list|see)\b.{0,16}\b(?:alarms?|wake)/.test(m)) return { kind: "read" };
  return undefined;
}

/** "weekends" → sat,sun; "every saturday", "saturdays" → sat; undefined days → none (the caller asks). */
function standingDays(m: string): string[] {
  if (/\bweekends?\b/.test(m)) return ["sat", "sun"];
  if (/\bweekdays?\b/.test(m)) return ["mon", "tue", "wed", "thu", "fri"];
  return DAY_NAMES.filter(([re]) => re.test(m.replace(/days\b/g, "day"))).map(([, d]) => d);
}
