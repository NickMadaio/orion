/*
 Carries out a DayEdit (day-edit.ts) with no model: each part is one orion-reschedule (or orion-sleepplan) run, in the order he said
 them, the day re-read before each one that needs it. What already happened is written with `log` (the past is a record of his real
 day, never refused), what is still to come with add / move / drop. One short first-person line says what was done and, plainly,
 what was not. w20 sched, 2026-11-04.
*/
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import type { RealityDeps, RealityOutcome } from "./reality.js";
import type { DayRef, DayEdit, EditPart, Span } from "./day-edit.js";
import { pickClock, pickRange } from "./day-edit-time.js";
import { ampm as ampmFull, hhmm, toMin } from "./intent-time.js";
import { blocksNamedBy, namesTitle, pickByTime } from "./block-names.js";
import { noteOf, refused } from "./scheduler-out.js";
import { whyNot, yesterdayOf } from "./day-requests.js";
import { failureReason, type ScheduleFailure } from "./schedule-failure.js";
import { forgetEdit, rememberEdit, rememberRun } from "./day-edit-memory.js";
import { pastBedtimeNote, plannedBedtime } from "./bed-line.js";
import { nextWake } from "./wake-state.js";
import { applyBedChange } from "./bedtime-change.js";
import { ANCHOR_END } from "./meal-anchors.js";
import { collision, writeOrder, type Mover } from "./move-order.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Run = { stdout: string; code: number };
const DAY_ARGS: Record<DayRef, string[]> = { today: [], tomorrow: ["--date", "tomorrow"], yesterday: ["--date", "yesterday"] };
/** Before 7 AM: a bare hour on another day is read as one still awake for (7-11 morning, 12 noon, 1-6 evening). */
const DAYTIME_FLOOR = 6 * 60 + 59;
const LOG_AHEAD = 180;
/** "7 PM", "9:30 PM": the way he says it. */
const ampm = (m: number): string => ampmFull(m).replace(":00", "");
const spanText = (a: number, b: number): string => { const [x, y] = [ampm(a), ampm(b)]; return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`; };
const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CAP = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const DEFAULT_MIN: Array<[RegExp, number]> = [[/lunch/, 30], [/dinner|supper/, 45], [/breakfast/, 20], [/nap/, 45], [/call|chat/, 30], [/walk|tube|commute|train/, 30], [/gym|workout|lift|run/, 60], [/hair\s?cut|barber|hairdresser|haircut/, 30]];
const defaultMinutes = (name: string): number => DEFAULT_MIN.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? 60;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

type Ctx = { deps: RealityDeps; nowMin: number; calls: string[]; outputs: string[]; done: string[]; failed: string[]; sides: string[]; writes: number; failures: ScheduleFailure[]; bedtime?: string; /** days the calendar could not be read for (a failed read is never "no block by that name") */ unread: Set<DayRef>; /** sentences another route answered for a clause it took (the food log), said as they are */ extra: string[]; /** ids of facts declared (undone with the edit) */ facts: string[]; /** blocks put on today by this edit, for the bedtime note */ placed: Array<{ title: string; end: number }>; /** what the reply says about where a block went, checked against the calendar read back at the end */ claims: Claim[] };
type Claim = { day: DayRef; title: string; start: number; end: number; idx: number; say: (span: string) => string };

/** Yesterday cannot be read by the scheduler (a past day is refused); what the calendar held comes from the agenda, as blocks of a guessed length. */
async function yesterdayDay(ctx: Ctx): Promise<Day> {
  const date = yesterdayOf(ctx.deps.now);
  const agenda = ctx.deps.agendaDay ? await ctx.deps.agendaDay(date).catch(() => undefined) : undefined;
  const blocks: DayBlock[] = (agenda?.events ?? []).map((e) => {
    const start = toMin(e.start); const cls = /lecture|class|seminar|tutorial|\blab\b|[A-Z]{2,5}\d{3,5}/i.test(e.title);
    return { title: e.title, start: e.start, end: hhmm(Math.min(1439, start + (cls ? 90 : defaultMinutes(e.title)))), fixed: cls, kind: cls ? "class" : "other" };
  });
  return { date, now: null, blocks };
}

async function dayOf(ctx: Ctx, ref: DayRef): Promise<Day | undefined> {
  const { deps } = ctx;
  if (ref === "yesterday") return yesterdayDay(ctx);
  let day: Day | undefined;
  try { day = ref === "today" ? await deps.readDay() : deps.readDayOn ? await deps.readDayOn(DAY_ARGS[ref]) : undefined; } catch { day = undefined; }
  if (!day && (ref === "today" || deps.readDayOn)) ctx.unread.add(ref);
  return day;
}
const NO_READ = "I couldn't read your calendar just now";
/** The day could not be read: said, and nothing is changed on a guess about what is on it. */
const unreadable = (ctx: Ctx, ref: DayRef, what: string): boolean => {
  if (!ctx.unread.has(ref)) return false;
  ctx.failed.push(`${what} (${NO_READ})`);
  return true;
};
const blockNamed = (name: string, day: Day | undefined, now: number): DayBlock | undefined => {
  // "the 11:20 thing": the block that starts at that clock.
  const clock = /^(\d{1,2}:\d{2})\b/.exec(name.trim())?.[1];
  if (clock) { const at = (day?.blocks ?? []).filter((b) => b.kind !== "commute" && toMin(b.start) === toMin(clock)); return at.length === 1 ? at[0] : undefined; }
  const found = blocksNamedBy(name, (day?.blocks ?? []).filter((b) => b.kind !== "commute"));
  if (found.length) return pickByTime(found, now);
  // "the lecture" / "the seminar": the kind of thing, not a title word; the day's class it means ("i didnt go to the lecture yesterday").
  const classes = /^(?:lectures?|class(?:es)?|seminars?|tutorials?)$/.test(name.trim()) ? (day?.blocks ?? []).filter((b) => b.kind === "class") : [];
  return classes.length ? pickByTime(classes, now) : undefined;
};

async function exec(ctx: Ctx, script: "orion-reschedule" | "orion-sleepplan", args: string[]): Promise<Run> {
  const out = await ctx.deps.run(script, args).catch((): Run => ({ stdout: "", code: 1 }));
  ctx.calls.push(`exec ${script} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`); ctx.outputs.push(out.stdout);
  return out;
}
/** A run that wrote: counts one undo, collects what else it moved. False (with the reason said) when it did not. */
function settle(ctx: Ctx, out: Run, said: string, what: string, start?: number): boolean {
  const fail = (why?: string) => { ctx.failed.push(`${what}${why ? ` (${why})` : ""}`); const f = failureReason(out.stdout, { what: said, ...(ctx.bedtime ? { bedtime: ctx.bedtime } : {}), ...(start !== undefined ? { start } : {}) }); if (f) ctx.failures.push(f); };
  if (refused(out) || out.code !== 0) { const why = whyNot(out.stdout); fail(why); return false; }
  const missed = out.stdout.split("\n").map((l) => l.trim()).some((l) => /^(?:MUST-HAVE )?NOT BOOKED: /.test(l) && l.toLowerCase().includes(said.toLowerCase().split(" ")[0]!));
  if (missed) { fail("there wasn't room for it"); return false; }
  ctx.writes += 1;
  for (const l of out.stdout.split("\n").map((x) => x.trim())) { const n = noteOf(l); if (n && !n[0].toLowerCase().includes(said.toLowerCase())) ctx.sides.push(n[1]); }
  return true;
}

const rangeFor = (s: Span, now: number, ref: DayRef, mode: "past" | "future") => pickRange(s.a, s.b, ref === "today" ? now : ref === "yesterday" ? 1440 : DAYTIME_FLOOR, ref === "tomorrow" ? "future" : mode);
const clockFor = (s: EditPart extends never ? never : import("./intent-time.js").Said, now: number, ref: DayRef, mode: "past" | "future", near?: number) => pickClock(s, ref === "today" ? now : ref === "yesterday" ? 1440 : DAYTIME_FLOOR, ref === "tomorrow" ? "future" : mode, near);

/** Writes what really happened. `instead` is only passed for a block his time overlaps or that already started (the scheduler asks otherwise). */
async function logIt(ctx: Ctx, ref: DayRef, title: string, from: number, to: number, instead?: DayBlock, underway = false): Promise<boolean> {
  const cap = ref === "today" ? Math.min(to, ctx.nowMin + LOG_AHEAD) : to;
  // Never a record that ends before it starts, or that has not begun: that is a day or a time he did not mean, so he is asked (live run 3 #102: 2:00 PM–8:24 AM).
  if (cap <= from) { ctx.failed.push(`log ${title.toLowerCase()} (${ampm(from)} hasn't happened yet ${ref === "today" ? "today" : ref}, so tell me which day it was)`); return false; }
  const usable = instead && (ref !== "today" || (toMin(instead.start) < cap && from < toMin(instead.end)) || toMin(instead.start) <= ctx.nowMin) && !instead.fixed;
  const out = await exec(ctx, "orion-reschedule", ["log", title, "--from", hhmm(from), "--to", hhmm(cap), ...(usable ? ["--instead", instead!.title] : []), ...DAY_ARGS[ref]]);
  const ok = settle(ctx, out, title, `log ${title}`, from);
  // He is in it right now ("add art museum from 7pm to 9:30pm" at 7:57): it is on the day as under way, and the line says it had already started.
  const started = underway && ref === "today" && from < ctx.nowMin && to > ctx.nowMin ? ` (it already started at ${ampm(from)}, so it's on your day as under way)` : "";
  if (ok) ctx.done.push(`logged ${title.toLowerCase()} ${spanText(from, cap)}${ref === "yesterday" ? " yesterday" : ""}${usable ? ` instead of ${instead!.title.replace(/\s+[—–-].*$/, "")}` : ""}${started}`);
  return ok;
}

async function addPart(ctx: Ctx, p: Extract<EditPart, { op: "add" }>): Promise<void> {
  const title = CAP(p.name); const day = p.day === "today" || p.after ? await dayOf(ctx, p.day) : undefined;
  if (p.after && unreadable(ctx, p.day, `add ${p.name} after ${p.after}`)) return;
  let from: number; let to: number;
  if (p.span) {
    const r = rangeFor(p.span, ctx.nowMin, p.day, "future");
    if (!r) { ctx.failed.push(`add ${p.name} (I couldn't read those times)`); return; }
    from = r.from; to = r.to;
  } else {
    const mins = p.minutes ?? defaultMinutes(p.name);
    if (p.at) from = clockFor(p.at, ctx.nowMin, p.day, "future");
    else {
      const anchor = p.after ? blockNamed(p.after, day, ctx.nowMin) : undefined;
      const dflt = p.after ? ANCHOR_END.find(([re]) => re.test(p.after!))?.[1] : undefined;
      const lastClass = !anchor && /class|lecture|seminar|lab/.test(p.after ?? "") ? [...(day?.blocks ?? [])].filter((b) => b.kind === "class").sort((a, b) => toMin(b.end) - toMin(a.end))[0] : undefined;
      const end = anchor ? toMin(anchor.end) : lastClass ? toMin(lastClass.end) : dflt;
      if (end === undefined) { ctx.failed.push(`add ${p.name} after ${p.after} (I can't see ${p.after} on that day, so tell me a time)`); return; }
      from = end;
    }
    to = from + mins;
  }
  // "put the call with mum at 5" when the call is already on the day is a move of that block (the scheduler never keeps two): never a second one.
  if (p.day !== "yesterday" && !(p.day === "today" && from < ctx.nowMin)) {
    const seen = day ?? await dayOf(ctx, p.day);
    const there = blockNamed(p.name, seen, p.day === "today" ? ctx.nowMin : -1);
    // Restating a block by its own title replaces it (the scheduler's rule), so only another way of naming it, or a plan with people, is a move.
    const sameTitle = norm(there?.title ?? "") === norm(CAP(p.name));
    if (there && (!sameTitle || there.fixed) && (p.day !== "today" || toMin(there.end) > ctx.nowMin) && !there.kind?.match(/^(?:class|commute|deadline)$/)) { await moveExisting(ctx, p, there, from, to); return; }
  }
  if (p.day !== "today" ? p.day === "yesterday" : from < ctx.nowMin) {
    const seen = day ?? await dayOf(ctx, p.day);
    if (unreadable(ctx, p.day, `log ${p.name}`)) return;   // writing the past blind could double a block that is already there
    await logIt(ctx, p.day, title, from, to, blockNamed(p.name, seen, ctx.nowMin), true); return;
  }
  const out = await exec(ctx, "orion-reschedule", ["add", title, String(to - from), "--at", hhmm(from), "--length-explicit", ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, title, `add ${p.name}`, from)) { claim(ctx, p.day, title, from, to, (span) => `put ${title.toLowerCase()} at ${span}${p.day === "tomorrow" ? " tomorrow" : ""}`); if (p.day === "today") ctx.placed.push({ title, end: to }); }
}


/** A line the reply will say about where a block went: kept with how to say it again, so the end can say what the calendar shows instead. */
function claim(ctx: Ctx, day: DayRef, title: string, start: number, end: number, say: (span: string) => string): void {
  ctx.done.push(say(spanText(start, end)));
  ctx.claims.push({ day, title, start, end, idx: ctx.done.length - 1, say });
}

/** Every time the reply states is read back from the calendar: where the scheduler really put a block (it may have kept it elsewhere) is what is said. */
async function verifyClaims(ctx: Ctx): Promise<void> {
  const days = new Map<DayRef, Day | undefined>();
  for (const c of ctx.claims) {
    if (!days.has(c.day)) days.set(c.day, c.day === "yesterday" ? undefined : await dayOf(ctx, c.day).catch(() => undefined));
    const blocks = (days.get(c.day)?.blocks ?? []).filter((b) => norm(b.title) === norm(c.title));
    if (!blocks.length) continue;   // not seen on the read-back (an unreadable day, or the scheduler's own note says why): the line stands
    const b = blocks.reduce((best, x) => (Math.abs(toMin(x.start) - c.start) < Math.abs(toMin(best.start) - c.start) ? x : best));
    if (toMin(b.start) === c.start && toMin(b.end) === c.end) continue;
    ctx.done[c.idx] = `${c.say(spanText(toMin(b.start), toMin(b.end)))} (the scheduler couldn't keep it at ${ampm(c.start)})`;
  }
  ctx.done = ctx.done.filter(Boolean);
}

/** The block he named is already on that day: it goes to the time he said (and the length, when he said one). */
async function moveExisting(ctx: Ctx, p: Extract<EditPart, { op: "add" }>, block: DayBlock, from: number, to: number): Promise<void> {
  const short = block.title.replace(/\s+[—–-].*$/, "");
  const len = toMin(block.end) - toMin(block.start);
  const sameSpan = toMin(block.start) === from && (p.minutes === undefined && !p.span ? true : len === to - from);
  if (sameSpan) { ctx.done.push(`left ${short} as it is, it's already at ${spanText(toMin(block.start), toMin(block.end))}`); return; }
  const length = p.minutes !== undefined || p.span ? ["--until", hhmm(to)] : [];
  const out = await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(from), ...length, ...(block.fixed ? ["--named"] : []), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, block.title, `move ${short}`, from)) claim(ctx, p.day, block.title, from, p.minutes !== undefined || p.span ? to : from + len, (span) => `moved ${short} to ${span}${p.day === "tomorrow" ? " tomorrow" : ""}`);
}

