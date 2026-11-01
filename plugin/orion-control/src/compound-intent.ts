/*
 Two calendar changes in one sentence (Wave 6, gate run-1101003318: loop-voice-cutoff-c).

 "move gym to right after marketing and then put side project at eight" is fully specified, but the intent layer (calendar-intent.ts)
 reads one change per sentence and refused it, so the worker got it and asked "What time for Gym?". Here each clause is read on its own
 ("move X to T", "move X to right after Y", "put X at T", "put X after Y"), every clause must read or nothing does, and the lot is planned
 against the day as ONE `day --plan` call: each block at its new time with its own length, so a moved block replaces itself (never a
 second Gym) and one undo takes back both. A clause that is about a class or a plan with people, a time already gone, a clash with a
 fixed block, or a name not on the day is said plainly and nothing is written. Never a guess: a clause it cannot read refuses the lot.
*/
import { ampm, hhmm, parseClock, span, toMin, type DayWord } from "./intent-time.js";
import { blocksNamed } from "./day-replan.js";
import type { Day, DayBlock } from "./schedule-flow.js";

/** One clause: the block it names, and either the block it goes after or the clock he said. */
export type CompoundPart = { verb: "move" | "add"; name: string; after?: string; toSaid?: string; minutes?: number };
export type CompoundPlan = { kind: "run"; argv: string[]; title: string } | { kind: "say"; say: "cannot" | "plain"; text: string };

