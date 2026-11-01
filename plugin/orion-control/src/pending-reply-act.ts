/*
 Carrying out a pending reply (pending-reply.ts): one handler per offer. Every write goes through the path the explicit command uses
 (the scheduler by its own words, orion-checkin, the focus-session flow); every reply is built from what those returned. Defaults
 (25 min to eat, a 60 min catch-up, a 30 min short gym) are said in the reply as the assumption they are.
*/
import type { Day, FlowResult } from "./schedule-flow.js";
import type { ToolResult } from "./work-check.js";
import type { Memo, PendingDeps, PendingOutcome, PendingTurn } from "./pending-reply.js";
import { clockTimes, type Details, type Offer, type Reply } from "./pending-reply-read.js";
import {
  DAY_END, addCommand, blockNamed, clockOn, dayArgs, dayWord, firstFixed, flowText, flowWrote, freeSlot, h12, isProtected, moveCommand, nowAndNext,
  justStarted, nowMinOf, placedAt, safeTitle, toMin, unseen, wakeDayIsToday, type Which,
} from "./pending-reply-day.js";
import { bedtime } from "./pending-reply-bed.js";
import { dayEndFor } from "./life-window.js";
import { namesBlock } from "./anchor-write-guard.js";

/** He said a time that has already gone today: nothing is written. */
const PAST_LINE = "That time's already gone today, so nothing changed. Give me a later one.";
/** His own words name this block (a class or a plan with people moves only then). */
const named = (said: string | undefined, title: string): boolean => !!said && namesBlock(said, { title, start: "00:00", end: "00:00", fixed: true });
const PROTECTED_LINE = (title: string): string => `${title} is a class or a plan with people, so I won't move or rebook it on a guess. Tell me what to do with it, by name, and I will.`;

