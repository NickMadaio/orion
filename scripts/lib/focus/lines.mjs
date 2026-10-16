// What ORION says during focus supervision (2026-10-16 audit, finding 13). The ladder's `why` ("off task for
// 2 min; phone use < 10 min") leaked into the phone text, and the focus-guard lines were fragments ("Claude.
// You're meant to be on X.") that scolded him for the app he was working in. Plain sentences that ask,
// offer a replan, and keep internals out.
const hm = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

/** The phone/Mac nudge when the Mac is off the planned block. No reason string, ever. */
export function focusNudgeLine(block) {
  return `You planned ${block.title} at ${hm(block.start)}. Want to start it now, or push it back 20 minutes?`;
}

/** The focus-guard (orion-focus) line for strike 1, 2, 3+. */
export function strikeLine({ strike, front, task, minutesLeft }) {
  if (strike <= 1) return `You're on ${front}, and the plan says ${task}. Back to it?`;
  if (strike === 2) return `Still on ${front}. ${task} is what you set - back to it, or tell me what changed?`;
  return `${task} still has ${minutesLeft} minutes left. If something's going on, tell me and I'll re-plan; otherwise let's get back to it.`;
}
