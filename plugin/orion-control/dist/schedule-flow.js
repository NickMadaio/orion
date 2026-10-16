/*
 Scheduling as a fixed sequence, not an open-ended tool loop (2026-10-12; research ideas #3/#4,
 docs/evals/v3/RESEARCH_IDEAS.md — TinyAgent, Apple's on-device model, SMCalFlow).

   1. code reads the whole day (orion-reschedule show --json, past blocks included) and numbers it
   2. the worker fills ONE small form; every block reference must be one of today's real ids (B1…)
   3. code compiles the form into exact orion-reschedule arguments (no shell, no paths, no "&"
      problem, no time arithmetic for the model — "between A and B" = from A's end to B's start)
   4. the scheduler runs it; the worker only phrases what the scheduler printed

 Nick: "you go okay, the start time is a because the class ends at b, and the end time is x because
 the lab starts at y" — that decomposition is compile() below.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const BUFFER = 5; // his rule: five minutes between activities
/** "B1 09:00–10:30 CS2100 … (FIXED, done)" — what the model sees. */
export function blockList(day) {
    const now = day.now ? toMin(day.now) : null;
    return day.blocks.map((b, i) => `B${i + 1} ${b.start}–${b.end} ${b.title}${b.fixed ? " (FIXED)" : ""}${now !== null && toMin(b.end) <= now ? " (already happened)" : ""}`).join("\n");
}
/** JSON schema for the form; block references are enums of today's real ids. */
export function intentSchema(day) {
    const ids = day.blocks.map((_, i) => `B${i + 1}`);
    const ref = ids.length ? { type: "string", enum: ids } : { type: "string" };
    return {
        type: "object",
        properties: {
            steps: { type: "array", maxItems: 4, items: { type: "object", properties: {
                        do: { type: "string", enum: ["fill_between", "plan", "clear_after", "move", "resize", "extend", "add", "drop", "skip", "swap", "tidy", "late", "overrun", "cannot", "ask", "answer"] },
                        where: { type: "string", maxLength: 40 }, travel: { type: "number" },
                        items: { type: "array", maxItems: 8, items: { type: "object", properties: { title: { type: "string", maxLength: 60 }, minutes: { type: "number" } }, required: ["title"] } },
                        what: { type: "string", maxLength: 60, description: "a block id (B1…) or, for something new, its short title" },
                        after: ref, before: ref, with: ref,
                        to: { type: "string", description: "HH:MM" }, until: { type: "string", description: "HH:MM" },
                        minutes: { type: "number" }, by: { type: "number" }, text: { type: "string", maxLength: 200, description: "for cannot/ask/answer: one plain sentence" },
                    }, required: ["do"] } },
        },
        required: ["steps"],
    };
}
/** Sampling for the form call: deterministic (thinking off, so greedy is safe). */
// num_predict caps the form (a real one is <200 tokens): at temperature 0 a list can loop forever —
// one call generated 14k tokens for 5 minutes (2026-10-12).
export const FORM_OPTIONS = { temperature: 0, top_p: 1, top_k: 20, presence_penalty: 0, repeat_penalty: 1.05, num_predict: 500, num_ctx: 32768 };
export const FORM_PROMPT = `You fill in a form for ORION's scheduler. You get the time now, Nick's day as numbered blocks (B1, B2…; FIXED = a class or plan with people) and what he says. Choose the steps that do exactly what he asked; the scheduler does the times and slides other blocks.

Steps:
- fill_between: put "what" (a block id, or a new title) in all the time between block "after" and block "before" ("between DS and my lab", "the entire time between the two classes")
- plan: after block "after" he goes somewhere and does several things there (the list itself is read separately — just give "after")
- clear_after: remove everything planned after block "after" ("clear my schedule after the lab", "I'm going home after X, clear the rest") — classes and plans with people stay
- move: block "what" to start at "to" (HH:MM), or end at "until", or shift it "by" minutes ("push it back half an hour" = by 30, "an hour earlier" = by -60 — never work out the clock time yourself)
- resize: block "what" lasts "minutes" in total
- extend: block "what" (running long) ends at "until"; "N more minutes" = now + N
- add: a new block titled "what", "minutes" long, at "to" or right after block "after"
- drop: remove block "what" (movable only) · skip: he is not going to class "what" today
- swap: block "what" with block "with" · tidy: separate overlaps
- late: he is running "minutes" late right now ("I'm running 15 late") — everything not yet done slides back
- overrun: class "what" runs "minutes" over, or he is late to it and wants what comes after it pushed back by "minutes"
- cannot: it cannot be done — say why in "text" · ask: only if no block tells you — question in "text" · answer: he only asked a question — reply in "text"

Examples, for this SAMPLE day only (his real day below has its own ids — never copy these ids):
  B1 11:00–12:30 Discrete Structures (FIXED) · B2 15:30–17:00 Lab (FIXED) · B3 17:50–21:50 cert courses
- "stay in the building between DS and my lab, schedule cert courses the entire time between the two classes" → {"steps":[{"do":"fill_between","what":"B3","after":"B1","before":"B2"}]}
- "put gym between my two classes" (gym is not on the day) → {"steps":[{"do":"fill_between","what":"gym","after":"B1","before":"B2"}]}
- "after my lab I'll go to the library, 10 min walk, then do my essay and call mom" → {"steps":[{"do":"plan","after":"B2"}]}
- "going back to my dorm after the lab, clear my schedule after it, I'll tell you the plan later" → {"steps":[{"do":"clear_after","after":"B2"}]}
- "skip the lab today" → {"steps":[{"do":"skip","what":"B2"}]}   (a class is skipped, never dropped or moved)
- "push cert courses to 6" → {"steps":[{"do":"move","what":"B3","to":"18:00"}]}
- "push cert courses back 20 min" → {"steps":[{"do":"move","what":"B3","by":20}]}
- "running 15 min behind, push everything" → {"steps":[{"do":"late","minutes":15}]}   ("I'm running late" with no number → ask how late)
- "DS is going 20 over" → {"steps":[{"do":"overrun","what":"B1","minutes":20}]}
- "add a 15 minute stretch block tomorrow at 7:30 am" → {"steps":[{"do":"add","what":"stretch","minutes":15,"to":"07:30"}]}   (a time he says goes in "to", 24-hour — never leave it out; "tomorrow" is the day shown, not part of the step)
- "what time is my lab?" → {"steps":[{"do":"answer","text":"Your lab is <its start>–<its end>."}]}   (read the times from his day, never from these examples)
- "I'm in a time block but I don't need it. I'm gonna meal prep — put it from 12:45 to 1:45 and push everything else to follow" → {"steps":[{"do":"add","what":"meal prep","to":"12:45","until":"13:45"}]}   (one step: the scheduler cuts short the block he is in and slides everything after it — never move the blocks after it yourself)

Never drop a block and add it again — move it (or fill_between). Name blocks by their id. Classes he mentions by name or nickname ("DS" = Discrete Structures, "my lab", "program design") are the matching blocks. Only what he asked for.
Output JSON only: {"steps":[...]}`;
export const EXTRACT_PROMPT = `From what Nick says, list where he is going, how many minutes it takes to get there (0 if he does not say), and the things he will do there, in his order. When he lists what he will do, the general reason for going ("to study", "to work") is not a separate thing. Each thing: a short title in his words, and minutes — his number if he gives one, otherwise an honest estimate (15 for a quick errand or a look-up, 45 for a task or prep, 60 for practice or study). Output JSON only: {"where":"","travel":0,"items":[{"title":"","minutes":45}]}`;
export const EXTRACT_SCHEMA = { type: "object", properties: { where: { type: "string", maxLength: 40 }, travel: { type: "number" },
        items: { type: "array", maxItems: 8, items: { type: "object", properties: { title: { type: "string", maxLength: 60 }, minutes: { type: "number" } }, required: ["title", "minutes"] } } }, required: ["where", "travel", "items"] };
