import { movesThisOne } from "./own-event-writes.js";
import { blocksNamedBy } from "./block-names.js";
/*
 Wave 4 review MUST 1 (2026-11-01): `--named` is code's flag. compile (schedule-flow.ts) and overrunIsMove add it only after his own words
 name the event, and code runs the scheduler itself (deps.run), never through a worker exec. So any worker / model exec that carries the
 flag is refused, whatever the program, path or wrapper (absolute path, `node <path>`, env prefixes, `bash -c '…'`).
*/
const NAMED_FLAG = /(?:^|[\s'"=;&|(`])--named(?=$|[\s'"=;&|)`])/;
/** The command line carries `--named` anywhere (quotes and escaped quotes included). */
export const carriesNamedFlag = (command) => NAMED_FLAG.test(command.replace(/\\(["'])/g, "$1"));
const VERBS = new Set(["drop", "move", "resize", "swap", "rename", "displace"]);
const STOP = new Set(["the", "and", "for", "with", "block", "session", "time", "today", "tonight"]);
const kindOf = (b) => (b.kind === "gym" || /\bgym\b|\bworkout\b/i.test(b.title) ? "gym"
    : b.kind === "study" || /\b(?:study|revis\w*|homework|problem set)\b/i.test(b.title) ? "study" : null);
const words = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
/** He named this block: its kind word ("gym", "study"/"studying"/"revision") or a distinctive word of its title. */
export function namesBlock(message, b) {
    const said = message.toLowerCase();
    const kind = kindOf(b);
    if (kind === "gym" && /\b(?:gym|workout|lift(?:ing)?|training)\b/.test(said))
        return true;
    if (kind === "study" && /\b(?:study|studying|revision|revise|homework|problem set)\b/.test(said))
        return true;
    return words(b.title).filter((w) => !["study", "gym"].includes(w)).some((w) => new RegExp(`\\b${w}`).test(said));
}
// Review MUST 1: the scheduler resolves a title with his course aliases ("marketing" is MKTG2201), so the guard does too (blocksNamedBy,
// the one name matcher). Every block the title could be counts; an exact or substring title match is kept as well.
const find = (title, blocks) => {
    if (!title.trim())
        return [];
    const exact = blocks.filter((b) => b.title.toLowerCase() === title.toLowerCase() || b.title.toLowerCase().includes(title.toLowerCase()));
    return [...new Set([...exact, ...blocksNamedBy(title, blocks)])];
};
/** The gym or study block this write would take or move without his naming it, or null when the write is fine. */
export function unnamedAnchorWrite(message, args, blocks) {
    const [verb, ...rest] = args;
    if (!verb)
        return null;
    const titles = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")) && !/^\d+$/.test(a));
    let touched = [];
    if (verb === "drop" && rest.includes("--after")) {
        const anchors = find(rest[rest.indexOf("--after") + 1] ?? "", blocks);
        const from = Math.min(...anchors.map((a) => toMin(a.end)));
        touched = anchors.length ? blocks.filter((b) => !b.fixed && toMin(b.start) >= from) : [];
    }
    else if (VERBS.has(verb)) {
        touched = (verb === "rename" || verb === "resize" || verb === "move" || verb === "displace" ? titles.slice(0, 1) : titles).flatMap((t) => find(t, blocks));
    }
    return touched.find((b) => (b.fixed ? !(verb === "move" && movesThisOne(message, b, blocks)) : kindOf(b) && !namesBlock(message, b))) ?? null;
}
