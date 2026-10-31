import { clockTimes } from "./pending-reply-read.js";
import { DAY_END, addCommand, blockNamed, clockOn, dayArgs, dayWord, firstFixed, flowText, flowWrote, freeSlot, h12, isProtected, moveCommand, nowAndNext, nowMinOf, placedAt, safeTitle, toMin, wakeDayIsToday, } from "./pending-reply-day.js";
import { namesBlock } from "./anchor-write-guard.js";
/** He said a time that has already gone today: nothing is written. */
const PAST_LINE = "That time's already gone today, so nothing changed. Give me a later one.";
/** The write went through but the calendar does not show the block where it was asked for: no time is claimed. */
const unseen = (title) => `The calendar took the change, but I can't see ${title} where I asked for it, so check it before you count on the time.`;
/** His own words name this block (a class or a plan with people moves only then). */
const named = (said, title) => !!said && namesBlock(said, { title, start: "00:00", end: "00:00", fixed: true });
const PROTECTED_LINE = (title) => `${title} is a class or a plan with people, so I won't move or rebook it on a guess. Tell me what to do with it, by name, and I will.`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
class Ctx {
    deps;
    turn;
    acc = { tools: [], marks: [], wrote: false };
    constructor(deps, turn) {
        this.deps = deps;
        this.turn = turn;
    }
    get now() { return this.deps.now; }
    get nowMin() { return nowMinOf(this.deps.now); }
    async day(which) {
        if (!this.deps.readDay)
            return undefined;
        const args = dayArgs(which, this.now);
        const d = await this.deps.readDay(args).catch(() => undefined);
        if (d)
            this.acc.tools.push({ canonical: `read day ${args.length ? "tomorrow" : "today"} (code)`, stdout: JSON.stringify(d).slice(0, 2000), exit: null });
        return d;
    }
    async schedule(command) {
        if (!this.deps.schedule)
            return undefined;
        const flow = await this.deps.schedule(command).catch((e) => ({ outcome: "fallback", reason: String(e) }));
        if ("calls" in flow && flow.calls)
            flow.calls.forEach((canonical, i) => this.acc.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
        if (flowWrote(flow)) {
            this.acc.wrote = true;
            this.acc.marks.push(...(flow.marks ?? []));
        }
        return flow;
    }
    async checkin(args) {
        if (!this.deps.checkin)
            return undefined;
        const out = await this.deps.checkin(args).catch(() => ({ stdout: "", code: 1 }));
        this.acc.tools.push({ canonical: `exec orion-checkin ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`, stdout: out.stdout, exit: out.code });
        if (out.code === 0 && args[0] !== "find" && args[0] !== "list" && args[0] !== "show")
            this.acc.wrote = true;
        return out;
    }
    /** The ONE open plan loop about `what`, by id (orion-checkin find); undefined for none or several. */
    async loopId(what) {
        const out = await this.checkin(["find", "--what", what]);
        try {
            const f = JSON.parse(out?.stdout.trim().split("\n").at(-1) ?? "");
            return out?.code === 0 && f.open && typeof f.id === "string" ? f.id : undefined;
        }
        catch {
            return undefined;
        }
    }
    /** Comes back in `minutes` about `what`: the open loop is deferred (no second ladder), else a new check-in. Returns when, or undefined. */
    async comeBack(what, minutes, because) {
        const id = await this.loopId(what);
        if (id) {
            const out = await this.checkin(["defer", String(minutes), id, "--because", because.slice(0, 120)]);
            if (!out || out.code !== 0)
                return undefined;
            const back = out.stdout.match(/back in (\d+) min/);
            return back ? { at: this.nowMin + Number(back[1]), id } : { at: this.nowMin + minutes, id, refused: true };
        }
        const out = await this.checkin(["add", String(minutes), what.slice(0, 120), "--because", because.slice(0, 120)]);
        if (!out || out.code !== 0)
            return undefined;
        const made = out.stdout.match(/\b(ci-[0-9a-f]+)\b/)?.[1];
        return made ? { at: this.nowMin + minutes, id: made } : { at: this.nowMin + minutes };
    }
    /** After a write: the start the calendar now shows for `title` (REV4 8: a reply about a time says the calendar's time, not the asked one). */
    async readBack(which, title, asked) {
        return placedAt(await this.day(which), title, asked);
    }
    done(text, memo) {
        const calls = this.acc.tools.map((t) => t.canonical);
        const outputs = this.acc.tools.map((t) => t.stdout);
        const flow = this.acc.wrote ? { outcome: "done", calls, outputs, marks: this.acc.marks, reply: text } : { outcome: "say", kind: "plain", text, ...(calls.length ? { calls, outputs } : {}) };
        return { flow, tools: this.acc.tools, marks: this.acc.marks, memo };
    }
}
/** His mornings start at 8 for a slot code picks (a time he says wins). */
const MORNING = 8 * 60;
const GYMLIKE = /\b(?:gym|workout|work out|lift|lifting|run|running|swim|training|walk)\b/i;
const RETURNING = { eating: "you ate", cooking: "food's done", "a shower": "you showered", "the call": "the call's done", "the bathroom": "you're back", laundry: "laundry's sorted" };
async function slotFor(c, minutes, d = {}, title) {
    const order = d.day ? [d.day] : ["today", "tomorrow"];
    for (const which of order) {
        const day = await c.day(which);
        const sameDay = which === "today" || wakeDayIsToday(c.now);
        const earliest = sameDay ? c.nowMin + 15 : 9 * 60;
        const range = d.part === "morning" ? [MORNING, 12 * 60] : d.part === "afternoon" ? [12 * 60, 17 * 60] : d.part === "evening" ? [17 * 60, DAY_END] : [earliest, DAY_END];
        const from = Math.max(range[0], earliest);
        const own = title ? blockNamed(day, title) : undefined;
        if (d.at !== undefined) {
            const t = clockOn(d.at, d.meridiem, which, c.now);
            return t === undefined ? { which, past: true } : { which, start: t };
        }
        if (d.after) {
            const anchor = blockNamed(day, d.after);
            if (anchor)
                return { which, start: toMin(anchor.end) + 5 };
            continue;
        }
        const start = freeSlot(day, minutes, from, range[1], own);
        if (start !== undefined)
            return { which, start };
    }
    return undefined;
}
// ---------------------------------------------------------------- per offer
async function start(c, title, r) {
    if (r.kind === "counter") {
        const at = r.details.at === undefined || r.details.day === "tomorrow" ? undefined : clockOn(r.details.at, r.details.meridiem, "today", c.now);
        if (at === undefined)
            return undefined;
        return start(c, title, { kind: "defer", minutes: at - c.nowMin });
    }
    if (r.kind === "defer" || r.kind === "awake") {
        const activity = r.activity;
        const minutes = r.minutes ?? (r.kind === "defer" ? r.typical : undefined) ?? (activity ? 25 : 15);
        const assumed = r.kind === "defer" && r.minutes === undefined;
        const back = await c.comeBack(title, minutes, c.turn.said ?? (activity ? `${activity} first` : "not yet")); // his words: orion-checkin reads the reason from them
        const lead = activity ? `Okay, ${activity} first — ${minutes} min${assumed ? " (my guess; say if it's longer)" : ""}.` : `Okay, ${minutes} min.`;
        if (!back)
            return c.done(`${lead} I couldn't set the check-in, so tell me when you're back and we start ${title}.`, { kind: "resume", title, ...(activity ? { activity } : {}), at: c.now.getTime() });
        if (back.refused)
            return c.done(`That's putting it off again, so ${title} stays on — start now, even 30 min counts.`, null);
        return c.done(`${lead} I'll come back at ${h12(back.at)} and we start ${title}.`, { kind: "resume", title, ...(activity ? { activity } : {}), at: c.now.getTime() });
    }
    if (r.kind === "done") {
        await c.checkin(["close", title]);
        return c.done(`Nice — ${title} done. I'll stop nudging about it.`, null);
    }
    if (r.kind === "accept" || r.kind === "resume")
        return begin(c, title, undefined, r.kind === "resume"); // a yes marks it started; only "back" starts a session
    if (r.kind === "indifferent")
        return c.done(`${cap(title)} is still waiting. Now, or in 15? Say which and I'll hold you to it.`, null);
    if (r.kind === "decline")
        return c.done(`Okay, not right now. When instead? Give me a time and I'll move ${title} there — it doesn't just drop.`, null);
    return undefined;
}
/** He is starting (or back from the pause): the loop is marked started, and a work block gets its focus session. */
async function begin(c, title, activity, back) {
    const id = await c.loopId(title);
    await c.checkin(id ? ["started", id] : ["started", title]);
    const opener = back ? `Okay, ${activity ? RETURNING[activity] ?? "you're back" : "you're back"} — now we start.` : "Good — go.";
    if (!back || GYMLIKE.test(title) || !c.deps.session)
        return c.done(`${opener} ${cap(title)} starts now; I'll check in that it's going.`, null);
    const flow = await c.deps.session(`start a focus session on ${title}`).catch((e) => ({ outcome: "fallback", reason: String(e) }));
    if ("calls" in flow && flow.calls)
        flow.calls.forEach((canonical, i) => c.acc.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
    if (flow.outcome === "done") {
        c.acc.wrote = true;
        return c.done(`${opener} ${flowText(flow) ?? `Focus session on ${title} started.`}`, null);
    }
    return c.done(`${opener} I couldn't start the focus session just now, so nothing is running — open ${title} and I'll check in that it's going.`, null);
}
async function leave(c, o, r) {
    if (r.kind === "accept")
        return c.done("Good, go.", null);
    const minutes = r.kind === "defer" && r.minutes ? Math.min(r.minutes, 30) : 5;
    const sent = c.turn.sentAt !== undefined ? nowMinOf(new Date(c.turn.sentAt)) : c.nowMin;
    const mustLeave = sent + o.leaveIn;
    const travel = o.classAt !== undefined ? o.classAt - mustLeave : 0;
    const leaveBy = c.nowMin + minutes;
    const late = o.classAt !== undefined ? leaveBy + travel - o.classAt : 0;
    const back = await c.comeBack(`leave for ${o.title}`, minutes, "hold on");
    const ping = back ? " I'll ping you then." : " I couldn't set the ping, so watch the clock.";
    const at = o.classAt !== undefined ? ` at ${h12(o.classAt)}` : "";
    if (late <= 0)
        return c.done(`Okay — ${h12(leaveBy)}, hard stop. That still gets you to ${o.title}${at}.${ping}`, null);
    return c.done(`${h12(leaveBy)} at the latest — that has you about ${late} min late to ${o.title}${at}, so move fast.${ping}`, null);
}
async function bedtime(c, r, memo) {
    const wake = await c.day("tomorrow");
    const anchor = firstFixed(wake);
    const anchorLine = anchor ? ` ${anchor.title} at ${h12(toMin(anchor.start))} stays.` : "";
    const when = dayWord("tomorrow", c.now) || "";
    let napped = memo?.napped ?? false;
    const nap = async () => {
        if (napped)
            return "";
        const from = anchor ? toMin(anchor.end) + 5 : 12 * 60;
        const start = freeSlot(wake, 30, Math.max(from, 12 * 60), 18 * 60);
        if (start === undefined)
            return "";
        const flow = await c.schedule(addCommand("nap", 30, "tomorrow", start, c.now));
        if (flowWrote(flow)) {
            napped = true;
            const seen = await c.readBack("tomorrow", "nap", start);
            return seen === undefined ? ` ${unseen("the nap")}` : ` I put a 30 min nap at ${h12(seen)}${when} so the short night doesn't wreck the day.`;
        }
        return "";
    };
    const memoOut = (extra = {}) => ({ kind: "bedtime", at: c.now.getTime(), ...(memo?.checkinId ? { checkinId: memo.checkinId } : {}), ...(memo?.checkinAt !== undefined ? { checkinAt: memo.checkinAt } : {}), napped, ...extra });
    if (r.kind === "workload" || (r.kind === "awake" && r.workload && !r.activity && r.minutes === undefined)) {
        const from = anchor ? toMin(anchor.end) + 5 : 10 * 60;
        const start = freeSlot(wake, 60, from, DAY_END);
        if (start === undefined)
            return c.done(`It'll keep till tomorrow — sleep matters more tonight.${anchorLine} Tell me what's due and I'll find it a slot.`, memoOut());
        const flow = await c.schedule(addCommand("catch-up work", 60, "tomorrow", start, c.now));
        if (!flowWrote(flow))
            return c.done(`${flowText(flow) ?? "I couldn't book the catch-up just now."} Either way, it keeps till tomorrow — sleep now.`, memoOut());
        const seen = await c.readBack("tomorrow", "catch-up work", start);
        if (seen === undefined)
            return c.done(`${unseen("the catch-up work")} Either way, it keeps till tomorrow — sleep now.`, memoOut());
        const right = anchor && seen === toMin(anchor.end) + 5 ? `, right after ${anchor.title}` : "";
        return c.done(`It'll keep — I put 60 min of catch-up work at ${h12(seen)}${when}${right}. Sleep now.${anchorLine}`, memoOut());
    }
    if (r.kind === "awake" && r.sleepless && !r.activity && r.minutes === undefined) {
        const napLine = await nap();
        return c.done(`Then don't fight it — lights off, phone away, just lie down; rest still counts.${napLine}${anchorLine}`, memoOut());
    }
    if (r.kind === "awake" || r.kind === "defer") {
        const minutes = r.minutes ?? 30;
        const assumed = r.minutes === undefined;
        const target = c.nowMin + minutes;
        const what = r.activity ? ` on ${r.activity}` : "";
        if (memo?.checkinAt !== undefined && Math.abs(memo.checkinAt - target) <= 10) {
            return c.done(`Deal — ${h12(memo.checkinAt)}, then bed. I'll check then.${anchorLine}`, memoOut());
        }
        const out = memo?.checkinId ? await c.checkin(["defer", String(minutes), memo.checkinId, "--because", r.activity ?? "staying up"]) : await c.checkin(["add", String(minutes), "bed", "--because", r.activity ?? "staying up"]);
        const id = memo?.checkinId ?? out?.stdout.match(/\b(ci-[0-9a-f]+)\b/)?.[1];
        const napLine = await nap();
        const check = out && out.code === 0 ? ` I'll check at ${h12(target)}.` : " I couldn't set the check-back, so set yourself a timer.";
        return c.done(`Okay — ${minutes} min${what}${assumed ? " (that's the cap)" : ""}, then bed.${check}${napLine}${anchorLine}`, memoOut({ ...(id ? { checkinId: id } : {}), ...(out?.code === 0 ? { checkinAt: target } : {}) }));
    }
    return undefined;
}
async function catchup(c, o, r) {
    if (r.kind === "decline")
        return c.done("Okay, leaving it — no catch-up booked.", null);
    const title = `${safeTitle(o.subject ?? "", "")} catch-up`.trim();
    const d = r.kind === "counter" ? r.details : {};
    const minutes = d.minutes ?? 60;
    const slot = await slotFor(c, minutes, d.after && !d.day ? { ...d, day: "tomorrow" } : d);
    if (!slot)
        return c.done(`I couldn't find a free ${minutes} min ${d.day ?? "today or tomorrow"}${d.after ? ` after ${d.after}` : ""}. Give me a time and I'll book ${title} there.`, null);
    if ("past" in slot)
        return c.done(PAST_LINE, null);
    const flow = await c.schedule(addCommand(title, minutes, slot.which, slot.start, c.now));
    if (!flowWrote(flow))
        return c.done(flowText(flow) ?? `I couldn't book ${title} just now, so nothing changed.`, null);
    const seen = await c.readBack(slot.which, title, slot.start);
    if (seen === undefined)
        return c.done(unseen(title), null);
    const picked = r.kind === "counter" ? "" : ` — I picked the first free ${minutes === 60 ? "hour" : `${minutes} min`}; say a time if you want it elsewhere`;
    return c.done(`Booked ${title}: ${h12(seen)}${dayWord(slot.which, c.now) || " today"}, ${minutes} min${picked}.`, { kind: "booked", title, when: `${h12(seen)}${dayWord(slot.which, c.now)}`, at: c.now.getTime() });
}
async function slipped(c, title, r) {
    // REV4 9: a decline never writes; a class or a plan with people is rebooked only when he names it.
    if (r.kind === "decline")
        return c.done(`Okay, leaving ${title} for now; nothing changed. Give me a time if you want it back in.`, null);
    if (isProtected(title, blockNamed(await c.day("today"), title)) && !named(c.turn.said, title))
        return c.done(PROTECTED_LINE(cap(title)), null);
    const d = r.kind === "counter" ? r.details : undefined;
    const name = safeTitle(title, "gym");
    if (!d || !(d.day === "tomorrow" || d.part === "morning")) {
        const minutes = d?.minutes ?? 30;
        const slot = await slotFor(c, minutes, d?.at !== undefined ? { day: "today", at: d.at, ...(d.meridiem !== undefined ? { meridiem: d.meridiem } : {}) } : { day: "today" });
        if (slot && "past" in slot)
            return c.done(PAST_LINE, null);
        if (slot) {
            const flow = await c.schedule(addCommand(name, minutes, "today", slot.start, c.now));
            if (flowWrote(flow)) {
                const seen = await c.readBack("today", name, slot.start);
                if (seen === undefined)
                    return c.done(unseen(title), null);
                const lead = d ? "Done" : `${cap(title)} isn't optional`;
                return c.done(`${lead} — I put a ${minutes} min ${title} at ${h12(seen)} tonight.${d ? "" : " Rather do it first thing tomorrow? Say so and I'll move it."}`, { kind: "booked", title, when: `at ${h12(seen)} tonight`, at: c.now.getTime() });
            }
            if (d)
                return c.done(flowText(flow) ?? `I couldn't book ${title} just now, so nothing changed.`, null);
        }
    }
    const day = await c.day("tomorrow");
    const own = blockNamed(day, title);
    const length = own ? toMin(own.end) - toMin(own.start) : 90;
    const said = d?.at !== undefined ? clockOn(d.at, d.meridiem, "tomorrow", c.now) : undefined;
    if (d?.at !== undefined && said === undefined)
        return c.done(PAST_LINE, null);
    const start = said ?? freeSlot(day, length, wakeDayIsToday(c.now) ? Math.max(MORNING, c.nowMin + 15) : MORNING, 12 * 60, own);
    if (start === undefined)
        return c.done(`Tomorrow morning is full before noon, so I couldn't fit ${title} there. Give me a time and I'll book it.`, null);
    const flow = await c.schedule(own ? moveCommand(name, "tomorrow", start, c.now) : addCommand(name, length, "tomorrow", start, c.now));
    if (!flowWrote(flow))
        return c.done(flowText(flow) ?? `I couldn't book ${title} tomorrow just now, so nothing changed.`, null);
    const seen = await c.readBack("tomorrow", name, start);
    if (seen === undefined)
        return c.done(unseen(title), null);
    const lead = d ? "Booked" : `${cap(title)} isn't optional, so it's booked`;
    return c.done(`${lead}: ${title} tomorrow at ${h12(seen)}${own ? " (moved from its usual slot)" : ""}. Today's slipped; I'll check in when tomorrow's starts.`, { kind: "booked", title, when: `tomorrow at ${h12(seen)}`, at: c.now.getTime() });
}
const KEYWORD_SKIP = /^(?:finish|finishing|do|get|the|and|for|my|your|student|start|work|on)$/i;
async function brief(c, items, r, fromMemo) {
    const text = c.turn.outreachText ?? "";
    if (r.kind === "indifferent" || (r.kind === "accept" && !r.pick)) {
        const days = text.match(/\b(\d{1,3}) days?\b/)?.[1];
        const head = days ? `${items.join(" and ")} — ${days} days at the top now. ` : "";
        const choice = items.length > 1 ? `Which first, ${items.slice(0, -1).join(", ")} or ${items.at(-1)}?` : `When for ${items[0]}?`;
        return c.done(`${head}${choice} Give me a time for each, or say "you pick" and I'll put them in today.`, { kind: "brief", items, at: c.now.getTime() });
    }
    const said = r.kind === "counter" ? r.text : "";
    const times = clockTimes(said);
    const places = items.map((item) => {
        const keys = item.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !KEYWORD_SKIP.test(w));
        const idx = keys.map((k) => said.indexOf(k)).filter((i) => i >= 0);
        return { item, index: idx.length ? Math.min(...idx) : -1 };
    });
    const booked = [];
    const failed = [];
    const written = [];
    let cursor = c.nowMin + 15;
    const today = r.kind === "counter" ? undefined : await c.day("today");
    for (const p of places) {
        let at;
        if (r.kind === "counter") {
            if (p.index < 0)
                continue;
            const nextIdx = Math.min(...places.filter((x) => x.index > p.index).map((x) => x.index), Infinity);
            const t = times.find((x) => x.index > p.index && x.index < nextIdx) ?? times.find((x) => x.index < p.index && !places.some((y) => y.index > x.index && y.index < p.index));
            if (!t)
                continue;
            at = !t.meridiem && t.at < 8 * 60 ? t.at + 12 * 60 : t.at;
            if (at <= c.nowMin) {
                failed.push(`${p.item} (that time's already gone today)`);
                continue;
            }
        }
        else {
            at = freeSlot(today, 45, cursor, DAY_END);
            if (at === undefined) {
                failed.push(p.item);
                continue;
            }
        }
        const title = safeTitle(p.item, p.item);
        const flow = await c.schedule(addCommand(title, 45, "today", at, c.now));
        if (!flowWrote(flow)) {
            failed.push(`${p.item}${flowText(flow) ? ` (${flowText(flow)})` : ""}`);
            continue;
        }
        written.push({ item: p.item, title, at });
        cursor = at + 50;
    }
    const after = written.length ? await c.day("today") : undefined;
    for (const w of written) {
        const seen = placedAt(after, w.title, w.at);
        if (seen === undefined)
            failed.push(`${w.item} (the calendar took it, but I can't see it at the time I asked, so check it)`);
        else
            booked.push(`${w.item} at ${h12(seen)}`);
    }
    if (!booked.length && !failed.length)
        return undefined; // his words named none of the items: a request of his own, not this answer
    const okLine = booked.length ? `Booked today: ${booked.join(", ")} (45 min each — say if one needs longer).` : "";
    const badLine = failed.length ? ` Not booked: ${failed.join("; ")}.` : "";
    return c.done(`${okLine}${badLine}`.trim(), null);
}
async function whatsNext(c, staleNext) {
    const day = await c.day("today");
    if (!day)
        return c.done("I couldn't read your calendar just now, so I won't guess what's next.", null);
    const { current, next } = nowAndNext(day, c.nowMin);
    const said = current ? `Right now it's ${current.title}, until ${h12(toMin(current.end))}.${next ? ` Then ${next.title} at ${h12(toMin(next.start))}.` : ""}`
        : next ? `Next is ${next.title} at ${h12(toMin(next.start))}.` : "Nothing else on your calendar today.";
    const real = current ?? next;
    const stale = staleNext && real && !staleNext.toLowerCase().includes(real.title.toLowerCase().split(/\s+/)[0]) ? `Correction — not ${staleNext.replace(/\s+at\s+.*$/, "")} yet. ` : "";
    return c.done(`${stale}${said}`, { kind: "next", at: c.now.getTime() });
}
async function planCheck(c, title, r) {
    if (r.kind === "accept")
        return c.done(`Good — leaving ${title} where it is.`, null);
    const day = await c.day("today");
    const block = blockNamed(day, title);
    // REV4 9: a class or a plan with people moves only when his own words name it (never on "yes" to a move ORION offered).
    if (isProtected(title, block) && !(r.kind === "counter" && named(c.turn.said, title)))
        return c.done(PROTECTED_LINE(block?.title ?? cap(title)), null);
    if (r.kind === "counter")
        return moveTo(c, block?.title ?? title, r.details);
    if (!block)
        return c.done(`Okay. Should ${title} move or come off today? Give me a time and I'll move it.`, null);
    const length = toMin(block.end) - toMin(block.start);
    const start = freeSlot(day, length, c.nowMin + 30, DAY_END, block); // plans changed: not the next ten minutes
    if (start === undefined)
        return c.done(`Okay. There's no free ${length} min left today for ${block.title} — want it tomorrow? Give me a time.`, null);
    return c.done(`Okay — want ${block.title} moved to ${h12(start)}, or somewhere else? Say yes, or a time.`, { kind: "move-offer", title: block.title, to: start, which: "today", at: c.now.getTime() });
}
async function moveTo(c, title, d) {
    if (d.at === undefined)
        return c.done(`When${d.day === "tomorrow" ? " tomorrow" : ""}? Give me a time and I'll move ${title} there.`, null);
    const which = d.day === "tomorrow" ? "tomorrow" : "today";
    const at = clockOn(d.at, d.meridiem, which, c.now);
    if (at === undefined)
        return c.done(PAST_LINE, null);
    const flow = await c.schedule(moveCommand(title, which, at, c.now));
    if (!flowWrote(flow))
        return c.done(flowText(flow) ?? `I couldn't move ${title} just now, so nothing changed.`, null);
    const seen = await c.readBack(which, title, at);
    if (seen === undefined)
        return c.done(unseen(title), null);
    return c.done(`Moved ${title} to ${h12(seen)}${dayWord(which, c.now)}.`, null);
}
// ---------------------------------------------------------------- dispatch
export async function runTurn(turn, deps) {
    const c = new Ctx(deps, turn);
    const r = turn.reply;
    const m = turn.memo;
    if (m) {
        switch (m.kind) {
            case "resume": return r.kind === "done" || r.kind === "resume" || r.kind === "accept" ? begin(c, m.title, m.activity, true) : undefined;
            case "bedtime": return bedtime(c, r, m);
            case "booked": return c.done(`Then it stays: ${m.title} ${m.when}. I'll check in when it starts.`, null);
            case "brief": return brief(c, m.items, r.kind === "accept" ? { kind: "accept", pick: true } : r, true);
            case "next": return whatsNext(c);
            case "move-offer":
                if (r.kind === "decline")
                    return c.done(`Okay, leaving ${m.title} as it is.`, null);
                if (r.kind === "counter")
                    return moveTo(c, m.title, r.details);
                return moveTo(c, m.title, { at: m.to, meridiem: true, day: m.which });
        }
    }
    const o = turn.offer;
    if (!o)
        return undefined;
    switch (o.kind) {
        case "start": return start(c, o.title, r);
        case "leave": return leave(c, o, r);
        case "bedtime": return bedtime(c, r);
        case "catchup": return catchup(c, o, r);
        case "slipped": return slipped(c, o.title, r);
        case "brief": return brief(c, o.items, r, false);
        case "session-done": return whatsNext(c, o.next);
        case "plan-check": return planCheck(c, o.title, r);
    }
}
