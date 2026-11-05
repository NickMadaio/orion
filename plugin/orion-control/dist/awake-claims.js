/*
 He is typing or talking to ORION, so he is awake (w20 r5, live gate 3 #110: "It's 5:25 AM, mate. You're still asleep." to a message he had just sent).
 An inbound turn is the proof of awake: a sentence that says he is asleep is dropped from any reply, whatever the sleep sensors last said.
 "Go back to sleep", "you should be asleep" and "sleep well" are advice, not a claim about now, and stay.
*/
const ASLEEP_CLAIM = /\b(?:you(?:'re| are|r)|you must be|you seem|looks like you(?:'re| are)|so you(?:'re| are)) (?:still |already |probably |fast |apparently |technically )*(?:asleep|sleeping|dreaming|out cold|in bed sleeping|snoozing)\b|\b(?:still|currently) asleep\b|\bwhile you(?:'re| are) (?:asleep|sleeping)\b/i;
const ADVICE = /\b(?:should be|go back to|get some|before you|so you can|hope you|sleep well|go to)\b/i;
export const claimsAsleep = (sentence) => ASLEEP_CLAIM.test(sentence) && !ADVICE.test(sentence);
/** The text without any sentence that says he is asleep. */
export function withoutAsleepClaims(text) {
    return String(text ?? "").split(/(?<=[.!?])\s+/).filter((s) => !claimsAsleep(s)).join(" ").trim();
}
