/*
 A plain "put X until T" is code's, not the 9B form's (2026-10-19 incident, docs/audits/2026-10-19-cslab-incident.md).

 Tonight "yes, put cs lab until 10:30" (an answer to ORION's own "I could put CS Lab there") and "put CS lab from now until
 ten thirty" were handed to the form. The form picked the lab CLASS (fixed) and the flow gave up, or read 10:30 as the
 morning. Here code reads the whole request itself, from the words and the day, with nothing left to a model:
   - what: the thing he names, or the thing ORION itself offered (a bare yes accepts it)
   - from: now (rounded up to 5 minutes), the only start this reads
   - until: a clock time said without am/pm is the NEXT time that clock shows ("10:30" at 21:55 is 22:30)
   - spelled-out times ("ten thirty") are read as digits first
 Anything that is not this exact shape returns undefined and the form handles it as before.
*/
import type { AskContext, Day } from "./schedule-flow.js";
import { isYes } from "./schedule-pending.js";

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

/** "until ten thirty" → "until 10:30", "at three o'clock" → "at 3:00", "by five" → "by 5". Only after a time word. */
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

const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

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

/** The time he states in the evening that a form would write as the morning: "10:30" at 21:55 is 22:30, but only with no am/pm in his words. */
export function eveningTime(t: string | undefined, nowMinute: number, message: string): string | undefined {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t) || /\b(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i.test(message)) return t;
  const m = toMin(t);
  return m < nowMinute && m + 720 > nowMinute && m + 720 < 1440 && m >= 60 && m < 720 ? hhmm(m + 720) : t;
}

export type DirectAdd = { args: string[]; title: string; minutes: number; at: string; earlier?: { title: string; start: string; end: string } } | { say: "ask" | "cannot"; text: string };

const LEAD = /^(?:(?:yes|yeah|yea|yep|yup|ok(?:ay)?|sure|alright|please|pls|orion|hey|and|so|then|um+|uh+|actually|can you|could you|would you|will you|can u|just|i'?m fine|i'?m ok(?:ay)?)[,.…\s]*)*/i;
const VERB = String.raw`(?:put|add|schedule|book|block(?:\s+(?:off|out))?|set(?:\s+up)?|pencil in|slot in)`;
const TIME = String.raw`\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?`;
const COMMAND = new RegExp(
  String.raw`^${VERB}\s+(?:in\s+|down\s+|me\s+(?:in\s+|down\s+)?(?:for\s+)?)?(?:a\s+|an\s+|some\s+|my\s+|the\s+)?(?<title>.+?)\s+(?:(?:(?:from|starting(?:\s+from|\s+at)?)\s+(?<from>(?:right\s+)?now|${TIME})|for\s+(?:right\s+)?now)\s+)?(?:until|till|til|up to|to)\s+(?<until>${TIME})[\s.!?…]*$`,
  "i",
);
const TITLE_TAIL = /\s+(?:there|in there|right now|now|today|tonight|please)$/i;
const BAD_TITLE = /\b(?:at|from|to|between|after|before|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|and|then)\b|\d/i;
const DEFAULT_MINUTES = 30;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameWordStart = (a: string, b: string) => a === b || (a.length >= 2 && b.startsWith(a));
/** What he calls it, in the casing ORION already uses: "CS" or "cs lab" is the offered "CS Lab" or the lab block already logged. */
function resolveTitle(said: string, day: Day, ask?: AskContext): string {
  const words = norm(said).split(" ").filter(Boolean);
  const known = [ask?.suggest, ...day.blocks.filter((b) => !b.fixed).map((b) => b.title)].filter((t): t is string => !!t);
  const hit = known.find((t) => { const w = norm(t).split(" "); return words.length > 0 && words.every((x) => w.some((y) => sameWordStart(x, y))); });
  return (hit ?? said).replace(/\s+/g, " ").trim().slice(0, 80);
}

const ampm = (m: number): string => { const h = Math.floor(m / 60) % 24; return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** The sentence(s) of his message, newest first: a transcript can open with noise and end on the request. */
const sentences = (text: string): string[] => text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean).reverse();

/**
 * His whole request as one add from now, or what to say instead. undefined = not this shape (the form decides).
 * `day.now` must be set: this is for today only.
 */
/** Whether his words are exactly the "put X until T" shape (no day needed): the only kind of request that may follow a crisis reply. */
export function directAddShape(message: string): boolean {
  const heard = spokenTimesToDigits(message).replace(/\s+/g, " ").trim();
  return sentences(heard).some((s) => {
    const m = s.replace(LEAD, "").trim().match(COMMAND);
    const said = m?.groups?.title?.replace(TITLE_TAIL, "").trim();
    return !!said && !BAD_TITLE.test(said) && said.split(/\s+/).length <= 5;
  });
}

