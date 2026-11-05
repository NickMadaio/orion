import { refused, sideNotes } from "./scheduler-out.js";
import { whyNot } from "./day-requests.js";
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const ampm = (t) => { const h = Math.floor(toMin(t) / 60) % 24; return `${(h + 11) % 12 + 1}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`; };
const label = (b) => b.title.replace(/\s+[—–-].*$/, "");
const isBreak = (b) => /^break$/i.test(b.title.trim());
export async function breakOnCalendar(move, deps) {
    const out = { calls: [], outputs: [], writes: 0 };
    const nowMin = deps.now.getHours() * 60 + deps.now.getMinutes();
    const before = await deps.readDay().catch(() => undefined);
    if (!before)
        return { ...out, note: "I couldn't read your calendar just now, so your schedule is unchanged." };
    const under = before.blocks.find((b) => isBreak(b) && toMin(b.start) <= nowMin && toMin(b.end) > nowMin);
    if (under)
        return { ...out, line: `You're already on a break till ${ampm(under.end)}, so I haven't added another.` };
    const args = ["now", `Break, ${move.minutes}`];
    const ran = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    out.calls.push(`exec orion-reschedule now "Break, ${move.minutes}"`);
    out.outputs.push(ran.stdout);
    if (refused(ran)) {
        const why = whyNot(ran.stdout);
        return { ...out, note: `I couldn't put the break on your calendar${why ? ` (${why})` : ""}, so your schedule is unchanged.` };
    }
    out.writes = 1;
    const after = await deps.readDay().catch(() => undefined);
    if (!after)
        return { ...out, note: "I put the break on your calendar but couldn't read it back to check the times. Say \"undo\" to take it off." };
    const mine = after.blocks.filter((b) => isBreak(b) && toMin(b.end) > nowMin).sort((a, b) => Math.abs(toMin(a.start) - nowMin) - Math.abs(toMin(b.start) - nowMin))[0];
    if (!mine)
        return { ...out, note: "I tried to put the break on your calendar but can't see it there, so check your day." };
    const moved = after.blocks.filter((b) => !isBreak(b) && before.blocks.some((x) => x.title === b.title && (x.start !== b.start || x.end !== b.end)))
        .sort((a, b) => toMin(a.start) - toMin(b.start));
    const said = moved.slice(0, 3).map((b) => `${label(b)} now ${ampm(b.start)}–${ampm(b.end)}`);
    const more = moved.length > 3 ? ` and ${moved.length - 3} more moved` : "";
    const clash = after.blocks.find((b) => !isBreak(b) && (b.fixed || b.kind === "class") && toMin(b.start) < toMin(mine.end) && toMin(b.end) > toMin(mine.start));
    const clashNote = clash ? ` It runs into ${label(clash)} (${ampm(clash.start)}), which doesn't move, so you'll be back for it before the break is over.` : "";
    const sides = sideNotes(said.join(" "), [ran.stdout]).filter((n) => !/ \d{1,2}:\d{2} → /.test(n));
    out.line = `Break till ${ampm(mine.end)}.${said.length ? ` ${said.join("; ")}${more}.` : ""}${sides.length ? ` ${sides.join("; ")}.` : ""}${clashNote}`;
    return out;
}
