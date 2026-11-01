import { ampm, toMin } from "./intent-time.js";
import { refused, sideNotes, wrote } from "./scheduler-out.js";
import { bookedSpan } from "./lighten-said.js";
import { soonDeadlines } from "./day-lighten.js";
const MIN_SPAN = 25;
const STUDY_CAP = 120;
const hhmm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const ceil5 = (n) => Math.ceil(n / 5) * 5;
const short = (t) => t.replace(/\s+[—–-]\s+.*$/, "").trim();
/** The classes `orion-reschedule classes-off` printed as cancelled, with their spans. */
export function cancelledFrom(stdout) {
    return [...stdout.matchAll(/cancelled (.+?) (\d{2}:\d{2})[–-](\d{2}:\d{2})/g)].map((m) => ({ title: m[1].trim(), start: m[2], end: m[3] }));
}
const has = (day, kind, nowMin) => day.blocks.some((b) => b.kind === kind && toMin(b.end) > nowMin);
/** REV6 item 6: any gym block today counts, finished or not (a 7 AM gym already done is still today's gym). */
const hasAnyToday = (day, kind) => day.blocks.some((b) => b.kind === kind);
/** What goes where in the freed time, in priority order. Pure. */
export function planFreedTime(ctx) {
    const buffer = ctx.day.plan?.bufferMinutes ?? 5;
    const spans = ctx.cancelled
        .map((c) => ({ from: Math.max(toMin(c.start), ceil5(ctx.nowMin)), to: toMin(c.end), cls: short(c.title) }))
        .filter((s) => s.to - s.from >= MIN_SPAN)
        .sort((a, b) => a.from - b.from);
    const plans = [];
    const gymMinutes = ctx.day.plan?.anchors.find((a) => /\bgym\b/i.test(a.title))?.minutes ?? 90;
    if (!hasAnyToday(ctx.day, "gym")) {
        const room = spans.find((s) => s.to - s.from >= gymMinutes);
        if (room) {
            plans.push({ title: "Gym", minutes: gymMinutes, start: hhmm(room.from), why: "gym" });
            room.from += gymMinutes + buffer;
        }
    }
    let sideWanted = !has(ctx.day, "side_project", ctx.nowMin);
    spans.forEach((s, i) => {
        const left = s.to - s.from;
        if (left < MIN_SPAN)
            return;
        const deadline = ctx.deadlines.length ? ctx.deadlines[i % ctx.deadlines.length] : undefined;
        const minutes = Math.min(left, STUDY_CAP);
        plans.push({ title: deadline ? `Study for ${deadline}` : `Study ${s.cls}`, minutes, start: hhmm(s.from), why: deadline ? "deadline" : "study" });
        const after = s.from + minutes + buffer;
        if (sideWanted && s.to - after >= 60) {
            plans.push({ title: "Side project", minutes: 60, start: hhmm(after), why: "side_project" });
            sideWanted = false;
        }
    });
    return plans.sort((a, b) => toMin(a.start) - toMin(b.start));
}
/** The one scheduler call that books them. */
export const freedArgs = (plans) => ["day", ...plans.flatMap((p) => ["--plan", `${p.title.replace(/,/g, " ")}, ${p.minutes}, ${p.start}`])];
const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const span = (s) => `${ampm(toMin(s.start))}–${ampm(toMin(s.end))}`;
/** What he hears about the freed time: read back from the day after the write, the assumption made, gym, and every other change. */
export function freedReply(plans, ctx) {
    const booked = plans.map((p) => { const s = bookedSpan(p.title, ctx.outputs.join("\n"), ctx.after); return s ? `${p.title} ${span(s)}` : undefined; }).filter((x) => !!x);
    if (!booked.length)
        return "";
    const due = [...new Set(plans.filter((p) => p.why === "deadline").map((p) => p.title.replace(/^Study for /, "")))];
    const why = due.length ? ` (${listed(due)} ${due.length > 1 ? "are" : "is"} what's due soonest)`
        : plans.some((p) => p.why === "study") ? " (study for those classes, since nothing on your list is due sooner; tell me if you'd rather use it for something else)" : "";
    const gymBefore = ctx.before.blocks.find((b) => b.kind === "gym");
    const gymAfter = ctx.after?.blocks.find((b) => b.kind === "gym");
    const gym = plans.some((p) => p.why === "gym") ? "" : gymAfter && gymBefore && gymAfter.start === gymBefore.start ? ` Gym stays at ${ampm(toMin(gymAfter.start))}.` : "";
    const said = `${booked.join(" ")} ${plans.map((p) => p.title).join(" ")}`;
    const also = sideNotes(said, ctx.outputs);
    return ` In the freed time: ${listed(booked)}${why}.${gym}${also.length ? ` Also: ${also.join("; ")}.` : ""}`;
}
/** Plans and books the freed time, and says it. Nothing to plan (the time is past) or a refused write says so plainly. */
export async function fillFreedTime(deps) {
    const nowMin = deps.now.getHours() * 60 + deps.now.getMinutes();
    const read = deps.readDeadlines ? await deps.readDeadlines().catch(() => undefined) : undefined;
    const deadlines = soonDeadlines(read ?? null, deps.now).map((d) => d.title);
    const plans = planFreedTime({ day: deps.day, cancelled: cancelledFrom(deps.offStdout), nowMin, deadlines });
    if (!plans.length)
        return { text: " That time is already behind you, so there was nothing left of it to plan.", calls: [], outputs: [], writes: 0 };
    const args = freedArgs(plans);
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const calls = [`exec orion-reschedule ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`];
    if (refused(out) || !wrote(out))
        return { text: " I couldn't plan the freed time just now, so nothing else changed.", calls, outputs: [out.stdout], writes: 0 };
    const shown = await deps.run("orion-reschedule", ["show", "--json"]).catch(() => ({ stdout: "", code: 1 }));
    let after;
    try {
        const d = JSON.parse(shown.stdout);
        after = Array.isArray(d?.blocks) ? d : undefined;
    }
    catch {
        after = undefined;
    }
    const text = freedReply(plans, { before: deps.day, ...(after ? { after } : {}), outputs: [out.stdout], deadlines });
    return { text: text || " I planned the freed time.", calls, outputs: [out.stdout], writes: 1 };
}
