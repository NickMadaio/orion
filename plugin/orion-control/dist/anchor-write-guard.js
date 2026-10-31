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
const find = (title, blocks) => blocks.find((b) => b.title.toLowerCase() === title.toLowerCase())
    ?? blocks.find((b) => b.title.toLowerCase().includes(title.toLowerCase()));
/** The gym or study block this write would take or move without his naming it, or null when the write is fine. */
export function unnamedAnchorWrite(message, args, blocks) {
    const [verb, ...rest] = args;
    if (!verb)
        return null;
    const titles = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")) && !/^\d+$/.test(a));
    let touched = [];
    if (verb === "drop" && rest.includes("--after")) {
        const anchor = find(rest[rest.indexOf("--after") + 1] ?? "", blocks);
        touched = anchor ? blocks.filter((b) => !b.fixed && toMin(b.start) >= toMin(anchor.end)) : [];
    }
    else if (VERBS.has(verb)) {
        touched = (verb === "rename" || verb === "resize" || verb === "move" || verb === "displace" ? titles.slice(0, 1) : titles).map((t) => find(t, blocks)).filter((b) => !!b);
    }
    return touched.find((b) => kindOf(b) && !namesBlock(message, b)) ?? null;
}
