import { ampm, toMin } from "./intent-time.js";
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Where the block titled `title` sits after the write: the re-read day first, else the scheduler's "planned" line. */
export function bookedSpan(title, stdout, day) {
    const planned = new RegExp(String.raw `planned ${esc(title)}: (\d{2}:\d{2})[–-](\d{2}:\d{2})`, "i").exec(stdout);
    const same = day?.blocks.filter((b) => b.title.toLowerCase() === title.toLowerCase()) ?? [];
    const block = same.find((b) => b.start === planned?.[1]) ?? same.at(-1);
    if (block)
        return { start: block.start, end: block.end };
    return planned ? { start: planned[1], end: planned[2] } : undefined;
}
const hm = (t) => ampm(toMin(t));
/** The clause for one step that wrote, true to the calendar. Falls back to the planned wording only when nothing says otherwise. */
export function spokenAfterWrite(step, stdout, day) {
    const [verb, title = "", to = ""] = step.args;
    if (verb === "add") {
        const span = bookedSpan(title, stdout, day);
        if (!span)
            return step.said;
        const minutes = (toMin(span.end) - toMin(span.start) + 1440) % 1440;
        const i = step.args.indexOf("--after");
        const after = i >= 0 ? step.args[i + 1] : undefined;
        const follows = after !== undefined && (day?.blocks.some((b) => b.title === after && b.end === span.start) ?? false);
        const raised = new RegExp(String.raw `${esc(title)} (\d+) → (\d+) min \(his minimum\)`, "i").exec(stdout);
        const why = raised ? ` (${raised[2]} minutes is your set minimum for a ${title.toLowerCase()})` : "";
        return `${minutes}-minute ${title.toLowerCase()} at ${hm(span.start)}${follows ? ` after ${after}` : ""}${why}`;
    }
    if (verb === "rename") {
        const b = day?.blocks.find((x) => x.title === to);
        return b ? `${title} is now "${to}", still at ${hm(b.start)}` : step.said;
    }
    return step.said;
}
