/** ORION's offer, in both wordings of the firm rung (scripts/lib/life/sleep-nudge.mjs). */
export const isShutdownOffer = (text) => /\bwant me to shut (?:things|it all|everything) down\b/i.test(text);
const norm = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,…]+/g, " ").replace(/\s+/g, " ").trim();
const NEG = /\b(?:don'?t|dont|do not|not|no|nah|nope|wait|stop|cancel|later|never|without|except|besides)\b/;
const YES_WORDS = new Set(["yes", "yeah", "yea", "ya", "yep", "yup", "sure", "ok", "okay", "k", "fine", "alright", "aight", "please", "pls", "plz", "bet", "fr", "go", "ahead", "do", "sounds", "good"]);
const YES_FILLER = new Set([...YES_WORDS, "it", "that", "ugh", "lol", "orion", "thanks", "thx", "i", "guess", "then", "now", "thing", "for", "shut", "down", "everything", "close", "all", "them", "em", "and", "lock", "the", "mac", "my", "computer", "laptop", "sleep", "bed", "put", "to", "so"]);
function readYes(m) {
    const words = m.split(" ");
    return words.length <= 8 && words.some((w) => YES_WORDS.has(w)) && words.every((w) => YES_FILLER.has(w));
}
const LEAD = /^(?:(?:yes|yeah|yea|yep|yup|ok|okay|alright|fine|pls|please|orion|yo|hey|just|then|and|can you|could you|will you|would you|go ahead and)\s+)+/;
const MACHINE = "(?:computer|compter|comp|mac|macbook|laptop|pc|machine)";
const ALL_DOWN = new RegExp(`^(?:shut|close|quit|lock|power)\\s+(?:it\\s+all|everything|all\\s+of\\s+it)(?:\\s+down)?\\b|^(?:shut|lock|close|quit)\\s+(?:down\\s+)?(?:my|the)\\s+${MACHINE}\\b`);
/** "shut it down", "close it": only as an answer to the offer, never on their own. */
const IT_DOWN = /^(?:shut|close|quit|lock)\s+it(?:\s+down)?$/;
const PUT_BED = new RegExp(`^put\\s+(?:my|the)\\s+${MACHINE}\\s+(?:to\\s+bed|down\\s+for\\s+the\\s+night)\\b|^put\\s+(?:my|the)\\s+${MACHINE}\\s+to\\s+sleep\\s+for\\s+the\\s+night\\b`);
const ON = new RegExp(`\\b(?:leave|let)\\s+(?:my\\s+)?${MACHINE}\\s+(?:alone|be)\\b|\\b(?:stop|quit)\\s+locking\\b.*\\b${MACHINE}\\b|\\b(?:don'?t|dont|do not)\\s+(?:lock|shut)\\s+(?:my\\s+)?${MACHINE}\\b`);
const OFF = new RegExp(`\\b(?:lock|shut)\\s+(?:my\\s+)?${MACHINE}\\s+(?:again|back)\\b|\\bturn\\s+(?:the\\s+)?(?:bedtime\\s+)?lock\\s+back\\s+on\\b|\\block\\s+it\\s+again\\b`);
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, "half an": 0.5 };
const AMOUNT = /\b(\d{1,3}|half an|forty five|an?|one|two|three|five|ten|fifteen|twenty|thirty)\s+(?:more\s+)?(min|mins|minute|minutes|hour|hours|hr|hrs)\b/;
const ASKING = /^(?:i\s+)?(?:need|want)\b|\b(?:gimme|give me|lemme have|let me have|can i (?:get|have)|just)\b|^\d/;
function readPass(m) {
    if (m.split(" ").length > 12 || /\bsleep\b/.test(m))
        return undefined;
    const hit = AMOUNT.exec(m);
    if (!hit || !ASKING.test(m))
        return undefined;
    const n = /^\d+$/.test(hit[1]) ? Number(hit[1]) : NUM[hit[1]];
    if (n === undefined)
        return undefined;
    const minutes = Math.round(/^h/.test(hit[2]) ? n * 60 : n);
    return minutes > 0 ? minutes : undefined;
}
export function readShutdownTurn(message, ctx) {
    const m = norm(message);
    if (!m || m.split(" ").length > 14)
        return null;
    if (ctx.night) {
        if (ON.test(m))
            return { kind: "override", on: true };
        if (OFF.test(m))
            return { kind: "override", on: false };
    }
    if (NEG.test(m) || /^(?:how|what|why|when|where|who|which)\b/.test(m))
        return null;
    if (ctx.armed && ctx.night) {
        const minutes = readPass(m);
        if (minutes !== undefined)
            return { kind: "pass", minutes };
    }
    const bare = m.replace(LEAD, "");
    if (PUT_BED.test(bare))
        return { kind: "run" };
    if (ctx.night && ALL_DOWN.test(bare) && bare.split(" ").length <= 8)
        return { kind: "run" };
    if (ctx.offered && (readYes(m) || IT_DOWN.test(bare)))
        return { kind: "run" };
    return null;
}
