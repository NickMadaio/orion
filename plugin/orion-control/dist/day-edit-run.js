import { pickClock, pickRange } from "./day-edit-time.js";
import { ampm as ampmFull, hhmm, toMin } from "./intent-time.js";
import { blocksNamedBy, pickByTime } from "./block-names.js";
import { noteOf, refused } from "./scheduler-out.js";
import { whyNot } from "./day-requests.js";
import { failureReason } from "./schedule-failure.js";
import { forgetEdit, rememberEdit, rememberRun } from "./day-edit-memory.js";
import { nextWake } from "./wake-state.js";
import { applyBedChange } from "./bedtime-change.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const DAY_ARGS = { today: [], tomorrow: ["--date", "tomorrow"], yesterday: ["--date", "yesterday"] };
/** Before 7 AM: a bare hour on another day is read as one still awake for (7-11 morning, 12 noon, 1-6 evening). */
const DAYTIME_FLOOR = 6 * 60 + 59;
const LOG_AHEAD = 180;
/** "7 PM", "9:30 PM": the way he says it. */
const ampm = (m) => ampmFull(m).replace(":00", "");
const spanText = (a, b) => { const [x, y] = [ampm(a), ampm(b)]; return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`; };
const CAP = (t) => t.replace(/^./, (c) => c.toUpperCase());
const DEFAULT_MIN = [[/lunch/, 30], [/dinner|supper/, 45], [/breakfast/, 20], [/nap/, 45], [/call|chat/, 30], [/walk|tube|commute|train/, 30], [/gym|workout|lift|run/, 60]];
const defaultMinutes = (name) => DEFAULT_MIN.find(([re]) => re.test(name))?.[1] ?? 60;
const ANCHOR_END = [[/lunch/, 13 * 60 + 30], [/dinner|supper/, 19 * 60 + 30], [/breakfast/, 9 * 60]];
const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
async function dayOf(ctx, ref) {
    const { deps } = ctx;
    let day;
    try {
        day = ref === "today" ? await deps.readDay() : deps.readDayOn ? await deps.readDayOn(DAY_ARGS[ref]) : undefined;
    }
    catch {
        day = undefined;
    }
    if (!day && (ref === "today" || deps.readDayOn))
        ctx.unread.add(ref);
    return day;
}
const NO_READ = "I couldn't read your calendar just now";
/** The day could not be read: said, and nothing is changed on a guess about what is on it. */
const unreadable = (ctx, ref, what) => {
    if (!ctx.unread.has(ref))
        return false;
    ctx.failed.push(`${what} (${NO_READ})`);
    return true;
};
const blockNamed = (name, day, now) => {
    const found = blocksNamedBy(name, (day?.blocks ?? []).filter((b) => b.kind !== "commute"));
    return found.length ? pickByTime(found, now) : undefined;
};
async function exec(ctx, script, args) {
    const out = await ctx.deps.run(script, args).catch(() => ({ stdout: "", code: 1 }));
    ctx.calls.push(`exec ${script} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    ctx.outputs.push(out.stdout);
    return out;
}
/** A run that wrote: counts one undo, collects what else it moved. False (with the reason said) when it did not. */
function settle(ctx, out, said, what, start) {
    const fail = (why) => { ctx.failed.push(`${what}${why ? ` (${why})` : ""}`); const f = failureReason(out.stdout, { what: said, ...(ctx.bedtime ? { bedtime: ctx.bedtime } : {}), ...(start !== undefined ? { start } : {}) }); if (f)
        ctx.failures.push(f); };
    if (refused(out) || out.code !== 0) {
        const why = whyNot(out.stdout);
        fail(why);
        return false;
    }
    const missed = out.stdout.split("\n").map((l) => l.trim()).some((l) => /^(?:MUST-HAVE )?NOT BOOKED: /.test(l) && l.toLowerCase().includes(said.toLowerCase().split(" ")[0]));
    if (missed) {
        fail("there wasn't room for it");
        return false;
    }
    ctx.writes += 1;
    for (const l of out.stdout.split("\n").map((x) => x.trim())) {
        const n = noteOf(l);
        if (n && !n[0].toLowerCase().includes(said.toLowerCase()))
            ctx.sides.push(n[1]);
    }
    return true;
}
const rangeFor = (s, now, ref, mode) => pickRange(s.a, s.b, ref === "today" ? now : ref === "yesterday" ? 1440 : DAYTIME_FLOOR, ref === "tomorrow" ? "future" : mode);
const clockFor = (s, now, ref, mode, near) => pickClock(s, ref === "today" ? now : ref === "yesterday" ? 1440 : DAYTIME_FLOOR, ref === "tomorrow" ? "future" : mode, near);
/** Writes what really happened. `instead` is only passed for a block his time overlaps or that already started (the scheduler asks otherwise). */
async function logIt(ctx, ref, title, from, to, instead) {
    const cap = ref === "today" ? Math.min(to, ctx.nowMin + LOG_AHEAD) : to;
    const usable = instead && (ref !== "today" || (toMin(instead.start) < cap && from < toMin(instead.end)) || toMin(instead.start) <= ctx.nowMin) && !instead.fixed;
    const out = await exec(ctx, "orion-reschedule", ["log", title, "--from", hhmm(from), "--to", hhmm(cap), ...(usable ? ["--instead", instead.title] : []), ...DAY_ARGS[ref]]);
    const ok = settle(ctx, out, title, `log ${title}`, from);
    if (ok)
        ctx.done.push(`logged ${title.toLowerCase()} ${spanText(from, cap)}${ref === "yesterday" ? " yesterday" : ""}${usable ? ` instead of ${instead.title.replace(/\s+[—–-].*$/, "")}` : ""}`);
    return ok;
}
async function addPart(ctx, p) {
    const title = CAP(p.name);
    const day = p.day === "today" || p.after ? await dayOf(ctx, p.day) : undefined;
    if (p.after && unreadable(ctx, p.day, `add ${p.name} after ${p.after}`))
        return;
    let from;
    let to;
    if (p.span) {
        const r = rangeFor(p.span, ctx.nowMin, p.day, "future");
        if (!r) {
            ctx.failed.push(`add ${p.name} (I couldn't read those times)`);
            return;
        }
        from = r.from;
        to = r.to;
    }
    else {
        const mins = p.minutes ?? defaultMinutes(p.name);
        if (p.at)
            from = clockFor(p.at, ctx.nowMin, p.day, "future");
        else {
            const anchor = p.after ? blockNamed(p.after, day, ctx.nowMin) : undefined;
            const dflt = p.after ? ANCHOR_END.find(([re]) => re.test(p.after))?.[1] : undefined;
            const lastClass = !anchor && /class|lecture|seminar|lab/.test(p.after ?? "") ? [...(day?.blocks ?? [])].filter((b) => b.kind === "class").sort((a, b) => toMin(b.end) - toMin(a.end))[0] : undefined;
            const end = anchor ? toMin(anchor.end) : lastClass ? toMin(lastClass.end) : dflt;
            if (end === undefined) {
                ctx.failed.push(`add ${p.name} after ${p.after} (I can't see ${p.after} on that day, so tell me a time)`);
                return;
            }
            from = end;
        }
        to = from + mins;
    }
    if (p.day !== "today" ? p.day === "yesterday" : from < ctx.nowMin) {
        const seen = day ?? await dayOf(ctx, p.day);
        if (unreadable(ctx, p.day, `log ${p.name}`))
            return; // writing the past blind could double a block that is already there
        await logIt(ctx, p.day, title, from, to, blockNamed(p.name, seen, ctx.nowMin));
        return;
    }
    const out = await exec(ctx, "orion-reschedule", ["add", title, String(to - from), "--at", hhmm(from), "--length-explicit", ...DAY_ARGS[p.day]]);
    if (settle(ctx, out, title, `add ${p.name}`, from))
        ctx.done.push(`put ${title.toLowerCase()} at ${spanText(from, to)}${p.day === "tomorrow" ? " tomorrow" : ""}`);
}
async function movePart(ctx, p) {
    const day = await dayOf(ctx, p.day);
    const block = blockNamed(p.name, day, ctx.nowMin);
    if (!block && unreadable(ctx, p.day, `move ${p.name}`))
        return;
    if (!block) {
        // nothing by that name that day: his words still say when it was (or will be), so it goes on the day there
        const from = clockFor(p.to, ctx.nowMin, p.day, p.day === "today" ? "past" : "future");
        const len = defaultMinutes(p.name);
        if (p.day === "today" ? from + 0 <= ctx.nowMin : p.day === "yesterday") {
            if (await logIt(ctx, p.day, CAP(p.name), from, from + len))
                ctx.done[ctx.done.length - 1] += " (it wasn't on the plan)";
            return;
        }
        const out = await exec(ctx, "orion-reschedule", ["add", CAP(p.name), String(len), "--at", hhmm(from), "--length-explicit", ...DAY_ARGS[p.day]]);
        if (settle(ctx, out, p.name, `move ${p.name}`))
            ctx.done.push(`put ${p.name} at ${ampm(from)} (it wasn't on the plan)`);
        return;
    }
    const start = toMin(block.start);
    const len = toMin(block.end) - start;
    const behind = p.day === "yesterday" || (p.day === "today" && start <= ctx.nowMin);
    const to = clockFor(p.to, ctx.nowMin, p.day, behind ? "past" : "future", behind ? start : undefined);
    const short = block.title.replace(/\s+[—–-].*$/, "");
    if (behind || (p.day === "today" && to < ctx.nowMin)) {
        if (await logIt(ctx, p.day, block.title, to, to + len, block))
            ctx.done[ctx.done.length - 1] = `moved ${short} to ${spanText(to, Math.min(to + len, p.day === "today" ? ctx.nowMin + LOG_AHEAD : to + len))}`;
        return;
    }
    const out = await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(to), ...DAY_ARGS[p.day]]);
    if (settle(ctx, out, block.title, `move ${short}`))
        ctx.done.push(`moved ${short} to ${ampm(to)}`);
}
async function dropPart(ctx, p) {
    const day = await dayOf(ctx, p.day);
    const block = blockNamed(p.name, day, ctx.nowMin);
    if (!block && unreadable(ctx, p.day, `clear ${p.name}`))
        return;
    if (!block) {
        ctx.failed.push(`clear ${p.name} (I can't see it on ${p.day === "today" ? "today's" : p.day === "tomorrow" ? "tomorrow's" : "yesterday's"} plan)`);
        return;
    }
    const started = p.day === "today" && toMin(block.start) <= ctx.nowMin;
    const out = await exec(ctx, "orion-reschedule", started ? ["displace", block.title, "--why", "skip"] : ["drop", block.title, ...DAY_ARGS[p.day]]);
    const short = block.title.replace(/\s+[—–-].*$/, "");
    if (settle(ctx, out, block.title, `clear ${short}`))
        ctx.done.push(started ? `marked ${short} as skipped` : `took ${short} off ${p.day === "today" ? "today" : p.day}`);
}
async function didntPart(ctx, p) {
    const day = await dayOf(ctx, "today");
    const block = blockNamed(p.name, day, ctx.nowMin);
    const range = p.span ? rangeFor(p.span, ctx.nowMin, "today", "past") : null;
    if (!block && unreadable(ctx, "today", `change ${p.name}`))
        return;
    if (!block) {
        if (p.did && range)
            await logIt(ctx, "today", CAP(p.did), range.from, range.to);
        else
            ctx.failed.push(`change ${p.name} (I can't see it on today's plan)`);
        return;
    }
    const short = block.title.replace(/\s+[—–-].*$/, "");
    const start = toMin(block.start);
    if (!p.did) {
        await dropPart(ctx, { op: "drop", name: p.name, day: "today" });
        return;
    }
    const from = range?.from ?? start;
    const to = range?.to ?? Math.min(toMin(block.end), Math.max(ctx.nowMin, start + 5));
    if (!range && start > ctx.nowMin) {
        await dropPart(ctx, { op: "drop", name: p.name, day: "today" });
        ctx.failed.push(`log ${p.did} (${short} hasn't started yet, so give me the times)`);
        return;
    }
    await logIt(ctx, "today", CAP(p.did), from, to, block);
}
async function bedtimePart(ctx, p) {
    const s = p.to;
    const raw = s.exact ? s.h * 60 + s.m + (s.ap === "p" && s.h < 12 ? 720 : 0) : s.h >= 6 && s.h <= 11 ? s.h * 60 + s.m + 720 : s.h === 12 ? s.m : s.h * 60 + s.m;
    const at = s.ap ? (s.h % 12) * 60 + (s.ap === "p" ? 720 : 0) + s.m : raw % 1440;
    // One writer, one read-back (bedtime-change.ts): "push sleep to 11:45" is that night only; the line says what the files now hold.
    const r = await applyBedChange({ time: hhmm(at), scope: p.scope ?? "tonight" }, async (args) => { const o = await exec(ctx, "orion-sleepplan", args); return { stdout: o.stdout, code: o.code }; });
    if (r.ok)
        ctx.done.push(`set your bedtime to ${ampm(toMin(r.readback.sleepBy))} ${r.readback.tonightOnly ? "tonight" : "every night from now on"} (wind-down ${ampm(toMin(r.readback.nudgeAt))}, ${r.readback.hours}h of sleep before your ${ampm(toMin(r.readback.wake))} alarm)`);
    else
        ctx.failed.push(`change your bedtime (${r.error.slice(0, 80)})`);
}
async function busyPart(ctx, p) {
    const from = Math.ceil(ctx.nowMin / 5) * 5;
    const until = clockFor(p.until, ctx.nowMin, "today", "future");
    if (until <= from + 5) {
        ctx.failed.push("push your day back (that time is basically now)");
        return;
    }
    const out = await exec(ctx, "orion-reschedule", ["busy", `${hhmm(from)}-${hhmm(until)}`, "--why", "running late, back later"]);
    if (settle(ctx, out, "busy", "push the day back"))
        ctx.done.push(`blocked ${spanText(from, until)} and moved the rest of today around it`);
}
const clock12 = (hhmmText) => ampm(toMin(hhmmText));
/** "i went to bed at 2 last night": kept as a fact he told me (orion-declare note), so the sleep is on record; the reply says exactly that. */
async function sleptPart(ctx, p) {
    const out = await ctx.deps.run("orion-declare", ["add", "--kind", "note", "--text", p.text.slice(0, 200), "--source", ctx.deps.source]).catch(() => ({ stdout: "", code: 1 }));
    ctx.calls.push("exec orion-declare add --kind note");
    ctx.outputs.push(out.stdout);
    let id;
    try {
        id = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "").id;
    }
    catch {
        id = undefined;
    }
    if (out.code === 0 && typeof id === "string") {
        ctx.facts.push(id);
        ctx.done.push(`noted that ${p.text.replace(/^i /, "you ").replace(/\bi'm\b/g, "you're")}`);
    }
    else
        ctx.failed.push("note when you went to bed");
}
/** "wake me at 6": orion-wake sets the alarm; the line is said only when it answered that it did. */
async function wakePart(ctx, p) {
    const wake = ctx.deps.wake;
    if (!wake) {
        ctx.failed.push(`set your wake alarm for ${clock12(p.time)} (I can't reach the alarm from here, so ask me for it on its own)`);
        return;
    }
    const out = await wake([p.time]).catch(() => ({ stdout: "", code: 1 }));
    ctx.calls.push(`exec orion-wake ${p.time}`);
    ctx.outputs.push(out.stdout);
    if (out.code === 0 && /^Sent to/.test(out.stdout.trim()))
        ctx.done.push(`set your wake alarm for ${clock12(p.time)}`);
    else if (out.code === 0 && /^Saved an alarm/.test(out.stdout.trim()))
        ctx.failed.push(`reach your phone with the ${clock12(p.time)} wake alarm (saved on the Mac, but the phone link isn't running)`);
    else
        ctx.failed.push(`set your wake alarm for ${clock12(p.time)} (${out.stdout.trim().split("\n")[0]?.replace(/^orion-wake:\s*/, "").slice(0, 80) || "no reply from the alarm"})`);
}
/** "ate at 4": his food log's. Whatever it answers is said as its own; when it cannot read it, that is said plainly. */
async function foodPart(ctx, p) {
    const said = ctx.deps.food ? await ctx.deps.food(p.text).catch(() => undefined) : undefined;
    if (said)
        ctx.extra.push(said);
    else
        ctx.failed.push("log what you ate (tell me what it was and I'll log it)");
}
/** "i want six hours of sleep": the bedtime that leaves that long before his next alarm, set through the bedtime entry. */
async function sleepHoursPart(ctx, p) {
    const next = nextWake(ctx.deps.stateDir, ctx.deps.now);
    if (!next) {
        ctx.failed.push(`plan ${p.hours} hours of sleep (I can't see an alarm to count back from, so tell me the bedtime you want)`);
        return;
    }
    const at = (((next.at.getHours() * 60 + next.at.getMinutes() - p.hours * 60) % 1440) + 1440) % 1440;
    await bedtimePart(ctx, { op: "bedtime", to: { h: Math.floor(at / 60), m: at % 60, exact: true } });
}
/** His bedtime from life-config.json when it names one (HH:MM); the computed one is not on disk. Best effort. */
function bedtimeOf(deps) {
    if (!deps.stateDir)
        return undefined;
    try {
        const b = JSON.parse(readFileSync(join(deps.stateDir, "life-config.json"), "utf8")).bedtime;
        return typeof b === "string" && /^\d{2}:\d{2}$/.test(b) ? b : undefined;
    }
    catch {
        return undefined;
    }
}
export async function runDayEdit(edit, deps) {
    const ctx = { deps, nowMin: deps.now.getHours() * 60 + deps.now.getMinutes(), calls: [], outputs: [], done: [], failed: [], sides: [], writes: 0, failures: [], unread: new Set(), extra: [], facts: [], ...(bedtimeOf(deps) ? { bedtime: bedtimeOf(deps) } : {}) };
    const notes = [];
    const refused = [];
    for (const p of edit.parts) {
        const failedBefore = ctx.failed.length;
        if (p.op === "add")
            await addPart(ctx, p);
        else if (p.op === "log") {
            const day = await dayOf(ctx, p.day);
            const r = p.span ? rangeFor(p.span, ctx.nowMin, p.day, "past") : null;
            const end = p.day === "today" ? ctx.nowMin : 1440;
            const from = r?.from ?? end - (p.minutes ?? 30);
            const to = r?.to ?? end;
            const block = blockNamed(p.name, day, ctx.nowMin);
            if (p.span && !r)
                ctx.failed.push(`log ${p.name} (I couldn't read those times)`);
            else
                await logIt(ctx, p.day, CAP(p.name), from, to, block);
        }
        else if (p.op === "move")
            await movePart(ctx, p);
        else if (p.op === "drop")
            await dropPart(ctx, p);
        else if (p.op === "didnt")
            await didntPart(ctx, p);
        else if (p.op === "bedtime")
            await bedtimePart(ctx, p);
        else if (p.op === "busy")
            await busyPart(ctx, p);
        else if (p.op === "slept")
            await sleptPart(ctx, p);
        else if (p.op === "wake")
            await wakePart(ctx, p);
        else if (p.op === "food")
            await foodPart(ctx, p);
        else if (p.op === "sleephours")
            await sleepHoursPart(ctx, p);
        else
            notes.push(p.text);
        if (ctx.failed.length > failedBefore)
            refused.push(p);
    }
    // "anyway" later re-runs only what was refused, never what already worked
    if (refused.length)
        rememberEdit({ parts: refused }, deps.now);
    else
        forgetEdit();
    rememberRun(ctx.writes, ctx.facts, deps.now);
    const bits = [];
    if (ctx.done.length)
        bits.push(`I ${list(ctx.done)}.`);
    if (ctx.failed.length)
        bits.push(`I couldn't ${list(ctx.failed)}, so ${ctx.done.length ? "that part is" : "nothing is"} unchanged.`);
    const side = [...new Set(ctx.sides)].slice(0, 2);
    if (side.length && ctx.done.length)
        bits.push(`That also moved ${list(side)}.`);
    bits.push(...ctx.extra.map((x) => (/[.!]$/.test(x) ? x : `${x}.`)), ...notes.map((n) => `${n}.`));
    const text = bits.join(" ");
    const flow = ctx.writes || ctx.done.length
        ? { outcome: "done", calls: ctx.calls, outputs: ctx.outputs, reply: text, ...(ctx.failed.length ? { partial: true } : {}), ...(ctx.failures.length ? { failures: ctx.failures } : {}) }
        : { outcome: "say", kind: "plain", text: text || "I couldn't read that as a change to your day, so nothing changed.", calls: ctx.calls, outputs: ctx.outputs, ...(ctx.failures.length ? { failures: ctx.failures } : {}) };
    return { flow, facts: ctx.facts, writes: ctx.writes };
}
