import { noteOf } from "./scheduler-out.js";
import { readDayRequest, runDayRequest, whyNot, yesterdayOf } from "./day-requests.js";
const clean = (m) => m.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
const QUESTION = /\?\s*$|^(?:(?:so|ok|hey|orion|wait)[,\s]+)*(?:do|did|does|is|are|am|was|were|have|has|will|should|can|could|what|when|why|how)\b/i;
// Not a fact about his day: a condition, a wish, or someone else's ("she didnt go to the gym").
const NOT_ME = /\b(?:if|unless|wish|hope|maybe|might|whether|pretend|imagine|what if|she|he|mom|mum|dad|my (?:friend|roommate|flatmate|sister|brother))\b/i;
// "cancel the leave reminders" is what the fact already does, not another change.
const REMINDERS_OFF = /\b(?:cancel|stop|turn off|no more)\s+(?:the\s+|my\s+|all\s+)?(?:leave\s+|class\s+)?(?:reminders?|nudges?|alerts?|notifications?|pings?)\b/gi;
const CLASS_WORD = "(?:class(?:es)?|lectures?|seminars?|tutorials?|recitations?)";
const GENERIC_NO = new RegExp(`\\b(?:no|don'?t have(?: any)?|dont have(?: any)?|do not have(?: any)?|haven'?t got(?: any)?|there(?:'s| is| are) no)\\s+(?:more\\s+)?${CLASS_WORD}\\b(?!\\s+(?:until|till|til|before|after|for)\\b)`, "i");
const CANCELLED = /\b([a-z0-9']+?)(?:'s|\s+is|\s+are|\s+was|\s+got|\s+has been|\s+have been|'re)\s+(?:been\s+)?(?:cancell?ed|canceled|called off)\b/i;
const BOTH_CANCELLED = /\b(?:both|they)(?:'re|\s+are|\s+were|\s+got)?\s+(?:both\s+)?cancell?ed\b/i;
const NAMED_NO = /\b(?:no|don'?t have|dont have|do not have)\s+([a-z0-9]+)(?:\s+(?:and|or)\s+(?:no\s+)?([a-z0-9]+))?\s+(?:class(?:es)?\s+|lectures?\s+)?(?:today|tomorrow|tmrw)\b/i;
const KEEP = /\bi (?:still|do) have (?:my |the |a )?([a-z0-9]+)/i;
const FILL = /\b(?:use (?:the|that) time|fill (?:the|that|my) (?:time|gaps?|day)|plan (?:the|my) (?:free )?time)\b/i;
const OTHER_CHANGE = /\b(?:put|add|book|schedule|reschedule|move|push|pull|swap|plan|remind|cancel the|delete|drop|extend|shorten|make it (?:an?|\d|longer|shorter|later|earlier))\b/i;
const NOT_A_NAME = new Set(["class", "classes", "lecture", "lectures", "time", "idea", "plans", "plan", "way", "one", "clue", "reason", "need", "school", "work", "more", "the", "my", "any", "gym", "both", "they", "it", "all", "that", "this", "everything", "anything"]);
const MISSED = /\b(?:i\s+)?(?:didn'?t|didnt|did not|never)\s+(?:go|make it|get|went)\s+(?:to\s+)?(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ]{1,30}?)(?=\s*(?:today|this morning|this afternoon|tonight|earlier|lol|tbh|btw|[,.!]|$))/i;
const SKIPPED = /^(?:(?:so|ok|yeah|ya|btw|fyi|honestly|ugh)[,\s]+)*(?:i\s+)?(?:skipped|missed|bailed on|ditched)\s+(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ]{1,30}?)(?=\s*(?:today|this morning|this afternoon|tonight|earlier|lol|tbh|btw|[,.!]|$))/i;
const INSTEAD_NOW = /\b(?:i'?m|im|i am)\s+(?:doing|working on|studying|at|going to|gonna do|just doing)\s+(?:the\s+|my\s+|some\s+)?(.+?)\s+instead(?:\s+of\s+(?:the\s+|my\s+)?(.+?))?\s*(?:right now|rn|now)?\s*[.!]*$/i;
const INSTEAD_PAST = /\b(?:i\s+)?(?:did|went to|went|worked on|studied|had|ended up doing)\s+(?:the\s+|my\s+|some\s+)?(.+?)\s+instead\s+of\s+(?:the\s+|my\s+)?(.+?)\s*[.!]*$/i;
const ATE = /^(?:(?:ok|so|yeah|ya|btw|fyi|just|already)[,\s]+)*(?:i\s+)?(?:already\s+|just\s+)?(?:ate|eaten|had (?:lunch|dinner|breakfast|food|something to eat))\b|^(?:i'?ve|ive)\s+(?:already\s+|just\s+)?(?:eaten|had (?:lunch|dinner|breakfast|food))\b|\bate already\b/i;
const PLACE = /^(?:(?:ok|so|fyi|btw|hey|orion|yeah)[,\s]+)*(?:i'?m|im|i am)\s+(?:at|in)\s+(?:the\s+)?(library|gym|home|campus|uni|university|school|office|work|cafe|coffee shop|[a-z]+'s(?: place| house| flat)?)\s*(?:now|rn|right now|already)?\s*[.!]*$/i;
const OVERRUN = /\b((?:my |the )?[a-z0-9]+)(?:'s|\s+is|\s+has been)\s+(?:running|going|dragging)\s+(?:(\d{1,3})\s*(?:min|mins|minutes)\s+)?(?:over|long|late)\b/i;
// 2026-10-31 gate (rea-task-twice-v/c): "this econ set is taking forever", "econ problem set needs another hour, push whatever is after it".
const TAKING = /\b(?:the |this |my )?([a-z][a-z0-9 ]{1,30}?)\s+(?:is|'s)\s+taking\s+(?:forever|ages|so long|way longer|longer(?: than (?:i )?(?:thought|expected|planned))?|a while|too long)\b/i;
const NEEDS_MORE = /\b(?:the |this |my )?([a-z][a-z0-9 ]{1,30}?)\s+needs\s+(?:another|an extra|one more|(\d{1,3}) more)\s*(hour|hr|(?:\d{1,3}\s*)?(?:min|mins|minutes))?\b|\bi need (?:another|an extra|one more) (hour|(?:\d{1,3}\s*)?(?:min|mins|minutes)) (?:on|for|of) (?:the |my )?([a-z][a-z0-9 ]{1,30}?)(?=\s*(?:,|\.|!|$|and|then))/i;
export const TAKING_GUESS_MIN = 45;
const lengthOf = (t) => (!t ? undefined : /^(?:hour|hr)$/.test(t) ? 60 : Number(/\d+/.exec(t)?.[0] ?? NaN) || undefined);
// ---- "it's done": a block he finished, a nap he took (2026-10-31 gate, rea-took-longer-gym-v/c, rea-spontaneous-nap-v/c) ----
const CLK = String.raw `(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`;
const DONE_TIMES = new RegExp(String.raw `\b(?:was|from|went)\s+${CLK}\s*(?:to|till|until|-|–)\s*${CLK}`, "i");
const BACK_FROM = /\b(?:just\s+)?(?:got\s+|came\s+|am\s+|i'?m\s+|im\s+)?back from (?:the\s+|my\s+)?([a-z][a-z0-9 ]{1,25}?)(?=\s*(?:,|\.|!|$|lol|now|early|late|finally|and))/i;
const IS_DONE = /^(?:(?:ok(?:ay)?|so|yeah|ya|btw|fyi|right)[,\s]+)*(?:the\s+|my\s+)?([a-z][a-z0-9 ]{1,25}?)(?:\s+is|'s|\s+was)?\s+(?:done|finished|complete|completed|over)\b(?!\s+(?:at|by)\b)/i;
const FINISHED = /\b(?:i\s+)?(?:just\s+)?(?:finished|done with|wrapped up)\s+(?:the\s+|my\s+)?([a-z][a-z0-9 ]{1,25}?)(?=\s*(?:,|\.|!|$|lol|now|early|and))/i;
const NAP = /\b(?:took|had|did|just had)\s+(?:a\s+)?(?:quick\s+|little\s+|long\s+)?nap\b|\bnapped\b|\bwoke up from (?:a|my) nap\b|\bfell asleep\b/i;
const SLEPT = new RegExp(String.raw `\bi\s+(?:slept|napped|was asleep|passed out)\s+from\s+${CLK}\s*(?:to|till|until|-|–)\s*${CLK}`, "i");
const PLAN_REST = /\b(?:plan|redo|rebuild|replan|re-?do|fix|sort(?: out)?|reshuffle|rework)\s+(?:out\s+)?(?:my|the)\s+(?:evening|night|afternoon|rest of (?:the|my) day|rest of (?:today|tonight)|day)\b|\bfrom now\b/i;
const NOT_DONE_THING = /^(?:i|im|i'm|it|that|this|we|you|everything|all|day|today|my day|session|focus|the session|it all|mine|one|nap|class|the class)$/;
// REV2 finding 2: "i just finished my coffee" captured "i just" as the thing done. A capture with a pronoun or an adverb is not a block name.
const PRONOUN_OR_ADVERB = /\b(?:i|im|i'm|me|we|you|he|she|they|it|its|it's|this|that|just|really|finally|already|actually|totally|basically|literally|so|now)\b/;
const NOT_A_PLACE = /^(?:home|library|uni|campus|work|school|bed|my room|office|cafe|town)$/;
const ATTENDED = /\bi (?:was|went|did go|made it)\s+(?:literally\s+|actually\s+|totally\s+|definitely\s+)?(?:in|at|to)\s+(?:the\s+|my\s+)?([a-z][a-z0-9 ]{1,25}?)(?=\s*(?:class|lecture|today|lol|tho|though|,|\.|!|$|fix|but|so|the whole))/i;
const SAID_MISSED = /\byou (?:said|thought|marked|logged)\s+(?:that\s+)?i (?:missed|skipped|didn'?t (?:go to|make it to|go))\s+(?:the\s+|my\s+)?([a-z0-9]+)/i;
const WAS_THERE = /\b(?:i was there|i went|i was in (?:it|class)|i attended|i did go)\b/i;
function readDone(m) {
    const slept = SLEPT.exec(m);
    if (slept)
        return { kind: "done", what: "nap", from: slept[1], to: slept[2], fill: PLAN_REST.test(m) };
    if (NAP.test(m))
        return { kind: "done", what: "nap", fill: PLAN_REST.test(m) };
    const hit = BACK_FROM.exec(m) ?? IS_DONE.exec(m) ?? FINISHED.exec(m);
    const what = hit?.[1]?.trim().replace(/\s+(?:now|already|finally)$/, "");
    if (!what || NOT_DONE_THING.test(what) || PRONOUN_OR_ADVERB.test(what) || NOT_A_PLACE.test(what) || /\b(?:is|are|was|running|going|dragging|taking|almost|not)\b/.test(what) || /\b(?:not|never|almost|nearly)\b/.test(m.slice(0, hit.index)))
        return null;
    const times = DONE_TIMES.exec(m);
    return { kind: "done", what, ...(times ? { from: times[1], to: times[2] } : {}), fill: PLAN_REST.test(m) };
}
function readAttended(m) {
    const said = SAID_MISSED.exec(m);
    if (said && WAS_THERE.test(m))
        return { kind: "attended", what: said[1] };
    const was = ATTENDED.exec(m);
    if (!was || NOT_A_PLACE.test(was[1].trim()))
        return null;
    const what = was[1].trim();
    // "i was at the gym" is the gym done, not a class attended.
    if (/\bgym\b/.test(what))
        return { kind: "done", what: "gym", fill: PLAN_REST.test(m) };
    return { kind: "attended", what };
}
/** He told ORION something that happened (or is happening), not asked for a change. Null when it is not one. */
export function readReality(message, now = new Date()) {
    const m = clean(message);
    if (!m)
        return null;
    // A calendar request code carries out itself comes first (day-requests.ts): its own reader rules out questions and conditions
    // ("can we do gym later, like after dinner" is a request, not a question).
    const request = readDayRequest(message, now);
    if (request)
        return { reality: { kind: "request", request }, rest: false };
    if (QUESTION.test(m))
        return null;
    if (NOT_ME.test(m.replace(/\bi still have\b.*$/, "")))
        return null;
    const attended = readAttended(m);
    if (attended)
        return { reality: attended, rest: false };
    const more = NEEDS_MORE.exec(m);
    if (more) {
        const what = (more[1] ?? more[5] ?? "").trim();
        const minutes = more[1] ? (more[2] ? Number(more[2]) : lengthOf(more[3]) ?? 60) : lengthOf(more[4]) ?? 60;
        if (what && !NOT_DONE_THING.test(what))
            return { reality: { kind: "overrun", what, minutes }, rest: false };
    }
    const taking = TAKING.exec(m);
    if (taking && !NOT_DONE_THING.test(taking[1].trim()))
        return { reality: { kind: "overrun", what: taking[1].trim(), guess: TAKING_GUESS_MIN }, rest: false };
    const finished = readDone(m);
    if (finished)
        return { reality: finished, rest: false };
    const rest = OTHER_CHANGE.test(m.replace(REMINDERS_OFF, "").replace(/\bcancell?ed\b/g, ""));
    const tomorrow = /\b(?:tomorrow|tmrw)\b/.test(m);
    const named = NAMED_NO.exec(m);
    const cancelled = CANCELLED.exec(m);
    const names = [named?.[1], named?.[2], cancelled?.[1]].filter((w) => !!w && !NOT_A_NAME.has(w) && !new RegExp(`^${CLASS_WORD}$`).test(w));
    if (GENERIC_NO.test(m) || names.length || (BOTH_CANCELLED.test(m) && names.length) || (cancelled && new RegExp(`^${CLASS_WORD}$`).test(cancelled[1] ?? ""))) {
        const keep = KEEP.exec(m)?.[1];
        return { reality: { kind: "no-classes", names: GENERIC_NO.test(m) && !names.length ? [] : [...new Set(names)], ...(keep ? { keep } : {}), tomorrow, fill: FILL.test(m) }, rest: rest && !FILL.test(m) };
    }
    const over = OVERRUN.exec(m);
    if (over && !/^(?:i|im|i'm|it|this|that|time|everything|my day|the day)$/.test(over[1])) {
        const minutes = Number(over[2] ?? /\bby (\d{1,3})\b/.exec(m)?.[1] ?? NaN);
        return { reality: { kind: "overrun", what: over[1].replace(/^(?:my|the)\s+/, ""), ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}) }, rest: false };
    }
    const past = INSTEAD_PAST.exec(m);
    const present = INSTEAD_NOW.exec(m);
    if (present)
        return { reality: { kind: "instead", did: present[1].trim(), ...(present[2] ? { planned: present[2].trim() } : {}), past: false }, rest };
    if (past)
        return { reality: { kind: "instead", did: past[1].trim(), planned: past[2].trim(), past: true }, rest };
    const missed = MISSED.exec(m) ?? SKIPPED.exec(m);
    if (missed && !/\b(?:sleep|bed|enough|it|that|this|there|home|much|far|anything|everything)\b/.test(missed[1] ?? ""))
        return { reality: { kind: "missed", what: missed[1].trim() }, rest };
    if (ATE.test(m))
        return { reality: { kind: "ate" }, rest };
    const place = PLACE.exec(m);
    if (place)
        return { reality: { kind: "place", place: place[1] }, rest };
    return null;
}
// ---- matching his words against the day ----
const words = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** "macro" names "ECON1115 Principles of Macroeconomics", "marketing" names "MKTG2201 Introduction to Marketing". */
export function names(word, title) {
    const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (w.length < 2)
        return false;
    return words(title).some((t) => t === w || (w.length >= 3 && t.startsWith(w)) || (t.length >= 4 && w.startsWith(t)) || (/^[a-z]+\d+$/.test(t) && t.startsWith(w) && w.length >= 2));
}
const matchBlock = (what, blocks) => {
    const ws = words(what).filter((w) => w.length >= 2 && !["the", "my", "a", "to", "of"].includes(w));
    return blocks.filter((b) => ws.length && ws.every((w) => names(w, b.title)))[0] ?? blocks.filter((b) => ws.some((w) => w.length >= 3 && names(w, b.title)))[0];
};
/** "MKTG2201" for "MKTG2201 Introduction to Marketing — Lecture", the title otherwise. */
export const shortTitle = (title) => { const code = /^[A-Z]{2,5}\d{3,5}\b/.exec(title)?.[0]; return code ?? title.split(/\s+[—–-]\s+/)[0].trim(); };
const minuteOf = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const ampm = (t) => { const v = minuteOf(t); const h = Math.floor(v / 60); return `${(h + 11) % 12 + 1}:${String(v % 60).padStart(2, "0")} ${h < 12 || h >= 24 ? "AM" : "PM"}`; };
const listed = (items) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const UNDO = "Say \"undo\" to put it back.";
export const REALITY_SAVE_FAILED = "I couldn't save that just now, so nothing changed. Say it again in a moment.";
async function declare(deps, kind, extra = []) {
    const out = await deps.run("orion-declare", ["add", "--kind", kind, "--text", deps.text.slice(0, 200), "--source", deps.source, ...extra]).catch(() => ({ stdout: "", code: 1 }));
    try {
        const fact = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "");
        return out.code === 0 && typeof fact.id === "string" ? fact.id : null;
    }
    catch {
        return null;
    }
}
const say = (text, calls = [], outputs = []) => ({ outcome: "say", kind: "plain", text, calls, outputs });
const done = (reply, calls, outputs) => ({ outcome: "done", calls, outputs, reply });
const canon = (args) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
/** The "Changed …:" lines a script printed, as plain clauses ("moved Study: 18:00 → 19:00"). */
// REV2 finding 1: a block shrunk or taken off to make room ("SHRUNK to fit", "NOT BOOKED … no longer fits") is a change too.
const changeLines = (stdout) => stdout.split("\n").map((l) => l.trim()).filter((l) => /^(?:moved|bumped|re-entered|logged)\b/.test(l) || / has no room today$/.test(l) || /^(?:SHRUNK to fit|NOT BOOKED|SKIPPED OPTIONAL|SHIFTED):/.test(l));
const clause = (l) => /^[A-Z]{4,}/.test(l) ? noteOf(l)?.[1] ?? l.replace(/\s+[—(].*$/, "") : l.replace(/(\d{1,2}:\d{2})/g, (t) => ampm(t)).replace(/ \(([^)]*)\): lower weight than what it made room for/, " to make room");
async function noClasses(r, deps) {
    const day = await deps.readDay().catch(() => undefined);
    const classes = (day?.blocks ?? []).filter((b) => b.kind === "class");
    const named = r.names.length ? classes.filter((b) => r.names.some((n) => names(n, b.title))) : [];
    // Named words that are no class on that day ("no gym today") are not this statement: the turn goes on as usual.
    // 2026-10-31 gate (sch-no-class-c): "i dont have marketing or macro today, both are cancelled" with neither on the day went to the form,
    // which answered "only 10 minutes between …". Said cancelled, they are classes: that they are not on the day is the answer.
    if (r.names.length && day && !named.length) {
        if (!/\bcancell?ed\b|\bcalled off\b/.test(deps.text.toLowerCase()))
            return null;
        const which = listed(r.names.map((n) => n.replace(/^./, (c) => c.toUpperCase())));
        return { flow: say(`${which} ${r.names.length > 1 ? "aren't" : "isn't"} on ${r.tomorrow ? "tomorrow's" : "today's"} calendar, so there was nothing to cancel and nothing changed.${classes.length ? ` Still on: ${listed(classes.map((b) => shortTitle(b.title)))}.` : ""}`), facts: [], writes: 0 };
    }
    const facts = (r.names.length ? await Promise.all(named.map((b) => declare(deps, "skip", ["--title", b.title, ...(r.tomorrow ? ["--date", dateOf(day, deps.now, 1)] : [])])))
        : [await declare(deps, "no-classes", r.tomorrow ? ["--date", dateOf(day, deps.now, 1)] : [])]).filter((id) => !!id);
    if (!facts.length)
        return { flow: say(REALITY_SAVE_FAILED), facts, writes: 0 };
    const args = ["classes-off", ...(r.names.length ? named.map((b) => shortTitle(b.title)) : []), ...(r.keep ? ["--keep", r.keep] : []), ...(r.tomorrow ? ["--date", "tomorrow"] : [])];
    const off = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const calls = [`exec orion-reschedule ${canon(args)}`];
    const outputs = [off.stdout];
    const day0 = r.tomorrow ? "tomorrow" : "today";
    const cancelled = [...off.stdout.matchAll(/cancelled (.+?) (\d{2}:\d{2})–\d{2}:\d{2}/g)].map((x) => `${shortTitle(x[1])} (${ampm(x[2])})`);
    const kept = r.keep ? classes.filter((b) => names(r.keep, b.title)).map((b) => shortTitle(b.title)) : [];
    const keptLine = kept.length ? ` ${listed(kept)} is still on.` : r.keep ? ` Your ${r.keep} is still on.` : "";
    if (off.code !== 0)
        return { flow: say(`I've noted no classes ${day0}, so there'll be no leave reminders for them, but I couldn't mark them off your calendar just now.${keptLine}`, calls, outputs), facts, writes: 0 };
    if (!cancelled.length)
        return { flow: say(`Noted: no classes ${day0}. There weren't any on your calendar to cancel.${keptLine}`, calls, outputs), facts, writes: 0 };
    let reply = `Got it, no ${r.names.length ? listed(cancelled.map((c) => c.split(" (")[0])) : "classes"} ${day0}. I've marked ${listed(cancelled)} cancelled (still in Apple Calendar), so no leave reminders for ${cancelled.length > 1 ? "them" : "it"}.${keptLine}`;
    let writes = 1;
    if (r.fill && !r.tomorrow) {
        const fill = await deps.run("orion-reschedule", ["fill"]).catch(() => ({ stdout: "", code: 1 }));
        calls.push("exec orion-reschedule fill");
        outputs.push(fill.stdout);
        const placed = fill.stdout.split("\n").map((l) => l.trim()).filter((l) => /^(?:added|placed|booked|\+)/i.test(l) || /\d{2}:\d{2}–\d{2}:\d{2}/.test(l)).slice(0, 4);
        if (fill.code === 0 && !/NOTHING WAS/.test(fill.stdout)) {
            writes += 1;
            reply += placed.length ? ` In the free time: ${placed.map(clause).join("; ")}.` : " I filled the free time.";
        }
        else
            reply += " I couldn't fill the free time just now.";
    }
    return { flow: done(`${reply} Say "undo" to put ${cancelled.length > 1 ? "them" : "it"} back.`, calls, outputs), facts, writes };
}
const dateOf = (day, now, plus) => {
    const d = new Date(now.getTime() + plus * 86400_000);
    return day?.date && plus === 0 ? day.date : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function missed(r, deps) {
    const day = await deps.readDay().catch(() => undefined);
    const block = matchBlock(r.what, day?.blocks ?? []);
    const title = block?.title ?? r.what;
    const id = await declare(deps, "skip", ["--title", title]);
    if (!id)
        return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
    const count = (deps.slipsOf?.(block?.kind ?? r.what) ?? 0) + 1;
    const pattern = count >= 3 ? ` That's the ${ORD[count] ?? `${count}th`} ${block?.kind === "gym" || /gym/i.test(title) ? "gym " : ""}skip this week.` : "";
    const now = deps.now.getHours() * 60 + deps.now.getMinutes();
    if (!block)
        return { flow: say(`Noted: no ${r.what} today. It isn't on your calendar, so nothing there changed.${pattern}`), facts: [id], writes: 0 };
    if (block.fixed)
        return { flow: say(`Noted: you missed ${shortTitle(title)} today, so I won't count it as attended.${pattern} If you want catch-up time for it, tell me when.`), facts: [id], writes: 0 };
    if (minuteOf(block.start) > now) {
        const args = ["drop", block.title];
        const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
        const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
        return { flow: ok ? done(`Okay, ${shortTitle(title)} is off today; I took the ${ampm(block.start)} block off your calendar.${pattern} ${UNDO}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout])
                : say(`Noted: no ${shortTitle(title)} today, but I couldn't take its ${ampm(block.start)} block off your calendar.${pattern}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout]), facts: [id], writes: ok ? 1 : 0 };
    }
    const args = ["displace", block.title, "--why", "skip"];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
    const moved = changeLines(out.stdout).map(clause);
    return { flow: ok ? done(`Okay, ${shortTitle(title)} didn't happen; it's off its ${ampm(block.start)} slot${moved.length ? ` and I re-weighed the rest: ${moved.join("; ")}` : ""}.${pattern} ${UNDO}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout])
            : say(`Noted: ${shortTitle(title)} didn't happen, but I couldn't take it off your calendar just now.${pattern}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout]), facts: [id], writes: ok ? 1 : 0 };
}
async function instead(r, deps) {
    const day = await deps.readDay().catch(() => undefined);
    if (!day)
        return { flow: say("I couldn't read your calendar just now, so nothing changed. Tell me again in a moment."), facts: [], writes: 0 };
    const now = deps.now.getHours() * 60 + deps.now.getMinutes();
    const current = day.blocks.filter((b) => b.kind !== "commute" && minuteOf(b.start) <= now && now < minuteOf(b.end))[0];
    const planned = r.planned ? matchBlock(r.planned, day.blocks) : current;
    if (!planned)
        return r.planned ? { flow: say(`${r.planned} isn't on your calendar today, so there was nothing to replace. Nothing changed.`), facts: [], writes: 0 } : null;
    const id = await declare(deps, "skip", ["--title", planned.title]);
    if (!id)
        return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
    const [ps, pe] = [minuteOf(planned.start), minuteOf(planned.end)];
    // Past: he did X in Y's slot. Now: X from Y's start (or now, when Y is still ahead) for Y's length; log takes up to 3 h ahead.
    const from = r.past || ps <= now ? ps : now;
    const to = Math.min(r.past ? Math.min(pe, now) : from + (pe - ps), now + 180);
    if (to - from < 5)
        return { flow: say(`Noted that you're doing ${r.did} instead of ${shortTitle(planned.title)}, but ${shortTitle(planned.title)} hasn't started, so I left the calendar alone.`), facts: [id], writes: 0 };
    const calls = [];
    const outputs = [];
    let writes = 0;
    if (planned.fixed && planned.kind === "class") {
        const off = await deps.run("orion-reschedule", ["classes-off", shortTitle(planned.title)]).catch(() => ({ stdout: "", code: 1 }));
        calls.push(`exec orion-reschedule classes-off ${shortTitle(planned.title)}`);
        outputs.push(off.stdout);
        if (off.code === 0 && /cancelled/.test(off.stdout))
            writes += 1;
    }
    const args = ["log", r.did, "--from", hhmm(from), "--to", hhmm(to), ...(planned.fixed ? [] : ["--instead", planned.title])];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    calls.push(`exec orion-reschedule ${canon(args)}`);
    outputs.push(out.stdout);
    const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
    if (!ok) {
        const why = whyNot(out.stdout);
        return { flow: say(`I couldn't put ${r.did} in place of ${shortTitle(planned.title)}${why ? ` (${why.replace(/(\d{2}:\d{2})/g, (t) => ampm(t))})` : ""}, so your calendar is as it was${writes ? `, apart from marking ${shortTitle(planned.title)} cancelled. ${UNDO}` : "."}`, calls, outputs), facts: [id], writes };
    }
    writes += 1;
    const moved = changeLines(out.stdout).filter((l) => !/^logged\b/.test(l)).map(clause);
    return { flow: done(`Done: ${r.did} ${ampm(hhmm(from))}–${ampm(hhmm(to))} is on your calendar in place of ${shortTitle(planned.title)}${moved.length ? `, and the rest of today is re-weighed: ${moved.join("; ")}` : ""}. ${UNDO}`, calls, outputs), facts: [id], writes };
}
export const OVERRUN_GUESS_MIN = 15;
async function overrun(r, deps) {
    const day = await deps.readDay().catch(() => undefined);
    const block = matchBlock(r.what, (day?.blocks ?? []).filter((b) => b.kind !== "commute"));
    if (!block)
        return null; // "this set is running long" names no block: the turn goes on
    const minutes = r.minutes ?? r.guess ?? OVERRUN_GUESS_MIN;
    // His own block running long is an extend (the scheduler's overrun is for a class): what comes after it slides (rea-class-late, rea-task-twice).
    if (!block.fixed)
        return extendOwn(block, minutes, !r.minutes, deps);
    const args = ["overrun", String(minutes), "--what", shortTitle(block.title)];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const calls = [`exec orion-reschedule ${canon(args)}`];
    const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
    const guess = r.minutes ? "" : ` (my guess is ${minutes} minutes; tell me if it's longer)`;
    if (!ok)
        return { flow: say(`${shortTitle(block.title)} running over: I couldn't move what's after it just now, so your plan is as it was.`, calls, [out.stdout]), facts: [], writes: 0 };
    const moved = changeLines(out.stdout).map(clause);
    return { flow: done(`Okay, ${shortTitle(block.title)} is running over: I pushed what's after it back ${minutes} minutes${guess}${moved.length ? `: ${moved.slice(0, 4).join("; ")}` : ""}. ${shortTitle(block.title)} itself stays as it is. ${UNDO}`, calls, [out.stdout]), facts: [], writes: 1 };
}
async function extendOwn(block, minutes, guessed, deps) {
    const args = ["extend", block.title, String(minutes)];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const calls = [`exec orion-reschedule ${canon(args)}`];
    const name = shortTitle(block.title);
    if (out.code !== 0 || /NOTHING WAS/.test(out.stdout)) {
        const why = whyNot(out.stdout);
        return { flow: say(`I couldn't give ${name} more time just now${why ? ` (${why})` : ""}, so your plan is as it was.`, calls, [out.stdout]), facts: [], writes: 0 };
    }
    const moved = changeLines(out.stdout).map(clause);
    const guess = guessed ? ` (my guess is ${minutes} minutes more; tell me if it needs longer)` : "";
    return { flow: done(`Okay, ${name} now runs until ${ampm(hhmm(minuteOf(block.end) + minutes))}${guess}${moved.length ? `, and what's after it moved: ${moved.slice(0, 4).join("; ")}` : ""}. ${UNDO}`, calls, [out.stdout]), facts: [], writes: 1 };
}
/** "5:30", "7", "3:30pm" said about something already done today: the latest reading at or before now (a bare 7 at 19:20 is 19:00). */
function pastClock(said, now) {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(said.trim());
    if (!m)
        return null;
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h > 23 || min > 59)
        return null;
    if (m[3])
        return (h % 12) * 60 + (m[3] === "pm" ? 720 : 0) + min;
    if (h >= 13)
        return h * 60 + min;
    const options = [(h % 12) * 60 + min, (h % 12) * 60 + min + 720].filter((v) => v <= now + 15);
    return options.length ? Math.max(...options) : (h % 12) * 60 + min;
}
const NAP_GUESS_MIN = 45;
/** He did it (or slept): it goes on the calendar as what really happened (log), replacing the planned block, and the rest is re-weighed. */
async function doneIt(r, deps) {
    const now = deps.now.getHours() * 60 + deps.now.getMinutes();
    const day = await deps.readDay().catch(() => undefined);
    if (!day)
        return { flow: say("I couldn't read your calendar just now, so nothing changed. Tell me again in a moment."), facts: [], writes: 0 };
    const nap = r.what === "nap";
    const blocks = day.blocks.filter((b) => b.kind !== "commute");
    const block = nap ? blocks.find((b) => /\b(?:nap|sleep|rest)\b/i.test(b.title) && minuteOf(b.start) <= now) : matchBlock(r.what, blocks);
    // Before 5 AM "the gym" he just did may be last night's: then it is noted, since the scheduler only rewrites today.
    if (!block && !nap && deps.now.getHours() < 5 && deps.readDayOn) {
        const last = await deps.readDayOn(["--date", yesterdayOf(deps.now)]).catch(() => undefined);
        const y = matchBlock(r.what, last?.blocks ?? []);
        if (y) {
            const id = await declare(deps, "note", ["--title", y.title, "--date", yesterdayOf(deps.now)]);
            return { flow: say(id ? `Nice, noted: ${shortTitle(y.title)} done last night. It's after midnight, so yesterday's calendar stays as it was.` : REALITY_SAVE_FAILED), facts: id ? [id] : [], writes: 0 };
        }
    }
    // REV2 finding 2: "the movie is over" / "dinner is done" with no such block planned is not his day to rewrite: nothing is logged (gym, his daily anchor, still is).
    if (!block && !nap && !/\bgym\b/.test(r.what))
        return { flow: say(`Nice. ${r.what.replace(/^./, (c) => c.toUpperCase())} isn't on today's plan, so I left your calendar alone. Tell me the times if you want it on there.`), facts: [], writes: 0 };
    if (block?.fixed) {
        const id = await declare(deps, "note", ["--title", block.title]);
        return { flow: say(id ? `Noted: ${shortTitle(block.title)} done.` : REALITY_SAVE_FAILED), facts: id ? [id] : [], writes: 0 };
    }
    const title = block?.title ?? (nap ? "Nap" : r.what.replace(/^./, (c) => c.toUpperCase()));
    const len = block ? minuteOf(block.end) - minuteOf(block.start) : nap ? NAP_GUESS_MIN : 60;
    const saidFrom = r.from ? pastClock(r.from, now) : null;
    const saidTo = r.to ? pastClock(r.to, now) : null;
    // Times he gave win; else it ended just now and lasted the planned length (said back as the assumption).
    // With no times, a planned block that already started began as planned (so the log covers it whole and no sliver of the plan is left),
    // capped at 3 hours; anything else lasted its usual length.
    const plannedStart = block && !nap && minuteOf(block.start) < now && now - minuteOf(block.start) <= 180 ? minuteOf(block.start) : undefined;
    let to = saidTo ?? now;
    let from = saidFrom ?? plannedStart ?? to - len;
    if (saidFrom !== null && saidTo === null)
        to = Math.max(saidFrom + 5, now);
    if (from >= to)
        from = to - len;
    from = Math.max(240, from);
    const assumed = saidFrom === null ? (nap ? ` (I assumed about ${NAP_GUESS_MIN} minutes, ending now; tell me if it was longer)` : plannedStart !== undefined ? ` (I assumed it started at ${ampm(block.start)} as planned and ended just now; tell me the times if not)` : " (I assumed it ended just now; tell me the times if not)") : "";
    const ahead = block && minuteOf(block.start) > now;
    const args = ["log", title, "--from", hhmm(from), "--to", to >= now ? "now" : hhmm(to), ...(block && !ahead ? ["--instead", block.title] : [])];
    const calls = [];
    const outputs = [];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    calls.push(`exec orion-reschedule ${canon(args)}`);
    outputs.push(out.stdout);
    if (out.code !== 0 || /NOTHING WAS/.test(out.stdout)) {
        const why = whyNot(out.stdout);
        return { flow: say(`I couldn't log ${shortTitle(title)} just now${why ? ` (${why})` : ""}, so your calendar is as it was.`, calls, outputs), facts: [], writes: 0 };
    }
    let writes = 1;
    if (ahead) {
        const drop = await deps.run("orion-reschedule", ["drop", block.title]).catch(() => ({ stdout: "", code: 1 }));
        calls.push(`exec orion-reschedule drop ${canon([block.title])}`);
        outputs.push(drop.stdout);
        if (drop.code === 0 && !/NOTHING WAS/.test(drop.stdout))
            writes += 1;
    }
    const moved = changeLines(out.stdout).filter((l) => !/^logged\b/.test(l)).map(clause);
    let reply = `${nap ? "Logged your nap" : `Nice, ${shortTitle(title)} done`}: ${ampm(hhmm(from))}–${ampm(hhmm(to))}${assumed}.${moved.length ? ` The rest of today moved: ${moved.slice(0, 4).join("; ")}.` : ""}`;
    if (r.fill) {
        const fill = await deps.run("orion-reschedule", ["fill"]).catch(() => ({ stdout: "", code: 1 }));
        calls.push("exec orion-reschedule fill");
        outputs.push(fill.stdout);
        const placed = fill.stdout.split("\n").map((l) => l.trim()).filter((l) => /^(?:added|placed|booked|planned)\b/i.test(l)).slice(0, 4).map(clause);
        if (fill.code === 0 && !/NOTHING WAS/.test(fill.stdout) && !/^Nothing to add/m.test(fill.stdout)) {
            writes += 1;
            reply += placed.length ? ` From now: ${placed.join("; ")}.` : " I planned the rest of the day from now.";
        }
        else
            reply += /^Nothing to add/m.test(fill.stdout) ? " The rest of the day already has what it needs." : " I couldn't plan the rest of the day just now.";
    }
    return { flow: done(`${reply} ${UNDO}`, calls, outputs), facts: [], writes };
}
/** "i was in marketing": the missed mark ORION made is taken back, and that he was there is noted. */
async function attendedIt(r, deps) {
    const day = await deps.readDay().catch(() => undefined);
    const block = matchBlock(r.what, day?.blocks ?? []);
    const name = block ? shortTitle(block.title) : r.what;
    const listedFacts = await deps.run("orion-declare", ["list"]).catch(() => ({ stdout: "", code: 1 }));
    let facts = [];
    try {
        const parsed = JSON.parse(listedFacts.stdout.trim().split("\n").at(-1) ?? "[]");
        facts = Array.isArray(parsed) ? parsed : Array.isArray(parsed.facts) ? parsed.facts : [];
    }
    catch {
        facts = [];
    }
    const wrong = facts.filter((f) => f.kind === "skip" && typeof f.id === "string" && (names(r.what, f.title ?? "") || (block && f.title === block.title)));
    const calls = ["exec orion-declare list"];
    const outputs = [listedFacts.stdout];
    for (const f of wrong) {
        const out = await deps.run("orion-declare", ["remove", "--id", f.id]).catch(() => ({ stdout: "", code: 1 }));
        calls.push(`exec orion-declare remove --id ${f.id}`);
        outputs.push(out.stdout);
    }
    const id = await declare(deps, "note", ["--title", block?.title ?? r.what]);
    if (!id && !wrong.length)
        return { flow: say(REALITY_SAVE_FAILED, calls, outputs), facts: [], writes: 0 };
    const text = wrong.length ? `Sorry, my mistake. ${name} counts as attended today; I took back the missed mark.` : `Got it, you were at ${name}. Noted as attended, so nothing counts it as missed.`;
    return { flow: say(text, calls, outputs), facts: id ? [id] : [], writes: 0 };
}
async function noted(r, deps, next) {
    const id = await declare(deps, r.kind, r.kind === "place" ? ["--place", r.place] : []);
    if (!id)
        return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
    const text = r.kind === "ate" ? "Good, noted you've eaten. I won't chase you about food." : `Got it, you're at ${/^(home|work|campus|uni|school)$/.test(r.place) ? r.place : `the ${r.place}`}.`;
    return { flow: say(`${text}${next ? ` ${next}` : ""}`), facts: [id], writes: 0 };
}
/** Carries out what he said, with no model. Null: the words were not a reality statement after all (the turn goes on). */
export async function runReality(read, deps) {
    const r = read.reality;
    if (r.kind === "no-classes")
        return noClasses(r, deps);
    if (r.kind === "missed")
        return missed(r, deps);
    if (r.kind === "instead")
        return instead(r, deps);
    if (r.kind === "overrun")
        return overrun(r, deps);
    if (r.kind === "done")
        return doneIt(r, deps);
    if (r.kind === "attended")
        return attendedIt(r, deps);
    if (r.kind === "request")
        return runDayRequest(r.request, deps);
    return noted(r, deps, deps.next);
}
/** Only the fact, for a statement that also asks for another change ("i skipped marketing, put catch-up tomorrow"): the change goes on as usual. */
export async function declareOnly(read, deps) {
    const r = read.reality;
    if (r.kind === "no-classes" && !r.names.length)
        return declare(deps, "no-classes");
    if (r.kind === "missed")
        return declare(deps, "skip", ["--title", r.what]);
    if (r.kind === "ate")
        return declare(deps, "ate");
    if (r.kind === "place")
        return declare(deps, "place", ["--place", r.place]);
    return null;
}
/** "undo" right after a reality turn: every calendar write it made comes back, and the facts it declared are taken back. */
export async function undoReality(last, run) {
    const calls = [];
    const outputs = [];
    for (let i = 0; i < last.writes; i += 1) {
        const out = await run("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 }));
        calls.push("exec orion-reschedule undo");
        outputs.push(out.stdout);
        if (out.code !== 0)
            return say("I couldn't undo all of that just now. Check your calendar, and tell me what's wrong.", calls, outputs);
    }
    for (const id of last.facts) {
        const out = await run("orion-declare", ["remove", "--id", id]).catch(() => ({ stdout: "", code: 1 }));
        calls.push(`exec orion-declare remove --id ${id}`);
        outputs.push(out.stdout);
    }
    const restored = outputs.flatMap((o) => [...o.matchAll(/put (.+?) back/g)].map((x) => shortTitle(x[1])));
    return done(`Undone${restored.length ? `: ${listed([...new Set(restored)])} ${restored.length > 1 ? "are" : "is"} back on your plan` : ""}, and I've forgotten what you told me about it.`, calls, outputs);
}
