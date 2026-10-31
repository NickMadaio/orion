/*
 Reading the two halves of a proactive loop (2026-10-31, gate run-1031202318 clusters 1 and 8): what ORION offered in the message it
 sent first, and what kind of answer his short reply is. Pure: strings in, values out. pending-reply.ts plans and carries out the rest.

 The offers are the texts ORION's own senders write (scripts/lib/reach/plan-ladder.mjs rungs and closing lines, class-ladder.mjs
 leave and missed-class lines, proactive.mjs "Session done", curiosity words.mjs off-plan question, the morning brief head, the
 bedtime lines). The replies are read by shape (yes, a time, a reason, "whenever"), never by a list of whole sentences.
*/
import { titleOf } from "./outreach-reply.js";

export type Offer =
  | { kind: "start"; title: string }
  | { kind: "leave"; title: string; leaveIn: number; classAt?: number }
  | { kind: "bedtime" }
  | { kind: "catchup"; subject?: string }
  | { kind: "slipped"; title: string }
  | { kind: "brief"; items: string[] }
  | { kind: "session-done"; next?: string }
  | { kind: "plan-check"; title: string };

export type Part = "morning" | "afternoon" | "evening";
/** What a counter-offer names: a day, a part of it, a clock time (minutes after midnight), a length, a block to follow. */
export type Details = { day?: "today" | "tomorrow"; part?: Part; at?: number; minutes?: number; after?: string };

export type Reply =
  | { kind: "accept"; pick: boolean }
  | { kind: "indifferent" }
  | { kind: "decline" }
  | { kind: "done" }
  | { kind: "resume" }
  | { kind: "changed" }
  | { kind: "defer"; minutes?: number; activity?: string; typical?: number }
  | { kind: "awake"; activity?: string; minutes?: number; sleepless: boolean; workload: boolean }
  | { kind: "workload" }
  | { kind: "next" }
  | { kind: "counter"; details: Details; text: string };

