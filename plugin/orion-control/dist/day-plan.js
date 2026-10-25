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
// "only doing two things today", "only 2 things today:", "that's it": he is saying what the WHOLE rest of the day is. A bare "just" is not
// ("I'm just gonna study until 5 then do laundry until 7" is two blocks, not his whole day: review of this fix); "just … then head home and
// … till midnight" is, because going home and on to the end of the evening lays out the day.
const ONLY = /\bonly\b|\b(?:two|2|three|3)\s+things\b|\bthat'?s it\b/i;
const JUST = /\bjust\b/i;
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
const CLOSE = /^[\s.!…,]*(?:(?:and\s+)?that'?s\s+it|then\s+(?:bed|sleep)|and\s+then\s+(?:bed|sleep))?[\s.!…]*$/i;
/** The thing's name out of its stretch of his words: the last clause, without the lead-in ("once im home i work on") or a tail ("at home"). */
function nameOf(stretch) {
    const clauses = stretch.split(/[.;:!…]|,|\bthen\b|\band then\b|\band\b/i).map((c) => c.trim()).filter(Boolean);
    for (const c of [...clauses].reverse()) {
        const name = c.replace(LEAD_WORDS, "").replace(TAIL_WORDS, "").replace(/^(?:a|an|the|my|some)\s+/i, "").trim();
        if (!name)
            continue;
        if (name.split(/\s+/).length > 5 || !/^[a-z0-9][a-z0-9' &-]*$/i.test(name) || NOT_A_NAME.test(name))
            return undefined;
        return name;
    }
    return undefined;
}
/** "only doing two things today. X from now until 6pm. then home. once home Y until 12 am" as items, or undefined (not this shape). */
export function parseDayPlan(message) {
    const raw = spokenTimesToDigits(message.replace(/\s+/g, " ").trim());
    const text = fixTypos(raw);
    if (!raw || !(ONLY.test(text) || (JUST.test(text) && HOME.test(text))) || OTHER_DAY.test(text) || HEDGE.test(text) || PAST_REPORT.test(text))
        return undefined; // a report of what he did is not a plan
    // The gate (intent-gate.ts), lenient: a statement of plan ("gonna", "i go back home") is fine; a question, doubt, a take-back, hearsay
    // or "don't/maybe/what if/unless" never is.
    if (refusalOf(raw, { lenient: true }))
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
export function dayPlanReply(after, plan, failure) {
    if (!after)
        return `I made the change but couldn't read your calendar back to check it, so I won't say it's done. Check it, and say "undo" if it looks wrong.`;
    const onDay = (title) => after.blocks.filter((b) => norm(b.title) === norm(title));
    const wrong = [];
    const right = [];
    for (const p of plan.items) {
        const asked = `${p.title} ${span(p.start, p.end)}`;
        const there = onDay(p.title);
        const exact = there.find((b) => toMin(b.start) === p.start && (toMin(b.end) === p.end || (p.end === 1440 && toMin(b.end) === 0)));
        if (exact)
            right.push(`${p.home ? "home, then " : ""}${asked}`);
        else
            wrong.push(there.length ? `you asked for ${asked}, but your calendar has ${p.title} ${there.map((b) => span(toMin(b.start), toMin(b.end) || 1440)).join(" and ")}` : `you asked for ${asked}, but it isn't on your calendar`);
    }
    const stillThere = plan.cleared.filter((b) => onDay(b.title).some((x) => x.start === b.start));
    const gone = plan.cleared.filter((b) => !stillThere.includes(b)).map((b) => b.title);
    if (wrong.length || failure) {
        return `Not done as you asked: ${[...wrong, ...(failure ? [failure] : [])].join("; ")}.${right.length ? ` What is right: ${right.join(", ")}.` : ""} Say "undo" to put your day back.`;
    }
    const count = plan.items.length <= 4 ? NUMBER[plan.items.length] : String(plan.items.length);
    const gym = plan.anchorsCleared.filter((a) => gone.some((g) => norm(g) === norm(a) || blocksNamed(a, { ...after, blocks: [{ title: g, start: "00:00", end: "00:00", fixed: false }] }).length > 0));
    const others = gone.filter((g) => !gym.some((a) => blocksNamed(a, { ...after, blocks: [{ title: g, start: "00:00", end: "00:00", fixed: false }] }).length > 0));
    const parts = [`Done: ${right.join(", then ")}.`];
    if (others.length)
        parts.push(`I took ${others.join(", ")} off the rest of today.`);
    if (gym.length)
        parts.push(`${gym.join(" and ")} is skipped today, since you said only these ${count} things.`);
    if (stillThere.length)
        parts.push(`${stillThere.map((b) => b.title).join(", ")} is still on your day.`);
    return parts.join(" ");
}
