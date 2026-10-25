/*
 The time backstop (live run 3, 2026-10-21: "block 2 hrs for econ homework tonight at 7" was written as `add "econ homework" 120`,
 no --at, and landed 1:20 PM). On EVERY write path (the intent layer, the form, a stored "go ahead?", the worker's restatement and the
 worker's own exec), a start time Nick said is checked against the start the write would use, after the same evening/AM-PM rules the
 intent layer uses (intent-time.ts). A write that would not start at a time he said is refused and he is asked; it never runs.

 2026-10-25 (day-plan incident): an END he says is checked too, on every write whose end can be known — resize included. "Study for CS
 Midterm from now until 6pm" was written as `resize "Study for CS Midterm" 300` (14:00–19:00) and nothing checked it: only starts were
 read, and resize was not a checked command. An end belongs to the thing named in its own clause; a write of that thing must end there.
*/
import { PART } from "./calendar-intent.js";
import { ampm, CLOCK, MIDNIGHT_END, parseClock, resolveStart, span, spokenTimesToDigits, toMin } from "./intent-time.js";
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
        // A move's bare "to 8" is read against the block's own time by whoever writes it (intent-run.ts): either half of the day is his (live run 4:
        // before 5 AM "to 8" read as 8 AM refused the right 20:00).
        if (move && !said.exact && said.h !== 12) {
            const am = (said.h % 12) * 60 + said.m;
            return [[am, am + 720]];
        }
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
/**
 * A lone add or move that simply left out the one start he said (the form wrote `add walk 45`, no --at, for "45 min walk today at 5pm"): the start
 * is put in, so a correct 17:00 write runs instead of being refused (live run 4). Anything else (a different time written, several writes,
 * an anchor, two times said, a time with two readings) returns undefined and the mismatch check decides.
 */
