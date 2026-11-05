/*
 Several requests in one message that are not scheduling (w20 routegate, tube audit "could not do several requests in one message").

   "open safari and set a timer and add milk to my list"  ->  three asks, each run, one natural reply that says what happened to each.

 Code splits the message into asks (clauses that each start with an action verb); the worker runs each with its tools; the reply must cover
 every ask and state only what its tool result showed. A clause about the calendar, a reminder, a class, bed or the alarm keeps the WHOLE message
 out of here: scheduling has its own flow (schedule-flow.ts) and it already splits those. Pure; local-routing.ts calls it.
*/
import { schedulingAsk } from "./route-gate.js";
import { normalizeSpoken } from "./spoken-numbers.js";
const VERBS = String.raw `(?:open|launch|close|quit|play|pause|skip|resume|mute|unmute|set|start|stop|turn|switch|dim|brighten|lock|text|message|email|add|put|check|tell|show|find|search|google|look up|read|take|send|save|note|write|log|mark|tick|complete|what'?s|whats|what is|how'?s|call|screenshot|clear|empty|bring up|pull up)`;
const LEAD = /^(?:(?:hey|ok|okay|so|please|pls|and|then|also|orion|can you|could you|can u|will you|would you|just|now|first|next|after that|lastly|finally)[,\s]+)+/i;
const SEP = /(\s*[,.;!?]+\s*|\s+(?:and then|and also|and|then|also|plus)\s+)/i;
// A clause about the calendar, a reminder, a class, sleep or the alarm belongs to the scheduling and wake flows, so the whole message stays out of here.
const SCHEDULING_WORDS = /\b(?:remind\w*|schedule\w*|reschedule\w*|calendar|appointments?|meetings?|class(?:es)?|lectures?|bed(?:time)?|sleep|nap|wake|alarms?|gym|workout|study block|push|move|shift|delay|postpone|tomorrow|tonight|today|this (?:morning|afternoon|evening)|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\b(?:at|from|until|till|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/i;
const verbLed = (clause) => new RegExp(`^${VERBS}\\b`, "i").test(clause.replace(LEAD, ""));
/** The asks in a message, or null when it is not a plain multi-request (fewer than two, or any clause is scheduling). */
export function splitAsks(raw) {
    const message = normalizeSpoken(raw).trim();
    if (!message || message.length > 400)
        return null;
    const parts = message.split(SEP).map((p) => p ?? "");
    // parts alternate: clause, separator, clause, ... ; a clause that is not verb-led belongs to the one before it ("salt and pepper to my list").
    const clauses = [];
    for (let i = 0; i < parts.length; i += 2) {
        const text = (parts[i] ?? "").trim();
        if (!text)
            continue;
        const sep = i > 0 ? (parts[i - 1] ?? " ") : "";
        if (clauses.length && !verbLed(text))
            clauses[clauses.length - 1] = `${clauses[clauses.length - 1]}${/^[,.;!?]/.test(sep.trim()) ? sep.trim() + " " : sep}${text}`;
        else
            clauses.push(text);
    }
    const asks = clauses.map((c) => c.replace(LEAD, "").replace(/[.!?,;]+$/, "").trim()).filter(Boolean);
    if (asks.length < 2 || asks.length > 5)
        return null;
    if (!clauses.every(verbLed))
        return null;
    if (asks.some((a) => SCHEDULING_WORDS.test(a) || schedulingAsk(a)))
        return null;
    return asks;
}
/** The instruction for the worker: do every ask with tools, then one natural reply that says what happened to each. */
export function multiAskPrompt(asks, hints = []) {
    const lines = asks.map((a, i) => `${i + 1}. "${a}"${hints[i] ? ` (${hints[i]})` : ""}`).join("\n");
    return [
        `Nick asked for ${asks.length} separate things in one message:`, lines,
        "Do every one of them, each with its own tool call, in order. One failing never stops the others.",
        "Then reply in one natural, short reply (no list, no markdown) that says what happened to EACH one, in the order he asked.",
        "Say a thing is done only if its tool result shows it; if one failed or you could not do it, say that one plainly with the real reason and still report the rest.",
    ].join("\n");
}
