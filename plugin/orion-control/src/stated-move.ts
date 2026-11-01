/*
 Wave 8 B (gate run-1101080052, per-legit-vs-excuse-c): "gym is bumped to 10:30am tonight because i have a deadline at 9:30am" is
 not a command, so no route owned it; the worker echoed "Gym is bumped to 10:30 AM tonight…" with no calendar write.
 A statement that one of ORION's own blocks (gym, side project, study, nap) is now at a time he names is a request to put it
 there. This reads it; local-routing's gym turn runs it through the schedule flow (move, or add when it is not on the day).
 Questions, conditionals, past reports ("was moved") and classes are not read.
*/
const OWNED = String.raw`(gym|workout|side[ -]?project|study(?: block| session)?|nap)`;
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
const VERB = String.raw`(?:bumped|moved|pushed|shifted|rescheduled|switched)(?:\s+(?:back|up|later|over))?`;
const STATEMENT = new RegExp(String.raw`(?:^|\b)(?:my\s+|the\s+|ur\s+|your\s+)?${OWNED}(?:\s+(?:is|got|gets|has been|has got|is getting)|'?s)\s+(?:now\s+)?${VERB}\s+(?:to|till|until|for)\s+${TIME}\b`, "i");
const NOT_A_STATEMENT = /\?\s*$|^(?:so\s+)?(?:should|can|could|would|do|does|is|are|will|what|when|why|how)\b|\b(?:if|unless|when|once|whether|should|would|could|might|maybe)\b[^.?!,]*\b(?:bumped|moved|pushed|shifted|rescheduled|switched)\b/i;

export type StatedMove = { kind: "stated"; name: string; at: string; day: "today" | "tomorrow"; reason?: string };

const pad = (n: number): string => String(n).padStart(2, "0");

export function readStatedMove(message: string): StatedMove | null {
  const m = message.trim().replace(/\s+/g, " ");
  if (NOT_A_STATEMENT.test(m)) return null;
  const hit = STATEMENT.exec(m);
  if (!hit) return null;
  const name = hit[1]!.toLowerCase().replace(/[ -]?project/, " project").replace(/^(study).*/, "study").replace(/^side\s*project$/, "side project");
  let h = Number(hit[2]); const min = Number(hit[3] ?? 0); const ap = hit[4]?.toLowerCase();
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0; else if (!ap && h >= 1 && h <= 8) h += 12;
  const after = m.slice((hit.index ?? 0) + hit[0].length);
  const day = /^\s*(?:tomorrow|tmrw|tmr|2moro)\b/i.test(after) || /\b(?:tomorrow|tmrw|tmr)\b/i.test(after.split(/\b(?:because|cuz|coz|bc|since)\b/i)[0] ?? "") ? "tomorrow" : "today";
  const reason = /\b(?:because|cuz|coz|bc|since)\b\s+(.+)$/i.exec(after)?.[1]?.trim();
  return { kind: "stated", name, at: `${pad(h)}:${pad(min)}`, day, ...(reason ? { reason } : {}) };
}
