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
export const ORION_BRAIN = "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain";
const LEAD = String.raw `(?:(?:hey|ok(?:ay)?|so|also|and|btw|orion|please|pls|can you|could you|would you|will you|can u)[,\s]+)*`;
// "make a note", "take a quick note for me", "jot down a note", "add a note to self": the noun form.
const NOUN = String.raw `(?:make|take|add|create|jot(?:\s+down)?|write(?:\s+down)?|put|save|keep|drop)\s+(?:me\s+)?(?:an?\s+|another\s+|this\s+)?(?:(?:quick|little|new|short|long)\s+)?note(?:\s+for\s+me)?(?:\s+to\s+self)?(?:\s+down)?(?:\s+(?:really\s+|real\s+|just\s+)?quick(?:ly)?)?`;
// "note that", "remember that", "write this down", "keep in mind": the verb form. "remember to" is a reminder.
const VERB = String.raw `(?:remember(?!\s+to\b)|note(?:\s+to\s+self)?|jot\s+down|write\s+(?:this\s+|that\s+|it\s+)?down|keep\s+in\s+mind|save\s+(?:that|this))`;
const COMMAND = new RegExp(String.raw `^${LEAD}(?:${NOUN}|${VERB})(?![\w'-])`, "i");
/** His words with only the command removed, or null when there is no command or nothing after it. */
export function parseNote(message) {
    const trimmed = message.trim();
    const head = COMMAND.exec(trimmed);
    if (!head)
        return null;
    const text = trimmed.slice(head[0].length)
        .replace(/^\s*[:,\-–—]\s*/, "")
        .replace(/^\s*(?:that|of)\b[:,]?\s*/i, "")
        .replace(/^\s*this\s*[:,]\s*/i, "")
        .trim();
    return /[a-z0-9]{2}/i.test(text) ? { text } : null;
}
// "make a note", "can you write something down", "take a note real quick": the request with nothing to write yet.
const SOMETHING = String.raw `(?:write|jot|put)\s+(?:something|this|that|it|a\s+thing)\s+down`;
const BARE_HEAD = new RegExp(String.raw `^${LEAD}(?:${NOUN}|${SOMETHING})(?![\w'-])`, "i");
const FILLER_TAIL = /^(?:[\s?!.,]|for me|please|pls|thanks?|thank you|(?:really\s+|real\s+)?quick(?:ly)?|now|for a (?:sec|second|minute))*$/i;
export const NOTE_ASK = "Go ahead — what's the note?";
/** How long the next message is read as the note after a bare request. */
export const NOTE_WINDOW_MS = 10 * 60_000;
export function isBareNoteRequest(message) {
    const m = message.trim();
    const head = BARE_HEAD.exec(m);
    return !!head && FILLER_TAIL.test(m.slice(head[0].length));
}
// While a note is awaited, anything that is not the note yields: a bare answer ("no", "thanks", "yes"), a question, a request to ORION,
// or a schedule / to-do word anywhere in it (review, w18 note-fix): "actually class moved to 3pm, can you shift my study block?" is a
// request however long it is, and must never be filed as the note. Plain statements ("i'm so tired") stay notes.
const BARE_ANSWER = /^(?:(?:no|nope|nah|actually|oh|ok(?:ay)?|well|um+)[,\s]+)*(?:no|nope|nah|nvm|never\s?mind|cancel|cancel that|forget it|scratch that|stop|thanks?|thank you|thx|yes|yeah|yep|yup|ok(?:ay)?|sure|fine)$/i;
const ASKS_ORION = /\b(?:can|could|would|will) (?:you|u)\b|\bplease\s+[a-z]+|\bremind me\b/i;
const SCHEDULE_WORD = /\b(?:reschedule|schedule|shift|push|move|postpone|cancel|swap|extend|undo|skip|delete|remove)\b|\badd\b[^.]*\b(?:to-?dos?|calendar|list|schedule|reminders?)\b|\b(?:put|block)\b[^.]*\b(?:calendar|to-?dos?|schedule)\b/i;
const WH_QUESTION = /^(?:(?:hey|ok(?:ay)?|so|orion)[,\s]+)*(?:what|whats|what's|when|where|who|how|why)\b/i;
export const isOtherCommand = (message) => {
    const m = message.trim();
    const bare = m.replace(/[.!?…\s]+$/, "");
    return BARE_ANSWER.test(bare) || /\?\s*$/.test(m) || ASKS_ORION.test(m) || SCHEDULE_WORD.test(m) || (WH_QUESTION.test(m) && m.split(/\s+/).length <= 16);
};
// A note that looks like a password, token or card number is refused, never filed in the brain (same shapes as orion-note).
const SECRET_SHAPES = [/sk-[A-Za-z0-9_-]{16,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\./];
const SECRET_KEY = /\b(?:password|passcode|passwd|pwd|token|api[ -]?key|secret|pin)\b[^.\n]{0,20}?(?:\bis\b|\bwas\b|[:=])\s*["']?([^\s"']+)/gi;
const valueLooksSecret = (v) => v.length >= 4 && (/\d/.test(v) || /[^\w]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
const luhn = (digits) => {
    let sum = 0;
    [...digits].reverse().forEach((d, i) => { let n = Number(d); if (i % 2) {
        n *= 2;
        if (n > 9)
            n -= 9;
    } sum += n; });
    return sum % 10 === 0;
};
export function looksSecret(text) {
    if (SECRET_SHAPES.some((shape) => shape.test(text)))
        return true;
    if ([...text.matchAll(SECRET_KEY)].some((m) => valueLooksSecret((m[1] ?? "").replace(/[.,;!?]+$/, ""))))
        return true;
    return [...text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)].some((m) => luhn(m[0].replace(/\D/g, "")));
}
export const SECRET_REPLY = "That looks like a password — I didn't save it.";
// Periods that do not end a sentence: titles, "p.m.", "e.g.". A decimal ("3.30") has no space after, so it never splits.
const ABBREVIATION = /\b(?:dr|mr|mrs|ms|prof|st|vs|no|approx)\.|\b(?:[ap]\.m|e\.g|i\.e)\./gi;
/** Sentences in his text: ". ! ?" runs and line breaks end one; a run-on with no punctuation is one. */
export function countSentences(text) {
    const guarded = text.replace(ABBREVIATION, (m) => m.replace(/\./g, "\u0000"));
    return guarded.split(/[.!?]+(?=\s|$)|\n+/).filter((part) => /[a-z0-9]/i.test(part)).length;
}
const words = (text) => text.split(/\s+/).filter(Boolean).length;
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** "4 sentences", or the word count for one long run-on (voice transcripts have no punctuation). */
export function lengthOf(text) {
    const sentences = countSentences(text);
    return sentences <= 1 && words(text) >= 15 ? plural(words(text), "word") : plural(Math.max(sentences, 1), "sentence");
}
const preview = (text) => {
    const flat = text.replace(/\s+/g, " ");
    return flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}…` : flat;
};
/** One note, end to end; the reply is built only from orion-brain's output. */
export async function runNote({ message, exec, bound }) {
    // bound: he was asked "what's the note?", so this whole message is the note (command words, if he repeated them, still stripped).
    const note = bound ? { text: parseNote(message)?.text ?? message.trim() } : parseNote(message);
    if (bound && !/[a-z0-9]/i.test(note?.text ?? ""))
        return { outcome: "fallback", reason: "empty note" };
    if (!note)
        return { outcome: "fallback", reason: "not a note with content" };
    if (looksSecret(note.text))
        return { outcome: "say", kind: "plain", text: SECRET_REPLY };
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
const runFile = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout),
    code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
})));
/** The real flow: scripts/orion-brain learn. Wired in by index.ts only. */
export const liveNoteFlow = (message, bound) => runNote({ message, ...(bound ? { bound } : {}), exec: (args) => runFile(ORION_BRAIN, args, 30000) });
