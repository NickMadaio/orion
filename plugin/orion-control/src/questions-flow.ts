/*
 ORION's questions for Nick, in chat (wave 12 L1, 2026-11-02): "for things he's unclear of he can make his own notes to ask me about
 things". Code's, before the front desk and every other flow:

   list     "what do you wanna ask me" / "any questions for me": the top open question (marked asked in chat, so his next message
            answers it) and up to two more.
   drop     "forget that question" / "dont ask me that again": drops the question on the table (or the one his words name).
   answer   his reply to a question ORION asked (a push in the last 3 h that is still the last thing sent, or one listed in chat in
            the last 30 min): orion-questions answer, which keeps it in his Nick note as a dated #answer line (his words: ORION may not edit it).
   skip     "idk" / "ask me later" to that question: open again, asked another day.

 Every write goes through scripts/orion-questions (fixed argument lists, no shell); every reply is built from what it said.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
import { awaitingRow, openRows, questionsFile, readQuestionRows, type QuestionRow } from "./questions-store.js";

export type QuestionsRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type QuestionsMove =
  | { kind: "list"; open: QuestionRow[] }
  | { kind: "drop"; id?: string; q?: string }
  | { kind: "answer"; id: string; q: string; text: string }
  | { kind: "skip"; id: string; q: string };
export type QuestionsOut = { text: string; calls: string[]; outputs: string[] };

const LIST = [
  /\b(?:what|wat|wht|wut)(?:\s+(?:do|did|would|else))?\s+(?:you|u|ya|yu)\s+(?:wanna|want to|wanted to|need to|got to)\s+ask\s+me\b/,
  /\bany(?:thing)?\s+(?:q'?s|qs|questions?)?\s*(?:you\s+|u\s+)?(?:wanna\s+ask\s+me|(?:for|4)\s+me)\b/,
  /\b(?:got|have|u have|you have|do you have|do u have|u got)\s+(?:any\s+)?(?:q'?s|qs|questions?)\s+(?:for|4)\s+me\b/,
  /\bwhat\s+(?:q'?s|qs|questions?)\s+(?:do\s+)?(?:you|u)\s+(?:have|got)\b/,
  /\bask\s+me\s+(?:your|ur)\s+(?:q'?s|qs|questions?)\b/,
];
const DROP = [
  /\b(?:forget|drop|scrap|delete|remove|ditch|cancel|never ?mind|nvm)\s+(?:that|this|the|ur|your)\s+(?:last\s+)?(?:question|q)\b(?:\s+(?:about|on|re)\s+(.{2,60}))?/,
  /\b(?:dont|don'?t|do not|stop)\s+ask(?:ing)?\s+(?:me\s+)?(?:that|this)(?:\s+(?:one|question|q))?\b/,
];
const SKIP = /^(?:idk|i\s*d(?:on'?t|ont)\s*know|dunno|no idea|not sure|unsure|pass|skip|next|not now|later|ask me later|ask (?:me )?(?:another|some other) time|another time|maybe later)\b/;
// A request or a question of his own is not an answer to ORION's question (pending-reply-read.ts REQUEST, plus "what/when/…?").
const REQUEST = /\b(?:move|add|put|book|schedule|reschedule|cancel|remind|text|email|play|clear|delete|remove|log|push)\b|\b(?:can|could|would|will) (?:you|u)\b|\bset (?:an?|my|the)\b|\bstart (?:a|an|my|the) (?:focus|session|timer)\b|\bturn (?:on|off)\b/;
const OWN_QUESTION = /^(?:what|whats|what's|when|where|who|whos|how|why|is|are|do|does|did|can|could|should|will)\b[^?]*\?\s*$/;

const low = (s: string): string => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
export const asksForQuestions = (message: string): boolean => LIST.some((p) => p.test(low(message)));
export const dropsQuestion = (message: string): { about?: string } | undefined => {
  const m = low(message);
  for (const p of DROP) { const hit = m.match(p); if (hit) return hit[1] ? { about: hit[1].replace(/\b(?:pls|please|lol|thx|its|it's)\b.*$/, "").trim() } : {}; }
  return undefined;
};

const WORD = /[a-z0-9]{3,}/g;
const STOP = new Set(["the", "and", "you", "your", "about", "that", "this", "what", "who", "does", "his", "him", "nick"]);
const wordsOf = (s: string): string[] => (low(s).match(WORD) ?? []).filter((w) => !STOP.has(w));
const namedBy = (rows: QuestionRow[], about: string): QuestionRow | undefined => {
  const want = wordsOf(about);
  return want.length ? rows.find((r) => want.every((w) => wordsOf(r.q).some((x) => x.startsWith(w) || w.startsWith(x)))) : undefined;
};

export type QuestionsCtx = { stateDir: string; now: Date; label?: string; lastPush?: { text: string; at: string } | null; rows?: QuestionRow[] };

/** What this message does to ORION's questions, if anything. Reads only. */
export function readQuestionsMove(message: string, ctx: QuestionsCtx): QuestionsMove | undefined {
  const rows = ctx.rows ?? readQuestionRows(questionsFile(ctx.stateDir));
  if (asksForQuestions(message)) return { kind: "list", open: openRows(rows) };
  const waiting = rows.length ? awaitingRow(rows, ctx.now, { ...(ctx.label !== undefined ? { label: ctx.label } : {}), lastPush: ctx.lastPush ?? null }) : undefined;
  const drop = dropsQuestion(message);
  if (drop) {
    const target = drop.about ? namedBy(openRows(rows), drop.about) : waiting ?? openRows(rows).filter((r) => r.status === "asked").at(0);
    return target ? { kind: "drop", id: target.id, q: target.q } : { kind: "drop" };
  }
  if (!waiting) return undefined;
  const m = low(message);
  if (!m || m.length > 400) return undefined;
  if (SKIP.test(m) && m.split(" ").length <= 6) return { kind: "skip", id: waiting.id, q: waiting.q };
  if (REQUEST.test(m) || OWN_QUESTION.test(m)) return undefined;
  return { kind: "answer", id: waiting.id, q: waiting.q, text: message.trim() };
}

