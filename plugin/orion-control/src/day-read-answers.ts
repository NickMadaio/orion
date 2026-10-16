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

type Kind = { label: string; asked: string; title: RegExp };
// "class" is any lecture-like title or a course code, the same words live-day.mjs classify uses for a class.
// r8 review (2026-10-16) M1: a title counts as the kind with classify()'s words for it (gym: gym|workout|lift|run, study:
// study|revise|revision|homework|problem set|reading) plus the plain synonyms (swim, climb, deep work); a test pins
// that every title classify() calls gym or study matches here, so the two lists cannot drift apart.
const KINDS: Kind[] = [
  { label: "nap", asked: "nap", title: /\bnap(s|ping)?\b/i },
  { label: "gym", asked: "gym|workout|yoga|pilates|spin|leg day", title: /\b(gym|workout|lift(ing)?|run(ning)?|jog(ging)?|swim(ming)?|climb(ing)?|cardio|yoga|pilates|spin(ning)?|leg day)\b/i },
  { label: "lab", asked: "labs?", title: /\blabs?\b/i },
  { label: "meal prep", asked: "meal[\\s-]*prep", title: /\bmeal[\s-]*prep\b/i },
  { label: "lunch", asked: "lunch", title: /\blunch\b/i },
  { label: "dinner", asked: "dinner", title: /\bdinner\b/i },
  { label: "breakfast", asked: "breakfast", title: /\bbreakfast\b/i },
  { label: "study", asked: "study|studying|hw|homework", title: /\b(study|studying|revis\w*|hw|homework|problem set|reading|deep work)\b/i },
];
// "my nap block", "the lab", "a lab day", "nap time": the kind is named as a block of his day, not mentioned in passing ("the gym closes").
const namedAs = (k: Kind): RegExp => new RegExp(`\\b(?:my|the|a|an)\\s+(?:\\w+\\s+)?(?:${k.asked})\\b|\\b(?:${k.asked})\\s+(?:block|session|day)\\b`, "i");
// "do i have time for a nap", "can i fit a workout in": a question about whether it would fit, not whether it is scheduled.
const FITTING = /\b(?:time for|room for|squeeze|fit)\b/i;

const BLOCK = /^B\d+ (\d{2}):(\d{2})–(\d{2}):(\d{2}) (.*?)(?: \(FIXED\))?(?: \(already happened\))?$/;
type Row = { hour: number; minute: number; endHour: number; endMinute: number; title: string; over: boolean };
function rows(day: string): Row[] {
  return day.split("\n").flatMap((line) => {
    const m = BLOCK.exec(line.trim());
    return m ? [{ hour: Number(m[1]), minute: Number(m[2]), endHour: Number(m[3]), endMinute: Number(m[4]), title: m[5]!, over: /\(already happened\)\s*$/.test(line.trim()) }] : [];
  });
}

export const spokenTime = (hour: number, minute: number): string => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
// "MKTG2201 Introduction to Marketing — Lecture" is said without its trailing "— Lecture".
const spokenTitle = (t: string): string => t.replace(/\s+—\s+Lecture$/i, "");
const joinList = (xs: string[]): string => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);

// A question about when something is on his calendar, not advice about it ("how long should my naps be").
const ABOUT_TIME = /\b(when|what time|how (?:long|much time|many minutes|soon)|until|till|before|after|ends?|starts?|next|is today|is there|do i have|have a)\b/i;
// "when does the gym close today": about the place's hours, not his calendar (r8 review 2 M3).
const HOURS = /\b(?:open|opens|opening|close|closes|closed|closing|hours)\b/i;
const ADVICE = /\b(should|supposed to|recommend\w*|ideal|healthy|best)\b/i;

/** The reply when the question names a kind of block and none is on the day; null when one is, or none is named. */
// review 5 H3 (2026-10-16): "the lab report is due", "my lab partner meeting", "the lab manual reading" name a thing, not the block.
const KIND_NOUN = "report|reports|partner|partners|manual|grade|grades|quiz|quizzes|exam|exams|notes|assignment|assignments|homework|membership|bag|menu|money|special|handout|worksheet|results|syllabus|instructor|professor|ta|fee|fees";
const DEADLINE_TALK = /\b(?:due|deadline|deadlines|grade|grades|graded)\b/i;
const kindThenNoun = (k: Kind, message: string): boolean => new RegExp(`\\b(?:${k.asked})(?:s)?\\s+(?:${KIND_NOUN})\\b`, "i").test(message);
const namedKind = (message: string): Kind | undefined => {
  if (!ABOUT_TIME.test(message) || ADVICE.test(message) || FITTING.test(message) || HOURS.test(message) || DEADLINE_TALK.test(message)) return undefined;
  const k = KINDS.find((x) => namedAs(x).test(message));
  return k && !kindThenNoun(k, message) ? k : undefined;
};
const isKind = (kind: Kind, r: Row): boolean => kind.title.test(r.title) || new RegExp(`\\b(?:${kind.asked})`, "i").test(r.title);

