/*
 The time a cancelled class frees goes by his priorities (wave 6 B, gate run-1101003318, sch-no-class-c).

 "i dont have marketing or macro today, both are cancelled, use the time" ran `orion-reschedule fill`, which lays out routines: it
 booked Dinner, Wind down and a 30-minute Break, moved Gym 17:00 → 19:20 to clear the routine dinner, moved the side project after
 it, and the reply named none of those moves. The freed hours got nothing that matters.

 Code plans the freed class spans itself, in his order (classes fixed > gym 90 > deadlines/study > side project 1h > other > rest):
   - gym, when today has none, takes the first freed span long enough for its full length;
   - each freed span (what is left of it) becomes study: for his nearest deadline when he has one, else for the class that was
     cancelled (the reply says which assumption it made);
   - an hour of side project, when today has none and a span still has an hour left after two hours of study.
 Time already past is not planned. What is booked goes in with ONE `orion-reschedule day --plan …` (no --fill), so nothing else is
 laid out around it; the reply is read back from the day after the write and names every change the scheduler printed.
*/
import type { Day, DayBlock } from "./schedule-flow.js";
import { ampm, toMin } from "./intent-time.js";
import { refused, sideNotes, wrote } from "./scheduler-out.js";
import { bookedSpan } from "./lighten-said.js";
import { soonDeadlines } from "./day-lighten.js";
import type { DeadlineRead } from "./deadline-read.js";

export type Cancelled = { title: string; start: string; end: string };
export type FreedPlan = { title: string; minutes: number; start: string; why: "gym" | "deadline" | "study" | "side_project" };

const MIN_SPAN = 25;
const STUDY_CAP = 120;
const hhmm = (n: number): string => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const short = (t: string) => t.replace(/\s+[—–-]\s+.*$/, "").trim();

/** The classes `orion-reschedule classes-off` printed as cancelled, with their spans. */
export function cancelledFrom(stdout: string): Cancelled[] {
  return [...stdout.matchAll(/cancelled (.+?) (\d{2}:\d{2})[–-](\d{2}:\d{2})/g)].map((m) => ({ title: m[1]!.trim(), start: m[2]!, end: m[3]! }));
}

const has = (day: Day, kind: string, nowMin: number) => day.blocks.some((b: DayBlock) => b.kind === kind && toMin(b.end) > nowMin);
/** REV6 item 6: any gym block today counts, finished or not (a 7 AM gym already done is still today's gym). */
const hasAnyToday = (day: Day, kind: string) => day.blocks.some((b: DayBlock) => b.kind === kind);

/** What goes where in the freed time, in priority order. Pure. */
export function planFreedTime(ctx: { day: Day; cancelled: Cancelled[]; nowMin: number; deadlines: string[] }): FreedPlan[] {
  const buffer = ctx.day.plan?.bufferMinutes ?? 5;
  const spans = ctx.cancelled
    .map((c) => ({ from: Math.max(toMin(c.start), ceil5(ctx.nowMin)), to: toMin(c.end), cls: short(c.title) }))
    .filter((s) => s.to - s.from >= MIN_SPAN)
    .sort((a, b) => a.from - b.from);
  const plans: FreedPlan[] = [];
  const gymMinutes = ctx.day.plan?.anchors.find((a) => /\bgym\b/i.test(a.title))?.minutes ?? 90;
  if (!hasAnyToday(ctx.day, "gym")) {
    const room = spans.find((s) => s.to - s.from >= gymMinutes);
    if (room) { plans.push({ title: "Gym", minutes: gymMinutes, start: hhmm(room.from), why: "gym" }); room.from += gymMinutes + buffer; }
  }
  let sideWanted = !has(ctx.day, "side_project", ctx.nowMin);
  spans.forEach((s, i) => {
    const left = s.to - s.from;
    if (left < MIN_SPAN) return;
    const deadline = ctx.deadlines.length ? ctx.deadlines[i % ctx.deadlines.length] : undefined;
    const minutes = Math.min(left, STUDY_CAP);
    plans.push({ title: deadline ? `Study for ${deadline}` : `Study ${s.cls}`, minutes, start: hhmm(s.from), why: deadline ? "deadline" : "study" });
    const after = s.from + minutes + buffer;
    if (sideWanted && s.to - after >= 60) { plans.push({ title: "Side project", minutes: 60, start: hhmm(after), why: "side_project" }); sideWanted = false; }
  });
  return plans.sort((a, b) => toMin(a.start) - toMin(b.start));
}

/** The one scheduler call that books them. */
export const freedArgs = (plans: FreedPlan[]): string[] => ["day", ...plans.flatMap((p) => ["--plan", `${p.title.replace(/,/g, " ")}, ${p.minutes}, ${p.start}`])];

const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const span = (s: { start: string; end: string }) => `${ampm(toMin(s.start))}–${ampm(toMin(s.end))}`;

/** What he hears about the freed time: read back from the day after the write, the assumption made, gym, and every other change. */
export function freedReply(plans: FreedPlan[], ctx: { before: Day; after?: Day; outputs: string[]; deadlines: string[] }): string {
  const booked = plans.map((p) => { const s = bookedSpan(p.title, ctx.outputs.join("\n"), ctx.after); return s ? `${p.title} ${span(s)}` : undefined; }).filter((x): x is string => !!x);
  if (!booked.length) return "";
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

type Run = (script: "orion-reschedule", args: string[]) => Promise<{ stdout: string; code: number }>;
export type FreedDeps = { day: Day; offStdout: string; now: Date; run: Run; readDeadlines?: () => Promise<DeadlineRead | null | undefined> };

/** Plans and books the freed time, and says it. Nothing to plan (the time is past) or a refused write says so plainly. */
export async function fillFreedTime(deps: FreedDeps): Promise<{ text: string; calls: string[]; outputs: string[]; writes: number }> {
  const nowMin = deps.now.getHours() * 60 + deps.now.getMinutes();
  const read = deps.readDeadlines ? await deps.readDeadlines().catch(() => undefined) : undefined;
  const deadlines = soonDeadlines(read ?? null, deps.now).map((d) => d.title);
  const plans = planFreedTime({ day: deps.day, cancelled: cancelledFrom(deps.offStdout), nowMin, deadlines });
  if (!plans.length) return { text: " That time is already behind you, so there was nothing left of it to plan.", calls: [], outputs: [], writes: 0 };
  const args = freedArgs(plans);
  const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  const calls = [`exec orion-reschedule ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`];
  if (refused(out) || !wrote(out)) return { text: " I couldn't plan the freed time just now, so nothing else changed.", calls, outputs: [out.stdout], writes: 0 };
  const shown = await deps.run("orion-reschedule", ["show", "--json"]).catch(() => ({ stdout: "", code: 1 }));
  let after: Day | undefined;
  try { const d = JSON.parse(shown.stdout) as Day; after = Array.isArray(d?.blocks) ? d : undefined; } catch { after = undefined; }
  const text = freedReply(plans, { before: deps.day, ...(after ? { after } : {}), outputs: [out.stdout], deadlines });
  return { text: text || " I planned the freed time.", calls, outputs: [out.stdout], writes: 1 };
}
