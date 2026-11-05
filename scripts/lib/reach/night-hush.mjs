// Sleep wins over plan nudges (2026-11-02). Once tonight's bedtime-nudge time has passed, no gym / side-project / plan
// catch-up line goes out: a skipped gym is mentioned at most in the next morning's brief. Pure: plan + config + clock in,
// a boolean out. nightHushed() reads the files.
import { join } from "node:path";
import { readJson } from "../awareness/io.mjs";
import { eveningOf, instant } from "../life/sleep-plan.mjs";
import { toMinute } from "../life/config.mjs";
import { effectiveBedtime } from "../life/effective-bed.mjs";

/** The instant tonight's wind-down starts: Nick's own wake-plan nudge, else life-config bedtime minus windDownMinutes. */
export function nudgeInstant({ now, plan = null, config = {} }) {
  const evening = eveningOf(now);
  const own = plan?.source === "nick" ? (plan.bedtimes ?? []).find((b) => b?.date === evening) : null;
  const iso = own ? Date.parse(own.nudgeAtIso) : NaN;
  if (Number.isFinite(iso)) return new Date(iso);
  const bed = toMinute(effectiveBedtime(config, evening));
  const wind = Number.isFinite(Number(config.windDownMinutes)) ? Number(config.windDownMinutes) : 30;
  return instant(evening, (bed < 12 * 60 ? bed + 1440 : bed) - wind);
}

/** True from tonight's nudge time until the day turns at 04:00. */
export const pastNudgeTime = ({ now, plan, config }) => now.getTime() >= nudgeInstant({ now, plan, config }).getTime();

/** Same, reading wake-plan.json (eval-wake-plan.json in a sandbox) from the controlled dir. */
export function nightHushed({ dir, now, config = {}, sandbox = false }) {
  const plan = readJson(join(dir, sandbox ? "eval-wake-plan.json" : "wake-plan.json"));
  return pastNudgeTime({ now, plan, config });
}
