/*
 Clear calendar writes on a block he names (2026-10-31 gate run-1031202318, cluster 3).

 "extend cs lab to two hours today, 8 to 10pm" came back "Nothing on your day changed." while a pin was written; "add cs lab 7:15pm to
 10:30pm tonight" came back "Not done: DS Lab 05 is already on today's calendar". The block was matched on "lab" alone (words under
 three letters were dropped), and the reply was not built from what the scheduler did. Code owns these now, with no model:

   extend X to two hours [, 8 to 10pm]       X's end (and start, if he gave one) set to what he said        extend / move --until
   X is gonna take more like two hours       X runs that long from its own start                            extend --until
   put X from now until 10:30 / add X A to B X, if it is still on that day, becomes A–B; otherwise added     move --until / add --at

 resolveNamed() is the one place his words meet the real calendar: every long word must match a word of the title, and a short
 qualifier he said ("cs", "ds") must be in the title, so "cs lab" is never "DS Lab 05". Nothing is placed in elapsed time: a start a
 few minutes gone becomes now (said back); one longer gone is refused. Classes and plans with people are not moved here (the
 scheduler refuses to move a repeating event); that is said, and nothing changes. The reply reads the day again after the write.
*/
import { ampm, CLOCK, ceil5, hhmm, parseClock, resolveEnd, resolveStart, span, takeLength, toMin, spokenTimesToDigits } from "./intent-time.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import { noteOf, notBooked, refused, wrote } from "./scheduler-out.js";
import { blocksNamedBy, namesTitle as namesTitleBy } from "./block-names.js";

export type NamedWrite = { kind: "named-write"; op: "length" | "span"; name: string; minutes?: number; from?: string; until?: string; day: "today" | "tomorrow"; evening: boolean };
export type CalScript = (script: "orion-declare" | "orion-reschedule" | "orion-tasks", args: string[]) => Promise<{ stdout: string; code: number }>;
export type CalDeps = { run: CalScript; readDay: () => Promise<Day | undefined>; readDayOn?: (dateArgs: string[]) => Promise<Day | undefined>; now: Date };
export type CalOutcome = { flow: FlowResult; facts: string[]; writes: number };

// ---- matching his words against the day: block-names.ts (filler, course subjects, "cs" ≠ "DS Lab 05") ----
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SHORT_FILLER = new Set(["to", "at", "on", "in", "of", "up", "go", "do", "is", "it", "me", "we", "so", "or", "by", "no", "am", "pm", "vs", "my"]);
/** Whether his name for a block is this title: every long word matches (a course's subject counts), and every short qualifier is there. */
export function namesTitle(name: string, title: string): boolean {
  return namesTitleBy(name, title);
}