/** "make the mum call 45 mins": the block's new total length, same start. */
async function resizePart(ctx: Ctx, p: Extract<EditPart, { op: "resize" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  const block = blockNamed(p.name, day, ctx.nowMin);
  if (!block && unreadable(ctx, p.day, `resize ${p.name}`)) return;
  if (!block) { ctx.failed.push(`make ${p.name} ${p.minutes} minutes (I can't see it on ${p.day === "today" ? "today's" : "that day's"} plan)`); return; }
  const short = block.title.replace(/\s+[—–-].*$/, "");
  const start = toMin(block.start);
  const out = block.fixed
    ? await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(start), "--until", hhmm(start + p.minutes), "--named", ...DAY_ARGS[p.day]])
    : await exec(ctx, "orion-reschedule", ["resize", block.title, String(p.minutes), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, block.title, `resize ${short}`, start)) ctx.done.push(`made ${short} ${p.minutes} minutes (${spanText(start, start + p.minutes)})`);
}

async function movePart(ctx: Ctx, p: Extract<EditPart, { op: "move" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  const block = blockNamed(p.name, day, ctx.nowMin);
  if (!block && unreadable(ctx, p.day, `move ${p.name}`)) return;
  if (!block) {
    // nothing by that name that day: his words still say when it was (or will be), so it goes on the day there
    const from = clockFor(p.to, ctx.nowMin, p.day, p.day === "today" ? "past" : "future");
    const len = defaultMinutes(p.name);
    if (p.day === "today" ? from + 0 <= ctx.nowMin : p.day === "yesterday") { if (await logIt(ctx, p.day, CAP(p.name), from, from + len)) ctx.done[ctx.done.length - 1] += " (it wasn't on the plan)"; return; }
    const out = await exec(ctx, "orion-reschedule", ["add", CAP(p.name), String(len), "--at", hhmm(from), "--length-explicit", ...DAY_ARGS[p.day]]);
    if (settle(ctx, out, p.name, `move ${p.name}`)) ctx.done.push(`put ${p.name} at ${ampm(from)} (it wasn't on the plan)`);
    return;
  }
  const start = toMin(block.start); const len = toMin(block.end) - start;
  const behind = p.day === "yesterday" || (p.day === "today" && start <= ctx.nowMin);
  const to = clockFor(p.to, ctx.nowMin, p.day, behind ? "past" : "future", behind ? start : undefined);
  const short = block.title.replace(/\s+[—–-].*$/, "");
  if (behind || (p.day === "today" && to < ctx.nowMin)) { if (await logIt(ctx, p.day, block.title, to, to + len, block)) ctx.done[ctx.done.length - 1] = `moved ${short} to ${spanText(to, Math.min(to + len, p.day === "today" ? ctx.nowMin + LOG_AHEAD : to + len))}`; return; }
  const out = await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(to), ...(block.fixed ? ["--named"] : []), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, block.title, `move ${short}`)) claim(ctx, p.day, block.title, to, to + len, (span) => `moved ${short} to ${span.split("–")[0]}`);
}

