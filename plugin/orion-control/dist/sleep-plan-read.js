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
const pad = (n) => String(n).padStart(2, "0");
const clean = (m) => m.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (raw) => NUM[raw] ?? Number(raw);
// ── how long before class ──────────────────────────────────────────────────────────────────────────────────────────────
const AMOUNT = String.raw `(\d+(?:\.\d+)?|an?|one|two|three|four|five|six)\s*(and a half\s*)?(h|hrs?|hours?|m|mins?|minutes?)?\s*(and a half\s*)?`;
const LEAD = new RegExp(String.raw `\b(?:at ?least |like |about |around |~)?${AMOUNT}(?:early\s+)?(?:before|ahead of|prior to|b4)\s+(?:my |a |the |any |each |every )?(?:first |1st )?(?:class|classes|lecture|lectures|lab|labs|school|uni)\b`);
const LEAD_ANSWER = new RegExp(String.raw `^(?:(?:like|about|around|at ?least|maybe|prob(?:ably)?|i'?d say|say|um+|uh+|hmm+|ok(?:ay)?|yeah|yea|ya|~)[,\s]+)*${AMOUNT}(?:\b|$)`);
const NO_LEAD = /^(?:no|nah|nope|none|doesn'?t matter|does not matter|dont care|don'?t care|idc|whatever|not really|no rule|it doesn'?t matter|just normal|normal|same as now|leave it)\b/;
function leadMinutes(m, bareIsHours) {
    const n = num(m[1]) + (m[2] || m[4] ? 0.5 : 0);
    const unit = m[3];
    const minutes = unit ? (/^h/.test(unit) ? n * 60 : n) : bareIsHours && n <= 6 ? n * 60 : n >= 15 ? n : undefined;
    return minutes !== undefined && minutes >= 15 && minutes <= 360 ? Math.round(minutes) : undefined;
}
// ── times ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CLASS_TIME = /\b(?:class(?:es)?|lectures?|labs?)\b[^,.;]{0,12}?\b(?:is|are|at|starts?|begins?)\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:class|lecture|lab)\b/g;
const REST = /\b(?:otherwise|other days?|the other days|rest of (?:the )?(?:week|days?|time)|the rest|else|normal(?:ly)?|usual(?:ly)?|regular)\b\D{0,20}?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?)?)/;
const MERIDIEM = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/;
const H24 = /\b([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;
const AT_N = /\b(?:at|around|by|for|bout|about|like|~)\s*(\d{1,2})(?::(\d{2}))?(?:ish)?\b(?!\s*(?:h|hrs?|hours?|m|mins?|minutes?|days?|%)\b)/;
const ISH = /\b(\d{1,2})ish\b/;
const ANSWER_TIME = /^(?:(?:um+|uh+|like|around|about|maybe|prob(?:ably)?|at|by|for|ideally|say|i guess|i think|hmm+|so|ok(?:ay)?|yeah|yea|ya|prolly|probably|i'?d say)[,\s]+)*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?(?:ish)?(?:\b|$)(?!\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b)/;
/** A wake-up time as HH:MM: 4 AM to noon, no meridiem means the morning. */
function wakeTime(h, m, mer) {
    if (h > 23 || m > 59)
        return undefined;
    const hour = mer ? (h > 12 || h < 1 ? -1 : (h % 12) + (/^p/.test(mer) ? 12 : 0)) : h;
    return hour >= 4 && hour <= 12 ? `${pad(hour)}:${pad(m)}` : undefined;
}
const fromMatch = (m, meridiemAt = 3) => m?.[1] ? wakeTime(Number(m[1]), Number(m[2] ?? 0), m[meridiemAt]) : undefined;
/** The wake time named in a sentence (never a bare number). */
function namedWake(text) {
    return fromMatch(text.match(MERIDIEM)) ?? (() => { const c = text.match(H24); return c ? wakeTime(Number(c[1]), Number(c[2])) : undefined; })()
        ?? fromMatch(text.match(AT_N), 99) ?? fromMatch(text.match(ISH), 99);
}
// ── days ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DAY_WORD = /^(mon(?:day)?|tues?(?:day)?|weds?|wednesday|thu|thur|thurs|thursday|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?$/;
const ALL_DAYS = /\b(?:every ?day|daily|all week|each day|7 days|seven days|all (?:of )?(?:them|the days)|all days|every morning)\b/;
const WEEKDAYS = /\bweek ?days?\b|\bmon(?:day)?\s*(?:-|to|thru|through)\s*fri(?:day)?\b|\bschool days\b/;
const WEEKENDS = /\bweekends?\b/;
const GYM_DAYS = /\bgym days?\b|\bdays? i (?:go to the |hit the )?gym\b|\bwhen i (?:go to the |hit the )?gym\b/;
const NOT_WAKE_CLAUSE = /\b(?:class(?:es)?|lectures?|labs?|normal|usual|otherwise|other days?|the rest|rest of)\b/;
/** The days his wake time is for, from the clauses that are not about classes or "the other days". */
function daysIn(text) {
    const clauses = text.split(/[.;!?]|,|\b(?:but|so|because|cuz|since)\b/).filter((c) => !NOT_WAKE_CLAUSE.test(c));
    const out = new Set();
    for (const c of clauses) {
        if (ALL_DAYS.test(c))
            out.add("all");
        if (WEEKDAYS.test(c))
            out.add("weekdays");
        if (WEEKENDS.test(c))
            out.add("weekends");
        if (GYM_DAYS.test(c))
            out.add("gym");
        for (const w of c.split(/[^a-z]+/)) {
            const d = w.match(DAY_WORD);
            if (d)
                out.add(d[1].slice(0, 3));
        }
    }
    return out.size ? [...out] : undefined;
}
/** Everything a message says about the plan. Pure. */
export function slotsOf(message) {
    let text = clean(message).replace(CLASS_TIME, " ");
    const draft = {};
    const lead = text.match(LEAD);
    if (lead) {
        const n = leadMinutes(lead, false);
        if (n !== undefined)
            draft.lead = n;
        text = text.replace(lead[0], " ");
    }
    const rest = text.match(REST);
    if (rest) {
        const r = rest[1].match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?/);
        const t = r ? wakeTime(Number(r[1]), Number(r[2] ?? 0), r[3]) : undefined;
        if (t)
            draft.rest = t;
        text = text.replace(rest[0], " ");
    }
    const wake = namedWake(text);
    if (wake)
        draft.wake = wake;
    const days = daysIn(clean(message)); // the clauses as he said them: one naming a class or "the other days" is skipped
    if (days)
        draft.days = days;
    return draft;
}
// ── the habit statement ────────────────────────────────────────────────────────────────────────────────────────────────
const ACT = String.raw `(?:wak(?:e|ing)(?: ?up)?|get(?:ting)? up|be(?:ing)? up|up|go(?:ing)? to (?:bed|sleep)|sleep(?:ing)?|(?:get(?:ting)?|be(?:ing)?) (?:to|in) bed|bed ?time|in bed|hit(?:ting)? the (?:sack|hay)|rise|rising|crash(?:ing)?)`;
const INTENT = String.raw `(?:start(?:ing)?|gonna|going to|goin to|want(?:ing)? to|wanna|tryna|trying to|try to|try and|need to|needa|have to|gotta|got to|plan(?:ning)? to|i'?ll|i will|should|from now on|aim(?:ing)? to|let'?s|help me|time to)`;
const SHIFT = new RegExp(String.raw `\b${INTENT}\b.{0,40}?\b${ACT}\b.{0,25}?\b(earlier|early|sooner|later)\b`);
const SHIFT_NOUN = new RegExp(String.raw `\b${INTENT}\b.{0,30}?\b(earlier|later)\s+(?:bed ?times?|wake ?ups?|wake[- ]up times?|nights|mornings|alarms?)\b`);
const ROUTINE = /\b(?:fix|reset|change|sort(?: out)?|redo|fix up|figure out|set up|make|need|want|start|get on|new|build|plan|rework|adjust|shift|help (?:me )?with)\b.{0,20}?\b(?:sleep(?:ing)? (?:schedule|routine|pattern|plan|habits?)|wake[- ]?up (?:times?|schedule|routine)|bed ?time routine|alarm schedule)\b/;
const RISER = new RegExp(String.raw `\b${INTENT}\b.{0,20}?\b(?:become|be|turn into)\s+(?:a |an )?(?:morning person|early riser|early bird)\b`);
const HABIT = /\b(?:start(?:ing)?|from now on|every|each|in general|usually|this (?:semester|term|month)|going forward|routine|habit|always|regularly|consistently|for (?:the )?gym|on (?:week ?days|weekends|gym days))\b/;
const ONE_OFF = /\b(?:tonight|today|this (?:morning|evening|afternoon)|right now|rn|now)\b/;
const NEGATED = /\b(?:don'?t|dont|do not|never|not gonna|not going to|no way|can'?t|cant|stop)\b/;
const STANDING_ALARM = /\b(?:wake me(?: up)?|wake(?: up)? at|get up at|be up at|up by|alarms?)\b/;
const ASKS_HELP = /\b(?:help me|can you|could you|pls|please)\b/;
/** A habit statement about when he wakes or sleeps; the slots it already carries. Undefined when it is not one. */
export function readHabit(message) {
    const m = clean(message);
    if (!m || m.length > 280 || NEGATED.test(m) || (/\?\s*$/.test(m) && !ASKS_HELP.test(m)))
        return undefined;
    const slots = slotsOf(m);
    const shift = m.match(SHIFT) ?? m.match(SHIFT_NOUN);
    const habitual = HABIT.test(m) || !ONE_OFF.test(m);
    if (shift && (shift[1] === "later" ? HABIT.test(m) : habitual))
        return slots;
    if (ROUTINE.test(m) || RISER.test(m))
        return slots;
    // "wake me at 6 every weekday", "i wanna get up at 6 on gym days": a standing alarm (the one-off alarm cannot repeat).
    if (STANDING_ALARM.test(m) && slots.wake && slots.days && !ONE_OFF.test(m))
        return slots;
    return undefined;
}
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
function untilTime(text) {
    const u = text.match(UNTIL);
    if (!u)
        return undefined;
    const h = Number(u[1]);
    const m = Number(u[2] ?? 0);
    if (h > 23 || m > 59)
        return undefined;
    const hour = u[3] ? (h % 12) + (u[3] === "pm" ? 12 : 0) : h >= 6 && h <= 11 ? h + 12 : h === 12 ? 0 : h;
    return `${pad(hour)}:${pad(m)}`;
}
const activityOf = (m) => (/\b(?:youtube|yt|tiktok|tik tok|scrolling|reels)\b/.test(m) ? "Scrolling"
    : /\b(?:netflix|tv|a show|shows|anime|movies?)\b/.test(m) ? "TV" : /\b(?:chilling|chillin|nothing|bored)\b/.test(m) ? "Just chilling" : "Gaming");
/** A night he is out or working (an exception), or idling (no exception). Evening only, unless he says "tonight". Pure. */
export function readException(message, now) {
    const m = clean(message);
    // "due tmrw" is why he is up tonight, not a plan for tomorrow.
    const later = LATER_DAY.test(m.replace(/\bdue (?:tomorrow|tmrw|tmr)\b/g, ""));
    if (!m || m.length > 140 || !SELF.test(m) || !LATE.test(m) || REQUEST.test(m) || later)
        return undefined;
    const evening = now.getHours() >= 17 || now.getHours() < 4;
    if (!evening && !/\btonight\b/.test(m))
        return undefined;
    const until = untilTime(m);
    const reason = SCHOOL.test(m) ? "schoolwork" : PARTY.test(m) ? "party" : BAR.test(m) ? "bar" : FRIENDS.test(m) ? "friends" : undefined;
    if (reason)
        return { kind: "except", reason, ...(until ? { until } : {}) };
    return IDLE.test(m) ? { kind: "noexcept", activity: activityOf(m) } : undefined;
}
// ── answers inside the interview ───────────────────────────────────────────────────────────────────────────────────────
const CONFIRM = /^(?:(?:yes|yeah|yea|yep|yup|ya|ok(?:ay)?|sure)[,!\s]*)?(?:sounds? (?:right|good|great|perfect)|perfect|correct|exactly|bet|lgtm|looks (?:good|right)|that'?s (?:right|it|perfect)|do it|lock it in|save it|go for it|love it)\b/;
const DECLINE = /^(?:nvm|never ?mind|forget it|cancel|stop|leave it|no thanks|nah forget it)\b/;
const SHORT = (m) => m.split(/\s+/).length <= 4;
const merge = (draft, more) => ({ ...draft, ...more });
const hasSlots = (d) => Object.keys(d).length > 0;
/** His reply to the question ORION asked; undefined when it is not one (the pending interview is then dropped). */
export function readAnswer(message, held) {
    const m = clean(message).replace(/[.!\s]+$/, "");
    if (!m)
        return undefined;
    if (DECLINE.test(m))
        return { kind: "decline" };
    const slots = slotsOf(m);
    if (held.step === "lead") {
        if (NO_LEAD.test(m))
            return { kind: "interview", draft: merge(held.draft, { ...slots, lead: null }) };
        const a = m.match(LEAD) ?? m.match(LEAD_ANSWER);
        const n = a ? leadMinutes(a, true) : undefined;
        if (n !== undefined)
            return { kind: "interview", draft: merge(held.draft, { ...slots, lead: n }) };
    }
    if (held.step === "confirm") {
        if (isYes(m) || CONFIRM.test(m))
            return { kind: "confirm", draft: held.draft };
        if (isNo(m))
            return { kind: "decline" };
        return hasSlots(slots) ? { kind: "interview", draft: merge(held.draft, slots) } : undefined;
    }
    if (isNo(m) && held.step !== "days")
        return { kind: "decline" };
    if (held.step === "wake") {
        const t = slots.wake ?? fromMatch(m.match(ANSWER_TIME));
        if (t)
            return { kind: "interview", draft: merge(held.draft, { ...slots, wake: t }) };
    }
    if (held.step === "days" && slots.days)
        return { kind: "interview", draft: merge(held.draft, slots) };
    if (hasSlots(slots))
        return { kind: "interview", draft: merge(held.draft, slots) };
    // A short non-answer ("idk", "hmm", "yeah"): the question once more, then it is dropped.
    return SHORT(m) && !held.reasked && !REQUEST.test(m) ? { kind: "interview", draft: held.draft, reask: held.step } : undefined;
}
/** This turn's part in the sleep plan, or undefined. A held interview reads the answer first; a new statement starts over. */
export function readSleepTurn(message, { held, now }) {
    const fresh = readHabit(message);
    if (fresh)
        return { kind: "interview", draft: held && held.step !== "confirm" ? merge(held.draft, fresh) : fresh };
    const except = readException(message, now);
    if (except)
        return except;
    return held ? readAnswer(message, held) : undefined;
}
