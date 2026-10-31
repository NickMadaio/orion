/*
 Planning more than tonight (2026-10-31 gate run-1031202318, cluster 9).

 "plan my weekend, i want to get ahead on econ and also actually relax" and "plan sat and sun: gym 90 min each day, econ study 2 hours
 saturday, a free afternoon sunday, and 1 hour youtube both days" each became one block TONIGHT and "Partly done ... didn't fit": the
 day planner only knows today. Code plans each requested day on its own now:

   - the days: the weekend (Sat + Sun; on Saturday, the rest of today + Sunday; on Sunday, the rest of today), or tomorrow;
   - the items he listed, with his lengths and his days; when he gave no lengths, natural defaults that the reply states
     (gym 90 min each day, a study block for what he named, a rest block when he wants to relax, the side-project hour);
   - a slot search per day, on that day's real calendar, never in elapsed time, keeping any window he wants free;
   - a block of that kind already on that day is kept, not doubled; with a fully listed plan, an ORION block he did not list is taken
     off that day (never gym, study or deadline work, the side-project hour, a class, a plan with people or his own events).
 Every write is one scheduler call; the reply is read back from each day's calendar after the writes.
*/
import { ampm, ceil5, hhmm, span, takeLength, toMin } from "./intent-time.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import { namesTitle, type CalDeps, type CalOutcome } from "./calendar-resolve.js";
import { noteOf, notBooked, refused, wrote } from "./scheduler-out.js";

type Scope = "each" | "sat" | "sun";
export type PlanItem = { title: string; minutes: number; scope: Scope; kind: "gym" | "study" | "rest" | "other"; stated: boolean };
export type MultiDayPlan = { kind: "multi-day"; span: "weekend" | "tomorrow"; items: PlanItem[]; free: Array<{ scope: Scope; part: "morning" | "afternoon" | "evening" }>; listed: boolean; assumed: string[] };

