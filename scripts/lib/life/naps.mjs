// Naps and the other WHOOP facts the app stores on a health-log day (W20, 2026-11-04: "Orion can see I slept more and
// schedule around it"). The Mac app writes, per day in health-log.json `days[date]`:
//   naps:         [{ start: ISO, end: ISO, minutes: asleep minutes, performance?: % }]
//   napMinutes:   total asleep minutes across those naps
//   whoopWorkouts:[{ id, start: ISO, end: ISO, minutes, strain?, sport?, averageHeartRate? }]
// A nap is keyed to the day it ended on. Total sleep for a day = the scored night + its naps. Pure readers, no I/O.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const NAP_MIN_CREDIT_MINUTES = 20, NAP_CREDIT_SHARE = 0.5, NAP_CREDIT_CAP_MINUTES = 60;

/** Minutes of nap on a day record: the stored total, else the naps summed. Junk and negatives are 0. */
export function napMinutesOf(record) {
  const total = num(record?.napMinutes);
  if (total !== null) return Math.max(0, Math.round(total));
  const list = Array.isArray(record?.naps) ? record.naps : [];
  return Math.max(0, Math.round(list.reduce((sum, n) => sum + (num(n?.minutes) ?? 0), 0)));
}

/** Night plus naps, in hours (one decimal). Null only when there is neither. */
export function totalSleepHours(record) {
  const night = num(record?.sleepHours), nap = napMinutesOf(record);
  if (night === null && nap === 0) return null;
  return Math.round(((night ?? 0) + nap / 60) * 10) / 10;
}

/** What a day's naps take off the coming night's need (and let the bedtime slide by): half, at most an hour; a doze under 20 min counts for nothing. */
export function napCreditMinutes(napMinutes) {
  const m = num(napMinutes) ?? 0;
  return m < NAP_MIN_CREDIT_MINUTES ? 0 : Math.min(NAP_CREDIT_CAP_MINUTES, Math.round(m * NAP_CREDIT_SHARE));
}

/** The naps stored for a date, oldest first. */
export function napsOn(log, date) {
  const list = log?.days?.[date]?.naps;
  return Array.isArray(list) ? [...list].sort((a, b) => String(a?.start).localeCompare(String(b?.start))) : [];
}

const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`);
const localHhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** "napped 1h10 at 15:00", the words ORION uses for what the planner saw. `clock` renders the start instant (default local HH:MM). */
export function napPhrase(nap, clock = localHhmm) {
  const minutes = Math.round(num(nap?.minutes) ?? 0);
  return `napped ${hm(minutes)}${nap?.start ? ` at ${clock(nap.start)}` : ""}`;
}

/** The nap minutes for a date as a function the night planner takes. */
export const napMinutesFromLog = (log) => (date) => napMinutesOf(log?.days?.[date]);

/** WHOOP workouts in the shape health-log `workouts[]` readers (gymEvidence) already understand. */
export function whoopWorkoutsOf(log) {
  return Object.entries(log?.days ?? {}).flatMap(([day, record]) => (Array.isArray(record?.whoopWorkouts) ? record.whoopWorkouts : [])
    .filter((w) => w?.start)
    .map((w) => ({ id: w.id ?? `whoop-${w.start}`, day, startedAt: w.start, durationMin: num(w.minutes) ?? null, title: w.sport ?? "WHOOP workout", source: "whoop", strain: num(w.strain) })));
}

/** Recovery over the last `days` scored days: latest, the mean of the days before it, and the way it is going. */
export function recoveryTrend(log, days = 7) {
  const values = Object.keys(log?.days ?? {}).sort().map((d) => num(log.days[d]?.recovery)).filter((v) => v !== null).slice(-days);
  const latest = values.at(-1) ?? null;
  const prior = values.slice(0, -1);
  if (prior.length < 2) return { latest, baseline: null, direction: null };
  const baseline = Math.round(prior.reduce((a, b) => a + b, 0) / prior.length * 10) / 10;
  const delta = latest - baseline;
  return { latest, baseline, direction: Math.abs(delta) < 5 ? "flat" : delta > 0 ? "up" : "down" };
}
