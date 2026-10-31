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
import { blocksNamedBy, intentOf, isClassBlock } from "./block-names.js";

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

const MOVE_VERB = String.raw`(?:mov(?:e|ed|ing)|push(?:ed|ing)?|shift(?:ed|ing)?|chang(?:e|ed|ing)|resched\w*|bump(?:ed|ing)?|switch(?:ed|ing)?)`;
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const NOT_LENGTH = String.raw`(?![\d:])(?!\s*(?:min|mins|minutes|hours?|hrs?)\b)`;

/*
 REV5 MUST 2 (2026-10-31): "named" used to mean any word of the title anywhere in the message, and the first "to <clock>" anywhere:
 "push workout to 6 and dinner after" moved the dinner, "i was making dinner, moved my reading to 6" moved the dinner, "marketing hw
 moved to 4pm" moved the class. Now the block must be the OBJECT of the move: the words between the verb and its "to <clock>"
 ("move marketing to 2pm"), or, when the verb has none, the subject just before it ("marketing got moved to 2", "marketing's at 2
 instead"), matched with blocksNamedBy (block-names.ts), the one name matcher. Homework/study words on it mean the study, not the class.
*/
const MOVE_AT = new RegExp(String.raw`\b${MOVE_VERB}\b([^.?!,;]*?)\bto\s+${CLOCK}${NOT_LENGTH}`, "gi");
const AT_INSTEAD = new RegExp(String.raw`(?:\bis|'s)\s+(?:now\s+)?at\s+${CLOCK}\s+(?:instead|now|today\s+instead)\b`, "gi");
const AUX = new Set(["is", "was", "got", "gets", "has", "have", "been", "being", "be", "getting", "just", "also", "now", "s"]);
const PARTICLE = new Set(["back", "forward", "up", "ahead", "over", "around", "round", "later", "earlier"]);
type Clock = readonly [hour: string | undefined, minutes: string | undefined, ampm: string | undefined];
type Move = { object: string; clause: string; clock: Clock };
/** His words with their punctuation kept (clauses split on it); block-names normalises the names itself. */
const lower = (t: string): string => t.toLowerCase().replace(/[’`]/g, "'");

/** The clause a match sits in: the text since the last , ; . ! ? before it, to the next one after it. */
function clauseAround(text: string, from: number, to: number): string {
  const start = Math.max(...[",", ";", ".", "!", "?"].map((c) => text.lastIndexOf(c, from - 1))) + 1;
  const ends = [",", ";", ".", "!", "?"].map((c) => text.indexOf(c, to)).filter((i) => i >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}
/** Every move he says: its object (or subject, for "X got moved to 2"), the clause, and the clock it goes to. */
function movesIn(message: string): Move[] {
  const text = lower(message);
  const out: Move[] = [];
  for (const m of text.matchAll(MOVE_AT)) {
    const clause = clauseAround(text, m.index, m.index + m[0].length);
    const object = m[1]!.split(/\bfrom\b/)[0]!.split(" ").filter((w) => w && !PARTICLE.has(w)).join(" ");
    const before = text.slice(0, m.index).split(/[,;.!?]/).at(-1)!;
    out.push({ object: object || subjectOf(before), clause, clock: [m[2], m[3], m[4]] });
  }
  for (const m of text.matchAll(AT_INSTEAD)) {
    const before = text.slice(0, m.index).split(/[,;.!?]/).at(-1)!;
    out.push({ object: subjectOf(before), clause: clauseAround(text, m.index, m.index + m[0].length), clock: [m[1], m[2], m[3]] });
  }
  return out;
}
/** The subject words just before a passive verb, without the auxiliaries ("marketing got" → "marketing"). */
function subjectOf(before: string): string {
  const words = before.trim().split(" ").filter(Boolean);
  while (words.length && AUX.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}
/** The block this phrase names, and only blocks by its title: the longest tail of the phrase that names anything decides. */
function phraseNames(phrase: string, block: DayBlock, day: readonly DayBlock[]): boolean {
  const words = phrase.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const tail = words.slice(i).join(" ");
    const found = blocksNamedBy(tail, day);
    if (found.length) return intentOf(tail) !== "study" && found.every((b) => b.title === block.title);
  }
  return false;
}
/** The move he says for THIS block, if any: it is the object of a move verb with a new time, and no study word sits on a class. */
function moveOf(message: string, block: DayBlock, others: readonly DayBlock[]): Move | undefined {
  const day = others.includes(block) ? others : [...others, block];
  return movesIn(message).find((m) => m.object && phraseNames(m.object, block, day) && !(isClassBlock(block) && intentOf(m.clause) === "study"));
}

/**
 * He is moving THIS event: it is the object of his move verb ("move marketing to 2pm", "push my dinner with sam to 8", "marketing
 * got moved to 2"), that phrase names no other block of the day, and it has a new time. A block he only mentions elsewhere in the
 * message ("push workout to 6 and dinner after", "move gym to 4 after marketing") is never moved.
 */
export function movesThisOne(message: string, block: DayBlock, others: readonly DayBlock[] = []): boolean {
  const move = moveOf(message, block, others);
  return !!move && clockFor(move.clock, block) !== undefined;
}
// "moved to 2pm", "move … from 1:30 to 2pm", "pushed discrete to 4": the time after "to" in a move.
const MOVED_TO = new RegExp(String.raw`\b${MOVE_VERB}\b[^.?!]*?\bto\s+${CLOCK}(?![\d:])(?!\s*(?:min|mins|minutes|hours?|hrs?)\b)`, "i");
// "cs2100 is at 11 instead today", "marketing's at 2 now".
const NOW_AT = new RegExp(String.raw`(?:\bis|'s)\s+(?:now\s+)?at\s+${CLOCK}\s+(?:instead|now|today\s+instead)\b`, "i");

/** The new start he gave for that event ("HH:MM"), the hour read as the one nearer the event's own start; else undefined. */
export function newStartFor(message: string, block: DayBlock): string | undefined {
  const m = MOVED_TO.exec(message) ?? NOW_AT.exec(message);
  return m ? clockFor([m[1], m[2], m[3]], block) : undefined;
}
/** A clock he said (hour, minutes, am/pm) as "HH:MM", the hour read as the one nearer the event's own start. */
function clockFor([hour, minutes, ampm]: Clock, block: DayBlock): string | undefined {
  const h = Number(hour); const min = Number(minutes ?? 0);
  if (!Number.isFinite(h) || h > 23 || min > 59) return undefined;
  const ap = ampm?.toLowerCase().replace(/\./g, "");
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
  const move = block.fixed ? moveOf(message, block, others) : undefined;
  const to = move ? clockFor(move.clock, block) : undefined;
  return to && to !== block.start ? ["move", block.title, "--to", to, "--named"] : undefined;
}
