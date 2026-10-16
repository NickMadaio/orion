/*
 Focus-session status questions, answered by code (live sweep r8, 2026-10-16).
 q053 "is my focus session on": the status was read by code but never recorded, so the grader saw an unread claim.
 q050 "what am i supposed to be working on right now": no session, then the 9B improvised from the day read.
 q052 "how long have i been focusing today": nothing ran; the 9B said the session was inactive.
 Everything here is a read: nothing starts, stops or changes a session. Written by Claude on 2026-10-16.
*/
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** "is my focus session on / running / active": a yes-or-no about the session itself. */
export const asksFocusOn = (message) => /\bis (?:my |the |a )?(?:focus|study|deep work)\s*(?:session|block|mode|timer)?\s+(?:on|running|active|going|started|still (?:on|running|going))\b/i.test(message);
/**
 * "how long have i been focusing today": the total so far, past or progressive only (r8 review 2026-10-16 M4).
 * "how long am i studying today" and "how many hours of studying do i have today" are plans, not the history.
 */
const PAST_FOCUS = /\b(?:have i|did i|i've|i have)\s+(?:been\s+|done\s+)?(?:focus(?:ed|ing)?|stud(?:ied|ying)|deep work)\b|\bfocus(?:ed)?\s+time\b[^?]*\b(?:have i|did i|i've)\b/i;
const SO_FAR = /\b(?:today|so far|this (?:morning|afternoon|evening))\b/i;
export const asksFocusToday = (message) => !/\b(?:what|which|who)\b/i.test(message) && ((PAST_FOCUS.test(message) && SO_FAR.test(message)) || /\bfocus(?:ed)?\s+(?:time\s+)?(?:so far\s+)?today\b/i.test(message));
export const HISTORY_FILE = join(homedir(), ".openclaw", "orion-controlled", "focus-history.jsonl");
/** The focus history, one JSON object per line; bad lines are skipped. Read-only. */
export function readFocusHistory(file = process.env.ORION_FOCUS_HISTORY || HISTORY_FILE) {
    if (!existsSync(file))
        return [];
    let text;
    try {
        text = readFileSync(file, "utf8");
    }
    catch {
        return [];
    } // r8 review LOW: an unreadable file is no history, not a crash
    return text.split("\n").flatMap((line) => {
        try {
            const row = line.trim() ? JSON.parse(line) : null;
            return row && typeof row === "object" ? [row] : [];
        }
        catch {
            return [];
        }
    });
}
/** The local calendar day ("2026-10-16"), the same key orion-session writes (en-CA local date). */
export const localDayKey = (d) => d.toLocaleDateString("en-CA");
const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const RUNNING = new Set(["running", "paused", "waiting-for-return"]);
/** Focused seconds of a session that is still going, from `orion-session status --json` (0 when none runs). */
export function liveFocusSeconds(statusStdout) {
    try {
        const state = JSON.parse(statusStdout);
        return state && RUNNING.has(String(state.status ?? "")) ? finite(state.servedFocusSeconds) : 0;
    }
    catch {
        return 0;
    }
}
const span = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`);
/**
 * Today's total. Same rule as scripts/lib/focus/day-total.mjs: every record of the day counts its
 * servedFocusSeconds, so an abandoned or early-ended session adds exactly the time it was actually
 * focused (never its planned length); a session under a minute (a start he took straight back) is not
 * counted as a session. A session still running counts its served seconds so far (it is not in the file yet).
 */
export function focusTodayTotal(rows, dayKey, liveSeconds = 0) {
    const today = rows.filter((r) => (typeof r.dayKey === "string" ? r.dayKey === dayKey : typeof r.startedAt === "string" && localDayKey(new Date(r.startedAt)) === dayKey));
    const seconds = today.map((r) => finite(r.servedFocusSeconds));
    return { seconds: seconds.reduce((a, b) => a + b, 0) + liveSeconds, sessions: seconds.filter((s) => s >= 60).length + (liveSeconds > 0 ? 1 : 0) };
}
export function focusTodayReply(total) {
    const minutes = Math.round(total.seconds / 60);
    if (minutes < 1)
        return "You haven't logged any focus time today.";
    const n = Math.max(1, total.sessions);
    return `You've focused for ${span(minutes)} today across ${n} session${n === 1 ? "" : "s"}.`;
}
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const clock12 = (t) => { const m = toMin(t); const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const plainTitle = (t) => t.replace(/\s+[—–-]\s+(?:Lecture|Lab|Recitation|Discussion|Seminar|Class|Section)$/i, "").trim();
/** Parses blockList text: "B1 13:30–15:00 Title (FIXED) (already happened)". */
function parseBlocks(dayText) {
    return dayText.split("\n").flatMap((line) => {
        const m = /^B\d+\s+(\d{1,2}:\d{2})[–-](\d{1,2}:\d{2})\s+(.*)$/.exec(line.trim());
        if (!m)
            return [];
        const title = m[3].replace(/\s*\(already happened\)\s*$/, "").replace(/\s*\(FIXED\)\s*$/, "");
        return [{ start: m[1], end: m[2], title, over: /\(already happened\)\s*$/.test(line) }];
    });
}
/** q050: no session is running, so say the calendar block he is in, else the next one today, else that nothing is left. */
export function noSessionReply(dayText, nowHHMM) {
    const blocks = parseBlocks(dayText).filter((b) => !b.over);
    const now = toMin(nowHHMM);
    const current = blocks.find((b) => toMin(b.start) <= now && now < toMin(b.end));
    if (current)
        return `No focus session is running. Right now on your calendar: ${plainTitle(current.title)} until ${clock12(current.end)}.`;
    const next = blocks.filter((b) => toMin(b.start) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
    if (next)
        return `No focus session is running. Next on your calendar: ${plainTitle(next.title)} at ${clock12(next.start)}.`;
    return "No focus session is running, and nothing else is on your calendar today.";
}
