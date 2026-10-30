// Port of MobileCore/ThinkingPolicy.swift (the Mac app's `--thinking` level for a turn).
// Same patterns as the Swift source; ICU `\b` is Unicode-aware and JS `\b` is ASCII-only, which only
// matters beside a non-ASCII letter.
import { parseISO } from "./text.mjs";

export const BOOST_SECONDS = 600;
const VERBS = /\b(get rid of|start|move|shift|push|swap|extend|shorten|resize|cancel|skip|drop|delete|remove|clear|book|schedule|reschedule|add|put|replace|rename|fit|make)\b/gi;
const ANCHORS = /\b(before|after|until|between|at least|ending|ends?|same (end|time|as)|instead|then|so i'?m|right after|directly after)\b/i;
const WHOLE_DAY = /\b(plan|schedule|fill|organi[sz]e|redo|rebuild)\b[^.?!]{0,30}\b(my |the )?(day|today|tomorrow|week|evening|afternoon|morning|rest of)\b/i;
const NARRATIVE = /\b(gonna|going to|i'?ll|i will|want to|wanna)\b.{0,80}\b(then|so i'?m|by \d|until|before|after)\b/i;

export function needsReasoning(text) {
  if (NARRATIVE.test(text)) return true;
  if (WHOLE_DAY.test(text)) return true;
  const verbCount = (text.match(VERBS) ?? []).length;
  if (verbCount >= 2) return true;
  if (verbCount >= 1 && ANCHORS.test(text)) return true;
  return text.split(/\s+/).filter(Boolean).length >= 35;
}

/** `model` null = no model picked in the app (the usual case). Times are epoch ms. */
export function thinkingLevel({ text, model = null, boostedUntil = null, now }) {
  if (typeof model === "string" && model.startsWith("ollama/")) return "off";
  if (boostedUntil !== null && boostedUntil !== undefined && boostedUntil > now) return "low";
  return needsReasoning(text) ? "low" : "off";
}

/** Two or more failed tool calls in the turn (rows at or after `since`, epoch ms) means ORION was guessing. */
export function struggled(transcript, since) {
  let failures = 0;
  for (const line of transcript.split("\n")) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object") continue;
    const at = parseISO(row.timestamp);
    const message = row.message;
    if (at === null || at < since || !message || typeof message !== "object" || message.role !== "toolResult") continue;
    if (message.isError === true) { failures++; continue; }
    const code = message.details?.exitCode;
    if (Number.isInteger(code) && code !== 0) { failures++; continue; }
    const text = Array.isArray(message.content) ? message.content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
    if (text.startsWith("NOTHING WAS") || text.startsWith("Orion repeat guard")) failures++;
  }
  return failures >= 2;
}
