/*
 Reading what Nick says about his sleep plan (W10-B, 2026-11-02). Pure; sleep-plan-flow.ts acts on it.

 Nick: "if I tell him 'im going to start waking up earlier and going to bed earlier', he helps and works with that: asks approx what
 time I want to get up (6am, for the gym), I tell him only Mon/Wed/Thu. I want to wake at least 3 hours before a class. Tue and Fri my
 class is 1:30pm so I wake at the normal 9am." And: projected sleep under 6 h shuts him down, unless he is out with friends (a party,
 a bar) or doing schoolwork; gaming or idling does not count. He can talk ORION into that exception for a night.

 Read here:
   - a habit statement about waking or sleeping earlier/later ("trying to be up earlier from now on", "fix my sleep schedule"), and a
     standing alarm ("wake me at 6 every weekday", which the one-off wake alarm refuses): the interview, with whatever it already says;
   - his answers inside the interview: a rough time, which days, how long before class, yes/no to the summary;
   - "out with friends tonight" / "coursework till 1" → an exception for tonight; "gaming till 2" → no exception.
 A one-off ("going to bed earlier tonight", "wake me at 7"), a past fact ("i woke up late"), a question about it, or a negation is not
 a habit statement.
*/
import { isNo, isYes } from "./schedule-pending.js";
import { saysYes } from "./day-lighten.js";
import { readAlarm, type AlarmReq } from "./alarm-read.js";
import { normalizeSpoken } from "./spoken-numbers.js";
import { readBedtimeChange, readBedtimeWithAlarm, type BedChange } from "./bedtime-read.js";
import { AMOUNT, clean, LEAD, leadMinutes, slotsOf, wakeTime, type Draft } from "./sleep-plan-slots.js";

export type { Draft, DayWake } from "./sleep-plan-slots.js";
export { slotsOf } from "./sleep-plan-slots.js";
export type SleepStep = "wake" | "days" | "lead" | "confirm" | "grace";
export type SleepPending = { step: SleepStep; draft: Draft; reasked?: boolean };
export type LegitReason = "friends" | "party" | "bar" | "schoolwork";
export type SleepTurn =
  | { kind: "interview"; draft: Draft; reask?: SleepStep }
  | { kind: "confirm"; draft: Draft }
  | { kind: "decline" }
  | { kind: "except"; reason: LegitReason; until?: string }
  | { kind: "noexcept"; activity: string; grace?: boolean; again?: boolean }
  /** "i wanna sleep earlier this week": sleep only, nothing about waking. A new bedtime, said and saved in one reply. */
  | { kind: "bedtime"; time?: string }
  /** w20 routegate (bedtime-read.ts): an exact bedtime or a shift, tonight or every night; carried out by bedtime-change.ts. */
  | { kind: "bedset"; change: BedChange; /** "going to bed at 11:30, set an alarm for 7": the alarm clause, read on its own */ alarm?: AlarmReq }
  /** W18: one morning's alarm said outright: set, off, moved, or read (alarm-read.ts, alarm-flow.ts). */
  | { kind: "alarm"; req: AlarmReq };