export function parseDirectAdd(message: string, day: Day, ask?: AskContext): DirectAdd | undefined {
  if (!day.now) return undefined;
  const now = toMin(day.now);
  const heard = spokenTimesToDigits(message).replace(/\s+/g, " ").trim();
  let title: string | undefined; let untilText: string | undefined; let fromText: string | undefined;
  for (const s of sentences(heard)) {
    const rest = s.replace(LEAD, "").trim();
    const m = rest.match(COMMAND);
    if (!m?.groups) continue;
    const said = m.groups.title!.replace(TITLE_TAIL, "").trim();
    if (!said || BAD_TITLE.test(said) || said.split(/\s+/).length > 5) continue;
    title = resolveTitle(said, day, ask); untilText = m.groups.until!; fromText = m.groups.from;
    break;
  }
  // "yes" to "…I could put CS Lab there": the offered thing, for the time the ask said was free ("Nothing planned till 10:30").
  if (!title && ask?.suggest && sentences(heard).every((s) => isYes(s.replace(/[.!?…]+$/, "")) || /^(?:okay|ok|yes|yeah|sure)\b[,.\s]*$/i.test(s))) {
    title = ask.suggest; untilText = ask.till;
  }
  if (!title) return undefined;
  let start = Math.ceil(now / 5) * 5;
  // A start he states ("from 9:55 PM to 10:30 PM") is kept, but never in the past: the scheduler refuses a block that has begun.
  if (fromText && !/^(?:right\s+)?now$/i.test(fromText)) {
    const from = clockAfter(fromText, now - 60);
    if (from === null || from >= 1440) return { say: "ask", text: "What time should it start? I haven't changed anything." };
    start = Math.max(start, from);
  }
  let minutes = DEFAULT_MINUTES;
  if (untilText) {
    const until = clockAfter(untilText, start);
    if (until === null) return { say: "ask", text: "What time should it end? I haven't changed anything." };
    if (until >= 1440) return { say: "cannot", text: `${ampm(until)} is past midnight, so I haven't booked it. Tell me an earlier end time.` };
    minutes = until - start;
    if (minutes < 5) return { say: "cannot", text: `${ampm(until)} is too close to now for a block, so I haven't booked it.` };
    if (minutes > 480) return { say: "ask", text: `Until ${ampm(until)} is ${Math.round(minutes / 60)} hours — is that right? I haven't changed anything.` };
  }
  // The same thing already logged or done earlier today is a new session, not a duplicate: `--again` says so to the scheduler.
  const earlier = day.blocks.find((b) => !b.fixed && toMin(b.start) <= now && norm(b.title) === norm(title!));
  return { args: ["add", title, String(minutes), "--at", hhmm(start), ...(earlier ? ["--again"] : [])], title, minutes, at: hhmm(start),
    ...(earlier ? { earlier: { title: earlier.title, start: earlier.start, end: earlier.end } } : {}) };
}

// ---- the worker's restatement is only ever Nick's own request said back (2026-10-19 review) ----
const EXPLICIT_TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])(?!\s*(?:min|hour|hr))/gi;
const TIME_WORD = /\b(?:at|until|till|til|to|from|by|before|after|around|since)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])(?!\s*(?:min|hour|hr))/gi;
const RESTATE_STOP = new Set(["put", "add", "move", "schedule", "book", "calendar", "calendars", "today", "todays", "tonight", "will", "from", "until", "till", "the", "and", "for", "going", "block", "your", "then", "now", "minutes", "set", "plan", "ill", "that", "this", "with", "into", "onto", "have", "make", "made", "done"]);
const wordsOf = (t: string): string[] => (t.toLowerCase().replace(/[’']/g, "").match(/[a-z]{3,}/g) ?? []).filter((w) => !RESTATE_STOP.has(w) && w !== "pm" && w !== "am");

/** Minutes mod 12 hours for each clock a sentence states (colon or am/pm only; `loose` also takes a bare hour after a time word). */
function clocksIn(text: string, loose: boolean): number[] {
  const out: number[] = [];
  const take = (m: RegExpMatchArray) => { const h = Number(m[1]); const min = Number(m[2] ?? 0); if (h <= 24 && min <= 59) out.push(((h % 12) * 60 + min) % 720); };
  for (const m of text.matchAll(EXPLICIT_TIME)) if (m[2] !== undefined || m[3]) take(m);
  if (loose) for (const m of text.matchAll(TIME_WORD)) take(m);
  return out;
}

/**
 * Whether the worker's restated change is only what Nick himself asked: it states at least one time, every time it states is one he said
 * (after spoken times are digits; am/pm is not compared, and a start within 10 minutes of now counts when he said "now"), and it shares a
 * title word with his message. Anything else is the worker's own invention and is never run.
 */
export function restatementIsHis(restated: string, said: string, nowMinute: number): boolean {
  const his = spokenTimesToDigits(said);
  const theirs = clocksIn(restated, false);
  if (!theirs.length) return false;
  const mine = clocksIn(his, true);
  const saysNow = /\b(?:right\s+)?now\b/i.test(his);
  const near = (c: number) => saysNow && [0, 720].some((add) => Math.abs((c + add) - nowMinute) <= 10 || Math.abs((c + add) - (nowMinute % 1440)) <= 10);
  if (!theirs.every((c) => mine.includes(c) || near(c))) return false;
  const hisWords = new Set(wordsOf(his));
  return wordsOf(restated).some((w) => hisWords.has(w) || [...hisWords].some((h) => h.startsWith(w) || w.startsWith(h)));
}
