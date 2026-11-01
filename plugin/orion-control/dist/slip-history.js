/*
 How often something he is putting off has already slid (Wave 6, gate run-1101003318: rea-work-on-it-tomorrow-v).

 "ill do the resume tomorrow" booked the block and said "Done", though his own record shows the resume sliding again and again: the
 only check was "slipped at least twice THIS WEEK" by the card's 7-day window. A thing that slips every few days never tripped it.
 Here the two records of a plan that did not happen are read over two weeks: slips.jsonl (what the plan said and reality did not do)
 and life-history.jsonl (a planned block with no actual start). One count per day, matched by the words of the title ("resume" is
 "finish resume"). The line built from it names the count and the first date, and makes tomorrow's start small. Nothing on record:
 nothing is said (no invented pattern).
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ordinal } from "./state-card.js";
export const DEFER_WINDOW_DAYS = 14;
const rows = (path) => {
    try {
        return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((l) => { try {
            return [JSON.parse(l)];
        }
        catch {
            return [];
        } });
    }
    catch {
        return [];
    }
};
const STOP = new Set(["the", "my", "a", "an", "on", "of", "for", "and", "to", "finish", "work", "do", "start", "get"]);
const words = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Distinct days in the last two weeks a plan named like `title` slipped or never started, and the first of them. */
export function deferralsOf(stateDir, title, now) {
    const want = words(title);
    if (!stateDir || !want.length)
        return { count: 0 };
    const from = now.getTime() - DEFER_WINDOW_DAYS * 86400_000;
    const named = (t) => !!t && want.every((w) => words(t).some((x) => x.startsWith(w) || w.startsWith(x)));
    const inWindow = (at) => { const ms = at ? Date.parse(at) : NaN; return Number.isFinite(ms) && ms >= from && ms < now.getTime(); };
    const days = new Set();
    for (const r of rows(join(stateDir, "slips.jsonl")))
        if (named(r.planned?.title) && inWindow(r.at))
            days.add(dayKey(new Date(r.at)));
    for (const r of rows(join(stateDir, "life-history.jsonl")))
        if (named(r.what) && r.actualStart === null && inWindow(r.at))
            days.add(dayKey(new Date(r.at)));
    const sorted = [...days].sort();
    return sorted.length ? { count: sorted.length, since: sorted[0] } : { count: 0 };
}
const spokenDate = (key) => new Date(`${key}T12:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** The line after the booking: this push counted with the ones on record, and a small first step. Empty with nothing on record. */
export function slipAck(d) {
    if (!d.count || !d.since)
        return "";
    return ` That's the ${ordinal(d.count + 1)} time it's been pushed since ${spokenDate(d.since)}, so tomorrow isn't the big finish: give it the first 15 minutes, one section, then you can stop. What's been making it hard to start?`;
}