/** Travel minutes to places he goes, from ~/.openclaw/orion-controlled/places.json ({"spitalfields": 15, …}). */
let placesCache = null;
export function setPlaces(places) { placesCache = places; }
function knownTravel(where) {
    if (!where)
        return undefined;
    if (placesCache === null) {
        try {
            placesCache = JSON.parse(readFileSync(`${homedir()}/.openclaw/orion-controlled/places.json`, "utf8"));
        }
        catch {
            placesCache = {};
        }
    }
    const w = where.toLowerCase();
    const hit = Object.entries(placesCache ?? {}).find(([name]) => w.includes(name) || name.includes(w));
    return hit?.[1];
}
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const FILLER = new Set(["the", "my", "his", "block", "session", "today", "todays", "class", "time"]);
/** Whether a title he says could be any block on the day, class or not ("discrete" → the DS lecture).
 *  Lenient on purpose: one shared word is enough, so only a plainly absent thing is refused. */
function namesABlock(title, day) {
    const words = normTitle(title).split(" ").filter((w) => w.length >= 3 && !FILLER.has(w));
    return words.some((w) => day.blocks.some((b) => normTitle(b.title).split(" ").some((t) => t.startsWith(w) || w.startsWith(t) && t.length >= 3)));
}
// ---- Code-level guards (2026-10-16, live re-run q019/q098): whatever the 9B fills in, these cannot write the wrong thing.
const STOP = new Set(["the", "and", "for", "with", "that", "this", "all", "also", "sure", "make", "need", "want", "today", "tomorrow", "tonight", "please", "going", "not", "but", "then", "just", "from", "into", "his", "her", "our", "your"]);
const REMOVE_VERB = /\b(skip|cancel|ditch|drop|delete|remove|bail on|not going to|won'?t (?:be )?(?:going|at|making))\b/i;
// (review, 2026-10-16) swaps are not skips: "skip lunch, i'll go for a walk instead", "cancel gym and do a run", "count a walk".
const ADD_CUE = /\b(add|put|schedule|book|create|set up|block (?:off|out)|plan|count|instead|do an?|go for|i'?ll)\b/i;
const PRESENCE = /\b(make sure (?:i'?m|im|i am|i'?ll be)|be (?:in|at)|i'?m (?:in|at)|im (?:in|at)|attend|go to|still (?:go|be|need))\b/i;
const words = (t) => normTitle(t).split(" ").filter((w) => w.length >= 3 && !FILLER.has(w) && !STOP.has(w));
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
/** What he asked to be removed ("cancel my lab and …" → "lab"). */
function removalObject(message) {
    const m = message.match(/\b(?:skip|cancel|ditch|drop|delete|remove|bail on|not going to)\s+(?:out of\s+)?(?:my|the|our|a|an)?\s*([^,.;!?]+?)(?=\s+(?:today|tomorrow|tonight|and|but|then|so)\b|[,.;!?]|$)/i);
    return m?.[1]?.trim() || undefined;
}
/** Whether what he said names this block: a word of its title, its course code, its initials ("DS" = Discrete
 *  Structures), its time ("ditch the 4pm"), or an anchor ("whatever's after lab") (review, 2026-10-16). */
function messageNames(message, b, day) {
    const said = normTitle(message).split(" ").filter(Boolean);
    const title = words(b.title);
    if (said.some((w) => w.length >= 3 && title.some((t) => sameWord(w, t))))
        return true;
    const initials = normTitle(b.title).split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !["lecture", "lab", "class", "for", "and", "the", "seminar", "tutorial"].includes(w)).map((w) => w[0]).join("");
    if (initials.length >= 2 && said.includes(initials))
        return true;
    if (b.fixed && said.some((w) => w === "class" || w === "classes" || w === "lecture"))
        return true;
    const [bh, bm] = b.start.split(":").map(Number);
    // "the 2 hour block" is a length, not 2 PM (review, 2026-10-16).
    for (const m of message.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:the|at)\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b)/gi)) {
        const h = Number(m[1] ?? m[4]);
        const min = Number(m[2] ?? m[5] ?? 0);
        const ap = m[3]?.toLowerCase();
        const hours = ap ? [(h % 12) + (ap === "pm" ? 12 : 0)] : [h % 24, (h % 12) + 12];
        if (min === bm && hours.includes(bh))
            return true;
    }
    const anchor = message.match(/\b(after|before)\s+(?:my|the)?\s*([^,.;!?]+)/i);
    if (anchor && day) {
        // Only the block right after the anchor (right before, for "before"), not any later one (review, 2026-10-16).
        const a = day.blocks.find((x) => x !== b && messageNames(anchor[2], x));
        const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
        const sorted = [...day.blocks].sort((x, y) => toMin(x.start) - toMin(y.start));
        if (a) {
            const i = sorted.indexOf(a);
            if (anchor[1].toLowerCase() === "after" ? sorted[i + 1] === b : sorted[i - 1] === b)
                return true;
        }
    }
    return false;
}
/** The message asks for two opposite things about one noun ("cancel my lab and also make sure I'm in the lab at 2"). */
export function contradiction(message) {
    const obj = removalObject(message);
    if (!obj)
        return undefined;
    const at = message.toLowerCase().indexOf(obj.toLowerCase());
    const rest = message.slice(at + obj.length);
    const noun = words(obj);
    if (!PRESENCE.test(rest) || !words(rest).some((w) => noun.some((n) => sameWord(w, n))))
        return undefined;
    return `You said to cancel ${/^(my|the)\b/i.test(obj) ? "" : "the "}${obj} and also to be there. Which do you want: drop it, or keep it (at the time you said)?`;
}
/** Steps that would write something he did not ask for, as what to say instead. null = fine. */
export function guardSteps(message, steps, day) {
    const obj = removalObject(message);
    // Never claim a block is missing when it is on the day (review, 2026-10-16).
    const onDay = obj ? day.blocks.some((b) => messageNames(obj, b)) : false;
    const gone = `I didn't make that change — ${onDay ? `you asked to take ${obj} off, not to add anything` : `there's no ${obj ?? "such block"} on ${day.now ? "today's" : "that day's"} calendar`}`;
    // A skip only ever takes something off: "skip gym today" (no gym) became add gym 15:05 and "Done" (q019).
    if (REMOVE_VERB.test(message) && !ADD_CUE.test(message) && steps.some((s) => ["add", "fill_between", "plan"].includes(s.do)))
        return { say: "cannot", text: gone };
    // Whatever the cues, never add or fill the very thing he asked to remove ("skip yoga today, i'll go tomorrow" wrote
    // yoga today; review, 2026-10-16). Swapping in something else ("skip lunch, i'll go for a walk") is fine.
    if (obj) {
        const gone = words(obj);
        if (steps.some((s) => ["add", "fill_between"].includes(s.do) && s.what && !/^B\d+$/.test(s.what) && words(s.what).some((w) => gone.some((g) => sameWord(w, g)))))
            return { say: "cannot", text: `I didn't make that change — you asked to skip ${obj}, so I won't add it` };
    }
    // Any skip/drop must land on a block he named: "cancel my lab" removed the MKTG lecture (q098).
    for (const s of steps) {
        if (s.do !== "skip" && s.do !== "drop")
            continue;
        const id = s.what && /^B\d+$/.test(s.what) ? day.blocks[Number(s.what.slice(1)) - 1] : day.blocks.find((b) => s.what && normTitle(b.title).includes(normTitle(s.what)));
        if (id && !messageNames(message, id, day))
            return { say: "cannot", text: gone };
    }
    return null;
}
/** One step → orion-reschedule arguments (argv, no shell), or what to tell him. */
export function compile(input, day) {
    let step = input;
    const byId = (id) => (id && /^B\d+$/.test(id) ? day.blocks[Number(id.slice(1)) - 1] : undefined);
    const now = day.now ? toMin(day.now) : 0;
    if (step.what && /^B\d+$/.test(step.what) && !byId(step.what))
        return { error: `${step.what} is not a block on his day` };
    // A title that names a block already on his day means that block ("push cert courses to 2").
    if (step.what && !/^B\d+$/.test(step.what) && step.do !== "plan") {
        const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const i = day.blocks.findIndex((b) => !b.fixed && (norm(b.title).includes(norm(step.what)) || norm(step.what).includes(norm(b.title))));
        if (i >= 0 && step.do !== "add")
            step = { ...step, what: `B${i + 1}` };
    }
    // "skip gym today" with no gym on his day: the correction hint ("use its name as a new title") turned it
    // into fill_between gym (sweep q019, 2026-10-15). Something not on the day cannot be skipped or dropped.
    if ((step.do === "skip" || step.do === "drop") && step.what && !/^B\d+$/.test(step.what) && !namesABlock(step.what, day)) {
        return { say: "cannot", text: `there's no ${step.what} on ${day.now ? "today's" : "that day's"} calendar` };
    }
    for (const k of ["after", "before", "with"])
        if (step[k] && !byId(step[k]))
            return { error: `${step[k]} is not a block on his day` };
    const what = byId(step.what);
    if (what && (step.what === step.after || step.what === step.before))
        return { error: "the block to place cannot be one of its own anchors" };
    if (what?.fixed && ["fill_between", "move", "resize", "drop", "swap"].includes(step.do))
        return { error: `${what.title} is a class or a plan with people — it does not move` };
    const time = (t) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : undefined);
    switch (step.do) {
        case "cannot":
        case "ask":
        case "answer": {
            // Nick hears blocks by name: the form wrote "Cannot swap B2 (a FIXED class)" and "DS Lab (B3)" (sweep 2026-10-16).
            // Not a vitamin: "your B12 supplement" stayed B12, not block 12's title (review, 2026-10-16).
            const text = String(step.text ?? "").replace(/\s*\(B\d+\)/g, "").replace(/(?<!\b(?:[Vv]itamins?|[Yy]our|[Tt]ake|[Tt]aking|[Ss]ome)\s)\bB(\d+)\b(?!\s*(?:vitamins?|supplements?|tablets?|pills?|shots?|complex)\b)/g, (id, n) => day.blocks[Number(n) - 1]?.title ?? id).replace(/\bFIXED\b/g, "fixed").trim();
            return { say: step.do, text: text || (step.do === "cannot" ? "That can't be done today." : "") };
        }
        case "fill_between": {
            const a = byId(step.after);
            const b = byId(step.before);
            if (!a || !b)
                return { error: "fill_between needs two real blocks (after, before)" };
            const roundUp = (n) => Math.ceil(n / 5) * 5;
            const start = roundUp(Math.max(toMin(a.end) + BUFFER, now));
            const end = toMin(b.start) - BUFFER;
            // At 22:25 a 15-minute gap at 14:30 was "only 0 minutes between CS Lab and Review spending" (sweep q019/q028).
            if (day.now && now >= toMin(b.start))
                return { say: "cannot", text: `that gap between ${a.title} and ${b.title} has already passed today — want it tomorrow?` };
            if (end - start < 15)
                return { say: "cannot", text: `there are only ${Math.max(0, toMin(b.start) - Math.max(toMin(a.end), now))} minutes between ${a.title} and ${b.title}` };
            if (what)
                return { args: ["move", what.title, "--to", hhmm(start), "--until", hhmm(end)] };
            if (!step.what)
                return { error: "fill_between needs what to put there" };
            return { args: ["add", step.what, String(end - start), "--at", hhmm(start), "--before", hhmm(end + BUFFER)] };
        }
        case "plan": {
            const anchor = byId(step.after);
            const items = (step.items ?? []).filter((i) => String(i.title ?? "").trim());
            if (!anchor)
                return { error: "plan needs the block it comes after" };
            if (!items.length)
                return { error: "plan needs at least one thing he will do" };
            // Commutes are invisible (Nick, 2026-10-12): no "Travel to …" event. The first thing starts when
            // he arrives — the anchor's end + the commute he stated (or a known one for that place) — and a
            // stated time replaces the planner's default commute-home wall.
            const travel = Number.isFinite(step.travel) && step.travel > 0 ? Math.round(step.travel) : knownTravel(step.where);
            const arrive = Math.ceil((Math.max(toMin(anchor.end), now) + (travel ?? BUFFER)) / 5) * 5;
            const mins = (n) => String(Math.min(240, Math.max(5, Math.round(Number.isFinite(n) ? n : 45))));
            const plans = items.map((it, i) => (i === 0 ? `${it.title.trim()}, ${mins(it.minutes)}, ${hhmm(arrive)}` : `${it.title.trim()}, ${mins(it.minutes)}`));
            return { args: ["day", ...plans.flatMap((p) => ["--plan", p])] };
        }
        case "clear_after": {
            const anchor = byId(step.after);
            return anchor ? { args: ["drop", "--after", anchor.title] } : { error: "clear_after needs the block it comes after" };
        }
        case "move": {
            if (!what)
                return { error: "move needs a block id" };
            // "From when one block ends to when another starts" is fill_between, with his 5-minute buffers.
            const endsAt = day.blocks.findIndex((b) => b !== what && time(step.to) === b.end);
            const startsAt = day.blocks.findIndex((b) => b !== what && time(step.until) === b.start);
            if (endsAt >= 0 && startsAt >= 0)
                return compile({ do: "fill_between", what: step.what, after: `B${endsAt + 1}`, before: `B${startsAt + 1}` }, day);
            if (Number.isFinite(step.by) && step.by !== 0)
                return { args: ["move", what.title, "--to", hhmm(toMin(what.start) + Math.round(step.by))] };
            if (time(step.to) && time(step.until))
                return { args: ["move", what.title, "--to", time(step.to), "--until", time(step.until)] };
            if (time(step.to))
                return { args: ["move", what.title, "--to", time(step.to)] };
            if (time(step.until))
                return { args: ["move", what.title, "--until", time(step.until)] };
            if (byId(step.after))
                return { args: ["move", what.title, "--after", byId(step.after).title, ...(byId(step.before) ? ["--before", byId(step.before).title] : [])] };
            return { error: "move needs to, until or after" };
        }
        case "resize":
            return what && Number.isFinite(step.minutes) ? { args: ["resize", what.title, String(Math.round(step.minutes))] } : { error: "resize needs a block id and minutes" };
        case "extend":
            return what && time(step.until) ? { args: ["extend", what.title, "--until", time(step.until)] } : { error: "extend needs a block id and until" };
        case "add": {
            if (!step.what || byId(step.what))
                return { error: "add needs a new title" };
            const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            if (day.blocks.some((b) => norm(b.title).includes(norm(step.what)) || norm(step.what).includes(norm(b.title))))
                return { error: `"${step.what}" is already on his day — move it instead of adding it again` };
            // "from 12:45 to 1:45": code works out the length, never the model.
            const span = time(step.to) && time(step.until) ? toMin(time(step.until)) - toMin(time(step.to)) : undefined;
            if (span !== undefined && span < 5)
                return { error: `add runs ${step.to}–${step.until}, which ends before it starts` };
            const minutes = span ?? step.minutes;
            if (!Number.isFinite(minutes))
                return { error: "add needs minutes, or a start (to) and an end (until)" };
            // A block with no length is not a block: a to-do became add "email prof…" 0 (sweep q043, 2026-10-15).
            if (minutes < 5)
                return { error: "add needs at least 5 minutes" };
            const at = time(step.to) ? ["--at", time(step.to)] : byId(step.after) ? ["--after", byId(step.after).title] : [];
            return { args: ["add", step.what, String(Math.round(minutes)), ...at] };
        }
        case "drop": return what && !what.fixed ? { args: ["drop", what.title] } : { error: "drop needs a movable block id" };
        // "skip" is for a class or plan with people; for his own block it means drop ("ditch the macro stuff").
        case "skip": return what ? { args: [what.fixed ? "skip" : "drop", what.title] } : { error: "skip needs a block id" };
        case "swap": return what && byId(step.with) ? { args: ["swap", what.title, byId(step.with).title] } : { error: "swap needs two block ids" };
        case "tidy": return { args: ["tidy"] };
        // orion-reschedule had late/overrun all along, but the form could not say them: "running 20 min late,
        // push the stuff after it back" became one move of one block (sweep q017/q029, 2026-10-15).
        case "late": {
            if (!Number.isFinite(step.minutes) || step.minutes < 5)
                return { error: "late needs how many minutes (5 or more)" };
            if (!day.now)
                return { say: "cannot", text: "running late only moves today's blocks" };
            return { args: ["late", String(Math.round(step.minutes))] };
        }
        case "overrun": {
            if (!what || !Number.isFinite(step.minutes) || step.minutes < 5)
                return { error: "overrun needs a block id and minutes (5 or more)" };
            // His own block running over is an extend; overrun is for a class.
            if (!what.fixed)
                return { args: ["extend", what.title, "--until", hhmm(Math.min(toMin(what.end) + Math.round(step.minutes), 1439))] };
            return { args: ["overrun", String(Math.round(step.minutes)), "--what", what.title] };
        }
        default: return { error: `unknown step ${String(step.do)}` };
    }
}
const FAILED = /NOT BOOKED|NOTHING WAS|did not fit|usage:|not a real block|is in the past|no block called|Error/i;
/** One scheduler failure line → one short spoken clause. The raw line was spoken word for word (sweep
 *  2026-10-16): usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added". */
