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
// A time that describes something else is not the item's start (review of 1c5e0ac): "my class ends at 5", "after my class at 3",
// "I'll be home at 6", "I'm at 5 percent". When it is unclear what a time belongs to, it is treated as not stated (never a refusal).
const OTHER_THING = /\b(?:ends?|ended|ending|finish(?:es|ed|ing)?|done|over|out|home|back|arriv\w*|gets?|got|land\w*|leav\w*|wake|woke|bed|sleep|class(?:es)?|lecture|lab|seminar|tutorial|meeting|appointment|shift|work|train|bus|flight|starts?|started|begins?|after|before|until|till|by|since|than|between)\b/i;
const SELF = /\b(?:i'?m|im|i am|we'?re|it'?s|its|i'?ll be|ill be|i will be|i was|he'?s|she'?s|they'?re)\s*$/i;
const AFTER_TIME = /^\s*(?:%|percent|pct|per ?cent|battery|degrees)/i;
const CLAUSE_END = /(?:[,.;!?]|\b(?:and|but|then|so|because|cause|cuz)\b)(?![\s\S]*(?:[,.;!?]|\b(?:and|but|then|so|because|cause|cuz)\b))/i;
/** Every start he says for the thing being written, as the minutes each could be: "tonight at 7" -> [[1140]], "at 9" tomorrow -> [[540, 1260]]. */
export function statedStarts(message, ctx) {
    const text = spokenTimesToDigits(message);
    const move = MOVE_VERB.test(text);
    const part = PART(text);
    return [...text.matchAll(STARTED)]
        .filter((h) => {
        const lead = h.groups.lead.toLowerCase();
        // A move: "to" is where it goes, "from" is where it is now ("move gym from 7 to 8"). Anything else: "from" starts it, "to" ends it.
        if (move ? /^(?:from|starting)/.test(lead) : lead === "to")
            return false;
        const before = text.slice(0, h.index);
        const clause = before.slice((before.match(CLAUSE_END)?.index ?? -1) + 1);
        const tail = clause.trim().split(/\s+/).slice(-4).join(" ");
        const after = text.slice(h.index + h[0].length);
        return !OTHER_THING.test(tail) && !SELF.test(clause) && !AFTER_TIME.test(after);
    })
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
/** A shell command line's words, quotes kept together. */
export function commandArgs(command) {
    return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}
// Every program that writes his calendar, wherever it sits in the command: bare, by path, inside `sh -c '…'` / `bash -lc "…"`, after `cd …;`.
const WRITER = /(?:^|[\s'"/;&|(`])(?<prog>orion-reschedule|orion-agenda-change|orion-plan-study)(?=[\s'";&|)`]|$)(?<rest>[^;&|\n`]*)/g;
/** Each calendar write a command line would run, as the scheduler argv the backstop reads (orion-agenda-change add is mapped to add --at). */
export function writesIn(command) {
    const flat = command.replace(/\\(["'])/g, "$1");
    return [...flat.matchAll(WRITER)].flatMap((m) => {
        const prog = m.groups.prog;
        // The quote that closes `bash -c '…'` is not part of the last word.
        const args = commandArgs(m.groups.rest.trim().replace(/['")]+$/, (q) => ((m.groups.rest.match(/['"]/g)?.length ?? 0) % 2 ? q.slice(1) : q))).map((a) => a.replace(/^['"]+|['"]+$/g, ""));
        if (prog === "orion-reschedule")
            return [args.filter((a) => a !== "")];
        if (prog === "orion-agenda-change") {
            const [cmd, title, start, minutes] = args;
            const at = /T(\d{2}:\d{2})$/.exec(start ?? "")?.[1];
            return cmd === "add" ? [["add", title ?? "", minutes ?? "60", ...(at ? ["--at", at] : [])]] : [];
        }
        // orion-plan-study picks its own slots: it never starts at a time he said.
        return args.includes("--book") ? [["add", args.filter((a) => a !== "--book").join(" "), "60"]] : [];
    });
}
