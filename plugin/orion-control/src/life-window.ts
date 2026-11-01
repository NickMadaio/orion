/*
 His planning window's evening edge, from his own settings (Wave 6, gate run-1101003318: loop-calendar-question-reply-v).

 Slot searches for a pending reply stopped at a fixed 10 PM (pending-reply-day.ts DAY_END), so with 20:30-24:00 free ORION said "there's
 no free 90 min left today". The scheduler plans up to his bedtime less wind-down (scripts/lib/life/config.mjs: bedtime, windDownMinutes);
 this reads the same two settings: the sandbox's own file during an evaluation, as config.mjs does, else his.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sandboxNowMs } from "./plugin-clock.js";

/** scripts/lib/life/config.mjs DEFAULTS. */
const DEFAULT_BEDTIME = 0;
const DEFAULT_WIND_DOWN = 30;
const validTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function readLifeConfig(stateDir: string | undefined): Record<string, unknown> {
  if (!stateDir) return {};
  const file = join(stateDir, `${sandboxNowMs({ dir: stateDir }) !== null ? "eval-" : ""}life-config.json`);
  try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return {}; }
}

/** His bedtime in minutes after midnight (midnight when unset or unreadable). */
export function bedtimeMin(stateDir: string | undefined): number {
  const bed = readLifeConfig(stateDir).bedtime;
  return validTime(bed) ? minutesOf(bed) : DEFAULT_BEDTIME;
}

/** The latest a planned block may end today: bedtime less wind-down, on the evening's clock (00:30 bedtime is 24:00 at most). */
export function dayEndFor(stateDir: string | undefined): number {
  const config = readLifeConfig(stateDir);
  const bed = validTime(config.bedtime) ? minutesOf(config.bedtime) : DEFAULT_BEDTIME;
  const wind = Number.isInteger(config.windDownMinutes) && Number(config.windDownMinutes) >= 0 ? Number(config.windDownMinutes) : DEFAULT_WIND_DOWN;
  const line = bed < 12 * 60 ? bed + 1440 : bed;
  return Math.min(1440, line - wind);
}
