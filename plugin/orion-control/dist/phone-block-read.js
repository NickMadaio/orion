/*
 Blocking an app group on his phone, read from his words (W10-G, 2026-11-02). Pure: strings in, values out; phone-block-flow.ts runs it.

   "block safari n stuff on my phone till 12"   → block browsers until 12
   "shut off tiktok and insta"                  → block social (an hour, said as a default)
   "let me back on youtube"                     → unblock video
   "unblock everything"                         → unblock all
 scripts/orion-phone-time only takes GROUPS (social, browsers, video, games, messaging), so well-known app names map to their group
 and the reply says which group went. A group is blocked only when he names it (or an app in it); "everything" / "all my apps" is
 the one way to shut all five, and a bare "block it" asks which group instead of guessing.
*/
export const GROUPS = ["social", "browsers", "video", "games", "messaging"];
export const MAX_MINUTES = 480;
export const DEFAULT_MINUTES = 60;
export const GROUP_LABEL = { social: "social media", browsers: "browsers", video: "video apps", games: "games", messaging: "messaging apps" };
export const LIST_NAME = { social: "Social", browsers: "Browsers", video: "Video", games: "Games", messaging: "Messaging" };
/** Words → group, and how the app reads aloud (empty for a group word). Longest first, so "social media" beats "social". */
const WORDS = [
    ["social media", "social", ""], ["socials", "social", ""], ["social", "social", ""], ["feeds", "social", ""], ["feed", "social", ""],
    ["tik tok", "social", "TikTok"], ["tiktok", "social", "TikTok"], ["instagram", "social", "Instagram"], ["insta", "social", "Instagram"], ["ig", "social", "Instagram"],
    ["snapchat", "social", "Snapchat"], ["snap", "social", "Snapchat"], ["twitter", "social", "Twitter"], ["reddit", "social", "Reddit"],
    ["facebook", "social", "Facebook"], ["fb", "social", "Facebook"], ["threads", "social", "Threads"], ["bluesky", "social", "Bluesky"], ["x", "social", "X"],
    ["youtube", "video", "YouTube"], ["yt", "video", "YouTube"], ["netflix", "video", "Netflix"], ["twitch", "video", "Twitch"], ["hulu", "video", "Hulu"],
    ["videos", "video", ""], ["video", "video", ""], ["streaming", "video", ""],
    ["safari", "browsers", "Safari"], ["chrome", "browsers", "Chrome"], ["firefox", "browsers", "Firefox"], ["browsers", "browsers", ""], ["browser", "browsers", ""],
    ["the web", "browsers", ""], ["web", "browsers", ""], ["internet", "browsers", ""],
    ["games", "games", ""], ["game", "games", ""], ["gaming", "games", ""], ["roblox", "games", "Roblox"], ["clash", "games", "Clash"], ["fortnite", "games", "Fortnite"],
    ["whatsapp", "messaging", "WhatsApp"], ["imessage", "messaging", "iMessage"], ["messages", "messaging", ""], ["messaging", "messaging", ""],
    ["texts", "messaging", ""], ["discord", "messaging", "Discord"], ["telegram", "messaging", "Telegram"], ["chat", "messaging", ""],
].sort((a, b) => b[0].length - a[0].length);
const WORD_RE = new RegExp(`(?<![a-z0-9])(?:${WORDS.map(([w]) => w.replace(/ /g, "\\s+")).join("|")})(?![a-z0-9])`, "g");
const lookup = (w) => { const k = w.replace(/\s+/g, " "); return WORDS.find(([x]) => x === k); };
const clean = (m) => m.toLowerCase().replace(/[‘’`]/g, "'").replace(/\bn\b/g, "and").replace(/\s+/g, " ").trim();
const BLOCK_VERB = /\b(?:block|shut(?:\s+(?:off|down))?|cut\s+off|kill|disable|ban|lock(?:\s+me\s+out\s+of)?|turn\s+off|keep\s+me\s+off|stop\s+me\s+(?:from\s+)?(?:using|opening|going\s+on)|take\s+away|no\s+more)\b/;
const UNBLOCK_VERB = /\b(?:un-?block|un-?shut|(?:let|get)\s+me\s+(?:back\s+)?(?:on|onto|into|use)|let\s+me\s+have|open\s+(?:\w+\s+){0,3}?back\s+up|turn\s+(?:\w+\s+){0,3}?back\s+on|put\s+(?:\w+\s+){0,3}?back\s+on|allow|unlock)\b/;
const NEGATED_ALLOW = /\b(?:don'?t|do not|never|not|no)\s+(?:\w+\s+)?(?:allow|let)\b/;
const NOT_PHONE = /\bblock\s+(?:off|out)\b|\bblock\s+of\b|\btime\s+block\b|\bstudy\s+block\b|\b(?:calendar|schedule|lights?|led|alarm|session|tv|speakers?|music|volume|wifi|wi-fi|number|caller|email|sender|contact|ads?|pop-?ups?|cookies)\b|\b(?:mac|laptop|computer|desktop|tabs?|websites?|sites?)\b/;
const PHONE_CUE = /\b(?:phone|iphone|screen\s*time)\b/;
const ALL_WORDS = /\b(?:everything|all\s+(?:of\s+)?(?:my\s+|the\s+)?(?:apps|groups|of\s+it|them)|every\s+app)\b/;
const VAGUE_TARGET = /\b(?:it|that|this|them|those|my\s+apps|the\s+apps|apps|distractions?|distracting\s+(?:apps|stuff)|my\s+phone|the\s+phone|stuff)\b/;
export const ASK_TEXT = "Which ones, social media, browsers, video, games or messaging?";
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, "a couple": 2, "a couple of": 2, few: 3, "a few": 3 };
const UNIT = String.raw `(hours?|hrs?|h|minutes?|mins?|m)\b`;
const DIGIT_LEN = new RegExp(String.raw `(?<![\d:.])(\d+(?:\.\d+)?)\s*${UNIT}`);
const WORD_LEN = new RegExp(String.raw `\b(an?|one|two|three|four|five|six|seven|eight|a\s+couple(?:\s+of)?|a\s+few|couple(?:\s+of)?|few)\s+${UNIT}`);
/** "for an hour", "for 2 hours", "for 45 min", "for half an hour", "for an hour and a half". */
function lengthOf(m) {
    if (/\bhour\s+and\s+a\s+half\b/.test(m))
        return 90;
    if (/\bhalf\s+(?:an?\s+)?hour\b/.test(m))
        return 30;
    const d = DIGIT_LEN.exec(m);
    const w = d ? undefined : WORD_LEN.exec(m);
    const n = d ? Number(d[1]) : w ? NUM_WORDS[w[1].replace(/\s+/g, " ")] : undefined;
    const unit = d?.[2] ?? w?.[2];
    if (n === undefined || !unit)
        return undefined;
    return Math.round(/^h/.test(unit) ? n * 60 : n);
}
/** "till 12", "until 3pm", "til 3:30", "till midnight", "by 11". */
function clockOf(m) {
    const w = m.match(/\b(?:till|til|until|by)\s+(noon|midnight)\b/);
    if (w)
        return { h: w[1] === "noon" ? 12 : 0, m: 0, meridiem: true };
    const x = m.match(/\b(?:till|til|until|by)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![a-z0-9:])/);
    if (!x)
        return undefined;
    const h = Number(x[1]);
    const min = Number(x[2] ?? 0);
    if (min > 59 || h > 24 || (x[3] && (h < 1 || h > 12)))
        return undefined;
    if (x[3])
        return { h: (h % 12) + (/^p/.test(x[3]) ? 12 : 0), m: min, meridiem: true };
    return { h: h === 24 ? 0 : h, m: min, meridiem: h > 12 || h === 0 };
}
const NIGHT = /\b(?:for\s+)?the\s+rest\s+of\s+(?:the\s+|my\s+)?(?:night|evening)\b|\b(?:overnight|through\s+the\s+night|all\s+night|tonight)\b|\b(?:till|until)\s+(?:i\s+wake(?:\s+up)?|i\s+get\s+up|morning)\b/;
const DAY = /\b(?:for\s+)?the\s+rest\s+of\s+(?:the\s+|my\s+)?(?:day|afternoon)\b|\ball\s+day\b/;
/** How long he asked for; undefined when he did not say. */
export function spanOf(text) {
    const m = clean(text);
    if (NIGHT.test(m))
        return { night: true };
    if (DAY.test(m))
        return { day: true };
    const clock = clockOf(m);
    if (clock)
        return { clock };
    const minutes = lengthOf(m);
    return minutes ? { minutes } : undefined;
}
const pad = (n) => String(n).padStart(2, "0");
/** "12:00 PM" */
export const clockLabel = (d) => `${(d.getHours() + 11) % 12 + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
/** The span as minutes from `now` (and the instant it ends), or how long it is when that is over the 8-hour limit. `wake` is his next alarm, when the plan has one. */
export function resolveSpan(span, now, wake) {
    const at = (h, m, dayOffset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0, 0);
    const ahead = (d) => d.getTime() - now.getTime() >= 60_000;
    if (!span)
        return { minutes: DEFAULT_MINUTES, until: new Date(now.getTime() + DEFAULT_MINUTES * 60_000), note: "default" };
    let end;
    let note;
    if ("minutes" in span)
        end = new Date(now.getTime() + span.minutes * 60_000);
    else if ("clock" in span) {
        const { h, m, meridiem } = span.clock;
        const hours = meridiem || h > 12 ? [h % 24] : [h % 12, (h % 12) + 12];
        const next = hours.flatMap((hh) => [at(hh, m, 0), at(hh, m, 1)]).filter(ahead).sort((a, b) => a.getTime() - b.getTime())[0];
        if (!next)
            return { tooLong: 24 * 60 };
        end = next;
    }
    else if ("day" in span)
        end = at(24, 0, 0);
    else {
        const w = wake?.();
        end = w && ahead(w) ? w : ahead(at(7, 0, 0)) ? at(7, 0, 0) : at(7, 0, 1);
        if (Math.ceil((end.getTime() - now.getTime()) / 60_000) > MAX_MINUTES) {
            end = new Date(now.getTime() + MAX_MINUTES * 60_000);
            note = "capped";
        }
    }
    const minutes = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 60_000));
    if (minutes > MAX_MINUTES)
        return { tooLong: minutes };
    return { minutes, until: new Date(now.getTime() + minutes * 60_000), ...(note ? { note } : {}) };
}
/** Groups and app names in `text`, in the order said. */
export function targetsOf(text) {
    const groups = [];
    const apps = [];
    // A bare "x" is a letter unless a verb or "and" leads straight into it ("shut off tiktok and x").
    const real = (word, at) => word !== "x" || /(?:\b(?:block|off|and|or|on|kill|ban)|,)\s+$/.test(text.slice(0, at));
    for (const mm of text.matchAll(WORD_RE)) {
        const hit = lookup(mm[0]);
        if (!hit || !real(mm[0], mm.index ?? 0))
            continue;
        if (!groups.includes(hit[1]))
            groups.push(hit[1]);
        if (hit[2] && !apps.includes(hit[2]))
            apps.push(hit[2]);
    }
    return { groups, apps };
}
/** What he asked for about his phone's app groups; undefined when this is not that (the turn goes on unchanged). */
export function readPhoneBlock(message) {
    const m = clean(message).replace(/[!?.]+$/g, "");
    if (!m || m.split(" ").length > 40)
        return undefined;
    if (NOT_PHONE.test(m) && !PHONE_CUE.test(m))
        return undefined;
    const un = UNBLOCK_VERB.exec(m);
    const blk = BLOCK_VERB.exec(m);
    if (un && (!blk || un.index <= blk.index)) {
        if (NEGATED_ALLOW.test(m))
            return undefined;
        const tail = m.slice(un.index + un[0].length);
        const t = targetsOf(m.slice(un.index));
        if (ALL_WORDS.test(tail))
            return { kind: "unblock", groups: "all", apps: [] };
        if (t.groups.length)
            return { kind: "unblock", groups: t.groups, apps: t.apps };
        // "unblock my apps" with no time is the whole set; with a time it is the desk's grant ("unblock my apps till 12:45").
        if (/^un-?block/.test(un[0]) && /\b(?:my\s+|the\s+)?apps\b/.test(tail) && !spanOf(m))
            return { kind: "unblock", groups: "all", apps: [] };
        return undefined;
    }
    if (!blk)
        return undefined;
    const tail = m.slice(blk.index + blk[0].length);
    const t = targetsOf(m.slice(blk.index));
    const span = spanOf(m);
    if (/\b(?:everything|all\s+(?:of\s+)?(?:my\s+|the\s+)?apps|every\s+app)\b/.test(tail))
        return { kind: "block", groups: [...GROUPS], apps: [], ...(span ? { span } : {}), all: true };
    if (t.groups.length)
        return { kind: "block", groups: t.groups, apps: t.apps, ...(span ? { span } : {}) };
    const plainVerb = /^(?:block|shut|cut|kill|disable|ban)/.test(blk[0]);
    if (plainVerb && VAGUE_TARGET.test(tail) && (PHONE_CUE.test(m) || /^\s*(?:it|that|this|them|those)\b/.test(tail) || /\bapps\b|distract/.test(tail)))
        return { kind: "ask", text: ASK_TEXT };
    return undefined;
}
