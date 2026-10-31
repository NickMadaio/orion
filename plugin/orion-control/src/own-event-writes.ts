/*
 Gate run-1031224700, wave 5 "writes": what the calendar form gets wrong about HIS events and lost time, read from his words.

   sch-move-fixed-named   "marketing is moved to 2pm today thx" / "move my MKTG2201 class today from 1:30 to 2pm, its running late"
                          A class or plan with people never moves on its own, but when he names it and says the new time, it moves
                          (orion-reschedule move rewrites that one occurrence). The form's move was refused outright ("is a class …
                          it does not move"), and the second phrasing was read as a 30-minute overrun that moved nothing.
   rea-class-late-c       "marketing is running 30 min over, shift my stuff after it by 30": he asked for the push itself, so the
                          scheduler's overrun gets --shift (every movable block after the class moves by exactly that much).

 Pure; schedule-flow.ts (compile) and reality.ts (overrun) call these.
*/
import type { DayBlock } from "./schedule-flow.js";

const norm = (t: string): string => t.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9':]+/g, " ").trim();
const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const FILLER = new Set(["the", "my", "class", "lecture", "lab", "seminar", "tutorial", "and", "for", "intro", "introduction", "principles"]);

/** "mktg" in "marketing", "econ" in "economics": a course code's letters, in order, inside one word he said that starts the same. */
function codeIn(code: string, word: string): boolean {
  if (code.length < 3 || word.length < 5 || word[0] !== code[0]) return false;
  let i = 0;
  for (const ch of word) if (ch === code[i]) i += 1;
  return i === code.length;
}

/** His words name this event: a word of its title, its course code (or the code's letters: "marketing" for MKTG2201). */
export function namesOwnEvent(message: string, block: DayBlock): boolean {
  const said = norm(message).split(" ").filter((w) => w.length >= 3);
  const titleWords = norm(block.title).split(" ").filter((w) => w.length >= 3 && !FILLER.has(w));
  const codes = titleWords.map((w) => /^([a-z]{2,5})\d{3,5}$/.exec(w)?.[1]).filter((c): c is string => !!c);
  return said.some((w) => titleWords.some((t) => t === w || (w.length >= 4 && t.startsWith(w)) || (t.length >= 4 && w.startsWith(t)))
    || codes.some((c) => w === c || codeIn(c, w)));
}

/**
 * He is moving THIS event: he names it, names no other block of the day ("move gym to 4 after marketing" moves the gym, never the
 * class), and gives its new time.
 */
export function movesThisOne(message: string, block: DayBlock, others: readonly DayBlock[] = []): boolean {
  return namesOwnEvent(message, block) && !others.some((b) => b !== block && b.title !== block.title && namesOwnEvent(message, b)) && newStartFor(message, block) !== undefined;
}

const MOVE_VERB = String.raw`(?:mov(?:e|ed|ing)|push(?:ed|ing)?|shift(?:ed|ing)?|chang(?:e|ed|ing)|resched\w*|bump(?:ed|ing)?|switch(?:ed|ing)?)`;
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
// "moved to 2pm", "move … from 1:30 to 2pm", "pushed discrete to 4": the time after "to" in a move.
const MOVED_TO = new RegExp(String.raw`\b${MOVE_VERB}\b[^.?!]*?\bto\s+${CLOCK}(?![\d:])(?!\s*(?:min|mins|minutes|hours?|hrs?)\b)`, "i");
// "cs2100 is at 11 instead today", "marketing's at 2 now".
const NOW_AT = new RegExp(String.raw`(?:\bis|'s)\s+(?:now\s+)?at\s+${CLOCK}\s+(?:instead|now|today\s+instead)\b`, "i");

/** The new start he gave for that event ("HH:MM"), the hour read as the one nearer the event's own start; else undefined. */
export function newStartFor(message: string, block: DayBlock): string | undefined {
  const m = MOVED_TO.exec(message) ?? NOW_AT.exec(message);
  if (!m) return undefined;
  const h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return undefined;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap) return hhmm((h % 12) * 60 + (ap === "pm" ? 720 : 0) + min);
  if (h >= 13) return hhmm(h * 60 + min);
  const was = toMin(block.start);
  const options = [(h % 12) * 60 + min, (h % 12) * 60 + 720 + min];
  return hhmm(options.reduce((a, b) => (Math.abs(b - was) < Math.abs(a - was) ? b : a)));
}

// "shift my stuff after it by 30", "push everything after back 20", "bump the rest of my day by 15". Not "don't push anything".
const SHIFT_ASK = /\b(?:push|shift|move|bump|slide|delay)\b[^.?!]{0,30}?\b(?:everything|my stuff|stuff|the rest|rest of (?:my|the) day|what(?:'s| is| comes)? after|things after|blocks|it all|all of it|my day|my plans|whatever'?s after)\b/i;
const NEGATED = /\b(?:don'?t|do not|dont|no need to|without)\s+(?:\w+\s+){0,2}(?:push|shift|move|bump|slide|delay)\b/i;
export const asksToShiftAfter = (message: string): boolean => SHIFT_ASK.test(message) && !NEGATED.test(message);

/**
 * The scheduler's "Nothing needed to move: Gym 17:00 still fits after …" (an overrun or late the day's slack absorbed): what still
 * fits, `null` when nothing of his comes after, undefined when the run said something else.
 */
export function nothingToMove(stdout: string): { title: string; at: string } | null | undefined {
  const line = stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("Nothing needed to move:"));
  if (!line) return undefined;
  const m = /^Nothing needed to move: (.+?) (\d{2}:\d{2}) still fits after /.exec(line);
  return m ? { title: m[1]!, at: m[2]! } : null;
}

/**
 * The form read a named event's new time as an overrun ("move my MKTG2201 class from 1:30 to 2pm, its running late"): when he
 * names it and gives the new start, it is a move. Undefined when his words do not say that.
 */
export function overrunIsMove(message: string, block: DayBlock, others: readonly DayBlock[] = []): string[] | undefined {
  if (!block.fixed || !movesThisOne(message, block, others)) return undefined;
  const to = newStartFor(message, block);
  return to && to !== block.start ? ["move", block.title, "--to", to] : undefined;
}
