/*
 The time backstop (live run 3, 2026-10-21: "block 2 hrs for econ homework tonight at 7" was written as `add "econ homework" 120`,
 no --at, and landed 1:20 PM). On EVERY write path (the intent layer, the form, a stored "go ahead?", the worker's restatement and the
 worker's own exec), a start time Nick said is checked against the start the write would use, after the same evening/AM-PM rules the
 intent layer uses (intent-time.ts). A write that would not start at a time he said is refused and he is asked; it never runs.
*/
import { PART } from "./calendar-intent.js";
import { ampm, CLOCK, parseClock, resolveStart, spokenTimesToDigits, toMin } from "./intent-time.js";
/** The commands whose start a stated time decides. Others (extend, late, resize, drop, log, undo …) are not checked. */
const STARTS = new Set(["add", "move", "day", "now"]);
const STARTED = new RegExp(String.raw `\b(?<lead>at|from|starting(?:\s+at)?|to)\s+(?<t>${CLOCK})(?![\w:])`, "gi");
const MOVE_VERB = /\b(?:move|push|shift|bump|reschedule|change)\b/i;
/** Every start he says, as the minutes each could be: "tonight at 7" -> [[1140]], "at 9" tomorrow -> [[540, 1260]] (either is his). */
export function statedStarts(message, ctx) {
    const text = spokenTimesToDigits(message);
    const hits = [...text.matchAll(STARTED)];
    const from = hits.some((h) => /^from|^starting/i.test(h.groups.lead));
    const part = PART(text);
    return hits
        // "to 7" is a start only for a move with no "from" ("move gym to 7"); in "from 5 to 7" it is the end.
        .filter((h) => !/^to$/i.test(h.groups.lead) || (!from && MOVE_VERB.test(text)))
        .flatMap((h) => {
        const said = parseClock(h.groups.t);
        if (!said)
            return [];
        // A time already past is still the time he said; whether it has passed is not this check's business.
        const r = resolveStart(said, { day: ctx.day, now: ctx.now, ...(part ? { part } : {}) });
        return "at" in r ? [[r.at]] : "ambiguous" in r ? [r.ambiguous] : [[r.passed]];
    });
}
/** The start a scheduler argv would write, per block: add --at, move --to, now --at, each day --plan's time. Empty: it picks the time itself. */
export function writtenStarts(argv) {
    const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && /^\d{1,2}:\d{2}$/.test(argv[i + 1] ?? "") ? [toMin(argv[i + 1])] : []; };
    if (argv[0] === "add" || argv[0] === "now")
        return opt("--at");
    if (argv[0] === "move")
        return opt("--to");
    if (argv[0] === "day")
        return argv.flatMap((a, i) => (argv[i - 1] === "--plan" ? a.split(",").map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map(toMin) : []));
    return [];
}
/** What to say instead of running these writes, or undefined when every time he said is a start one of them uses. */
export function timeMismatch(message, argvs, ctx) {
    const writes = argvs.filter((a) => STARTS.has(a[0] ?? ""));
    if (!writes.length)
        return undefined;
    const stated = statedStarts(message, ctx);
    if (!stated.length)
        return undefined;
    const written = writes.flatMap(writtenStarts);
    const missing = stated.find((options) => !options.some((m) => written.includes(m)));
    if (!missing)
        return undefined;
    const title = writes[0][0] === "day" ? (writes[0][2] ?? "").split(",")[0].trim() : writes[0][1] ?? "it";
    const said = missing.map(ampm).join(" or ");
    const would = written.length ? ` at ${written.map(ampm).join(", ")}` : " at a time of its own";
    return `You said ${said}, but that change would have put ${title}${would}, so I haven't changed anything. Say it again with the time, like "put ${title} at ${ampm(missing[missing.length - 1]).replace(":00", "")}".`;
}
/** A shell command line's words, quotes kept together (the worker's exec of orion-reschedule). */
export function commandArgs(command) {
    return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}
