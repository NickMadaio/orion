// Tonight's bedtime window, from the plan Nick set: from the latest nudge time that has passed until the next alarm of his, or 09:00.
// One definition for orion-bedtime-act and orion-bedtime-shutdown, so "inside the window" never means two things.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** { start, end } of the window `now` is in, or { reason } when there is none (no plan of his, or before the first nudge). */
export function tonightWindow(controlledDir, now) {
  let plan;
  try { plan = JSON.parse(readFileSync(join(controlledDir, "wake-plan.json"), "utf8")); } catch { return { reason: "There is no sleep plan to go by." }; }
  if (plan?.source !== "nick") return { reason: "There is no sleep plan of his to go by." };
  const nudges = (plan.bedtimes ?? []).map((b) => new Date(b?.nudgeAtIso)).filter((d) => !Number.isNaN(d.getTime()) && d <= now);
  if (!nudges.length) return { reason: "It is not bedtime yet." };
  const start = new Date(Math.max(...nudges.map((d) => d.getTime())));
  const alarm = (plan.alarms ?? []).filter((a) => a?.byNick === true).map((a) => new Date(a.iso)).filter((d) => d > start).sort((a, b) => a - b)[0];
  const nine = new Date(start); nine.setHours(9, 0, 0, 0); if (nine <= start) nine.setDate(nine.getDate() + 1);
  // Never longer than one night: 14 hours at most, and not past 10:00 the next morning (an alarm days away must not hold the window open).
  const ten = new Date(start); ten.setHours(10, 0, 0, 0); if (ten <= start) ten.setDate(ten.getDate() + 1);
  const end = new Date(Math.min((alarm ?? nine).getTime(), start.getTime() + 14 * 3600_000, ten.getTime()));
  return { start, end };
}

/** True while `now` is inside tonight's window. */
export const inWindow = (w, now) => !w.reason && now < w.end;