type Acc = { tools: ToolResult[]; marks: string[]; wrote: boolean };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class Ctx {
  readonly acc: Acc = { tools: [], marks: [], wrote: false };
  constructor(readonly deps: PendingDeps, readonly turn: PendingTurn) {}
  get now(): Date { return this.deps.now; }
  get nowMin(): number { return nowMinOf(this.deps.now); }
  async day(which: Which): Promise<Day | undefined> {
    if (!this.deps.readDay) return undefined;
    const args = dayArgs(which, this.now);
    const d = await this.deps.readDay(args).catch(() => undefined);
    if (d) this.acc.tools.push({ canonical: `read day ${args.length ? "tomorrow" : "today"} (code)`, stdout: JSON.stringify(d).slice(0, 2000), exit: null });
    return d;
  }
  async schedule(command: string): Promise<FlowResult | undefined> {
    if (!this.deps.schedule) return undefined;
    const flow = await this.deps.schedule(command).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
    if ("calls" in flow && flow.calls) flow.calls.forEach((canonical, i) => this.acc.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
    if (flowWrote(flow)) { this.acc.wrote = true; this.acc.marks.push(...(flow.marks ?? [])); }
    return flow;
  }
  async checkin(args: string[]): Promise<{ stdout: string; code: number } | undefined> {
    if (!this.deps.checkin) return undefined;
    const out = await this.deps.checkin(args).catch(() => ({ stdout: "", code: 1 }));
    this.acc.tools.push({ canonical: `exec orion-checkin ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`, stdout: out.stdout, exit: out.code });
    if (out.code === 0 && args[0] !== "find" && args[0] !== "list" && args[0] !== "show") this.acc.wrote = true;
    return out;
  }
  /** The ONE open plan loop about `what`, by id (orion-checkin find); undefined for none or several. */
  async loopId(what: string): Promise<string | undefined> {
    const out = await this.checkin(["find", "--what", what]);
    try { const f = JSON.parse(out?.stdout.trim().split("\n").at(-1) ?? "") as { open?: boolean; id?: unknown }; return out?.code === 0 && f.open && typeof f.id === "string" ? f.id : undefined; } catch { return undefined; }
  }
  /** Comes back in `minutes` about `what`: the open loop is deferred (no second ladder), else a new check-in. Returns when, or undefined. */
  async comeBack(what: string, minutes: number, because: string): Promise<{ at: number; id?: string; refused?: boolean } | undefined> {
    const id = await this.loopId(what);
    if (id) {
      const out = await this.checkin(["defer", String(minutes), id, "--because", because.slice(0, 120)]);
      if (!out || out.code !== 0) return undefined;
      const back = out.stdout.match(/back in (\d+) min/);
      return back ? { at: this.nowMin + Number(back[1]), id } : { at: this.nowMin + minutes, id, refused: true };
    }
    const out = await this.checkin(["add", String(minutes), what.slice(0, 120), "--because", because.slice(0, 120)]);
    if (!out || out.code !== 0) return undefined;
    const made = out.stdout.match(/\b(ci-[0-9a-f]+)\b/)?.[1];
    return made ? { at: this.nowMin + minutes, id: made } : { at: this.nowMin + minutes };
  }
  /** After a write: the start the calendar now shows for `title` (REV4 8: a reply about a time says the calendar's time, not the asked one). */
  async readBack(which: Which, title: string, asked: number): Promise<number | undefined> {
    return placedAt(await this.day(which), title, asked);
  }
  done(text: string, memo: Memo | null): PendingOutcome {
    const calls = this.acc.tools.map((t) => t.canonical); const outputs = this.acc.tools.map((t) => t.stdout);
    const flow: FlowResult = this.acc.wrote ? { outcome: "done", calls, outputs, marks: this.acc.marks, reply: text } : { outcome: "say", kind: "plain", text, ...(calls.length ? { calls, outputs } : {}) };
    return { flow, tools: this.acc.tools, marks: this.acc.marks, memo };
  }
}

/** His mornings start at 8 for a slot code picks (a time he says wins). */
const MORNING = 8 * 60;
const GYMLIKE = /\b(?:gym|workout|work out|lift|lifting|run|running|swim|training|walk)\b/i;
const RETURNING: Record<string, string> = { eating: "you ate", cooking: "food's done", "a shower": "you showered", "the call": "the call's done", "the bathroom": "you're back", laundry: "laundry's sorted" };

/** A slot on the day he named (or the first that has room): today from now, else tomorrow in his waking hours. */
type Slot = { which: Which; start: number } | { which: Which; past: true };
async function slotFor(c: Ctx, minutes: number, d: Details = {}, title?: string): Promise<Slot | undefined> {
  const order: Which[] = d.day ? [d.day] : ["today", "tomorrow"];
  for (const which of order) {
    const day = await c.day(which);
    const sameDay = which === "today" || wakeDayIsToday(c.now);
    const earliest = sameDay ? c.nowMin + 15 : 9 * 60;
    const range = d.part === "morning" ? [MORNING, 12 * 60] : d.part === "afternoon" ? [12 * 60, 17 * 60] : d.part === "evening" ? [17 * 60, DAY_END] : [earliest, DAY_END];
    const from = Math.max(range[0]!, earliest);
    const own = title ? blockNamed(day, title) : undefined;
    if (d.at !== undefined) { const t = clockOn(d.at, d.meridiem, which, c.now); return t === undefined ? { which, past: true } : { which, start: t }; }
    if (d.after) {
      const anchor = blockNamed(day, d.after);
      if (anchor) return { which, start: toMin(anchor.end) + 5 };
      continue;
    }
    const start = freeSlot(day, minutes, from, range[1]!, own);
    if (start !== undefined) return { which, start };
  }
  return undefined;
}

// ---------------------------------------------------------------- per offer

async function start(c: Ctx, title: string, r: Reply): Promise<PendingOutcome | undefined> {
  if (r.kind === "counter") {
    const at = r.details.at === undefined || r.details.day === "tomorrow" ? undefined : clockOn(r.details.at, r.details.meridiem, "today", c.now);
    if (at === undefined) return undefined;
    return start(c, title, { kind: "defer", minutes: at - c.nowMin });
  }
  if (r.kind === "defer" || r.kind === "awake") {
    const activity = r.activity;
    // W5 (gate foc-not-started-v): "ya in a sec" is a stall, so the grace is short and said as the limit, not a fresh 15 min.
    const stall = r.kind === "defer" && !!r.stall && !activity;
    const minutes = r.minutes ?? (r.kind === "defer" ? r.typical : undefined) ?? (stall ? STALL_MIN : activity ? 25 : 15);
    const assumed = r.kind === "defer" && r.minutes === undefined && !stall;
    const back = await c.comeBack(title, minutes, c.turn.said ?? (activity ? `${activity} first` : "not yet"));   // his words: orion-checkin reads the reason from them
    const lead = activity ? `Okay, ${activity} first — ${minutes} min${assumed ? " (my guess; say if it's longer)" : ""}.` : stall ? `${minutes} min, not more.` : `Okay, ${minutes} min.`;
    if (!back) return c.done(`${lead} I couldn't set the check-in, so tell me when you're back and we start ${title}.`, { kind: "resume", title, ...(activity ? { activity } : {}), at: c.now.getTime() });
    if (back.refused) return c.done(`That's putting it off again, so ${title} stays on — start now, even 30 min counts.`, null);
    return c.done(`${lead} I'll come back at ${h12(back.at)} and we start ${title}.`, { kind: "resume", title, ...(activity ? { activity } : {}), at: c.now.getTime() });
  }
  if (r.kind === "done") {
    await c.checkin(["close", title]);
    return c.done(`Nice — ${title} done. I'll stop nudging about it.`, null);
  }
  if (r.kind === "accept" || r.kind === "resume") return begin(c, title, undefined, r.kind === "resume");   // a yes marks it started; only "back" starts a session
  if (r.kind === "indifferent") return c.done(`${cap(title)} is still waiting. Now, or in 15? Say which and I'll hold you to it.`, null);
  if (r.kind === "decline") return c.done(`Okay, not right now. When instead? Give me a time and I'll move ${title} there — it doesn't just drop.`, null);
  return undefined;
}

/** "in a sec": how long a vague hold on a start line gets. */
const STALL_MIN = 5;

/** He is starting (or back from the pause): the loop is marked started, and a work block gets its focus session. */
async function begin(c: Ctx, title: string, activity: string | undefined, back: boolean): Promise<PendingOutcome> {
  const id = await c.loopId(title);
  await c.checkin(id ? ["started", id] : ["started", title]);
  const opener = back ? `Okay, ${activity ? RETURNING[activity] ?? "you're back" : "you're back"} — now we start.` : "Good — go.";
  if (!back || GYMLIKE.test(title) || !c.deps.session) return c.done(`${opener} ${cap(title)} starts now; I'll check in that it's going.`, null);
  const flow = await c.deps.session(`start a focus session on ${title}`).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
  if ("calls" in flow && flow.calls) flow.calls.forEach((canonical, i) => c.acc.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
  if (flow.outcome === "done") { c.acc.wrote = true; return c.done(`${opener} ${flowText(flow) ?? `Focus session on ${title} started.`}`, null); }
  return c.done(`${opener} I couldn't start the focus session just now, so nothing is running — open ${title} and I'll check in that it's going.`, null);
}

async function leave(c: Ctx, o: Extract<Offer, { kind: "leave" }>, r: Reply): Promise<PendingOutcome | undefined> {
  if (r.kind === "accept") return c.done("Good, go.", null);
  const minutes = r.kind === "defer" && r.minutes ? Math.min(r.minutes, 30) : 5;
  const sent = c.turn.sentAt !== undefined ? nowMinOf(new Date(c.turn.sentAt)) : c.nowMin;
  const mustLeave = sent + o.leaveIn;
  const travel = o.classAt !== undefined ? o.classAt - mustLeave : 0;
  const leaveBy = c.nowMin + minutes;
  const late = o.classAt !== undefined ? leaveBy + travel - o.classAt : 0;
  const back = await c.comeBack(`leave for ${o.title}`, minutes, "hold on");
  const ping = back ? " I'll ping you then." : " I couldn't set the ping, so watch the clock.";
  const at = o.classAt !== undefined ? ` at ${h12(o.classAt)}` : "";
  if (late <= 0) return c.done(`Okay — ${h12(leaveBy)}, hard stop. That still gets you to ${o.title}${at}.${ping}`, null);
  return c.done(`${h12(leaveBy)} at the latest — that has you about ${late} min late to ${o.title}${at}, so move fast.${ping}`, null);
}

async function catchup(c: Ctx, o: Extract<Offer, { kind: "catchup" }>, r: Reply): Promise<PendingOutcome | undefined> {
  if (r.kind === "decline") return c.done("Okay, leaving it — no catch-up booked.", null);
  const title = `${safeTitle(o.subject ?? "", "")} catch-up`.trim();
  const d = r.kind === "counter" ? r.details : {};
  const minutes = d.minutes ?? 60;
  const slot = await slotFor(c, minutes, d.after && !d.day ? { ...d, day: "tomorrow" } : d);
  if (!slot) return c.done(`I couldn't find a free ${minutes} min ${d.day ?? "today or tomorrow"}${d.after ? ` after ${d.after}` : ""}. Give me a time and I'll book ${title} there.`, null);
  if ("past" in slot) return c.done(PAST_LINE, null);
  const flow = await c.schedule(addCommand(title, minutes, slot.which, slot.start, c.now));
  if (!flowWrote(flow)) return c.done(flowText(flow) ?? `I couldn't book ${title} just now, so nothing changed.`, null);
  const seen = await c.readBack(slot.which, title, slot.start);
  if (seen === undefined) return c.done(unseen(title), null);
  const picked = r.kind === "counter" ? "" : ` — I picked the first free ${minutes === 60 ? "hour" : `${minutes} min`}; say a time if you want it elsewhere`;
  return c.done(`Booked ${title}: ${h12(seen)}${dayWord(slot.which, c.now) || " today"}, ${minutes} min${picked}.`, { kind: "booked", title, when: `${h12(seen)}${dayWord(slot.which, c.now)}`, at: c.now.getTime() });
}

async function slipped(c: Ctx, title: string, r: Reply): Promise<PendingOutcome | undefined> {
  // REV4 9: a decline never writes; a class or a plan with people is rebooked only when he names it.
  if (r.kind === "decline") return c.done(`Okay, leaving ${title} for now; nothing changed. Give me a time if you want it back in.`, null);
  if (isProtected(title, blockNamed(await c.day("today"), title)) && !named(c.turn.said, title)) return c.done(PROTECTED_LINE(cap(title)), null);
  const d = r.kind === "counter" ? r.details : undefined;
  const name = safeTitle(title, "gym");
  if (!d || !(d.day === "tomorrow" || d.part === "morning")) {
    const minutes = d?.minutes ?? 30;
    const slot = await slotFor(c, minutes, d?.at !== undefined ? { day: "today", at: d.at, ...(d.meridiem !== undefined ? { meridiem: d.meridiem } : {}) } : { day: "today" });
    if (slot && "past" in slot) return c.done(PAST_LINE, null);
    if (slot) {
      const flow = await c.schedule(addCommand(name, minutes, "today", slot.start, c.now));
      if (flowWrote(flow)) {
        const seen = await c.readBack("today", name, slot.start);
        if (seen === undefined) return c.done(unseen(title), null);
        const lead = d ? "Done" : `${cap(title)} isn't optional`;
        return c.done(`${lead} — I put a ${minutes} min ${title} at ${h12(seen)} tonight.${d ? "" : " Rather do it first thing tomorrow? Say so and I'll move it."}`, { kind: "booked", title, when: `at ${h12(seen)} tonight`, at: c.now.getTime() });
      }
      if (d) return c.done(flowText(flow) ?? `I couldn't book ${title} just now, so nothing changed.`, null);
    }
  }
  const day = await c.day("tomorrow");
  const own = blockNamed(day, title);
  const length = own ? toMin(own.end) - toMin(own.start) : 90;
  const said = d?.at !== undefined ? clockOn(d.at, d.meridiem, "tomorrow", c.now) : undefined;
  if (d?.at !== undefined && said === undefined) return c.done(PAST_LINE, null);
  const start = said ?? freeSlot(day, length, wakeDayIsToday(c.now) ? Math.max(MORNING, c.nowMin + 15) : MORNING, 12 * 60, own);
  if (start === undefined) return c.done(`Tomorrow morning is full before noon, so I couldn't fit ${title} there. Give me a time and I'll book it.`, null);
  const flow = await c.schedule(own ? moveCommand(name, "tomorrow", start, c.now) : addCommand(name, length, "tomorrow", start, c.now));
  if (!flowWrote(flow)) return c.done(flowText(flow) ?? `I couldn't book ${title} tomorrow just now, so nothing changed.`, null);
  const seen = await c.readBack("tomorrow", name, start);
  if (seen === undefined) return c.done(unseen(title), null);
  const lead = d ? "Booked" : `${cap(title)} isn't optional, so it's booked`;
  return c.done(`${lead}: ${title} tomorrow at ${h12(seen)}${own ? " (moved from its usual slot)" : ""}. Today's slipped; I'll check in when tomorrow's starts.`, { kind: "booked", title, when: `tomorrow at ${h12(seen)}`, at: c.now.getTime() });
}

const KEYWORD_SKIP = /^(?:finish|finishing|do|get|the|and|for|my|your|student|start|work|on)$/i;
/** A brief item already on today's calendar: every word of it that names the thing ("resume", "oyster card") is in the block's title. */
function onToday(today: Day | undefined, item: string): Day["blocks"][number] | undefined {
  const keys = item.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !KEYWORD_SKIP.test(w));
  return keys.length ? today?.blocks.find((b) => { const t = b.title.toLowerCase(); return keys.every((k) => t.includes(k)); }) : undefined;
}
async function brief(c: Ctx, items: string[], r: Reply, fromMemo: boolean): Promise<PendingOutcome | undefined> {
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
  const booked: string[] = []; const kept: string[] = []; const failed: string[] = []; const written: Array<{ item: string; title: string; at: number }> = [];
  let cursor = c.nowMin + 15;
  const today = await c.day("today");
  for (const p of places) {
    // W5: the brief's items come from his to-do list (scripts/lib/life/morning-brief.mjs); one already on today's calendar is not booked twice.
    const there = onToday(today, p.item);
    if (there && (r.kind !== "counter" || p.index >= 0)) { kept.push(`${p.item} is already on today at ${h12(toMin(there.start))}`); continue; }
    let at: number | undefined;
    if (r.kind === "counter") {
      if (p.index < 0) continue;
      const nextIdx = Math.min(...places.filter((x) => x.index > p.index).map((x) => x.index), Infinity);
      const t = times.find((x) => x.index > p.index && x.index < nextIdx) ?? times.find((x) => x.index < p.index && !places.some((y) => y.index > x.index && y.index < p.index));
      if (!t) continue;
      at = !t.meridiem && t.at < 8 * 60 ? t.at + 12 * 60 : t.at;
      if (at <= c.nowMin) { failed.push(`${p.item} (that time's already gone today)`); continue; }
    } else {
      at = freeSlot(today, 45, cursor, DAY_END);
      if (at === undefined) { failed.push(p.item); continue; }
    }
    const title = safeTitle(p.item, p.item);
    const flow = await c.schedule(addCommand(title, 45, "today", at, c.now));
    if (!flowWrote(flow)) { failed.push(`${p.item}${flowText(flow) ? ` (${flowText(flow)})` : ""}`); continue; }
    written.push({ item: p.item, title, at });
    cursor = at + 50;
  }
  const after = written.length ? await c.day("today") : undefined;
  for (const w of written) {
    const seen = placedAt(after, w.title, w.at);
    if (seen === undefined) failed.push(`${w.item} (the calendar took it, but I can't see it at the time I asked, so check it)`);
    else booked.push(`${w.item} at ${h12(seen)}`);
  }
  if (!booked.length && !failed.length && !kept.length) return undefined;   // his words named none of the items: a request of his own, not this answer
  const okLine = booked.length ? `Booked today: ${booked.join(", ")} (45 min each — say if one needs longer).` : "";
  const badLine = failed.length ? ` Not booked: ${failed.join("; ")}.` : "";
  return c.done(`${okLine}${badLine}`.trim(), null);
}

async function whatsNext(c: Ctx, staleNext?: string): Promise<PendingOutcome> {
  const day = await c.day("today");
  if (!day) return c.done("I couldn't read your calendar just now, so I won't guess what's next.", null);
  const { current, next } = nowAndNext(day, c.nowMin);
  const said = current ? `Right now it's ${current.title}, until ${h12(toMin(current.end))}.${next ? ` Then ${next.title} at ${h12(toMin(next.start))}.` : ""}`
    : next ? `Next is ${next.title} at ${h12(toMin(next.start))}.` : "Nothing else on your calendar today.";
  const real = current ?? next;
  const stale = staleNext && real && !staleNext.toLowerCase().includes(real.title.toLowerCase().split(/\s+/)[0]!) ? `Correction — not ${staleNext.replace(/\s+at\s+.*$/, "")} yet. ` : "";
  return c.done(`${stale}${said}`, { kind: "next", at: c.now.getTime() });
}

async function planCheck(c: Ctx, title: string, r: Reply): Promise<PendingOutcome | undefined> {
  if (r.kind === "accept") return c.done(`Good — leaving ${title} where it is.`, null);
  const day = await c.day("today");
  const block = blockNamed(day, title);
  // REV4 9: a class or a plan with people moves only when his own words name it (never on "yes" to a move ORION offered).
  if (isProtected(title, block) && !(r.kind === "counter" && named(c.turn.said, title))) return c.done(PROTECTED_LINE(block?.title ?? cap(title)), null);
  if (r.kind === "counter") return moveTo(c, block?.title ?? title, r.details);
  if (!block) return c.done(`Okay. Should ${title} move or come off today? Give me a time and I'll move it.`, null);
  const length = toMin(block.end) - toMin(block.start);
  // Wave 6: up to his bedtime less wind-down (life-window.ts), not a fixed 10 PM (20:30-24:00 free read as "no free 90 min left").
  const start = freeSlot(day, length, c.nowMin + 30, dayEndFor(c.deps.stateDir), block);   // plans changed: not the next ten minutes
  if (start === undefined) return c.done(`Okay. There's no free ${length} min left today for ${block.title} — want it tomorrow? Give me a time.`, null);
  return c.done(`Okay — want ${block.title} moved to ${h12(start)}, or somewhere else? Say yes, or a time.`, { kind: "move-offer", title: block.title, to: start, which: "today", at: c.now.getTime() });
}

async function moveTo(c: Ctx, title: string, d: Details): Promise<PendingOutcome | undefined> {
  if (d.at === undefined) return c.done(`When${d.day === "tomorrow" ? " tomorrow" : ""}? Give me a time and I'll move ${title} there.`, null);
  const which: Which = d.day === "tomorrow" ? "tomorrow" : "today";
  const at = clockOn(d.at, d.meridiem, which, c.now);
  if (at === undefined) return c.done(PAST_LINE, null);
  const flow = await c.schedule(moveCommand(title, which, at, c.now));
  if (!flowWrote(flow)) return c.done(flowText(flow) ?? `I couldn't move ${title} just now, so nothing changed.`, null);
  const seen = await c.readBack(which, title, at);
  if (seen === undefined) return c.done(unseen(title), null);
  return c.done(`Moved ${title} to ${h12(seen)}${dayWord(which, c.now)}.`, null);
}

// ---------------------------------------------------------------- dispatch

export async function runTurn(turn: PendingTurn, deps: PendingDeps): Promise<PendingOutcome | undefined> {
  const c = new Ctx(deps, turn);
  const r = turn.reply;
  const m = turn.memo;
  if (m) {
    switch (m.kind) {
      case "resume": return r.kind === "done" || r.kind === "resume" || r.kind === "accept" ? begin(c, m.title, m.activity, true) : undefined;
      case "bedtime": return bedtime(c, r, m);
      case "booked": return c.done(`Then it stays: ${m.title} ${m.when}. I'll check in when it starts.`, null);
      // W5: a plain "yeah do it" to "which first?" asks again; only "you pick" (or times) books the brief's items.
      case "brief": return brief(c, m.items, r, true);
      case "next": return whatsNext(c);
      case "move-offer":
        if (r.kind === "decline") return c.done(`Okay, leaving ${m.title} as it is.`, null);
        if (r.kind === "counter") return moveTo(c, m.title, r.details);
        return moveTo(c, m.title, { at: m.to, meridiem: true, day: m.which });
    }
  }
  if (turn.plan) {
    const block = justStarted(await c.day("today"), c.nowMin);
    return block ? start(c, block.title, r) : undefined;
  }
  const o = turn.offer;
  if (!o) return undefined;
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
