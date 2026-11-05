/*
 "what have we done in this chat" (w20 xf-other, live gate 2 #97). The worker summarised from memory and claimed a bedtime change that never
 ran. A summary of what ORION did is built only from what the tool results produced: the made-ledger (blocks, notes, reminders, food, water,
 read from the scripts' own output, made-ledger.ts) and the count of calendar changes this chat recorded. Nothing else is claimed.
*/
import type { MadeItem } from "./made-ledger.js";

const ASK = [
  /\bwhat (?:have|did|has) (?:we|you|i) (?:done|made|changed|added|achieved|got done|sorted|covered)\b[^.?!]{0,40}\b(?:chat|conversation|session|so far|today|just now|here|this (?:morning|afternoon|evening))\b/,
  /\bwhat (?:have|did) (?:we|you) (?:done|do|change|changed|make|made|add|added)(?: so far)?\s*[?.!]*$/,
  /\b(?:sum(?:marise|marize)?|recap|rundown|run down|list)\b[^.?!]{0,30}\b(?:this (?:chat|conversation)|what (?:we|you)(?:'ve| have)? (?:done|changed|made|added)|everything (?:we|you))\b/,
  /\bwhat (?:did|have) you (?:actually )?(?:do|done|change|changed|make|made) (?:for me )?(?:in|during|so far in) (?:this|our) (?:chat|conversation)\b/,
];
export const asksChatSummary = (message: string): boolean => {
  const m = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  return m.length <= 90 && ASK.some((p) => p.test(m));
};

const phrase = (i: MadeItem): string => {
  switch (i.kind) {
    case "block": return `put "${i.label}" on your day`;
    case "note": return `saved a note, "${i.label.slice(0, 50)}"`;
    case "reminder": return `set a reminder, "${i.label}"`;
    case "food": return `logged ${i.label}`;
    case "water": return `logged ${i.count ?? 1} water ${(i.count ?? 1) === 1 ? "bottle" : "bottles"}`;
  }
};
const join = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** One sentence or two from the ledger and the calendar-change count; never a claim the tools did not show. */
export function chatSummary(items: readonly MadeItem[], calendarChanges: number): string {
  const made = items.map(phrase);
  const cal = calendarChanges > 0 ? `I changed your calendar ${calendarChanges === 1 ? "once" : `${calendarChanges} times`}` : "";
  if (!made.length && !cal) return "I haven't made or changed anything in this chat that I can confirm.";
  const parts = [...(made.length ? [`Here's what I can confirm: I ${join(made)}`] : []), ...(cal ? [made.length ? `and ${cal.charAt(0).toLowerCase()}${cal.slice(1)}` : cal] : [])];
  return `${parts.join(" ")}. That's only what my tools reported back, nothing else.`;
}
