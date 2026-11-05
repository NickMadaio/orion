/*
 The clauses of one message, for the code-run peelers (w20 round 6 review). "open the mouse mapper and whats the weather tomorrow then set a 10 min timer
 and remind me at 5 to eat" is four asks. Each peeler (timer, reminder, open, mouse) takes its own clause out of the message, runs it, and the next one
 looks at what is left, until nothing code can run is left; the remainder goes on to the normal routes.

 A piece after "and" / "," / "then" / a full stop is a new clause only when it starts an ask of its own (a request verb, a timer, a reminder, a question).
 Anything else belongs to the clause before it ("a 10 min timer for mac and cheese"). A reminder's own words are the exception that matters: everything after
 "remind me ... to" is the reminder's text, so "remind me at 5 to ring the vet and cancel the old appointment" is ONE clause. Only a sentence break, "also" or
 "then" before a new request, or a question, ends it. When in doubt the words stay in the reminder.
*/
import { timerSeconds } from "./tool-moves.js";

export type Clause = { text: string; start: number; end: number; sep: string };

export const REMINDER_START = /^(?:(?:and|also|then|please|pls)\s+)*(?:remind me|ping me|nudge me|set (?:me )?a reminder|buzz me|give me a (?:ping|nudge|reminder))\b/i;
const REQUEST = /^(?:(?:and|also|then|please|pls)\s+)*(?:move|add|put|schedule|book|push|cancel|delete|remove|text|send|play|turn|log|call|make|take|drop|skip|plan|shift|open|set|start|run|show|tell|check|read|find|search|ring|email|mail)\b|^(?:a|an)\s+\d|^\d/i;
const QUESTION = /^(?:(?:and|also|then)\s+)*(?:whats|what's|what is|what are|how's|hows|how is|how are|how much|how long|when is|when's|whens|where is|tell me|show me|is it|will it|do i|am i|any )/i;
const SEP = /(\s*[.!?]+\s+(?:(?:and|also|then)\s+)?|\s*[,;]\s*(?:(?:and|then|also)\s+)?|\s+(?:and then|and also|after that|and|then|also|plus)\s+)/gi;

const startsAsk = (piece: string): boolean => REQUEST.test(piece) || REMINDER_START.test(piece) || QUESTION.test(piece) || timerSeconds(piece) !== undefined;
/** The break that may end a reminder's text: a sentence break, "also" or "then" (a plain "and" or comma never does). */
const HARD = /[.!?]|\b(?:also|then|after that)\b/i;

export function clausesOf(message: string): Clause[] {
  const text = message.trim();
  const out: Clause[] = [];
  let at = 0; let sep = "";
  const parts: Array<{ piece: string; start: number; sep: string }> = [];
  for (const m of text.matchAll(SEP)) {
    parts.push({ piece: text.slice(at, m.index), start: at, sep });
    at = (m.index ?? 0) + m[0].length; sep = m[0];
  }
  parts.push({ piece: text.slice(at), start: at, sep });
  for (const p of parts) {
    const piece = p.piece.trim();
    if (!piece) continue;
    const prev = out[out.length - 1];
    const inReminder = !!prev && REMINDER_START.test(prev.text) && !HARD.test(p.sep) && !QUESTION.test(piece);
    if (prev && (!startsAsk(piece) || inReminder)) { out[out.length - 1] = { ...prev, text: text.slice(prev.start, p.start + p.piece.length).trim(), end: p.start + p.piece.length }; continue; }
    out.push({ text: piece, start: p.start, end: p.start + p.piece.length, sep: p.sep });
  }
  return out;
}

/** The message without clause `i` (and the separator that joined it); undefined when nothing else would be left. */
export function withoutClause(message: string, clauses: readonly Clause[], i: number): string | undefined {
  if (clauses.length < 2) return undefined;
  const text = message.trim();
  const c = clauses[i]!;
  const rest = i === 0 ? text.slice(clauses[1]!.start) : `${text.slice(0, clauses[i - 1]!.end)}${text.slice(c.end)}`;
  const cleaned = rest.trim();
  return cleaned || undefined;
}

/** The first clause that `is` picks, with the message left once it is taken out; undefined when there is none or it is the whole message. */
export function takeClause(message: string, is: (clause: string) => boolean): { clause: string; rest: string } | undefined {
  const cs = clausesOf(message);
  const i = cs.findIndex((c) => is(c.text));
  if (i < 0) return undefined;
  const rest = withoutClause(message, cs, i);
  return rest ? { clause: cs[i]!.text, rest } : undefined;
}
