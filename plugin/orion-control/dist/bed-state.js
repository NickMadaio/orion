/*
 Bedtime read from state, not only from a nudge (Wave 6, gate run-1101003318: loop-reply-bed-v and -c).

 pending-reply.ts binds a short reply to the bedtime line only when that line is in reach (the app's label, the card's last push inside
 its window, or this chat's memo). When it is not (the push is older than the window, the label never came, the line went to the phone),
 "ok one more thing" at 12:43 AM fell to the model ("What is the one more thing?") and "5 more min" became a "start focus" alarm.

 The state already says what that reply is about: it is past the bedtime he set (life-config.json, `bedtime`; the sandbox's own file
 during an evaluation, as scripts/lib/life/config.mjs reads it) and the night has not ended. So a stall, a "still up doing X", a
 workload line or "going to bed" in that window is the bedtime reply, carried out by pending-reply-bed.ts like the nudged one.
 Not while a focus session runs ("5 more min" is the session's), never a request or a hush, never a question.
*/
import { bedtimeMin } from "./life-window.js";
import { HUSH, REQUEST, readReply } from "./pending-reply-read.js";
import { readBedStall } from "./pending-reply-bed.js";
import { LATE_NIGHT, nowMinOf } from "./pending-reply-day.js";
/** "going to bed" this long before his bedtime still gets tomorrow protected (an early night is still a night). */
const EARLY_BED_MIN = 3 * 60;
const BED_KINDS = ["awake", "workload", "defer", "bed"];
/** Minutes past his bedtime tonight (negative before it), or undefined in the day (from the night's end until noon). */
function sinceBedtime(stateDir, now) {
    const nowMin = nowMinOf(now);
    const nightEnd = LATE_NIGHT * 60;
    if (nowMin >= nightEnd && nowMin < 12 * 60)
        return undefined;
    // Evening and the small hours on one line: 18:00 is -360 from midnight, 01:00 is +60.
    const line = (m) => (m < 12 * 60 ? m + 1440 : m);
    return line(nowMin) - line(bedtimeMin(stateDir));
}
/** It is past the bedtime he set and the night has not ended. */
export function pastBedtime(stateDir, now) {
    const since = sinceBedtime(stateDir, now);
    return since !== undefined && since >= 0;
}
/** His reply read as answering bedtime from the clock and his bedtime alone, or undefined. Pure apart from reading his bedtime. */
export function bedtimeFromState({ message, now, stateDir, focusActive, memo }) {
    const lower = message.toLowerCase();
    if (HUSH.test(lower) || /\?\s*$/.test(message.trim()))
        return undefined;
    const reply = readReply(message) ?? readBedStall(message);
    if (!reply || !BED_KINDS.includes(reply.kind))
        return undefined;
    if (reply.kind !== "bed" && (focusActive || REQUEST.test(lower)))
        return undefined;
    const since = sinceBedtime(stateDir, now);
    if (since === undefined || since < (reply.kind === "bed" ? -EARLY_BED_MIN : 0))
        return undefined;
    const said = message.trim().slice(0, 120);
    return memo?.kind === "bedtime" ? { said, reply, memo } : { said, reply, offer: { kind: "bedtime" } };
}
/** The app context's focus line says a session is running ("Focus session: active …"), not "inactive". */
export const focusRunning = (raw) => /\bFocus session:\s*(?!inactive\b)\w/i.test(raw);
