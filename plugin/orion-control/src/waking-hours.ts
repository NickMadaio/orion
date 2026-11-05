/*
 The am/pm rule, in one place (w20 round 3, live gate 2026-11-05 01:00-02:00). A clock he says with no am/pm is read as a time he
 is awake for: 7 AM to midnight. "gym at half 5" at 1 AM is 17:30, "the library 2-4" is 14:00-16:00. Only an early-morning cue
 in his words ("5 in the morning", "early", "before my lecture", "wake") reads the small hours as the small hours.
 Pure.
*/
/** His words say the small hours are meant. */
export const EARLY_CUE = /\b(?:in the morning|morning|early|dawn|sunrise|crack of dawn|wake(?:s|d)?|woke|alarm|before (?:my |the )?(?:class|lecture|work|breakfast|sunrise)|overnight|after midnight|a\.?m\.?)(?![a-z])/i;
/** First minute of the day he is plausibly up for (07:00). */
export const WAKING_FROM = 7 * 60;
/** Keep the waking-hours readings of a bare clock; all of them when none is (a 3 AM-only clock like "2:30 in the night" is exact anyway). */
export function wakingOnly(candidates: number[]): number[] {
  const up = candidates.filter((v) => v >= WAKING_FROM && v < 1440);
  return up.length ? up : candidates;
}