const pad = (n: number): string => String(n).padStart(2, "0");
const LEAD_ANSWER = new RegExp(String.raw`^(?:(?:like|about|around|at ?least|maybe|prob(?:ably)?|i'?d say|say|um+|uh+|hmm+|ok(?:ay)?|yeah|yea|ya|~)[,\s]+)*${AMOUNT}(?:\b|$)`);
const NO_LEAD = /^(?:no|nah|nope|none|doesn'?t matter|does not matter|dont care|don'?t care|idc|whatever|not really|no rule|it doesn'?t matter|just normal|normal|same as now|leave it)\b/;
/** The default lead when he waves the question off with a yes ("yeah", "sure", "sounds good"): 3 hours, what he asked for. */
export const DEFAULT_LEAD = 180;
const ANSWER_TIME = /^(?:(?:um+|uh+|like|around|about|maybe|prob(?:ably)?|at|by|for|ideally|say|i guess|i think|hmm+|so|ok(?:ay)?|yeah|yea|ya|prolly|probably|i'?d say)[,\s]+)*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?(?:ish)?(?:\b|$)(?!\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b)/;
const answerTime = (m: string): string | undefined => { const a = m.match(ANSWER_TIME); return a ? wakeTime(Number(a[1]), Number(a[2] ?? 0), a[3]) : undefined; };

// ── the habit statement ────────────────────────────────────────────────────────────────────────────────────────────────
const ACT = String.raw`(?:wak(?:e|ing)(?: ?up)?|get(?:ting)? up|be(?:ing)? up|up|go(?:ing)? to (?:bed|sleep)|sleep(?:ing)?|(?:get(?:ting)?|be(?:ing)?) (?:to|in) bed|bed ?time|in bed|hit(?:ting)? the (?:sack|hay)|rise|rising|crash(?:ing)?)`;
const INTENT = String.raw`(?:start(?:ing)?|gonna|going to|goin to|want(?:ing)? to|wanna|tryna|trying to|try to|try and|need to|needa|have to|gotta|got to|plan(?:ning)? to|i'?ll|i will|should|from now on|aim(?:ing)? to|let'?s|help me|time to)`;
const SHIFT = new RegExp(String.raw`\b${INTENT}\b.{0,40}?\b${ACT}\b.{0,25}?\b(earlier|early|sooner|later)\b`);
const SHIFT_NOUN = new RegExp(String.raw`\b${INTENT}\b.{0,30}?\b(earlier|later)\s+(?:bed ?times?|wake ?ups?|wake[- ]up times?|nights|mornings|alarms?)\b`);
const ROUTINE = /\b(?:fix|reset|change|sort(?: out)?|redo|fix up|figure out|set up|make|need|want|start|get on|new|build|plan|rework|adjust|shift|help (?:me )?with)\b.{0,20}?\b(?:sleep(?:ing)? (?:schedule|routine|pattern|plan|habits?)|wake[- ]?up (?:times?|schedule|routine)|bed ?time routine|alarm schedule)\b/;
const RISER = new RegExp(String.raw`\b${INTENT}\b.{0,20}?\b(?:become|be|turn into)\s+(?:a |an )?(?:morning person|early riser|early bird)\b`);
const HABIT = /\b(?:start(?:ing)?|from now on|every|each|in general|usually|this (?:semester|term|month)|going forward|routine|habit|always|regularly|consistently|for (?:the )?gym|on (?:week ?days|weekends|gym days))\b/;
const ONE_OFF = /\b(?:tonight|today|this (?:morning|evening|afternoon)|right now|rn|now)\b/;
const NEGATED = /\b(?:don'?t|dont|do not|never|not gonna|not going to|no way|can'?t|cant|stop)\b/;
/** A standing wake time: a wake word with a time and days or "from now on" ("from now on up at 6 mon wed thu", "set my wake time to 6am on …"). */
const STANDING_ALARM = /\b(?:wak(?:e|ing)(?:[- ]?up)?|get(?:ting)? up|up at|up by|be up|alarms?|wake time)\b/;
/** Asked outright as an alarm: saved without the interview ("set a 6am wake-up alarm every mon wed thu", "wake me up at 6 on gym days"). */
const OUTRIGHT = /\b(?:alarms?|wake me(?: up)?)\b/;
const ASKS_HELP = /\b(?:help me|can you|could you|pls|please)\b/;

/** A habit statement about when he wakes or sleeps; the slots it already carries. Undefined when it is not one. */
export function readHabit(message: string): Draft | undefined {
  const m = clean(message);
  if (!m || m.length > 280 || NEGATED.test(m) || (/\?\s*$/.test(m) && !ASKS_HELP.test(m))) return undefined;
  const slots = slotsOf(m);
  const shift = m.match(SHIFT) ?? m.match(SHIFT_NOUN);
  const oneOff = ONE_OFF.test(m.replace(/\bfrom now on\b/g, ""));
  const habitual = HABIT.test(m) || !oneOff;
  // Sleep only ("sleep earlier", "earlier bedtime"), nothing about waking: a bedtime change (readBedShift), not the wake interview.
  if (shift && (shift[1] === "later" ? HABIT.test(m) : habitual)) return WAKE_WORD.test(m) ? slots : undefined;
  if (ROUTINE.test(m) || RISER.test(m)) return slots;
  // "wake me at 6 every weekday", "from now on up at 6 mon wed thu": a standing wake time (the one-off alarm cannot repeat).
  // Named outright as an alarm with its days, and nothing else to settle, it is saved without the interview.
  if (STANDING_ALARM.test(m) && slots.wake && (slots.days || HABIT.test(m)) && !oneOff) {
    // W18: a time and its days (and nothing else to settle) is saved at once, said as an alarm or as "i want to start waking up at 7 on weekdays".
    return slots.days && !slots.rest && !slots.also && slots.lead === undefined && (OUTRIGHT.test(m) || !slots.forGym) ? { ...slots, direct: true } : slots;
  }
  return undefined;
}

/** Waking, not sleeping: what makes a shift statement the wake interview's. */
const WAKE_WORD = /\b(?:wak(?:e|ing)|woke|get(?:ting)? up|be(?:ing)? up|up (?:at|by|early|earlier)|alarms?|mornings?|morning person|early riser|early bird|rise|rising)\b/;
const BED_NOUN = /\bearlier\s+bed\s?times?\b|\bbed\s?time\b.{0,20}\bearlier\b|\b(?:sleep|bed)\s+(?:a (?:bit|little) |way |much )?earlier\b/;
const BED_TIME = /\b(?:by|at|around|for|like|bout|about|~)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b(?!\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b)/;

/** "i wanna sleep earlier this week", "earlier bedtime from now on pls", "need to start crashing earlier, like 11": a new bedtime. Pure. */
export function readBedShift(message: string): { time?: string } | undefined {
  const m = clean(message);
  if (!m || m.length > 200 || NEGATED.test(m) || /\?\s*$/.test(m) || WAKE_WORD.test(m)) return undefined;
  const oneOff = ONE_OFF.test(m.replace(/\bfrom now on\b/g, ""));
  if (oneOff && !HABIT.test(m)) return undefined;
  const shift = m.match(SHIFT) ?? m.match(SHIFT_NOUN);
  const earlier = (shift && shift[1] !== "later") || (BED_NOUN.test(m) && /\b(?:want|wanna|need|gonna|going to|start|try|should|let'?s|make|from now on|this week|pls|please)\b/.test(m));
  const later = shift?.[1] === "later" && HABIT.test(m);
  if (!earlier && !later) return undefined;
  const t = m.match(BED_TIME);
  if (!t) return {};
  const h = Number(t[1]); const min = Number(t[2] ?? 0);
  if (h > 23 || min > 59) return {};
  const hour = t[3] ? (h % 12) + (t[3] === "pm" ? 12 : 0) : h >= 8 && h <= 11 ? h + 12 : h === 12 ? 0 : h;
  return { time: `${pad(hour)}:${pad(min)}` };
}

/** Whether the sleep plan owns this statement before the health reader can (a wake statement, or a sleep-only bedtime shift). */
export const ownsSleepStatement = (message: string, ctx: { now?: Date; recentAlarm?: boolean } = {}): boolean =>
  !!readHabit(message) || !!readBedtimeChange(message) || !!readBedShift(message) || !!readAlarm(message, alarmCtx(ctx));
const alarmCtx = ({ now, recentAlarm }: { now?: Date; recentAlarm?: boolean }) => ({ ...(now ? { hour: now.getHours() } : {}), ...(recentAlarm ? { recentAlarm } : {}) });

// ── exceptions by talk ─────────────────────────────────────────────────────────────────────────────────────────────────
const PARTY = /\b(?:party|partying|pregame|pregaming|club|clubbing|rave|frat|function)\b/;
const BAR = /\b(?:bar|bars|pub|pubs|drinks|drinking|bar crawl|pub crawl)\b/;
const FRIENDS = /\b(?:friends?|the boys|the guys|the girls|mates|roommates?|hanging out|hangin(?:g)? with|night out|going out|out out|date)\b/;
const SCHOOL = /\b(?:coursework|course work|homework|hw|assignments?|essays?|papers?|problem sets?|psets?|p sets?|lab reports?|studying|study(?:ing)? for|cramming|cram|exams?|midterms?|finals?|projects?|revision|revising|deadline|due tomorrow|due tmrw|readings?|reports?|school ?work)\b/;
const IDLE = /\b(?:gaming|games?|playing|valorant|val|fortnite|minecraft|league|cod|warzone|apex|xbox|ps5|playstation|steam|youtube|yt|tiktok|tik tok|scrolling|reels|netflix|tv|a show|shows|anime|movies?|chilling|chillin|nothing|bored|discord)\b/;
const LATE = /\b(?:tonight|till|til|until|'til|late|all night|up past|past midnight|this evening|rn|right now|staying up|stay up|up till|be up)\b/;
const SELF = /^(?:(?:ok|okay|so|yo|hey|heads up|fyi|btw|orion|just so you know|ngl|tbh|ya|yeah)[,\s]+)*(?:i'?m|im|i am|i'?ll|ill|i will|gonna|going|i'?ve got|i got|got|gotta|i have|i need to|need to|i have to|have to|doing|out|at|heading|headed|about to|finishing|working|studying|playing|grinding|staying|will be|prob(?:ably)?|might|we'?re|we are|me and|hanging)\b/;
const REQUEST = /\b(?:add|book|schedule|put|remind|move|block|cancel|set)\b|\?\s*$/;
const LATER_DAY = /\b(?:tomorrow|tmrw|tmr|next|this weekend|on (?:mon|tue|wed|thu|fri|sat|sun)\w*)\b/;
const UNTIL = /\b(?:till|til|until|'til|up till|up until)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;

/** "till 1" at night is 1 AM; "till 11" is 11 PM. */
function untilTime(text: string): string | undefined {
  const u = text.match(UNTIL);
  if (!u) return undefined;
  const h = Number(u[1]); const m = Number(u[2] ?? 0);
  if (h > 23 || m > 59) return undefined;
  const hour = u[3] ? (h % 12) + (u[3] === "pm" ? 12 : 0) : h >= 6 && h <= 11 ? h + 12 : h === 12 ? 0 : h;
  return `${pad(hour)}:${pad(m)}`;
}
const activityOf = (m: string): string => (/\b(?:youtube|yt|tiktok|tik tok|scrolling|reels)\b/.test(m) ? "Scrolling"
  : /\b(?:netflix|tv|a show|shows|anime|movies?)\b/.test(m) ? "TV" : /\b(?:chilling|chillin|nothing|bored)\b/.test(m) ? "Just chilling" : "Gaming");

/** A night he is out or working (an exception), or idling (no exception). Evening only, unless he says "tonight". Pure. */
export function readException(message: string, now: Date): SleepTurn | undefined {
  const m = clean(message);
  // "due tmrw" is why he is up tonight, not a plan for tomorrow.
  const later = LATER_DAY.test(m.replace(/\bdue (?:tomorrow|tmrw|tmr)\b/g, ""));
  if (!m || m.length > 140 || !SELF.test(m) || !LATE.test(m) || REQUEST.test(m) || later) return undefined;
  const evening = now.getHours() >= 17 || now.getHours() < 4;
  if (!evening && !/\btonight\b/.test(m)) return undefined;
  const until = untilTime(m);
  const reason: LegitReason | undefined = SCHOOL.test(m) ? "schoolwork" : PARTY.test(m) ? "party" : BAR.test(m) ? "bar" : FRIENDS.test(m) ? "friends" : undefined;
  if (reason) return { kind: "except", reason, ...(until ? { until } : {}) };
  return IDLE.test(m) ? { kind: "noexcept", activity: activityOf(m) } : undefined;
}

/*
 W10-B review (gate, 23:20 before a 6:00 day): "one more game i swear" got "No. Bed at 11:45 PM." from the bedtime stall reply, and "im just
 playing games, can i stay up another hour?" got a GYM nudge from the model. A plea for more time late at night is the sleep plan's:
 no exception unless the reason is a legit one; one short grace at most. Late means 21:00-04:00 (the flow checks his own bedtime).
*/
const PLEA = /\b(?:one more (?:game|round|match|ep|episode|level|run|hour|vid(?:eo)?)|one last (?:game|round|match|ep|episode)|another (?:game|round|match|hour|ep|episode|half hour|\d+ ?(?:min|mins|minutes))|(?:stay|be) up (?:another|a bit|a little|longer|later|til|till|for)|(?:few|couple) more (?:min(?:ute)?s|games|rounds|eps|episodes)|\d+ more (?:min(?:ute)?s|games|rounds)|just (?:a bit|a little) longer|let me finish (?:this|the) (?:game|round|match|ep|episode))\b/;
const LATE_HOURS = (now: Date): boolean => now.getHours() >= 21 || now.getHours() < 4;

/** A late-night plea for more time: an exception when the reason is legit, else no exception with one short grace. Pure. */
export function readPlea(message: string, now: Date): SleepTurn | undefined {
  const m = clean(message);
  if (!m || m.length > 160 || !LATE_HOURS(now) || !PLEA.test(m) || /\b(?:add|book|schedule|remind|move|cancel)\b/.test(m)) return undefined;
  const reason: LegitReason | undefined = SCHOOL.test(m) ? "schoolwork" : PARTY.test(m) ? "party" : BAR.test(m) ? "bar" : FRIENDS.test(m) ? "friends" : undefined;
  if (reason) return { kind: "except", reason };
  return { kind: "noexcept", activity: IDLE.test(m) || /\bgame|round|match|level\b/.test(m) ? activityOf(m) : "Staying up", grace: true };
}

// ── answers inside the interview ───────────────────────────────────────────────────────────────────────────────────────
const BARE_YES = /^(?:ye|yee|yea+h*|ya|yah|yeh|yuh|yup|yep|yh|mhm|k|kk|ok(?:ay)?|aight|alright|yes|sure|bet|word|fs|for sure|def(?:initely)?|sounds good|all good|do it|go ahead)(?: (?:pls|please|thx|thanks|ty|bro|man|dude))?$/;
/** His yes with emoji and trailing punctuation off: "ye 👍", "bet!", "👍". */
const yesText = (m: string): string => m.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ").replace(/[.!,\s]+$/, "").trim();
const THUMBS = /^[\s.!]*(?:\u{1F44D}|\u{2705}|\u{1F44C}|\u{1F64F}|\u{1F4AF})+[\u{1F3FB}-\u{1F3FF}\s.!]*$/u;
const CONFIRM = /^(?:(?:yes|yeah|yea|yep|yup|ya|ok(?:ay)?|sure)[,!\s]*)?(?:sounds? (?:right|good|great|perfect)|perfect|correct|exactly|bet|lgtm|looks (?:good|right)|that'?s (?:right|it|perfect)|do it|lock it in|save it|go for it|love it)\b/;
const DECLINE = /^(?:nvm|never ?mind|forget it|cancel|stop|leave it|no thanks|nah forget it)\b/;
const SHORT = (m: string): boolean => m.split(/\s+/).length <= 4;
const merge = (draft: Draft, more: Draft): Draft => ({ ...draft, ...more });
const hasSlots = (d: Draft): boolean => Object.keys(d).length > 0;

/** His reply to the question ORION asked; undefined when it is not one (the pending interview is then dropped). */
export function readAnswer(message: string, held: SleepPending): SleepTurn | undefined {
  const m = clean(message).replace(/[.!\s]+$/, "");
  if (!m) return undefined;
  if (DECLINE.test(m)) return { kind: "decline" };
  const slots = slotsOf(m);
  if (held.step === "lead") {
    if (NO_LEAD.test(m)) return { kind: "interview", draft: merge(held.draft, { ...slots, lead: null }) };
    const a = m.match(LEAD) ?? m.match(LEAD_ANSWER);
    const n = a ? leadMinutes(a, true) : undefined;
    if (n !== undefined) return { kind: "interview", draft: merge(held.draft, { ...slots, lead: n }) };
    // "yeah", "sure", "idk": the 3 hours he asked for, and on to the summary (it re-asked forever before).
    if (SHORT(m) && !REQUEST.test(m) && !hasSlots(slots)) return { kind: "interview", draft: merge(held.draft, { lead: DEFAULT_LEAD }) };
  }
  if (held.step === "confirm") {
    if (isYes(m) || saysYes(m) || CONFIRM.test(m) || BARE_YES.test(yesText(m)) || THUMBS.test(message)) return { kind: "confirm", draft: held.draft };
    if (isNo(m)) return { kind: "decline" };
    return hasSlots(slots) ? { kind: "interview", draft: merge(held.draft, slots) } : undefined;
  }
  if (isNo(m) && held.step !== "days") return { kind: "decline" };
  if (held.step === "wake") {
    const t = slots.wake ?? answerTime(m);
    if (t) return { kind: "interview", draft: merge(held.draft, { ...slots, wake: t }) };
  }
  if (held.step === "days" && slots.days) return { kind: "interview", draft: merge(held.draft, slots) };
  if (hasSlots(slots)) return { kind: "interview", draft: merge(held.draft, slots) };
  // A short non-answer ("idk", "hmm", "yeah"): the question once more, then it is dropped.
  return SHORT(m) && !held.reasked && !REQUEST.test(m) ? { kind: "interview", draft: held.draft, reask: held.step } : undefined;
}

/** This turn's part in the sleep plan, or undefined. A held interview reads the answer first; a new statement starts over. */
export function readSleepTurn(raw: string, { held, now, recentAlarm }: { held?: SleepPending | undefined; now: Date; recentAlarm?: boolean }): SleepTurn | undefined {
  const message = normalizeSpoken(raw);   // the shared spoken-number normaliser, ahead of every reader below
  const fresh = readHabit(message);
  if (fresh) return { kind: "interview", draft: held && held.step !== "confirm" ? merge(held.draft, fresh) : fresh };
  const both = readBedtimeWithAlarm(message);
  if (both) {
    const alarm = readAlarm(both.alarmText, alarmCtx({ now, ...(recentAlarm ? { recentAlarm } : {}) }));
    return alarm?.kind === "set" ? { kind: "bedset", change: both.change, alarm } : undefined;   // an alarm half that cannot be read: nothing is guessed, the model asks
  }
  const bedset = readBedtimeChange(message);
  if (bedset) return { kind: "bedset", change: bedset };
  const bed = readBedShift(message);
  if (bed) return { kind: "bedtime", ...bed };
  const alarm = readAlarm(message, alarmCtx({ now, ...(recentAlarm ? { recentAlarm } : {}) }));
  if (alarm) return { kind: "alarm", req: alarm };
  const except = readPlea(message, now) ?? readException(message, now);
  if (except) return except.kind === "noexcept" && except.grace && held?.step === "grace" ? { ...except, again: true } : except;
  return held && held.step !== "grace" ? readAnswer(message, held) : undefined;
}
