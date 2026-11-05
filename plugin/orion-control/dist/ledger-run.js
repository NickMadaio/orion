import { namesLabel, contentWords } from "./made-ledger.js";
import { removeNote, removeReminder } from "./ledger-remove.js";
/** How far back this chat's calendar change can still be what a bare "undo" takes back. */
export const CALENDAR_UNDO_WINDOW_MS = 2 * 3600_000;
const ampm = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmmOf = (iso) => { const d = iso ? new Date(iso) : undefined; return d && !Number.isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : undefined; };
const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const span = (b) => `${ampm(b.start)}–${ampm(b.end)}`;
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const acc = () => ({ text: "", calls: [], outputs: [], removed: [], wroteCalendar: false });
async function exec(deps, out, script, args) {
    const r = await deps.run(script, args).catch(() => ({ stdout: "", code: 1 }));
    out.calls.push(`exec ${script} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    out.outputs.push(r.stdout);
    return r;
}
/** The day for a date, today's by default; undefined when the calendar could not be read. */
async function dayFor(deps, date, cache) {
    const key = date && date !== ymd(new Date(deps.now)) ? date : "";
    if (!cache.has(key))
        cache.set(key, await deps.readDay(key ? ["--date", key] : []).catch(() => undefined));
    return cache.get(key);
}
const find = (day, title, near) => {
    const hits = (day?.blocks ?? []).filter((b) => same(b.title, title));
    return near ? hits.sort((a, b) => Math.abs(minutes(a.start) - minutes(near)) - Math.abs(minutes(b.start) - minutes(near)))[0] : hits[0];
};
/** The newest journal entry with steps, if it belongs to this chat (made after the chat's first change) and is recent. */
function topEntry(deps) {
    const top = [...deps.journal()].reverse().find((e) => (e.steps ?? []).length);
    const at = top?.at ? Date.parse(top.at) : NaN;
    if (!top || !deps.calendar || Number.isNaN(at) || at < deps.calendar.since - 5000 || deps.now - at > CALENDAR_UNDO_WINDOW_MS)
        return undefined;
    return top;
}
/** Puts the newest calendar change of this chat back, then says what the calendar now shows. */
async function undoCalendar(deps, words) {
    const out = acc();
    const top = topEntry(deps);
    if (!top)
        return { ...out, text: deps.nothingText };
    const steps = top.steps ?? [];
    const titles = steps.map((s) => s.title ?? "").filter(Boolean);
    if (words?.length && !words.every((g) => titles.some((t) => namesLabel(g, t)))) {
        const last = [...new Set(titles)].join(" and ");
        return { ...out, text: `The last thing I changed was ${last || "something else"}, not that, so I haven't touched anything. Say "undo" to put ${last || "it"} back first, or tell me the time you want.` };
    }
    const r = await exec(deps, out, "orion-reschedule", ["undo"]);
    if (r.code !== 0 || /^\s*Nothing to undo/i.test(r.stdout))
        return { ...out, text: r.code !== 0 ? "I couldn't undo that just now, so nothing was put back. Check your calendar." : deps.nothingText };
    out.wroteCalendar = true;
    const cache = new Map();
    const lines = [];
    const seen = new Set();
    let unread = false;
    for (const step of [...steps].reverse()) {
        const title = step.title ?? "";
        const key = `${step.op}:${title}`;
        if (!title || seen.has(key) || !["move", "delete", "create", "unskip"].includes(step.op ?? ""))
            continue;
        seen.add(key);
        const date = step.start ? ymd(new Date(step.start)) : undefined;
        const day = await dayFor(deps, date, cache);
        if (!day) {
            unread = true;
            continue;
        }
        const there = find(day, title, hhmmOf(step.start));
        if (step.op === "create")
            lines.push(there ? `${title} is still showing on your calendar after I took it off, so check it.` : `${title} is off your calendar.`);
        else if (!there)
            lines.push(`I put ${title} back but can't see it on your calendar, so check it.`);
        else if (step.op === "move")
            lines.push(`${title} is back at ${span(there)}.`);
        else if (step.op === "delete")
            lines.push(`${title} is back on your calendar at ${span(there)}.`);
        else
            lines.push(`${title} is no longer marked skipped; it's on your day at ${span(there)}.`);
    }
    const tail = unread ? " I couldn't read your calendar back to check the times." : "";
    return { ...out, text: lines.length || unread ? `${lines.join(" ")}${tail}`.trim() : `Undone: ${r.stdout.replace(/^Undone:?\s*/i, "").trim() || "the last change"}.` };
}
async function dropBlock(deps, title, dateArgs) {
    const out = acc();
    const r = await exec(deps, out, "orion-reschedule", ["drop", title, ...dateArgs]);
    if (r.code !== 0 || /NOTHING WAS/i.test(r.stdout)) {
        const why = r.stdout.split("\n").find((l) => /NOTHING WAS/i.test(l))?.replace(/^NOTHING WAS \w+( on \w+)?:\s*/i, "").trim();
        return { ...out, text: `I couldn't take ${title} off: ${why ? why.replace(/\.$/, "") : "the scheduler refused it"}. Nothing changed.` };
    }
    out.wroteCalendar = true;
    const day = await deps.readDay(dateArgs).catch(() => undefined);
    if (!day)
        return { ...out, text: `I took ${title} off, but couldn't read your calendar back to check it.` };
    return { ...out, text: find(day, title) ? `I tried to take ${title} off but it's still on your calendar, so check it.` : `${title} is off your day (it's gone from your calendar now).` };
}
async function removeItem(deps, item) {
    const out = acc();
    let result;
    if (item.kind === "block")
        result = await dropBlock(deps, item.label, item.dateArgs ?? []);
    else if (item.kind === "note")
        result = await removeNote(deps, item.label);
    else if (item.kind === "reminder")
        result = await removeReminder(deps, [item.label]);
    else if (item.kind === "water") {
        const r = await exec(deps, out, "orion-log", ["water-off", String(item.count ?? 1)]);
        result = { ...out, text: r.code === 0 ? r.stdout.trim() : `I couldn't take the water off: ${r.stdout.trim() || "the health log didn't answer"}.` };
    }
    else if (item.ids?.length) {
        const lines = [];
        for (const id of item.ids) {
            const r = await exec(deps, out, "orion-food-estimate", ["undo", id, "--json"]);
            try {
                const j = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");
                lines.push(j.ok ? `Took ${String(j.removed?.title ?? item.label).toLowerCase()} off; ${j.dayCalories} kcal today.` : `I couldn't take ${item.label} off.`);
            }
            catch {
                lines.push(`I couldn't take ${item.label} off.`);
            }
        }
        result = { ...out, text: lines.join(" ") };
    }
    else {
        const r = await exec(deps, out, "orion-log", ["food-off", ...contentWords(item.label)]);
        result = { ...out, text: r.code === 0 ? r.stdout.trim() : `I couldn't take ${item.label} off: ${r.stdout.trim() || "the health log didn't answer"}` };
    }
    const worked = result.wroteCalendar || !/^I couldn't|^I tried/.test(result.text);
    return { ...result, removed: worked ? [item] : [] };
}
const merge = (parts) => ({ text: parts.map((p) => p.text).filter(Boolean).join(" "), calls: parts.flatMap((p) => p.calls), outputs: parts.flatMap((p) => p.outputs),
    removed: parts.flatMap((p) => p.removed), wroteCalendar: parts.some((p) => p.wroteCalendar) });
