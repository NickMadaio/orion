/*
 "Why is X first?" is answered from the plan's own reasons (2026-11-04). Nick: "the first thing he wants me to do is my resume? That is
 very clearly not the highest priority item". orion-reschedule day --todos ranks his to-dos (scripts/lib/life/todo-rank.mjs) and leaves
 each booked one's rank and reason in plan-reasons.json; this reads them back, so the answer is the real reason, never a guess by the model.
 No file for today, or no to-do by that name: null, and the turn goes on as before.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
const FIRST = String.raw `(?:first|1st|at the top|on top|up first|at the start|to start(?: with)?|before everything)`;
const NOUN = String.raw `(?:thing|task|item|block|job|one)`;
const SUBJECT = String.raw `(?<x>[^?!.,]{0,60}?)`;
const ASKS = [
    // "why is the first thing finish resume" / "why's my first task the resume"
    new RegExp(String.raw `\bwhy(?:'s|s| is| was| are)?\s+(?:the\s+|my\s+)?(?:first|1st)\s+${NOUN}\s+(?:i\s+(?:do|gotta do|have to do)\s+(?:today\s+)?)?(?:is\s+|being\s+|to be\s+)?${SUBJECT}\s*$`, "i"),
    // "why did u put resume first", "why would you schedule my resume at the top", "why do you have gym first"
    new RegExp(String.raw `\bwhy\s+(?:did|would|do|are|r)\s+(?:you|u|ya|ya'll|orion)\s+(?:even\s+)?(?:put|place|schedule|make|have|list|set|plan|stick|book)\s+(?:the\s+|my\s+|that\s+)?${SUBJECT}\s+${FIRST}\b`, "i"),
    // "why am i doing the resume first", "why do i have to do resume first", "why do i gotta start with gp"
    new RegExp(String.raw `\bwhy\s+(?:am\s+i|do\s+i|should\s+i|im)\s+(?:(?:have to|gotta|got to|need to|supposed to)\s+)?(?:doing|do|working on|work on|starting with|start with|start|studying|study)\s+(?:the\s+|my\s+)?${SUBJECT}\s+(?:${FIRST}\b|$)`, "i"),
    // "why is resume first", "why's the resume at the top", "wait why is my resume first thing", "how come resume is first"
    new RegExp(String.raw `\b(?:why|how come)(?:'s|s| is| was| are)?\s+(?:is\s+|was\s+)?(?:the\s+|my\s+|that\s+)?${SUBJECT}\s+(?:is\s+|was\s+|being\s+|even\s+|always\s+)*${FIRST}\b`, "i"),
];
const FILLER = /\b(?:the|my|that|this|even|always|again|today|rn|right now|on my list|on my plan|on my schedule|in my day|of my day|thing|i have to do|i gotta do)\b/gi;
/** The thing he is asking about ("" for "why is that first"), or null when this is not a "why is it first" question. */
export function whyFirstAsk(message) {
    const text = message.trim().replace(/[?!.\s]+$/, "");
    if (!/\b(?:why|how come)\b/i.test(text))
        return null;
    for (const re of ASKS) {
        const m = re.exec(text);
        if (!m?.groups)
            continue;
        return (m.groups.x ?? "").replace(FILLER, " ").replace(/\b(?:it|that|this)\b/gi, " ")
            .replace(/^\s*(?:is|was|are|did|u|you)\s+|\s+(?:is|was|are)\s*$/gi, " ").replace(/\s+/g, " ").trim();
    }
    return null;
}
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stems = (t) => norm(t).split(" ").filter((w) => w.length >= 2).map((w) => (/\d/.test(w) ? w : w.slice(0, 5)));
const matches = (said, title) => {
    const a = stems(said);
    const b = stems(title);
    return a.length > 0 && (a.every((w) => b.includes(w)) || (b.length > 0 && b.every((w) => a.includes(w))));
};
const clock = (minute) => `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${minute < 720 ? "AM" : "PM"}`;
const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());
const phrase = (i) => (i.why?.length ? `it's ${i.why.join(" and ")}` : "it has no deadline and isn't high priority, so it sits behind what's due");
/** Today's reasons, or null when there are none or they are about another day. */
export function readPlanReasons(stateDir, today) {
    try {
        const file = JSON.parse(readFileSync(join(stateDir, "plan-reasons.json"), "utf8"));
        return file?.version === 1 && file.date === today && Array.isArray(file.items) && file.items.length ? file : null;
    }
    catch {
        return null;
    }
}
/** The answer in his plan's own words, or null when the plan has no such to-do. */
export function whyFirstAnswer(subject, reasons) {
    if (!reasons)
        return null;
    const items = [...reasons.items].sort((a, b) => (a.start ?? 99999) - (b.start ?? 99999) || a.rank - b.rank);
    const first = items[0];
    const at = (i) => (i.start !== undefined ? ` at ${clock(i.start)}` : "");
    if (!subject || matches(subject, first.title)) {
        return `${cap(first.title)} is first${at(first)} because ${phrase(first)}.${items.length > 1 ? " Anything with a deadline or a higher priority goes ahead of work with neither." : ""}`;
    }
    const idx = items.findIndex((i) => matches(subject, i.title));
    if (idx < 0)
        return null;
    const it = items[idx];
    return `${cap(it.title)} isn't first: ${first.title} is, because ${phrase(first)}. ${cap(it.title)} is number ${idx + 1}${at(it)} because ${phrase(it)}.`;
}
