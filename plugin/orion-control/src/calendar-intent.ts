/*
 The calendar intent layer (2026-10-20 re-run, docs/audits/2026-10-20-live-as-nick.md). Nick's casual sentence becomes ONE structured
 change before anything runs:

   verb   add | move | replan | reorder | remove | extend
   items  each { name, start?, end?, minutes?, fromNow? } with its clock already resolved for the day (intent-time.ts)
   anchor after a named block, after getting home, or now
   day    today | tomorrow

 Code then carries it out (intent-run.ts). The gate is allow-only (intent-gate.ts): a question, a take-back, doubt, hearsay, a
 negation or second thoughts is refused, on the raw and the typo-fixed text. Anything that is not one of the shapes below, or names
 another day, returns a refusal and goes the normal way: this layer never guesses.
*/
import { parseReorder, parseReplanRequest, type ReplanAsk } from "./day-replan.js";
import { readUntilShape } from "./direct-add.js";
import { COURTESY, fixTypos, refusalOf, TAKEN_BACK, type Refusal } from "./intent-gate.js";
import { ceil5, CLOCK, hhmm, parseClock, resolveEnd, resolveStart, spokenTimesToDigits, takeLength, toMin, type ClockContext, type DayWord } from "./intent-time.js";
import type { AskContext } from "./schedule-flow.js";

export type Verb = "add" | "move" | "replan" | "reorder" | "remove" | "extend";
/** A clock that cannot be used as said: already behind him today, or 9 tomorrow with no am/pm. */
export type TimeIssue = { kind: "passed"; at: string; field: "start" | "end" } | { kind: "past-midnight"; at: string } | { kind: "ambiguous"; choices: [string, string] } | { kind: "from-now-not-today" };
/** endSaid: an extend's end as he said it ("9"), read against the block's own start when the day is known. */
export type IntentItem = { name: string; start?: string; end?: string; minutes?: number; fromNow?: boolean; by?: number; endSaid?: string; issue?: TimeIssue };
export type IntentAnchor = { kind: "block"; name: string } | { kind: "home" } | { kind: "now" } | { kind: "first-class" };
export type CalendarIntent = {
  verb: Verb; items: IntentItem[]; day: DayWord; anchor?: IntentAnchor;
  /** replan / reorder: the request as the day planner reads it (day-replan.ts). */
  replan?: ReplanAsk;
  /** reorder: names in the follow-up that the remembered request did not have ("dinner then gym"): never reordered. */
  outside?: string[];
  /** add: "yes" to ORION's own offer, or the "put X [from now] until T" sentence (direct-add.ts reads it against the day). */
  until?: true;
  /** move: "push everything 30 min" — every block of his still ahead today, by the same minutes */
  all?: true;
  /** the remembered request's date, when a follow-up acts on it */
  date?: string;
};
export type IntentRead = { intent: CalendarIntent } | { refused: Refusal | "unparsed" | "other-day"; tookBack?: true };
/** What a follow-up needs from the request before it: the request, and the date it was for. */
export type IntentMemory = ReplanAsk;

