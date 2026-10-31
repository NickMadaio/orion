/*
 Read-only questions about his calendar and his week (2026-10-31 gate run-1031133008, cluster 8).

 "list everything on my calendar today with times" (sch-whats-today-c) and "have i been going to the gym" (hea-gym-streak-v)
 went down the write path and came back "I couldn't make that change": neither starts with a question word, so they were
 read as change requests. A day read is answered from the calendar; a habit question from what was tracked
 (life-history.jsonl: each planned block and whether it happened; logged.jsonl: what he said he did). Never a guess.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
const CHANGE = /\b(?:move|push|pull|add|put|book|cancel|drop|clear|delete|remove|shift|swap|extend|shorten|skip|reschedule|plan my|replan|fix)\b/i;
const DAY_READ = /^(?:(?:ok(?:ay)?|so|hey|orion|please|pls|can you|could you|can u|just|quickly)[,\s]+)*(?:list|show(?: me)?|tell me|read(?: me| out| me out)?|give me|go over|run through|walk me through|run me through)\b.*\b(?:calendar|schedule|day|agenda|plan|blocks?|events?|today|tonight|tomorrow|tmrw)\b/i;
/** "list everything on my calendar today with times", "show me my schedule", "read me my day": a read, not a change. */
export const asksDayRead = (message) => DAY_READ.test(message.trim()) && !CHANGE.test(message);
const HABIT = /^(?:(?:so|ok(?:ay)?|hey|orion|wait|be honest|honestly|real talk)[,\s]+)*(?:(?:have|has)\s+i\s+(?:actually\s+|really\s+)?(?:been(?=\s+(?:study|working out))|(?:been\s+)?(?:going to|going|doing|hitting|making it to|keeping up with|done|gone to|gone|stuck to|sticking to))|(?:how (?:often|many times|many days)|how much)\s+(?:have i|did i|do i)\s+(?:been\s+)?(?:go(?:ne)?(?: to)?|done|do|hit|made it to|went(?: to)?))\s+(?:the\s+|my\s+)?(?<what>gym|workouts?|working out|study(?:ing)?|classes|class|lectures?|side project|youtube)\b/i;
/** The kind of block a habit question is about ("gym"), or null when it is not one. */
export function asksHabit(message) {
    const h = HABIT.exec(message.trim().replace(/\?+\s*$/, ""));
    if (!h?.groups)
        return null;
    const w = h.groups.what.toLowerCase();
    return /^(?:gym|workouts?|working out)$/.test(w) ? "gym" : /^stud/.test(w) ? "study" : /^(?:class|classes|lectures?)$/.test(w) ? "class" : /youtube|side project/.test(w) ? "side_project" : null;
}
const readRows = (path) => { try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((l) => { try {
        return [JSON.parse(l)];
    }
    catch {
        return [];
    } });
}
catch {
    return [];
} };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekday = (key) => new Date(`${key}T12:00`).toLocaleDateString("en-GB", { weekday: "short" });
const NAME = { gym: "gym", study: "studying", class: "classes", side_project: "your side project" };
/** The answer from what was tracked over the last 7 days: days it happened, days it was planned and missed. Read-only. */
export function habitAnswer(kind, stateDir, now) {
    const since = new Date(now.getTime() - 7 * 86400_000);
    const inWeek = (r) => !!r.at && new Date(r.at) >= since && new Date(r.at) <= now;
    const of = (r) => r.kind === kind || (kind === "gym" && /\bgym\b/i.test(r.what ?? ""));
    const happened = new Set();
    const missed = new Set();
    for (const r of readRows(join(stateDir, "life-history.jsonl")).filter((x) => inWeek(x) && of(x)))
        (r.actualStart === null || r.actualStart === undefined ? missed : happened).add(dayKey(new Date(r.at)));
    for (const r of readRows(join(stateDir, "logged.jsonl"))) {
        const at = r.date;
        if (at && of(r) && new Date(`${at}T12:00`) >= since && new Date(`${at}T00:00`) <= now)
            happened.add(at);
    }
    for (const d of happened)
        missed.delete(d);
    const name = NAME[kind] ?? kind;
    if (!happened.size && !missed.size)
        return `I don't have ${name} tracked for the last week, so I can't tell you honestly. If you tell me when you went, I'll log it from now on.`;
    const days = (s) => [...s].sort().map(weekday).join(", ");
    const planned = happened.size + missed.size;
    const lead = `In the last 7 days ${name} happened on ${happened.size} of the ${planned} day${planned === 1 ? "" : "s"} it was planned`;
    return `${lead}${happened.size ? ` (${days(happened)})` : ""}${missed.size ? `; it didn't on ${days(missed)}` : ""}.${happened.size >= planned - 1 ? " That's solid." : missed.size >= 3 ? " That's a pattern worth fixing: want me to make tomorrow's shorter so it actually happens?" : ""}`;
}
