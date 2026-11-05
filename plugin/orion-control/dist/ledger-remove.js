/*
 Removing a saved note and cancelling reminders by what they are for (w20 round 3), each read back after the change.
*/
import { namesLabel, contentWords } from "./made-ledger.js";
const blank = () => ({ text: "", calls: [], outputs: [], removed: [], wroteCalendar: false });
const lastJson = (text) => { try {
    return JSON.parse(text.trim().split("\n").at(-1) ?? "");
}
catch {
    return undefined;
} };
const preview = (text) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > 50 ? `${flat.slice(0, 50).trimEnd()}…` : flat; };
/** A note ORION saved: found in the vault by its own words, archived (reversible), and the archive's answer is what is reported. */
export async function removeNote(deps, label) {
    const out = blank();
    const run = async (args) => {
        const r = await deps.run("orion-brain", args).catch(() => ({ stdout: "", code: 1 }));
        out.calls.push(`exec orion-brain ${args[0]} …`);
        out.outputs.push(r.stdout);
        return r;
    };
    const words = contentWords(label).slice(0, 6).join(" ");
    const found = lastJson((await run(["forget", words])).stdout)?.matches ?? [];
    const flat = (s) => s.toLowerCase().replace(/\s+/g, " ").replace(/⏎/g, " ").trim();
    const exact = found.filter((m) => flat(m.text).includes(flat(label).slice(0, 40)) || flat(label).includes(flat(m.text).slice(0, 40)));
    const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
    if (!pick)
        return { ...out, text: found.length ? `I found ${found.length} saved notes that could be that one, so I haven't removed any. Which one?` : `I couldn't find that note in what I've saved, so nothing was removed.` };
    const done = lastJson((await run(["forget", "--apply", pick.id])).stdout);
    if (!done?.archived?.length)
        return { ...out, text: "I couldn't remove that note, so it's still saved." };
    return { ...out, text: `Removed the note: "${preview(label)}". It's archived, so it can be restored if you change your mind.`, removed: [{ kind: "note", label, at: deps.now }] };
}
/** Cancels the reminders whose label names every word given; says which, then reads the store again to confirm they are gone. */
export async function removeReminder(deps, labels, words) {
    const out = blank();
    if (!deps.reminders)
        return { ...out, text: "I can't reach your reminders right now, so nothing was cancelled." };
    const live = await deps.reminders.list().catch(() => []);
    const matched = live.filter((r) => labels.some((l) => (words ? namesLabel(words, r.label) : r.label.trim().toLowerCase() === l.trim().toLowerCase() || namesLabel(contentWords(l), r.label))));
    if (!matched.length)
        return { ...out, text: `I couldn't find a reminder called ${labels.join(" or ")}, so nothing was cancelled.` };
    if (matched.length > 1 && words)
        return { ...out, text: `Which one? ${matched.map((r) => r.label).join(", ")}.` };
    const ids = matched.map((r) => r.id);
    await deps.reminders.remove(ids).catch(() => undefined);
    out.calls.push(`reminder store remove ${ids.join(",")}`);
    const after = await deps.reminders.list().catch(() => live);
    const left = matched.filter((r) => after.some((a) => a.id === r.id));
    out.outputs.push(JSON.stringify({ removed: ids.length - left.length }));
    if (left.length)
        return { ...out, text: `I tried to cancel ${left.map((r) => r.label).join(" and ")} but it's still set, so check your reminders.` };
    return { ...out, text: `Cancelled the reminder${matched.length > 1 ? "s" : ""}: ${matched.map((r) => r.label).join(" and ")}.`,
        removed: matched.map((r) => ({ kind: "reminder", label: r.label, at: deps.now })) };
}
/** Words that make "remove X" a calendar, list or reminder ask, never a meal. */
const NOT_A_MEAL = /\b(?:tomorrow|tonight|calendar|block|schedule|session|meeting|class|lecture|gym|workout|plan|day|reminder|alarm|timer|list|todo|task|event|focus|break|note)\b/;
const FOODISH = /\b(?:eggs?|toast|banana|bananas|apple|chicken|rice|bread|cheese|burger|burrito|wrap|pizza|sandwich|salad|cereal|yoghurt|yogurt|porridge|oats|coffee|tea|milk|fries|chips|bar|snack|fruit|soup|steak|fish|sushi|noodles|biscuits?|cookies?|cake|chocolate|crisps|smoothie|shake|coke|juice)\b/;
/**
 * "remove the eggs": the food path is taken only when the named thing IS in today's food log, or is plainly a food and nothing on the calendar
 * matches. A name on both ("dinner") is asked about; anything else (a haircut, a nap, a call) is undefined, so the calendar / ledger flows have it.
 * The removal is journaled by orion-log, so "undo" puts the entry back.
 */
export async function removeFoodByWords(deps, words, said) {
    if (!words.length || NOT_A_MEAL.test(said.toLowerCase()))
        return undefined;
    const titles = deps.foodToday ? await deps.foodToday().catch(() => []) : [];
    const entry = titles.some((t) => namesLabel(words, t));
    const day = deps.readDay ? await deps.readDay([]).catch(() => undefined) : undefined;
    const calendar = (day?.blocks ?? []).some((b) => namesLabel(words, b.title));
    const shown = (said.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((t) => words.includes(contentWords(t)[0] ?? "")).join(" ") || words.join(" ");
    const out = blank();
    out.calls.push("read health-log.json nutritionLog");
    out.outputs.push(JSON.stringify({ titles: titles.length, calendar })); // a read, so the ledger owns this reply
    if (entry && calendar)
        return { ...out, text: `${shown} is on your calendar and in your food log, so I haven't removed either. Say "remove the ${shown} meal" or "cancel the ${shown} block".` };
    if (!entry && (calendar || !(deps.foodRecent && FOODISH.test(said.toLowerCase()))))
        return undefined;
    if (!entry)
        return { ...out, text: `I don't have ${shown} in today's food log, so nothing was taken off.` };
    const r = await deps.run("orion-log", ["food-off", ...words]).catch(() => ({ stdout: "", code: 1 }));
    out.calls.push(`exec orion-log food-off ${words.join(" ")}`);
    out.outputs.push(r.stdout);
    if (r.code === 0 && /^Took /.test(r.stdout.trim()))
        return { ...out, text: `${r.stdout.trim()} Say "undo" to put it back.`, removed: [{ kind: "food", label: words.join(" "), at: deps.now }] };
    return { ...out, text: `I couldn't take ${shown} off the food log: ${r.stdout.trim() || "the health log didn't answer"}.` };
}