const clean = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const words = (s: string): number => (s.match(/[a-z0-9']+/gi) ?? []).length;

// ---------------------------------------------------------------- offers

const LEAVE = /^leave in (\d{1,3}) min for (.+?) at (\d{1,2}):(\d{2})\s*(am|pm)?/i;
const CATCHUP = /\b(?:fit|find|make|book|put) (?:in )?(?:some )?time to catch up\b|\bcatch(?:-| )?up (?:on|block|time)\b.*\?/i;
const MISSED = /^(?:looks like )?(.+?) didn'?t happen\b/i;
const GAVE_UP = /\bstop pinging (?:you )?about (.+?)(?:[.\-–—!]|$)/i;
const BRIEF = /\btop of (?:your|the) list:\s*(.+?)(?:\.|$)/i;
const SESSION_DONE = /^session done\b/i;
const NEXT_IN = /\bnext: (.+?) at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i;
const PLAN_CHECK = /\bis (.+?) still (?:happening|on)\b/i;
const BEDTIME = /\b(?:bedtime|past bedtime|bed now|still up at|sleep now|go to (?:bed|sleep)|get to bed)\b/i;

const to24 = (h: number, m: number, mer?: string): number => {
  const hh = mer ? (h % 12) + (mer.toLowerCase() === "pm" ? 12 : 0) : h;
  return hh * 60 + m;
};

/** The offer in ORION's own message; undefined when it is not one this module carries out. */
export function offerOf(text: string): Offer | undefined {
  // A quoted line under a speaker tag ('ORION morning brief: "Top of your list: …"') is read as the line itself.
  const t = text.trim().replace(/^ORION\b[^:"]{0,30}:\s*/i, "").replace(/^"([\s\S]*)"$/, "$1").trim();
  const leave = t.match(LEAVE);
  if (leave) return { kind: "leave", title: leave[2]!.trim(), leaveIn: Number(leave[1]), classAt: to24(Number(leave[3]), Number(leave[4]), leave[5]) };
  if (BEDTIME.test(t) && !/\bsession done\b/i.test(t.slice(0, 14)) || /\bsession done\b.*past bedtime/i.test(t)) return { kind: "bedtime" };
  if (SESSION_DONE.test(t)) { const n = t.match(NEXT_IN); return { kind: "session-done", ...(n ? { next: `${n[1]!.trim()} at ${n[2]!.trim()}` } : {}) }; }
  if (CATCHUP.test(t)) { const m = t.match(MISSED); return { kind: "catchup", ...(m ? { subject: m[1]!.trim() } : {}) }; }
  const gave = t.match(GAVE_UP);
  if (gave) return { kind: "slipped", title: gave[1]!.trim() };
  const missed = t.match(MISSED);
  if (missed && /\b(?:tonight|tomorrow|later today|today off|skip)\b/i.test(t)) return { kind: "slipped", title: missed[1]!.trim() };
  const brief = t.match(BRIEF);
  if (brief) { const items = brief[1]!.split(/\s*(?:,|\band\b|&|\+)\s*/i).map((s) => s.trim()).filter(Boolean); if (items.length) return { kind: "brief", items }; }
  const plan = t.match(PLAN_CHECK);
  if (plan) return { kind: "plan-check", title: plan[1]!.replace(/^(?:your|the|my)\s+/i, "").trim() };
  const start = titleOf(t);
  if (start) return { kind: "start", title: start };
  return undefined;
}

// ---------------------------------------------------------------- replies

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, "a few": 5, "a couple": 10, "half an": 30 };
const N = String.raw`(\d{1,3}|a few|a couple|half an|an|a|one|two|three|four|five|ten|fifteen|twenty|thirty|forty five)`;
const LENGTH = new RegExp(String.raw`\b${N}\s*(?:more\s+)?(min|mins|minutes|m|hr|hrs|hour|hours|h)\b`, "i");
const BARE_MORE = /\b(\d{1,3}|five|ten|fifteen|twenty|thirty)\s+more\b/i;
const lengthOf = (m: string): number | undefined => {
  const x = m.match(LENGTH);
  if (x) {
    const n = /^\d+$/.test(x[1]!) ? Number(x[1]) : NUMBER_WORDS[x[1]!.toLowerCase()] ?? NaN;
    const v = /^h/i.test(x[2]!) ? (x[1] === "half an" ? 30 : n * 60) : n;
    return Number.isFinite(v) && v > 0 && v <= 600 ? v : undefined;
  }
  const b = m.match(BARE_MORE);
  if (b) { const n = /^\d+$/.test(b[1]!) ? Number(b[1]) : NUMBER_WORDS[b[1]!.toLowerCase()] ?? NaN; return n > 0 && n <= 240 ? n : undefined; }
  return undefined;
};

const CLOCK_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, noon: 12 };
const CLOCK = /\b(?:at|@|for|by|around|to)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?!\s*(?:min|mins|minutes|hr|hrs|hours?|h\b|m\b|more))\b/gi;
const CLOCK_WORD = /\b(?:at|@|around|by|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon)\b/i;

/** Every clock time in his words, in order, with where it was said: "9am", "at 4", "8:30", "at eight". A length ("25 min") is not a time. */
export function clockTimes(m: string): Array<{ at: number; index: number; meridiem: boolean }> {
  const out: Array<{ at: number; index: number; meridiem: boolean }> = [];
  for (const x of m.matchAll(CLOCK)) {
    const h = Number(x[1]); const min = Number(x[2] ?? 0);
    const mer = x[3]?.replace(/\./g, "");
    const lead = /^\s*(?:at|@|by|around|to)\b/i.test(x[0]);
    if (!mer && !x[2] && !lead) continue;   // a bare number is a count, not a clock
    if (h > 23 || min > 59 || (mer && (h < 1 || h > 12))) continue;
    out.push({ at: to24(h, min, mer), index: x.index ?? 0, meridiem: !!mer || h > 12 });
  }
  const w = m.match(CLOCK_WORD);
  if (w) out.push({ at: CLOCK_WORDS[w[1]!.toLowerCase()]! * 60, index: w.index ?? 0, meridiem: w[1] === "noon" });
  return out.sort((a, b) => a.index - b.index);
}

const TOMORROW = /\b(?:tomorrow|tmrw|tmr|tmrow|2moro|tomoz)\b/i;
const TONIGHT = /\b(?:tonight|this evening|later today|today)\b/i;
const PART: Array<[RegExp, Part]> = [[/\bmorning\b|\bfirst thing\b|\bearly\b/i, "morning"], [/\bafternoon\b|\bafter lunch\b/i, "afternoon"], [/\bevening\b|\btonight\b/i, "evening"]];
const AFTER = /\bafter (?:my |the |his )?([a-z][a-z0-9' ]{1,30}?)(?=\s+(?:tomorrow|tmrw|today|tonight|on|at|for|then|and)\b|[,.!?]|$)/i;

/** The details of a counter-offer, or undefined when it names none. */
export function detailsOf(message: string): Details | undefined {
  const m = clean(message);
  const times = clockTimes(m);
  const minutes = lengthOf(m);
  const after = m.match(AFTER)?.[1]?.trim();
  const part = PART.find(([re]) => re.test(m))?.[1];
  const day = TOMORROW.test(m) ? "tomorrow" : TONIGHT.test(m) ? "today" : undefined;
  const d: Details = { ...(day ? { day } : {}), ...(part ? { part } : {}), ...(times[0] ? { at: times[0].at } : {}), ...(minutes ? { minutes } : {}), ...(after && !/^(?:that|this|it|which)$/.test(after) ? { after } : {}) };
  return Object.keys(d).length ? d : undefined;
}

const YES = /^(?:y|ya|yah|yea|yeah|yes|yep|yup|ye|ok|okay|k|kk|sure|fine|alright|aight|bet|cool|sounds good|go for it|do it|please|pls|for sure|deal|go ahead|i guess|yeah ok|ok fine|fine ok|okay fine|ight|thanks|thank you|thx|ty|got it|noted|omw|on my way|going|going now|leaving|leaving now|heading out|on it)(?: (?:then|do it|go ahead|please|pls|sure|fine|thanks|thx|orion))*$/;
const YES_LEAD = /^(?:y|ya|yea|yeah|yes|yep|yup|ok|okay|sure|fine|alright|bet|go ahead|do it)\b/;
const PICK = /\b(?:whenever|whenevs|any ?time|you pick|you choose|your call|up to you|wherever it fits|whatever works|whatever fits|idc when|dont care when|don'?t care when|whenever works|when ?ever is good)\b/;
const INDIFFERENT = /^(?:whatever|w\/e|meh|idk|i dunno|dunno|eh|fine whatever|sure whatever|ugh|k whatever|i guess whatever)$/;
const SILENT = /^[.…\s]*$/;
const NO = /^(?:no|nope|nah|naw|not today|no thanks|nah thanks|pass|skip it|no skip it|leave it|nah leave it|not really)$/;
const CHANGED = /\b(?:changed|change of plans?|plans? changed|not happening|isn'?t happening|aint happening|not anymore|called off|got cancell?ed|cancell?ed|scrapped|fell through|not going|didn'?t go)\b/;
const DONE = /^(?:done|all done|finished|did it|done already|already did(?: it)?|i already did(?: it)?|already done|completed|just finished)$/;
const RESUME = /\b(?:done|finished|through) (?:eating|with (?:food|dinner|lunch|breakfast|my food|the call|my call)|showering|my (?:food|dinner|lunch|call|shower))\b|\b(?:i'?m|im|i am) back\b|\bback now\b|\b(?:ate|eaten|showered)\b(?! nothing)|\bfed\b|\bok(?:ay)? (?:ready|let'?s go)\b|^ready$/;
const ACTIVITY: Array<[RegExp, string, number]> = [
  [/\bmeal ?prep\w*|\bcook(?:ing)?\b|\bmaking (?:food|dinner|lunch)\b/, "cooking", 25],
  [/\b(?:eat|eating|food|hungry|starving|famished|lunch|dinner|breakfast|snack|grab(?:bing)? (?:a )?bite)\b/, "eating", 25],
  [/\bshower(?:ing)?\b/, "a shower", 20],
  [/\b(?:on a call|phone call|call|facetime|zoom|meeting)\b/, "the call", 20],
  [/\b(?:bathroom|toilet|loo|pee)\b/, "the bathroom", 5],
  [/\blaundry\b/, "laundry", 20],
];
const FIRST_OR_INTENT = /\b(?:first|before|gonna|going to|gna|need to|have to|gotta|let me|lemme|im|i'?m|real quick|quickly)\b|^(?:need|want)\b/;
const HOLD = /^(?:hold on|hang on|wait|one sec|1 sec|gimme|give me|not yet|in a (?:bit|sec|min|minute)|soon|later|nearly|almost)\b/;
const SLEEPLESS = /\b(?:can'?t|cant|cannot|couldn'?t) (?:sleep|fall asleep|get to sleep)\b|\bnot (?:tired|sleepy)\b|\bwide awake\b|\binsomnia\b|\bbrain won'?t (?:stop|shut off)\b/;
const WORKLOAD = /\b(?:a lot|so much|too much|tons|loads|a ton|heaps)\b.{0,12}\b(?:to do|of work|of stuff|due|left)\b|\bso behind\b|\bfalling behind\b|\bhave to finish\b|\bneed to finish\b|\bgot work\b|\bstill have work\b/;
const UP_DOING = /\b(?:i'?m|im|i am|still|just)\s+(?:up\s+|still\s+)?(?:working on|doing|finishing|studying|writing|reading|coding)\s+([a-z][a-z ]{1,30}?)(?=\s+(?:rn|right now|now|first|then)\b|\s+\d|[,.!]|$)|\b(?:finish|finishing)\s+(?:this|my|the)\s+([a-z][a-z ]{1,30}?)(?=\s+(?:first|then|rn)\b|[,.!]|$)/;
const NEXT = /\bwhat(?:'?s| is)? (?:next|now|after this|after that)\b|\bwhat (?:do|should) i (?:do )?(?:now|next)\b|\bwhat now\b|\bwhats next\b|\bwhere am i (?:at|supposed to be)\b/;
/** His own words for what he is doing ("i'm meal prepping"), said back to him instead of the category. */
const OWN_GERUND = /\b(?:i'?m|im|i am)\s+(?:just\s+|still\s+)?((?:[a-z]+ )?[a-z]+ing)\b/;
/** He asked for quiet: the bedtime line's own handling (outreach-reply.ts) answers that, not a cap. */
export const HUSH = /\b(?:shush|shut up|leave me alone|go away|stop nagging|stop it)\b/;
/** A request of his own in the reply ("not yet, but can you move gym to 8"): the normal turn's, with the context. */
export const REQUEST = /\b(?:move|add|put|book|schedule|reschedule|cancel|drop|remind|text|email|play|clear|delete|remove|log|push)\b|\b(?:can|could|would|will) you\b|\bset (?:an?|my|the) \b|\bstart (?:a|an|my|the) (?:focus|session|timer)\b/;
/** A preface to a request of his own ("one more thing", "quick question"), never an answer. */
const PREFACE = /^(?:ok(?:ay)? |wait |oh |also |hey )?(?:one more thing|quick question|actually|also|btw|by the way|hold up i have)\b/;

/** At most this many words for a reply code reads against the offer; a longer message is a request of its own. */
export const REPLY_MAX_WORDS = 16;

/** What his reply is, read against nothing yet (the offer decides what each kind means); undefined when it is not a reply. */
export function readReply(message: string): Reply | undefined {
  const raw = clean(message);
  if (SILENT.test(raw)) return { kind: "indifferent" };
  const m = raw.replace(/[!,…]+/g, " ").replace(/\.+$/g, "").replace(/\s+/g, " ").trim();
  if (words(m) > REPLY_MAX_WORDS || PREFACE.test(m)) return undefined;
  const question = /\?\s*$/.test(m);
  if (NEXT.test(m)) return { kind: "next" };
  if (question) return undefined;
  const plain = m.replace(/[.]/g, " ").replace(/\s+/g, " ").trim();
  if (INDIFFERENT.test(plain)) return { kind: "indifferent" };
  if (NO.test(plain)) return { kind: "decline" };
  if (DONE.test(plain)) return { kind: "done" };
  if (RESUME.test(plain) && !/\b(?:gonna|going to|need to|first)\b/.test(plain)) return { kind: "resume" };
  const sleepless = SLEEPLESS.test(plain); const workload = WORKLOAD.test(plain);
  const doing = plain.match(UP_DOING); const activityWord = (doing?.[1] ?? doing?.[2])?.replace(/^(?:my|the|this|some)\s+/, "").trim();
  const minutes = lengthOf(plain);
  if (sleepless || (doing && /\bup\b|\bstill\b|\bfinish/.test(plain))) return { kind: "awake", sleepless, workload, ...(activityWord ? { activity: activityWord } : {}), ...(minutes ? { minutes } : {}) };
  if (workload) return { kind: "workload" };
  const act = ACTIVITY.find(([re]) => re.test(plain));
  const own = plain.match(OWN_GERUND)?.[1];
  if (act && (FIRST_OR_INTENT.test(plain) || words(plain) <= 3)) return { kind: "defer", activity: own && act[0].test(own) && !/\b(?:starving|famished|dying)\b/.test(own) ? own : act[1], typical: act[2], ...(minutes ? { minutes } : {}) };
  if (HOLD.test(plain) || (minutes && /\bmore\b/.test(plain) && words(plain) <= 6)) return { kind: "defer", ...(minutes ? { minutes } : {}) };
  if (doing && activityWord) return { kind: "defer", activity: activityWord };
  if (CHANGED.test(plain) && words(plain) <= 6) return { kind: "changed" };
  const details = detailsOf(plain);
  if (details) return { kind: "counter", details, text: plain };
  if (PICK.test(plain)) return { kind: "accept", pick: true };
  if (YES.test(plain) || (YES_LEAD.test(plain) && words(plain) <= 3)) return { kind: "accept", pick: false };
  return undefined;
}

/** "eat for 25 min then start cs lab, hold me to it": a pause with its length and what starts after it, said without any outreach. */
const THEN_START = /\b(?:gonna|going to|gna|let me|lemme|i'?ll|ill|i will|im|i'?m)\s+(?:go\s+)?([a-z][a-z ]{1,25}?)\s+(?:for\s+(\d{1,3})\s*(?:min|mins|minutes|m)\b|first)\s*,?\s*(?:and\s+)?then\s+(?:i'?ll\s+|ill\s+)?(?:start|do|get (?:on|to|started on)|hit|begin)\s+(?:on\s+|with\s+)?(?:the\s+|my\s+)?([a-z][a-z0-9 ]{1,30}?)(?=\s*(?:,|\.|!|$|\s+hold me|\s+keep me|\s+make sure|\s+and\s+(?:hold|keep|make)))/i;
export function pauseThenStart(message: string): { activity: string; minutes?: number; typical?: number; title: string } | undefined {
  const x = clean(message).match(THEN_START);
  if (!x) return undefined;
  const act = ACTIVITY.find(([re]) => re.test(x[1]!));
  return { activity: act?.[1] ?? x[1]!.trim(), ...(x[2] ? { minutes: Number(x[2]) } : {}), ...(act ? { typical: act[2] } : {}), title: x[3]!.trim() };
}
