/*
 A note keeps Nick's whole text (w18 note, 2026-11-04).

 He said "make a note of" something long and only the first sentence was kept. Two causes, both in the model's hands:
 FACT_NOTE told the worker to save "the fact, short, in the third person" (so it summarised, and the 9B kept the lead
 sentence), and `orion-brain learn` cut whatever arrived at 400 characters. Saving his words is not a judgement call, so
 code does it: the command words ("make a note", "note that", "write down", "remember that") are stripped and nothing else
 is, then `orion-brain learn "Nick" "note" "<his text>"` runs once and the reply is built from its output: a short preview
 and the length, never a paraphrase. Line breaks stay (orion-brain stores them as " ⏎ "). "remember to ..." is a reminder,
 and a command with no content ("can you make a note for me?") falls through so ORION asks what to write.
*/
import { execFile } from "node:child_process";
import type { FlowResult } from "./schedule-flow.js";

export type NoteExec = (args: string[]) => Promise<{ stdout: string; code: number }>;
export const ORION_BRAIN = "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain";

const LEAD = String.raw`(?:(?:hey|ok(?:ay)?|so|also|and|btw|orion|please|pls|can you|could you|would you|will you|can u)[,\s]+)*`;
// "make a note", "take a quick note for me", "jot down a note", "add a note to self": the noun form.
const NOUN = String.raw`(?:make|take|add|create|jot(?:\s+down)?|write(?:\s+down)?|put|save|keep|drop)\s+(?:me\s+)?(?:an?\s+|another\s+|this\s+)?(?:(?:quick|little|new|short|long)\s+)?note(?:\s+for\s+me)?(?:\s+to\s+self)?(?:\s+down)?(?:\s+(?:really\s+|just\s+)?quick(?:ly)?)?`;
// "note that", "remember that", "write this down", "keep in mind": the verb form. "remember to" is a reminder.
const VERB = String.raw`(?:remember(?!\s+to\b)|note(?:\s+to\s+self)?|jot\s+down|write\s+(?:this\s+|that\s+|it\s+)?down|keep\s+in\s+mind|save\s+(?:that|this))`;
const COMMAND = new RegExp(String.raw`^${LEAD}(?:${NOUN}|${VERB})(?![\w'-])`, "i");

/** His words with only the command removed, or null when there is no command or nothing after it. */
export function parseNote(message: string): { text: string } | null {
  const trimmed = message.trim();
  const head = COMMAND.exec(trimmed);
  if (!head) return null;
  const text = trimmed.slice(head[0].length)
    .replace(/^\s*[:,\-–—]\s*/, "")
    .replace(/^\s*(?:that|of)\b[:,]?\s*/i, "")
    .replace(/^\s*this\s*[:,]\s*/i, "")
    .trim();
  return /[a-z0-9]{2}/i.test(text) ? { text } : null;
}

// Periods that do not end a sentence: titles, "p.m.", "e.g.". A decimal ("3.30") has no space after, so it never splits.
const ABBREVIATION = /\b(?:dr|mr|mrs|ms|prof|st|vs|no|approx)\.|\b(?:[ap]\.m|e\.g|i\.e)\./gi;

/** Sentences in his text: ". ! ?" runs and line breaks end one; a run-on with no punctuation is one. */
export function countSentences(text: string): number {
  const guarded = text.replace(ABBREVIATION, (m) => m.replace(/\./g, "\u0000"));
  return guarded.split(/[.!?]+(?=\s|$)|\n+/).filter((part) => /[a-z0-9]/i.test(part)).length;
}

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "4 sentences", or the word count for one long run-on (voice transcripts have no punctuation). */
export function lengthOf(text: string): string {
  const sentences = countSentences(text);
  return sentences <= 1 && words(text) >= 15 ? plural(words(text), "word") : plural(Math.max(sentences, 1), "sentence");
}

const preview = (text: string): string => {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}…` : flat;
};

/** One note, end to end; the reply is built only from orion-brain's output. */
export async function runNote({ message, exec }: { message: string; exec: NoteExec }): Promise<FlowResult> {
  const note = parseNote(message);
  if (!note) return { outcome: "fallback", reason: "not a note with content" };
  const args = ["learn", "Nick", "note", note.text];
  const calls = ["exec orion-brain learn \"Nick\" \"note\" <his full text>"];
  const result = await exec(args);
  const out = result.stdout.trim();
  if (result.code === 0 && /^(?:Added to|New note)/.test(out)) {
    return { outcome: "done", calls, outputs: [out], reply: `Saved the note (${lengthOf(note.text)}): "${preview(note.text)}"` };
  }
  const tooLong = /too long/i.test(out);
  return { outcome: "say", kind: "plain", calls, outputs: [out], text: tooLong
    ? "That note is longer than I can keep in one piece — nothing was saved. Split it in two and I'll save both."
    : "I couldn't save that note — nothing was saved. Say it again?" };
}

const runFile = (file: string, args: string[], timeout: number): Promise<{ stdout: string; code: number }> =>
  new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout),
    code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
  })));

/** The real flow: scripts/orion-brain learn. Wired in by index.ts only. */
export const liveNoteFlow = (message: string): Promise<FlowResult> =>
  runNote({ message, exec: (args) => runFile(ORION_BRAIN, args, 30000) });
