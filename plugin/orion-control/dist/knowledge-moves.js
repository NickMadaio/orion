/*
 What he asks of his own knowledge, read by code (wave 6, 2026-11-01; gate run-1101003318).

   kno-forget-v/c      "get rid of the stuff you saved about X" ran a note search, leaked its error and deleted nothing. A forget is
                       now a move: the topics he named, then the saved entries that match, archived (knowledge-run.ts).
   kno-connections-c   "everything linked to X" read X's note body back. A links ask is answered from link relations.
   per-who-am-i-c      "what do you know about me / my routine" searched for "routine" and led with trivia. A profile ask is
                       answered from his standing records, trivia last.
   saf-delete-folder-c Deleting a file he named fell to `exec rm`, refused. A named file or folder goes to the Trash through
                       orion-trash (trash-move.ts); a folder only after a yes to a question that names it.
 Pure: every function here reads the message (and what this chat is waiting on) and returns data.
*/
import { readTrash } from "./trash-move.js";
const HELD_MS = 5 * 60_000;
/** What this chat's last knowledge reply is waiting on. It lives exactly one turn: taking it clears it. */
export class KnowledgePending {
    held = new Map();
    set(key, value, nowMs) { this.held.set(key, { at: nowMs, value }); }
    take(key, nowMs) {
        const row = this.held.get(key);
        this.held.delete(key);
        return row && nowMs - row.at < HELD_MS ? row.value : undefined;
    }
}
const tidy = (m) => m.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const LEAD = /^(?:(?:hey|yo|ok(?:ay)?|so|um+|uh+|orion|also|and|pls|please|can (?:you|u)|could (?:you|u)|would (?:you|u)|u can|just)[,\s]+)*/;
// ---- forget -------------------------------------------------------------------------------------------------------------
const FORGET_VERB = /\b(?:forget|delete|remove|erase|drop|scrap|clear|wipe|get rid of|take out|throw out|ditch|unsave|unlearn)\b/;
const MEMORY_WORD = /\b(?:memor(?:y|ies)|entr(?:y|ies)|you (?:saved|noted|remembered|stored|wrote down|learned|kept|logged)|(?:you'?ve|u) (?:saved|noted|got saved)|saved:|from (?:your|ur) (?:memory|brain|notes)|what (?:i|you) (?:said|told you|saved|remembered|noted)|(?:the )?thing i (?:said|told you|mentioned))/;
const FORGET_THAT = /^forget (?:that|what|the (?:thing|fact|bit|part))\b/;
const NOT_FORGET = /\b(?:don'?t|dont|never|not) (?:let me )?forget\b|\bforg[eo]t to\b|\bi forgot\b|\bforget (?:it|about it|that lol)\b(?!\s+about\b)/;
const ELSEWHERE = /\b(?:calendar|schedule|reminders?|alarms?|to-?dos?|tasks?|events?|blocks?|class(?:es)?|meetings?|sessions?|files?|folders?|today|tonight|tomorrow|tmrw)\b|\.[a-z][a-z0-9]{0,5}\b/;
const ANCHOR = /\b(?:about|abt|bout|regarding|re|saying|says|that says|called|named|mentioning|on)\s+|saved:\s*/g;
const CLAUSE_END = /\s+(?:its|it's|it is|thats|that's|cuz|because|since|bc|lol|pls|please|tho|though|now|asap|for me|for good|get rid of|delete|remove|erase|forget)\b.*$/;
const VERB_NOISE = /\b(?:can|could|would|you|u|pls|please|just|forget|delete|remove|erase|drop|scrap|clear|wipe|get rid of|take out|throw out|ditch|the|memory|memories|entry|entries|saved|that|this|those|these|one|ones|thing|things|stuff|some|random|earlier|i|said|told|what|remembered|from|your|ur|all|of|it|them|and)\b/g;
const PLURAL = /\b(?:stuff|things|entries|memories|all|everything|anything|those|them|lines|facts)\b/;
function targetOf(part) {
    const anchors = [...part.matchAll(ANCHOR)];
    const last = anchors.at(-1);
    const raw = last ? part.slice((last.index ?? 0) + last[0].length) : part.replace(VERB_NOISE, " ");
    return raw.replace(CLAUSE_END, "").replace(/[^\w' -]+/g, " ").replace(/^(?:the|a|an)\s+/, "").replace(/\s+/g, " ").trim();
}
function readForget(m) {
    const body = m.replace(LEAD, "");
    if (!FORGET_VERB.test(body) || NOT_FORGET.test(body))
        return undefined;
    if (!MEMORY_WORD.test(body) && !FORGET_THAT.test(body))
        return undefined;
    if (ELSEWHERE.test(body.replace(/saved:\s*\S+/g, "")))
        return undefined;
    const targets = body.split(/\s*(?:[,;]|\band\b|\balso\b|&)\s*/).map(targetOf).filter((t) => /[a-z0-9]{3,}/.test(t) && !/^(?:that|this|it|them|those)$/.test(t));
    if (!targets.length)
        return undefined;
    return { kind: "forget", targets: [...new Set(targets)], all: PLURAL.test(body) };
}
// ---- picks and yes/no ----------------------------------------------------------------------------------------------------
const YES = /^(?:y|ya|yes|yeah|yea|yep|yup|sure|ok(?:ay)?|k|do it|go ahead|go for it|confirm(?:ed)?|please do|yes please|trash it|bin it|delete it|move it)\b/;
const NO = /^(?:n|no|nah|nope|don'?t|dont|cancel|never ?mind|nvm|leave it|keep it|stop|wait|hold on|not now)\b/;
const ORDINALS = [[/\b(?:1|1st|one|first)\b/, 0], [/\b(?:2|2nd|two|second)\b/, 1], [/\b(?:3|3rd|three|third)\b/, 2], [/\b(?:4|4th|four|fourth)\b/, 3], [/\b(?:5|5th|five|fifth)\b/, 4]];
const words = (s) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
function pick(m, candidates) {
    if (m.split(" ").length > 12)
        return undefined;
    if (NO.test(m) || /\b(?:none|neither)\b/.test(m))
        return [];
    if (/\b(?:all|both|every(?:thing| one)?|them all)\b/.test(m))
        return candidates;
    const said = m.replace(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|other) ones?\b/g, "$1");
    if (/\blast\b/.test(said))
        return [candidates.at(-1)];
    const byNumber = ORDINALS.filter(([re, i]) => re.test(said) && i < candidates.length).map(([, i]) => candidates[i]);
    if (byNumber.length)
        return byNumber;
    const heard = new Set(words(m));
    const hit = candidates.filter((c) => words(c.text).some((w) => heard.has(w) && w.length > 3));
    return hit.length === 1 ? hit : undefined;
}
function readHeld(m, held) {
    const body = m.replace(LEAD, "").replace(/[.!?]+$/, "");
    if (held.kind === "forget-pick") {
        const picked = pick(body, held.candidates);
        return picked ? { kind: "forget-pick", held, picked } : undefined;
    }
    const short = body.split(" ").length <= 8;
    if (held.kind === "forget-undo") {
        if (/\b(?:put (?:it|that|them) back|bring (?:it|that|them) back|restore (?:it|that|them)|undo (?:that|it)|unforget)\b/.test(body))
            return { kind: "forget-undo", held, yes: true };
        return undefined;
    }
    if (short && YES.test(body))
        return { kind: "trash-confirm", held, yes: true };
    if (short && NO.test(body))
        return { kind: "trash-confirm", held, yes: false };
    return undefined;
}
// ---- links ---------------------------------------------------------------------------------------------------------------
const ASKING = /^(?:what|whats|what's|which|show|list|how|tell|give|anything|is there|are there|map)\b|\?$/;
const LINKS_HOW = /\bhow (?:is|are|does|do)\s+(.+?)\s+(?:connect(?:ed)?|link(?:ed)?|relate[sd]?|tie[sd]? in|fit)\b/;
const LINKS_TO = /\b(?:linked|connected|related|relates|connects?|links?|ties?|tied)\s+(?:to|with|into)\s+/g;
const LINKS_OF = /\bconnections? (?:of|for|to|around)\s+/g;
const NOT_LINKS = /\b(?:move|cancel|delete|remove|reschedule|push|clear|book|add)\b/;
const GENERIC = /^(?:my |the |all |any )?(?:stuff|things|everything|anything|it|that|this|them|me|wifi|internet|network|bluetooth|vpn)$/;
const subjectOf = (s) => s.replace(/\b(?:in|on|from) (?:my|the|your|ur) (?:knowledge graph|graph|notes|brain|memory|vault)\b.*$/, "")
    .replace(/[?.!]+$/, "").replace(/^(?:the|my|a|an)\s+/, "").replace(/\s+(?:pls|please|again|rn)$/, "").trim();
function readLinks(m) {
    const body = m.replace(LEAD, "");
    if (!ASKING.test(body) || NOT_LINKS.test(body))
        return undefined;
    const how = LINKS_HOW.exec(body)?.[1];
    const tail = (re) => { const hits = [...body.matchAll(re)]; const last = hits.at(-1); return last ? body.slice((last.index ?? 0) + last[0].length) : undefined; };
    for (const raw of [how, tail(LINKS_TO), tail(LINKS_OF)]) {
        const subject = raw === undefined ? "" : subjectOf(raw);
        if (subject && subject.length <= 60 && !GENERIC.test(subject))
            return { kind: "links", subject };
    }
    return undefined;
}
// ---- profile -------------------------------------------------------------------------------------------------------------
const PROFILE = [
    /\bwhat (?:do|did|else do|all do) (?:you|u) (?:know|remember|have) (?:about|on) me\b/,
    /\btell me (?:everything |all |what )?(?:(?:you|u) know )?about (?:me|myself)\b/,
    /\bwhat (?:have|did) (?:you|u) (?:learn(?:ed|t)?|figured? out|pick(?:ed)? up) about me\b/,
    /\bdescribe me\b/, /\bhow well do (?:you|u) know me\b/, /^who am i[\s?.!]*$/,
    /\bdo (?:you|u) (?:even |actually |really )?know (?:me|who i am)[\s?.!]*$/,
    /\bwhat(?:'?s| is| does) my (?:usual |daily |normal |typical |weekly |whole )?routine\b/,
];
const PROFILE_NOT = /\b(?:today|tonight|tomorrow|tmrw|this (?:morning|afternoon|evening|week)|next week|on (?:mon|tue|wed|thu|fri|sat|sun)\w*)\b/;
const readProfile = (m) => (PROFILE.some((re) => re.test(m)) && !PROFILE_NOT.test(m) ? { kind: "profile" } : undefined);
/** What this message asks of his knowledge, if anything. Room speech only ever reads (links, profile), never forgets or trashes. */
export function readKnowledgeMove(message, opts = {}) {
    const m = tidy(message);
    if (!m || m.length > 300)
        return undefined;
    if (opts.held && !opts.spoken) {
        const answer = readHeld(m, opts.held);
        if (answer)
            return answer;
    }
    const reads = readProfile(m) ?? readLinks(m);
    if (reads || opts.spoken)
        return reads;
    return readForget(m) ?? readTrash(message);
}
