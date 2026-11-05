/*
 Day edits (w20 sched, 2026-11-04). Nick: "scheduling should be possible for events that passed already too ... I can change the past
 events to reflect my day", and "scheduling should be a lot more seamless". One reader for the way he really types a change to his day:

   add marketing museum from 7pm to 9:30pm. then gym from 10-11. push sleep to 11:45        three parts, all done
   i actually did gym from 2 to 3 not 4 / add that i was on the tube 5-6                    what happened: logged, even if over
   move my lunch earlier today to 12 / i didn't do the study block, i was at the pub         the past block is rewritten (log --instead)
   put gym at half 5 / gym in an hour / study after lunch                                    natural times
   push everything back, back around 9:45/10pm                                               busy until then
 This file only READS (pure, no clock reads, no calendar); day-edit-run.ts carries it out. A message with an action clause it cannot read
 whole is null, so the older readers and the model keep it: a half-read request must never run as a quarter of itself.
*/
import { CLK, naturalToDigits, pickClock, pickRange, takeClock, takeRange, withEarlyCue } from "./day-edit-time.js";
import { parseClock, takeLength } from "./intent-time.js";
import { notScheduling } from "./not-scheduling.js";
import { parseWake } from "./wake-flow.js";
import { readBedtimeChange } from "./bedtime-read.js";
import { normalizeSpoken } from "./spoken-numbers.js";
const clean = (m) => m.toLowerCase().replace(/[’`]/g, "'").replace(/[…]/g, ".").replace(/\s+/g, " ").trim();
const FILLER = /\b(?:um+|uh+|erm|hmm+|like|just|literally|basically|actually|please|pls|plz|hey|ok(?:ay)?|alright|hello|so|really|for me|real quick|quickly|lol|lmao|haha|tbh|btw|idk|ish)\b[,]?/g;
const VERB = /\b(?:add|ass|put|schedule|book|pencil in|move|push|shift|bump|reschedule|clear|drop|delete|remove|cancel|scrap|log|note|mark|record|plan|set)\b/;
const CLEAR_VERB = /^(?:clear|drop|delete|remove|cancel|scrap)\b/;
const QUESTION = /\?\s*$|^(?:what|when|why|how|is|are|did|do|does|was|were|have|has|will|should|which|who)\b/;
const CONDITION = /\b(?:if|unless|whether|wish|hope|maybe|might|what if)\b/;
const EXERCISE = /\b(?:\d+\s*x\s*\d+|sets?|reps?|squats?|bench|deadlifts?|lbs?|kgs?|miles?|km|cardio|treadmill|laps?)\b/;
const LOG_SAY = /\bi(?:'ve| have)?\s+(?:actually\s+)?(?:was|did|went|had|ended up|spent|got|been)\b/;
const PAST_SAY = /\bi(?:'ve| have)?\s+(?:actually\s+)?(?:was|did|went|had|ended up|spent|got|been|am)\b|\bi'?m\s+(?:at|in|on)\b/;
const NAME_STOP = /\s+(?:i'?m|im|i am|i'?m not|because|cause|coz|as|since|but|cos)\b.*$/;
const PREP = /^(?:(?:at|in|on|doing|to|the|a|an|my|some|having|been|going to|go to|up|that|i was|i did|i had|i went to|me|did|went to|went|then)\s+)+/;
const tidy = (raw) => raw.trim().replace(NAME_STOP, "").replace(/\b(?:to|in|on) (?:my|the) (?:schedule|calendar|day|plan|planner)\b/g, " ").replace(/\b(?:session|block|slot|start|starts|starting|begin|begins)s?\b/g, " ")
    .replace(/\b(?:today|tonight|tomorrow|tmrw|yesterday|this (?:morning|afternoon|evening)|earlier|later|again|too|as well|instead|in the end|last night)\b/g, " ")
    .replace(/\s+/g, " ").trim().replace(PREP, "").replace(/^(?:me|that|it)\s+/, "").replace(/[.,!?]+$/g, "").replace(/\s+(?:then|though|tho|instead)$/, "").replace(/\s+/g, " ").trim();
const nameOf = (raw) => { const t = tidy(raw); return t && t.split(" ").length <= 5 && /[a-z]/.test(t) && !/^(?:everything|all|anything|something|it|that|this|day|my day)\b/.test(t) ? t : null; };
const dayOf = (c, dflt) => (/\b(?:yesterday|last night)\b/.test(c) ? "yesterday" : /\b(?:tomorrow|tmrw)\b/.test(c) ? "tomorrow" : /\b(?:today|tonight|earlier|this (?:morning|afternoon|evening))\b/.test(c) ? "today" : dflt);
const SPLIT = /[.;!|]+\s*(?=\S)|\s+(?=(?:add|put|schedule) (?:it|that|them|this)\b)|\s+(?:and then|then|also|plus)\s+|\s*,\s*(?=(?:and |also |then )?(?:add|ass|put|move|push|shift|bump|nudge|reschedule|drop|clear|delete|remove|cancel|schedule|book|log|set)\b)|\s+and\s+(?=(?:add|put|move|push|shift|bump|nudge|reschedule|drop|clear|delete|remove|cancel|schedule|book|log)\b)|\s*,\s*(?=(?:and |also |then )?(?:my )?(?:bed\s?time|sleep(?:\s?time)?|wake|alarm|(?:i )?(?:ate|eaten|drank))\b)|\s+and\s+(?=(?:my\s+)?(?:bed\s?time|sleep(?:\s?time)?|wake\s+(?:me|up)|alarm|set (?:an? )?alarm|(?:i )?(?:ate|eaten|drank|did|went to)\b))/;
const BEDTIME = /(?:\b(?:push|move|shift|set|change|make|put)\s+|^(?:and |also |then )?)(?:my\s+)?(?:sleep(?:\s?time)?|bed\s?time|bed)\s+(?:back\s+|earlier\s+|later\s+|up\s+)?(?:to|until|till|at|for)\s+(\S+(?:\s*[ap]\.?m\.?)?)\b/;
const SLEEP_HOURS = /\b(?:plan|aim|give me|get|want|need)\b.*\b(\d{1,2})\s*(?:hours?|hrs?)\s+(?:of\s+)?sleep\b/;
const SLEPT_SAY = /^(?:(?:i|ive|i've)\s+)?(?:just\s+)?(?:went to bed|got to bed|got into bed|fell asleep|slept|got to sleep|crashed)\b/;
const WAKE_WORD = /\b(?:wake|woke|alarm|get me up|get up)\b/;
const FOOD_SAY = /^(?:(?:i|ive|i've)\s+)?(?:just\s+|already\s+)?(?:ate|eaten|drank|had (?:lunch|dinner|breakfast|a snack|supper|some food))\b/;
/** What a clause says after its time: a second clock there is a second ask, never part of the first one's name. */
const LEFTOVER_CLOCK = (rest) => /\d/.test(rest.replace(/\b\d+\s*(?:min|mins|minutes|hours?|hrs?)\b/g, ""));
function didnt(c0, dflt = "today") {
    // "i skipped the lecture yesterday and was at the library 1-3": the same thing said another way
    const c = c0.replace(/\b(?:skipped|bunked|ditched|bailed on|blew off)\s+(?:the |my |that )?/, "didnt go to the ").replace(/(\byesterday)\s+and\s+(?=(?:i\s+)?was\b)/, "$1, i ");
    const m = /\b(?:didn'?t|did not|never)\s+(?:do|go to|go|make it to|make it|have|get to|end up doing|bother with|attend)\s+(?:the |my |that |any )?(.+?)(?:\s+(?:block|session|slot))?\s*(?:,|;|-|\band\b|\bbecause\b|\bcause\b|\bcoz\b|\binstead\b|\bi\b|$)(.*)$/.exec(c);
    if (!m)
        return null;
    const name = nameOf(m[1]);
    if (!name)
        return null;
    const tail = (m[2] ?? "").trim();
    const was = /\bi\s+(?:was|went|ended up|got|am)\s+(.+)$/.exec(tail) ?? /^(?:instead[, ]+)?(?:i\s+)?(?:was|went|ended up)\s+(.+)$/.exec(tail);
    if (!was)
        return null;
    const range = takeRange(was[1]);
    const did = nameOf(range ? range.rest : was[1]);
    return { op: "didnt", name, day: dayOf(c, dflt), ...(did ? { did } : {}), ...(range ? { span: { a: range.a, b: range.b } } : {}) };
}
// "i did dinner at 7 not 6 earlier", "i actually called mum at 4 not 5 so shift it": one clock replacing another for a thing already on the day.
const CORRECTED = new RegExp(String.raw `^(?:i\s+)?(?:(?:did|had|ate|went to|was at|was on|called|rang|phoned|started|finished|met|saw|got|have|do)\s+)?(?:my\s+|the\s+|a\s+|that\s+)?(.+?)\s+(?:at|for)\s+(?<a>${CLK})\s+(?:and\s+)?not\s+(?:at\s+)?(?<b>${CLK})(?![\d:])(?<rest>.*)$`);
const EVENING_SAID = /\b(?:earlier|tonight|this evening|last night|this afternoon|yesterday evening)\b/;
function corrected(c, dflt, nowMin) {
    const m = CORRECTED.exec(c);
    if (!m?.groups)
        return null;
    const name = nameOf(m[1]);
    const a = parseClock(m.groups.a.replace(/\s+/g, ""));
    const was = parseClock(m.groups.b.replace(/\s+/g, ""));
    if (!name || !a || !was || /\b(?:tomorrow|tmrw)\b/.test(c) || LEFTOVER_CLOCK(m.groups.rest))
        return null;
    return { op: "correct", name, day: dayOf(c, dflt), at: a, was, ...(nowMin < 300 && EVENING_SAID.test(c) ? { evening: true } : {}) };
}
// "push the orion learning plan back an hour", "bump gym up 30 min", "push back gym by 20": a shift by an amount, not to a clock.
const SHIFT_AFTER = /^(?:move|push|shift|bump|nudge)\s+(?:my\s+|the\s+)?(.+?)\s+(back|later|forward|forwards|ahead|earlier|up)\s+(?:by\s+)?(.+)$/;
const SHIFT_BEFORE = /^(?:move|push|shift|bump|nudge)\s+(back|later|forward|forwards|earlier|up)\s+(?:my\s+|the\s+)?(.+?)\s+by\s+(.+)$/;
// "bump the orion plan an hour later", "push dinner half an hour back": the amount first, the direction last.
const SHIFT_TRAIL = /^(?:move|push|shift|bump|nudge)\s+(?:my\s+|the\s+)?(.+?)\s+(?:by\s+)?((?:an?|one|half an?|\d+(?:\.\d+)?|a couple of|couple)\s*(?:hours?|hrs?|h|minutes?|mins?)(?:\s+and\s+a\s+half)?|an hour and a half)\s+(back|later|forward|forwards|ahead|earlier)$/;
function shifted(c, dflt) {
    const after = SHIFT_AFTER.exec(c);
    const before = after ? null : SHIFT_BEFORE.exec(c);
    const trail = after || before ? null : SHIFT_TRAIL.exec(c);
    const hit = after ? { name: after[1], dir: after[2], amount: after[3] } : before ? { name: before[2], dir: before[1], amount: before[3] } : trail ? { name: trail[1], dir: trail[3], amount: trail[2] } : null;
    if (!hit)
        return null;
    const len = takeLength(hit.amount);
    const name = nameOf(hit.name);
    if (!name || !len.minutes || len.minutes <= 0 || LEFTOVER_CLOCK(len.rest) || /^(?:everything|all)/.test(name))
        return null;
    return { op: "shift", name, day: dayOf(c, dflt), minutes: /^(?:earlier|up)$/.test(hit.dir) ? -len.minutes : len.minutes };
}
function logged(c, dflt) {
    const body = c.replace(/^(?:add|log|note|put|record|mark)(?: down)?(?: that)?\s+/, "");
    const bare = /^(?:did|went to)\s/.test(body); // "then did gym 5-6": the clause after a split has lost its "i"
    if (!LOG_SAY.test(body) && !bare)
        return null;
    const range = takeRange(body);
    const len = takeLength(range ? range.rest : body);
    const text = (range ? range.rest : len.rest).replace(/\b(?:i(?:'ve| have)?\s+)(?:was|did|went|had|ended up|spent|got|been|am)\b/, " ").replace(/\bnot \d.*$/, "").replace(/\bi'?m\s+(?:at|in|on)\b/, " ");
    const name = nameOf(text.replace(/\bfor\b\s*$/, ""));
    if (!name || !range)
        return null;
    return { op: "log", name, day: dayOf(c, dflt), ...(range ? { span: { a: range.a, b: range.b } } : {}), ...(len.minutes ? { minutes: len.minutes } : {}) };
}
function moved(c, dflt) {
    const m = /^(?:move|push|shift|bump|reschedule|change)\s+(?:back\s+|up\s+)?(?:my\s+|the\s+)?(.+?)\s+(?:(?:back|forward|earlier|later)\s+)?(?:(?:today|tonight|tomorrow|this (?:morning|afternoon|evening))\s+)?(?:to|until|till|at|for)\s+(.+)$/.exec(c);
    if (!m)
        return null;
    const name = nameOf(m[1]);
    const t = takeClock(`to ${m[2]}`);
    if (!name || !t || /^(?:everything|all)/.test(name) || LEFTOVER_CLOCK(t.rest))
        return null;
    return { op: "move", name, day: dayOf(c, dflt), to: t.s };
}
// "make the mum call 45 mins", "make the haircut an hour": the block's new total length (never "it": that is edit-followup.ts's).
function resized(c, dflt) {
    const m = /^(?:make|change|set)\s+(?:my\s+|the\s+)?(.+?)\s+(?:to\s+|be\s+)?((?:\d+|an?|one|two|three|four|half an?)\s*(?:hours?|hrs?|h|minutes?|mins?)(?:\s+and\s+a\s+half)?|an hour and a half)(?:\s+long)?$/.exec(c);
    if (!m)
        return null;
    const name = nameOf(m[1]);
    const len = takeLength(m[2]);
    if (!name || !len.minutes || len.rest.trim())
        return null;
    return { op: "resize", name, day: dayOf(c, dflt), minutes: len.minutes };
}
function dropped(c, dflt) {
    const m = CLEAR_VERB.test(c) ? /^(?:clear|drop|delete|remove|cancel|scrap)\s+(?:the\s+|my\s+|that\s+)?(.+)$/.exec(c) : null;
    if (!m || /\b(?:after|before|everything|all)\b/.test(m[1]))
        return null;
    const name = nameOf(m[1]);
    return name ? { op: "drop", name, day: dayOf(c, dflt) } : null;
}
function added(c, dflt, carry) {
    const lead = /^(?:(?:and|also|then|now|can you|could you|ass|add|put|schedule|book|pencil in|plan|set up|set)\s+)+/.exec(c);
    if (!lead && !carry)
        return null;
    const body = c.slice(lead ? lead[0].length : 0).replace(/^(?:in|on)\s+/, "");
    // "and shift it to 4:30" is a move of what he just made, never a new block called "Shift it".
    if (/^(?:move|shift|push|bump|nudge|reschedule)\b/.test(body))
        return null;
    const range = takeRange(body);
    const rest0 = range ? range.rest : body;
    const len = takeLength(rest0);
    const one = range ? null : takeClock(len.rest);
    const after = /\bafter\s+(?:my\s+|the\s+)?([a-z][a-z ]{1,20}?)(?=\s*$|\s+(?:for|and|then|today|tomorrow|tonight)\b)/.exec(one ? one.rest : len.rest);
    const text = (after ? (one ? one.rest : len.rest).replace(after[0], " ") : one ? one.rest : len.rest);
    const name = nameOf(text.replace(/\bfor\b\s*$/, "").replace(/\bat\b\s*$/, "").replace(/\bfrom\b\s*$/, "").replace(/\s+in\s*$/, "").replace(/\s+in\s+(?=at\b)/, " "));
    if (!name || (!range && !one && !after))
        return null;
    return { op: "add", name, day: dayOf(c, dflt), ...(range ? { span: { a: range.a, b: range.b } } : {}), ...(one ? { at: one.s } : {}), ...(after ? { after: after[1].trim() } : {}), ...(len.minutes ? { minutes: len.minutes } : {}) };
}
/** "gym at 5 in the morning": his words say the small hours, so a bare clock in that clause is exact (waking-hours.ts). */
function earlyRead(p, clause) {
    if (p.op === "add")
        return { ...p, ...(p.at ? { at: withEarlyCue(p.at, clause) } : {}), ...(p.span ? { span: { a: withEarlyCue(p.span.a, clause), b: withEarlyCue(p.span.b, clause) } } : {}) };
    if (p.op === "log" || p.op === "didnt")
        return p.span ? { ...p, span: { a: withEarlyCue(p.span.a, clause), b: withEarlyCue(p.span.b, clause) } } : p;
    if (p.op === "move")
        return { ...p, to: withEarlyCue(p.to, clause) };
    if (p.op === "correct")
        return { ...p, at: withEarlyCue(p.at, clause), was: withEarlyCue(p.was, clause) };
    return p;
}
/** A clause that is only a time, said before its verb ("ass 10 to 11pm add gym"): lent to the clause after it. */
const DANGLING = /^(?:(?:ass|add|and|at|from|so|then)\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|till|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/;
/** The edits in a message, or null when it is not one (or an action clause in it cannot be read whole). */
export function readDayEdit(message, now) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let m = clean(message);
    if (!m || m.length > 420)
        return null;
    if (EXERCISE.test(m.replace(/\bset (?:an? |my |the )?(?:alarm|wake)/g, "")) || CONDITION.test(m))
        return null;
    // His name for me is filler ("orion, move gym", "hey orion can you add"), but "the orion learning plan" is a block's own word.
    m = m.replace(/\borion\b(?=\s*,|\s+(?:can|could|would|will|please|pls|plz|just|move|push|shift|bump|put|add|schedule|book|log|drop|clear|delete|remove|cancel|scrap|set)\b)|,\s*orion\b(?=\s*[.!?]*$)/g, " ");
    m = clean(m.replace(FILLER, " ").replace(/\b(\d{1,2}(?::\d{2})?)\s*\/\s*(\d{1,2}(?::\d{2})?)(\s*[ap]m)?/g, "$2$3"));
    m = naturalToDigits(m.replace(/\b(to|at|until|till|by|for|from)\s*,\s*/g, "$1 ").replace(/^[\s.,]+/, "").replace(/\bass\b/g, "add"), nowMin);
    m = naturalToDigits(m, nowMin);
    // "10 to 11pm add gym": a time said before its verb goes behind it
    m = m.replace(/\b(?:add\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|till|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(add|put|schedule|book)\s+([a-z][a-z ]{1,24})(?=[.,!]|$)/g, "$2 $3 $1");
    // "study after lunch and gym at 6": a second thing after a time or an anchor is its own clause
    m = m.replace(/(\b(?:at|from|after|by|until|till)\s+(?:[\d:]+(?:\s*[ap]m)?|noon|midnight|[a-z]+))\s+and\s+(?=(?:[a-z]+ ){1,4}(?:at|from|after|by)\s)/g, "$1|");
    if (QUESTION.test(m) && !/^(?:can|could|would) you\b/.test(m))
        return null;
    const clauses = m.split(SPLIT).map((c) => c.trim()).filter(Boolean);
    const parts = [];
    let prevText = "";
    const days = new Set(clauses.flatMap((c) => (/\b(?:yesterday|last night)\b/.test(c) ? ["yesterday"] : /\b(?:tomorrow|tmrw)\b/.test(c) ? ["tomorrow"] : [])));
    const dflt = days.size === 1 ? [...days][0] : "today";
    const story = /\bpush (?:everything|it all|the rest|all of it|my day)\s+back\b/.test(m);
    for (let c of clauses) {
        if (DANGLING.test(c)) {
            prevText = c;
            continue;
        }
        const carry = parts.length > 0 && (parts[parts.length - 1].op === "add" || parts[parts.length - 1].op === "log");
        if (prevText && !/\d/.test(c) && /\b(?:add|put|schedule|book)\b/.test(c))
            c = `${c} ${prevText.replace(/^(?:ass|add|and|at|so|then)\s+/, "")}`;
        prevText = "";
        let part = null;
        // "make the mum call 45 mins and move it to quarter past 6": "it" is the block the clause before named.
        const named = [...parts].reverse().find((x) => "name" in x);
        if (named && /^(?:move|shift|push|bump|nudge|reschedule)\s+(?:it|that|this)\b/.test(c))
            c = c.replace(/^(\w+)\s+(?:it|that|this)\b/, `$1 ${named.name}`);
        if (/^(?:add|put|schedule|book) (?:it|that|them|this)\b/.test(c) && !/\d/.test(c))
            continue;
        const bed = BEDTIME.exec(c);
        if (notScheduling(c)) {
            parts.push({ op: "note", text: `I left "${c.replace(/\s*\|\s*/g, " ").slice(0, 60)}" alone, that isn't something for your calendar` });
            continue;
        }
        if (SLEPT_SAY.test(c) && !/\b(?:push|move|set|change|make)\b/.test(c))
            part = { op: "slept", text: c.replace(/^(?:ive|i've)\s+/, "i ") };
        else if (WAKE_WORD.test(c)) {
            // wake / alarm wording is the alarm's, never a block: a clause whose time cannot be read makes the whole message not mine
            const w = parseWake(c, undefined, now);
            if (w?.kind !== "set")
                return null;
            part = { op: "wake", time: w.time };
        }
        else if (bed) {
            const t = takeClock(`to ${bed[1]}`);
            const rc = readBedtimeChange(c);
            part = t ? { op: "bedtime", to: t.s, scope: rc && "time" in rc ? rc.scope : "tonight" } : null;
        }
        else if (SLEEP_HOURS.test(normalizeSpoken(c)))
            part = { op: "sleephours", hours: Number(SLEEP_HOURS.exec(normalizeSpoken(c))[1]) };
        else if (story && /\bpush (?:everything|it all|the rest|all of it|my day)\s+back\b/.test(c)) {
            const back = /\b(?:back|home|free|done|finished|out)\s+(?:around|by|at|about)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/.exec(m);
            const t = back ? takeClock(`at ${back[1]}`) : null;
            part = t ? { op: "busy", until: t.s } : null;
        }
        else
            part = didnt(c, dflt) ?? corrected(c, dflt, nowMin) ?? dropped(c, dflt) ?? shifted(c, dflt) ?? resized(c, dflt) ?? moved(c, dflt) ?? logged(c, dflt) ?? (FOOD_SAY.test(c) && /\d|\b(?:noon|midnight)\b/.test(c) ? { op: "food", text: c } : null) ?? added(c, dflt, carry);
        if (part) {
            parts.push(earlyRead(part, c));
            continue;
        }
        // a bare "gym start at 10pm" beside other edits is one more add; any other unread clause that asks for something makes the message not mine
        const bare = parts.length > 0 && !story && !VERB.test(c) && !PAST_SAY.test(c) && !/^(?:i|im|i'm|ill|i'll|ive|i've|it|it's|its|we|you|my|the|there|that|this|and|then|but|so)\b/.test(c) && c.split(" ").length <= 6;
        if (bare) {
            const more = added(`add ${c}`, dflt, false);
            if (more) {
                parts.push(more);
                continue;
            }
        }
        const asks = VERB.test(c) || (PAST_SAY.test(c) && /\d/.test(c) && !/\b(?:supposed|meant|going to|gonna)\b/.test(c));
        // a clock in a clause nothing read ("ring the dentist at 11") is an ask he made: never dropped, so the message is not mine
        const clocked = /\d|\b(?:noon|midnight)\b/.test(c) && !/^(?:i|im|i'm|ill|i'll|ive|i've|it|it's|its|we|you|there|that|this|and|then|but|so)\b/.test(c);
        if (asks || clocked)
            return null;
    }
    if (parts.length && parts.every((p) => p.op === "wake" || p.op === "food" || p.op === "slept" || p.op === "note"))
        return null; // a wake ask alone is the alarm route's (wake-flow.ts), a meal alone the food route's
    return parts.length ? { parts } : null;
}
/** Whether any part is about time that has already gone: his own log of the day. Only clocks he made exact (am/pm, 24-hour) count, so a bare "at 6" late at night is never read as a log. */
export function touchesPast(edit, now) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return edit.parts.some((p) => p.op === "log" || p.op === "didnt" || (p.op === "add" && p.day === "yesterday")
        || (p.op === "move" && p.day === "today" && p.to.exact && pickClock(p.to, nowMin, "future") <= nowMin)
        || (p.op === "add" && p.day === "today" && (p.span ? (p.span.a.exact || p.span.b.exact) && (pickRange(p.span.a, p.span.b, nowMin, "future")?.from ?? Infinity) <= nowMin : p.at ? p.at.exact && pickClock(p.at, nowMin, "future") <= nowMin : false)));
}
