// How rested Nick is, from the WHOOP numbers in health-log.json (2026-10-30). Planning reads this: a low-recovery day
// gets lighter study blocks and a shorter, easier gym instead of the full load he cannot carry.
// Pure: a day record in, a level out. Unknown data is "unknown", never "low" and never "fine".

import { totalSleepHours } from "./naps.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const DEBT_DAYS = 3, NEED_HOURS = 8;

/**
 * @param record  health-log.json days[date]: { recovery, sleepHours, strain, hrv }
 * @param history earlier days' records, newest first, for sleep debt
 * @param extra   { sleptHours } overrides the record (an all-nighter ORION saw itself)
 * @returns {{ level: "low"|"normal"|"unknown", studyScale: number, gymMinutes: number|null, debtHours: number, reasons: string[] }}
 */
export function recoveryLevel(record = {}, history = [], extra = {}) {
  const recovery = num(record?.recovery);
  const slept = num(extra.sleptHours) ?? totalSleepHours(record);   // night plus naps (W20)
  const debtHours = Math.round(history.slice(0, DEBT_DAYS).reduce((a, d) => a + Math.max(0, NEED_HOURS - (totalSleepHours(d) ?? NEED_HOURS)), 0) * 10) / 10;
  if (recovery === null && slept === null) return { level: "unknown", studyScale: 1, gymMinutes: null, debtHours, reasons: [] };
  const reasons = [];
  if (recovery !== null && recovery < 34) reasons.push(`recovery ${recovery}%`);
  if (slept !== null && slept < 5) reasons.push(`${Math.round(slept * 10) / 10}h of sleep`);
  if (debtHours >= 8 && (slept ?? 8) < 6.5) reasons.push(`${debtHours}h of sleep debt`);
  const low = reasons.length > 0;
  return { level: low ? "low" : "normal", studyScale: low ? 0.6 : 1, gymMinutes: low ? 45 : null, debtHours, reasons };
}

/** The level for a date straight from the parsed health-log. */
export function recoveryFromLog(log, date, extra = {}) {
  const days = log?.days ?? {};
  const earlier = Object.keys(days).filter((d) => d < date).sort().reverse().map((d) => days[d]);
  return recoveryLevel(days[date] ?? {}, earlier, extra);
}
