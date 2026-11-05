/*
 The last pass over every reply (w20 round 6, live gate 4 #45 #83 #91). Whatever surface a sentence came from (a code answer, the worker, a
 script's `say`, a diagnosis), these never reach Nick: a JSON fragment (`"outcome": "NOTHING WAS DONE...",`), a JS value that was never filled
 (`[object Object]`, `undefined`, `NaN`), and the name of a tool or script (`media_play_pause`, `orion_task_run`, `tool_call`, `orion-reschedule`).
 It runs at the very end: the direct (code) reply, the finalized worker reply, and the channel payload. Pure, idempotent, and it only cuts
 the leaked span (or the one sentence that is about a tool), never a whole reply that also holds an answer.
*/
export const LEAK_FALLBACK = "I couldn't finish that just now.";
const TOOL_NAME = /\b(?:orion_task_run|tool_call|tool_search|tool_describe|exec|apple_reminder_(?:add|list|remove|complete)|(?:media|app|folder|browser|alarm|timer|weather|reminder|volume|supplement|computer|calendar|note|message|file|screen)_[a-z]+(?:_[a-z]+){0,3})\b/;
const SCRIPT_NAME = /\borion-[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/;
const TOOL_SENTENCE = /\b(?:use|using|call|calling|run|running|try|with|via|through|the)\b[^.?!]{0,40}\b(?:tool|command|script|function|api)\b|\b(?:tool|command|script|function)\b[^.?!]{0,20}\b(?:called|named)\b/i;
const OBJECT_VALUE = /\[object [A-Za-z]+\]|\bundefined\b|\bNaN\b|\bnull\b(?=\s*[),.;:]|\s*$)/;
const JSON_FIELD = /\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|\[[^\]]*\]|\{[^}]*\})\s*,?/g;
const split = (text) => text.split(/(?<=[.!?])\s+/);
const tidy = (s) => s.replace(/\(\s*\)/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/:\s*([.!?])/g, "$1").replace(/:\s*,/g, ",").replace(/([.,;])\1+/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;:-]+/, "").trim();
/** One sentence without its leaks; "" when the sentence is only a leak. */
function cleanSentence(sentence) {
    let s = sentence;
    // JSON fragments, then the braces and brackets they leave.
    if (JSON_FIELD.test(s)) {
        JSON_FIELD.lastIndex = 0;
        s = s.replace(JSON_FIELD, "");
        s = s.replace(/[{}]/g, "");
    }
    JSON_FIELD.lastIndex = 0;
    // A parenthetical or clause holding an unfilled value goes whole ("(route: [object Object])"), a bare one is cut.
    if (OBJECT_VALUE.test(s)) {
        s = s.replace(/\s*\([^)]*(?:\[object [A-Za-z]+\]|\bundefined\b|\bNaN\b|\bnull\b)[^)]*\)/g, "");
        s = s.replace(/[,;]?\s*\b[A-Za-z ]{1,24}:\s*(?:\[object [A-Za-z]+\]|undefined|NaN|null)\b/g, "");
        s = s.replace(/\[object [A-Za-z]+\]|\bundefined\b|\bNaN\b/g, "");
    }
    // A sentence ABOUT a tool ("you can use the media_play_pause tool") goes; a stray name inside a real sentence becomes "that".
    if ((TOOL_NAME.test(s) || SCRIPT_NAME.test(s)) && TOOL_SENTENCE.test(s))
        return "";
    s = s.replace(new RegExp(TOOL_NAME.source, "g"), "that").replace(new RegExp(SCRIPT_NAME.source, "g"), "that").replace(/\bthat(?:\s+that)+\b/g, "that");
    return tidy(s);
}
/** The reply with every leak cut out; LEAK_FALLBACK when nothing readable is left of a reply that had leaks. */
export function finalSanitize(text) {
    const original = String(text ?? "");
    if (!original.trim())
        return original;
    const dirty = JSON_FIELD.test(original) || OBJECT_VALUE.test(original) || TOOL_NAME.test(original) || SCRIPT_NAME.test(original);
    JSON_FIELD.lastIndex = 0;
    if (!dirty)
        return original;
    // JSON fragments first, on the whole text: a leaked string value holds full stops of its own.
    const unjsoned = original.replace(JSON_FIELD, "").replace(/[{}]/g, JSON_FIELD.test(original) ? "" : "$&");
    JSON_FIELD.lastIndex = 0;
    const kept = split(unjsoned).map(cleanSentence).filter((s) => /[A-Za-z0-9]/.test(s));
    const out = kept.join(" ").trim();
    return out && !/^[^A-Za-z0-9]*$/.test(out) ? out : LEAK_FALLBACK;
}
