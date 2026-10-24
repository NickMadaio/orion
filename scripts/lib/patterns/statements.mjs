// What he tells ORION about what he did or is doing: "was at the gym", "going out to the club", "nah staying in". Pure.
// A label is always his own word; nothing here names an activity he did not name.
import { eveningOf, minuteOf, addDays } from "./time.mjs";

const NEG = /\b(?:not (?:going|gonna|heading) out|not tonight|staying (?:in|home)|stay(?:ing)? in tonight|night in|in tonight|home tonight|not out tonight|not going anywhere)\b/i;
const GENERIC_OUT = /\b(?:going out|gonna go out|go out|went out|heading out|headed out|night out|out tonight|out out|not (?:at )?home|i'?m out|im out)\b/i;
// "to" needs an article ("going to the club"; "going to die" is not a place); "at" does not ("was at uni")
const AT_PLACE = /\b(?:i'?m|im|i am|i was|was|were|been|going|gonna go|go|went|heading|headed|off)\s+(?:out\s+)?(?:to\s+(?:the|a|my)|at(?:\s+(?:the|a|my))?)\s+([a-z][a-z'-]{2,20})/i;
const NOT_A_LABEL = new Set(["bed", "sleep", "home", "the", "be", "do", "get", "see", "make", "try", "me", "you", "it", "this", "that", "least", "some", "work"]);
const PLAN = /\b(?:going|gonna|heading|about to|will|tonight|later|soon)\b/i;
const PAST = /\b(?:was|went|been|were|had|last night)\b/i;
const YES = /^\s*(?:y|ya|ye|yes|yeah|yea|yep|yup|sure|ofc|of course|probably|defo|definitely|you know it|always)\b/i;
const NO = /^\s*(?:n|no|nah|nope|not tonight|not this week)\b|\bnah\b/i;

/** A word as a label: lowercase, trimmed. */
const tidy = (w) => String(w).toLowerCase().replace(/[^a-z'-]/g, "");

/**
 * @returns { label, polarity: 1|-1, tense: "plan"|"past"|null } | null
 */
export function parseStatement(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 400 || t.includes("?")) return null;   // a question is not a statement of what he did
  const tense = PLAN.test(t) ? "plan" : PAST.test(t) ? "past" : null;
  if (NEG.test(t)) return { label: "out", polarity: -1, tense: tense ?? "plan" };
  const at = t.match(AT_PLACE);
  if (at && !NOT_A_LABEL.has(tidy(at[1]))) return { label: tidy(at[1]), polarity: 1, tense };
  if (GENERIC_OUT.test(t)) return { label: "out", polarity: 1, tense };
  return null;
}

/** His answer to "Out tonight like usual Fridays?": confirm, refute, or null when it says neither. */
export function verdictOf(text) {
  const t = String(text ?? "");
  if (NO.test(t) || NEG.test(t)) return "refute";
  if (YES.test(t)) return "confirm";
  const s = parseStatement(t);
  return s ? (s.polarity > 0 ? "confirm" : "refute") : null;
}

/**
 * Statements as evidence about a date. A free chat message counts only in the evening (16:00-05:00) or when it says
 * "tonight"; an answer to an ask carries the ask's own window. "last night" points at the evening before.
 * @param rows [{ at, text, window?: { date, start, end } }]
 * @returns [{ date, at, label, polarity, source, start?, end? }]
 */
export function statementEvidence(rows) {
  return (rows ?? []).flatMap((r) => {
    const s = parseStatement(r.text);
    if (!s || Number.isNaN(Date.parse(r.at))) return [];
    if (r.window?.date) return [{ date: r.window.date, at: r.at, label: s.label, polarity: s.polarity, source: "answer", start: r.window.start, end: r.window.end ?? null }];
    const m = minuteOf(r.at);
    const evening = m >= 16 * 60 || m < 5 * 60 || /\btonight\b/i.test(r.text);
    if (!evening) return [];
    const date = /\blast night\b/i.test(r.text) ? addDays(eveningOf(r.at), -1) : eveningOf(r.at);
    return [{ date, at: r.at, label: s.label, polarity: s.polarity, source: "said" }];
  });
}

/** The text of his message inside a gateway user turn (the harness wraps it in context blocks). */
export function ownWords(content) {
  const raw = typeof content === "string" ? content
    : Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join(" ") : "";
  if (/TEST CLOCK|tool_search|tool_describe|schedule evaluation/i.test(raw)) return null;
  const marked = raw.split(/User message:\s*/).at(-1);
  if (marked !== raw) return marked.trim();
  const body = raw.startsWith("User talked via voice recognition") ? raw.split("\n\n").slice(1).join("\n\n") : raw;
  return body.startsWith("[") ? body.split("\n\n").at(-1).trim() : body.trim();
}
