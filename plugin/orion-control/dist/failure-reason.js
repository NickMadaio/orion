/*
 Why a request did not go through, as data (w20 wording, 2026-11-04 tube audit, root cause 1).
 The scheduler refused with a reason ("gym at 10 PM is after your 9:50 bedtime"); the words Nick heard were "gym didn't fit".
 A reason is read two ways, so both merge cleanly:
   - structured: a `reason` field (a code string, or an object with `code` and details) from orion-reschedule's JSON;
   - text: the scheduler's own failure line as it reads today.
 From a reason code can say what happened in one first-person sentence and what to do about it (reasonSentence, reasonOffer).
*/
const ALIASES = {
    bedtime: "bedtime", after_bedtime: "bedtime", past_bedtime: "bedtime", day_ends: "bedtime", asleep_by: "bedtime",
    started: "started", already_started: "started", in_progress: "started", underway: "started", start_passed: "started", start_in_past: "started",
    over: "over", already_over: "over", ended: "over", past: "over", in_the_past: "over",
    no_block: "no_block", not_found: "no_block", missing: "no_block", unknown_block: "no_block", no_match: "no_block",
    no_room: "no_room", did_not_fit: "no_room", no_fit: "no_room", conflict: "no_room",
    fixed: "fixed_event", fixed_event: "fixed_event", class: "fixed_event",
    other_day: "other_day", wrong_day: "other_day",
    exists: "exists", already_there: "exists", duplicate: "exists",
};
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const clock = (v) => { const s = str(v); const m = s?.match(/^(\d{1,2}):(\d{2})$/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s; };
/** A structured reason: {reason: "bedtime"} or {reason: {code, what, at, now, bedtime}} (also `kind`/`code` at the top level). */
export function fromStructured(input) {
    if (!input || typeof input !== "object")
        return undefined;
    const o = input;
    const inner = o.reason && typeof o.reason === "object" ? o.reason : undefined;
    const code = str(inner?.code ?? inner?.kind ?? (typeof o.reason === "string" ? o.reason : undefined) ?? o.code ?? o.kind);
    const kind = code ? ALIASES[code.toLowerCase().replace(/[\s-]+/g, "_")] : undefined;
    if (!kind)
        return undefined;
    const pick = (k) => inner?.[k] ?? o[k];
    const what = str(pick("what") ?? pick("title") ?? pick("block"));
    const at = clock(pick("at") ?? pick("start"));
    const now = clock(pick("now"));
    const bedtime = clock(pick("bedtime") ?? pick("asleepBy"));
    return { kind, ...(what ? { what } : {}), ...(at ? { at } : {}), ...(now ? { now } : {}), ...(bedtime ? { bedtime } : {}) };
}
/** A JSON object riding in a line ("{"reason":"bedtime",...}") or a `reason=bedtime` token. */
function structuredIn(line) {
    const json = line.match(/\{[^{}]*"(?:reason|code)"[^{}]*\}/)?.[0];
    if (json) {
        try {
            const r = fromStructured(JSON.parse(json));
            if (r)
                return r;
        }
        catch { /* not JSON */ }
    }
    const tok = line.match(/\breason[=:]\s*"?([a-z_]+)"?/i)?.[1];
    return tok ? fromStructured({ reason: tok }) : undefined;
}
const hm = (t) => t;
const clean = (s) => s.replace(/^["“]|["”]$/g, "").trim();
/** One scheduler failure line (as it reads today) or a structured reason → a Reason. */
export function parseReason(input) {
    if (typeof input !== "string")
        return fromStructured(input) ?? { kind: "unknown" };
    const line = input.trim().replace(/^orion-reschedule:\s*/, "").replace(/^(?:MUST-HAVE )?(?:NOTHING WAS|NOT) (?:CHANGED|BOOKED|DROPPED)\b(?: on \w+day)?(?: \(\d{4}-\d{2}-\d{2}\))?[:.]?\s*/i, "");
    const structured = structuredIn(input);
    let m;
    const named = (r) => ({ ...structured, ...r, ...(structured?.what && !r.what ? { what: structured.what } : {}), raw: line });
    if ((m = line.match(/^(.+?) at (\d{2}:\d{2}) has already started \(it is (\d{2}:\d{2})\)/i)))
        return named({ kind: "started", what: m[1], at: hm(m[2]), now: hm(m[3]) });
    if ((m = line.match(/^(.+?) has already started \(it is (\d{2}:\d{2})\)/i)))
        return named({ kind: "started", what: m[1], now: m[2] });
    if ((m = line.match(/^(.+?) cannot start at (\d{2}:\d{2}); it is already (\d{2}:\d{2})/i)))
        return named({ kind: "started", what: m[1], at: m[2], now: m[3] });
    if ((m = line.match(/^(.+?) (?:is|are) already over today/i)))
        return named({ kind: "over", what: m[1] });
    if ((m = line.match(/^(.+?) already ended at (\d{2}:\d{2})/i)))
        return named({ kind: "over", what: m[1], at: m[2] });
    if (/is in the past/i.test(line))
        return named({ kind: "over" });
    if ((m = line.match(/^no block called "?(.+?)"? on /i)))
        return named({ kind: "no_block", what: clean(m[1]) });
    if ((m = line.match(/^no class or fixed plan called "?(.+?)"? left/i)))
        return named({ kind: "no_block", what: clean(m[1]) });
    if ((m = line.match(/^no "(.+?)" on .* to put it after/i)))
        return named({ kind: "no_block", what: clean(m[1]) });
    if (/^no movable block matches/i.test(line))
        return named({ kind: "no_block" });
    if ((m = line.match(/^"?(.+?)"? is one of his own calendar events/i)))
        return named({ kind: "fixed_event", what: clean(m[1]) });
    if ((m = line.match(/^(.+?) is already on today's calendar \((\d{2}:\d{2})–(\d{2}:\d{2})\)/i)))
        return named({ kind: "exists", what: m[1], at: m[2] });
    if ((m = line.match(/^(.+?) is on (\d{4}-\d{2}-\d{2})/i)))
        return named({ kind: "other_day", what: m[1], at: m[2] });
    if (/past (?:his|your) bedtime|asleep by|after (?:his|your) bedtime/i.test(line))
        return named({ kind: "bedtime" });
    if ((m = line.match(/^(.+?) \(\d+ min\) (?:no longer fits|did not fit)/i)) || (m = line.match(/^must-haves could not fit: (.+?)\.?$/i)) || (m = line.match(/^(.+?) does not fit on /i)))
        return named({ kind: "no_room", what: m[1] });
    if ((m = line.match(/^(.+?) did not fit\b/i)))
        return named({ kind: "no_room", what: m[1] });
    if (/could not be booked exactly as he said|did not fit|no longer fits/i.test(line))
        return named({ kind: "no_room" });
    return structured ? named({ kind: structured.kind }) : { kind: "unknown", raw: line };
}
const ampm = (t) => { const m = t.match(/^(\d{1,2}):(\d{2})$/); if (!m)
    return t; const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`; };
const when = (t) => (t ? ampm(t) : "");
const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** What happened, as a clause that reads after "I couldn't do that because" or alone ("gym at 10:00 PM is after your bedtime"). */
export function reasonClause(r) {
    const what = r.what ?? "that";
    switch (r.kind) {
        case "bedtime": return `${what}${r.at ? ` at ${when(r.at)}` : ""} is after ${r.bedtime ? `your ${when(r.bedtime)} bedtime` : "your bedtime"}`;
        case "started": return `${what} already started${r.at ? ` at ${when(r.at)}` : ""}${r.now ? ` and it's ${when(r.now)}` : ""}`;
        case "over": return r.at ? `${what === "that" ? "that" : what} already ended at ${when(r.at)}` : `${what === "that" ? "that time" : what} has already ended today`;
        case "no_block": return r.what ? `there's no block called ${r.what}` : "there's no movable block by that name";
        case "no_room": return `${what} didn't fit`;
        case "fixed_event": return `${what === "that" ? "that" : what} is a class or a plan with people, so it doesn't move`;
        case "other_day": return `${what} is on ${r.at && /^\d{4}-/.test(r.at) ? "another day" : "a different day"}`;
        case "exists": return `${what} is already on today's calendar${r.at ? ` at ${when(r.at)}` : ""}`;
        default: return r.raw ? r.raw.replace(/\b(\d{2}:\d{2})\b/g, (t) => ampm(t)).replace(/\.$/, "") : "";
    }
}
/** The concrete next step for this reason, as a question or an offer Nick can answer in a word. */
export function reasonOffer(r) {
    switch (r.kind) {
        case "bedtime": return "Want me to move your bedtime for it, or book it anyway?";
        case "started": return `Want me to put ${r.what ?? "it"} on from now instead?`;
        case "over": return "If you meant another day, tell me which and I'll put it there.";
        case "no_block": return "Which block did you mean? Tell me its name as it's on your day.";
        case "no_room": return "Tell me what to push out and I'll make room.";
        case "fixed_event": return "I can skip it for today if you're not going. Want that?";
        case "other_day": return "Want me to put it on that day?";
        case "exists": return "Want it moved or made longer instead?";
        default: return "Want me to try it a different way?";
    }
}
/** A different, more useful line for the same failure asked again: the reason plus what to do next, never the first line again. */
export function repeatOffer(r) {
    switch (r.kind) {
        case "bedtime": return "Say \"move bedtime to 11\" or \"book it anyway\" and I'll do one of those; asking again as is won't change it.";
        case "started": return `Say "I'm doing ${r.what ?? "it"} now" and I'll log it as running from now.`;
        case "over": return "Name the day it's for, or say \"log it\" if it already happened.";
        case "no_block": return "Tell me the block's exact name, or say \"add it\" if it isn't on your day yet.";
        case "no_room": return "Tell me what to push out and I'll make room for it.";
        case "fixed_event": return "Say \"skip it today\" if you're not going.";
        case "other_day": return "Tell me to put it on that day and I will.";
        case "exists": return "Say \"extend it\" or \"move it\" and give me the time.";
        default: return "Give me a different time or name and I'll try that. If you think I should be able to do this, say \"build that\" and I'll start on it.";
    }
}
/** A failure line already spoken ("I couldn't do that: gym at 10 PM is after your bedtime...") read back into a reason, by its words. */
export function reasonFromSpoken(text) {
    const first = parseReason(text.replace(/^Not done:\s*/i, ""));
    if (first.kind !== "unknown")
        return first;
    const t = text.toLowerCase();
    const kind = /bedtime/.test(t) ? "bedtime" : /already started/.test(t) ? "started" : /already (?:over|ended)|has already ended/.test(t) ? "over"
        : /no block called|no movable block/.test(t) ? "no_block" : /didn't fit|isn't room|no room/.test(t) ? "no_room" : /class or a plan with people/.test(t) ? "fixed_event"
            : /already on (?:today's|your) calendar/.test(t) ? "exists" : undefined;
    const what = text.replace(/^(?:Not done:|I couldn't [^:]*:)\s*/i, "").match(/^(.+?) (?:already started|is already on|didn't fit|is a class or a plan)/i)?.[1];
    return kind ? { kind, ...(what ? { what } : {}), raw: text } : { kind: "unknown", raw: text };
}
export { ucfirst };