export function repairStart(message, argvs, ctx) {
    const writes = argvs.filter((a) => STARTS.has(a[0] ?? ""));
    const stated = statedStarts(message, ctx);
    if (writes.length !== 1 || stated.length !== 1 || stated[0].length !== 1)
        return undefined;
    const w = writes[0];
    const flag = w[0] === "add" ? "--at" : w[0] === "move" ? "--to" : undefined;
    if (!flag || w.includes(flag) || w.includes("--after") || w.includes("--before") || w.includes("--until"))
        return undefined;
    // The time must sit in the item's own clause: "add stretching, call mom at 5" — the 5 is the call's, never stretching's (review of efc37af).
    const title = (w[1] ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
    const clauses = spokenTimesToDigits(message).split(/[,;.!?]|\b(?:and|then|but|also|plus)\b/i);
    const timed = clauses.filter((c) => new RegExp(String.raw `\b(?:at|from|starting|to)\s+${CLOCK}(?![\w:])`, "i").test(c));
    if (timed.length !== 1 || !title.some((t) => new RegExp(`\\b${t}`, "i").test(timed[0])))
        return undefined;
    const at = stated[0][0];
    const fixed = [...w, flag, `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`];
    return argvs.map((a) => (a === w ? fixed : a));
}
/** What to say instead of running these writes, or undefined when every time he said is a start one of them uses. */
/** dayUnread: his day could not be read just now (the worker path reads it first), so an end that needs it is said as that, plainly. */
export function timeMismatch(message, argvs, ctx) {
    return startMismatch(message, argvs, ctx) ?? endMismatch(message, argvs, ctx.blocks, { dayUnread: ctx.dayUnread === true });
}
function startMismatch(message, argvs, ctx) {
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
    // Live run 5: "add stretching, call mom at 5" — the 5 is in another item's clause. Ask which it belongs to, plainly.
    const other = otherClauseItem(message, title);
    if (other)
        return `Want ${title} at ${other.time} too, or just the ${other.item}? What time for ${title}?`;
    const would = written.length ? `at ${written.map(ampm).join(", ")}` : "wherever there was room, not at that time";
    return `You said ${said}, but the change I worked out would have put ${title} ${would}, so I haven't changed anything. Say it again with the time, like "put ${title} at ${ampm(missing[missing.length - 1]).replace(":00", "")}".`;
}
/** The other item a stated time belongs to ("call" in "add stretching, call mom at 5"), when the time sits in a clause without this title. */
function otherClauseItem(message, title) {
    const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const clauses = spokenTimesToDigits(message).split(/[,;.!?]|\b(?:and|then|but|also|plus)\b/i).map((c) => c.trim()).filter(Boolean);
    const timed = clauses.filter((c) => new RegExp(String.raw `\b(?:at|from)\s+${CLOCK}(?![\w:])`, "i").test(c));
    const mentions = (c) => words.some((w) => new RegExp(`\\b${w}`, "i").test(c));
    if (timed.length !== 1 || mentions(timed[0]) || !clauses.some(mentions))
        return undefined;
    const lead = timed[0].replace(new RegExp(String.raw `\b(?:at|from)\s+${CLOCK}[\s\S]*$`, "i"), "").replace(/^(?:(?:add|put|schedule|book|and|also|a|an|the|my)\s+)+/i, "").trim();
    const item = lead.split(/\s+/)[0]?.toLowerCase();
    const time = timed[0].match(new RegExp(String.raw `\b(?:at|from)\s+(${CLOCK})(?![\w:])`, "i"))?.[1]?.trim();
    return item && time ? { item, time } : undefined;
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
// ---- ends (2026-10-25) ----
const ENDED = new RegExp(String.raw `\b(?:until|till|til|up\s+to)\s+(?<t>${CLOCK})(?![\w:])|\bfrom\s+(?:(?:right\s+)?now|${CLOCK})\s+to\s+(?<t2>${CLOCK})(?![\w:])`, "gi");
const END_CLAUSE = /(?:[,.;!?:]|\b(?:and|but|then|so|because|cause|cuz)\b)(?![\s\S]*(?:[,.;!?:]|\b(?:and|but|then|so|because|cause|cuz)\b))/i;
const END_STOP = new Set(["from", "now", "right", "until", "till", "til", "then", "today", "tonight", "home", "once", "back", "work", "working", "gonna", "going", "just", "only", "doing", "things", "thing", "the", "and", "for", "with", "get", "head", "will", "ill", "im",
    "have", "has", "had", "got", "class", "lecture", "busy", "stuck", "make", "makes", "let", "lets", "keep", "run", "runs", "end", "ends", "put", "set", "want", "need", "please", "pls", "can", "you"]);
// "I have lab until 4", "I'm in class till 5", "stuck at work until 6": an end of something he is busy with, not of the thing being written.
const BUSY = /\b(?:have|has|had|got|i'?m in|im in|i'?m at|im at|i am (?:in|at)|in class|at work|busy|stuck|out)\b/i;
const titleWords = (t) => t.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !END_STOP.has(w));
const sameWord = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
const covers = (all, some) => some.length > 0 && some.every((x) => all.some((y) => sameWord(x, y)));
/**
 * Whether the clause he said an end in names exactly this block (review: a shared word is not enough — "make study go until 6 and move
 * study lab to 7" must not hold the Study Lab move to 6). Every word of the title is in the clause; or every word of the clause is in the
 * title and no other block on the day has them all ("study till 6" is Study for CS Midterm only when that is the one study block).
 */
function names(clause, title, day) {
    const t = titleWords(title);
    if (covers(clause, t))
        return true;
    if (!covers(t, clause))
        return false;
    const others = (day?.blocks ?? []).filter((b) => b.title.toLowerCase() !== title.toLowerCase() && covers(titleWords(b.title), clause));
    return others.length === 0;
}
/** The minutes an end he said could be: "6pm" [1080], "6" [360, 1080], "12 am"/"midnight" [1440] (the end of today), "12" [720, 1440]. */
function endOptions(text) {
    const said = parseClock(text.replace(/\.$/, ""));
    if (!said)
        return [];
    if (said.exact) {
        const m = said.ap ? (said.h % 12) * 60 + (said.ap === "p" ? 720 : 0) + said.m : said.h * 60 + said.m;
        return [m === 0 ? MIDNIGHT_END : m];
    }
    const am = (said.h % 12) * 60 + said.m;
    return [am === 0 ? MIDNIGHT_END : am, am + 720]; // a bare "till 12" is noon or the end of today
}
/** Every end he says, with the words of the thing it belongs to (its own clause): "study till 6, then marketing till midnight". */
export function statedEnds(message) {
    const text = spokenTimesToDigits(message);
    // A move's "from 7 to 8" is where the block is and where it goes, not a span: only "until/till" are ends there.
    const move = MOVE_VERB.test(text);
    return [...text.matchAll(ENDED)].flatMap((h) => {
        if (move && !h.groups.t)
            return [];
        const t = (h.groups.t ?? h.groups.t2);
        const before = text.slice(0, h.index);
        // The clause starts AFTER the last boundary word or mark (it was cut one letter in: "hen marketing").
        const cut = before.match(END_CLAUSE);
        const clause = cut ? before.slice(cut.index + cut[0].length) : before;
        if (BUSY.test(clause))
            return [];
        const options = endOptions(t);
        const words = titleWords(clause);
        return options.length && words.length ? [{ options, words, said: t.replace(/\.$/, "").trim() }] : [];
    });
}
const blockEnd = (b) => (b.end === "00:00" && b.start !== "00:00" ? MIDNIGHT_END : toMin(b.end));
const endOpt = (t) => (t === "24:00" ? MIDNIGHT_END : t && /^\d{1,2}:\d{2}$/.test(t) ? toMin(t) : undefined);
const MAX_BLOCK = 720;
/** What each write does to its block: its title, and its start and end when they can be known (add --at + length, move --until or --to +
 *  its length, resize: its start + the new length, extend --until, each timed day --plan). A write whose end cannot be known has none. */
export function writtenBlocks(argv, day) {
    const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const block = (title) => day?.blocks.find((b) => b.title.toLowerCase() === String(title ?? "").toLowerCase());
    const title = argv[1] ?? "";
    const b = block(title);
    switch (argv[0]) {
        case "add": {
            const at = endOpt(opt("--at"));
            const n = Number(argv[2]);
            return [at !== undefined && Number.isFinite(n) ? { title, start: at, end: at + n } : { title }];
        }
        case "move": {
            const to = endOpt(opt("--to"));
            const until = endOpt(opt("--until"));
            const start = to ?? (until !== undefined && b ? until - (blockEnd(b) - toMin(b.start)) : undefined);
            const end = until ?? (to !== undefined && b ? to + blockEnd(b) - toMin(b.start) : undefined);
            return [{ title, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) }];
        }
        case "resize": {
            const n = Number(argv[2]);
            return [b && Number.isFinite(n) ? { title, start: toMin(b.start), end: toMin(b.start) + n } : { title }];
        }
        case "extend": {
            const until = endOpt(opt("--until"));
            return [until !== undefined ? { title, ...(b ? { start: toMin(b.start) } : {}), end: until } : { title }];
        }
        case "day": return argv.flatMap((a, i) => {
            if (argv[i - 1] !== "--plan")
                return [];
            const [t, n, at] = a.split(",").map((x) => x.trim());
            const start = endOpt(at);
            const len = Number(n);
            return t ? [start !== undefined && Number.isFinite(len) ? { title: t, start, end: start + len } : { title: t }] : [];
        });
        default: return [];
    }
}
/** The ends that can be known (kept for callers and tests). */
export const writtenEnds = (argv, day) => writtenBlocks(argv, day).flatMap((w) => (w.end !== undefined ? [{ title: w.title, end: w.end }] : []));
/**
 * A write of a thing he gave an end for that would end somewhere else, or whose end cannot be worked out (the worker's own
 * `resize … 300` read without his day: review, 2026-10-25), or any block over 12 hours: what to say instead, or undefined.
 */