async function call(run: QuestionsRun, args: string[], log: QuestionsOut): Promise<Record<string, unknown> | undefined> {
  const out = await run(args).catch(() => ({ stdout: "", code: 1 }));
  log.calls.push(`exec orion-questions ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  log.outputs.push(out.stdout);
  if (out.code !== 0) return undefined;
  try { return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>; } catch { return undefined; }
}

const listText = (top: QuestionRow, more: QuestionRow[]): string =>
  `${more.length ? "A few things I've been wondering. First" : "One thing I've been wondering"}: ${top.q}` +
  (more.length ? ` After that: ${more.map((r) => r.q).join(" / ")}` : "");

/** Carries the move out through orion-questions and says what happened, from its answer. */
export async function runQuestionsMove(move: QuestionsMove, run: QuestionsRun): Promise<QuestionsOut> {
  const log: QuestionsOut = { text: "", calls: [], outputs: [] };
  switch (move.kind) {
    case "list": {
      const open = move.open;
      const top = open[0];
      if (!top) return { ...log, text: "Nothing right now. When something about you is unclear to me I'll note it and ask." };
      await call(run, ["asked", top.id, "--via", "chat", "--text", top.q, "--json"], log);
      return { ...log, text: listText(top, open.slice(1, 3)) };
    }
    case "drop": {
      if (!move.id) return { ...log, text: "There's no question of mine waiting on you." };
      const out = await call(run, ["drop", move.id, "--why", "Nick said to drop it", "--json"], log);
      return { ...log, text: out?.ok ? `Okay, dropped it. I won't ask "${move.q}" again.` : "I couldn't drop that question just now. Try again in a moment." };
    }
    case "skip": {
      const out = await call(run, ["skip", move.id, "--json"], log);
      return { ...log, text: out?.ok ? "No worries, I'll ask another time." : "Okay." };
    }
    case "answer": {
      const out = await call(run, ["answer", move.id, move.text, "--json"], log);
      if (!out?.ok) return { ...log, text: "Got it, but I couldn't save that just now, so I may ask again." };
      return { ...log, text: out.kept === "no" ? "Got it, thanks. I couldn't write it to your notes just now, so I may ask again." : "Got it, thanks. I'll remember that." };
    }
  }
}

/** The real script (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export const liveQuestionsRun = (stateDir?: string): QuestionsRun => (args) => new Promise((resolve) =>
  execFile(scriptPath("orion-questions"), args, { timeout: 15000, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } },
    (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 })));
