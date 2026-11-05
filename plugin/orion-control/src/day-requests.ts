/*
 Calendar requests code carries out with no model (2026-10-31 gate run-1031133008, clusters 2, 3 and 10).

 Each of these came back "What time or how long do you mean?", "That doesn't fit: there's no such block" or a block called
 "book", because the one-step intent layer could not hold them and the form guessed. Every one has a natural reading, so
 code acts on it and says the assumption it made:

   i have a marketing quiz thursday i should prob study for it   to-do due Thursday + two 1-hour study sessions (orion-tasks)
   add marketing quiz thursday at 2pm and book two 1 hour study blocks for it before then   quiz event + the sessions
   cancel gym and side project today / im sick, cancel …, im still going to econ   each named block of his off (+ rest when ill)
   add a 30 min nap at 4 today and cut side project tonight   each clause in turn, the day read again between them
   going to get food with annika from 5 to 7, move gym to after   the plan with a person, then gym right after it
   move finish resume to tomorrow at 10am, 45 min / ill do the resume tomorrow   booked tomorrow first, today's taken off after
   im meal prepping for like 40 min then ill do gym   gym starts when he said he'd be done
   clear all my ORION blocks this week but leave classes and anything with people   only ORION's own blocks, day by day

 Nothing here touches a class. Gym is never dropped for an excuse (anchor-guards.ts keeps that); "tomorrow" before 5 AM is left
 to the normal path, which asks.
*/
import { ampm, ceil5, CLOCK, hhmm, parseClock, resolveStart, takeLength, toMin } from "./intent-time.js";
import { blocksNamed } from "./day-replan.js";
import { gymPushback } from "./anchor-guards.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import { notBooked, refused, sideNotes, wrote, writesIn } from "./scheduler-out.js";
import { compoundReply, knockOn } from "./compound-reply.js";
import { pluginNow } from "./plugin-clock.js";
import { readNamedWrite, runNamedWrite, type NamedWrite } from "./calendar-resolve.js";
import { readMultiDay, runMultiDay, type MultiDayPlan } from "./calendar-days.js";
import { deferralsOf, slipAck } from "./slip-history.js";
import { shiftNote } from "./shift-note.js";

export type Clause =
  | { verb: "remove"; names: string[] }
  | { verb: "add"; name: string; minutes?: number; at?: string; after?: string; fixed?: boolean; until?: string }
  | { verb: "move-after"; name: string; after?: string };
export type DayRequest = DayRequestMore
  | { kind: "clauses"; clauses: Clause[]; ill: boolean; keep?: string; gymKept?: boolean }
  | { kind: "deadline"; title: string; day: string; at?: string; book: boolean; sessions: number; minutes: number }
  | { kind: "to-tomorrow"; name: string; at?: string; part?: "morning" | "afternoon" | "evening"; minutes?: number; defer: boolean }
  | { kind: "then"; activity: string; minutes: number; next: string }
  | { kind: "clear-owned"; scope: "today" | "tomorrow" | "week" }
  /** "can we do gym later, like after dinner": a move with a natural default, said back as the assumption. */
  | { kind: "vague-move"; name: string; when: string }
  /** "moved to 8pm tonight" with no name: the block under way, else the next one of his. */
  | { kind: "unnamed-move"; at: string }
  /** "i skipped marketing, put 1 hour of catch up on it tomorrow evening" */
  | { kind: "catch-up"; what: string; minutes: number; minutesSaid?: true; day: "today" | "tomorrow"; part?: "morning" | "afternoon" | "evening" };
// 2026-10-31 gate (clusters 3 and 9): a write on a block he names (calendar-resolve.ts), and a plan for the weekend or tomorrow (calendar-days.ts).
export type DayRequestMore = NamedWrite | MultiDayPlan;

export type RequestScript = (script: "orion-declare" | "orion-reschedule" | "orion-tasks", args: string[]) => Promise<{ stdout: string; code: number }>;
export type RequestDeps = { run: RequestScript; readDay: () => Promise<Day | undefined>; readDayOn?: (dateArgs: string[]) => Promise<Day | undefined>; now: Date;
  slipsOf?: (what: string) => number;
  /** Wave 6: ORION's state dir, for how often a deferred plan already slid (slip-history.ts). */
  stateDir?: string };
export type RequestOutcome = { flow: FlowResult; facts: string[]; writes: number };

