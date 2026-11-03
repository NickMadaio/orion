// "What time is it", answered by the clock, in four words (w16, 2026-11-02 23:56).
//
// The turn "Still working Timmy, utilize. Orion, what time is What time is Fuck" (ORION's own "Still working on it."
// cue heard back through the mic, then his question, stitched) went to the worker, which said "You're still working,
// Timmy. Orion's clock says it's 11:56 PM." It parroted the room words back. A time question needs no model: the
// answer is "It's 11:56 PM." and nothing else. Only when the question opens what he said to ORION (from his name on,
// or the whole line) and nothing after it asks for more: "what time is my class" stays with the day reader.
const NAME = /\b(?:orion|orien|oryan|orian|oreon)\b/gi;
const CONTINUING = /^\(Continuing[^)]*\)\s*/i;
const ASK = /\bwhat(?:'?s| is)? the time\b|\bwhat time\b/i;
/** Lead-ins before the question ("hey", "ok so") and junk after it ("is it", "fuck", "rn"). Nothing that names a thing. */
const LEAD = new Set(["hey", "ok", "okay", "so", "um", "uh", "yo", "and", "sorry", "quick", "question", "wait", "but", "well"]);
const TAIL = new Set(["is", "it", "it's", "its", "now", "right", "rn", "currently", "please", "again", "then", "though", "orion",
    "what", "time", "the", "whats", "what's", "fuck", "fucking", "shit", "man", "bro", "mate", "lol", "uh", "um", "exactly"]);
const words = (text) => text.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9']+/g) ?? [];
/** He asked for the time and nothing else. */
export function asksTheTime(message) {
    const text = message.replace(CONTINUING, "");
    const names = [...text.matchAll(NAME)];
    const last = names[names.length - 1];
    const addressedPart = last ? text.slice(last.index + last[0].length) : text;
    const match = ASK.exec(addressedPart);
    if (!match)
        return false;
    if (!words(addressedPart.slice(0, match.index)).every((w) => LEAD.has(w)))
        return false;
    return words(addressedPart.slice(match.index + match[0].length)).every((w) => TAIL.has(w));
}
/** "It's 11:56 PM." */
export function timeReply(now) {
    const h = now.getHours(), m = now.getMinutes();
    return `It's ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}.`;
}
