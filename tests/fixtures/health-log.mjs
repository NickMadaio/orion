// Synthetic health-log rows for awareness tests. All coordinates are made up, never his real ones.
export const HOME = { lat: 51.5, lon: -0.1 };
export const CAMPUS = { lat: 51.6, lon: -0.2 };
const pad = (n) => String(n).padStart(2, "0");
/** One phoneSignals row at local time (y, m0, d, h, mi). */
export const sample = (at, { lat, lon } = {}, extra = {}) => ({
  at: new Date(...at).toISOString(), charging: false, motion: "still",
  ...(lat !== undefined ? { latitude: lat, longitude: lon } : {}), ...extra });
/** `nights` consecutive nights of charging at 03:00 at `place`, ending the day before `end` (local date [y, m0, d]). */
export function overnightCharging(nights, place, end = [2026, 9, 16]) {
  return Array.from({ length: nights }, (_, i) => sample([end[0], end[1], end[2] - 1 - i, 3, 0], place, { charging: true }));
}
/** Daytime samples elsewhere (more of them than the overnight ones). */
export const daytime = (count, place, end = [2026, 9, 16]) =>
  Array.from({ length: count }, (_, i) => sample([end[0], end[1], end[2] - 1 - (i % 14), 11 + (i % 6), 10], place, { charging: false }));
export const iso = (...at) => new Date(...at).toISOString();
export const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;