/** The block of his day he means: the same title first, then one still ahead (earliest), else the latest one that already ended. */
export function resolveNamed(name: string, day: Day | undefined, now: number): { block: DayBlock; over: boolean } | undefined {
  const found = blocksNamedBy(name, day?.blocks ?? []);
  if (!found.length) return undefined;
  const exact = found.filter((b) => norm(b.title) === norm(name).replace(/^(?:my|the) /, ""));
  const pool = exact.length ? exact : found;
  const ahead = pool.filter((b) => toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  if (ahead) return { block: ahead, over: false };
  const last = [...pool].sort((a, b) => toMin(b.end) - toMin(a.end))[0]!;
  return { block: last, over: true };
}

// ---- reading ----
const LEAD = /^(?:(?:yeah|yea|ya|ok(?:ay)?|so|hey|orion|actually|um+|uh+|alright|right|pls|please)[,\s]+)*/;
const NAME = String.raw`(?<name>[a-z][a-z0-9' &-]{0,30}?)`;
const LEN = String.raw`(?<len>(?:\d{1,3}(?:\.\d)?|an?|one|two|three|four|half an?|an? hour and a half)\s*(?:hours?|hrs?|h|minutes?|mins?)(?:\s+and\s+a\s+half)?)`;
const DAYW = String.raw`(?<day>today|tonight|tomorrow|tmrw)`;
const START = String.raw`(?<a>now|right now|rn|${CLOCK})`;
const UNTIL = String.raw`\s*(?:to|-|–|until|till|til|thru|through)\s*(?<b>${CLOCK})`;
const EXTEND = new RegExp(String.raw`^(?:extend|stretch|lengthen|make)\s+(?:my\s+|the\s+)?${NAME}\s+(?:to\s+|into\s+|out to\s+)?(?:be\s+)?${LEN}(?:\s+long)?(?:\s+${DAYW})?(?:\s*,?\s*(?:so\s+|like\s+|from\s+)?${START}${UNTIL})?(?:\s+(?:today|tonight|tomorrow|tmrw))?$`);
const EXTEND_UNTIL = new RegExp(String.raw`^(?:extend|stretch|keep|run)\s+(?:my\s+|the\s+)?${NAME}\s+(?:going\s+)?(?:to|until|till|til)\s+(?<b>${CLOCK})(?:\s+${DAYW})?$`);
const TAKES = new RegExp(String.raw`^(?:(?:the|my|this)\s+)?${NAME}\s+(?:(?:is|'s|will|'ll|might|gonna|going to|is gonna|is going to|prob(?:ably)?|def(?:initely)?|actually)\s+)*(?:take|takes|run|last|be)\s+(?:(?:more like|like|about|around|closer to|nearer|roughly|maybe|at least|prob(?:ably)?)\s+)?${LEN}(?:\s+(?:today|tonight|total|instead|not one|not an hour))?$`);
const SPAN = new RegExp(String.raw`^(?:(?:can you|could you|i want to|i wanna|lets|let's|go ahead and)\s+)?(?:add|put|book|schedule|block(?:\s+out|\s+off)?|pencil in|throw in|slot in|do)\s+(?:in\s+)?(?:a\s+|an\s+|my\s+|the\s+|some\s+)?${NAME}\s+(?:(?:block|session)\s+)?(?:(?:today|tonight|tomorrow|tmrw)\s+)?(?:from\s+)?${START}${UNTIL}(?:\s+${DAYW})?$`);
const NOT_A_NAME = /^(?:it|that|this|them|everything|all|something|stuff|me|time|a block|the rest)$/;

const clean = (m: string) => spokenTimesToDigits(m).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim().replace(LEAD, "");

/** A clear write on a block he names, or null. */
export function readNamedWrite(message: string): NamedWrite | null {
  const m = clean(message);
  if (!m || /\?$/.test(m)) return null;
  const hit = EXTEND.exec(m) ?? TAKES.exec(m);
  const g = hit?.groups ?? SPAN.exec(m)?.groups ?? EXTEND_UNTIL.exec(m)?.groups;
  if (!g) return null;
  const name = g.name!.replace(/^(?:my|the|a|an)\s+/, "").trim();
  if (!name || NOT_A_NAME.test(name) || /\b(?:and|then|reminder|alarm|todo|to-do|focus)\b/.test(name)) return null;
  const day = /^(?:tomorrow|tmrw)$/.test(g.day ?? "") || /\b(?:tomorrow|tmrw)\b/.test(m) ? "tomorrow" : "today";
  const evening = g.day === "tonight" || /\btonight\b/.test(m);
  const minutes = g.len ? takeLength(g.len).minutes : undefined;
  if (g.len && !minutes) return null;
  return { kind: "named-write", op: g.len ? "length" : "span", name, ...(minutes ? { minutes } : {}), ...(g.a ? { from: g.a.trim() } : {}), ...(g.b ? { until: g.b.trim() } : {}), day, evening };
}

// ---- carrying out ----
const UNDO = "Say \"undo\" to put it back.";
const READ_FAILED = "I couldn't read your calendar just now, so nothing changed. Tell me again in a moment.";
const say = (text: string, calls: string[] = [], outputs: string[] = [], kind: "plain" | "ask" = "plain"): FlowResult => ({ outcome: "say", kind, text, calls, outputs });
const label = (b: DayBlock) => b.title.replace(/\s+—.*$/, "");
const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const canon = (args: string[]) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
const isFixed = (b: DayBlock) => b.fixed || b.kind === "class";
/** How long ago a start he said may be and still mean "now" (he typed it a few minutes late). */
export const LATE_START_GRACE = 20;

type Exec = { calls: string[]; outputs: string[]; writes: number; run: (args: string[]) => Promise<{ stdout: string; code: number; ok: boolean }> };
function executor(deps: CalDeps): Exec {
  const x: Exec = { calls: [], outputs: [], writes: 0, run: async (args) => {
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    x.calls.push(`exec orion-reschedule ${canon(args)}`); x.outputs.push(out.stdout);
    const own = args[0] === "add" && args[1] ? notBooked(out.stdout, args[1]) : false;
    if (wrote(out)) x.writes += 1;
    return { ...out, ok: !refused(out) && !own };
  } };
  return x;
}
/** The scheduler's refusal in plain words, or nothing: no flags, script names or advice to ORION. */
function reason(stdout: string): string {
  const raw = /NOTHING WAS (?:CHANGED|BOOKED)(?: on [^:.]+)?: (.+)/.exec(stdout)?.[1];
  if (!raw) return /NOT BOOKED/.test(stdout) ? " (there wasn't room for it)" : "";
  const why = raw.split(/\s+[—–]\s+|;\s+|\.\s+/)[0]!.replace(/\s*\((?:[A-Z][a-z]+day )?\d{4}-\d{2}-\d{2}\)/g, "").replace(/\.$/, "").replace(/(\d{2}:\d{2})/g, (t) => ampm(toMin(t))).trim();
  return !why || /--|orion-|\brun again\b|\busage\b|\bhe\b|\bhis\b|\bORION\b/i.test(why) ? "" : ` (${why})`;
}
/** What else moved, from the scheduler's own lines, leaving out the block he named. */
const collateral = (stdout: string, title: string) => stdout.split("\n").map((l) => noteOf(l.trim())).filter((n): n is [string, string] => !!n && n[0].toLowerCase() !== title.toLowerCase()).map((n) => n[1]);

type Window = { start: number; end: number; note: string } | { refuse: string };
function windowOf(r: NamedWrite, now: number | null, base?: DayBlock): Window {
  const ctx = { day: r.day, now, ...(r.evening ? { part: "evening" as const } : {}) };
  let start = base ? toMin(base.start) : NaN; let note = "";
  if (r.from) {
    if (/^(?:now|right now|rn)$/.test(r.from)) { if (now === null) return { refuse: "I can't start something tomorrow \"now\"" }; start = ceil5(now); }
    else {
      const said = parseClock(r.from);
      const res = said ? resolveStart(said, ctx) : undefined;
      if (!res) return { refuse: `I couldn't read "${r.from}" as a time` };
      if ("passed" in res) {
        if (now === null || now - res.passed > LATE_START_GRACE) return { refuse: `${ampm(res.passed)} has already passed` };
        start = ceil5(now); note = start > res.passed ? ` (${ampm(res.passed)} had just passed, so it starts now)` : "";
      } else start = "at" in res ? res.at : (said!.h >= 7 && said!.h <= 11 ? res.ambiguous[0] : res.ambiguous[1]);
    }
  }
  if (!Number.isFinite(start)) return { refuse: "I couldn't tell when it starts" };
  if (now !== null && start < now) {
    // His block began before now: the start stays (it is under way); only a new start in the past is refused.
    if (!base || r.from) return { refuse: `${ampm(start)} has already passed` };
  }
  let end: number;
  if (r.until) {
    const said = parseClock(r.until);
    const res = said ? resolveEnd(said, start, ctx) : undefined;
    if (!res || !("at" in res)) return { refuse: res && "pastMidnight" in res ? "that runs past midnight" : `I couldn't tell when it ends` };
    end = res.at;
  } else if (r.minutes) end = start + r.minutes;
  else return { refuse: "I couldn't tell when it ends" };
  if (end > 1440) return { refuse: "that runs past midnight" };
  if (end - start < 5) return { refuse: `${ampm(end)} isn't after ${ampm(start)}` };
  if (now !== null && end <= now) return { refuse: `${ampm(end)} has already passed` };
  return { start, end, note };
}

/** Carries a named write out with one scheduler call; the reply says where the block is now, read back from the calendar. */
export async function runNamedWrite(r: NamedWrite, deps: CalDeps): Promise<CalOutcome> {
  const dateArgs = r.day === "tomorrow" ? ["--date", "tomorrow"] : [];
  const read = () => (r.day === "tomorrow" ? deps.readDayOn?.(dateArgs) ?? Promise.resolve(undefined) : deps.readDay());
  const day = await read().catch(() => undefined);
  if (!day) return { flow: say(READ_FAILED), facts: [], writes: 0 };
  const now = r.day === "today" ? deps.now.getHours() * 60 + deps.now.getMinutes() : null;
  const hit = resolveNamed(r.name, day, now ?? -1);
  const live = hit && !hit.over ? hit.block : undefined;
  const when = r.day === "tomorrow" ? "tomorrow" : r.evening ? "tonight" : "today";
  if (!live && r.op === "length" && !(r.from && r.until)) {
    return { flow: say(`There's no ${r.name} left on ${r.day === "tomorrow" ? "tomorrow's" : "today's"} calendar, so nothing changed. Tell me when it is and I'll put it in.`, [], [], "ask"), facts: [], writes: 0 };
  }
  if (live && isFixed(live) && !live.nameable) {
    return { flow: say(`${label(live)} is a class or a plan with people on your calendar, and I can't move or stretch that one from here. Nothing changed.`), facts: [], writes: 0 };
  }
  const w = windowOf(r, now, live);
  if ("refuse" in w) return { flow: say(`${cap(w.refuse)}, so I didn't change ${live ? label(live) : r.name}. Nothing changed.`), facts: [], writes: 0 };
  const x = executor(deps);
  // A new block is titled as he said it, a short qualifier in capitals ("cs lab" -> "CS lab").
  const title = live ? live.title : cap(r.name.split(" ").map((w) => (/^[a-z]{2}$/.test(w) && !SHORT_FILLER.has(w) ? w.toUpperCase() : w)).join(" "));
  const args = live
    ? toMin(live.start) === w.start ? ["extend", live.title, "--until", hhmm(w.end)] : ["move", live.title, "--to", hhmm(w.start), "--until", hhmm(w.end)]
    : ["add", title, String(w.end - w.start), "--at", hhmm(w.start), ...(hit?.over ? ["--again"] : [])];
  const out = await x.run([...args, ...dateArgs]);
  if (!out.ok) {
    const text = `I couldn't put ${label({ title } as DayBlock)} at ${span(w.start, w.end)}${reason(out.stdout)}.`;
    const flow: FlowResult = x.writes
      ? { outcome: "done", calls: x.calls, outputs: x.outputs, reply: `${text} The scheduler still changed other blocks: ${collateral(out.stdout, title).join("; ") || "see your calendar"}. ${UNDO}` }
      : say(`${text} Nothing changed.`, x.calls, x.outputs);
    return { flow, facts: [], writes: x.writes };
  }
  // What the calendar says now, not what was asked for.
  const after = await read().catch(() => undefined);
  const placed = resolveNamed(title, after, now ?? -1)?.block;
  const where = placed ? span(toMin(placed.start), toMin(placed.end)) : span(w.start, w.end);
  const moved = collateral(out.stdout, title);
  const verb = live ? (args[0] === "extend" ? "now runs" : "is now") : "is on";
  const text = `Done: ${label({ title } as DayBlock)} ${verb} ${where} ${when}${w.note}.${moved.length ? ` To make room: ${moved.join("; ")}.` : ""} ${UNDO}`;
  return { flow: { outcome: "done", calls: x.calls, outputs: x.outputs, reply: text }, facts: [], writes: x.writes };
}
