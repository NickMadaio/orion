/*
 Clock and length rules for code-run calendar changes (calendar-intent.ts, intent-run.ts). One place, so every reader gets the same answer:

   - spelled-out times are digits first ("until ten thirty" -> "until 10:30"), only after a time word;
   - "at 5" for something he does while awake is 17:00 (1-6 with no am/pm are the afternoon or evening);
   - an evening "until 10:30" is 22:30; a time with am/pm, or a 24-hour time, is exactly that;
   - a time that has already passed TODAY is said to have passed. It is never rolled over to tomorrow morning
     (2026-10-20 re-run: "until ten thirty" at 22:42 became "10:30 AM is past midnight");
   - 7-11 tomorrow with no am/pm and no morning/evening word is asked about, never guessed;
   - an END at "12 am", "00:00" or "midnight" is the end of TODAY (24:00, minute 1440): never a booking across midnight
     (2026-10-25: "marketing presentation until 12 am" became `move … --to 24:00`, which failed).
*/

const HOUR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const HOURS = Object.keys(HOUR_WORDS).join("|");
const UNITS = "one|two|three|four|five|six|seven|eight|nine";
const TENS: Record<string, number> = { ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, fifteen: 15 };
// Only after a time word, so "I'll take ten thirty of them" is left alone.
const TIME_LEAD = String.raw`(?<lead>\b(?:at|until|till|til|to|from|by|before|after|around|since)\s+)`;
const SPOKEN_TIME = new RegExp(
  String.raw`${TIME_LEAD}(?<h>${HOURS})(?:\s+(?:(?<oclock>o['’]?clock)|(?:oh|zero)\s+(?<oh>${UNITS})|(?<fortyfive>forty[\s-]?five)|(?<tens>fifteen|twenty|thirty|forty|fifty|ten)(?:[\s-](?<unit>${UNITS}))?))?(?![\w:])`,
  "gi",
);

/** "until ten thirty" -> "until 10:30", "at three o'clock" -> "at 3:00", "by five" -> "by 5". Only after a time word. */
export function spokenTimesToDigits(message: string): string {
  return message.replace(SPOKEN_TIME, (...args) => {
    const g = args[args.length - 1] as Record<string, string | undefined>;
    const hour = HOUR_WORDS[g.h!.toLowerCase()]!;
    let minutes: number | undefined;
    if (g.oclock) minutes = 0;
    else if (g.oh) minutes = HOUR_WORDS[g.oh.toLowerCase()]!;
    else if (g.fortyfive) minutes = 45;
    else if (g.tens) minutes = (TENS[g.tens.toLowerCase()] ?? 0) + (g.unit ? HOUR_WORDS[g.unit.toLowerCase()]! : 0);
    return `${g.lead}${minutes === undefined ? hour : `${hour}:${String(minutes).padStart(2, "0")}`}`;
  });
}

export const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export const hhmm = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const ceil5 = (n: number): number => Math.ceil(n / 5) * 5;
/** 22:30 -> "10:30 PM". */
export const ampm = (m: number): string => { const h = Math.floor(m / 60) % 24; return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** 20:15-21:45 -> "8:15–9:45 PM". */
export const span = (a: number, b: number): string => { const [x, y] = [ampm(a), ampm(b)]; return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`; };

/**
 * A clock he said, as minutes since midnight (may pass 1440 for "after midnight"). With am/pm or a 24-hour hour it is
 * exact; with neither it is the first time that clock shows strictly after `after` ("10:30" at 21:55 is 22:30, at 09:00 is 10:30).
 */
export function clockAfter(text: string, after: number): number | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2] ?? 0); const ap = m[3]?.[0];
  if (min > 59 || h > 24) return null;
  if (ap) return h < 1 || h > 12 ? null : (h % 12) * 60 + (ap === "p" ? 720 : 0) + min;
  if (h > 12 || m[1]!.length === 2 && m[1]!.startsWith("0")) return h * 60 + min;   // 13:00-24:00 and "09:00" are said as 24-hour
  const base = (h % 12) * 60 + min;
  return [base, base + 720, base + 1440].find((c) => c > after) ?? null;
}

/** A clock as he said it: "5", "5pm", "10:30", "17:00", "noon". */
export type Said = { h: number; m: number; ap?: "a" | "p"; exact: boolean };
export const CLOCK = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midday|midnight)`;
export function parseClock(text: string): Said | null {
  const t = text.trim().toLowerCase();
  if (t === "noon" || t === "midday") return { h: 12, m: 0, ap: "p", exact: true };
  if (t === "midnight") return { h: 12, m: 0, ap: "a", exact: true };   // the same clock as "12 am": as an end, the end of today
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2] ?? 0); const ap = m[3]?.[0] as "a" | "p" | undefined;
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  const exact = !!ap || h > 12 || h === 0 || (m[1]!.length === 2 && m[1]!.startsWith("0"));
  return { h, m: min, ...(ap ? { ap } : {}), exact };
}
const exactMinute = (s: Said): number => (s.ap ? (s.h % 12) * 60 + (s.ap === "p" ? 720 : 0) + s.m : s.h * 60 + s.m);

