/*
 The time backstop (live run 3, 2026-10-21: "block 2 hrs for econ homework tonight at 7" was written as `add "econ homework" 120`,
 no --at, and landed 1:20 PM). On EVERY write path (the intent layer, the form, a stored "go ahead?", the worker's restatement and the
 worker's own exec), a start time Nick said is checked against the start the write would use, after the same evening/AM-PM rules the
 intent layer uses (intent-time.ts). A write that would not start at a time he said is refused and he is asked; it never runs.
*/
import { PART } from "./calendar-intent.js";
import { ampm, CLOCK, parseClock, resolveStart, spokenTimesToDigits, toMin, type DayWord } from "./intent-time.js";

/** The commands whose start a stated time decides. Others (extend, late, resize, drop, log, undo …) are not checked. */
const STARTS = new Set(["add", "move", "day", "now"]);
const STARTED = new RegExp(String.raw`\b(?<lead>at|from|starting(?:\s+at)?|to)\s+(?<t>${CLOCK})(?![\w:])`, "gi");
const MOVE_VERB = /\b(?:move|push|shift|bump|reschedule|change)\b/i;

// A time that describes something else is not the item's start (review of 1c5e0ac): "my class ends at 5", "after my class at 3",
// "I'll be home at 6", "I'm at 5 percent". When it is unclear what a time belongs to, it is treated as not stated (never a refusal).
const OTHER_THING = /\b(?:ends?|ended|ending|finish(?:es|ed|ing)?|done|over|out|home|back|arriv\w*|gets?|got|land\w*|leav\w*|wake|woke|bed|sleep|class(?:es)?|lecture|lab|seminar|tutorial|meeting|appointment|shift|work|train|bus|flight|starts?|started|begins?|after|before|until|till|by|since|than|between)\b/i;
const SELF = /\b(?:i'?m|im|i am|we'?re|it'?s|its|i'?ll be|ill be|i will be|i was|he'?s|she'?s|they'?re)\s*$/i;
const AFTER_TIME = /^\s*(?:%|percent|pct|per ?cent|battery|degrees)/i;
const CLAUSE_END = /(?:[,.;!?]|\b(?:and|but|then|so|because|cause|cuz)\b)(?![\s\S]*(?:[,.;!?]|\b(?:and|but|then|so|because|cause|cuz)\b))/i;

/** Every start he says for the thing being written, as the minutes each could be: "tonight at 7" -> [[1140]], "at 9" tomorrow -> [[540, 1260]]. */
export function statedStarts(message: string, ctx: { day: DayWord; now: number | null }): number[][] {
  const text = spokenTimesToDigits(message);
  const move = MOVE_VERB.test(text);
  const part = PART(text);
  return [...text.matchAll(STARTED)]
    .filter((h) => {
      const lead = h.groups!.lead!.toLowerCase();
      // A move: "to" is where it goes, "from" is where it is now ("move gym from 7 to 8"). Anything else: "from" starts it, "to" ends it.
      if (move ? /^(?:from|starting)/.test(lead) : lead === "to") return false;
      const before = text.slice(0, h.index);
      const clause = before.slice((before.match(CLAUSE_END)?.index ?? -1) + 1);
      const tail = clause.trim().split(/\s+/).slice(-4).join(" ");
      const after = text.slice(h.index! + h[0].length);
      return !OTHER_THING.test(tail) && !SELF.test(clause) && !AFTER_TIME.test(after);
    })
    .flatMap((h) => {
      const said = parseClock(h.groups!.t!);
      if (!said) return [];
      // A time already past is still the time he said; whether it has passed is not this check's business.
      // A move's bare "to 8" is read against the block's own time by whoever writes it (intent-run.ts): either half of the day is his (live run 4:
      // before 5 AM "to 8" read as 8 AM refused the right 20:00).
      if (move && !said.exact && said.h !== 12) { const am = (said.h % 12) * 60 + said.m; return [[am, am + 720]]; }
      const r = resolveStart(said, { day: ctx.day, now: ctx.now, ...(part ? { part } : {}) });
      return "at" in r ? [[r.at]] : "ambiguous" in r ? [r.ambiguous] : [[r.passed]];
    });
}

/** The start a scheduler argv would write, per block: add --at, move --to, now --at, each day --plan's time. Empty: it picks the time itself. */
export function writtenStarts(argv: string[]): number[] {
  const opt = (name: string): number[] => { const i = argv.indexOf(name); return i >= 0 && /^\d{1,2}:\d{2}$/.test(argv[i + 1] ?? "") ? [toMin(argv[i + 1]!)] : []; };
  if (argv[0] === "add" || argv[0] === "now") return opt("--at");
  if (argv[0] === "move") return opt("--to");
  if (argv[0] === "day") return argv.flatMap((a, i) => (argv[i - 1] === "--plan" ? a.split(",").map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map(toMin) : []));
  return [];
}

/**
 * A lone add or move that simply left out the one start he said (the form wrote `add walk 45`, no --at, for "45 min walk today at 5pm"): the start
 * is put in, so a correct 17:00 write runs instead of being refused (live run 4). Anything else (a different time written, several writes,
 * an anchor, two times said, a time with two readings) returns undefined and the mismatch check decides.
 */
export function repairStart(message: string, argvs: string[][], ctx: { day: DayWord; now: number | null }): string[][] | undefined {
  const writes = argvs.filter((a) => STARTS.has(a[0] ?? ""));
  const stated = statedStarts(message, ctx);
  if (writes.length !== 1 || stated.length !== 1 || stated[0]!.length !== 1) return undefined;
  const w = writes[0]!;
  const flag = w[0] === "add" ? "--at" : w[0] === "move" ? "--to" : undefined;
  if (!flag || w.includes(flag) || w.includes("--after") || w.includes("--before") || w.includes("--until")) return undefined;
  // The time must sit in the item's own clause: "add stretching, call mom at 5" — the 5 is the call's, never stretching's (review of efc37af).
  const title = (w[1] ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
  const clauses = spokenTimesToDigits(message).split(/[,;.!?]|\b(?:and|then|but|also|plus)\b/i);
  const timed = clauses.filter((c) => new RegExp(String.raw`\b(?:at|from|starting|to)\s+${CLOCK}(?![\w:])`, "i").test(c));
  if (timed.length !== 1 || !title.some((t) => new RegExp(`\\b${t}`, "i").test(timed[0]!))) return undefined;
  const at = stated[0]![0]!;
  const fixed = [...w, flag, `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`];
  return argvs.map((a) => (a === w ? fixed : a));
}

/** What to say instead of running these writes, or undefined when every time he said is a start one of them uses. */
export function timeMismatch(message: string, argvs: string[][], ctx: { day: DayWord; now: number | null }): string | undefined {
  const writes = argvs.filter((a) => STARTS.has(a[0] ?? ""));
  if (!writes.length) return undefined;
  const stated = statedStarts(message, ctx);
  if (!stated.length) return undefined;
  const written = writes.flatMap(writtenStarts);
  const missing = stated.find((options) => !options.some((m) => written.includes(m)));
  if (!missing) return undefined;
  const title = writes[0]![0] === "day" ? (writes[0]![2] ?? "").split(",")[0]!.trim() : writes[0]![1] ?? "it";
  const said = missing.map(ampm).join(" or ");
  // Live run 5: "add stretching, call mom at 5" — the 5 is in another item's clause. Ask which it belongs to, plainly.
  const other = otherClauseItem(message, title);
  if (other) return `Want ${title} at ${other.time} too, or just the ${other.item}? What time for ${title}?`;
  const would = written.length ? `at ${written.map(ampm).join(", ")}` : "wherever there was room, not at that time";
  return `You said ${said}, but the change I worked out would have put ${title} ${would}, so I haven't changed anything. Say it again with the time, like "put ${title} at ${ampm(missing[missing.length - 1]!).replace(":00", "")}".`;
}

/** The other item a stated time belongs to ("call" in "add stretching, call mom at 5"), when the time sits in a clause without this title. */
function otherClauseItem(message: string, title: string): { item: string; time: string } | undefined {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const clauses = spokenTimesToDigits(message).split(/[,;.!?]|\b(?:and|then|but|also|plus)\b/i).map((c) => c.trim()).filter(Boolean);
  const timed = clauses.filter((c) => new RegExp(String.raw`\b(?:at|from)\s+${CLOCK}(?![\w:])`, "i").test(c));
  const mentions = (c: string) => words.some((w) => new RegExp(`\\b${w}`, "i").test(c));
  if (timed.length !== 1 || mentions(timed[0]!) || !clauses.some(mentions)) return undefined;
  const lead = timed[0]!.replace(new RegExp(String.raw`\b(?:at|from)\s+${CLOCK}[\s\S]*$`, "i"), "").replace(/^(?:(?:add|put|schedule|book|and|also|a|an|the|my)\s+)+/i, "").trim();
  const item = lead.split(/\s+/)[0]?.toLowerCase();
  const time = timed[0]!.match(new RegExp(String.raw`\b(?:at|from)\s+(${CLOCK})(?![\w:])`, "i"))?.[1]?.trim();
  return item && time ? { item, time } : undefined;
}

/** A shell command line's words, quotes kept together. */
export function commandArgs(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

// Every program that writes his calendar, wherever it sits in the command: bare, by path, inside `sh -c '…'` / `bash -lc "…"`, after `cd …;`.
const WRITER = /(?:^|[\s'"/;&|(`])(?<prog>orion-reschedule|orion-agenda-change|orion-plan-study)(?=[\s'";&|)`]|$)(?<rest>[^;&|\n`]*)/g;
/** Each calendar write a command line would run, as the scheduler argv the backstop reads (orion-agenda-change add is mapped to add --at). */
export function writesIn(command: string): string[][] {
  const flat = command.replace(/\\(["'])/g, "$1");
  return [...flat.matchAll(WRITER)].flatMap((m) => {
    const prog = m.groups!.prog!;
    // The quote that closes `bash -c '…'` is not part of the last word.
    const args = commandArgs(m.groups!.rest!.trim().replace(/['")]+$/, (q) => ((m.groups!.rest!.match(/['"]/g)?.length ?? 0) % 2 ? q.slice(1) : q))).map((a) => a.replace(/^['"]+|['"]+$/g, ""));
    if (prog === "orion-reschedule") return [args.filter((a) => a !== "")];
    if (prog === "orion-agenda-change") {
      const [cmd, title, start, minutes] = args;
      const at = /T(\d{2}:\d{2})$/.exec(start ?? "")?.[1];
      return cmd === "add" ? [["add", title ?? "", minutes ?? "60", ...(at ? ["--at", at] : [])]] : [];
    }
    // orion-plan-study picks its own slots: it never starts at a time he said.
    return args.includes("--book") ? [["add", args.filter((a) => a !== "--book").join(" "), "60"]] : [];
  });
}
