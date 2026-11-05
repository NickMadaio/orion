/*
 Reading a request to change his bedtime (w20 routegate, 2026-11-04). Nick: "make sure he can change my bed time and wake time".
 Pure; bedtime-change.ts carries it out through orion-sleepplan, the one writer.

   "push my bedtime to, um, eleven forty five"   set 23:45 (tonight)         "bed at quarter to 12"          set 23:45 (every night)
   "push bedtime back 30 min"                     tonight 30 min later        "move bedtime up half an hour"   tonight 30 min earlier
   "i want to sleep at 11 tonight"                set 23:00 tonight           "from now on bedtime 11"        set 23:00 every night
   "make my bedtime 11:30 pm"                     set 23:30 every night       "bedtime later pls"             tonight 30 min later

 Scope: "tonight / just / this once" = tonight only; "from now on / every night / always / usually" = every night; otherwise a push or a
 shift is tonight and a plain set is every night, and the reply says which and how to switch. A bedtime hour has to be 8 PM to 4 AM: a bare
 8-11 is PM, 12 is midnight, 1-4 is AM; 5-7 with no am/pm is unclear, so nothing is read and the model asks.
 Not a request: a question ("what's my bedtime"), a statement of going ("im going to bed at 11"), a wake time, a negation.
*/
import { normalizeSpoken } from "./spoken-numbers.js";
const FILLER = /\b(?:um+|uh+|erm|hmm+|like|just|literally|basically|actually|please|pls|plz|orion|hey|ok(?:ay)?|so|really|for me|real quick|lol|ish|ya know|you know)\b[,]?/g;
const BED = String.raw `(?:bed\s?times?|bed\s?tims?|bedtimes?|sleep\s?times?|lights?\s?out|asleep[- ]by|go(?:ing)? to (?:bed|sleep))`;
const VERB = /\b(?:push|move|shift|set|change|make|put|bump|adjust|reschedule|update|have|let)\b/;
const WANT = /\b(?:i\s+(?:want|wanna|need|would like|'?d like|'?d rather)|can we|can you|could you|lets|let'?s|gonna|going to)\b/;
const QUESTION_START = /^(?:what|whats|when|why|how|is|are|does|do you|did|was|which)\b/;
const NEGATED = /\b(?:don'?t|dont|do not|never|stop|cancel|forget|not)\b.{0,12}\b(?:bed\s?time|sleep|bed)\b/;
const TONIGHT = /\b(?:tonight|tn|just (?:for )?(?:tonight|today|now)|this once|for now|only tonight|today)\b/;
const STANDING = /\b(?:from now on|every night|each night|always|usually|permanently|normally|every day|nightly|by default|standing|going forward|in general)\b/;
const MER = String.raw `(a\.?m\.?|p\.?m\.?)`;
const TIME_AT = new RegExp(String.raw `(?:\b(?:to|at|by|for|around|about|is|be|=|till|until)\s+|${BED}\s+|\b(?:bed|sleep)\s+)(\d{1,2})(?::(\d{2}))?\s*${MER}?(?![\d:])(?!\s*(?:min|mins|minutes|hours?|hrs?|h\b|%|times))`);
const SHIFT_AMT = /\b(?:by\s+)?(\d{1,3})\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)\b|\b(an? hour|half an? hour|half hour|hour and a half|quarter of an hour|an? quarter)\b/;
const BACK = /\b(?:back|later|forward|out|further|off|up later)\b/;
const EARLIER = /\b(?:earlier|up|sooner|ahead|before)\b/;
const pad = (n) => String(n).padStart(2, "0");
/** A bedtime clock, 20:00 to 04:00: undefined when it cannot be one. */
function bedClock(h, m, mer) {
    if (m > 59 || h < 0 || h > 24)
        return undefined;
    let hour;
    if (mer) {
        if (h < 1 || h > 12)
            return undefined;
        hour = (h % 12) + (/^p/i.test(mer) ? 12 : 0);
    }
    else if (h >= 13)
        hour = h;
    else if (h >= 8 && h <= 11)
        hour = h + 12;
    else if (h === 12)
        hour = 0;
    else if (h >= 1 && h <= 4)
        hour = h;
    else
        return undefined;
    hour %= 24;
    const total = hour < 12 ? hour * 60 + m + 1440 : hour * 60 + m;
    return total >= 20 * 60 && total <= 1440 + 4 * 60 ? `${pad(hour)}:${pad(m)}` : undefined;
}
function shiftMinutes(m) {
    if (/\bhalf an? hour\b|\bhalf hour\b/.test(m))
        return 30;
    if (/\bhour and a half\b/.test(m))
        return 90;
    if (/\bquarter of an hour\b|\ban? quarter\b/.test(m))
        return 15;
    if (/\ban? hour\b/.test(m))
        return 60;
    const a = SHIFT_AMT.exec(m);
    if (!a?.[1])
        return undefined;
    const n = Number(a[1]);
    return /^h/i.test(a[2] ?? "") ? n * 60 : n;
}
/** The bedtime change in his message, or undefined. */
export function readBedtimeChange(message) {
    // Fillers and commas go first so "to, um, eleven forty five" reads as "to eleven forty five" before the numbers are normalised.
    const m = normalizeSpoken(message.toLowerCase().replace(/[’`]/g, "'").replace(FILLER, " ").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim());
    if (!m || m.length > 200)
        return undefined;
    if (QUESTION_START.test(m) || NEGATED.test(m) || /\b(?:wake|alarm|get up)\b/.test(m))
        return undefined;
    if (!new RegExp(BED).test(m) && !/\bsleep at\b|\bbed at\b|\bto sleep\b/.test(m))
        return undefined;
    // "im going to bed at 11" states where he is going; the bedtime flow and the goodnight reply own that.
    if (/\b(?:i'?m|im|i am|i'?ll|ill)\s+(?:going|heading|off) to (?:bed|sleep)\b/.test(m) && !VERB.test(m) && !WANT.test(m.replace(/\bgoing to\b/, "")))
        return undefined;
    const standing = STANDING.test(m);
    const tonight = TONIGHT.test(m);
    const t = TIME_AT.exec(m);
    if (t?.[1]) {
        const time = bedClock(Number(t[1]), Number(t[2] ?? 0), t[3]);
        if (!time)
            return undefined;
        if (!VERB.test(m) && !WANT.test(m) && !standing && !/\b(?:bed\s?time|sleep\s?time)\b/.test(m) && !/\b(?:sleep|bed) at\b/.test(m))
            return undefined;
        const pushed = /\b(?:push|move|shift|bump)\b/.test(m);
        return { time, scope: standing ? "always" : tonight || pushed || WANT.test(m) && !/\bbed\s?time\b/.test(m) ? "tonight" : "always" };
    }
    if (!/\bbed\s?time\b|\bsleep\s?time\b/.test(m))
        return undefined;
    const dir = BACK.test(m) ? 1 : EARLIER.test(m) ? -1 : 0;
    if (!dir)
        return undefined;
    const amount = shiftMinutes(m);
    if (amount === undefined && dir < 0)
        return undefined; // "sleep earlier" with no amount is the habit reader's (sleep-plan-read.ts)
    return { shift: dir * (amount ?? 30), scope: standing ? "always" : "tonight" };
}
