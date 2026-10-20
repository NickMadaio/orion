/*
 A calendar intent (calendar-intent.ts) carried out against the day it is for: exactly one scheduler call, or a specific, honest line.
 Every "no" says why: the block is not on that day, it is a class, it already ended, the time has passed, the time could be morning
 or evening, it overlaps a class, or the follow-up named something the request did not. Nothing here asks a model.
 undefined = the normal path (a class to skip or overrun, a day with nothing to start from).
*/
import type { CalendarIntent, IntentItem, TimeIssue } from "./calendar-intent.js";
import { blocksNamed, planReplan, type DayReplan, type ReplanAsk } from "./day-replan.js";
import { parseDirectAdd, type DirectAdd } from "./direct-add.js";
import { ampm, hhmm, parseClock, resolveEnd, span, toMin } from "./intent-time.js";
import type { AskContext, Day, DayBlock } from "./schedule-flow.js";

export type IntentPlan =
  | { kind: "run"; argv: string[]; replan?: Extract<DayReplan, { args: string[] }>; direct?: Extract<DirectAdd, { args: string[] }>; title: string }
  | { kind: "say"; say: "ask" | "cannot" | "plain"; text: string };

const DEFAULT_ADD_MINUTES = 30;
const cap = (t: string): string => t.replace(/^./, (c) => c.toUpperCase());
const label = (b: DayBlock): string => b.title.replace(/\s+—.*$/, "");
const onWhat = (intent: CalendarIntent): string => (intent.day === "tomorrow" ? "your day tomorrow" : "your day");
const isFixed = (b: DayBlock): boolean => b.fixed || b.kind === "class";
const nowOf = (day: Day): number | null => (day.now ? toMin(day.now) : null);

/** The block on the day his name means: one still to come first, else the latest. Two different blocks by that name: "ambiguous" (never a guess). */
function blockFor(name: string, day: Day): DayBlock | "ambiguous" | undefined {
  const now = nowOf(day) ?? -1;
  const found = blocksNamed(name, day);
  if (new Set(found.map((b) => b.title.toLowerCase())).size > 1) return "ambiguous";
  return found.filter((b) => toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0] ?? [...found].sort((a, b) => toMin(b.end) - toMin(a.end))[0];
}