/** "shove the plan after that": it goes where the other block ends (read from the day after the other one moved), `gap` minutes later. */
async function moveAfterPart(ctx: Ctx, p: Extract<EditPart, { op: "moveafter" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  const block = blockNamed(p.name, day, ctx.nowMin); const anchor = p.after ? blockNamed(p.after, day, ctx.nowMin) : undefined;
  if ((!block || !anchor) && unreadable(ctx, p.day, `move ${p.name}`)) return;
  if (!block) { ctx.failed.push(`move ${p.name} (I can't see it on ${p.day === "today" ? "today's" : "that day's"} plan)`); return; }
  if (!anchor) { ctx.failed.push(`put ${block.title.replace(/\s+[—–-].*$/, "")} after ${p.after ?? "that"} (I can't see ${p.after ?? "that"} on the plan)`); return; }
  const short = block.title.replace(/\s+[—–-].*$/, "");
  const to = toMin(anchor.end) + p.gap;
  if (to + (toMin(block.end) - toMin(block.start)) > 1440) { ctx.failed.push(`move ${short} (that would push it past the day)`); return; }
  const out = await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(to), ...(block.fixed ? ["--named"] : []), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, block.title, `move ${short}`, to)) claim(ctx, p.day, block.title, to, to + (toMin(block.end) - toMin(block.start)), (span) => `moved ${short} to ${span.split("–")[0]}, ${p.gap ? `${p.gap} minutes` : "right"} after ${anchor.title.replace(/\s+[—–-].*$/, "")}`);
}

