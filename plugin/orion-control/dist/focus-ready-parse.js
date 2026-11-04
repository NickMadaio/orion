/*
 What he says around starting and ending a work session (2026-11-04). Pure readers, no I/O; focus-ready.ts acts on them.
   ready      "im ready to work", "ok im home lets work", "lets get started", "time to lock in": start the work in the plan.
              Only the bare phrase: a named task ("lets get started on the essay") is the casual-start route (work-start.ts),
              and "ready to work out" is the gym.
   done       "done", "finished the resume": the block is over early. isDoneMessage reads the shape; the flow checks it is about this task.
   answers    to "Need anything else?" (apps), to "Start your break now, or move to X?", and the one-time site override.
*/
const norm = (message) => message.trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
const LEAD = String.raw `^(?:(?:hey|yo|orion|ok(?:ay)?|ok so|alright|aight|right|cool|yeah|ya|yep|k|so|and|now|anyway|well)\b[\s,.!]*)*`;
const HOME = String.raw `(?:(?:i'?m|im|i am) (?:home|back|here|at my desk|at the desk|settled)\b[\s,.!]*(?:and\b\s*)?)?`;
const READY = String.raw `(?:(?:i'?m|im|i am|i'?m finally|we'?re|were)\s+)?(?:ready|set)\s+(?:to|2)\s+(?:work|lock in|get to work|get started|get going|crack on|focus|grind|begin|start)|(?:i'?m|im) (?:gonna|going to)\s+(?:go\s+)?(?:work|lock in|get to work)|(?:lets|let's|lemme|let me)\s+(?:get started|get to work|get going|work|lock in|focus|crack on|get after it|begin|start working|grind)|time\s+(?:to|2)\s+(?:lock in|work|focus|get to work|get started|grind|crack on)`;
const TAIL = String.raw `(?:\s*(?:now|rn|right now|pls|please|lol|lmao|haha|already|then|finally|orion|today|here|today lol)\b)*[\s.!,]*$`;
const READY_RE = new RegExp(`${LEAD}${HOME}(?:${READY})${TAIL}`);
// Not now (the calendar's), or not a statement of readiness.
const NOT_NOW = /\?|\b(?:later|tomorrow|tmrw|tonight|this (?:afternoon|evening|weekend)|after|before|at \d|in \d+|in an? (?:bit|hour|sec|min)|soon|eventually|next|someday|once|when)\b/;
/** "im ready to work": a bare readiness to start, with no task named in it. */
export function isReadyMessage(message) {
    const m = norm(message);
    return !!m && m.split(" ").length <= 12 && !NOT_NOW.test(m) && READY_RE.test(m);
}
const DONE_LEAD = String.raw `^(?:(?:hey|yo|orion|ok(?:ay)?|alright|aight|so|yeah|ya|yep|cool|k|and|well|nice)\b[\s,.!]*)*`;
const DONE_RE = new RegExp(`${DONE_LEAD}(?:(?:i'?m|im|i am|i'?ve|ive|i|we'?re)\\s+)?(?:(?:all|just|now|finally|officially)\\s+)*(done|finished|finished up|completed|wrapped up|finito)(?:\\s+(?:with|w|w/|on|the|my|it)\\b\\s*(.*?))?(?:\\s+(?:early|now|rn|lol|lmao|haha|pls|already|finally|nice))*[\\s.!,]*$`);
// A statement that ends the day, or is not about work: not a session ending.
const NOT_DONE = /\?|\b(?:not|never|haven'?t|hasn'?t|wasn'?t|isn'?t|aren'?t|havent|hasnt|wasnt|isnt|arent|didnt|am i|are we|when|until|till|almost|nearly|barely)\b|\bfor (?:the )?(?:day|today|tonight|night|now|the night|the evening)\b/;
const NOT_THIS_THING = /\b(?:dinner|lunch|breakfast|eating|food|the gym|gym|workout|work ?out|shower|laundry|the dishes|dishes|the call|call|class|shift|cooking|the movie|movie|show|game|homework? for|chores)\b/;
/** He says the work is over: {ok, markDone (he said he finished it), object (what he said he finished, if anything)}, or null. */
export function isDoneMessage(message) {
    const m = norm(message);
    if (!m || m.split(" ").length > 10 || NOT_DONE.test(m))
        return null;
    const hit = DONE_RE.exec(m);
    if (!hit)
        return null;
    const verb = hit[1];
    const object = (hit[2] ?? "").replace(/^(?:the|my|this|that|it)\s+/, "").trim();
    if (object && NOT_THIS_THING.test(object))
        return null;
    return { ok: true, markDone: verb !== "done" || object !== "", ...(object ? { object } : {}) };
}
// -- the apps question: "Starting 50 min on X. Allowed: A and B. Need anything else?" ------------------------------------------------
const NONE_RE = /^(?:(?:nah|no|nope|nothing|none|nada|good|we good|all good|im good|i'?m good|thats it|that'?s it|thats all|that'?s all|nothing else)\b[\s,.!]*)+(?:lol|haha|thanks|thx|ty|orion)?[\s.!]*$/;
const NONE_START = /^(?:no|nope|nah|nothing|none|nada|im good|i'?m good|all good|we good|thats (?:it|all)|that'?s (?:it|all)|good|nothing else)\b/;
const APPS_LEAD = /^(?:(?:yes|yeah|yep|ya|ok(?:ay)?|also|and|plus|add|need|use|allow|i need|i also need|i'?ll need|ill need|and also|can you add|can you allow|can i have|can i use|i want|gimme|give me|with|lol|please|pls)\b[\s,]*)+/;
const NOT_AN_APP_WORD = /^(?:time|it|is|are|what|how|when|why|who|where|the|a|an|to|me|my|i|you|long|left|much|many|ok|okay|yes|no|that|this|those|these|check|email|later|more|time|help|something|anything|everything|nothing|break|session|focus)$/i;
const CHUNK = /^[a-z][a-z0-9.+-]*(?: [a-z][a-z0-9.+-]*)?$/;
export const hasAppsLead = (message) => APPS_LEAD.test(norm(message));
/** The reply to "need anything else?": apps he names (as he said them), or {none:true}. null when it is not an answer. */
export function readAppsReply(message) {
    const m = norm(message).replace(/[.!]+$/, "");
    if (!m || m.split(" ").length > 8 || /\?/.test(m))
        return null;
    if (NONE_RE.test(m) || (NONE_START.test(m) && m.split(" ").length <= 4))
        return { apps: [], none: true };
    const rest = m.replace(APPS_LEAD, "").replace(/\b(?:too|as well|lol|haha|pls|please|rn|for this|for that)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!rest)
        return null;
    const chunks = rest.split(/\s*(?:,|&|\band\b|\bplus\b|\balso\b)\s*/).map((c) => c.replace(/^(?:the|my|a)\s+/, "").trim()).filter(Boolean);
    if (!chunks.length || chunks.length > 4)
        return null;
    if (!chunks.every((c) => CHUNK.test(c) && !c.split(" ").some((w) => NOT_AN_APP_WORD.test(w))))
        return null;
    return { apps: [...new Set(chunks)], none: false };
}
// -- finishing early: "Nice. Start your break now, or move to X?" ---------------------------------------------------------------------
const END_RE = /^(?:(?:ok(?:ay)?|yeah|ya|well)\b[\s,]*)*(?:no|nope|nah|neither|nothing|nvm|never ?mind|stop|im (?:good|done)|i'?m (?:good|done)|done for now|thats (?:it|all)|that'?s (?:it|all))\b/;
const NEXT_RE = /\bnext\b|\bmove on\b|\bkeep going\b|\bgo again\b/;
const BREAK_RE = /\b(?:break|rest|breather|chill|coffee|pause)\b/;
const YES_RE = /^(?:(?:yes|yeah|yep|ya|ok(?:ay)?|sure|pls|please|yup|k)\b[\s,.!]*)+(?:lol|pls|please)?[\s.!]*$/;
const MARK_RE = /\b(?:mark|tick|check|cross)\b[^.]*\b(?:done|off|complete\w*)\b|\b(?:it'?s|its|it is) done\b/;
export const content = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^(?:the|and|for|one|next|task|my|to|of)$/.test(w));
/** The answer to the break-or-next question: break, next (only when there is one), or end (neither). `mark`: he also said to tick the task off. */
export function readEarlyAnswer(message, hasNext, nextTitle) {
    const m = norm(message).replace(/[.!]+$/, "");
    if (!m || m.split(" ").length > 12 || /\?/.test(m))
        return null;
    const mark = MARK_RE.test(m);
    if (END_RE.test(m) && !BREAK_RE.test(m))
        return { choice: "end", mark };
    const namesNext = hasNext && !!nextTitle && /^(?:the |my )?\w[\w ]{0,20}$/.test(m) && content(m.replace(/^(?:the|my)\s+/, "")).some((w) => content(nextTitle).includes(w)) && !BREAK_RE.test(m);
    if (hasNext && (NEXT_RE.test(m) || namesNext) && !BREAK_RE.test(m))
        return { choice: "next", mark };
    if (BREAK_RE.test(m) || YES_RE.test(m))
        return { choice: "break", mark };
    return null;
}
// -- the one-time website override ----------------------------------------------------------------------------------------------------
const SITE = String.raw `([a-z0-9-]+\.(?:com|tv|net|org|io|co|be)|youtube|reddit|tiktok|instagram|insta|netflix|twitch|twitter|facebook|snapchat)`;
const OVERRIDE_RE = new RegExp(String.raw `(?:\bi (?:really |actually )?(?:need|gotta use|got to use|have to use|need to use|gotta go on|have to go on|need to go on)|^(?:ok(?:ay)? )?allow|\blet me (?:use|go on|have|watch|be on)|\bunblock|\bcan i (?:use|go on|have)|\bok to use)\s+(?:to\s+)?${SITE}\b`);
/** "i need youtube for this": the site he names (as said), for a one-time allow this session. null for anything else. */
export function readSiteOverride(message) {
    const m = norm(message);
    if (m.split(" ").length > 14 || /\?/.test(m) || /\b(?:hate|block|stop|ban|quit|delete)\b/.test(m))
        return null;
    return OVERRIDE_RE.exec(m)?.[1] ?? null;
}
