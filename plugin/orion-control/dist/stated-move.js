/*
 Wave 8 B (gate run-1101080052, per-legit-vs-excuse-c): "gym is bumped to 10:30am tonight because i have a deadline at 9:30am" is
 not a command, so no route owned it; the worker echoed "Gym is bumped to 10:30 AM tonight…" with no calendar write.
 A statement that one of ORION's own blocks (gym, side project, study, nap) is now at a time he names is a request to put it
 there. This reads it; local-routing's gym turn runs it through the schedule flow (move, or add when it is not on the day).
 Questions, conditionals, past reports ("was moved") and classes are not read.
*/
const OWNED = String.raw `(gym|workout|side[ -]?project|study(?: block| session)?|nap)`;
const TIME = String.raw `(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
const VERB = String.raw `(?:bumped|moved|pushed|shifted|rescheduled|switched)(?:\s+(?:back|up|later|over))?`;
const STATEMENT = new RegExp(String.raw `(?:^|\b)(?:my\s+|the\s+|ur\s+|your\s+)?${OWNED}(?:\s+(?:is|got|gets|has been|has got|is getting)|'?s)\s+(?:now\s+)?${VERB}\s+(?:to|till|until|for)\s+${TIME}\b(?!\s*(?:hours?|hrs?|h\b|mins?\b|minutes?|days?|weeks?|times?\b|:))`, "i");
// The word before the block: "Mike's gym", "his gym", "mikes gym", "Mike gym" are someone else's block, never his own to move.
const LEAD_INS = new Set(["fyi", "so", "ok", "okay", "btw", "and", "but", "yeah", "yep", "yes", "hey", "orion", "just", "also", "update", "up", "lol", "omg", "ugh", "well", "then", "apparently", "out", "that", "because", "cause", "since", "note", "oh", "um", "uh", "like", "now", "actually", "news", "sorry", "thanks", "great", "ah", "damn", "welp", "today", "tonight", "tomorrow", "tmrw", "tmr", "this", "morning", "afternoon", "evening", "i", "im", "ill", "ive"]);
function belongsToSomeoneElse(message, index) {
    const word = message.slice(0, index).trim().split(/\s+/).pop()?.replace(/^[^\w']+|[^\w']+$/g, "") ?? "";
    if (!word || LEAD_INS.has(word.toLowerCase()))
        return false;
    return /['\u2019]s$/i.test(word) || /^(?:his|her|hers|their|theirs)$/i.test(word) || /^[A-Z][a-z]+$/.test(word) || /s$/i.test(word);
}
const NOT_A_STATEMENT = /\?\s*$|^(?:so\s+)?(?:should|can|could|would|do|does|is|are|will|what|when|why|how)\b|\b(?:if|unless|when|once|whether|should|would|could|might|maybe)\b[^.?!,]*\b(?:bumped|moved|pushed|shifted|rescheduled|switched)\b/i;
const pad = (n) => String(n).padStart(2, "0");
export function readStatedMove(message) {
    const m = message.trim().replace(/\s+/g, " ");
    if (NOT_A_STATEMENT.test(m))
        return null;
    const hit = STATEMENT.exec(m);
    if (!hit || belongsToSomeoneElse(m, hit.index ?? 0))
        return null;
    const name = hit[1].toLowerCase().replace(/[ -]?project/, " project").replace(/^(study).*/, "study").replace(/^side\s*project$/, "side project");
    let h = Number(hit[2]);
    const min = Number(hit[3] ?? 0);
    const ap = hit[4]?.toLowerCase();
    if (h > 23 || min > 59)
        return null;
    if (ap === "pm" && h < 12)
        h += 12;
    else if (ap === "am" && h === 12)
        h = 0;
    else if (!ap && h >= 1 && h <= 8)
        h += 12;
    const after = m.slice((hit.index ?? 0) + hit[0].length);
    // A day word anywhere in what he said ("tomorrow gym is moved to 5"), before his reason: "...because of my tomorrow deadline" is not the day.
    const day = /\b(?:tomorrow|tmrw|tmr|2moro)\b/i.test(m.split(/\b(?:because|cuz|coz|bc|since)\b/i)[0] ?? "") ? "tomorrow" : "today";
    const reason = /\b(?:because|cuz|coz|bc|since)\b\s+(.+)$/i.exec(after)?.[1]?.trim();
    return { kind: "stated", name, at: `${pad(h)}:${pad(min)}`, day, ...(reason ? { reason } : {}) };
}
