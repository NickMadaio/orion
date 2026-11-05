/*
 He is typing or talking to ORION, so he is awake (w20 r5, live gate 3 #110: "It's 5:25 AM, mate. You're still asleep." to a message he had just sent).
 An inbound turn is the proof of awake: a sentence that says he is asleep is dropped from any reply, whatever the sleep sensors last said.
 "Go back to sleep", "you should be asleep" and "sleep well" are advice, not a claim about now, and stay.
*/
// Only a claim ABOUT HIM, now: "you're (still) asleep", "you must be sleeping", "looks like you're asleep". Not his cat, not "if you're asleep", not "while you sleep".
const ASLEEP_CLAIM = /\b(?:you(?:'re| are|r)|you must be|you seem|looks like you(?:'re| are)|so you(?:'re| are)) (?:still |already |probably |fast |apparently |technically |currently )*(?:asleep|sleeping|dreaming|out cold|snoozing)\b/i;
const ADVICE = /\b(?:should be|go back to|get some|before you|so you can|hope you|sleep well|go to)\b|\b(?:if|when|whenever|unless|in case|while|once)\b[^.?!]*\byou(?:'re| are)\b|\bsleeping through\b|\?\s*$/i;

export const claimsAsleep = (sentence: string): boolean => ASLEEP_CLAIM.test(sentence) && !ADVICE.test(sentence);

/** The text without any sentence that says he is asleep. */
export function withoutAsleepClaims(text: string): string {
  return String(text ?? "").split(/(?<=[.!?])\s+/).filter((s) => !claimsAsleep(s)).join(" ").trim();
}