/** "push the learning plan back an hour": one block, by an amount. Only what has not started; what already happened is moved with a clock. */
async function shiftPart(ctx: Ctx, p: Extract<EditPart, { op: "shift" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  const block = blockNamed(p.name, day, ctx.nowMin);
  if (!block && unreadable(ctx, p.day, `move ${p.name}`)) return;
  if (!block) { ctx.failed.push(`move ${p.name} (I can't see it on ${p.day === "today" ? "today's" : "that day's"} plan)`); return; }
  const short = block.title.replace(/\s+[—–-].*$/, "");
  const start = toMin(block.start); const to = start + p.minutes;
  if (p.day === "today" && start <= ctx.nowMin) { ctx.failed.push(`move ${short} (it has already started, so tell me the time it really happened)`); return; }
  if (to < 0 || to + (toMin(block.end) - start) > 1440) { ctx.failed.push(`move ${short} (that would push it past the day)`); return; }
  const out = await exec(ctx, "orion-reschedule", ["move", block.title, "--to", hhmm(to), ...(block.fixed ? ["--named"] : []), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, block.title, `move ${short}`, to)) claim(ctx, p.day, block.title, to, to + (toMin(block.end) - start), (span) => `moved ${short} ${p.minutes > 0 ? "back" : "earlier"} to ${span.split("–")[0]}`);
}

type Plan = { p: Extract<EditPart, { op: "move" | "shift" }>; mover: Mover; title: string };
/** Two or more moves of blocks still to come on one day: planned together. Reordered so none lands where another still sits; refused when two land on each other. */
async function planMoves(ctx: Ctx, parts: EditPart[]): Promise<EditPart[]> {
  const moves = parts.filter((p): p is Extract<EditPart, { op: "move" | "shift" }> => (p.op === "move" || p.op === "shift") && p.day !== "yesterday");
  if (moves.length < 2 || new Set(moves.map((m) => m.day)).size !== 1) return parts;
  const day = await dayOf(ctx, moves[0]!.day);
  if (!day) return parts;
  const plans: Plan[] = [];
  for (const p of moves) {
    const block = blockNamed(p.name, day, ctx.nowMin);
    if (!block || plans.some((x) => x.title === block.title)) return parts;
    const start = toMin(block.start); const len = toMin(block.end) - start;
    if (p.day === "today" && start <= ctx.nowMin) return parts;
    const to = p.op === "shift" ? start + p.minutes : clockFor(p.to, ctx.nowMin, p.day, "future", start);
    if (p.day === "today" && to <= ctx.nowMin) return parts;
    plans.push({ p, mover: { current: [start, start + len], next: [to, to + len] }, title: block.title.replace(/\s+[—–-].*$/, "") });
  }
  const clash = collision(plans.map((x) => x.mover));
  const rest = parts.filter((p) => !moves.includes(p as never));
  if (clash) {
    const a = plans[clash.a]!; const b = plans[clash.b]!;
    ctx.failed.push(`move ${a.title} to ${spanText(...a.mover.next as [number, number])} and ${b.title} to ${spanText(...b.mover.next as [number, number])} (they would overlap from ${ampm(clash.from)} to ${ampm(clash.to)}, so I haven't moved either; tell me which should go first, or give me one new time)`);
    return rest;
  }
  const order = writeOrder(plans.map((x) => x.mover));
  return [...order.map((i) => plans[i]!.p), ...rest];
}

async function dropPart(ctx: Ctx, p: Extract<EditPart, { op: "drop" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  const block = blockNamed(p.name, day, ctx.nowMin);
  if (!block && unreadable(ctx, p.day, `clear ${p.name}`)) return;
  if (!block) { ctx.failed.push(`clear ${p.name} (I can't see it on ${p.day === "today" ? "today's" : p.day === "tomorrow" ? "tomorrow's" : "yesterday's"} plan)`); return; }
  const started = p.day === "today" && toMin(block.start) <= ctx.nowMin;
  let out = await exec(ctx, "orion-reschedule", started ? ["displace", block.title, "--why", "skip"] : ["drop", block.title, ...DAY_ARGS[p.day]]);
  const short = block.title.replace(/\s+[—–-].*$/, "");
  // A plan with people the scheduler will not drop says "use skip": he said take it off, so that occurrence comes off (undo puts it back).
  if (!started && refused(out) && /\buse skip\b/i.test(out.stdout)) {
    out = await exec(ctx, "orion-reschedule", ["skip", block.title, ...DAY_ARGS[p.day]]);
    if (settle(ctx, out, block.title, `clear ${short}`)) ctx.done.push(`took ${short} off ${p.day === "today" ? "today" : p.day}`);
    return;
  }
  if (settle(ctx, out, block.title, `clear ${short}`)) ctx.done.push(started ? `marked ${short} as skipped` : `took ${short} off ${p.day === "today" ? "today" : p.day}`);
}

/** "everything after my nap should be dropped": every movable block from there on, in one drop; an empty rest of the day is said so. */
async function dropAfterPart(ctx: Ctx, p: Extract<EditPart, { op: "dropafter" }>): Promise<void> {
  const day = await dayOf(ctx, p.day);
  if (!day) { unreadable(ctx, p.day, "clear the rest of your day"); return; }
  const now = p.day === "today" ? ctx.nowMin : -1;
  const anchor = p.name ? blockNamed(p.name, day, now) : undefined;
  const from = p.at ? clockFor(p.at, ctx.nowMin, p.day, "future") : anchor ? toMin(anchor.end) : now;
  const ahead = day.blocks.filter((b) => toMin(b.end) > now && !b.fixed && b.kind !== "class" && b.kind !== "deadline" && b.kind !== "commute");
  const after = ahead.filter((b) => toMin(b.start) >= from);
  const when = p.day === "today" ? "today" : p.day;
  if (!after.length) {
    const plan = `${p.day === "today" ? "today" : p.day}'s plan`;
    ctx.extra.push(p.name && !anchor
      ? `There's no ${p.name} on ${plan}${ahead.length ? "" : ", and nothing else is left on it either"}, so I haven't changed anything.`
      : `There's nothing left ${p.at ? `after ${ampm(from)}` : p.name ? `after your ${p.name}` : "to clear"} on ${plan}, so I haven't changed anything.`);
    return;
  }
  const out = await exec(ctx, "orion-reschedule", ["drop", ...after.map((b) => b.title), ...DAY_ARGS[p.day]]);
  if (settle(ctx, out, "the rest", "clear the rest of your day")) ctx.done.push(`took ${list(after.map((b) => b.title.replace(/\s+[—–-].*$/, "")))} off ${when}`);
}

/** A time he says he did something "today" that is still ahead ("2 till 4" at 8:24 AM) cannot have happened yet: it was yesterday. */
function pastDayRef(ctx: Ctx, ref: DayRef, span?: Span): DayRef {
  if (ref !== "today" || !span) return ref;
  const r = pickRange(span.a, span.b, ctx.nowMin, "past");
  return r && r.from > ctx.nowMin + 10 ? "yesterday" : ref;
}

/** A class he did not go to is on record as missed (orion-declare skip, dated), so it is not counted as attended. */
async function markMissed(ctx: Ctx, title: string, ref: DayRef): Promise<void> {
  const date = ref === "yesterday" ? yesterdayOf(ctx.deps.now) : undefined;
  const out = await ctx.deps.run("orion-declare", ["add", "--kind", "skip", "--text", ctx.deps.text.slice(0, 200), "--source", ctx.deps.source, "--title", title, ...(date ? ["--date", date] : [])]).catch((): Run => ({ stdout: "", code: 1 }));
  ctx.calls.push(`exec orion-declare add --kind skip --title ${/\s/.test(title) ? `"${title}"` : title}${date ? ` --date ${date}` : ""}`); ctx.outputs.push(out.stdout);
  let id: unknown; try { id = (JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as { id?: unknown }).id; } catch { id = undefined; }
  const short = title.replace(/\s+[—–-].*$/, "");
  if (out.code === 0 && typeof id === "string") { ctx.facts.push(id); ctx.done.push(`marked ${short} as missed${ref === "yesterday" ? " yesterday" : ""}`); }
  else ctx.failed.push(`mark ${short} as missed`);
}

async function didntPart(ctx: Ctx, p: Extract<EditPart, { op: "didnt" }>): Promise<void> {
  const ref = pastDayRef(ctx, p.day, p.span);
  const day = await dayOf(ctx, ref);
  const block = blockNamed(p.name, day, ctx.nowMin);
  const range = p.span ? rangeFor(p.span, ctx.nowMin, ref, "past") : null;
  if (!block && unreadable(ctx, ref, `change ${p.name}`)) return;
  if (!block) {
    if (p.did && range) await logIt(ctx, ref, CAP(p.did), range.from, range.to);
    else if (ref === "yesterday") ctx.failed.push(`change ${p.name} (I can't see it on yesterday's calendar)`);
    else ctx.failed.push(`change ${p.name} (I can't see it on today's plan)`);
    return;
  }
  const short = block.title.replace(/\s+[—–-].*$/, "");
  const start = toMin(block.start);
  if (block.fixed) await markMissed(ctx, block.title, ref);
  if (!p.did) { if (!block.fixed) await dropPart(ctx, { op: "drop", name: p.name, day: ref }); return; }
  const from = range?.from ?? start; const to = range?.to ?? Math.min(toMin(block.end), Math.max(ctx.nowMin, start + 5));
  if (!range && ref === "today" && start > ctx.nowMin) { if (!block.fixed) await dropPart(ctx, { op: "drop", name: p.name, day: "today" }); ctx.failed.push(`log ${p.did} (${short} hasn't started yet, so give me the times)`); return; }
  await logIt(ctx, ref, CAP(p.did), from, to, block);
}

async function bedtimePart(ctx: Ctx, p: Extract<EditPart, { op: "bedtime" }>): Promise<void> {
  const s = p.to; const raw = s.exact ? s.h * 60 + s.m + (s.ap === "p" && s.h < 12 ? 720 : 0) : s.h >= 6 && s.h <= 11 ? s.h * 60 + s.m + 720 : s.h === 12 ? s.m : s.h * 60 + s.m;
  const at = s.ap ? (s.h % 12) * 60 + (s.ap === "p" ? 720 : 0) + s.m : raw % 1440;
  // One writer, one read-back (bedtime-change.ts): "push sleep to 11:45" is that night only; the line says what the files now hold.
  const r = await applyBedChange({ time: hhmm(at), scope: p.scope ?? "tonight" }, async (args) => { const o = await exec(ctx, "orion-sleepplan", args); return { stdout: o.stdout, code: o.code }; });
  if (r.ok) ctx.done.push(`set your bedtime to ${ampm(toMin(r.readback.sleepBy))} ${r.readback.tonightOnly ? "tonight" : "every night from now on"} (wind-down ${ampm(toMin(r.readback.nudgeAt))}, ${r.readback.hours}h of sleep before your ${ampm(toMin(r.readback.wake))} alarm)`);
  else ctx.failed.push(`change your bedtime (${r.error.slice(0, 80)})`);
}

async function busyPart(ctx: Ctx, p: Extract<EditPart, { op: "busy" }>): Promise<void> {
  const from = Math.ceil(ctx.nowMin / 5) * 5; const until = clockFor(p.until, ctx.nowMin, "today", "future");
  if (until <= from + 5) { ctx.failed.push("push your day back (that time is basically now)"); return; }
  const out = await exec(ctx, "orion-reschedule", ["busy", `${hhmm(from)}-${hhmm(until)}`, "--why", "running late, back later"]);
  if (settle(ctx, out, "busy", "push the day back")) ctx.done.push(`blocked ${spanText(from, until)} and moved the rest of today around it`);
}

const clock12 = (hhmmText: string): string => ampm(toMin(hhmmText));

/** "i went to bed at 2 last night": kept as a fact he told me (orion-declare note), so the sleep is on record; the reply says exactly that. */
async function sleptPart(ctx: Ctx, p: Extract<EditPart, { op: "slept" }>): Promise<void> {
  const out = await ctx.deps.run("orion-declare", ["add", "--kind", "note", "--text", p.text.slice(0, 200), "--source", ctx.deps.source]).catch((): Run => ({ stdout: "", code: 1 }));
  ctx.calls.push("exec orion-declare add --kind note"); ctx.outputs.push(out.stdout);
  let id: unknown; try { id = (JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as { id?: unknown }).id; } catch { id = undefined; }
  if (out.code === 0 && typeof id === "string") { ctx.facts.push(id); ctx.done.push(`noted that ${p.text.replace(/^i /, "you ").replace(/\bi'm\b/g, "you're")}`); }
  else ctx.failed.push("note when you went to bed");
}

/** "wake me at 6": orion-wake sets the alarm; the line is said only when it answered that it did. */
async function wakePart(ctx: Ctx, p: Extract<EditPart, { op: "wake" }>): Promise<void> {
  const wake = ctx.deps.wake;
  if (!wake) { ctx.failed.push(`set your wake alarm for ${clock12(p.time)} (I can't reach the alarm from here, so ask me for it on its own)`); return; }
  const out = await wake([p.time]).catch((): Run => ({ stdout: "", code: 1 }));
  ctx.calls.push(`exec orion-wake ${p.time}`); ctx.outputs.push(out.stdout);
  if (out.code === 0 && /^Sent to/.test(out.stdout.trim())) ctx.done.push(`set your wake alarm for ${clock12(p.time)}`);
  else if (out.code === 0 && /^Saved an alarm/.test(out.stdout.trim())) ctx.failed.push(`reach your phone with the ${clock12(p.time)} wake alarm (saved on the Mac, but the phone link isn't running)`);
  else ctx.failed.push(`set your wake alarm for ${clock12(p.time)} (${out.stdout.trim().split("\n")[0]?.replace(/^orion-wake:\s*/, "").slice(0, 80) || "no reply from the alarm"})`);
}

/** "ate at 4": his food log's. Whatever it answers is said as its own; when it cannot read it, that is said plainly. */
async function foodPart(ctx: Ctx, p: Extract<EditPart, { op: "food" }>): Promise<void> {
  const said = ctx.deps.food ? await ctx.deps.food(p.text).catch(() => undefined) : undefined;
  if (said) ctx.extra.push(said); else ctx.failed.push("log what you ate (tell me what it was and I'll log it)");
}

/** "i want six hours of sleep": the bedtime that leaves that long before his next alarm, set through the bedtime entry. */
async function sleepHoursPart(ctx: Ctx, p: Extract<EditPart, { op: "sleephours" }>): Promise<void> {
  const next = nextWake(ctx.deps.stateDir, ctx.deps.now);
  if (!next) { ctx.failed.push(`plan ${p.hours} hours of sleep (I can't see an alarm to count back from, so tell me the bedtime you want)`); return; }
  const at = (((next.at.getHours() * 60 + next.at.getMinutes() - p.hours * 60) % 1440) + 1440) % 1440;
  await bedtimePart(ctx, { op: "bedtime", to: { h: Math.floor(at / 60), m: at % 60, exact: true } as never });
}

/** His bedtime from life-config.json when it names one (HH:MM); the computed one is not on disk. Best effort. */
function bedtimeOf(deps: RealityDeps): string | undefined {
  if (!deps.stateDir) return undefined;
  try { const b = (JSON.parse(readFileSync(join(deps.stateDir, "life-config.json"), "utf8")) as { bedtime?: unknown }).bedtime; return typeof b === "string" && /^\d{2}:\d{2}$/.test(b) ? b : undefined; } catch { return undefined; }
}

export async function runDayEdit(edit: DayEdit, deps: RealityDeps): Promise<RealityOutcome> {
  const ctx: Ctx = { deps, nowMin: deps.now.getHours() * 60 + deps.now.getMinutes(), calls: [], outputs: [], done: [], failed: [], sides: [], writes: 0, failures: [], unread: new Set<DayRef>(), extra: [], facts: [], placed: [], claims: [], ...(bedtimeOf(deps) ? { bedtime: bedtimeOf(deps)! } : {}) };
  const notes: string[] = []; const refused: EditPart[] = [];
  const runPart = async (p: EditPart): Promise<void> => {
    if (p.op === "add") await addPart(ctx, p);
    else if (p.op === "log") {
      const ref = pastDayRef(ctx, p.day, p.span);
      const day = await dayOf(ctx, ref);
      const r = p.span ? rangeFor(p.span, ctx.nowMin, ref, "past") : null;
      const end = ref === "today" ? ctx.nowMin : 1440;
      const from = r?.from ?? end - (p.minutes ?? 30); const to = r?.to ?? end;
      const block = blockNamed(p.name, day, ctx.nowMin);
      if (p.span && !r) ctx.failed.push(`log ${p.name} (I couldn't read those times)`); else await logIt(ctx, ref, CAP(p.name), from, to, block);
    }
    else if (p.op === "correct") await movePart(ctx, { op: "move", name: p.name, day: p.evening && p.day === "today" ? "yesterday" : p.day, to: p.at });
    else if (p.op === "shift") await shiftPart(ctx, p);
    else if (p.op === "resize") await resizePart(ctx, p);
    else if (p.op === "moveafter") await moveAfterPart(ctx, p);
    else if (p.op === "move") await movePart(ctx, p);
    else if (p.op === "drop") await dropPart(ctx, p);
    else if (p.op === "dropafter") await dropAfterPart(ctx, p);
    else if (p.op === "didnt") await didntPart(ctx, p);
    else if (p.op === "bedtime") await bedtimePart(ctx, p);
    else if (p.op === "busy") await busyPart(ctx, p);
    else if (p.op === "slept") await sleptPart(ctx, p);
    else if (p.op === "wake") await wakePart(ctx, p);
    else if (p.op === "food") await foodPart(ctx, p);
    else if (p.op === "sleephours") await sleepHoursPart(ctx, p);
    else if (p.op === "note") notes.push(p.text);
  };
  const queue = [...(await planMoves(ctx, edit.parts))];
  while (queue.length) {
    const p = queue.shift()!;
    const failedBefore = ctx.failed.length; const failuresBefore = ctx.failures.length;
    await runPart(p);
    // A bedtime said later in the same message ("gym 10-11 ... push sleep to 11:45") is what makes room for an add the day's end refused:
    // it is made first, and that add is tried once more (the scheduler's day ends at the bedtime).
    const bed = p.op === "add" && ctx.failed.length > failedBefore ? queue.findIndex((q) => q.op === "bedtime" || q.op === "sleephours") : -1;
    if (bed >= 0) {
      const [first] = queue.splice(bed, 1);
      ctx.failed.length = failedBefore; ctx.failures.length = failuresBefore;
      const bedFailedBefore = ctx.failed.length;
      await runPart(first!);
      if (ctx.failed.length > bedFailedBefore) refused.push(first!);
      await runPart(p);
    }
    if (ctx.failed.length > failedBefore) refused.push(p);
  }
  if (ctx.claims.length) await verifyClaims(ctx);
  // "anyway" later re-runs only what was refused, never what already worked
  if (refused.length) rememberEdit({ parts: refused }, deps.now); else forgetEdit();
  rememberRun(ctx.writes, ctx.facts, deps.now);
  const bits: string[] = [];
  if (ctx.done.length) bits.push(`I ${list(ctx.done)}.`);
  if (ctx.failed.length) bits.push(`I couldn't ${list(ctx.failed)}, so ${ctx.done.length ? "that part is" : "nothing is"} unchanged.`);
  // What else the scheduler did: blocks that slid are "moved"; a block that did not fit or came off is said as what it is, never as "moved".
  const side = [...new Set(ctx.sides)];
  const slid = side.filter((n) => /→|now ends at|shortened/.test(n)); const lost = side.filter((n) => !slid.includes(n));
  const more = (n: number, shown: number) => (n > shown ? ` and ${n - shown} more` : "");
  if (slid.length && ctx.done.length) bits.push(`That also moved ${list(slid.slice(0, 3))}${more(slid.length, 3)}.`);
  if (lost.length && ctx.done.length) bits.push(`${lost.slice(0, 4).map((n) => `${CAP(n)}.`).join(" ")}${more(lost.length, 4)}`.replace(/\.( and \d+ more)$/, "$1.").replace(/\.\. /g, ". "));
  const late = ctx.placed.length ? pastBedtimeNote(ctx.placed, plannedBedtime(deps.stateDir, deps.now)) : undefined;
  bits.push(...ctx.extra.map((x) => (/[.!]$/.test(x) ? x : `${x}.`)), ...notes.map((n) => `${n}.`), ...(late ? [`${late[0]!.toUpperCase()}${late.slice(1)}.`] : []));
  const text = bits.join(" ");
  const flow: FlowResult = ctx.writes || ctx.done.length
    ? { outcome: "done", calls: ctx.calls, outputs: ctx.outputs, reply: text, ...(ctx.failed.length ? { partial: true as const } : {}), ...(ctx.failures.length ? { failures: ctx.failures } : {}) }
    : { outcome: "say", kind: "plain", text: text || "I couldn't read that as a change to your day, so nothing changed.", calls: ctx.calls, outputs: ctx.outputs, ...(ctx.failures.length ? { failures: ctx.failures } : {}) };
  return { flow, facts: ctx.facts, writes: ctx.writes };
}
