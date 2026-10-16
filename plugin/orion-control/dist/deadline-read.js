/*
 "whats due this week", answered by code. Live sweep 2026-10-16 (r8) q041: the 9B ran `orion-agenda deadlines` itself
 (lectures, holidays and people in the output) and said the all-day Macro Quiz 1 was "today at 1:30 PM" (the lecture's line).
 Code reads the deadlines (orion-agenda deadlines --json marks them with live-day.mjs's rule) and the dated to-dos
 (orion-tasks list), and builds the reply. All-day items are "(all day)", never a time. Written by Claude on 2026-10-16.
*/
import { execFile } from "node:child_process";
import { spokenTime } from "./day-read-answers.js";
import { LATE_NIGHT_UNTIL, TOMORROW } from "./schedule-flow.js";
const AGENDA = "/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda";
const TASKS = "/Users/nickmadaio/Desktop/ORION/scripts/orion-tasks";
const ASKS = /\b(?:what'?s|whats|what is|what are|which|any|anything|do i have|how many)\b[^.?]*\b(?:due|deadlines?)\b/i;
// A bare noun phrase with no "?" ("any deadlines coming up", "my deadlines", "deadlines this week"); "my deadlines are killing me" is not one.
const BARE = /\b(?:my|upcoming|any) deadlines?\b|^\s*deadlines? (?:this|next|today|tomorrow|coming)\b/i;
const STATEMENT = /\b(?:is|are|was|were|am|i'?m|i've|have|has)\b/i;
const CHANGES = /\b(?:make|set|move|push|change|add|remind|schedule|cancel|drop|skip)\b/i;
// r8 review 2 HIGH-2 (2026-10-16): another request ("plan a chill day", "tell sam whats due friday") or a negation ("nothing is due") is not the question.
const OTHER_REQUEST = /\b(?:plan|book|put|block|clear|text|tell|send|email|remind|add|move)\b|\b(?:don'?t|dont|nothing|no)\b|\bnothing'?s\b/i;
/**
 * A question about what is due; a change ("make the essay due friday") is not one. The question form needs a real question
 * (`question`: a "?" or a question opener, "i wonder what's due" is neither); only a bare noun phrase passes without one.
 */
export const asksDeadlines = (message, question = /\?\s*$/.test(message.trim())) => !CHANGES.test(message) && !OTHER_REQUEST.test(message) && ((question && ASKS.test(message)) || (BARE.test(message) && !STATEMENT.test(message)));
const ymd = (d) => d.toLocaleDateString("en-CA");
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NAMED_DAY = /\b(?:(?<by>by|before)\s+)?(?:(?<next>next)\s+)?(?:on\s+|this\s+|next\s+)?(?<day>sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/**
 * [first day, last day] offsets from today, and how it is said. Calendar weeks (r8 review 2026-10-16 M2): "this week" is today
 * through Sunday, "next week" the coming Monday through Sunday; "tomorrow" (or "tmrw") is the day after today, but
 * before 5 AM he is still up and it is today's date (schedule-flow's rule); a weekday is its next date.
 */
function windowOf(message, now) {
    const dow = now.getDay();
    if (TOMORROW.test(message)) {
        const n = now.getHours() >= LATE_NIGHT_UNTIL ? 1 : 0;
        return { from: n, to: n, label: "tomorrow" };
    }
    if (/\btoday\b|\btonight\b/i.test(message))
        return { from: 0, to: 0, label: "today" };
    const toMonday = ((8 - dow) % 7) || 7;
    if (/\bnext week\b/i.test(message))
        return { from: toMonday, to: toMonday + 6, label: "next week" };
    const named = NAMED_DAY.exec(message);
    if (named?.groups?.day) {
        const target = DAY_NAMES.indexOf(named.groups.day.toLowerCase());
        // "next friday" is that day in the coming Monday-to-Sunday week; a bare weekday is its next date (today when it is today).
        const off = named.groups.next ? toMonday + (target + 6) % 7 : (target - dow + 7) % 7;
        const name = named.groups.day.toLowerCase();
        // HIGH-3: "next friday" on a Monday is 11 days off, so its date is said; "by friday" is today through Friday, "before friday" leaves Friday out.
        if (named.groups.by)
            return { from: 0, to: named.groups.by.toLowerCase() === "before" ? off - 1 : off, label: `${named.groups.by.toLowerCase()} ${name}` };
        return { from: off, to: off, label: named.groups.next ? `next ${WEEKDAY[target]}, ${addDays(now, off).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : name };
    }
    return { from: 0, to: (7 - dow) % 7, label: "this week" };
}
function describe(item, today) {
    const late = today.getHours() < LATE_NIGHT_UNTIL;
    const days = Math.round((dayStart(item.date).getTime() - dayStart(today).getTime()) / 86400000);
    // M2: between midnight and 5 AM "today" is ambiguous (he is still up), so a near day is its weekday.
    return days === 0 && !late ? "today" : days === 1 && !late ? "tomorrow" : days < 7 ? WEEKDAY[item.date.getDay()] : `${WEEKDAY[item.date.getDay()]} ${item.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function items(read, today) {
    const events = read.events.filter((e) => e.isDeadline).flatMap((e) => {
        const at = new Date(e.start);
        if (Number.isNaN(at.getTime()))
            return [];
        const allDay = e.allDay === "true";
        return [{ date: at, minute: allDay ? -1 : at.getHours() * 60 + at.getMinutes(), text: e.title, tail: allDay ? "all day" : `at ${spokenTime(at.getHours(), at.getMinutes())}` }];
    });
    const tasks = read.tasks.flatMap((t) => {
        const at = new Date(`${t.due}T00:00:00`);
        return Number.isNaN(at.getTime()) ? [] : [{ date: at, minute: 1441, text: `${t.title} (to-do)`, tail: "" }];
    });
    return [...events, ...tasks].sort((a, b) => ymd(a.date).localeCompare(ymd(b.date)) || a.minute - b.minute).map((i) => {
        const where = describe({ text: i.text, date: i.date, minute: i.minute }, today);
        // "Monday at 1:00 PM", "today (all day)", "tomorrow" (a to-do has a day only).
        const when = i.tail === "all day" ? `${where} (all day)` : i.tail ? `${where} ${i.tail}` : where;
        return { text: `${i.text}, ${when}`, date: i.date, minute: i.minute };
    });
}
/** The spoken answer to "what's due …" from the read. */
export function deadlineReply(message, read, today) {
    const win = windowOf(message, today);
    const { from, to } = win;
    const late = today.getHours() < LATE_NIGHT_UNTIL;
    const label = late && (win.label === "today" || win.label === "tomorrow") ? WEEKDAY[addDays(today, from).getDay()] : win.label;
    const first = ymd(addDays(today, from));
    const last = ymd(addDays(today, to));
    const todos = read.tasksFailed ? "I couldn't read your to-dos." : "";
    const all = items(read, today);
    const inside = all.filter((i) => ymd(i.date) >= first && ymd(i.date) <= last);
    if (inside.length)
        return `Due ${label}: ${inside.map((i) => i.text).join("; ")}.${todos ? ` ${todos}` : ""}`;
    const next = all.find((i) => ymd(i.date) > last);
    // M3: with the to-do read failed, only the calendar is known: never "Nothing is due".
    if (todos)
        return `Nothing on your calendar is due ${label}, but ${todos}`;
    return `Nothing is due ${label}.${next ? ` The next deadline is ${next.text}.` : ""}`;
}
/** Dated open to-dos from `orion-tasks list` ("- title · due 2026-10-17 · medium"). */
export function parseTasks(stdout) {
    return stdout.split("\n").flatMap((line) => {
        const m = /^- (.+?) · due (\d{4}-\d{2}-\d{2})\b/.exec(line.trim());
        return m ? [{ title: m[1], due: m[2] }] : [];
    });
}
const run = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 30000, maxBuffer: 1 << 20 }, (e, stdout) => resolve(e ? null : String(stdout ?? ""))));
/** Reads the calendar's deadlines and the dated to-dos (read-only); null when the calendar read fails, so the worker takes over. */
export async function liveReadDeadlines() {
    const [agenda, tasks] = await Promise.all([run(AGENDA, ["deadlines", "--json"]), run(TASKS, ["list"])]);
    if (agenda === null)
        return null;
    try {
        const events = JSON.parse(agenda);
        return Array.isArray(events) ? { events, tasks: parseTasks(tasks ?? ""), ...(tasks === null ? { tasksFailed: true } : {}) } : null;
    }
    catch {
        return null;
    }
}
