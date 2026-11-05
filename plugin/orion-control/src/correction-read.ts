/*
 A correction of ORION's last action ("yes, but not the NEW CS Lab, just CS Lab", "no, i meant the DS lab", "no, the other one"). Tube audit T3 (11-05 12:17):
 it was drafted as chit-chat ("Got it. Just the CS Lab reminder, not the new one.") with no action and an invented reminder. A correction is the SAME ask again with the
 target fixed: the router hands his previous message to the same flow with the correction attached, instead of letting a draft acknowledge a change nobody made.
 Pure.
*/
export type Correction = { wrong?: string; right?: string; other?: boolean };

const LEAD = String.raw`(?:(?:yes|yeah|yep|yup|no|nah|nope|ok|okay|actually|wait|sorry|oh|hmm|um|uh)[,.!\s]+)*(?:but[,\s]+)?`;
const THE = String.raw`(?:the |my |that )?`;
const NOT_JUST = new RegExp(String.raw`^${LEAD}not ${THE}(.{2,50}?)[,;]?\s+(?:just|only|i meant|i said|it'?s|its|but|rather|instead)\s+${THE}(.{2,50})$`, "i");
const NOT_THAT = new RegExp(String.raw`^${LEAD}not (?:that|this|those|these) one[,;.]?\s+${THE}(.{2,50})$`, "i");
const MEANT = new RegExp(String.raw`^${LEAD}(?:i )?(?:meant|mean|said|was talking about|ment)\s+${THE}(.{2,50})$`, "i");
const OTHER = new RegExp(String.raw`^${LEAD}(?:the )?other one(?:\s+(?:please|pls|mate))?$`, "i");
const clean = (s: string): string => s.trim().replace(/[.!?]+$/, "").replace(/\s+(?:please|pls|mate|thanks)$/i, "").trim();

/** The correction in his message, or null. */
export function readCorrection(message: string): Correction | null {
  const m = message.trim().replace(/\s+/g, " ");
  if (!m || m.length > 120) return null;
  const nj = NOT_JUST.exec(m);
  if (nj) return { wrong: clean(nj[1]!), right: clean(nj[2]!) };
  const nt = NOT_THAT.exec(m);
  if (nt) return { right: clean(nt[1]!) };
  const me = MEANT.exec(m);
  if (me) return { right: clean(me[1]!) };
  if (OTHER.test(m)) return { other: true };
  return null;
}

/** His previous message with the correction attached, for the same flow to read. */
export function correctedAsk(previous: string, c: Correction): string {
  const note = c.other ? "he means the other one" : `${c.wrong ? `not ${c.wrong}, ` : ""}${c.right ?? ""}`.replace(/,\s*$/, "");
  return `${previous.trim().replace(/[.!?]+$/, "")} (correction of what you just did: ${note})`;
}
