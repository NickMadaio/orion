/*
 A reply may say a bedtime was set or changed only when orion-sleepplan did it this turn (w20 round 6, live gate 4 #13 #81 #11: "Bedtime tonight only is
 11:50 PM", "Set bedtime to 11:30 PM tonight" and "Saved: your bedtime is half 11" were said with nothing written; the desk had sent them to the wake tool
 and the worker, or the brain, just agreed). One general rule instead of one per phrase: any sentence that CLAIMS a bedtime change is dropped unless this
 turn's tools include an orion-sleepplan write, whose own read-back is what the code reply states. A question about his bedtime or a plain statement of the
 current one is not a claim and is kept.
*/
const BED = /\b(?:bed\s?times?|sleep\s?times?|lights[- ]out|asleep[- ]by)\b/i;
const CHANGE = /\b(?:set|sets|changed?|moved?|push(?:ed)?|updated?|saved?|made|put|adjusted|bumped)\b|\btonight only\b|\bevery night\b|\bfrom now on\b|\bis now\b|\bnow (?:at|is)\b/i;
const TIME = /\d|\bmidnight\b|\bnoon\b|\bhalf\s+\w+|\bquarter\b|\b(?:ten|five|twenty)\s+(?:to|past)\b/i;
const WROTE = /orion-sleepplan\s+(?:bedtime|wake-on|shift|set|except)\b/;

/** The honest line when every sentence was a claim. */
export const BEDTIME_UNSAVED = "I haven't changed your bedtime, so nothing was saved. Say it again and I'll set it.";

export const claimsBedtimeChange = (sentence: string): boolean => !/\?\s*$/.test(sentence.trim()) && BED.test(sentence) && CHANGE.test(sentence) && TIME.test(sentence);

/** The draft without sentences that claim a bedtime change no tool made; unchanged when a sleep-plan write ran this turn. */
export function withoutUnverifiedBedtimeClaims(draft: string, tools: ReadonlyArray<{ canonical: string }>): string {
  if (tools.some((t) => WROTE.test(t.canonical))) return draft;
  const sentences = String(draft ?? "").split(/(?<=[.!?])\s+/);
  if (!sentences.some(claimsBedtimeChange)) return draft;
  const kept = sentences.filter((s) => !claimsBedtimeChange(s));
  return [...kept, BEDTIME_UNSAVED].join(" ").trim();
}
