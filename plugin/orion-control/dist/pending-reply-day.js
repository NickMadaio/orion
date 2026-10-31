import { spokenReply } from "./schedule-reply.js";
export const BUFFER = 5;
export const DAY_END = 22 * 60;
export const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const two = (n) => String(n).padStart(2, "0");
/** "7:45 PM". */
export const h12 = (min) => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${(h + 11) % 12 + 1}:${two(m)} ${h < 12 ? "AM" : "PM"}`; };
/** "7:45pm" / "8am", the form the calendar intent reads. */
export const cmdTime = (min) => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${(h + 11) % 12 + 1}${m ? `:${two(m)}` : ""}${h < 12 ? "am" : "pm"}`; };
export const nowMinOf = (d) => d.getHours() * 60 + d.getMinutes();
/** Before 5 AM "tomorrow" is the day he wakes into, which is today's date (schedule-flow LATE_NIGHT_UNTIL). */
export const LATE_NIGHT = 5;
export const wakeDayIsToday = (now) => now.getHours() < LATE_NIGHT;
export const dayArgs = (which, now) => (which === "tomorrow" && !wakeDayIsToday(now) ? ["--date", "tomorrow"] : []);
export const dayWord = (which, now) => (which === "tomorrow" && !wakeDayIsToday(now) ? " tomorrow" : "");
const isSleep = (b) => b.kind === "sleep" || /^sleep\b/i.test(b.title);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** The block on the day he named: the exact title, else one whose title holds every word he used ("marketing" → "MKTG2201 Marketing"). */
export function blockNamed(day, name) {
    if (!day)
        return undefined;
    const want = norm(name).replace(/^(?:my|the|your)\s+/, "");
    if (!want)
        return undefined;
    const exact = day.blocks.find((b) => norm(b.title) === want);
    if (exact)
        return exact;
    const ws = want.split(" ").filter((w) => w.length > 2);
    return day.blocks.find((b) => ws.length > 0 && ws.every((w) => norm(b.title).includes(w)))
        ?? day.blocks.find((b) => ws.some((w) => norm(b.title).split(" ").includes(w)));
}
/** The first start in [from, to) where `minutes` fit with his five-minute buffer around every other block; undefined when none. */
export function freeSlot(day, minutes, from, to, skip) {
    const blocks = (day?.blocks ?? []).filter((b) => b !== skip && !isSleep(b) && toMin(b.end) > toMin(b.start))
        .map((b) => ({ s: toMin(b.start), e: toMin(b.end) })).sort((a, b) => a.s - b.s);
    let start = Math.ceil(from / 5) * 5;
    for (const b of blocks) {
        if (b.e + BUFFER <= start)
            continue;
        if (start + minutes + BUFFER <= b.s)
            return start + minutes <= to ? start : undefined;
        start = Math.max(start, Math.ceil((b.e + BUFFER) / 5) * 5);
    }
    return start + minutes <= to ? start : undefined;
}
/** The fixed block that anchors the day he wakes into (his first class), for "CS2100 at 9:00 AM stays". */
export const firstFixed = (day) => (day?.blocks ?? []).filter((b) => b.fixed && !isSleep(b)).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
/** What is on now and what comes next, from the real day. */
export function nowAndNext(day, nowMin) {
    const blocks = (day?.blocks ?? []).filter((b) => !isSleep(b)).sort((a, b) => toMin(a.start) - toMin(b.start));
    const current = blocks.find((b) => toMin(b.start) <= nowMin && nowMin < toMin(b.end));
    const next = blocks.find((b) => toMin(b.start) > nowMin);
    return { ...(current ? { current } : {}), ...(next ? { next } : {}) };
}
/** A title the calendar intent reads as a name: no course numbers, nothing but words ("MKTG2201" → "MKTG"). */
export const safeTitle = (s, fallback) => {
    const t = s.replace(/\d+/g, " ").replace(/[^A-Za-z' -]+/g, " ").replace(/\s+/g, " ").trim();
    return t || fallback;
};
export const addCommand = (title, minutes, which, start, now) => `add a ${minutes} min ${title}${dayWord(which, now)} at ${cmdTime(start)}`;
export const moveCommand = (title, which, start, now) => `move ${dayWord(which, now) ? "tomorrow's " : ""}${title} to ${cmdTime(start)}`;
/** What the scheduler said, as his reply: its own built reply, its lines read out, or its refusal. */
export function flowText(flow) {
    if (!flow || flow.outcome === "fallback")
        return undefined;
    if (flow.outcome === "say")
        return flow.text;
    return flow.reply ?? spokenReply(flow.outputs);
}
/** Whether the scheduler wrote (a "done" that is not an unknown outcome). */
export const flowWrote = (flow) => flow?.outcome === "done" && !flow.uncertain;
