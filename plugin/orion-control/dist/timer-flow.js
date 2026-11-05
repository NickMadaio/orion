import { describeDuration } from "./ambient.js";
import { ampm12 } from "./reminder-flow.js";
import { normalizeSpoken } from "./spoken-numbers.js";
import { timerLength, timerSeconds } from "./tool-moves.js";
const LABEL = /\btimer\b\s*(?:for|to|called|named|:)?\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$|\b(?:for|to)\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$/i;
const NOT_LABEL = /^(?:instead|rather|actually|for|of|me|now|please|pls|then|min|mins|minutes?|hours?|seconds?|a while|real quick)$/i;
/** "set a 10 min timer for the pasta": 600 s, "pasta". Undefined when it is not an order for a new timer. "instead" swaps the one just set (hasLast), else is nothing. */
export function readTimer(message, { hasLast = false } = {}) {
    const instead = /\b(?:instead|rather)\b/i.test(message);
    if (instead && !hasLast)
        return undefined;
    const seconds = instead ? timerLength(message) : timerSeconds(message);
    if (seconds === undefined)
        return undefined;
    const after = normalizeSpoken(message).replace(/\b\d+\s*(?:-|\s)?\s*(?:min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b/gi, " ").replace(/\btimer on\b/gi, "timer").replace(/\b(?:instead|rather|actually)\b/gi, " ").replace(/\s+/g, " ").trim();
    const m = LABEL.exec(after);
    const raw = (m?.[1] ?? m?.[2] ?? "").trim().replace(/\s+(?:please|pls|thanks|ok|okay)$/i, "");
    return { seconds, label: raw && !NOT_LABEL.test(raw) ? raw : "Timer", ...(instead ? { replace: true } : {}) };
}
const REST = /^(?:move|add|put|schedule|book|remind|open|set|start|push|cancel|delete|remove|text|send|play|turn|log|call|make|take|drop|skip|plan|shift|(?:a|an)\s+\d|\d)\b.*/i;
const SEP = /\s*,\s*(?:and\s+|then\s+)?|\s+(?:and then|and also|and|then|also|plus|after that)\s+/gi;
/**
 * An ask joined to another ask, in either order: the clause `isHit` picks (`hit`) and the rest, when the other side passes `isRest` (a request of its own,
 * so "... for mac and cheese" is never split). Undefined for a single ask.
 */
export function splitAsk(text, isHit, isRest) {
    const t = text.trim();
    if (!isHit(t) && !t.split(SEP).length)
        return undefined;
    for (const m of t.matchAll(SEP)) {
        const left = t.slice(0, m.index).trim();
        const right = t.slice((m.index ?? 0) + m[0].length).trim();
        if (!left || !right)
            continue;
        if (isHit(left) && !isHit(right) && isRest(right))
            return { hit: left, rest: right };
        if (isHit(right) && !isHit(left) && isRest(left))
            return { hit: right, rest: left };
    }
    return undefined;
}
/**
 * A timer order joined to another ask, in either order ("set a 10 min timer and move my gym to 6", "move my gym to 6 and set a 10 min timer"):
 * the timer clause and the rest. Undefined for a single ask, or when the other side is not a request ("... for mac and cheese").
 */
export function splitTimerAsk(message) {
    if (timerSeconds(message.trim()) === undefined)
        return undefined;
    const s = splitAsk(message, (part) => timerSeconds(part) !== undefined, (part) => REST.test(part) && !/\btimer\b/i.test(part));
    return s ? { timer: s.hit, rest: s.rest } : undefined;
}
export async function runTimer(ask, deps) {
    const calls = [`timer_set ${ask.seconds}s ${ask.label}`];
    const fail = (why) => ({ text: `I couldn't set that timer (${why}), so nothing is running. Want me to try again?`, calls, outputs: [why], ok: false, label: ask.label });
    let made;
    if (deps.replace)
        await deps.replace.remove(deps.replace.id).catch(() => undefined);
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
    return { id: back.id, text: `${deps.replace ? "Swapped the old timer. " : ""}Timer set: ${describeDuration(ask.seconds)}${what}, it rings at ${when}.`, calls, outputs: [JSON.stringify({ id: back.id, dueAt: back.dueAt })], ok: true, label: ask.label };
}
