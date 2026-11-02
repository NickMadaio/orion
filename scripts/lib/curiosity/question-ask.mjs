// One of ORION's own questions (lib/brain/questions.mjs), asked at a good moment (wave 12 L1, 2026-11-02). Pure.
//
// Interruptible means all of: at the Mac (the Mac facet says active: input in the last 5 min, not locked or asleep), awake and
// outside his sleep window (no quiet hours), no focus session, nothing on the calendar now (no class, no travel), not his usual
// night out, not just woken, between 9 AM and 10 PM, and outside the blank-ask spacing (the same caps as "what are you up to?",
// blankBlocker in decide.mjs). One question a day at most (nextToAsk), and never on a tick that already asks something else.
// orion-reach still gates and budgets the send, and puts it in his chat thread like every other proactive message.
import { blankBlocker } from "./decide.mjs";
import { deferral } from "./loop.mjs";
import { nextToAsk } from "../brain/questions.mjs";

export const QUESTION_PREFIX = "Question for you: ";
export const questionText = (row) => `${QUESTION_PREFIX}${row.q}`;

/** Why a question may not be asked now, or null. */
export function questionBlocker(aw, { now, ledger, turns = [], day = [], wakeGrace = false, otherAsk = false }) {
  if (otherAsk) return "other-ask";
  if (wakeGrace) return "wake-grace";
  if (aw.mac?.state !== "active") return "not-at-mac";
  const wait = deferral(aw, now);
  if (wait) return wait;
  const minute = now.getHours() * 60 + now.getMinutes();
  return blankBlocker(aw, { minute, ledger, turns, now: now.getTime(), day });
}

/**
 * @param aw   awareness (after readAwareness)
 * @param ctx  { now: Date, rows (questions.jsonl), ledger (curiosity.json), turns, day, wakeGrace, otherAsk }
 * @returns { key, type: "question-note", action: "ask", kind: "question", text, questionId, ask } | null
 */
export function questionAsk(aw, ctx) {
  if (questionBlocker(aw, ctx)) return null;
  const row = nextToAsk(ctx.rows ?? [], ctx.now);
  if (!row) return null;
  const date = ctx.now.toLocaleDateString("en-CA");
  return {
    key: `question-${row.id}-${date}`, type: "question-note", action: "ask", kind: "question", text: questionText(row), questionId: row.id,
    ask: { type: "question-note", kind: "question-note", questionId: row.id, window: null, place: null, cell: null },
  };
}
