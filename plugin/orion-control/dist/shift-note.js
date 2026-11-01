// A time Nick states for an add is his. When the scheduler could not keep it, its own output says so (a "SHIFTED:" line naming what
// was in the way); this turns that line into the one sentence that goes in the reply. Built only from the scheduler's output.
import { ampm, toMin } from "./intent-time.js";
const SHIFTED_LINE = /^\s*SHIFTED: (.+?) could not go at (\d\d:\d\d) \((.+?)\) — booked (\d\d:\d\d) instead/;
const firstWord = (t) => t.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
/** "10:00" -> "10 AM", "07:30" -> "7:30 AM". */
const said = (hm) => ampm(toMin(hm)).replace(":00 ", " ");
/** One line saying why `title` is not at the time asked for, or "" when the scheduler kept it (or shifted something else). */
export function shiftNote(stdout, title) {
    const want = firstWord(title);
    for (const line of stdout.split("\n")) {
        const m = SHIFTED_LINE.exec(line);
        if (!m || !want || firstWord(m[1]) !== want)
            continue;
        const why = m[3].replace(/\s+is there$/, "");
        const lead = why === "that time has passed" ? `${said(m[2])} has already passed` : `${said(m[2])}'s taken by ${why.replace(/ is there$/, "")}`;
        return `${lead}, so it's at ${ampm(toMin(m[4]))}. Say if you want another time.`;
    }
    return "";
}