const clean = (m: string) => m.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
const QUESTION = /\?\s*$|^(?:(?:so|ok|hey|orion|wait)[,\s]+)*(?:do|did|does|is|are|am|was|were|have|has|will|should|can i|could i|what|when|why|how|which)\b/i;
/** REV2 finding 3: a line about someone else's day ("my brother got a midterm friday", "she has a quiz") is never put on his calendar. */
const SOMEONE_ELSES = /^(?:(?:so|ok(?:ay)?|btw|fyi|yeah|lol|omg|ugh)[,\s]+)*(?:my\s+(?:little\s+|big\s+|older\s+|younger\s+)?(?:brother|bro|sister|sis|mom|mum|dad|friend|mate|roommate|flatmate|housemate|girlfriend|boyfriend|gf|bf|partner|cousin|classmate)|he|she|they|his|her|their)\b(?!'s\s)/i;
/** Tired, wrecked, not feeling it: how he feels, not a reason gym comes off (REV2 finding 7). */
const EXCUSE = /\b(?:tired|exhausted|wrecked|knackered|shattered|drained|dead|fried|lazy|not feeling it|not in the mood|can'?t be bothered|cba|don'?t (?:want|feel like)|dont (?:want|feel like)|meh|ugh)\b/i;
const HYPOTHETICAL = /\b(?:if|unless|what if|wish|pretend|imagine|would it)\b/i;
// REV2 finding 7: real illness only. Tired / exhausted / wrecked is an excuse as far as gym goes (anchor-guards.ts pushes back on it).
const ILL = /\b(?:sick(?!\s+of)|ill|unwell|fever|feverish|flu|throwing up|vomiting|migraine|covid)\b/i;
const WEEKDAY_RE = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|weds|thu|thur|thurs|fri|sat|sun|tomorrow|tmrw";
const FULL_DAY: Record<string, string> = { mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", weds: "wednesday", thu: "thursday", thur: "thursday", thurs: "thursday", fri: "friday", sat: "saturday", sun: "sunday", tmrw: "tomorrow" };
const dayWord = (w: string) => FULL_DAY[w] ?? w;
const NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1 };
const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const label = (b: DayBlock) => b.title.replace(/\s+—.*$/, "");
const isFixed = (b: DayBlock) => b.fixed || b.kind === "class";
const canon = (args: string[]) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
const listed = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const LATE_NIGHT = 5;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The date a day word means, as orion-reschedule reads it: today, tomorrow, or the next such weekday (the same weekday is next week's). */
function dateOfDay(word: string, now: Date): Date {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const plus = word === "today" ? 0 : word === "tomorrow" ? 1 : ((WEEKDAYS.indexOf(word) - base.getDay() + 7) % 7) || 7;
  return new Date(base.getTime() + plus * 86400_000);
}

// ---- reading ----
const DEADLINE_KIND = "quiz|exam|midterm|final|test|deadline|presentation|essay|assignment|paper|submission";
// REV2 finding 3: anchored to him. "i have / i've got / there's / add / put" anywhere, a bare "got" only at the start of a clause
// ("got a quiz friday at 2"), never "my brother got a midterm friday at 2".
const DEADLINE = new RegExp(String.raw`(?:\b(?:i (?:have|got|'?ve got)|ive got|i got|there'?s|there is|add|put)|(?:^|[,.;!]\s*|\band\s+)got)\s+(?:(?:an|a|my|the|another)\s+)*(?:(?<what>[a-z0-9][a-z0-9 ]{0,30}?)\s+)?(?<kind>${DEADLINE_KIND})\b(?:\s+(?:is\s+)?(?:due\s+)?)?\s*(?:on\s+|this\s+|next\s+)?(?<day>${WEEKDAY_RE})\b(?:\s+at\s+(?<at>${CLOCK}))?`, "i");
const STUDY = /\b(?:study|studying|revise|revision|review|prep|prepare|cram)\b/i;
const SESSIONS = /\b(?<n>\d|one|two|three|four|an?)\s+(?<len>\d{1,3}\s*(?:-|\s)?(?:min(?:ute)?s?|hours?|hrs?|h)|hour|half[- ]hour)\s+(?:study\s+)?(?:blocks?|sessions?|slots?)\b/i;

function readDeadline(m: string): DayRequest | null {
  const d = DEADLINE.exec(m);
  if (!d?.groups) return null;
  const what = (d.groups.what ?? "").replace(/^(?:(?:a|an|my|the|another)\s+)+/, "").replace(/^(?:a|an|my|the|another)$/, "").trim();
  if (/\b(?:no|not|don'?t|didn'?t)\b/.test(what)) return null;
  const title = cap(`${what ? `${what} ` : ""}${d.groups.kind!}`.trim());
  const s = SESSIONS.exec(m);
  const n = s?.groups ? (NUMS[s.groups.n!] ?? Number(s.groups.n)) : 2;
  const len = s?.groups ? (/^hour$/.test(s.groups.len!) ? 60 : /half/.test(s.groups.len!) ? 30 : takeLength(s.groups.len!.replace(/-/, " ")).minutes ?? 60) : 60;
  return { kind: "deadline", title, day: dayWord(d.groups.day!), ...(d.groups.at ? { at: d.groups.at } : {}), book: STUDY.test(m) || !!s, sessions: Math.min(4, Math.max(1, n)), minutes: Math.min(180, Math.max(15, len)) };
}

const NAME = String.raw`[a-z][a-z0-9' &-]{1,30}?`;
const REMOVE_VERB = String.raw`(?:cancel|drop|cut|scrap|ditch|remove|delete|nuke|take off|get rid of|skip)`;
const TAIL_FILLER = /\s*(?:\b(?:today|tonight|this (?:morning|afternoon|evening)|please|pls|lol|tbh|for me|im wrecked|i'?m wrecked|im (?:so )?(?:tired|exhausted|dead))\b\s*)+$/;
const strip = (t: string) => t.replace(/[.!]+$/, "").replace(TAIL_FILLER, "").trim();
function removeClause(c: string): Clause | null {
  const m = new RegExp(String.raw`^${REMOVE_VERB}\s+(?:my\s+|the\s+)?(.+)$`, "i").exec(strip(c));
  if (!m) return null;
  const names = m[1]!.split(/\s*(?:,|\band\b|&)\s*/).map((n) => strip(n.replace(/^(?:my|the)\s+/, ""))).filter(Boolean);
  return names.length && names.every((n) => /^[a-z][a-z0-9' -]{1,30}$/.test(n)) ? { verb: "remove", names } : null;
}
function addClause(c: string): Clause | null {
  const body = strip(c);
  const m = /^(?:add|put|book|schedule|throw in|fit in|pencil in|squeeze in)\s+(?:in\s+)?(.+)$/i.exec(body);
  if (!m) return null;
  const len = takeLength(m[1]!);
  let rest = len.rest.replace(/^(?:a|an|some|my|the|quick|short)\s+/i, "").replace(/^(?:of)\s+/, "").trim();
  const at = new RegExp(String.raw`\s+at\s+(${CLOCK})$`, "i").exec(rest);
  if (at) rest = rest.slice(0, at.index).trim();
  const anchor = /\s+after\s+(?:my\s+|the\s+)?(.+)$/i.exec(rest);
  if (anchor) rest = rest.slice(0, anchor.index).trim();
  if (!/^[a-z][a-z' -]{1,30}$/i.test(rest) || /\b(?:and|then|reminder|alarm|todo|to-do)\b/.test(rest)) return null;
  if (!at && !anchor && !len.minutes) return null;
  return { verb: "add", name: rest, ...(len.minutes ? { minutes: len.minutes } : {}), ...(at ? { at: at[1]! } : {}), ...(anchor ? { after: strip(anchor[1]!) } : {}) };
}
// "going to get food with annika from 5 to 7": a plan with a person, at the times he said (fixed: ORION does not move it).
function planClause(c: string): Clause | null {
  const m = new RegExp(String.raw`^(?:(?:i'?m|im|i am)\s+)?(?:going to|gonna|getting|having|meeting)\s+(?<what>.+?\bwith\s+[a-z]+)\s+from\s+(?<a>${CLOCK})\s+(?:to|till|until|-)\s+(?<b>${CLOCK})$`, "i").exec(strip(c));
  if (!m?.groups) return null;
  return { verb: "add", name: m.groups.what!.replace(/^(?:get|go for|have|grab)\s+/i, "").trim(), at: m.groups.a!, until: m.groups.b!, fixed: true };
}
function moveAfterClause(c: string): Clause | null {
  const m = new RegExp(String.raw`^(?:move|push|put|do|shift)\s+(?:my\s+|the\s+)?(${NAME})\s+(?:to\s+)?(?:right\s+)?after(?:\s+(?:that|it|this))?(?:\s+(?:my\s+|the\s+)?(${NAME}))?$`, "i").exec(strip(c));
  if (!m) return null;
  return { verb: "move-after", name: m[1]!, ...(m[2] && !/^(?:that|it|this)$/.test(m[2]) ? { after: m[2] } : {}) };
}

const KEEP_TAIL = /[,.]?\s*(?:but\s+)?(?:i'?m|im|i am)\s+still\s+(?:going|doing|gonna go|going to go|having|attending)\s+(?:to\s+)?(?:my\s+|the\s+)?([a-z0-9 ]{2,30}?)\s*[.!]*$/i;
const LEAD = /^(?:(?:ok(?:ay)?|so|yeah|ugh|honestly|orion|hey)[,\s]+)*(?:(?:i'?m|im|i am|feeling|i feel)\s+(?:so\s+|really\s+|kinda\s+)?(?:sick|ill|unwell|wrecked|exhausted|knackered|tired|rough|awful|like crap)[,.!]?\s+(?:so\s+)?)?/i;
const CONTEXT_LEAD = /\b(?:slept|sleep|tired|exhausted|wrecked|sick|ill|rough|awful|knackered|stressed|dead|hungover)\b/i;
function readClauses(m: string): DayRequest | null {
  let body = m.replace(LEAD, "").trim();
  const keep = KEEP_TAIL.exec(body);
  if (keep) body = body.slice(0, keep.index).trim();
  const split = body.split(/\s*(?:,|;|\band then\b|\bthen\b|\band\s+(?=(?:add|put|book|schedule|cancel|drop|cut|scrap|ditch|remove|delete|move|push|skip)\b))\s*/i).map((p) => p.trim()).filter(Boolean);
  // "only slept 4 and a half hours, add a nap after class and cut side project": a leading line about how he feels is context, not a clause.
  const parts = split.length > 1 && CONTEXT_LEAD.test(split[0]!) && !/\b(?:add|put|book|cancel|drop|cut|move|push)\b/.test(split[0]!) ? split.slice(1) : split;
  if (parts.length === 0 || parts.length > 4) return null;
  const clauses = parts.map((p) => removeClause(p) ?? planClause(p) ?? addClause(p) ?? moveAfterClause(p));
  if (clauses.some((c) => !c)) return null;
  const list = clauses as Clause[];
  const removes = list.filter((c): c is Extract<Clause, { verb: "remove" }> => c.verb === "remove");
  // A lone single-name remove or a lone add is the intent layer's ("cancel gym", "add gym at 6"); this is for the combinations.
  if (list.length === 1 && !(removes.length === 1 && removes[0]!.names.length > 1)) return null;
  const ill = ILL.test(m);
  // Gym is never dropped for an excuse: without a health reason gym stays (with pushback and a shorter offer) and the rest of what he
  // named still comes off; gym alone is the gym guard's (anchor-guards.ts).
  const isGym = (n: string) => /\bgym\b/.test(n);
  if (ill || !removes.some((r) => r.names.some(isGym))) return { kind: "clauses", clauses: list, ill, ...(keep ? { keep: keep[1]!.trim() } : {}) };
  if (!EXCUSE.test(m)) return null;   // a plain "cancel gym and X" is the gym guard's and the intent layer's, as before
  const rest = list.map((c) => (c.verb === "remove" ? { ...c, names: c.names.filter((n) => !isGym(n)) } : c)).filter((c) => c.verb !== "remove" || c.names.length);
  if (!rest.length) return null;
  return { kind: "clauses", clauses: rest, ill, gymKept: true, ...(keep ? { keep: keep[1]!.trim() } : {}) };
}

const TOMORROW_PART = String.raw`(?:tomorrow|tmrw|tmr)(?:\s+(?<part>morning|afternoon|evening|night))?`;
const MOVE_TMRW = new RegExp(String.raw`^(?:(?:can you|can u|could you|please|pls)\s+)?(?:move|push|shift|bump|put)\s+(?:my\s+|the\s+)?(?<x>${NAME})\s+(?:to\s+)?${TOMORROW_PART}(?:\s+at\s+(?<at>${CLOCK}))?(?:\s*,?\s*(?:for\s+)?(?<len>.+?))?$`, "i");
const DEFER_TMRW = new RegExp(String.raw`^(?:ok(?:ay)?[,\s]+|fine[,\s]+)?(?:i'?ll|ill|i will|i'?m gonna|im gonna|gonna|let me|lemme)\s+(?:do|finish|work on|get to|start|get)\s+(?:my\s+|the\s+)?(?<x>${NAME})\s+${TOMORROW_PART}(?:\s+at\s+(?<at>${CLOCK}))?$`, "i");
function readTomorrow(m: string, now: Date): DayRequest | null {
  if (now.getHours() < LATE_NIGHT) return null;
  const body = m.replace(/[.!]+$/, "").trim();
  const mv = MOVE_TMRW.exec(body); const df = mv ? null : DEFER_TMRW.exec(body);
  const g = (mv ?? df)?.groups;
  if (!g) return null;
  const x = g.x!.trim();
  if (/\bgym\b/.test(x) || /\b(?:it|that|this|everything|all)\b/.test(x)) return null;   // gym: anchor-guards; "it": the normal path
  const len = g.len ? takeLength(g.len) : { minutes: undefined, rest: "" };
  if (g.len && (!len.minutes || len.rest.trim())) return null;
  const part = g.part === "night" ? "evening" : g.part as "morning" | "afternoon" | "evening" | undefined;
  return { kind: "to-tomorrow", name: x, ...(g.at ? { at: g.at } : {}), ...(part ? { part } : {}), ...(len.minutes ? { minutes: len.minutes } : {}), defer: !!df };
}

const THEN = /^(?:(?:ok(?:ay)?|so|yeah)[,\s]+)?(?:(?:i'?m|im|i am|gonna be|going to be)\s+)?(?<act>[a-z][a-z ]{2,30}?)\s+(?:for\s+)?(?:like\s+|about\s+|around\s+|roughly\s+)?(?<len>\d{1,3}\s*(?:min|mins|minutes|hours?|hrs?)|an? hour|half an hour)\s+(?:then|and then|after that|before)\s+(?:i'?ll\s+|ill\s+|i will\s+|i'?m\s+)?(?:do|hit|go to|start|doing)?\s*(?:the\s+|my\s+)?(?<next>[a-z][a-z ]{1,30}?)\s*[.!]*$/i;
function readThen(m: string): DayRequest | null {
  const t = THEN.exec(m);
  if (!t?.groups) return null;
  const minutes = takeLength(t.groups.len!).minutes;
  if (!minutes || minutes > 180) return null;
  return { kind: "then", activity: t.groups.act!.trim(), minutes, next: t.groups.next!.trim() };
}

const OWNED_WORDS = /\b(?:orion|your|ur|my own|owned|auto(?:matic)?|planned)\s+(?:blocks?|stuff|events?|things)\b/i;
const KEEP_CLASSES = /\b(?:but|except|and)\s+(?:leave|keep|not)\s+(?:my\s+|the\s+)?(?:classes|lectures)\b/i;
const CLEAR_VERB = /\b(?:clear|wipe|delete|remove|drop|nuke|scrap|get rid of)\b/i;
function readClearOwned(m: string): DayRequest | null {
  if (!CLEAR_VERB.test(m) || !(OWNED_WORDS.test(m) || KEEP_CLASSES.test(m))) return null;
  const scope = /\bweek\b/.test(m) ? "week" : /\b(?:tomorrow|tmrw)\b/.test(m) ? "tomorrow" : /\b(?:today|tonight|rest of (?:the|my) day)\b/.test(m) ? "today" : null;
  return scope ? { kind: "clear-owned", scope } : null;
}

const WHEN = String.raw`after dinner|after lunch|after (?:my |the )?[a-z0-9][a-z0-9 ]{1,25}|before (?:my |the )?[a-z0-9][a-z0-9 ]{1,25}|tonight|this evening|in the evening|later tonight|later today|this afternoon|later`;
const VAGUE_MOVE = new RegExp(String.raw`^(?:(?:ok(?:ay)?|so|actually|hey|orion)[,\s]+)*(?:(?:can|could)\s+(?:we|i|you|u)\s+|let'?s\s+|lets\s+|i'?ll\s+|ill\s+|i (?:wanna|want to)\s+|i'?d rather\s+|maybe\s+|please\s+)?(?:move|push|shift|do|put|bump|have|go to)\s+(?:my\s+|the\s+)?(?<x>${NAME})\s+(?:(?:a bit|a little|a lil)\s+)?(?:(?:later|earlier)\s*,?\s*)?(?:(?:like|maybe|say|around|to|until|till|instead|for)\s+)*(?<when>${WHEN})(?:\s+(?:instead|please|pls|today|then))?\s*[.!]*$`, "i");
function readVagueMove(m: string): DayRequest | null {
  const v = VAGUE_MOVE.exec(m.replace(/\?\s*$/, ""));
  if (!v?.groups) return null;
  const x = v.groups.x!.trim();
  if (/\b(?:it|that|this|everything|all|something|stuff)\b/.test(x) || /\d/.test(x)) return null;
  return { kind: "vague-move", name: x, when: v.groups.when!.trim() };
}
const UNNAMED = new RegExp(String.raw`^(?:(?:ok(?:ay)?|so|yeah|nah|no)[,\s]+)*(?:it'?s\s+|its\s+|it\s+(?:got\s+|was\s+|is\s+)?|got\s+|been\s+)?(?:moved|pushed|changed|moving it|pushed back|bumped)\s+(?:back\s+)?to\s+(?<at>${CLOCK})(?:\s+(?:tonight|today|this evening))?\s*[.!]*$`, "i");
function readUnnamed(m: string): DayRequest | null {
  const u = UNNAMED.exec(m);
  return u?.groups ? { kind: "unnamed-move", at: u.groups.at! } : null;
}
const CATCH_UP = /\b(?:i\s+)?(?:skipped|missed|bailed on|didn'?t go to|didnt go to|didn'?t make it to)\s+(?:the\s+|my\s+)?([a-z0-9]+)\b.*?\b(?:put|book|add|schedule|fit|give me)\s+(?:in\s+)?(?:(an?|\d{1,3}|one|two)\s*(hours?|hrs?|h|min(?:ute)?s?)\s+)?(?:of\s+)?catch[- ]?up(?:\s+(?:time|block|session))?(?:\s+(?:on|for)\s+(?:it|that|them))?\s+(today|tonight|tomorrow|tmrw)(?:\s+(morning|afternoon|evening|night))?/i;
function readCatchUp(m: string): DayRequest | null {
  const c = CATCH_UP.exec(m);
  if (!c) return null;
  const n = c[2] ? (NUMS[c[2]] ?? Number(c[2])) : 1;
  const minutes = c[3] ? (/^h/.test(c[3]) ? n * 60 : n) : 60;
  const day = /^(?:tomorrow|tmrw)$/.test(c[4]!) ? "tomorrow" : "today";
  const part = c[4] === "tonight" || c[5] === "night" ? "evening" : c[5] as "morning" | "afternoon" | "evening" | undefined;
  return { kind: "catch-up", what: c[1]!, minutes: Math.min(240, Math.max(15, minutes)), ...(c[3] ? { minutesSaid: true as const } : {}), day, ...(part ? { part } : {}) };
}

/** A calendar request code carries out itself, or null (the turn goes on as usual). */
export function readDayRequest(message: string, now: Date = pluginNow()): DayRequest | null {
  const raw = clean(message);
  // "can we do gym later, like after dinner?" is a request, not a question.
  const m = /^(?:(?:ok(?:ay)?|so|actually|hey|orion)[,\s]+)*(?:can|could|would)\s+(?:we|you|u)\b/.test(raw) ? raw.replace(/\?\s*$/, "") : raw;
  if (!m || QUESTION.test(m) || HYPOTHETICAL.test(m) || SOMEONE_ELSES.test(m)) return null;
  return readClearOwned(m) ?? readCatchUp(m) ?? readDeadline(m) ?? readTomorrow(m, now) ?? readThen(m) ?? readVagueMove(m) ?? readUnnamed(m) ?? readNamedWrite(m) ?? readMultiDay(m) ?? readClauses(m);
}

// ---- carrying out ----
const say = (text: string, calls: string[] = [], outputs: string[] = []): FlowResult => ({ outcome: "say", kind: "plain", text, calls, outputs });
const done = (reply: string, calls: string[], outputs: string[]): FlowResult => {
  const notes = sideNotes(reply, outputs);
  const text = !notes.length ? reply : / Say "undo"[\s\S]*$|\s*(?:Each day is its own change[\s\S]*)$/.test(reply)
    ? reply.replace(/ Say "undo"[\s\S]*$|\s*(?:Each day is its own change[\s\S]*)$/, (tail) => ` ${knockOn(notes)}${tail}`) : `${reply} ${knockOn(notes)}`;
  return { outcome: "done", calls, outputs, reply: text };
};
const nowMin = (deps: RequestDeps) => deps.now.getHours() * 60 + deps.now.getMinutes();
const UNDO = "Say \"undo\" to put it back.";
const READ_FAILED = "I couldn't read your calendar just now, so nothing changed. Say go and I'll retry it.";

/** One block of his by name: one still ahead first, else the latest. */
function findBlock(name: string, day: Day | undefined, now: number, opts: { ahead?: boolean } = {}): DayBlock | undefined {
  const found = day ? blocksNamed(name, day).filter((b) => b.kind !== "commute") : [];
  const ahead = found.filter((b) => toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  return ahead ?? (opts.ahead ? undefined : [...found].sort((a, b) => toMin(b.end) - toMin(a.end))[0]);
}
type Runner = { calls: string[]; outputs: string[]; writes: number; exec: (args: string[], script?: "orion-reschedule" | "orion-tasks") => Promise<{ stdout: string; code: number; ok: boolean }> };
/** Runs one scheduler call. REV2 finding 1: success is exit 0 with no NOTHING WAS header, and every run that wrote is one undo entry
 *  (orion-tasks: one per day it booked). An add whose own block is NOT BOOKED while the run still moved other things is undone at once,
 *  so "it didn't fit" never sits on top of a calendar that silently changed. */
function runner(deps: RequestDeps): Runner {
  const r: Runner = { calls: [], outputs: [], writes: 0, exec: async (args, script = "orion-reschedule") => {
    const out = await deps.run(script, args).catch(() => ({ stdout: "", code: 1 }));
    r.calls.push(`exec ${script} ${canon(args)}`); r.outputs.push(out.stdout);
    if (script === "orion-tasks") { r.writes += writesIn(out.stdout); return { ...out, ok: !refused(out) }; }
    const own = args[0] === "add" && args[1] ? notBooked(out.stdout, args[1]) : false;
    if (!wrote(out)) return { ...out, ok: !refused(out) && !own };
    if (!own) { r.writes += 1; return { ...out, ok: true }; }
    const back = await deps.run("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 }));
    // What that run moved is no longer true: its lines are kept for the record but never read as changes.
    r.outputs[r.outputs.length - 1] = out.stdout.split("\n").map((l) => `undone: ${l}`).join("\n");
    r.calls.push("exec orion-reschedule undo"); r.outputs.push(back.stdout);
    if (back.code !== 0) r.writes += 1;
    return { ...out, ok: false };
  } };
  return r;
}
/** The scheduler's reason for a refusal, in his words: its advice to ORION ("— if he meant another day, run again with --date …"), dates,
 *  option names and script names are cut, so no tool internals reach him. Undefined when there is nothing safe to say. */
export function whyNot(stdout: string): string | undefined {
  const raw = /NOTHING WAS (?:CHANGED|BOOKED)(?: on [^:.]+)?: (.+)/.exec(stdout)?.[1];
  if (!raw) return /NOT BOOKED: .+? (?:did not fit|no longer fits)/.test(stdout) ? "there wasn't room for it" : undefined;
  const why = raw.split(/\s+[—–]\s+|;\s+|\.\s+/)[0]!.replace(/\s*\((?:[A-Z][a-z]+day )?\d{4}-\d{2}-\d{2}\)/g, "").replace(/\.$/, "").replace(/(\d{2}:\d{2})/g, (t) => ampm(toMin(t))).trim();
  return !why || /--|orion-|\brun again\b|\busage\b|\bhe\b|\bhis\b/i.test(why) ? undefined : why;
}
/** "added Gym 16:30–18:00" / "planned X: 16:30–17:00" in a scheduler's output: where it went. */
const placedAt = (stdout: string, title: string): string | undefined => {
  const esc = title.toLowerCase().split(/\s+/)[0]!.replace(/[^a-z0-9]/g, "");
  const line = stdout.split("\n").find((l) => l.toLowerCase().includes(esc) && /\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/.test(l));
  const m = line ? /(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/.exec(line) : null;
  if (m) return `${ampm(toMin(m[1]!))}–${ampm(toMin(m[2]!))}`;
  const moved = stdout.split("\n").map((l) => /^\s*moved (.+?): \d{2}:\d{2} → (\d{2}:\d{2})/.exec(l)).find((x) => x && x[1]!.toLowerCase().includes(esc));
  return moved ? ampm(toMin(moved[2]!)) : undefined;
};

async function runDeadline(r: Extract<DayRequest, { kind: "deadline" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const x = runner(deps); const lines: string[] = [];
  // REV2 finding 11: "thursday" said on a Thursday is next week's: the date is said so he can catch it, and passed exactly.
  const target = dateOfDay(r.day, deps.now);
  const sameDay = !/^(?:today|tomorrow)$/.test(r.day) && target.getDay() === deps.now.getDay();
  const when = sameDay ? `next ${cap(r.day)} (${target.toLocaleDateString("en-GB", { day: "numeric", month: "long" })})` : cap(r.day);
  const dateArg = sameDay ? ymd(target) : r.day;
  let guess = "";
  if (r.at) {
    const said = parseClock(r.at);
    const res = said ? resolveStart(said, { day: "tomorrow", now: null }) : undefined;
    // An ambiguous hour follows the same rule as tomorrow's moves: 7 to 11 is the morning, the rest the afternoon; the guess is said.
    const at = res && "at" in res ? res.at : res && "ambiguous" in res ? (said!.h >= 7 && said!.h <= 11 ? res.ambiguous[0] : res.ambiguous[1]) : undefined;
    if (at === undefined) return { flow: say(`I couldn't read "${r.at}" as a time, so nothing changed. When is the ${r.title.toLowerCase()}?`), facts: [], writes: 0 };
    if (res && "ambiguous" in res) guess = ` (I took ${r.at} as ${ampm(at)}; say if you meant ${at < 720 ? "PM" : "AM"})`;
    const out = await x.exec(["add", r.title, "60", "--at", hhmm(at), "--fixed", "--date", dateArg]);
    if (!out.ok) return { flow: say(`I couldn't put the ${r.title.toLowerCase()} on ${when} at ${ampm(at)}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}, so nothing changed.`, x.calls, x.outputs), facts: [], writes: 0 };
    lines.push(`${r.title} is on ${when} at ${ampm(at)}${guess}`);
  }
  if (r.book) {
    const todo = `Study for ${r.title.toLowerCase()}`;
    const spread = `${r.sessions} ${r.minutes}-minute blocks`;
    const out = await x.exec(["add", todo, "--due", dateArg, "--spread", spread], "orion-tasks");
    const planned = out.stdout.split("\n").map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(`${todo.toLowerCase()}:`));
    const sessions = planned ? [...planned.matchAll(/(\d{4}-\d{2}-\d{2}) (\d+) min/g)].map((s) => `${new Date(`${s[1]}T12:00`).toLocaleDateString("en-GB", { weekday: "long" })} (${s[2]} min)`) : [];
    if (!out.ok) lines.push(`I couldn't book the study time just now${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}`);
    else if (sessions.length) lines.push(`${sessions.length === 1 ? "a study session" : `${sessions.length} study sessions`} before it: ${listed(sessions)}`);
    else lines.push(`a to-do "${todo}" due ${when} with ${r.sessions} × ${r.minutes} min of study to book; there was no free room for it in the next days yet`);
    if (!r.at && out.ok) lines.push(`I didn't know the time of the ${r.title.toLowerCase()}, so it's a to-do due ${when}; tell me when it is and I'll put it on your calendar`);
  }
  if (!lines.length) return { flow: say(`When on ${when} is the ${r.title.toLowerCase()}? Tell me the time and I'll put it on your calendar.`), facts: [], writes: 0 };
  const changed = x.writes > 0 || (r.book && x.outputs.some((o) => /^Added /m.test(o)));
  // What booking the sessions moved is said too (the demo moved Gym 5:00 → 5:20 PM to fit Monday's session).
  const moved = [...new Set(x.outputs.flatMap((o) => [...o.matchAll(/^\s*moved (.+?): (\d{2}:\d{2}) → (\d{2}:\d{2})/gm)].map((mv) => `${mv[1]} ${ampm(toMin(mv[2]!))} → ${ampm(toMin(mv[3]!))}`)))];
  const text = `${changed ? "Done: " : ""}${cap(lines.join(". "))}.${moved.length ? ` ${knockOn(moved)}` : ""}${x.writes ? ` ${UNDO.replace("it", "the calendar change")}` : ""}`;
  return { flow: changed ? done(text, x.calls, x.outputs) : say(text, x.calls, x.outputs), facts: [], writes: x.writes };
}

async function runClauses(r: Extract<DayRequest, { kind: "clauses" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const x = runner(deps); const said: string[] = []; const notes: string[] = [];
  let day = await deps.readDay().catch(() => undefined);
  if (!day) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = nowMin(deps);
  let lastAdded: string | undefined;
  for (const c of r.clauses) {
    if (c.verb === "remove") {
      for (const n of c.names) {
        if (r.keep && blocksNamed(r.keep, { ...day, blocks: [{ title: n, start: "00:00", end: "00:00", fixed: false }] }).length) continue;
        const b = findBlock(n, day, now, { ahead: true });
        if (!b) { notes.push(`${n} isn't on the rest of today's calendar`); continue; }
        if (isFixed(b) && !b.nameable) { notes.push(`${label(b)} is a class or a plan with people, so it stays`); continue; }
        const out = await x.exec(["drop", b.title]);
        if (out.ok) said.push(`took ${label(b)} (${ampm(toMin(b.start))}) off`); else notes.push(`I couldn't take ${label(b)} off`);
      }
    } else if (c.verb === "add") {
      // A block he names lands on the calendar capitalised ("Nap", not "nap"), like every other block ORION writes.
      const args = ["add", c.name.charAt(0).toUpperCase() + c.name.slice(1)];
      let minutes = c.minutes ?? 30;
      let at: number | undefined;
      if (c.at) {
        const s = parseClock(c.at); const res = s ? resolveStart(s, { day: "today", now }) : undefined;
        if (!res || !("at" in res)) { notes.push(res && "passed" in res ? `${ampm(res.passed)} has already passed, so I didn't add ${c.name}` : `I couldn't tell when to put ${c.name}`); continue; }
        at = res.at;
      }
      if (c.until && at !== undefined) {
        const e = parseClock(c.until);
        const end = e ? (e.exact ? (e.ap ? (e.h % 12) * 60 + (e.ap === "p" ? 720 : 0) + e.m : e.h * 60 + e.m) : [e.h * 60 + e.m, e.h * 60 + e.m + 720].find((v) => v > at!)) : undefined;
        if (end === undefined || end <= at) { notes.push(`I couldn't tell when ${c.name} ends`); continue; }
        minutes = end - at;
      }
      if (c.after) {
        const a = /^(?:class|classes|lecture)$/.test(c.after) ? day.blocks.filter((b) => b.kind === "class" && toMin(b.end) > now).sort((p, q) => toMin(p.start) - toMin(q.start))[0] : findBlock(c.after, day, now, { ahead: true });
        if (!a) { notes.push(`there's no ${c.after} left today to put ${c.name} after, so I didn't add it`); continue; }
        args.push(String(minutes), "--after", a.title);
      } else args.push(String(minutes), ...(at !== undefined ? ["--at", hhmm(at)] : []));
      if (c.fixed) args.push("--fixed");
      if (c.minutes !== undefined || c.until) args.push("--length-explicit");   // his own length or end time; the 30 default keeps his minimums
      const out = await x.exec(args);
      if (out.ok) { const why = at !== undefined && !c.after ? shiftNote(out.stdout, c.name) : ""; said.push(`${c.name} ${placedAt(out.stdout, c.name) ?? (at !== undefined ? `at ${ampm(at)}` : "added")}${why ? ` (${why.replace(/\.? Say if you want another time\.$/, "")})` : ""}`); lastAdded = c.name; }
      else notes.push(`${c.name} didn't go in${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}`);
    } else {
      const b = findBlock(c.name, day, now, { ahead: true });
      const anchor = c.after ?? lastAdded;
      // What this message just added is the anchor even before the calendar read shows it.
      const a = anchor ? findBlock(anchor, day, now) ?? (anchor === lastAdded ? { title: anchor, start: "00:00", end: "00:00", fixed: true } : undefined) : undefined;
      if (!b) { notes.push(`${c.name} isn't on the rest of today's calendar, so there was nothing to move`); continue; }
      if (!a) { notes.push(`I couldn't tell what to put ${label(b)} after`); continue; }
      const out = await x.exec(["move", b.title, "--after", a.title]);
      if (out.ok) said.push(`${label(b)} moved to ${placedAt(out.stdout, b.title) ?? `after ${label(a)}`}`); else notes.push(`${label(b)} couldn't move after ${label(a)}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}`);
    }
    day = (await deps.readDay().catch(() => undefined)) ?? day;
  }
  if (r.ill && said.length && !r.clauses.some((c) => c.verb === "add")) {
    const out = await x.exec(["add", "Rest", "60"]);
    if (out.ok) said.push(`put an hour of rest in (${placedAt(out.stdout, "Rest") ?? "where it fits"})`);
  }
  const gym = r.gymKept ? findBlock("gym", day, now, { ahead: true }) : undefined;
  const keepLine = `${r.keep ? ` ${cap(r.keep)} stays on.` : ""}${r.gymKept ? ` ${gymPushback({ skipsThisWeek: deps.slipsOf?.("gym") ?? 0, firm: false, ...(gym ? { gymAt: gym.start } : {}) })}` : ""}`;
  const lead = r.ill ? "Feel better. " : "";
  if (!said.length && !x.writes) return { flow: say(`${lead}Nothing changed: ${notes.join("; ")}.${keepLine}`, x.calls, x.outputs), facts: [], writes: 0 };
  if (!said.length) return { flow: done(`${lead}Not done: ${notes.join("; ")}.${keepLine} The scheduler still changed your calendar. ${UNDO}`, x.calls, x.outputs), facts: [], writes: x.writes };
  const knock = sideNotes(said.join(" "), x.outputs);
  return { flow: done(`${lead}${compoundReply({ did: said, knock, couldnt: notes, tail: keepLine, undo: true })}`, x.calls, x.outputs), facts: [], writes: x.writes };
}

const PART_AT = { morning: 9 * 60, afternoon: 14 * 60, evening: 19 * 60 } as const;
async function runTomorrow(r: Extract<DayRequest, { kind: "to-tomorrow" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const x = runner(deps);
  const today = await deps.readDay().catch(() => undefined);
  if (!today) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = nowMin(deps);
  const b = findBlock(r.name, today, now);
  if (b && isFixed(b) && !b.nameable) return { flow: say(`${label(b)} is a class or a plan with people, so I don't move it to another day. Nothing changed.`), facts: [], writes: 0 };
  const title = b?.title ?? r.name.replace(/^(?:my|the)\s+/, "");
  const minutes = r.minutes ?? (b ? toMin(b.end) - toMin(b.start) : 45);
  let at: number | undefined;
  if (r.at) { const s = parseClock(r.at); const res = s ? resolveStart(s, { day: "tomorrow", now: null, ...(r.part === "morning" ? { part: "morning" as const } : r.part ? { part: "evening" as const } : {}) }) : undefined; at = res && "at" in res ? res.at : res && "ambiguous" in res ? (s!.h >= 7 && s!.h <= 11 ? res.ambiguous[0] : res.ambiguous[1]) : undefined; }
  const assumed = at === undefined && r.part ? PART_AT[r.part] : undefined;
  at ??= assumed;
  const tmrw = deps.readDayOn ? await deps.readDayOn(["--date", "tomorrow"]).catch(() => undefined) : undefined;
  const already = tmrw ? findBlock(title, tmrw, -1) : undefined;
  const add = already ? undefined : await x.exec(["add", title, String(minutes), ...(at !== undefined ? ["--at", hhmm(at)] : []), "--date", "tomorrow", ...(r.minutes !== undefined ? ["--length-explicit"] : [])]);
  if (add && !add.ok) return { flow: say(`I couldn't fit ${label({ title } as DayBlock)} in tomorrow${whyNot(add.stdout) ? ` (${whyNot(add.stdout)})` : ""}, so I left today as it was.`, x.calls, x.outputs), facts: [], writes: 0 };
  const where = already ? `${ampm(toMin(already.start))}–${ampm(toMin(already.end))}` : placedAt(add!.stdout, title) ?? (at !== undefined ? `at ${ampm(at)}` : undefined);
  let off = "";
  if (b && !isFixed(b) && toMin(b.start) > now) {
    const drop = await x.exec(["drop", b.title]);
    off = drop.ok ? ` and off today (it was ${ampm(toMin(b.start))})` : `, but I couldn't take today's ${ampm(toMin(b.start))} one off`;
  }
  const slips = (deps.slipsOf?.(title) ?? 0);
  // Wave 6 (slip-history.ts): two weeks of his own record, not only "twice this week" (a plan that slides every few days never tripped it).
  const history = r.defer && deps.stateDir ? slipAck(deferralsOf(deps.stateDir, title, deps.now)) : "";
  const slipLine = history || (r.defer && slips >= 2 ? ` That's ${slips + 1} times it's slipped this week, so tomorrow let's just start: the first 15 minutes, nothing more.` : "");
  const assume = assumed !== undefined ? ` (I took ${r.part} as ${ampm(assumed)})` : "";
  const lead = already ? `${cap(label({ title } as DayBlock))} is already on tomorrow, ${where}` : `${cap(label({ title } as DayBlock))} is on tomorrow${where ? (where.startsWith("at") ? ` ${where}` : `, ${where}`) : ""}, ${minutes} minutes${assume}`;
  // His stated time is his: when the scheduler could not keep it, the reply says what was in the way (its own SHIFTED line).
  const why = add?.ok && at !== undefined && !assumed ? shiftNote(add.stdout, title) : "";
  const whyLine = why ? ` ${why}` : "";
  if (!x.writes) return { flow: say(`${lead}.${slipLine}`, x.calls, x.outputs), facts: [], writes: 0 };
  return { flow: done(`Done: ${lead}${off}.${whyLine}${slipLine} ${UNDO}`, x.calls, x.outputs), facts: [], writes: x.writes };
}

async function runThen(r: Extract<DayRequest, { kind: "then" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const x = runner(deps);
  const day = await deps.readDay().catch(() => undefined);
  if (!day) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = nowMin(deps);
  const b = findBlock(r.next, day, now, { ahead: true });
  const freeAt = ceil5(now + r.minutes);
  // Its slot already passed today (the nudge came after it): a new one starts when he is free, at its own length.
  const over = b ? undefined : findBlock(r.next, day, now);
  if (over && !(isFixed(over) && !over.nameable)) {
    const len = toMin(over.end) - toMin(over.start);
    if (freeAt + len > 1440) return { flow: say(`Okay, ${r.activity} first. There isn't room for ${label(over)} after that tonight; want it tomorrow?`), facts: [], writes: 0 };
    const out = await x.exec(["add", over.title, String(len), "--at", hhmm(freeAt), "--again"]);
    if (!out.ok) return { flow: say(`Okay, ${r.activity} first, but I couldn't book ${label(over)} for ${ampm(freeAt)}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}.`, x.calls, x.outputs), facts: [], writes: 0 };
    return { flow: done(`Okay, ${r.activity} first. ${label(over)} is booked for ${ampm(freeAt)}–${ampm(freeAt + len)}, so that's when I'll come back to you about it. ${UNDO}`, x.calls, x.outputs), facts: [], writes: x.writes };
  }
  if (!b) return { flow: say(`Okay, ${r.activity} till about ${ampm(freeAt)}. ${cap(r.next)} isn't on today's calendar, so nothing moved; tell me if you want it booked then.`), facts: [], writes: 0 };
  if (isFixed(b) && !b.nameable) return { flow: say(`Okay, ${r.activity} till about ${ampm(freeAt)}. ${label(b)} is a fixed event, so it stays at ${ampm(toMin(b.start))}.`), facts: [], writes: 0 };
  if (toMin(b.start) >= freeAt) return { flow: say(`Okay, ${r.activity} till about ${ampm(freeAt)}; ${label(b)} is still at ${ampm(toMin(b.start))}, so that works.`), facts: [], writes: 0 };
  const out = await x.exec(["move", b.title, "--to", hhmm(freeAt)]);
  if (!out.ok) return { flow: say(`Okay, ${r.activity} first, but I couldn't move ${label(b)} to ${ampm(freeAt)}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}, so it's still at ${ampm(toMin(b.start))}.`, x.calls, x.outputs), facts: [], writes: 0 };
  const len = toMin(b.end) - toMin(b.start);
  return { flow: done(`Okay, ${r.activity} first. ${label(b)} now starts at ${ampm(freeAt)} (${ampm(freeAt)}–${ampm(freeAt + len)}), so that's when I'll come back to you about it. ${UNDO}`, x.calls, x.outputs), facts: [], writes: x.writes };
}

async function runClearOwned(r: Extract<DayRequest, { kind: "clear-owned" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const x = runner(deps);
  const base = new Date(deps.now.getFullYear(), deps.now.getMonth(), deps.now.getDate(), 12);
  const toSunday = (7 - base.getDay()) % 7;
  const days = r.scope === "today" ? [0] : r.scope === "tomorrow" ? [1] : Array.from({ length: toSunday + 1 }, (_, i) => i);
  const cleared: string[] = []; const missed: string[] = []; let writes = 0;
  for (const plus of days) {
    const d = new Date(base.getTime() + plus * 86400_000);
    const name = plus === 0 ? "today" : d.toLocaleDateString("en-GB", { weekday: "long" });
    const args = ["clear", "--date", ymd(d)];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    x.calls.push(`exec orion-reschedule ${canon(args)}`); x.outputs.push(out.stdout);
    // A day with nothing of ORION's on it prints "NOTHING WAS BOOKED" and exits 0: nothing to clear, not a failure.
    if (out.code !== 0 || /NOTHING WAS CHANGED/.test(out.stdout)) { missed.push(name); continue; }
    const n = Number(/cleared (\d+) prior schedule blocks?: (.+)/.exec(out.stdout)?.[1] ?? 0)
      || out.stdout.split("\n").filter((l) => /^\s*(?:removed|dropped|deleted)\b/i.test(l)).length;
    if (/Written to his calendar/.test(out.stdout)) writes += 1;
    if (n) cleared.push(`${name} (${n})`);
  }
  const span = r.scope === "week" ? (days.length > 1 ? "today through Sunday" : "today") : r.scope;
  // What clear keeps (the daily anchor, the gym) is said, so "cleared" never hides a block still there.
  const left = r.scope !== "tomorrow" ? ((await deps.readDay().catch(() => undefined))?.blocks ?? []).filter((b) => !isFixed(b) && toMin(b.end) > nowMin(deps)) : [];
  const kept = left.length ? ` I kept ${listed(left.map((b) => `${label(b)} (${ampm(toMin(b.start))})`))} today: ${left.some((b) => b.kind === "gym") ? "gym is the daily anchor" : "it's a must"}; say "drop ${label(left[0]!).toLowerCase()}" if you want it gone too.` : "";
  const failedLine = missed.length ? ` I couldn't clear ${listed(missed)}.` : "";
  if (!cleared.length) return { flow: say(missed.length === days.length ? `I couldn't clear my blocks for ${span} just now, so nothing changed.` : `There were none of my own blocks to clear for ${span}.${kept}${failedLine}`, x.calls, x.outputs), facts: [], writes: 0 };
  const undo = writes > 1 ? ` Each day is its own change, so "undo" puts them back one day at a time.` : ` ${UNDO}`;
  return { flow: done(`Cleared my own blocks for ${span}: ${listed(cleared)}. Classes and plans with people are untouched.${kept}${failedLine}${undo}`, x.calls, x.outputs), facts: [], writes };
}

const EVENING_DEFAULT = 20 * 60;
const WHEN_DEFAULT: Array<[RegExp, number, string]> = [
  [/^after dinner$/, 20 * 60, "after dinner"], [/^after lunch$/, 13 * 60 + 30, "after lunch"], [/^(?:tonight|this evening|in the evening|later tonight)$/, EVENING_DEFAULT, "tonight"],
  [/^this afternoon$/, 14 * 60, "this afternoon"]];
async function runVagueMove(r: Extract<DayRequest, { kind: "vague-move" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const day = await deps.readDay().catch(() => undefined);
  if (!day) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = nowMin(deps);
  const b = findBlock(r.name, day, now, { ahead: true });
  if (!b) return { flow: say(`There's no ${r.name} left on today's calendar, so there's nothing to move. Want me to add it ${r.when}?`), facts: [], writes: 0 };
  if (isFixed(b) && !b.nameable) return { flow: say(`${label(b)} is a class or a plan with people, so it doesn't move. Nothing changed.`), facts: [], writes: 0 };
  const len = toMin(b.end) - toMin(b.start);
  // "later" alone has no natural time: one question, with the options.
  if (/^(?:later|later today)$/.test(r.when)) {
    const dinner = day.blocks.find((k) => /\bdinner\b/i.test(k.title) && toMin(k.start) > now);
    const opt = dinner ? `after ${label(dinner)} (${ampm(toMin(dinner.end) + 5)})` : `after dinner, around ${ampm(EVENING_DEFAULT)}`;
    return { flow: { outcome: "say", kind: "ask", text: `Later to when? I can put ${label(b)} ${opt}, or tell me a time. Nothing's changed yet.` }, facts: [], writes: 0 };
  }
  const x = runner(deps);
  let args: string[]; let assumed = ""; let target: number | undefined;
  const anchorName = /^(after|before) (?:my |the )?(.+)$/.exec(r.when);
  const anchorWord = anchorName?.[2];
  const named = !anchorWord ? undefined : /^(?:class|classes|lecture)$/.test(anchorWord)
    ? day.blocks.filter((k) => k.kind === "class" && toMin(k.end) > now).sort((p, q) => toMin(p.start) - toMin(q.start))[0]
    : findBlock(anchorWord, day, now, { ahead: true });
  if (named && named !== b) {
    if (anchorName![1] === "after") args = ["move", b.title, "--after", named.title];
    else { target = toMin(named.start) - len - 5; args = ["move", b.title, "--to", hhmm(target)]; }
  } else {
    const d = WHEN_DEFAULT.find(([re]) => re.test(r.when));
    if (!d) return { flow: { outcome: "say", kind: "ask", text: `There's no ${anchorName?.[2] ?? r.when} left today. When should ${label(b)} go instead? Nothing's changed.` }, facts: [], writes: 0 };
    target = Math.max(d[1], ceil5(now + 5));
    assumed = ` (I took ${d[2]} as ${ampm(target)}; say a time if you meant another)`;
    args = ["move", b.title, "--to", hhmm(target)];
  }
  if (target !== undefined && (target < now || target + len > 1440)) return { flow: say(`${label(b)} can't go ${r.when} today: ${target < now ? "that time has passed" : "it would run past midnight"}. Nothing changed.`), facts: [], writes: 0 };
  const out = await x.exec(args);
  if (!out.ok) return { flow: say(`I couldn't move ${label(b)} ${r.when}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}, so it's still at ${ampm(toMin(b.start))}.`, x.calls, x.outputs), facts: [], writes: 0 };
  const placed = placedAt(out.stdout, b.title);
  const startSaid = placed && !placed.includes("–") ? /(\d{1,2}):(\d{2}) (AM|PM)/.exec(placed) : null;
  const startMin = startSaid ? (Number(startSaid[1]) % 12) * 60 + Number(startSaid[2]) + (startSaid[3] === "PM" ? 720 : 0) : undefined;
  const where = startMin !== undefined ? `${ampm(startMin)}–${ampm(startMin + len)}` : placed ?? (target !== undefined ? `${ampm(target)}–${ampm(target + len)}` : `after ${label(named!)}`);
  return { flow: done(`Done: ${label(b)} moved to ${where}${assumed}, still ${len} minutes. ${UNDO}`, x.calls, x.outputs), facts: [], writes: x.writes };
}

async function runUnnamedMove(r: Extract<DayRequest, { kind: "unnamed-move" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const day = await deps.readDay().catch(() => undefined);
  if (!day) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = nowMin(deps);
  const own = day.blocks.filter((b) => !isFixed(b) && b.kind !== "commute" && toMin(b.end) > now).sort((p, q) => toMin(p.start) - toMin(q.start));
  const b = own.find((k) => toMin(k.start) <= now) ?? own[0];
  const s = parseClock(r.at); const res = s ? resolveStart(s, { day: "today", now, part: "evening" }) : undefined;
  if (!b) return { flow: { outcome: "say", kind: "ask", text: "Which block moved? Nothing of yours is left on today's calendar, so I haven't changed anything." }, facts: [], writes: 0 };
  if (!res || !("at" in res)) return { flow: say(`${res && "passed" in res ? `${ampm(res.passed)} has already passed` : `I couldn't read "${r.at}" as a time`}, so I haven't moved ${label(b)}.`), facts: [], writes: 0 };
  const len = toMin(b.end) - toMin(b.start);
  // REV2 finding 6: "it" is a guess. The block he is in is the natural reading; a NEXT block that is gym (the daily anchor) or study
  // (deadline work) is never moved on a guess: one question instead.
  const kind = b.kind ?? (/\bgym\b/i.test(b.title) ? "gym" : /\b(?:study|revis|homework)/i.test(b.title) ? "study" : "other");
  if ((kind === "gym" || kind === "study") && toMin(b.start) > now) return { flow: { outcome: "say", kind: "ask", text: `Which block moved to ${ampm(res.at)}? The next one of yours is ${label(b)}, and I don't move that on a guess. Nothing's changed yet.` }, facts: [], writes: 0 };
  if (res.at + len > 1440) return { flow: say(`${label(b)} at ${ampm(res.at)} would run past midnight, so I haven't moved it. Nothing changed.`), facts: [], writes: 0 };
  const x = runner(deps);
  const out = await x.exec(["move", b.title, "--to", hhmm(res.at)]);
  if (!out.ok) return { flow: say(`I couldn't move ${label(b)} to ${ampm(res.at)}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}, so nothing changed.`, x.calls, x.outputs), facts: [], writes: 0 };
  return { flow: done(`Done: ${label(b)} is now ${ampm(res.at)}–${ampm(res.at + len)} (I took "it" to be ${label(b)}, the ${toMin(b.start) <= now ? "block you're in now" : "next block of yours"}; say "undo" if you meant another).`, x.calls, x.outputs), facts: [], writes: x.writes };
}

async function runCatchUp(r: Extract<DayRequest, { kind: "catch-up" }>, deps: RequestDeps): Promise<RequestOutcome> {
  const day = await deps.readDay().catch(() => undefined);
  const now = nowMin(deps);
  const cls = day ? findBlock(r.what, day, now) : undefined;
  const short = cls ? (/^[A-Z]{2,5}\d{3,5}\b/.exec(cls.title)?.[0] ?? label(cls)) : cap(r.what);
  const fact = await deps.run("orion-declare", ["add", "--kind", "skip", "--text", `skipped ${r.what}`, "--title", cls?.title ?? r.what]).catch(() => ({ stdout: "", code: 1 }));
  let id: string | undefined;
  try { const f = JSON.parse(fact.stdout.trim().split("\n").at(-1) ?? "") as { id?: unknown }; if (fact.code === 0 && typeof f.id === "string") id = f.id; } catch { /* not saved */ }
  const at = r.part ? PART_AT[r.part] : undefined;
  if (r.day === "today" && at !== undefined && at <= now) return { flow: say(`${ampm(at)} has already passed today, so I haven't booked the catch-up. Want it tomorrow?`), facts: id ? [id] : [], writes: 0 };
  const x = runner(deps);
  const title = `${short} catch-up`;
  const out = await x.exec(["add", title, String(r.minutes), ...(at !== undefined ? ["--at", hhmm(at)] : []), ...(r.day === "tomorrow" ? ["--date", "tomorrow"] : []), ...(r.minutesSaid ? ["--length-explicit"] : [])]);
  const noted = id ? `Noted you skipped ${short}. ` : "";
  if (!out.ok) return { flow: say(`${noted}I couldn't fit the catch-up in ${r.day}${whyNot(out.stdout) ? ` (${whyNot(out.stdout)})` : ""}, so nothing else changed.`, x.calls, x.outputs), facts: id ? [id] : [], writes: 0 };
  const where = placedAt(out.stdout, title) ?? (at !== undefined ? `at ${ampm(at)}` : "");
  return { flow: done(`${noted}Booked ${title} ${r.day}${where ? ` ${where}` : ""}, ${r.minutes} minutes${at !== undefined ? ` (I took ${r.part} as ${ampm(at)})` : ""}. ${UNDO}`, x.calls, x.outputs), facts: id ? [id] : [], writes: x.writes };
}

/** Carries a day request out with fixed scheduler calls; the reply is built from what the scripts printed. */
export async function runDayRequest(r: DayRequest, deps: RequestDeps): Promise<RequestOutcome> {
  if (r.kind === "named-write") return runNamedWrite(r, deps);
  if (r.kind === "multi-day") return runMultiDay(r, deps);
  if (r.kind === "vague-move") return runVagueMove(r, deps);
  if (r.kind === "unnamed-move") return runUnnamedMove(r, deps);
  if (r.kind === "catch-up") return runCatchUp(r, deps);

  if (r.kind === "deadline") return runDeadline(r, deps);
  if (r.kind === "clauses") return runClauses(r, deps);
  if (r.kind === "to-tomorrow") return runTomorrow(r, deps);
  if (r.kind === "then") return runThen(r, deps);
  return runClearOwned(r, deps);
}

/** Today's date as orion-reschedule reads it, for a caller that needs a yesterday ("before 5 AM, last night is yesterday"). */
export const yesterdayOf = (now: Date) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12));
