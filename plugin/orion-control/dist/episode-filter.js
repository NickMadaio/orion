/**
 * What is NOT worth an automatic episode: injected scaffolding, bare
 * acknowledgements, quick questions, and replies that only make sense against
 * ORION's last message. Pure functions, shared by the live writer (episodic.ts)
 * and the cleanup CLI (scripts/orion-memory-clean.mjs).
 */
const FILLER_WORDS = [
    "yes", "yeah", "yea", "ye", "yep", "yup", "y", "no", "nope", "nah", "n", "ok", "okay", "okey", "k", "kk",
    "sure", "fine", "cool", "nice", "great", "alright", "aight", "lol", "lmao", "haha", "hmm", "um", "uh",
    "thanks", "thank you", "thx", "ty", "please", "pls", "whenever", "whatever", "idk", "maybe", "later",
    "go ahead", "do it", "sounds good", "got it", "that works", "works", "right", "true", "mhm", "yes please",
    "never ?mind", "nvm", "forget it", "anytime", "now", "again", "same", "you too", "and", "so", "but", "then",
];
const FILLER_ONLY = new RegExp(`^(?:(?:${FILLER_WORDS.join("|")}|\\d+\\s*(?:more\\s+)?(?:min(?:ute)?s?|m|h(?:ou)?rs?)(?:\\s+more)?|(?:a\\s+)?(?:few|couple|little|bit)(?:\\s+(?:more|min(?:ute)?s?))*)\\b[\\s.,!~…-]*)+$`, "i");
const QUESTION_LEAD = /^(?:(?:ok|okay|so|and|but|wait|hey|um|uh)[\s,]+)*(?:(?:what|how|why|who|where|when|which|whats|hows)\b.{0,70}|(?:should|can|could|would|will|do|does|did|is|are|am|was|have|has)\s+(?:i|we|you|u|it|he|she|they|that|this)\b.*)$/i;
const ANAPHORA_LEAD = /^(?:(?:yes|yeah|yep|ok|okay|sure|no|nope|and|but|so|then)[\s,]+)*(?:that|those|them|it|this|these|the (?:first|second|third|last|other|same)|option|do that|same)\b/i;
const ANAPHORA_TAIL = /\b(?:that|it|them|those|these|same)[\s.!]*$/i;
const EXPLICIT = /\b(?:remember|don'?t forget|before i forget|from now on|going forward)\b/i;
const LABELS = [
    /\[ORION context:[^\]]*\]/gi,
    /\[Orion app context[^\]]*\][\s\S]*?(?:\n\s*User message:\s*\n|$)/gi,
    /\[(?:ORION|Nick'?s)?\s*scheduling preferences[^\]]*\][\s\S]*?(?:\[Current user request\]\s*|$)/gi,
    /\[Scheduling (?:preferences|memory)[^\]]*\][\s\S]*?(?:\[Current user request\]\s*|$)/gi,
    /\[Current user request\]/gi,
    /\[orion-remote[^\]]*\]/gi,
];
/** Nick's own words with every injected context block and label removed. */
export function stripInjectedContext(text) {
    const at = text.lastIndexOf("[Current user request]");
    const tail = at === -1 ? text : text.slice(at);
    return LABELS.reduce((acc, re) => acc.replace(re, "\n"), tail).trim();
}
/** The outreach sentence ORION sent first, if the turn carries one. */
export function outreachOf(text) {
    const quoted = text.match(/\[ORION context:[^"\]]*"([^\]]*)"\.?[^"\]]*\]/i)?.[1];
    const cleaned = quoted?.replace(/\s+/g, " ").trim();
    return cleaned ? cleaned : undefined;
}
const words = (s) => s.split(/\s+/).filter(Boolean);
const tidy = (s) => s.replace(/\s+/g, " ").trim();
export function isFiller(candidate) {
    const c = tidy(candidate);
    return FILLER_ONLY.test(c) || /^[^a-z0-9]*$/i.test(c);
}
/** A quick question (even without its "?") is a lookup, not a memory. */
export function isQuickQuestion(candidate) {
    const c = tidy(candidate);
    return !EXPLICIT.test(c) && (c.endsWith("?") || (words(c).length <= 12 && QUESTION_LEAD.test(c)));
}
/** A reply that only means something next to what ORION just said. */
export function isDependentReply(candidate) {
    const c = tidy(candidate);
    return !EXPLICIT.test(c) && words(c).length <= 6 && (ANAPHORA_LEAD.test(c) || ANAPHORA_TAIL.test(c));
}
/** True when a candidate can never be an episode, whatever signal words it carries. */
export function isJunkCandidate(candidate) {
    const c = tidy(candidate);
    if (!c || c.startsWith("[") || /^[-*]\s+\*\*/.test(c))
        return true;
    if (isFiller(c) || isQuickQuestion(c))
        return true;
    return words(c).length < 3 && !EXPLICIT.test(c);
}
/** Wrap a short dependent reply in the message it answers, so the line stands alone. */
export function combineWithOutreach(reply, outreach) {
    const asked = outreach.length > 140 ? `${outreach.slice(0, 139).trimEnd()}…` : outreach;
    return `ORION asked "${asked}" and Nick said: ${tidy(reply)}`;
}
const norm = (s) => s.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Same thing said twice: containment either way, or heavy word overlap. */
export function nearDuplicate(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y)
        return false;
    if (x === y || x.includes(y) || y.includes(x))
        return true;
    const sx = new Set(x.split(" "));
    const sy = new Set(y.split(" "));
    const shared = [...sx].filter((w) => sy.has(w)).length;
    return shared / Math.max(sx.size, sy.size) >= 0.8;
}
const EPISODE_LINE = /^\s*-\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s+—\s+\[auto\]\s+(.*)$/i;
export function episodeBody(line) {
    return line.match(EPISODE_LINE)?.[1];
}
/**
 * Lines of one daily file that the live rule would not have written, with the
 * reason. Order matters: a later near-duplicate of an earlier kept line goes.
 */
export function junkEpisodeLines(content) {
    const kept = [];
    const junk = [];
    content.split("\n").forEach((line, index) => {
        const body = episodeBody(line);
        if (body === undefined)
            return;
        const bare = body.replace(/^ORION asked ".*?" and Nick said:\s*/, "");
        const reason = isJunkCandidate(bare)
            ? "scaffolding, filler, or question"
            : kept.some((k) => nearDuplicate(k, body)) ? "near-duplicate" : undefined;
        if (reason)
            junk.push({ index, line, reason });
        else
            kept.push(body);
    });
    return junk;
}