export function spokenFailure(line) {
    const l = line.trim().replace(/^orion-reschedule:\s*/, "")
        .replace(/^(?:MUST-HAVE )?(?:NOTHING WAS|NOT) (?:CHANGED|BOOKED|DROPPED)\b(?: on \w+day)?(?: \(\d{4}-\d{2}-\d{2}\))?[:.]?\s*/i, "")
        // Notes to the operator, and lists of his whole day, are not for Nick.
        .replace(/(?:[.;]\s+|\s+—\s+|^)(?:Tell him|Do not|Don't|If he|ask whether|Run |Use |To set|See the header|Options:|Blocks today|Fixed today|Movable blocks|Classes today|Never |swap only|skip is only)[\s\S]*$/i, "")
        .replace(/ \((?:\w+day )?\d{4}-\d{2}-\d{2}\)/g, "").trim();
    if (/^usage:|^Error\b|has no .* option|one command per call|does not take/i.test(l))
        return "I couldn't make that change";
    if (!l)
        return "nothing could be booked";
    const rules = [
        [/^(.+?) (is|are) already over today/i, (_, what, verb) => `${what} ${verb === "is" ? "has" : "have"} already ended today`],
        [/^no block called "?(.+?)"? on /i, (_, what) => `there's no block called ${what}`],
        [/^no class or fixed plan called "?(.+?)"? left/i, (_, what) => `there's no class called ${what} left today`],
        [/^no "(.+?)" on .* to put it after/i, (_, what) => `there's no ${what} to put it after`],
        [/^"?(.+?)"? is one of his own calendar events/i, (_, what) => `${what} is a class or a plan with people, so it doesn't move`],
        [/^(.+?) \(\d+ min\) (?:no longer fits|did not fit)/i, (_, what) => `${what} didn't fit`],
        [/^must-haves could not fit: (.+?)\.?$/i, (_, what) => `${what} didn't fit`],
        [/^no movable block matches/i, () => "there's no movable block by that name"],
        [/^(.+?) is on \d{4}-\d{2}-\d{2}/i, (_, what) => `${what} is on another day`],
        [/is in the past/i, () => "that day is already over"],
    ];
    const hit = rules.map(([re, say]) => { const m = l.match(re); return m ? say(...m) : null; }).find((t) => t !== null);
    const said = hit ?? l;
    return said.replace(/\b(\d{2}:\d{2})\b/g, (t) => ampm(t)).replace(/\.$/, "");
}
/** What to tell Nick, from the scheduler's own output only. */
export function summarize(outputs, said) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const changes = lines.filter((l) => /moved|planned|added|cleared|is now|skipped|resized|extended|swapped|separated|booked/i.test(l) && !FAILED.test(l) && !/^Changed|^Would change|^Written/.test(l));
    const failed = lines.filter((l) => FAILED.test(l));
    const parts = [];
    if (changes.length)
        parts.push(changes.slice(0, 4).join("; "));
    if (failed.length)
        parts.push(`Not done: ${spokenFailure(failed[0])}`);
    parts.push(...said.filter(Boolean));
    return { reply: parts.join(". ").replace(/^(Not done: .*[^.])$/, "$1.") || "Nothing changed.", changed: changes.length > 0 };
}
/** "tomorrow" as he types it ("tmrw" read today's calendar, 2026-10-12). */
export const TOMORROW = /\b(tomorrow|tmrw|tmr|tmrow|tomoz|2moro|2morrow)\b/i;
/** Before 5 AM he is still up: "tomorrow" means the coming daytime — today's date (2026-10-13: a reminder
 *  asked for at 00:44 "tomorrow at 11" was filed for the day after). */
export const LATE_NIGHT_UNTIL = 5;
export function meansTomorrow(message, now = new Date()) {
    return TOMORROW.test(message) && now.getHours() >= LATE_NIGHT_UNTIL;
}
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// "friday", "on mon", "next tuesday" — not "to friday"/"till friday" (where a block goes), not "fridays" (a
// habit), and a short form only after on/next/this ("the sun", "i sat in class", "c'mon" are not days).
const WEEKDAY = /\b(?<dest>to|till|until|onto|into)?\s*(?:(?:on|next|this)\s+(?<day>mon|tues?|wed|weds|thu|thur|thurs|fri|sat|sun)\b|(?:on\s+|next\s+|this\s+)?(?<full>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/i;
const TODAY = /\b(today|tonight|this (morning|afternoon|evening))\b/i;
const inPassing = (message, m) => /^['\u2019]s\b/i.test(message.slice(m.index + m[0].length)) || /\bfor\s+(?:my|the|our|your)\s+$/i.test(message.slice(0, m.index + m[0].length - (m.groups?.full ?? m.groups?.day ?? "").length));
/** The day the change is for: tomorrow, a weekday he names, or today. "i gotta leave early friday, cut
 *  the last block off" resized Thursday's last block (sweep q027, 2026-10-15). The weekday that is
 *  today stays today; orion-reschedule reads any other as the next one ("--date friday"). */
export function dayArgsFor(message, now = new Date()) {
    if (meansTomorrow(message, now))
        return { args: ["--date", "tomorrow"], label: "tomorrow" };
    // 2026-10-16 (live re-run q020, 01:11): before 5 AM "tomorrow" is today's date for a reminder, but a calendar
    // write that drops --date lands on today while the message says tomorrow — and the reply never said which.
    // The day words and the compiled --date must agree; when they cannot be known to, ask and write nothing.
    if (TOMORROW.test(message)) {
        const tmr = new Date(now.getTime() + 86400000);
        const dn = (d) => WEEKDAYS[d.getDay()].replace(/^./, (c) => c.toUpperCase());
        return { args: [], label: undefined, ask: `It's after midnight: do you mean later today (${dn(now)}) or tomorrow (${dn(tmr)})?` };
    }
    // (review, 2026-10-16) no weekday means today; "my monday exam", "wednesday's quiz",
    // "for the tuesday deadline" name a weekday in passing, not the day of the change, but a weekday he names as the target beats a later "today" (re-review, 2026-10-16).
    const m = message.match(WEEKDAY);
    if (!m?.groups || m.groups.dest || inPassing(message, m))
        return { args: [], label: undefined };
    const said = (m.groups.full ?? m.groups.day ?? "").toLowerCase();
    const target = WEEKDAYS.findIndex((d) => d.startsWith(said.slice(0, 3)));
    if (target < 0 || (target === now.getDay() && !/\bnext\s/i.test(m[0])))
        return { args: [], label: undefined };
    const name = WEEKDAYS[target];
    // A weekday named after "today" could be either day: ask, write nothing (round 6, 2026-10-16). Either order; the one
    // exception is a weekday that is the object of plan/organise/sort ("plan my friday, today is too packed").
    const label = name[0].toUpperCase() + name.slice(1);
    const todayAt = message.search(TODAY);
    const isObject = /\b(?:plan|organi[sz]e|sort)(?:\s+out)?\s+(?:my|the|our)?\s*$/i.test(message.slice(0, m.index));
    if (todayAt >= 0 && !isObject)
        return { args: [], label: undefined, ask: `Today or ${label}?` };
    return { args: ["--date", name], label: name[0].toUpperCase() + name.slice(1) };
}
export const RESCHEDULE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule";
/** The whole fixed sequence for one request. exec runs the scheduler with argv (no shell).
 *  undo: stamps of changes an earlier, cut-off half of this request made — reverted first, newest first,
 *  each only while it is still the latest change in the journal (undoTop), so nothing else is undone. */
export async function runScheduleFlow({ message, clock, exec, ask, now = new Date(), undo = [], undoTop = () => null }) {
    let undone = 0;
    for (const mark of [...undo].reverse()) {
        if (undoTop() !== mark)
            break;
        await exec(["undo"]);
        undone += 1;
    }
    const { args: dateArgs, label: when, ask: whichDay } = dayArgsFor(message, now);
    if (whichDay)
        return { outcome: "say", text: whichDay, kind: "ask" };
    let day;
    try {
        day = JSON.parse((await exec(["show", "--json", ...dateArgs])).stdout);
    }
    catch {
        return { outcome: "fallback", reason: "could not read the day" };
    }
    const clash = contradiction(message);
    if (clash)
        return { outcome: "say", text: clash, kind: "ask" };
    const user = `Now: ${clock}.\n\nHis day${when ? ` (${when})` : ""}:\n${blockList(day)}\n\nNick: ${message}`;
    let out = await ask(FORM_PROMPT, user, intentSchema(day));
    let compiled = (out?.steps ?? []).map((s) => compile(s, day));
    let bad = compiled.find((c) => "error" in c);
    // One correction round, with the rule it broke (LLM-Modulo: the scheduler's rules check the model).
    if (bad && "error" in bad) {
        out = await ask(FORM_PROMPT, `${user}\n\nYour form ${JSON.stringify(out?.steps ?? [])} broke a rule: ${bad.error}. If what he names is not on his day, use its name as a new title. Fill the form again.`, intentSchema(day));
        compiled = (out?.steps ?? []).map((s) => compile(s, day));
        bad = compiled.find((c) => "error" in c);
    }
    // A plan's list is read by its own small call — extraction only, no block ids (Nick: break it
    // into smaller tasks; one form doing both made the 9B unsure, 2026-10-12).
    const steps = out?.steps ?? [];
    if (steps.some((st) => st.do === "plan" && !(st.items ?? []).length)) {
        const list = await ask(EXTRACT_PROMPT, `Nick: ${message}`, EXTRACT_SCHEMA);
        const merged = steps.map((st) => (st.do === "plan" && !(st.items ?? []).length ? { ...st, where: list?.where ?? st.where, travel: list?.travel ?? st.travel, items: list?.items ?? [] } : st));
        compiled = merged.map((st) => compile(st, day));
        bad = compiled.find((c) => "error" in c);
    }
    const stopped = guardSteps(message, steps, day);
    if (stopped)
        return { outcome: "say", text: stopped.text, kind: stopped.say };
    if (!compiled.length)
        return { outcome: "fallback", reason: "no steps" };
    if (bad && "error" in bad)
        return { outcome: "fallback", reason: bad.error };
    const said = compiled.find((c) => "say" in c && c.say !== "answer");
    if (said && "say" in said)
        return { outcome: "say", text: said.text, kind: said.say };
    const runs = compiled.filter((c) => "args" in c);
    if (!runs.length)
        return { outcome: "fallback", reason: "a question, not a change" };
    const calls = [];
    const outputs = [];
    const marks = [];
    for (const c of runs) {
        const argv = [...c.args, ...dateArgs];
        const before = undoTop();
        const { stdout } = await exec(argv);
        calls.push(`exec orion-reschedule ${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
        outputs.push(stdout);
        const after = undoTop();
        if (after && after !== before)
            marks.push(after);
        if (FAILED.test(stdout))
            break; // the rest depended on this one
    }
    // The scheduler refused and nothing was written: that is not "done" — "done" told the worker "You
    // already made this change" and skipped the work check (sweep 2026-10-16, q043/q051/q093).
    if (outputs.some((o) => FAILED.test(o)) && !marks.length && !undone && !summarize(outputs, []).changed) {
        return { outcome: "say", kind: "plain", text: spokenReply(outputs, when), calls, outputs };
    }
    return { outcome: "done", calls, outputs, marks, undone, ...(when ? { reply: spokenReply(outputs, when) } : {}) };
}
const ampm = (t) => { const [h, m] = t.split(":").map(Number); const hh = ((h ?? 0) + 11) % 12 + 1; return `${hh}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export function spokenReply(outputs, when) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const said = [];
    const cut = [];
    const followed = [];
    for (const l of lines) {
        // The block he was in, cut short for a time he stated; the blocks that slid after a change.
        let c = l.match(/^(.+?) now ends at (\d{2}:\d{2})$/);
        if (c) {
            cut.push(`${c[1]} ends at ${ampm(c[2])}`);
            continue;
        }
        c = l.match(/^moved (.+?): \d{2}:\d{2} → (\d{2}:\d{2})$/);
        if (c) {
            followed.push(`${c[1]} now ${ampm(c[2])}`);
            continue;
        }
        let m = l.match(/^planned (.+?): (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} ${ampm(m[2])}–${ampm(m[3])}`);
            continue;
        }
        m = l.match(/^(.+?) moved: \d{2}:\d{2} → (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} now ${ampm(m[2])}–${ampm(m[3])}`);
            continue;
        }
        m = l.match(/^(.+?) is now (\d+) min: (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} is now ${m[2]} minutes, ${ampm(m[3])}–${ampm(m[4])}`);
            continue;
        }
        m = l.match(/^cleared \d+ prior schedule blocks?: (.+)$/i) ?? l.match(/^removed (.+)$/i);
        if (m) {
            said.push(`cleared ${m[1]}`);
            continue;
        }
        m = l.match(/^(?:Undone: )?skipped (.+?)(?: today|$)/i);
        if (m) {
            said.push(`${m[1]} is off today`);
            continue;
        }
    }
    const failed = lines.find((l) => FAILED.test(l));
    // Spoken: three moved blocks can be named; more is a count ("4 other blocks moved to follow it").
    const rest = followed.length > 3 ? [`${followed.length} other blocks moved to follow it`] : followed;
    const all = said.length ? [...said, ...cut, ...rest] : [];
    // when: the day it was for ("Done: resume work 5:50 PM" for tomorrow sounded like today, q020).
    const parts = [all.length ? `Done${when ? ` for ${when}` : ""}: ${all.slice(0, 6).join("; ")}.` : "", failed ? `Not done: ${spokenFailure(failed)}.` : ""].filter(Boolean);
    return parts.join(" ") || "Nothing on your day changed.";
}