const VERB = String.raw`(?:move|push|shift|bump|put|add|schedule|book|slot)`;
/** "…marketing and then put…", "…marketing, then put…", "…marketing then move…": a joiner followed by a change verb. */
const SPLIT = new RegExp(String.raw`\s*,?\s*\b(?:and\s+then|and\s+also|and|then|also|plus)\s+(?=${VERB}\b)`, "i");
const AFTER = /^(?<verb>move|push|shift|bump|put|add|schedule|book|slot)\s+(?:my\s+|the\s+|a\s+)?(?<x>[a-z][a-z' &-]{0,40}?)\s+(?:to\s+)?(?:(?:right|straight|just|directly|immediately)\s+)?after\s+(?:my\s+|the\s+)?(?<y>[a-z0-9][a-z0-9' &-]{0,40}?)\s*$/i;
const AT = /^(?<verb>move|push|shift|bump|put|add|schedule|book|slot)\s+(?:(?:my|the|a|an)\s+)?(?:(?<len>\d{1,3})\s*(?:min|mins|minutes)\s+)?(?<x>[a-z][a-z' &-]{0,40}?)\s+(?:to|at|for)\s+(?<t>\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*$/i;

/** Each clause of a sentence with two or three changes, or undefined (one change, or a clause that does not read). `name` cleans a title. */
export function readCompound(text: string, name: (t: string) => string | undefined): CompoundPart[] | undefined {
  const clauses = text.replace(/[.!]+$/, "").split(SPLIT).map((c) => c.trim()).filter(Boolean);
  if (clauses.length < 2 || clauses.length > 3) return undefined;
  const parts: CompoundPart[] = [];
  for (const clause of clauses) {
    const a = clause.match(AFTER)?.groups;
    const t = a ? undefined : clause.match(AT)?.groups;
    const g = a ?? t;
    const x = g ? name(g.x!) : undefined;
    if (!g || !x) return undefined;
    const verb = /^(?:move|push|shift|bump)$/i.test(g.verb!) ? "move" : "add";
    if (a) { if (!a.y?.trim()) return undefined; parts.push({ verb, name: x, after: a.y.trim() }); continue; }
    if (!parseClock(t!.t!)) return undefined;
    parts.push({ verb, name: x, toSaid: t!.t!.trim(), ...(t!.len ? { minutes: Number(t!.len) } : {}) });
  }
  return new Set(parts.map((p) => p.name.toLowerCase())).size === parts.length ? parts : undefined;
}

const isFixed = (b: DayBlock): boolean => b.fixed || b.kind === "class";
const label = (b: DayBlock): string => b.title.replace(/\s+—.*$/, "");
const cap = (t: string): string => t.replace(/^./, (c) => c.toUpperCase());
const DEFAULT_MINUTES = 30;

type Placed = { title: string; start: number; minutes: number; self?: DayBlock };

/** A clock he said, on the block's own half of the day when it has one, else the first one still ahead of now. */
function clockFor(said: string, own: DayBlock | undefined, now: number | null): number | undefined {
  const c = parseClock(said);
  if (!c) return undefined;
  if (c.exact) return (c.ap ? (c.h % 12) * 60 + (c.ap === "p" ? 720 : 0) : c.h * 60) + c.m;
  const am = (c.h % 12) * 60 + c.m;
  const options = [am, am + 720].filter((m) => now === null || m > now);
  if (!options.length) return undefined;
  return own ? [...options].sort((x, y) => Math.abs(x - toMin(own.start)) - Math.abs(y - toMin(own.start)) || y - x)[0] : options[0];
}

/** The parts against the day: one `day --plan` argv for all of them, or the line that says why nothing changed. */
export function planCompound(parts: CompoundPart[], day: Day, which: DayWord): CompoundPlan {
  const now = day.now ? toMin(day.now) : null;
  const buffer = day.plan?.bufferMinutes ?? 5;
  const where = which === "tomorrow" ? " tomorrow" : "";
  const placed: Placed[] = [];
  for (const p of parts) {
    const own = blocksNamed(p.name, day).filter((b) => now === null || toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
    if (own && isFixed(own) && !own.nameable) return { kind: "say", say: "cannot", text: `${cap(label(own))} is a class or a plan with people, so it doesn't move. I haven't changed anything.` };
    if (!own && p.verb === "move") return { kind: "say", say: "cannot", text: `There's no ${p.name} on your day${where}, so I haven't changed anything.` };
    const anchorTitle = (() => {
      if (!p.after) return undefined;
      const earlier = placed.find((x) => blocksNamed(p.after!, { ...day, blocks: [{ title: x.title, start: "00:00", end: "00:00", fixed: false }] }).length > 0);
      if (earlier) return { end: earlier.start + earlier.minutes, title: earlier.title };
      const b = blocksNamed(p.after, day).filter((x) => x !== own).sort((a, c) => toMin(a.start) - toMin(c.start))[0];
      return b ? { end: toMin(b.end), title: label(b) } : null;
    })();
    if (anchorTitle === null) return { kind: "say", say: "cannot", text: `I can't find ${p.after} on your day${where}, so I haven't changed anything.` };
    const start = anchorTitle ? Math.ceil((anchorTitle.end + buffer) / 5) * 5 : clockFor(p.toSaid!, own, which === "today" ? now : null);
    if (start === undefined) return { kind: "say", say: "cannot", text: `${p.toSaid} has already passed today, so I haven't changed anything. Tell me a later time.` };
    const minutes = p.minutes ?? (own ? toMin(own.end) - toMin(own.start) : day.plan?.anchors.find((a) => blocksNamed(p.name, { ...day, blocks: [{ title: a.title, start: "00:00", end: "00:00", fixed: false }] }).length > 0)?.minutes ?? DEFAULT_MINUTES);
    const title = own?.title ?? p.name;
    if (now !== null && which === "today" && start < now) return { kind: "say", say: "cannot", text: `That would start ${title} at ${ampm(start)}, which has already passed, so I haven't changed anything.` };
    if (start + minutes > 1440) return { kind: "say", say: "cannot", text: `${cap(title)} would run past midnight from ${ampm(start)}, so I haven't changed anything.` };
    const clash = day.blocks.filter((b) => isFixed(b) && b !== own).find((b) => toMin(b.start) < start + minutes && toMin(b.end) > start);
    if (clash) return { kind: "say", say: "cannot", text: `${cap(label(clash))} is ${span(toMin(clash.start), toMin(clash.end))}${where}, so ${title} can't go at ${ampm(start)}. I haven't changed anything.` };
    const overlap = placed.find((x) => x.start < start + minutes && x.start + x.minutes > start);
    if (overlap) return { kind: "say", say: "cannot", text: `${cap(title)} at ${ampm(start)} would sit on ${overlap.title} at ${ampm(overlap.start)}, so I haven't changed anything. Tell me which should move.` };
    placed.push({ title, start, minutes, ...(own ? { self: own } : {}) });
  }
  const argv = ["day", ...placed.flatMap((x) => ["--plan", `${x.title.replace(/,/g, " ")}, ${x.minutes}, ${hhmm(x.start)}`])];
  return { kind: "run", argv, title: placed[0]!.title };
}
