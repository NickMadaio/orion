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
                        do: { type: "string", enum: ["fill_between", "plan", "clear_after", "move", "resize", "extend", "add", "drop", "skip", "swap", "tidy", "cannot", "ask", "answer"] },
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
- "what time is my lab?" → {"steps":[{"do":"answer","text":"Your lab is <its start>–<its end>."}]}   (read the times from his day, never from these examples)

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
        case "answer":
            return { say: step.do, text: String(step.text ?? "").trim() || (step.do === "cannot" ? "That can't be done today." : "") };
        case "fill_between": {
            const a = byId(step.after);
            const b = byId(step.before);
            if (!a || !b)
                return { error: "fill_between needs two real blocks (after, before)" };
            const roundUp = (n) => Math.ceil(n / 5) * 5;
            const start = roundUp(Math.max(toMin(a.end) + BUFFER, now));
            const end = toMin(b.start) - BUFFER;
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
            if (!Number.isFinite(step.minutes))
                return { error: "add needs minutes" };
            const at = time(step.to) ? ["--at", time(step.to)] : byId(step.after) ? ["--after", byId(step.after).title] : [];
            return { args: ["add", step.what, String(Math.round(step.minutes)), ...at] };
        }
        case "drop": return what && !what.fixed ? { args: ["drop", what.title] } : { error: "drop needs a movable block id" };
        // "skip" is for a class or plan with people; for his own block it means drop ("ditch the macro stuff").
        case "skip": return what ? { args: [what.fixed ? "skip" : "drop", what.title] } : { error: "skip needs a block id" };
        case "swap": return what && byId(step.with) ? { args: ["swap", what.title, byId(step.with).title] } : { error: "swap needs two block ids" };
        case "tidy": return { args: ["tidy"] };
        default: return { error: `unknown step ${String(step.do)}` };
    }
}
const FAILED = /NOT BOOKED|NOTHING WAS|did not fit|usage:|not a real block|is in the past|no block called|Error/i;
/** What to tell Nick, from the scheduler's own output only. */
export function summarize(outputs, said) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const changes = lines.filter((l) => /moved|planned|added|cleared|is now|skipped|resized|extended|swapped|separated|booked/i.test(l) && !FAILED.test(l) && !/^Changed|^Would change|^Written/.test(l));
    const failed = lines.filter((l) => FAILED.test(l));
    const parts = [];
    if (changes.length)
        parts.push(changes.slice(0, 4).join("; "));
    if (failed.length)
        parts.push(`Not done: ${failed[0]}`);
    parts.push(...said.filter(Boolean));
    return { reply: parts.join(". ") || "Nothing changed.", changed: changes.length > 0 };
}
/** "tomorrow" as he types it ("tmrw" read today's calendar, 2026-10-12). */
export const TOMORROW = /\b(tomorrow|tmrw|tmr|tmrow|tomoz|2moro|2morrow)\b/i;
/** Before 5 AM he is still up: "tomorrow" means the coming daytime — today's date (2026-10-13: a reminder
 *  asked for at 00:44 "tomorrow at 11" was filed for the day after). */
export const LATE_NIGHT_UNTIL = 5;
export function meansTomorrow(message, now = new Date()) {
    return TOMORROW.test(message) && now.getHours() >= LATE_NIGHT_UNTIL;
}
export const RESCHEDULE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule";
/** The whole fixed sequence for one request. exec runs the scheduler with argv (no shell). */
export async function runScheduleFlow({ message, clock, exec, ask, now = new Date() }) {
    const dateArgs = meansTomorrow(message, now) ? ["--date", "tomorrow"] : [];
    let day;
    try {
        day = JSON.parse((await exec(["show", "--json", ...dateArgs])).stdout);
    }
    catch {
        return { outcome: "fallback", reason: "could not read the day" };
    }
    const user = `Now: ${clock}.\n\nHis day${dateArgs.length ? " (tomorrow)" : ""}:\n${blockList(day)}\n\nNick: ${message}`;
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
    for (const c of runs) {
        const argv = [...c.args, ...dateArgs];
        const { stdout } = await exec(argv);
        calls.push(`exec orion-reschedule ${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
        outputs.push(stdout);
        if (FAILED.test(stdout))
            break; // the rest depended on this one
    }
    return { outcome: "done", calls, outputs };
}
const ampm = (t) => { const [h, m] = t.split(":").map(Number); const hh = ((h ?? 0) + 11) % 12 + 1; return `${hh}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export function spokenReply(outputs) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const said = [];
    for (const l of lines) {
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
    const parts = [said.length ? `Done: ${said.slice(0, 6).join("; ")}.` : "", failed ? `Not done: ${failed.replace(/^NOTHING WAS CHANGED:\s*/i, "")}` : ""].filter(Boolean);
    return parts.join(" ") || "Nothing on your day changed.";
}
