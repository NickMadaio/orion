/*
 A whole-day plan is code's, not the worker's (2026-10-25 incident, docs/audits/2026-10-25-day-plan-false-positive.md).

 "only doing two things today. Study for CS Midterm from now until 6pm. then i go back home. once im home i work on marketing
 presentation until 12 am." went to the 9B form, which wrote `resize Study 300` (14:00–19:00, from the block's old start) and
 `move "AE1 Marketing Presentation" --to 24:00` (refused); the reply said "Done". Everything this needs is in his words and his day:

   - the things, in his order, each ending at the time he said ("until 6pm", "till 6", "til midnight", "until 12 am" = end of today)
   - where each starts: "from now" (or nothing: the first thing starts now), the end of the one before plus the 5-minute gap,
     or plus the trip home when he goes home in between ("then i go back home", "head home and", "at home", "once im home")
   - "only" / "just" / "two things": nothing else of ORION's stays on the rest of today

 and hands `orion-reschedule day --plan "<title>, <min>, HH:MM" … --only` exactly that, one call, one undo step. Ownership: only blocks
 ORION planned come off; a thing he names may be one of his own events (not a class or a plan with people); classes and plans with
 people never move. The gym is a must, but "only these two today" is his call: it comes off with the rest and he is told in one line.
 The gate is the intent layer's (intent-gate.ts): a statement of plan passes; a question, a hedge, a take-back or hearsay does not.
*/
import { blocksNamed } from "./day-replan.js";
import { COURTESY, fixTypos, PAST_REPORT, refusalOf } from "./intent-gate.js";
import { ampm, ceil5, CLOCK, parseClock, resolveEnd, resolveStart, span, spokenTimesToDigits, toMin } from "./intent-time.js";
const norm = (t) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());
// He says what the WHOLE rest of his day is, in so many words, as himself (independent review, 2026-10-25): "only doing two things today",
// "I'm only doing 2 things today:", "just these two today", "that's it for today". A bare "only" or "just" is not that ("only study until 6",
// "the lab only runs until 4"), nor anyone else's day ("my friend is only doing two things today"). When unsure, nothing is cleared.
const SUBJECT = String.raw `(?:(?:ok(?:ay)?|so|yeah|alright|right|orion|hey)[,\s]+)*(?:(?:i'?m|im|i\s+am|i'?ll\s+be|ill\s+be|i'?m\s+gonna\s+be|i\s+will\s+be)\s+)?`;
const COUNT = String.raw `(?:two|2|three|3|four|4)`;
const WHOLE_DAY = new RegExp(String.raw `(?:^|[.!;:,]\s*)${SUBJECT}(?:only|just)\s+(?:(?:doing|gonna\s+do|going\s+to\s+do|do|have)\s+)?(?:${COUNT}\s+things|these\s+(?:${COUNT}\s+)?(?:things\s+)?)\s*(?:today|for\s+today)\b|(?:^|[.!;:,]\s*)${SUBJECT}(?:only|just)\s+(?:(?:doing|gonna\s+do|going\s+to\s+do|do|have)\s+)?${COUNT}\s+things\b|\bthat'?s\s+it\s+for\s+today\b`, "i");
// Someone else's day, a negation, or what he would/could do: never his plan.
const NOT_HIS = /\b(?:he|she|they|we|you|he'?s|she'?s|they'?re|hes|shes|theyre|someone|somebody|friend|mom|mum|dad|brother|sister|roommate|bf|gf|boyfriend|girlfriend|his|her|their)\b|\b(?:i'?d|id|would|wouldn'?t)\b/i;
// A negation blocks only when it negates the plan itself ("not only doing…", "I'm not doing two things today") or one of the things in it
// ("not study until 6pm", checked per item below). Re-review (2026-10-25): "no gym" and "dont add anything else" confirm the plan.
const NEG_PLAN = /\bnot\s+(?:only|just)\b|\b(?:i'?m|im|i\s+am)\s+not\b|\b(?:not|don'?t|dont|won'?t|wont|never)\s+(?:be\s+)?(?:doing|do|gonna|going)\b|\bnever\b/i;
const NEGATED = /\b(?:not|never|no|don'?t|dont|won'?t|wont|can'?t|cant)\b/i;
// What confirms "only these" rather than negating it: "no gym", "no X", "dont add anything else", "nothing else". Taken out before the gate.
const CONFIRMS = /(?:^|[,.;!?—–]\s*|\s-\s|\s)(?:and\s+)?(?:no\s+[a-z]+(?:\s+[a-z]+)?(?=\s*(?:[,.;!?—–]|\s-\s|$))|(?:please\s+)?(?:don'?t|dont|do\s+not)\s+(?:add|book|put|schedule|plan)\s+anything\s+else|nothing\s+else)/gi;
/** A title never starts with a pronoun, a negation or "only" ("She's only doing study" was booked as one). */
const BAD_TITLE_START = /^(?:i|i'?m|im|i'?d|id|he|she|they|we|you|it|he'?s|she'?s|they'?re|hes|shes|theyre|not|only|just|my\s+friend)\b/i;
// A statement of plan may use "gonna"/"going to" (the strict gate refuses those): these are what still make it not an order.
const HEDGE = /\b(?:might|may be|could|thinking|wondering|whether|if i|if we|probably|prob|prolly|planning to maybe|not sure|supposed to|should)\b/i;
const ADD_LEAD = /^(?:put|add|schedule|book|pencil|slot|block|move|push|shift|bump|extend|drop|remove|cancel|re-?schedule|re-?plan|re-?arrange)\b/i;
const OTHER_DAY = /\b(?:tomorrow|tmrw|tmr|tmrow|2moro|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|weds|thu|thur|thurs|fri|next week)\b/i;
// "from now until 6pm", "till 6", "til midnight", "until 12 am", "to 6" (only after a start: "from 2 to 6").
const SPAN = new RegExp(String.raw `(?:\bfrom\s+(?<from>(?:right\s+)?now|${CLOCK})\s+(?:until|till|til|up to|to)|\b(?:until|till|til|up\s+to))\s+(?<end>${CLOCK})(?![\w:])`, "gi");
const HOME = /\b(?:go(?:ing)?\s+(?:back\s+)?home|head(?:ing)?\s+(?:back\s+)?home|get(?:ting)?\s+(?:back\s+)?home|got\s+(?:back\s+)?home|back\s+home|(?:once|when|after)\s+(?:i'?m|im|i am)\s+(?:back\s+)?home|at\s+home|walk\s+home|home)\b(?!\s*work)/i;
const LEAD_WORDS = /^(?:(?:then|and|so|after\s+that|afterwards|also|plus|first|i|i'?m|im|i\s+am|i'?ll|ill|i\s+will|will|gonna|going\s+to|wanna|just|only|work(?:ing)?\s+on|do(?:ing)?|be|get|finish|focus\s+on|on|my|the|a|some|go(?:ing)?\s+(?:back\s+)?home(?:\s+and)?|head(?:ing)?\s+(?:back\s+)?home(?:\s+and)?|(?:once|when|after)\s+(?:i'?m|im|i\s+am|i\s+get|i\s+got)\s+(?:back\s+)?home|from\s+(?:right\s+)?now)[,\s]+)+/i;
const TAIL_WORDS = /(?:\s+(?:at\s+home|today|tonight|from\s+(?:right\s+)?now|right\s+now|now|then))+$/i;
const NOT_A_NAME = /\b(?:things?|stuff|day|home|until|till|til|from|nothing|everything|something|it|that|this)\b|\d{1,2}\s*(?:am|pm)\b/i;
// What may follow the last thing: nothing, or a close ("and that's it", "then bed").
const CLOSE = /^[\s.!…,—–-]*(?:(?:and\s+)?that'?s\s+it(?:\s+for\s+today)?|then\s+(?:bed|sleep)|and\s+then\s+(?:bed|sleep))?[\s.!…—–-]*$/i;
/** The thing's name out of its stretch of his words: the last clause, without the lead-in ("once im home i work on") or a tail ("at home"). */
function nameOf(stretch) {
    const clauses = stretch.split(/[.;:!…—–]|\s-\s|,|\bthen\b|\band then\b|\band\b/i).map((c) => c.trim()).filter(Boolean);
    for (const c of [...clauses].reverse()) {
        if (NEGATED.test(c))
            return undefined; // "not study until 6pm": a thing he is NOT doing is never booked
        const name = c.replace(LEAD_WORDS, "").replace(TAIL_WORDS, "").replace(/^(?:a|an|the|my|some)\s+/i, "").trim();
        if (!name)
            continue;
        if (name.split(/\s+/).length > 5 || !/^[a-z0-9][a-z0-9' &-]*$/i.test(name) || NOT_A_NAME.test(name) || BAD_TITLE_START.test(name))
            return undefined;
        return name;
    }
    return undefined;
}
/** "only doing two things today. X from now until 6pm. then home. once home Y until 12 am" as items, or undefined (not this shape). */
export function parseDayPlan(message) {
    // A plan split across lines is one plan, a line each: each line break is a sentence break.
    const lined = message.replace(/\s*[\r\n]+\s*/g, ". ").replace(/\.\s*\./g, ".");
    const raw = spokenTimesToDigits(lined.replace(/\s+/g, " ").trim());
    // "no gym", "dont add anything else" confirm the plan; read without them (they are not things to book, and not a negated plan).
    const plain = raw.replace(CONFIRMS, ".").replace(/\s+/g, " ").trim();
    const text = fixTypos(plain);
    if (!raw || !WHOLE_DAY.test(text) || NOT_HIS.test(text) || NEG_PLAN.test(text) || OTHER_DAY.test(text) || HEDGE.test(text) || PAST_REPORT.test(text))
        return undefined; // a report of what he did is not a plan
    // The gate (intent-gate.ts), lenient: a statement of plan ("gonna", "i go back home") is fine; a question, doubt, a take-back, hearsay
    // or "don't/maybe/what if/unless" never is.
    if (refusalOf(plain, { lenient: true }))
        return undefined;
    if (ADD_LEAD.test(text.replace(COURTESY, "").replace(/^(?:just|only)\s+/i, "")))
        return undefined;
    const spans = [...text.matchAll(SPAN)];
    if (spans.length < 2 || spans.length > 4)
        return undefined;
    const items = [];
    let cursor = 0;
    for (const m of spans) {
        const stretch = text.slice(cursor, m.index);
        const name = nameOf(stretch);
        if (!name)
            return undefined;
        const from = m.groups.from;
        items.push({ name, endSaid: m.groups.end.replace(/\.$/, ""), ...(from ? { fromSaid: from } : {}), home: items.length > 0 && HOME.test(stretch) });
        cursor = m.index + m[0].length;
    }
    if (!CLOSE.test(text.slice(cursor)))
        return undefined;
    if (new Set(items.map((i) => norm(i.name))).size !== items.length)
        return undefined;
    return { items };
}
const isClass = (b) => b.kind === "class";
/** `show --json` prints a block that ends at midnight as "00:00": that is the end of the day, not its start. */
const endOf = (b) => (b.end === "00:00" && b.start !== "00:00" ? 1440 : toMin(b.end));
// A plan with people or a class, even one ORION booked (it reads fixed:false), never moves and never comes off (review of this fix).
const PEOPLE = /\bwith\b/i;
const social = (b) => isClass(b) || b.kind === "deadline" || b.kind === "social" || PEOPLE.test(b.title);
/** A block he names may move unless it is a class or a plan with people (one of his own events that he names moves: review of 6fc2b13). */
const locked = (b) => social(b) || ((b.fixed || isClass(b)) && !(b.nameable && !isClass(b)));
/** The block his name means today: ORION's or his own, still ahead or under way first. Two different titles: undefined + ambiguous. */
function blockOf(name, day, now) {
    const found = blocksNamed(name, day);
    const live = found.filter((b) => endOf(b) > now);
    const pool = live.length ? live : found;
    let titles = [...new Set(pool.map((b) => b.title))];
    // "marketing lecture" with AE1 Marketing Presentation and Marketing Lecture on the day: the one that has every word he said.
    if (titles.length > 1) {
        const all = titles.filter((t) => norm(name).split(" ").every((w) => norm(t).split(" ").includes(w)));
        if (all.length === 1)
            titles = all;
    }
    if (titles.length > 1)
        return { ambiguous: titles };
    const mine = pool.filter((b) => b.title === titles[0]);
    return mine.length ? { block: [...mine].sort((a, b) => toMin(a.start) - toMin(b.start))[0] } : {};
}
/** His whole-day plan against today: one argv, or the line that says why not. Today only (day.now set). */
export function planDayPlan(ask, day) {
    if (!day.now)
        return undefined;
    const now = toMin(day.now);
    const facts = day.plan ?? { commuteMinutes: 30, bufferMinutes: 5, anchors: [] };
    const planned = [];
    const named = [];
    let prevEnd;
    for (const item of ask.items) {
        const { block, ambiguous } = blockOf(item.name, day, now);
        if (ambiguous)
            return { say: "ask", text: `Which ${item.name} do you mean: ${ambiguous.join(" or ")}? I haven't changed anything.` };
        if (block && locked(block))
            return { say: "cannot", text: `${block.title.replace(/\s+—.*$/, "")} is a class or a plan with people, so it doesn't move. I haven't changed anything.` };
        const title = (block?.title ?? cap(item.name)).replace(/,/g, " ").replace(/\s+/g, " ").trim();
        // Where it starts: a time he stated, else now (the first thing), else after the one before (+ the trip home when he goes home).
        let start;
        const fromSaid = item.fromSaid && !/now$/i.test(item.fromSaid) ? parseClock(item.fromSaid) : null;
        if (fromSaid) {
            const r = resolveStart(fromSaid, { day: "today", now: now - 60 });
            if (!("at" in r))
                return { say: "ask", text: `When should ${title} start? I haven't changed anything.` };
            start = Math.max(r.at, ceil5(now));
        }
        else if (block && toMin(block.start) < now && endOf(block) > now && prevEnd === undefined)
            start = toMin(block.start); // under way: what is done stays (review)
        else if (prevEnd === undefined)
            start = ceil5(now);
        else
            start = prevEnd + (item.home ? facts.commuteMinutes : facts.bufferMinutes);
        const endSaid = parseClock(item.endSaid);
        const end = endSaid ? resolveEnd(endSaid, start, { day: "today", now }) : undefined;
        if (!end || !("at" in end)) {
            const why = end && "passed" in end ? `${ampm(end.passed)} has already passed (it's ${ampm(now)})`
                : end && "pastMidnight" in end ? `${ampm(end.pastMidnight)} is after midnight, and a block can't run into tomorrow`
                    : end && "before" in end ? `${ampm(end.before)} is before ${title} could start (${ampm(start)})` : `I couldn't read "${item.endSaid}" as a time`;
            return { say: "cannot", text: `${why}, so I haven't changed anything. Tell me when ${title} should end.` };
        }
        if (end.at - start < 5)
            return { say: "cannot", text: `${title} would only have ${Math.max(0, end.at - start)} minutes (${span(start, Math.max(start, end.at))}), so I haven't changed anything.` };
        if (end.at - start > 720)
            return { say: "ask", text: `${title} ${span(start, end.at)} is over 12 hours. Is that right? I haven't changed anything.` };
        // A class or a plan with people in the way is never moved for it: he is told, nothing is written.
        const wall = day.blocks.find((b) => locked(b) && b !== block && toMin(b.start) < end.at && endOf(b) > start);
        if (wall)
            return { say: "cannot", text: `${wall.title.replace(/\s+—.*$/, "")} is ${span(toMin(wall.start), endOf(wall))}, so ${title} can't run ${span(start, end.at)}. I haven't changed anything.` };
        if (block)
            named.push(block);
        planned.push({ title, start, end: end.at, home: item.home });
        prevEnd = end.at;
    }
    // "Only these today": every other block ORION planned that has not started comes off (the scheduler's --only picks the same ones).
    const cleared = day.blocks.filter((b) => !b.fixed && !social(b) && toMin(b.start) >= now && !named.includes(b) && !planned.some((p) => norm(p.title) === norm(b.title)));
    const anchorsCleared = facts.anchors.filter((a) => cleared.some((b) => blocksNamed(a.title, { ...day, blocks: [b] }).length > 0)).map((a) => a.title);
    const args = ["day", ...planned.flatMap((p) => ["--plan", `${p.title}, ${p.end - p.start}, ${hhmm(p.start)}`]), "--only"];
    return { args, items: planned, cleared, anchorsCleared };
}
const NUMBER = ["", "one", "two", "three", "four"];
/**
 * What he is told, written by code from the day as it now reads (never from the model): each thing he asked for against what is on
 * his calendar. "Done" only when every one of them is exactly as he asked; otherwise what he asked, what is there, and how to undo it.
 */
export function dayPlanReply(after, plan, failure, before) {
    if (!after)
        return `I made the change but couldn't read your calendar back to check it, so I won't say it's done. Check it, and say "undo" if it looks wrong.`;
    const onDay = (title) => after.blocks.filter((b) => norm(b.title) === norm(title));
    const wrong = [];
    const right = [];
    for (const p of plan.items) {
        const asked = `${p.title} ${span(p.start, p.end)}`;
        const there = onDay(p.title);
        const exact = there.find((b) => toMin(b.start) === p.start && endOf(b) === p.end);
        if (exact)
            right.push(`${p.home ? "home, then " : ""}${asked}`);
        else
            wrong.push(there.length ? `you asked for ${asked}, but your calendar has ${p.title} ${there.map((b) => span(toMin(b.start), endOf(b))).join(" and ")}` : `you asked for ${asked}, but it isn't on your calendar`);
    }
    const stillThere = plan.cleared.filter((b) => onDay(b.title).some((x) => x.start === b.start));
    const gone = plan.cleared.filter((b) => !stillThere.includes(b)).map((b) => b.title);
    // Review (2026-10-25): "Done" only when nothing ELSE on his day changed either — every other block reads as it did before.
    const named = (t) => plan.items.some((p) => norm(p.title) === norm(t)) || plan.cleared.some((c) => norm(c.title) === norm(t));
    const moved = (before?.blocks ?? []).filter((b) => !named(b.title) && !after.blocks.some((x) => x.title === b.title && x.start === b.start && x.end === b.end))
        .map((b) => { const now = onDay(b.title)[0]; return now ? `${b.title} moved from ${span(toMin(b.start), endOf(b))} to ${span(toMin(now.start), endOf(now))}` : `${b.title} (${span(toMin(b.start), endOf(b))}) came off your day`; });
    if (wrong.length || failure || stillThere.length || moved.length) {
        const problems = [...wrong, ...(failure ? [failure] : []), ...stillThere.map((b) => `${b.title} should have come off but is still on`), ...moved.map((m) => `${m}, which you didn't ask for`)];
        return `Not done as you asked: ${problems.join("; ")}.${right.length ? ` What is right: ${right.join(", ")}.` : ""} Say "undo" to put your day back.`;
    }
    const count = plan.items.length <= 4 ? NUMBER[plan.items.length] : String(plan.items.length);
    const isAnchor = (a, g) => norm(g) === norm(a) || blocksNamed(a, { ...after, blocks: [{ title: g, start: "00:00", end: "00:00", fixed: false }] }).length > 0;
    const gym = plan.anchorsCleared.filter((a) => gone.some((g) => isAnchor(a, g)));
    const others = gone.filter((g) => !gym.some((a) => isAnchor(a, g)));
    const parts = [`Done: ${right.join(", then ")}.`];
    if (others.length)
        parts.push(`I took ${others.join(", ")} off the rest of today.`);
    if (gym.length)
        parts.push(`${gym.join(" and ")} is skipped today, since you said only these ${count} things.`);
    return parts.join(" ");
}