export type DayWord = "today" | "tomorrow";
/** The end of today: a block "until midnight" ends at 24:00 (the scheduler takes `24:00` as an end, never as a start). */
export const MIDNIGHT_END = 1440;
/** part: "morning" / "evening" when he said so ("tomorrow morning", "tonight"). */
export type ClockContext = { day: DayWord; now: number | null; part?: "morning" | "evening" };
export type Resolved = { at: number } | { passed: number } | { ambiguous: [number, number] };

/** When something he wants to START at that clock starts. */
export function resolveStart(said: Said, ctx: ClockContext): Resolved {
  const today = ctx.day === "today" && ctx.now !== null;
  const passed = (min: number): Resolved => (today && min <= ctx.now! ? { passed: min } : { at: min });
  if (said.exact) return passed(exactMinute(said));
  if (said.h === 12) return passed(720 + said.m);
  const am = said.h * 60 + said.m; const pm = am + 720;
  if (ctx.part === "morning") return passed(am);                     // "tomorrow morning at 6" is 6 AM
  // Still up before 5 AM: "a walk at 5" at 2 AM is 5 AM, not tomorrow afternoon; a small hour further off is asked about.
  if (today && ctx.now! < 5 * 60 && ctx.part !== "evening" && am > ctx.now!) {
    if (am - ctx.now! <= 180) return { at: am };
    if (said.h <= 6) return { ambiguous: [am, pm] };
  }
  if (ctx.part === "evening" || said.h <= 6) return passed(pm);   // "at 5" while awake is 5 PM
  if (!today) return { ambiguous: [am, pm] };
  const ahead = [am, pm].filter((c) => c > ctx.now!);
  return ahead.length ? { at: ahead[0]! } : { passed: pm };
}

/** When something that starts at `start` ENDS at that clock: the first time it shows after the start, the same day. */
export type EndResolved = Resolved | { before: number } | { pastMidnight: number };
export function resolveEnd(said: Said, start: number, ctx: ClockContext): EndResolved {
  const today = ctx.day === "today" && ctx.now !== null;
  if (said.exact || said.h === 12) {
    const min = said.exact ? exactMinute(said) : 720 + said.m;
    // "until 12 am" / "till midnight": the end of today, whatever the start.
    if (said.exact && min === 0 && start < 1440) return { at: MIDNIGHT_END };
    // A bare "till 12" from the afternoon on is midnight ("marketing at home till 12" at 18:45), never "12 PM has passed".
    // Only once noon (or 12:xx) is already behind the start: "essay till 12:45" at 12:10 is 12:45 PM (review of this fix).
    if (!said.exact && start >= 720 + said.m) return said.m === 0 ? { at: MIDNIGHT_END } : { pastMidnight: 1440 + said.m };
    // "from now until 2am" at 23:00 is 2 AM tonight, after midnight: not "2:00 AM has already passed".
    if (min < start && start >= 18 * 60 && min < 6 * 60) return { pastMidnight: min + 1440 };
    if (today && min <= ctx.now!) return { passed: min };
    return min > start ? { at: min } : { before: min };
  }
  const am = said.h * 60 + said.m; const pm = am + 720;
  const hit = [am, pm].find((c) => c > start);
  if (hit !== undefined) return { at: hit };
  // "until 1" at 23:30 is one in the morning: past midnight, never "1 PM has passed".
  if (start >= 18 * 60 && said.h <= 6) return { pastMidnight: am + 1440 };
  return today && pm <= ctx.now! ? { passed: pm } : { before: pm };
}

// ---- lengths: "45 min", "an hour", "for 90 minutes", "an hour and a half", "1.5 hours" ----
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5 };
export const LENGTH = /\b(?:for\s+)?(?:(?<half>half an? hour)|(?<hh>an? hour and a half|one and a half hours?)|(?<n>\d{1,3}(?:\.\d)?|an?|one|two|three|four)[\s-]*(?<unit>minutes?|mins?|m|hours?|hrs?|h)\b)/i;
/** The length a phrase gives, and the phrase with it taken out. */
export function takeLength(text: string): { minutes?: number; rest: string } {
  const m = text.match(LENGTH);
  if (!m?.groups) return { rest: text };
  const g = m.groups;
  let minutes: number;
  if (g.half) minutes = 30;
  else if (g.hh) minutes = 90;
  else {
    const n = /\d/.test(g.n!) ? Number(g.n) : NUM[g.n!.toLowerCase()] ?? NaN;
    minutes = /^h/i.test(g.unit!) ? Math.round(n * 60) : Math.round(n);
  }
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) return { rest: text };
  return { minutes, rest: `${text.slice(0, m.index)} ${text.slice(m.index! + m[0].length)}`.replace(/\s+/g, " ").trim() };
}