export function endMismatch(message, argvs, day, opts = {}) {
    const stated = statedEnds(message);
    for (const w of argvs.flatMap((a) => writtenBlocks(a, day))) {
        if (w.start !== undefined && w.end !== undefined && w.end - w.start > MAX_BLOCK) {
            return `That would make ${w.title} ${span(w.start, w.end)}, over ${MAX_BLOCK / 60} hours. Is that right? I haven't changed anything.`;
        }
        const mine = stated.filter((s) => names(s.words, w.title, day));
        if (!mine.length)
            continue;
        const want = mine[0];
        const said = want.options.length === 1 ? ampm(want.options[0]) : want.options.map(ampm).join(" or ");
        if (w.end === undefined)
            return opts.dayUnread
                ? `I couldn't read your calendar just now, so I couldn't check that ${w.title} would end at ${said}, and I haven't changed anything. Try again in a moment.`
                : `You said ${w.title} until ${said}, but I couldn't work out when the change would end it, so I haven't changed anything. Say it again with the time.`;
        if (!mine.some((s) => s.options.includes(w.end))) {
            return `You said ${w.title} until ${said}, but the change I worked out would have ended it at ${ampm(w.end)}, so I haven't changed anything. Say it again and I'll end it at ${said}.`;
        }
    }
    return undefined;
}
