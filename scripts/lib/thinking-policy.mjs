// When ORION thinks (2026-10-07, narrowed the same day: "he doesn't ALWAYS need
// thinking"). The same rule as MobileCore/ThinkingPolicy.swift.
// Off: talk, questions, and one-step commands (end my session, remind me at
// 6:55, move gym to 6). Low: a schedule change with several parts or anchors,
// planning a whole day, or a long rambling message. Local models never think.
const VERBS = /\b(get rid of|start|move|shift|push|swap|extend|shorten|resize|cancel|skip|drop|delete|remove|clear|book|schedule|reschedule|add|put|replace|rename|fit|make)\b/gi;
const ANCHORS = /\b(before|after|until|between|at least|ending|ends?|same (end|time|as)|instead|then|so i'?m|right after|directly after)\b/i;
const WHOLE_DAY = /\b(plan|schedule|fill|organi[sz]e|redo|rebuild)\b[^.?!]{0,30}\b(my |the )?(day|today|tomorrow|week|evening|afternoon|morning|rest of)\b/i;

// A plan told as a story: "gonna nap so i'm up by 1:30, then do the lab" (2026-10-08 eval).
const NARRATIVE = /\b(gonna|going to|i'?ll|i will|want to|wanna)\b.{0,80}\b(then|so i'?m|by \d|until|before|after)\b/i;

export function needsReasoning(text) {
  const said = String(text ?? "");
  if (NARRATIVE.test(said)) return true;
  const verbs = said.match(VERBS) ?? [];
  if (WHOLE_DAY.test(said)) return true;
  if (verbs.length >= 2) return true;
  if (verbs.length >= 1 && ANCHORS.test(said)) return true;
  return said.split(/\s+/).filter(Boolean).length >= 35;
}

export function thinkingLevel(text, { model } = {}) {
  if (String(model ?? "").startsWith("ollama/")) return "off";
  return needsReasoning(text) ? "low" : "off";
}
