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