// Any other day, said any way (review 2026-10-20: "add gym at 6 thurs" booked "gym thurs" today). Over-cautious on purpose: a false hit only means the normal path.
const WEEKDAY = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|weds|thu|thur|thurs|fri|sat|sun|mondays?|weekends?|week|month|year|days|fortnight|the day after|tmrw night after)\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}\b|\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;
const TOMORROW = /\b(?:tomorrow|tmrw|tmr|tmrow|tomoz|2moro|2morrow)\b/i;
const LATE_NIGHT_UNTIL = 5;
export const PART = (t: string): ClockContext["part"] => (/\b(?:tonight|this evening|evening|night|this afternoon|afternoon)\b/i.test(t) ? "evening" : /\bmorning\b/i.test(t) ? "morning" : undefined);
const norm = (t: string): string => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The day his words are for: today, tomorrow, or another day (not this layer's). Before 5 AM "tomorrow" is asked about by the normal path. */
function dayOf(text: string, now: Date): DayWord | "other" {
  if (WEEKDAY.test(text)) return "other";
  if (TOMORROW.test(text)) return now.getHours() >= LATE_NIGHT_UNTIL ? "tomorrow" : "other";
  return "today";
}

// ---- titles: a short name in his words, never a placeholder, a reminder or a list ----
const NOT_A_NAME = /\b(?:and|then|or|but|if|so|with|because|after|before|between|until|till|from|instead|every|each|daily|weekly|something|anything|stuff|thing|things|reminder|remind|alarm|wake|timer|todo|to-do|task|tasks|table|flight|train|hotel|uber|taxi|cab|ride|ticket|tickets|text|email|message|lights?|music|everything|all|it|that|this|them|those|rest|ish|now|case|just|in|on|next|maybe|later|soon|sometime|today|tonight|tomorrow)\b/i;
const FILLER = /\b(?:please|pls|for me|on my calendar|to my calendar|in my calendar|on my day|to my day|in there|real quick|tho|though|today|tonight|tomorrow|this (?:morning|afternoon|evening)|morning|afternoon|evening|night)\b/gi;
function cleanName(t: string): string | undefined {
  const name = t.replace(FILLER, " ").replace(/^\s*(?:in|down|me in|me down|me for|for|out for|off for|aside for|time for)\s+/i, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:a|an|some|my|the|another|one|quick|short|little)\s+)+/i, "").replace(/\s+(?:in|for|on)$/i, "").trim();
  if (!name || name.split(" ").length > 4 || !/^[a-z][a-z' &-]*$/i.test(name) || NOT_A_NAME.test(name)) return undefined;
  return name;
}

const LEAD_VERB_ADD = /^(?:put|add|schedule|book|pencil(?:\s+in)?|slot(?:\s+in)?|block(?:\s+(?:off|out))?|set\s+aside|make\s+time|carve\s+out)\s+/i;
const AT = new RegExp(String.raw`\bat\s+(?<t>${CLOCK})(?![\w:])`, "i");
/** "can u put a 45 min walk tomorrow at 5", "add gym at 6pm", "book a 30 min nap at 3": an add at a time (or with a length), today or tomorrow. */
function readTimedAdd(text: string, day: DayWord, now: number | null): CalendarIntent | undefined {
  const body = text.replace(COURTESY, "").trim();
  if (!LEAD_VERB_ADD.test(body)) return undefined;
  let rest = body.replace(LEAD_VERB_ADD, "").replace(/[.!]+$/, "").trim();
  if (/\b(?:until|till|til|from|after|before|between|and|then|instead|every|each|ish|around \d)\b|\d\s*-\s*\d|,/i.test(rest)) return undefined;
  const length = takeLength(rest); rest = length.rest;
  const at = rest.match(AT);
  if (at) rest = `${rest.slice(0, at.index)} ${rest.slice(at.index! + at[0].length)}`;
  if (/\d/.test(rest)) return undefined;
  const name = cleanName(rest);
  if (!name || (!at && !length.minutes)) return undefined;
  const item: IntentItem = { name, ...(length.minutes ? { minutes: length.minutes } : {}) };
  if (at) {
    const said = parseClock(at.groups!.t!);
    if (!said) return undefined;
    const r = resolveStart(said, { day, now, part: PART(text) });
    if ("at" in r) item.start = hhmm(r.at);
    else if ("passed" in r) item.issue = { kind: "passed", at: hhmm(r.passed), field: "start" };
    else item.issue = { kind: "ambiguous", choices: [hhmm(r.ambiguous[0]), hhmm(r.ambiguous[1])] };
  }
  return { verb: "add", items: [item], day };
}

const MOVE = new RegExp(String.raw`^(?:move|push|shift|bump)\s+(?:my\s+|the\s+)?(?<x>[a-z][a-z' &-]{0,40}?)\s+(?:(?:to|at)\s+(?<t>${CLOCK})|(?<dir1>back|later|forward|earlier)\s+(?:by\s+)?(?<len1>.+?)|(?:by\s+)?(?<len2>.+?)\s+(?<dir2>later|earlier|back|forward))\s*$`, "i");
/** "move gym to 7", "push dinner back 30 min", "push gym 30 min later": one block, one new time. */
function readMove(text: string, day: DayWord, now: number | null): CalendarIntent | undefined {
  const body = text.replace(COURTESY, "").replace(FILLER, " ").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
  const m = body.match(MOVE);
  if (!m?.groups) return undefined;
  const name = cleanName(m.groups.x!);
  if (!name) return undefined;
  if (m.groups.t) {
    const said = parseClock(m.groups.t);
    if (!said) return undefined;
    const r = resolveStart(said, { day, now, part: PART(text) });
    const item: IntentItem = { name };
    if ("at" in r) item.start = hhmm(r.at);
    else if ("passed" in r) item.issue = { kind: "passed", at: hhmm(r.passed), field: "start" };
    else item.issue = { kind: "ambiguous", choices: [hhmm(r.ambiguous[0]), hhmm(r.ambiguous[1])] };
    return { verb: "move", items: [item], day };
  }
  const len = takeLength(m.groups.len1 ?? m.groups.len2 ?? "");
  if (!len.minutes || len.rest) return undefined;
  const earlier = /^(?:forward|earlier)$/i.test(m.groups.dir1 ?? m.groups.dir2 ?? "");
  return { verb: "move", items: [{ name, by: earlier ? -len.minutes : len.minutes }], day };
}

const EXTEND_UNTIL = new RegExp(String.raw`^(?:extend|lengthen|stretch)\s+(?:my\s+|the\s+)?(?<x>[a-z][a-z' &-]{0,40}?)\s+(?:until|till|til|to)\s+(?<t>${CLOCK})\s*$`, "i");
const EXTEND_BY = /^(?:extend|lengthen|stretch)\s+(?:my\s+|the\s+)?(?<x>[a-z][a-z' &-]{0,40}?)\s+(?:by\s+)?(?<len>.+?)\s*$|^(?:give me|add)\s+(?<len2>.+?)\s+more\s+(?:on|of|for|to)\s+(?:my\s+|the\s+)?(?<x2>[a-z][a-z' &-]{0,40}?)\s*$/i;
/** "extend gym until 9", "extend the lab by 20 min", "give me 15 more minutes on reading". */
function readExtend(text: string, day: DayWord, now: number | null): CalendarIntent | undefined {
  const body = text.replace(COURTESY, "").replace(FILLER, " ").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
  const u = body.match(EXTEND_UNTIL);
  if (u?.groups) {
    const name = cleanName(u.groups.x!);
    if (!name || !parseClock(u.groups.t!)) return undefined;
    // The end is read against the block's own start once the day is known (intent-run.ts): "until 9" for a 20:00 gym is 21:00.
    return { verb: "extend", items: [{ name, endSaid: u.groups.t! }], day };
  }
  const b = body.match(EXTEND_BY);
  if (!b?.groups) return undefined;
  const name = cleanName(b.groups.x ?? b.groups.x2 ?? ""); const len = takeLength(b.groups.len ?? b.groups.len2 ?? "");
  if (!name || !len.minutes || len.rest.replace(/\bmore\b/i, "").trim()) return undefined;
  return { verb: "extend", items: [{ name, minutes: len.minutes }], day };
}

const REMOVE = /^(?:drop|remove|cancel|delete|scrap|ditch|nuke|take\s+off|get rid of)\s+(?:my\s+|the\s+)?(?<x>[a-z][a-z' &-]{0,40}?)(?:\s+(?:off|from)\s+my\s+(?:day|calendar))?\s*$/i;
/** "drop gym tomorrow", "cancel the walk", "take off reading": one of his own blocks off the day (a class is the normal path's). */
function readRemove(text: string, day: DayWord): CalendarIntent | undefined {
  const body = text.replace(COURTESY, "").replace(FILLER, " ").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
  const m = body.match(REMOVE);
  const name = m?.groups ? cleanName(m.groups.x!) : undefined;
  return name ? { verb: "remove", items: [{ name }], day } : undefined;
}

/** "put cs lab from now until ten thirty", "yes, put cs lab until 10:30", and a bare yes to ORION's own offer (direct-add.ts). */
function readUntil(raw: string, day: DayWord, now: number | null, ask?: AskContext): CalendarIntent | IntentRead | undefined {
  const text = raw.replace(/\s+(?:tomorrow|tmrw|today|tonight)(\s*[.!?…]*)$/i, "$1");   // the day word is read by dayOf
  const shape = readUntilShape(text);
  const offer = !shape && ask?.suggest && /^\s*(?:yes|yeah|yea|yep|yup|ok(?:ay)?|sure|alright)\b[\s\S]{0,20}$/i.test(raw) && !/\b(?:not|no|later|but)\b/i.test(raw);
  if (!shape && !offer) return undefined;
  // The question, take-back and second-thought checks read the request's own sentence: "I'm fine… I'm just annoyed. Can you please put …?" is a request.
  // What he says AFTER the request is read strictly ("Put CS lab until 10:30. Actually make it 11." / "Or is that too late?" are not that add);
  // what comes before only for questions, doubt and hearsay ("I'm fine… I'm just annoyed. Can you please put …?" is a request).
  const all = text.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  const at = shape ? all.lastIndexOf(shape.sentence) : -1;
  const later = at >= 0 ? all.slice(at + 1) : [];
  const earlier = at >= 0 ? all.slice(0, at) : [];
  const reason = refusalOf(shape?.sentence ?? raw, { lenient: true }) ?? (TAKEN_BACK.test(raw) ? "take-back" : undefined)
    ?? later.map((x) => refusalOf(x) ?? "not-a-request" as const)[0] ?? earlier.map((x) => refusalOf(x, { lenient: true })).find(Boolean);
  if (reason) return { refused: reason };
  const fromNow = !shape || !shape.from || /^(?:right\s+)?now$/i.test(shape.from);
  const name = shape?.said ?? ask!.suggest!;
  const endText = shape?.until ?? ask?.till;
  if (day !== "today" || now === null) {
    // "From now" is only today. Another day's "until" with no start is not this shape: the normal path decides.
    if (fromNow && shape?.from) return { verb: "add", items: [{ name, fromNow, issue: { kind: "from-now-not-today" } }], day, until: true };
    return { refused: "unparsed" };
  }
  // The clocks as the add will use them (direct-add.ts reads the same rules against the day): from now rounded up, the end the next time it shows.
  const startSaid = !fromNow && shape?.from ? parseClock(shape.from) : null;
  const startR = startSaid ? resolveStart(startSaid, { day, now: now - 60 }) : undefined;
  const start = Math.max(ceil5(now), startR && "at" in startR ? startR.at : 0);
  const endSaid = endText ? parseClock(endText) : null;
  const end = endSaid ? resolveEnd(endSaid, start, { day, now }) : undefined;
  const item: IntentItem = { name, fromNow, start: hhmm(start), ...(end && "at" in end ? { end: hhmm(end.at), minutes: end.at - start } : {}),
    ...(end && "passed" in end ? { issue: { kind: "passed" as const, at: hhmm(end.passed), field: "end" as const } } : {}),
    ...(end && "pastMidnight" in end ? { issue: { kind: "past-midnight" as const, at: hhmm(end.pastMidnight - 1440) } } : {}) };
  return { verb: "add", items: [item], day, until: true, anchor: { kind: "now" } };
}

// Live run 3 (2026-10-21): "ok and push everything 30 min" went to the form, then the worker's own `day --rebuild`
// (no such option), whose failure the host appended to the reply. `late N` only clears the next N minutes, so this is its own move (intent-run.ts).
const PUSH_ALL = /^(?:(?:ok(?:ay)?|so|and|yeah|yea|yes|please|pls|can you|can u|could you|just|actually)[,\s]+)*(?:push|move|shift|slide|bump)\s+(?:everything|it all|all of it|the rest(?:\s+of\s+(?:my|the)\s+day)?|everything else|my (?:whole )?day|the whole day)(?:\s+(?:back|later|along|down))?\s+(?:by\s+)?(?<len>(?:\d{1,3}|an?|half an?|one|two)\s*(?:-\s*)?(?:min(?:ute)?s?|m|hours?|hrs?|h)|half an hour|an hour and a half)(?:\s+(?:back|later))?(?:\s+(?:please|pls))?[.!]*$/i;
/** "push everything 30 min", "ok and push the rest of my day back an hour": the minutes, or null. Today only; never a question or a hedge. */
export function pushAllMinutes(message: string): number | null {
  const m = message.trim();
  const hit = PUSH_ALL.exec(m);
  if (!hit?.groups || dayOf(fixTypos(m), new Date(2030, 0, 1, 12)) !== "today" || refusalOf(m, { lenient: true })) return null;
  const { minutes, rest } = takeLength(hit.groups.len!);
  return minutes && !rest ? minutes : null;
}

/** Replan in his words: the items in his order, the anchor, the day. */
function fromReplan(ask: ReplanAsk, day: DayWord, extra: Partial<CalendarIntent> = {}): CalendarIntent {
  const anchor: IntentAnchor = ask.anchor ? { kind: "block", name: ask.anchor } : ask.home ? { kind: "home" } : day === "today" ? { kind: "now" } : { kind: "first-class" };
  const items = ask.order.map((name) => ({ name, ...(ask.lengths?.[norm(name)] ? { minutes: ask.lengths[norm(name)] } : {}) }));
  return { verb: "replan", items, day, anchor, replan: ask, ...extra };
}

// "dinner then gym" after "reschedule tomorrow after my first class, gym first": a follow-up that names something the request did not.
const FOLLOW_LEAD = /^(?:(?:actually|no|nah|wait|ok(?:ay)?|hmm+|so|but|and|uh|um|you can|can you|can u|could you|please|pls|just)[,.\s]+)*(?:(?:do|put|have|make|start with|let'?s do|lets do)\s+)?/i;
const FOLLOW = /^(?:my\s+|the\s+)?(?<x>[a-z][a-z' -]{0,30}?)\s+(?:before|ahead of|first,?\s+then|then)\s+(?:my\s+|the\s+)?(?<y>[a-z][a-z' -]{0,30}?)\s*[.!]*$/i;
function readFollowUp(text: string, last: IntentMemory, now: Date): CalendarIntent | undefined {
  const day = last.day ?? "today";
  // A follow-up that names another day is not about the remembered one ("do gym before resume tomorrow" after a plan for today).
  const said = fixTypos(text);
  if ((TOMORROW.test(said) || WEEKDAY.test(said) || /\b(?:today|tonight)\b/i.test(said)) && dayOf(said, now) !== day) return undefined;
  const date = last.date ? { date: last.date } : {};
  const reorder = parseReorder(text, { order: last.order, ...(last.anchor ? { anchor: last.anchor } : {}), home: last.home, explicit: last.explicit, ...(last.lengths ? { lengths: last.lengths } : {}) });
  if (reorder) return { ...fromReplan({ ...reorder, ...(last.lengths ? { lengths: last.lengths } : {}) }, day, date), verb: "reorder" };
  if (refusalOf(text, { lenient: true, followUp: true })) return undefined;
  const m = fixTypos(text).replace(FOLLOW_LEAD, "").match(FOLLOW);
  const [x, y] = [m?.groups?.x?.trim(), m?.groups?.y?.trim()];
  if (!x || !y || [x, y].some((n) => n.split(/\s+/).length > 4 || !cleanName(n))) return undefined;
  const known = (n: string) => last.order.some((o) => norm(o) === norm(n) || norm(o).split(" ").some((w) => w.length >= 3 && norm(n).split(" ").includes(w)));
  const outside = [x, y].filter((n) => !known(n));
  if (!outside.length) return undefined;
  const ask: ReplanAsk = { order: [x, y], ...(last.anchor ? { anchor: last.anchor } : {}), home: last.home, explicit: true };
  return { ...fromReplan(ask, day, date), verb: "reorder", outside };
}

/**
 * His sentence as one structured change, or why not. ctx.now is the clock; ctx.last is his last reschedule request in this chat
 * (for "actually do resume before gym"); ctx.ask is ORION's open question (for "yes" to its offer).
 */
export function readIntent(message: string, ctx: { now: Date; last?: IntentMemory; ask?: AskContext }): IntentRead {
  const raw = spokenTimesToDigits(message.replace(/\s+/g, " ").trim());
  if (!raw) return { refused: "unparsed" };
  const fixed = fixTypos(raw);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  if (ctx.last) { const f = readFollowUp(raw, ctx.last, ctx.now); if (f) return { intent: f }; }
  const dayWord = dayOf(fixed, ctx.now);
  const until = readUntil(raw, dayWord === "other" ? "today" : dayWord, dayWord === "today" ? nowMin : null, ctx.ask);
  if (until) {
    if ("refused" in until) return until;
    if (dayWord === "other") return { refused: "other-day" };
    return { intent: until as CalendarIntent };
  }
  const reason = refusalOf(raw);
  if (reason) {
    // A request he took back at the end ("resched my day, gim frist, nvrmind") is said back as taken back; nothing is guessed from it.
    const stripped = raw.replace(/[,.\s]*(?:\b(?:jk+|just kidding|kidd?in[g']?|n(?:ever|evr|vr)\s*-?\s*m(?:i|y)?n?d|nevermnd|nvm+|lo+l+z*|lm+a+o+|scratch that|forget (?:it|that)|or not))\W*$/i, "");
    if (reason === "take-back" && stripped !== raw && !refusalOf(stripped) && parseShapes(stripped, ctx)) return { refused: "take-back", tookBack: true };
    return { refused: reason };
  }
  if (dayWord === "other") return { refused: "other-day" };
  const intent = parseShapes(raw, ctx);
  return intent ? { intent } : { refused: "unparsed" };
}

function parseShapes(raw: string, ctx: { now: Date }): CalendarIntent | undefined {
  const fixed = fixTypos(raw);
  const day = dayOf(fixed, ctx.now);
  if (day === "other") return undefined;
  const now = day === "today" ? ctx.now.getHours() * 60 + ctx.now.getMinutes() : null;
  const replan = parseReplanRequest(raw);
  if (replan) return fromReplan(replan, day);
  // "ok and push everything 30 min" (live run 3): every block of his still ahead today slides that much; classes stay.
  const pushAll = day === "today" ? pushAllMinutes(raw) : null;
  if (pushAll !== null) return { verb: "move", items: [{ name: "everything", by: pushAll }], day, all: true };
  return readTimedAdd(fixed, day, now) ?? readMove(fixed, day, now) ?? readExtend(fixed, day, now) ?? readRemove(fixed, day);
}

/** The intent, when there is one (anything else: the normal path). */
export const parseCalendarIntent = (message: string, ctx: { now: Date; last?: IntentMemory; ask?: AskContext }): CalendarIntent | undefined => {
  const r = readIntent(message, ctx);
  return "intent" in r ? r.intent : undefined;
};

/** Minutes of an item's start, when it has one. */
export const startOf = (it: IntentItem): number | undefined => (it.start ? toMin(it.start) : undefined);