const LEAD = /^(?:(?:yeah|ok(?:ay)?|so|hey|orion|pls|please|can you|could you|help me|lets|let's|i need you to)[,\s]+)*/;
const PLAN = /^(?:plan|map out|sort out|lay out|schedule|organi[sz]e|set up|build)\s+(?:out\s+)?(?:my\s+|the\s+|this\s+)?(?<days>weekend|sat(?:urday)?\s*(?:and|&|\+|n)\s*sun(?:day)?|tomorrow|tmrw)\b\s*[:,-]?\s*(?<rest>.*)$/;
const NEEDS = /^(?:tomorrow|tmrw)\s+(?:needs|i need|should have|has to have)\s+(?!to be\b)(?<rest>.+)$/;
const PARTS = { morning: [8 * 60, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, 22 * 60] } as const;
const FREE = /\b(?:a\s+)?(?:free|chill|empty|open)\s+(?<p>morning|afternoon|evening)\s+(?:on\s+)?(?<d>sat(?:urday)?|sun(?:day)?)?\b|\b(?<d2>sat(?:urday)?|sun(?:day)?)\s+(?<p2>morning|afternoon|evening)\s+(?:free|off|open)\b/;
const RELAX = /\b(?:relax|relaxing|rest|chill|downtime|down time|recharge|do nothing|unwind)\b/;
const STUDY = /\b(?:get ahead on|get ahead in|catch up on|work on|study(?:ing)?(?: for)?|revise|revision for|prep for|review)\s+(?:my\s+|some\s+|the\s+)?(?<what>[a-z][a-z0-9 ]{1,25}?)(?=\s*$|\s+(?:each|both|every|on|sat|sun|for)\b)/;
const GYM = /\b(?:gym|workout|lift(?:ing)?|train(?:ing)?)\b/;
const scopeOf = (t: string): Scope => /\b(?:each day|both days|every day|per day|a day|each)\b/.test(t) ? "each" : /\bsat(?:urday)?\b/.test(t) ? "sat" : /\bsun(?:day)?\b/.test(t) ? "sun" : "each";
const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const titleCase = (t: string) => (/^youtube$/i.test(t) ? "YouTube" : cap(t));

function readItem(piece: string): PlanItem | null {
  const len = takeLength(piece);
  const stated = !!len.minutes;
  const scope = scopeOf(piece);
  if (GYM.test(piece)) return { title: "Gym", minutes: len.minutes ?? 90, scope, kind: "gym", stated };
  const study = STUDY.exec(len.rest.replace(/\b(?:each day|both days|every day|per day|on )?\b(?:sat(?:urday)?|sun(?:day)?)\b/g, " ").replace(/\s+/g, " ").trim());
  if (study?.groups?.what) return { title: `${cap(study.groups.what.trim())} study`, minutes: len.minutes ?? 90, scope, kind: "study", stated };
  if (RELAX.test(piece)) return { title: "Rest", minutes: len.minutes ?? 120, scope, kind: "rest", stated };
  const title = len.rest.replace(/\b(?:each day|both days|every day|per day|a day|each|on|of|for|some|a|an|the|my|i want|i wanna|also|actually|and|sat(?:urday)?|sun(?:day)?)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!stated || !/^[a-z][a-z0-9' -]{1,30}$/.test(title)) return null;
  return { title: titleCase(title), minutes: len.minutes!, scope, kind: /\b(?:study|homework|revise|essay|problem set|pset)\b/.test(title) ? "study" : "other", stated };
}

/** A plan for the weekend or tomorrow, or null. */
export function readMultiDay(message: string): MultiDayPlan | null {
  const m = message.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim().replace(LEAD, "");
  if (!m || /\?$/.test(m)) return null;
  const g = PLAN.exec(m)?.groups ?? (NEEDS.exec(m)?.groups ? { days: "tomorrow", rest: NEEDS.exec(m)!.groups!.rest! } : undefined);
  if (!g) return null;
  const range = /^(?:tomorrow|tmrw)$/.test(g.days!) ? "tomorrow" : "weekend";
  const pieces = (g.rest ?? "").split(/\s*(?:,|;|\band also\b|\balso\b|\band\b|&|\bplus\b)\s*/).map((p) => p.replace(/^(?:i want to|i wanna|i'd like to|i need to|want to|to)\s+/, "").trim()).filter(Boolean);
  const free: MultiDayPlan["free"] = [];
  const items: PlanItem[] = [];
  for (const p of pieces) {
    const f = FREE.exec(p);
    if (f?.groups) { free.push({ scope: scopeOf(f.groups.d ?? f.groups.d2 ?? ""), part: (f.groups.p ?? f.groups.p2) as "morning" | "afternoon" | "evening" }); continue; }
    const it = readItem(p);
    if (it && !items.some((x) => x.title === it.title && x.scope === it.scope)) items.push(it);
  }
  const listed = items.some((i) => i.stated);
  const assumed: string[] = [];
  if (!listed) {
    if (!items.some((i) => i.kind === "gym")) { items.unshift({ title: "Gym", minutes: 90, scope: "each", kind: "gym", stated: false }); assumed.push("gym 90 min each day"); }
    for (const i of items.filter((x) => x.kind === "study")) assumed.push(`${i.title.toLowerCase()} ${i.minutes} min each day`);
    for (const i of items.filter((x) => x.kind === "rest")) assumed.push(`a ${i.minutes / 60}-hour rest block each day`);
    items.push({ title: "Side project", minutes: 60, scope: "each", kind: "other", stated: false }); assumed.push("your side-project hour");
  }
  if (!items.length && !free.length) return null;
  return { kind: "multi-day", span: range, items, free, listed, assumed };
}

// ---- carrying out ----
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
type Target = { date: string; name: string; scope: Scope | "other"; today: boolean };
/** The days the plan covers, from now. */
export function planDays(range: MultiDayPlan["span"], now: Date): Target[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const at = (plus: number) => new Date(base.getTime() + plus * 86400_000);
  const mk = (plus: number): Target => { const d = at(plus); const w = d.getDay(); return { date: ymd(d), name: WEEKDAY[w]!, scope: w === 6 ? "sat" : w === 0 ? "sun" : "other", today: plus === 0 }; };
  if (range === "tomorrow") return [mk(1)];
  const dow = base.getDay();
  if (dow === 6) return [mk(0), mk(1)];
  if (dow === 0) return [mk(0)];
  return [mk(6 - dow), mk(7 - dow)];
}
const applies = (scope: Scope, t: Target) => scope === "each" || scope === t.scope;
const PREFERRED: Record<PlanItem["kind"], number> = { gym: 17 * 60, study: 10 * 60, rest: 14 * 60, other: 19 * 60 + 30 };
const DAY_START = 9 * 60; const DAY_END = 22 * 60 + 30; const GAP = 5;
const isFixed = (b: DayBlock) => b.fixed || b.kind === "class";
/** Only an ORION-owned "other" block may leave a day: never a class, gym, deadline or study, the side project, or any event of his own. */
const mayDrop = (b: DayBlock) => !isFixed(b) && b.kind === "other";
const label = (b: DayBlock) => b.title.replace(/\s+—.*$/, "");

/** The first free start at or after `from` for `minutes`, inside the day and outside the windows he wants free. */
export function firstFit(busy: Array<[number, number]>, minutes: number, from: number, lo: number, hi = DAY_END): number | undefined {
  const tryFrom = (start: number): number | undefined => {
    let t = Math.max(start, lo); let moved = true;
    while (moved) { moved = false; for (const [s, e] of busy) if (t < e + GAP && t + minutes + GAP > s) { t = e + GAP; moved = true; } }
    return t + minutes <= hi ? t : undefined;
  };
  return tryFrom(from) ?? tryFrom(lo);
}

type Exec = { calls: string[]; outputs: string[]; writes: number; run: (args: string[]) => Promise<{ stdout: string; ok: boolean }> };
const canon = (args: string[]) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
function executor(deps: CalDeps): Exec {
  const x: Exec = { calls: [], outputs: [], writes: 0, run: async (args) => {
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    x.calls.push(`exec orion-reschedule ${canon(args)}`); x.outputs.push(out.stdout);
    if (wrote(out)) x.writes += 1;
    return { stdout: out.stdout, ok: !refused(out) && !(args[0] === "add" && notBooked(out.stdout, args[1]!)) };
  } };
  return x;
}
const sameKind = (i: PlanItem, b: DayBlock) => namesTitle(i.title, b.title) || (i.kind === "gym" && b.kind === "gym") || (i.title === "Side project" && b.kind === "side_project") || (i.kind === "rest" && b.kind === "rest" && /\brest\b/i.test(b.title));

async function planOne(t: Target, plan: MultiDayPlan, deps: CalDeps, x: Exec): Promise<{ line: string; notes: string[] }> {
  const read = () => (t.today ? deps.readDay() : deps.readDayOn?.(["--date", t.date]) ?? Promise.resolve(undefined)).catch(() => undefined);
  let day: Day | undefined = await read();
  if (!day) return { line: `${t.name}: I couldn't read that day, so nothing changed there`, notes: [] };
  const nowMin = t.today ? deps.now.getHours() * 60 + deps.now.getMinutes() : -1;
  const lo = t.today ? Math.max(DAY_START, ceil5(nowMin + GAP)) : DAY_START;
  const items = plan.items.filter((i) => applies(i.scope, t));
  const free = plan.free.filter((f) => applies(f.scope, t)).map((f) => PARTS[f.part] as readonly [number, number]);
  const notes: string[] = []; const kept: string[] = []; const off: string[] = [];
  const dateArgs = ["--date", t.date];
  // A listed plan is the whole plan: only ORION's own low-priority other blocks he did not list leave that day, and the reply names them.
  for (const b of day.blocks) {
    const inFree = free.some(([s, e]) => toMin(b.start) < e && toMin(b.end) > s);
    const unlisted = plan.listed && !items.some((i) => sameKind(i, b));
    if (!mayDrop(b) || toMin(b.end) <= nowMin || !(unlisted || inFree)) continue;
    const out = await x.run(["drop", b.title, ...dateArgs]);
    if (out.ok) off.push(`${label(b)} (${inFree && !unlisted ? "kept that time free" : "not in your plan"})`); else notes.push(`I couldn't take ${label(b)} off ${t.name}`);
  }
  if (off.length) day = (await read()) ?? day;
  const order: PlanItem["kind"][] = ["gym", "study", "other", "rest"];
  for (const i of [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const have = day!.blocks.find((b) => sameKind(i, b) && toMin(b.end) > nowMin);
    if (have && toMin(have.end) - toMin(have.start) >= i.minutes - 5) { kept.push(label(have)); continue; }
    const busy: Array<[number, number]> = [...day!.blocks.map((b): [number, number] => [toMin(b.start), toMin(b.end)]), ...free.map(([s, e]): [number, number] => [s, e])];
    const at = firstFit(busy, i.minutes, Math.max(PREFERRED[i.kind], lo), lo);
    if (at === undefined) { notes.push(`${i.title} (${i.minutes} min) didn't fit on ${t.name}`); continue; }
    const out = await x.run(["add", i.title, String(i.minutes), "--at", hhmm(at), ...dateArgs]);
    if (!out.ok) { notes.push(`${i.title} didn't go in on ${t.name}`); continue; }
    for (const l of out.stdout.split("\n")) { const n = noteOf(l.trim()); if (n && n[0].toLowerCase() !== i.title.toLowerCase()) notes.push(`${n[1]} (${t.name})`); }
    day = (await read()) ?? day;
  }
  // What the day holds now, read back: every listed or kept item with its real time.
  const shown = (day?.blocks ?? []).filter((b) => toMin(b.end) > nowMin && items.some((i) => sameKind(i, b))).sort((a, b) => toMin(a.start) - toMin(b.start));
  const parts = shown.map((b) => `${label(b)} ${span(toMin(b.start), toMin(b.end))}${kept.includes(label(b)) ? " (already on)" : ""}`);
  const freeSaid = free.map(([s, e]) => `${ampm(s).replace(":00", "")}–${ampm(e).replace(":00", "")} kept free`);
  const offSaid = off.length ? `; took off ${off.join(", ")}` : "";
  return { line: `${t.name}${t.today ? " (rest of today)" : ""}: ${[...parts, ...freeSaid].join(", ") || "nothing new"}${offSaid}`, notes };
}

/** Plans each requested day; the reply lists each day as its calendar now reads. */
export async function runMultiDay(plan: MultiDayPlan, deps: CalDeps): Promise<CalOutcome> {
  const x = executor(deps);
  const lines: string[] = []; const notes: string[] = [];
  for (const t of planDays(plan.span, deps.now)) {
    const one = await planOne(t, plan, deps, x);
    lines.push(one.line); notes.push(...one.notes);
  }
  const assumed = plan.assumed.length ? ` I assumed ${plan.assumed.join(", ")}; tell me what to change.` : "";
  const undo = x.writes > 1 ? ` Each change is its own step, so "undo" takes them back one at a time.` : x.writes ? ` Say "undo" to put it back.` : "";
  const text = `${x.writes ? "Done. " : ""}${lines.join(". ")}.${notes.length ? ` Also: ${notes.join("; ")}.` : ""}${assumed}${undo}`;
  const flow: FlowResult = x.writes ? { outcome: "done", calls: x.calls, outputs: x.outputs, reply: text } : { outcome: "say", kind: "plain", text, calls: x.calls, outputs: x.outputs };
  return { flow, facts: [], writes: x.writes };
}