/** One named thing he wants gone: this chat's ledger first, then the stores (reminders, his day's own made blocks, food, notes). */
async function removeNamed(ask, words, deps) {
    const kinds = ask.kinds;
    const pool = [...deps.items].reverse().filter((i) => (!kinds.length || kinds.includes(i.kind)) && (!words.length || namesLabel(words, i.label)));
    if (pool[0])
        return removeItem(deps, pool[0]);
    if (!words.length)
        return undefined;
    const out = acc();
    if ((!kinds.length || kinds.includes("reminder")) && deps.reminders) {
        const live = await deps.reminders.list().catch(() => []);
        if (live.some((r) => namesLabel(words, r.label)))
            return removeReminder(deps, [words.join(" ")], words);
    }
    if (!kinds.length || kinds.includes("block")) {
        const cache = new Map();
        for (const date of [undefined, "tomorrow"]) {
            const day = date ? await deps.readDay(["--date", date]).catch(() => undefined) : await dayFor(deps, undefined, cache);
            const block = day?.blocks.find((b) => b.made && namesLabel(words, b.title));
            if (block)
                return dropBlock(deps, block.title, date ? ["--date", date] : []);
        }
    }
    if (kinds.includes("food"))
        return removeItem(deps, { kind: "food", label: words.join(" "), at: deps.now });
    if (kinds.includes("note"))
        return removeNote(deps, words.join(" "));
    void out;
    return undefined;
}
/** The reply and effects for one ledger ask; undefined when a weak ask found nothing it owns (the turn goes on to the ordinary flows). */
export async function runLedgerAsk(ask, deps) {
    const pointingOnly = ask.pointing && !ask.targets.length && !ask.kinds.length;
    if (ask.bare || pointingOnly) {
        const newest = deps.items.at(-1);
        const calendarLast = deps.calendar && topEntry(deps) ? deps.calendar.last : 0;
        if (newest && newest.at >= calendarLast)
            return removeItem(deps, newest);
        return undoCalendar(deps);
    }
    if (ask.verb === "undo" && ask.kinds.length === 1 && ask.kinds[0] === "block" && !ask.pointing)
        return undoCalendar(deps, ask.targets);
    if (ask.verb === "undo" && ask.pointing && ask.kinds.includes("block"))
        return undoCalendar(deps);
    const groups = ask.targets.length ? ask.targets : [[]];
    const parts = [];
    let claimed = false;
    for (const words of groups) {
        const part = await removeNamed(ask, words, deps);
        if (part) {
            claimed = true;
            parts.push(part);
            continue;
        }
        if (ask.strong) {
            claimed = true;
            const what = words.length ? `"${words.join(" ")}"` : "that";
            parts.push({ ...acc(), text: `I haven't made anything like ${what} in this chat that I can take off, so nothing changed.` });
        }
        else
            parts.push({ ...acc(), text: `I couldn't find ${words.join(" ")} to take off.` });
    }
    if (!claimed)
        return undefined;
    const found = parts.filter((p) => p.removed.length || p.calls.length);
    if (!ask.strong && !found.length)
        return undefined;
    return merge(parts);
}
