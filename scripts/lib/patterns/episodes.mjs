// "Away from home in the evening" episodes, from phone fixes (and focus sessions as Mac evidence). Pure.
// One reading per evening: out (a stretch away from home of an hour or more that reaches into the night), home (seen at
// home through the core of the night and never away), or unknown (no evidence: a missing week is never a broken week).
import { eveningOf, nightMinute, median } from "./time.mjs";

const MOVING = ["walking", "running", "cycling", "vehicle", "automotive"];
export const EVENING = Object.freeze({ from: 17 * 60, to: 32 * 60 });       // 17:00 to 08:00 next morning
export const NIGHT = Object.freeze({ from: 21 * 60, to: 28 * 60 });         // an episode must reach into 21:00-04:00
export const CORE = Object.freeze({ from: 22 * 60, to: 27 * 60 });          // "home" needs fixes across 22:00-03:00
export const MIN_AWAY = 60, HOME_SPREAD = 15;

/** The coarse cell awareness already uses (2 decimals, ~1 km). Nothing finer is ever stored. */
export const cellOf = (lat, lon) => `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;

/** Phone rows with a fix, one per instant and place, oldest first. */
export function fixesOf(phoneSignals) {
  const seen = new Set();
  return (phoneSignals ?? [])
    .map((s) => ({ at: s?.at, lat: Number(s?.latitude ?? s?.lat), lon: Number(s?.longitude ?? s?.lon), charging: s?.charging === true, motion: s?.motion ?? null }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !Number.isNaN(Date.parse(s.at)))
    .filter((s) => { const k = `${s.at}|${s.lat}|${s.lon}`; return !seen.has(k) && seen.add(k); })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const modeOf = (xs) => {
  const counts = xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Runs of consecutive away fixes; each ends at the next home fix (he got home) or its own last fix (open). */
function awayRuns(rows) {
  const runs = [];
  let run = null;
  for (const r of rows) {
    if (!r.home) { run = run ?? { rows: [] }; run.rows.push(r); continue; }
    if (run) { runs.push({ ...run, homeAt: r.m }); run = null; }
  }
  if (run) runs.push({ ...run, homeAt: null });
  return runs.map((x) => {
    const still = x.rows.filter((r) => !MOVING.includes(r.motion));
    return { start: x.rows[0].m, end: x.homeAt ?? x.rows.at(-1).m, returnedHome: x.homeAt !== null,
      cell: modeOf((still.length ? still : x.rows).map((r) => cellOf(r.lat, r.lon))), fixes: x.rows.length };
  });
}

const overlaps = (a, b) => a.start < b.to && a.end > b.from;

/**
 * @param fixes     fixesOf(phoneSignals)
 * @param isHome    (fix) => boolean
 * @param sessions  focus sessions [{ start, end }] in ms (he was at the Mac)
 * @returns { [eveningDate]: { date, status: "out"|"home"|"unknown", start, end, cell, returnedHome, fixes } }
 */
export function eveningEpisodes(fixes, { isHome, sessions = [] }) {
  const byEvening = new Map();
  for (const f of fixes) {
    const date = eveningOf(f.at);
    const m = nightMinute(f.at, date);
    if (m < EVENING.from || m >= EVENING.to) continue;
    byEvening.set(date, [...(byEvening.get(date) ?? []), { ...f, m, home: isHome(f) }]);
  }
  const out = {};
  for (const [date, rows] of byEvening) {
    const runs = awayRuns(rows).filter((r) => r.end - r.start >= MIN_AWAY && overlaps(r, NIGHT));
    const best = runs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    if (best) { out[date] = { date, status: "out", ...best }; continue; }
    const homeCore = rows.filter((r) => r.home && r.m >= CORE.from && r.m < CORE.to).map((r) => r.m);
    const atMac = sessions.some((s) => { const a = nightMinute(s.start, date), b = nightMinute(s.end, date); return a < CORE.to && b > CORE.from; });
    const seenHome = homeCore.length >= 2 && Math.max(...homeCore) - Math.min(...homeCore) >= HOME_SPREAD;
    out[date] = { date, status: seenHome || (atMac && !rows.some((r) => !r.home && r.m >= CORE.from && r.m < CORE.to)) ? "home" : "unknown", fixes: rows.length };
  }
  for (const s of sessions) {
    const date = eveningOf(s.start);
    if (out[date]) continue;
    const a = nightMinute(s.start, date), b = nightMinute(s.end, date);
    if (a < CORE.to && b > CORE.from) out[date] = { date, status: "home", fixes: 0, via: "mac" };
  }
  return out;
}

/**
 * Cells where the phone charges overnight (01:00-06:00) on `minNights` distinct nights: places he sleeps. Used as home
 * alongside the known home place, so a move or a stale place file does not turn every night into "out".
 */
export function sleepCells(fixes, { minNights = 3 } = {}) {
  const nights = new Map();
  for (const f of fixes) {
    const h = new Date(f.at).getHours();
    if (!f.charging || h < 1 || h >= 6) continue;
    const key = `${f.lat.toFixed(3)},${f.lon.toFixed(3)}`;
    nights.set(key, (nights.get(key) ?? new Set()).add(eveningOf(f.at)));
  }
  return [...nights.entries()].filter(([, s]) => s.size >= minNights).map(([key]) => key);
}

/** Median night minute of a list of episodes' starts and ends. */
export const typicalSpan = (eps) => ({ start: median(eps.map((e) => e.start)), end: median(eps.map((e) => e.end)) });
