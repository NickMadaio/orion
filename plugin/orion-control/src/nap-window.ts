/*
 "took a nap lol" at 3:30 PM, the minute MKTG2201 ended (gate run-1031224700, rea-spontaneous-nap-v). The guess was 45 minutes ending
 now, which sat on top of the class: the scheduler refused it ("covered by his own plans") and he heard "I couldn't log Nap just now".
 With no times from him, the nap ends at the latest moment before now that is not one of his fixed plans (a class, a plan with
 people), and the reply says where it was put so he can correct it. Pure.
*/
import type { DayBlock } from "./schedule-flow.js";

const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

export type NapGuess = { from: number; to: number; before?: DayBlock };

/** The nap's guessed span (minutes today): `length` long, ending now unless a fixed plan covers that time. */
export function napWindow(blocks: readonly DayBlock[], now: number, length: number, earliest = 240): NapGuess {
  const walls = blocks.filter((b) => b.fixed && b.kind !== "commute");
  let to = now; let before: DayBlock | undefined;
  for (;;) {
    const hit = walls.find((w) => toMin(w.start) < to && to - length < toMin(w.end) && toMin(w.start) < now);
    if (!hit) break;
    before = hit; to = toMin(hit.start);
    if (to - length < earliest) break;
  }
  return { from: Math.max(earliest, to - length), to, ...(before ? { before } : {}) };
}
