// Standing rules Nick says in passing (2026-10-01).
//
// "Going forward remember that you can change how much time is allotted to non
// priority items" and "naps should be at least an hour and 15 minutes long
// ALWAYS" — ORION replied "Noted" to both and saved neither. Whether a rule is
// kept can't depend on the model remembering to call a tool: orion-remote reads
// his own words, saves the rule, and tells the model it is already saved.

const STANDING = /\b(always|going forward|from now on|moving forward|in the future|every time|every day|never again|remember (that|this|to)|make sure (you|to) always|by default)\b/i;
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };

/** "an hour and 15 minutes", "1h15", "75 min", "an hour and a half", "2 hours" → minutes, or null. */
export function parseDuration(text) {
  const t = String(text ?? "").toLowerCase();
  let m = /(\d+)\s*h(?:ours?|rs?)?\s*(\d{1,2})\s*(?:m(?:in(?:ute)?s?)?)?\b/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /(\d+(?:\.\d+)?|an?|one|two|three)\s+hours?(?:\s+and\s+(?:(a\s+half)|(\d+)\s*(?:m(?:in(?:ute)?s?)?)?|(a\s+quarter)))?/.exec(t);
  if (m) {
    const hours = Number(m[1]) || WORD_NUMBERS[m[1]] || 0;
    return Math.round(hours * 60 + (m[2] ? 30 : m[3] ? Number(m[3]) : m[4] ? 15 : 0));
  }
  m = /(\d+)\s*(?:m\b|mins?\b|minutes?\b)/.exec(t);
  return m ? Number(m[1]) : null;
}

const singular = (word) => word.replace(/ies$/, "y").replace(/(?<!s)s$/, "");

/**
 * @returns {{ standing: boolean, statement: string, minimums: [{ key, minutes }] }}
 */
export function readStandingRules(message) {
  if (typeof message !== "string") throw new TypeError("message must be a string");
  const sentences = message.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => STANDING.test(s));
  const minimums = [];
  for (const s of sentences) {
    // "<thing> should be at least <duration>" / "at least <duration> for <thing>"
    const before = /\b([a-z][a-z ]{1,30}?)\s+(?:should|must|need to|has to|have to)?\s*(?:be|last|get)?\s*at least\s+(.+)/i.exec(s);
    const after = /\bat least\s+(.+?)\s+for\s+(?:my\s+|the\s+)?([a-z][a-z ]{1,30})/i.exec(s);
    const [rawKey, durationText] = after ? [after[2], after[1]] : before ? [before[1], before[2]] : [null, null];
    if (!rawKey) continue;
    const minutes = parseDuration(durationText);
    const key = singular(rawKey.trim().toLowerCase().split(/\s+/).filter((w) => !["my", "the", "a", "and", "first", "so", "also", "that", "with", "being", "said"].includes(w)).at(-1) ?? "");
    if (key.length >= 3 && minutes && minutes >= 5 && minutes <= 600 && (STANDING.test(s) || /\bshould|must\b/i.test(s))) minimums.push({ key, minutes });
  }
  return { standing: kept.length > 0 || minimums.length > 0, statement: kept.join(" ").slice(0, 400), minimums };
}