export function noBlockReply(message: string, day: string, tomorrow: boolean): string | null {
  const kind = namedKind(message);
  const all = rows(day);
  if (!kind || !all.length && !day.trim()) return null;
  // M3: the asked word anywhere in a title ("CHEM1211 Labs", "Meal-prep") is the block, whatever its synonym list says.
  const word = new RegExp(`\\b(?:${kind.asked})`, "i");
  if (all.some((r) => kind.title.test(r.title) || word.test(r.title))) return null;
  const when = tomorrow ? "tomorrow" : "today";
  const head = `There's no ${kind.label} block on your calendar ${when}.`;
  const left = all.filter((r) => !r.over);
  if (!all.length) return head;
  if (!left.length) return `${head} Everything on it has already happened.`;
  return `${head} You have ${joinList(left.map((r) => `${spokenTitle(r.title)} at ${spokenTime(r.hour, r.minute)}`))}.`;
}

// ---- r8b2 (2026-10-16): a named block that IS on the day is answered by code too ----
// q009 "how many minutes until the lab starts" → the 9B said "8:10 PM, about 9 hours away" (the lab is 7:25 PM, 8 h 17 min);
// q013 "is today a lab day or nah" → "Yes … 8:15 PM to 9:10 PM" (wrong); q006 "and after that?" → "3:45 PM" (ECON1115 is 3:30 PM).
const minutesOf = (h: number, m: number): number => h * 60 + m;
const range = (r: Row): string => {
  const a = spokenTime(r.hour, r.minute);
  const b = spokenTime(r.endHour, r.endMinute);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
};
/** "in about 8 h 17 min" / "in about 25 min" / "in about 2 h". */
export function spokenSpan(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${m} min`;
}
const WANTS_SPAN = /\b(?:how (?:long|many minutes|much time|soon)|minutes?\b.*\b(?:until|till|before|to)|(?:until|till)\b)/i;
const WANTS_END = /\b(?:ends?|over|finish\w*|done)\b/i;
// review 5 M6 (2026-10-16): "how long is my lab" asks the length, "what time does my lab go until" asks the end, never the start.
const ENDS_UNTIL = /\b(?:go|goes|going|run|runs|last|lasts)\s+(?:until|till)\b|\b(?:until|till)\s*\??\s*$/i;
const WANTS_LENGTH = /\bhow long (?:is|are|does|will|do)\b/i;
const MENTIONS_START = /\b(?:starts?|begin\w*|until|till|before)\b/i;
const IS_DAY = /\bis (?:today|tomorrow|there)\b|\bdo i have\b|\bhave a\b/i;

/** The reply when the question names a kind of block that IS on the day (start, end, time left); null otherwise. */
export function presentBlockReply(message: string, day: string, tomorrow: boolean, nowMin: number): { text: string; memory: DayMemory } | null {
  const kind = namedKind(message);
  if (!kind) return null;
  const all = rows(day);
  const hits = all.filter((r) => isKind(kind, r));
  if (!hits.length) return null;
  const reply = (text: string, r: Row) => ({ text, memory: memoryOf(r, tomorrow, false) });
  const say = (r: Row) => `${spokenTitle(r.title)}, ${range(r)}`;
  if (IS_DAY.test(message) && !WANTS_SPAN.test(message) && !/\bwhen|what time\b/i.test(message)) return reply(hits.length === 1 ? `Yes — ${say(hits[0]!)}.` : `Yes — ${joinList(hits.map(say))}.`, hits[hits.length - 1]!);
  const startOf = (r: Row) => minutesOf(r.hour, r.minute);
  const endOf = (r: Row) => minutesOf(r.endHour, r.endMinute);
  const when = tomorrow ? " tomorrow" : "";
  const upcoming = tomorrow ? hits : hits.filter((r) => endOf(r) > nowMin);
  if (!upcoming.length) return reply(`Your ${hits.length === 1 ? spokenTitle(hits[0]!.title) : kind.label} already ended today.`, hits[hits.length - 1]!);
  const next = upcoming[0]!;
  const name = spokenTitle(next.title);
  const length = WANTS_LENGTH.test(message) && !MENTIONS_START.test(message);
  const endsUntil = ENDS_UNTIL.test(message) && !/\bstart/i.test(message);
  const span = WANTS_SPAN.test(message) && !tomorrow && !length && !endsUntil;
  const rest = upcoming.length > 1 ? ` After that: ${joinList(upcoming.slice(1).map((r) => `${spokenTitle(r.title)} at ${spokenTime(r.hour, r.minute)}`))}.` : "";
  if (!tomorrow && startOf(next) <= nowMin) return reply(`Your ${name} is on now, until ${spokenTime(next.endHour, next.endMinute)}${span ? `, ${spokenSpan(endOf(next) - nowMin)} left` : ""}.${rest}`, next);
  if (length) return reply(`Your ${name} is ${spokenSpan(endOf(next) - startOf(next))} long, ${range(next)}${when}.${rest}`, next);
  if (endsUntil) return reply(`Your ${name} ends at ${spokenTime(next.endHour, next.endMinute)}${when}.${rest}`, next);
  if (span && WANTS_END.test(message)) return reply(`Your ${name} ends at ${spokenTime(next.endHour, next.endMinute)}${when}.${rest}`, next);
  if (span) return reply(`Your ${name} starts at ${spokenTime(next.hour, next.minute)}, in about ${spokenSpan(startOf(next) - nowMin)}.${rest}`, next);
  return reply(`Your ${name} starts at ${spokenTime(next.hour, next.minute)}${when} and ends at ${spokenTime(next.endHour, next.endMinute)}.${rest}`, next);
}

// "next class" and the follow-up "and after that?": a class is a course code or a lecture-like title.
const CLASS_TITLE = /\b[A-Z]{2,5}\s?\d{3,4}\b|\b(?:lecture|class|seminar|recitation)\b/i;
const NEXT_CLASS = /\b(?:next|upcoming)\s+class(?:es)?\b|\bwhen(?:'s| is)?\s+my\s+(?:first|next)\s+class\b/i;
const AFTER_THAT = /^\W*(?:and\s+|so\s+|ok(?:ay)?\s+)?(?:then\s+)?(?:what(?:'s|s| is)?\s+)?(?:(?:what|how)\s+about\s+)?(?:after\s+(?:that|this|it)|then|the\s+one\s+after(?:\s+that)?)(?:\s+one)?\W*$/i;
/** Short memory of the block the last day answer named, per session: what "and after that?" means. */
// review 5 H2 (2026-10-16): the day it was about plus the block's start minute and title (not a row index: an edit between
// turns shifts indices, and "tomorrow" would be re-read as today).
export type DayMemory = { tomorrow: boolean; startMinute: number; title: string; classOnly: boolean };
const memoryOf = (r: Row, tomorrow: boolean, classOnly: boolean): DayMemory => ({ tomorrow, startMinute: minutesOf(r.hour, r.minute), title: r.title, classOnly });
const END_OF_DAY = 24 * 60;

export const isNextClassQuestion = (message: string): boolean => NEXT_CLASS.test(message);
export const isAfterThat = (message: string): boolean => AFTER_THAT.test(message.trim());

/** "next class" / "and after that?" from the day read. `memory` is what the last answer named (after-that only). */
export function nextBlockReply(message: string, day: string, tomorrow: boolean, nowMin: number, memory?: DayMemory): { text: string; memory: DayMemory } | null {
  const all = rows(day);
  if (isAfterThat(message)) {
    if (!memory) return null;
    tomorrow = memory.tomorrow; // the follow-up is about the day the last answer was about
    const when = tomorrow ? " tomorrow" : " today";
    const after = all.find((r) => minutesOf(r.hour, r.minute) > memory.startMinute && (!memory.classOnly || CLASS_TITLE.test(r.title)));
    if (!after) return { text: `Nothing after that${when}.`, memory };
    return { text: `After that: ${spokenTitle(after.title)} at ${spokenTime(after.hour, after.minute)}.`, memory: memoryOf(after, tomorrow, memory.classOnly) };
  }
  if (!isNextClassQuestion(message)) return null;
  const next = all.find((r) => CLASS_TITLE.test(r.title) && (tomorrow || minutesOf(r.hour, r.minute) > nowMin));
  if (!next) return { text: `You have no more classes ${tomorrow ? "tomorrow" : "today"}.`, memory: { tomorrow, startMinute: END_OF_DAY, title: "", classOnly: true } };
  const span = !tomorrow && WANTS_SPAN.test(message);
  const text = `Your next class is ${spokenTitle(next.title)} at ${spokenTime(next.hour, next.minute)}${span ? `, in about ${spokenSpan(minutesOf(next.hour, next.minute) - nowMin)}` : ""}.`;
  return { text, memory: memoryOf(next, tomorrow, true) };
}

/** Everything above in one call: the next-class / after-that answers, then a named block that is present. */
export function codeDayAnswer(message: string, day: string, tomorrow: boolean, nowMin: number, memory?: DayMemory): { text: string; memory: DayMemory } | null {
  return nextBlockReply(message, day, tomorrow, nowMin, memory) ?? presentBlockReply(message, day, tomorrow, nowMin);
}
