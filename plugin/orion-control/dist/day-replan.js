const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const norm = (t) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const ceil5 = (n) => Math.ceil(n / 5) * 5;
const DEFAULT_FACTS = { commuteMinutes: 30, bufferMinutes: 5, anchors: [] };
const EXPLICIT = /\b(?:re-?schedul\w*|re-?plan\w*|re-?arrang\w*|re-?organi[sz]\w*|re-?do|re-?work\w*|re-?jig\w*|shuffle\w*|move (?:everything|all|the rest)|push (?:everything|all|the rest))\b/i;
// A request to lay the day out again, or an "after X" he is working from. Without one of these a bare "gym first" is not a reschedule.
const CONTEXT = /\b(?:re-?schedul\w*|re-?plan\w*|re-?arrang\w*|re-?organi[sz]\w*|re-?do|re-?work\w*|re-?jig\w*|shuffle\w*|sort (?:out )?(?:my|the)|move (?:everything|all|the rest)|push (?:everything|all|the rest)|everything after|the rest of (?:my|the) (?:day|evening|afternoon|night)|my (?:day|evening|afternoon|night)|after (?:my |the |our )?[a-z0-9 ]{1,30}?(?:class|lecture|lab|seminar|tutorial)|after (?:my |the |our )?(?:class|lecture|lab|seminar|tutorial)|(?:after|when) i(?:'m| am| get| got)\b)/i;
// Only an imperative request fires this, so a hypothetical, a question, a negation, a past event or a plan he is only thinking about does not
// rewrite his day (review, 2026-10-20). The front desk is skipped for these messages, so this is the only gate.
const NOT_A_REQUEST = /\b(?:don'?t|do not|dont|doesn'?t|never ?mind|nvm|no need|not|n'?t|rescheduled|replanned|rearranged|reorgani[sz]ed|did|had|already|was going to|were going to|used to|going to|gonna|should|shall|what if|what about|how about|thinking|wondering|maybe|perhaps|might|could i|can i|may i|whether|if i|if we|would it|would i|why|supposed to)\b/i;
// ALLOW, not block: the message must START with the request (after only a courtesy word), with an imperative verb, and must not take it back at the end.
// Anything else goes the normal way, never to code-first (review round 2, 2026-10-20).
const COURTESY = /^(?:(?:ok(?:ay)?|so|yo|hey|please|pls|orion|can u|can you|could you|would you|will you|just)[,.\s]+)*/i;
const IMPERATIVE = /^(?:re-?schedule|re-?do|re-?plan|re-?arrange|re-?organi[sz]e|re-?work|move|push|put|shift|do|have|start)\b|^(?:after|when|once)\b[^,.;]*?[,\s]+(?:do|put|have|start with)\b/i;
const TAKEN_BACK = /(?:\bjk|\bj\/k|just kidding|\bkidding|\bnever ?mind|\bnvm|\blol|\blmao|\bhaha+|\bor not|\bscratch that|\bforget (?:it|that))\W*$/i;
export const startsAsRequest = (text) => { const rest = text.replace(COURTESY, ""); return IMPERATIVE.test(rest) && !TAKEN_BACK.test(text); };
// Second thoughts, doubt and hearsay anywhere in the message: not an order (review round 3, 2026-10-20).
const SECOND_THOUGHTS = /\b(?:actually|wait|no|nah|nope|forget|hmm+|idk|or is that|or not|on second thought|scratch that|ugh)\b/i;
const HEARSAY = /\b(?:she|he|they|someone|mom|mum|dad|my \w+)\s+(?:\w+\s+)?(?:told|said|says|tells|asked|wants)\b|\b(?:told|said|asked) me\b/i;
const POLITE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|orion)[,\s]+)*(?:can|could|would|will)\s+(?:you|u)\b/i;
const FIRST_PUT = /\b(?:put|make|do|have|schedule|plan|start(?:\s+off)?\s+with)\s+(?:my\s+|the\s+|a\s+)?(?<y>[a-z][a-z' -]{0,40}?)\s+(?:as\s+)?(?:the\s+)?first(?:\s+(?:event|thing|item|block|activity|task|one))?\b(?!\s+(?:thing\s+)?(?:in the morning|tomorrow|today))/i;
const FIRST_END = /\s(?<y>[a-z]+)\s+first\s*[.!]*$/i; // "reschedule my day after marketing gym first": one word, no comma
const FIRST_BARE = /(?:^|[,;:]\s*|\band\s+|\bbut\s+)(?:(?:put|do|have)\s+)?(?:my\s+|the\s+)?(?<y>[a-z][a-z']*(?:\s[a-z][a-z']*)?)\s+first\b(?!\s+(?:thing\s+)?(?:in the morning|tomorrow|today|class|lecture))/i;
const SEQUENCE = /\b(?:do|put|have|schedule|start with|then do)\s+(?:my\s+|the\s+)?(?<seq>[a-z][^,.;]*?\bthen\b[^.;]*)/i;
const THEN = /(?:,\s*)?\b(?:and\s+)?then\s+(?:do\s+|put\s+|have\s+)?(?:my\s+|the\s+)?(?<z>[^,.;]+?)(?=\s+(?:and\s+)?then\b|[,.;]|$)/gi;
const TITLE_TAIL = /\s+(?:please|pls|today|tonight|now|for me|after\b.*|before\b.*|when\b.*|once\b.*|at\b.*|first)$/i;
const HOME = /\b(?:back\s+home|get(?:ting)?\s+home|got\s+home|(?:i'?m|im|i am)\s+(?:back|home)|(?:i\s+)?(?:get|got|come|came)\s+back|arriv\w*\s+home|walk in)\b|\bhome\b/i;
const AFTER = /\bafter\s+(?:my\s+|the\s+|our\s+)?(?<p>[^,.;]+?)(?=\s+(?:after|but|and|then|so|put|do|make|have|start|schedule|plan|move|lets|let's)\b|[,.;]|$)/gi;
// ---- typos: the allow-list below is unchanged, but "resched my day, gim frist" is still a request (live test 2026-10-20) ----
const ALIASES = { gim: "gym", gymm: "gym", frist: "first", firts: "first", fisrt: "first", priorty: "priority", priorety: "priority", prority: "priority",
    evning: "evening", evenin: "evening", evenig: "evening", tonite: "tonight", thne: "then", tehn: "then", hten: "then", resched: "reschedule", reshed: "reschedule",
    resch: "reschedule", replna: "replan", u: "you", plz: "please", pls: "please", ok: "ok" };
const VOCAB = ["reschedule", "replan", "rearrange", "reorganize", "reorganise", "evening", "afternoon", "priority", "lecture", "before"]; // words of 5+ letters only: "when" is not a typo of "then"
function lev(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const t = row[j];
            row[j] = Math.min(t + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = t;
        }
    }
    return row[b.length];
}
/** Common typos in a request's key words, fixed by an alias list and a small edit distance against the words the parser reads. */
export function fixTypos(text) {
    return text.replace(/[A-Za-z]+/g, (w) => {
        const lower = w.toLowerCase();
        if (ALIASES[lower] && ALIASES[lower] !== lower)
            return ALIASES[lower];
        if (lower.length < 5 || VOCAB.includes(lower))
            return w;
        const near = VOCAB.find((v) => v[0] === lower[0] && Math.abs(v.length - lower.length) <= 2 && lev(v, lower) <= (v.length >= 8 ? 2 : 1));
        return near ?? w;
    });
}
const REST_OF_DAY = /^(?:the\s+)?(?:rest|whatever|whatevers|whatever'?s|everything else|anything else|what'?s left|whats left|other (?:stuff|things)|all the rest)\b/i;
const FIRST_ANY = /\b(?<y>[a-z]+)\s+first\b/i;
const NOT_A_TITLE = new Set(["the", "a", "my", "at", "is", "was", "do", "thing", "what", "who", "it", "that", "this", "i", "me", "you", "of", "and", "but", "or", "so", "put", "make", "have", "day", "evening", "class"]);
const cleanTitle = (t) => {
    let out = t.trim();
    for (let i = 0; i < 3 && TITLE_TAIL.test(out); i += 1)
        out = out.replace(TITLE_TAIL, "").trim();
    return out.replace(/^(?:my|the|a|an)\s+/i, "").replace(/[“”"]/g, "").trim();
};
/** The order and the anchor in his words, or undefined when this is not a reschedule with an order. */
export function parseReplanRequest(message) {
    const text = fixTypos(message.replace(/\s+/g, " ").trim());
    // A question is not an order ("what is first after class?"), but "can you reschedule my day, gym first?" is a polite one.
    // A "?" is only allowed as the end of a polite request ("can u … ?") where the whole message is the request.
    const question = text.includes("?") && !(POLITE.test(text) && text.indexOf("?") === text.length - 1);
    if (!text || question || SECOND_THOUGHTS.test(text) || HEARSAY.test(text) || !startsAsRequest(text) || NOT_A_REQUEST.test(text) || !CONTEXT.test(text))
        return undefined;
    const order = [];
    const add = (t) => { const c = t ? cleanTitle(t) : ""; if (c && !REST_OF_DAY.test(c) && !order.some((o) => norm(o) === norm(c)))
        order.push(c); };
    const loose = text.match(FIRST_ANY);
    const firstMatch = text.match(FIRST_PUT) ?? text.match(FIRST_BARE) ?? text.match(FIRST_END) ?? (loose && !NOT_A_TITLE.has(loose.groups.y.toLowerCase()) ? loose : null);
    const first = firstMatch?.groups?.y;
    if (first)
        add(first);
    const seq = first ? undefined : text.match(SEQUENCE)?.groups?.seq;
    if (seq) {
        const [head, ...rest] = seq.split(/\bthen\b/i);
        add(head?.replace(/[,\s]+$/, "").replace(/\s+and$/i, ""));
        rest.forEach((r) => add(r.replace(/^\s*(?:do|put|have)\s+/i, "").replace(/[,\s]+$/, "")));
    }
    else if (first)
        for (const m of text.matchAll(THEN))
            add(m.groups?.z);
    if (!order.length || (!first && order.length < 2))
        return undefined;
    // A time or a length in the title ("gym at 6") means he is dictating the clock: not this shape.
    if (order.some((t) => /\d/.test(t) || t.split(/\s+/).length > 5))
        return undefined;
    let anchor;
    let home = false;
    // The order he named is not part of the anchor ("after marketing gym first").
    const rest = firstMatch ? text.replace(firstMatch[0], ", ") : text;
    for (const m of rest.matchAll(AFTER)) {
        const phrase = m.groups.p.trim();
        if (/^(?:i|i'?m|im)\b/i.test(phrase) && HOME.test(phrase) || /^(?:i\s+)?(?:get|got|come|came)\s+back\b/i.test(phrase) || /^(?:getting\s+)?home\b/i.test(phrase)) {
            home = true;
            continue;
        }
        anchor ??= phrase;
    }
    if (!home && HOME.test(text) && !/\bhome\s*work\b/i.test(text))
        home = true;
    return { order, ...(anchor ? { anchor } : {}), home, explicit: EXPLICIT.test(text) };
}
/** "actually do resume before gym", "put resume first, then gym": a reorder of the request he just made. Only read when that request is on record, so it is never code-first without one. */
const REORDER_LEAD = /^(?:(?:actually|no|nah|wait|ok(?:ay)?|hmm+|so|but|and|uh|um|you can|can you|can u|could you|please|pls|just)[,.\s]+)*(?:(?:do|put|have|make|start with|let'?s do|lets do)\s+)?/i;
const REORDER = /^(?:my\s+|the\s+)?(?<x>[a-z][a-z' -]{0,30}?)\s+(?:before|ahead of|first,?\s+then|then)\s+(?:my\s+|the\s+)?(?<y>[a-z][a-z' -]{0,30}?)\s*[.!]*$/i;
export function parseReorder(message, context) {
    const text = fixTypos(message.replace(/\s+/g, " ").trim());
    if (!text || text.includes("?") || HEARSAY.test(text) || TAKEN_BACK.test(text) || /\b(?:don'?t|do not|never ?mind|nvm|maybe|should|what if|idk|or is that)\b/i.test(text))
        return undefined;
    const m = text.replace(REORDER_LEAD, "").match(REORDER);
    const [x, y] = [m?.groups?.x?.trim(), m?.groups?.y?.trim()];
    if (!x || !y || x.split(/\s+/).length > 4 || y.split(/\s+/).length > 4 || /\d/.test(`${x}${y}`))
        return undefined;
    const rest = context.order.filter((o) => ![x, y].some((n) => norm(n) === norm(o) || wordsOf(n).some((w) => wordsOf(o).some((v) => sameWord(w, v)))));
    return { order: [x, y, ...rest], ...(context.anchor ? { anchor: context.anchor } : {}), home: context.home, explicit: true, again: true };
}
// ---- reading his day ----
const GENERIC = new Set(["first", "next", "my", "the", "our", "very", "a", "an", "class", "classes", "lecture", "lectures", "session", "today", "last"]);
const WORD_LEN = 3;
const wordsOf = (t) => norm(t).split(" ").filter((w) => w.length >= WORD_LEN);
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= WORD_LEN + 1 && (a.startsWith(b) || b.startsWith(a))) || (Math.min(a.length, b.length) >= 3 && lev(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1) && a[0] === b[0]);
const initials = (title) => norm(title).split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !["lecture", "lab", "class", "for", "and", "the", "seminar", "tutorial"].includes(w)).map((w) => w[0]).join("");
/** Blocks on the day he could mean by this phrase ("marketing class", "lab", "DS"). */
function blocksNamed(phrase, day) {
    const said = norm(phrase).split(" ").filter((w) => w && !GENERIC.has(w));
    if (!said.length)
        return [];
    const long = said.filter((w) => w.length >= WORD_LEN); // "dr" is not evidence of a block; "ds" alone is (its initials)
    return day.blocks.filter((b) => { const t = wordsOf(b.title); return (long.length > 0 && long.every((w) => t.some((x) => sameWord(w, x)))) || (said.length === 1 && said[0].length >= 2 && initials(b.title) === said[0]); });
}
const isClass = (b) => b.kind === "class";
/** The block his "after <phrase>" means: one still going or still ahead, the earliest; else the last that already ended. */
function anchorBlock(phrase, day) {
    const generic = !norm(phrase).split(" ").some((w) => w && !GENERIC.has(w));
    const found = generic ? (/\b(?:class|classes|lecture|lectures)\b/i.test(phrase) ? day.blocks.filter(isClass) : []) : blocksNamed(phrase, day);
    const now = day.now ? toMin(day.now) : -1;
    const ahead = found.filter((b) => toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
    return ahead ?? [...found].sort((a, b) => toMin(b.end) - toMin(a.end))[0];
}
function resolveItem(name, day, facts) {
    const said = wordsOf(name);
    const anchorOf = facts.anchors.find((a) => { const w = wordsOf(a.title); return said.length > 0 && said.every((x) => w.some((y) => sameWord(x, y))); });
    const now = day.now ? toMin(day.now) : -1;
    const onDay = blocksNamed(name, day).sort((a, b) => Number(toMin(b.end) > now) - Number(toMin(a.end) > now) || toMin(a.start) - toMin(b.start))[0];
    if (onDay && (onDay.fixed || isClass(onDay)))
        return { say: "cannot", text: `${onDay.title.replace(/\s+—.*$/, "")} is a class or a plan with people, so it doesn't move. I haven't changed anything.` };
    // A daily anchor keeps its own length (Gym is 90 minutes), however short today's block was squeezed.
    const minutes = anchorOf?.minutes ?? (onDay ? toMin(onDay.end) - toMin(onDay.start) : undefined);
    const title = onDay?.title ?? anchorOf?.title;
    if (!title || !minutes)
        return { say: "ask", text: `${name.replace(/^./, (c) => c.toUpperCase())} isn't on your day, so I haven't changed anything. How many minutes should it be? I'll put it first.` };
    if (minutes < 5 || minutes > 720)
        return { say: "ask", text: `${title} is ${minutes} minutes on your day, which I won't place by myself. Tell me how long it should be. I haven't changed anything.` };
    const over = onDay && !anchorOf && now >= 0 && toMin(onDay.end) <= now ? onDay : undefined; // a block of his own that is already over today
    return { item: { title: title.replace(/,/g, " ").replace(/\s+/g, " ").trim(), minutes }, ...(over ? { over } : {}) };
}
/** The first start at or after `from` where `minutes` clear every class and plan with people (the last class's trip home included), and the first thing that pushed it. */
function fitAround(from, minutes, day, facts) {
    const fixed = day.blocks.filter((b) => b.fixed).sort((a, b) => toMin(a.start) - toMin(b.start));
    let t = from;
    let because;
    for (let moved = true; moved;) {
        moved = false;
        for (const f of fixed) {
            if (toMin(f.end) <= t || toMin(f.start) >= t + minutes + facts.bufferMinutes)
                continue;
            const lastClass = isClass(f) && !fixed.some((o) => isClass(o) && toMin(o.start) >= toMin(f.end));
            t = toMin(f.end) + facts.bufferMinutes + (lastClass ? facts.commuteMinutes : 0);
            because ??= f.title.replace(/\s+—.*$/, "");
            moved = true;
        }
    }
    return { start: t, ...(because ? { because } : {}) };
}
const ampm = (m) => { const h = Math.floor(m / 60) % 24; return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** His reschedule with an order as one `orion-reschedule day` call, what to say instead, or undefined (not this shape: the form decides). */
export function planDayReplan(message, day, context) {
    // A follow-up ("actually do resume before gym") reorders the last request he made, from the same anchor.
    const reorder = context ? parseReorder(message, context) : undefined;
    const ask = reorder ?? parseReplanRequest(message);
    if (!ask)
        return undefined;
    const facts = day.plan ?? DEFAULT_FACTS;
    const now = day.now ? toMin(day.now) : null;
    const items = [];
    const over = [];
    for (const name of ask.order) {
        const r = resolveItem(name, day, facts);
        if ("say" in r)
            return ask.explicit ? r : undefined;
        // A thing of his that is already over today: said plainly, and left out unless he is reordering ("do resume before gym" books it again).
        if (r.over && !ask.again) {
            over.push(r.over);
            continue;
        }
        if (!items.some((i) => norm(i.title) === norm(r.item.title)))
            items.push(r.item);
    }
    if (!items.length)
        return over.length ? { say: "ask", text: `${over.map((b) => `${b.title} was ${span(toMin(b.start), toMin(b.end))}`).join(" and ")}, already done? I haven't changed anything. Say "add ${over[0].title}" and when, if you want another one.` } : undefined;
    // Where it starts: the end of the block he names (plus the trip home when he says home, or when it is his last class), else the trip home from his last class, else now.
    const classes = day.blocks.filter(isClass);
    const named = ask.anchor ? anchorBlock(ask.anchor, day) : undefined;
    if (ask.anchor && !named)
        return !ask.explicit ? undefined : { say: "ask", text: `I don't see "${ask.anchor}" on your day, so I haven't changed anything. Which block should it come after?` };
    const lastClass = [...classes].sort((a, b) => toMin(b.end) - toMin(a.end))[0];
    const anchorEnd = named ? toMin(named.end) : ask.home ? (lastClass ? toMin(lastClass.end) : undefined) : undefined;
    const lastOfClasses = !!named && isClass(named) && !classes.some((c) => c !== named && toMin(c.start) >= toMin(named.end));
    const trip = ask.home || lastOfClasses;
    let earliest;
    if (anchorEnd !== undefined)
        earliest = anchorEnd + (trip ? facts.commuteMinutes : 0) + facts.bufferMinutes;
    else if (lastClass && now !== null && toMin(lastClass.end) > now)
        earliest = toMin(lastClass.end) + facts.commuteMinutes + facts.bufferMinutes;
    else
        earliest = 0;
    if (now === null && anchorEnd === undefined)
        return undefined;
    const wanted = Math.max(earliest, now !== null ? ceil5(now) : 0);
    const { start, because } = fitAround(wanted, items[0].minutes, day, facts);
    if (start + items[0].minutes > 1440)
        return { say: "cannot", text: `${items[0].title} wouldn't finish before midnight if it came first at ${ampm(start)}, so I haven't changed anything.` };
    const via = named ? `after your ${norm(ask.anchor ?? "").replace(/\b(?:my|the|our)\s+/g, "") || "class"}${trip ? " and the trip home" : ""}` : trip ? "after the trip home" : "from now";
    // Every thing he ordered gets its own time (the one before it ends + the gap), so nothing else on the day can slip in between them.
    let at = start;
    const plans = items.flatMap((it) => { const arg = ["--plan", `${it.title}, ${it.minutes}, ${hhmm(at)}`]; at += it.minutes + facts.bufferMinutes; return arg; });
    return { args: ["day", ...plans, ...(ask.again ? ["--again"] : [])], start: hhmm(start), items, via, ask, over, ...(because ? { pushed: { wanted: hhmm(wanted), because } } : {}) };
}
const span = (a, b) => {
    const [x, y] = [ampm(a), ampm(b)];
    return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
};
const clockWords = (t) => ampm(toMin(t));
/** What the scheduler said that Nick must hear, in plain words (a block that did not fit, was skipped, shrunk, shifted or came off). */
function notesFrom(outputs, after, plan) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const notes = [];
    let m;
    const onDay = (title) => after.blocks.some((b) => norm(b.title) === norm(title));
    for (const l of lines) {
        if ((m = l.match(/^SHIFTED: (.+?) could not go at (\d\d:\d\d) \((.+?) is there\) — booked (\d\d:\d\d) instead/)))
            notes.push(`${m[1]} couldn't go at ${clockWords(m[2])} because ${m[3]} is there, so it's at ${clockWords(m[4])}`);
        else if ((m = l.match(/^(?:MUST-HAVE )?NOT BOOKED: (.+?) \(\d+ min\)/)))
            notes.push(`${m[1]} didn't fit and is not booked`);
        else if ((m = l.match(/^SKIPPED OPTIONAL: (.+?) \(\d+ min\)/)))
            notes.push(`${m[1]} was skipped, there was no room`);
        else if ((m = l.match(/^DROPPED \(.*?\): (.+)$/)))
            notes.push(`${m[1]} came off your day`);
        else if ((m = l.match(/^SHRUNK to fit: (.+?) (\d+) → (\d+) min/)))
            notes.push(`${m[1]} is shorter now, ${m[3]} minutes instead of ${m[2]}`);
        else if ((m = l.match(/^CLASH: (.+?) — /)))
            notes.push(`${m[1]}, so check it`);
        else if ((m = l.match(/^cleared \d+ prior schedule blocks?: (.+)$/))) {
            const gone = m[1].split(", ").filter((t) => !onDay(t) && !plan.items.some((i) => norm(i.title) === norm(t)));
            if (gone.length)
                notes.push(`${gone.join(", ")} came off your day`);
        }
    }
    return [...new Set(notes)];
}
/** What he is told: the movable blocks from his first thing onward, in order, with times, read back from the day as it now stands, then what did not go as asked. */
export function replanReply(day, plan, outputs = []) {
    const from = toMin(plan.start);
    const list = day.blocks.filter((b) => !b.fixed && toMin(b.start) >= from).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!list.length)
        return "";
    const first = plan.items[0].title;
    const parts = list.slice(0, 6).map((b, i) => `${i === 0 ? "" : "then "}${b.title} ${span(toMin(b.start), toMin(b.end))}`);
    const placed = list.find((b) => norm(b.title) === norm(first));
    const notes = [
        ...plan.over.map((b) => `${b.title} was ${span(toMin(b.start), toMin(b.end))}, already done? Say "add ${b.title} after ${first}" if you want another one`),
        ...(plan.pushed ? [`${first} couldn't go first at ${clockWords(plan.pushed.wanted)} because ${plan.pushed.because} is in the way, so it's the first thing after that`] : []),
        ...(placed && !plan.pushed && toMin(placed.start) !== from ? [`${first} didn't land first at ${clockWords(plan.start)}, it's at ${ampm(toMin(placed.start))}`] : []),
        ...notesFrom(outputs, day, plan).filter((n) => !(plan.pushed && n.startsWith(`${first} couldn't go`))),
    ];
    return `${plan.pushed ? "Done, but not as asked" : "Done"}, ${plan.via}: ${parts.join(", ")}.${notes.length ? ` ${notes.map((n) => n.replace(/^./, (c) => c.toUpperCase())).join(". ")}.` : ""}`;
}