function issueText(issue: TimeIssue, item: IntentItem, intent: CalendarIntent, day: Day, what: string): string {
  if (issue.kind === "from-now-not-today") return `"From now" only works for today, so I haven't booked ${item.name} ${intent.day}. Tell me when it should start.`;
  if (issue.kind === "ambiguous") return `Do you mean ${ampm(toMin(issue.choices[0]))} or ${ampm(toMin(issue.choices[1]))} ${intent.day}? I haven't ${what} ${item.name} yet.`;
  const now = nowOf(day);
  return `${ampm(toMin(issue.at))} has already passed${now !== null ? ` (it's ${ampm(now)})` : ""}, so I haven't ${what} ${item.name}. Tell me a later time${issue.field === "start" && intent.day === "today" ? ", or say tomorrow" : ""}.`;
}

/** The fixed block (a class, a plan with people) a block at [start, start+minutes) would sit on. */
const clashWith = (start: number, minutes: number, day: Day): DayBlock | undefined =>
  day.blocks.filter(isFixed).find((b) => toMin(b.start) < start + minutes && toMin(b.end) > start);

function planAdd(intent: CalendarIntent, day: Day, message: string, askContext?: AskContext): IntentPlan | undefined {
  const item = intent.items[0]!;
  if (item.issue && (item.issue.kind !== "passed" || !intent.until)) return { kind: "say", say: item.issue.kind === "ambiguous" ? "ask" : "cannot", text: issueText(item.issue, item, intent, day, "booked") };
  if (intent.until) {
    // "put X [from now] until T": direct-add.ts reads it against the day (the title ORION uses, --again for a second session, the same clock rules).
    const direct = parseDirectAdd(message, day, askContext);
    if (!direct) return undefined;
    return "say" in direct ? { kind: "say", say: direct.say, text: direct.text } : { kind: "run", argv: direct.args, direct, title: direct.title };
  }
  if (!item.start) return undefined;   // no time: the normal path previews it first, so an add he did not pin never shuffles his day
  const start = toMin(item.start);
  const now = nowOf(day);
  const same = blocksNamed(item.name, day).filter((b) => !isFixed(b));
  const ahead = same.find((b) => now === null || toMin(b.start) > now);
  if (ahead) return { kind: "say", say: "plain", text: `${cap(label(ahead))} is already on ${onWhat(intent)}, ${span(toMin(ahead.start), toMin(ahead.end))}, so I haven't added another. Say "move ${item.name} to ${ampm(start).replace(":00", "")}" to move it.` };
  const anchor = day.plan?.anchors.find((a) => blocksNamed(item.name, { ...day, blocks: [{ title: a.title, start: "00:00", end: "00:00", fixed: false }] }).length > 0);
  const minutes = item.minutes ?? anchor?.minutes ?? DEFAULT_ADD_MINUTES;
  const title = anchor?.title ?? same[0]?.title ?? item.name;
  if (start + minutes > 1440) return { kind: "say", say: "cannot", text: `${cap(title)} at ${ampm(start)} for ${minutes} minutes would run past midnight, so I haven't booked it.` };
  const clash = clashWith(start, minutes, day);
  if (clash) return { kind: "say", say: "cannot", text: `${cap(label(clash))} is ${span(toMin(clash.start), toMin(clash.end))}${intent.day === "tomorrow" ? " tomorrow" : ""}, so ${title} can't go at ${ampm(start)}. I haven't booked it. Tell me another time.` };
  const again = same.some((b) => now !== null && toMin(b.start) <= now);
  return { kind: "run", argv: ["add", title, String(minutes), "--at", hhmm(start), ...(again ? ["--again"] : [])], title };
}

/** The block a move, extend or remove is about, or the line that says why there is none. */
function target(intent: CalendarIntent, day: Day, what: string): { block: DayBlock } | IntentPlan | undefined {
  const item = intent.items[0]!;
  const b = blockFor(item.name, day);
  if (b === "ambiguous") return undefined;   // "lab" = the CS Lab study block or the lab class: the normal path asks
  if (!b) return { kind: "say", say: "cannot", text: `There's no ${item.name} on ${onWhat(intent)}, so I haven't ${what} anything.` };
  if (isFixed(b)) return intent.verb === "move" ? { kind: "say", say: "cannot", text: `${cap(label(b))} is a class or a plan with people, so it doesn't move. I haven't changed anything.` } : undefined;
  return { block: b };
}

function planMove(intent: CalendarIntent, day: Day): IntentPlan | undefined {
  const item = intent.items[0]!;
  const t = target(intent, day, "moved");
  if (!t || !("block" in t)) return t;
  const b = t.block;
  if (item.issue) return { kind: "say", say: item.issue.kind === "ambiguous" ? "ask" : "cannot", text: issueText(item.issue, item, intent, day, "moved") };
  const now = nowOf(day);
  if (now !== null && toMin(b.end) <= now) return { kind: "say", say: "plain", text: `${cap(label(b))} already ended at ${ampm(toMin(b.end))}, so I haven't moved it. Say "add ${item.name}" and when, if you want another one.` };
  const to = item.start ? toMin(item.start) : toMin(b.start) + (item.by ?? 0);
  if (now !== null && to < now) return { kind: "say", say: "cannot", text: `That would start ${label(b)} at ${ampm(to)}, which has already passed, so I haven't moved it.` };
  if (to + (toMin(b.end) - toMin(b.start)) > 1440) return { kind: "say", say: "cannot", text: `${cap(label(b))} would run past midnight from ${ampm(to)}, so I haven't moved it.` };
  const clash = clashWith(to, toMin(b.end) - toMin(b.start), day);
  if (clash) return { kind: "say", say: "cannot", text: `${cap(label(clash))} is ${span(toMin(clash.start), toMin(clash.end))}${intent.day === "tomorrow" ? " tomorrow" : ""}, so ${label(b)} can't go at ${ampm(to)}. I haven't moved it. Tell me another time.` };
  return { kind: "run", argv: ["move", b.title, "--to", hhmm(to)], title: b.title };
}

function planExtend(intent: CalendarIntent, day: Day): IntentPlan | undefined {
  const item = intent.items[0]!;
  const t = target(intent, day, "extended");
  if (!t || !("block" in t)) return t;
  const b = t.block;
  if (item.minutes) return { kind: "run", argv: ["extend", b.title, String(item.minutes)], title: b.title };
  const said = item.endSaid ? parseClock(item.endSaid) : null;
  if (!said) return undefined;
  const end = resolveEnd(said, toMin(b.start), { day: intent.day, now: nowOf(day) });
  if ("passed" in end) return { kind: "say", say: "cannot", text: issueText({ kind: "passed", at: hhmm(end.passed), field: "end" }, item, intent, day, "extended") };
  if (!("at" in end) || end.at <= toMin(b.end)) return { kind: "say", say: "cannot", text: `${cap(label(b))} already ends at ${ampm(toMin(b.end))}, so extending it to ${item.endSaid} would not make it longer. I haven't changed anything.` };
  return { kind: "run", argv: ["extend", b.title, "--until", hhmm(end.at)], title: b.title };
}

function planRemove(intent: CalendarIntent, day: Day): IntentPlan | undefined {
  const t = target(intent, day, "taken off");
  if (!t || !("block" in t)) return t;
  const b = t.block;
  const now = nowOf(day);
  if (now !== null && toMin(b.end) <= now) return { kind: "say", say: "plain", text: `${cap(label(b))} already ended at ${ampm(toMin(b.end))}, so there's nothing to take off.` };
  return { kind: "run", argv: ["drop", b.title], title: b.title };
}

/** "dinner then gym" after a replan that did not have dinner: nothing is reordered; he is told what stands and how to ask for it. */
function outsideReply(intent: CalendarIntent, day: Day): IntentPlan {
  const ask = intent.replan!;
  const out = intent.outside!;
  const known = ask.order.filter((n) => !out.includes(n));
  const where = intent.day === "tomorrow" ? " tomorrow" : "";
  const stands = known.map((n) => blockFor(n, day)).filter((b): b is DayBlock => !!b && b !== "ambiguous").map((b) => `${label(b)} is still ${span(toMin(b.start), toMin(b.end))}${where}`);
  const missing = out.filter((n) => !blockFor(n, day));
  const said = ask.order.map((n) => (missing.includes(n) ? `${n} for 30 min` : n)).join(" then ");
  const lead = intent.day === "tomorrow" ? "reschedule tomorrow" : "reschedule my day";
  const from = ask.anchor ? ` after my ${ask.anchor}` : ask.home ? " after I get home" : "";
  const names = out.map(cap).join(" and ");
  return { kind: "say", say: "plain", text: `${names} ${out.length > 1 ? "weren't" : "wasn't"} in the plan I just made${missing.length ? ` and ${missing.length > 1 ? "aren't" : "isn't"} on ${onWhat(intent)}` : ""}, so I haven't changed anything${stands.length ? `: ${stands.join(", ")}` : ""}. To change the order, say "${lead}${from}, do ${said}".` };
}

/** The intent against the day: one scheduler argv, a line to say, or undefined (the normal path). */
export function planIntent(intent: CalendarIntent, day: Day, ctx: { message: string; askContext?: AskContext }): IntentPlan | undefined {
  switch (intent.verb) {
    case "replan": case "reorder": {
      if (intent.outside?.length) return outsideReply(intent, day);
      const plan = planReplan(intent.replan as ReplanAsk, day, ctx.message);
      if (!plan) return undefined;
      return "say" in plan ? { kind: "say", say: plan.say, text: plan.text } : { kind: "run", argv: plan.args, replan: plan, title: plan.items[0]!.title };
    }
    case "add": return planAdd(intent, day, ctx.message, ctx.askContext);
    case "move": return planMove(intent, day);
    case "extend": return planExtend(intent, day);
    case "remove": return planRemove(intent, day);
    default: return undefined;
  }
}

/** The intents code runs before the front desk is asked (local-routing.ts): the ones whose words alone decide the change. */
export const runsFirst = (intent: CalendarIntent): boolean =>
  intent.verb === "replan" || intent.verb === "reorder" || (intent.verb === "add" && (!!intent.until || !!intent.items[0]?.start || !!intent.items[0]?.issue));
