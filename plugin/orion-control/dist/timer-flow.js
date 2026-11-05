import { describeDuration } from "./ambient.js";
import { ampm12 } from "./reminder-flow.js";
import { normalizeSpoken } from "./spoken-numbers.js";
import { timerSeconds } from "./tool-moves.js";
const LABEL = /\btimer\b\s*(?:for|to|called|named|:)?\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$|\b(?:for|to)\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$/i;
const NOT_LABEL = /^(?:for|of|me|now|please|pls|then|min|mins|minutes?|hours?|seconds?|a while|real quick)$/i;
/** "set a 10 min timer for the pasta": 600 s, "pasta". Undefined when it is not a new timer. */
export function readTimer(message) {
    const seconds = timerSeconds(message);
    if (seconds === undefined)
        return undefined;
    const after = normalizeSpoken(message).replace(/\b\d+\s*(?:-|\s)?\s*(?:min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b/gi, " ").replace(/\btimer on\b/gi, "timer").replace(/\s+/g, " ").trim();
    const m = LABEL.exec(after);
    const raw = (m?.[1] ?? m?.[2] ?? "").trim().replace(/\s+(?:please|pls|thanks|ok|okay)$/i, "");
    return { seconds, label: raw && !NOT_LABEL.test(raw) ? raw : "Timer" };
}
export async function runTimer(ask, deps) {
    const calls = [`timer_set ${ask.seconds}s ${ask.label}`];
    const fail = (why) => ({ text: `I couldn't set that timer (${why}), so nothing is running. Want me to try again?`, calls, outputs: [why], ok: false, label: ask.label });
    let made;
    try {
        made = await deps.add(ask.seconds, ask.label);
    }
    catch (error) {
        return fail(error instanceof Error ? error.message.slice(0, 80) : "the reminder store refused it");
    }
    const back = (await deps.list().catch(() => [])).find((r) => r.id === made.id);
    if (!back)
        return fail("it wasn't in the store when I checked");
    const at = new Date(back.dueAt);
    const when = ampm12(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
    const what = ask.label === "Timer" ? "" : ` for ${/^(?:the|my) /i.test(ask.label) ? "" : "the "}${ask.label}`;
    return { text: `Timer set: ${describeDuration(ask.seconds)}${what}, it rings at ${when}.`, calls, outputs: [JSON.stringify({ id: back.id, dueAt: back.dueAt })], ok: true, label: ask.label };
}
