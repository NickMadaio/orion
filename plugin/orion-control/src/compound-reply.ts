/*
 How a calendar reply with more than one outcome is worded (wave 8 C): what was done, the knock-on moves in a breath, what could not
 happen, and "undo" in a few words. It only arranges parts the tools already returned; it adds no claim of its own.
*/

const MOVED = /^(.+?) (\d{1,2}:\d{2} [AP]M) → (\d{1,2}:\d{2} [AP]M)$/;
const list = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const ended = (t: string): string => t.replace(/[.\s]+$/, "");

/** Collateral changes the scheduler printed ("x 9:00 AM → 10:00 AM", "Gym is off today") as one or two short sentences. */
export function knockOn(notes: string[]): string {
  const moved = notes.map((n) => MOVED.exec(n)).filter((m): m is RegExpExecArray => m !== null).map((m) => `${m[1]} from ${m[2]} to ${m[3]}`);
  const other = notes.filter((n) => !MOVED.test(n)).map(ended);
  return [moved.length ? `That also moved ${list(moved)}.` : "", other.length ? `Also, ${list(other)}.` : ""].filter(Boolean).join(" ");
}

export type Compound = { did: string[]; knock: string[]; couldnt: string[]; tail?: string; undo: boolean };

/** Done first, then what it shifted, then what could not happen, then (a few words) how to revert. */
export function compoundReply(p: Compound): string {
  const done = p.did.length ? `Done — ${list(p.did.map(ended))}.` : "";
  const failed = p.couldnt.length ? `But ${p.couldnt.map(ended).join(", and ")}.` : "";
  return [done, knockOn(p.knock), failed, p.tail ? p.tail.trim() : "", p.undo ? 'Say "undo" to revert.' : ""].filter(Boolean).join(" ");
}
