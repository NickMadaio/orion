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

/** The cell he spent longest in: each still fix stands for the time until the next one (at most an hour). */
const dwellCell = (rows) => {
  const still = rows.map((r, i) => ({ r, w: Math.min(60, Math.max(1, (rows[i + 1]?.m ?? r.m + 1) - r.m)) })).filter(({ r }) => !MOVING.includes(r.motion));
  const counts = (still.length ? still : rows.map((r) => ({ r, w: 1 }))).reduce((m, { r, w }) => m.set(cellOf(r.lat, r.lon), (m.get(cellOf(r.lat, r.lon)) ?? 0) + w), new Map());
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Distinct moments in a run: fixes at least 5 min apart (the phone sends each sample twice). */
const distinctTimes = (rows) => rows.reduce((acc, r) => (acc.length && r.m - acc.at(-1) < 5 ? acc : [...acc, r.m]), []).length;

/** Runs of consecutive away fixes; each ends at the next home fix (he got home) or its own last fix (open). */
function awayRuns(rows) {
  const runs = [];
  let run = null, lastHome = null;
  for (const r of rows) {
    if (!r.home) { run = run ?? { rows: [], homeBefore: lastHome }; run.rows.push(r); continue; }
    if (run) { runs.push({ ...run, homeAt: r.m }); run = null; }
    lastHome = r.m;
  }
  if (run) runs.push({ ...run, homeAt: null });
  return runs.map((x) => ({ start: x.rows[0].m, end: x.homeAt ?? x.rows.at(-1).m, returnedHome: x.homeAt !== null, homeBefore: x.homeBefore,
    cell: dwellCell(x.rows), fixes: x.rows.length, distinct: distinctTimes(x.rows) }));
}

const overlaps = (a, b) => a.start < b.to && a.end > b.from;
const SMALL_HOURS = Object.freeze({ from: 24 * 60, to: 28 * 60 });   // 00:00-04:00
const LATE_START = 25 * 60, ASLEEP_LOOKBACK = 120;

/**
 * What a run is worth. strong: 2+ distinct fixes over an hour into the night. sparse: 2+ distinct fixes, short, but away
 * in the small hours (the phone reports rarely at night: 01:31-01:49 away is a night out). weak: one fix only, kept
 * for the learner to use only with corroboration (his words, a night-out event, a late wake). null: not an evening out.
 */
function grade(r) {
  if (!(r.start < NIGHT.to && r.end >= NIGHT.from)) return null;
  if (r.distinct >= 2 && r.end - r.start >= MIN_AWAY) return "strong";
  if (r.distinct >= 2 && overlaps(r, SMALL_HOURS)) return "sparse";
  return "weak";   // a lone fix (or a short pair) in the night
}

/** A run starting after 01:00 just after he was home or asleep (a home fix, the Mac in use, WHOOP asleep) is drift, not a night out. */
function afterSleep(r, { date, rows, sessions, sleeps }) {
  if (r.start < LATE_START) return false;
  const from = r.start - ASLEEP_LOOKBACK;
  if (rows.some((x) => x.home && x.m >= from && x.m < r.start)) return true;
  if (sessions.some((s) => { const b = nightMinute(s.end, date), a = nightMinute(s.start, date); return a < r.start && b >= from; })) return true;
  return sleeps.some((t) => { const m = nightMinute(t, date); return m >= 21 * 60 && m <= r.start; });
}

/**
 * @param fixes     fixesOf(phoneSignals)
 * @param isHome    (fix) => boolean
 * @param sessions  focus sessions [{ start, end }] (he was at the Mac)
 * @param sleeps    times he fell asleep (WHOOP), ISO
 * @returns { [eveningDate]: { date, status: "out"|"home"|"unknown", grade?, start, end, cell, returnedHome, fixes } }
 */
export function eveningEpisodes(fixes, { isHome, sessions = [], sleeps = [] }) {
  const byEvening = new Map();
  for (const f of fixes) {
    const date = eveningOf(f.at);
    const m = nightMinute(f.at, date);
    if (m < EVENING.from || m >= EVENING.to) continue;
    byEvening.set(date, [...(byEvening.get(date) ?? []), { ...f, m, home: isHome(f) }]);
  }
  const out = {};
  const rank = { strong: 0, sparse: 1, weak: 2 };
  for (const [date, rows] of byEvening) {
    const runs = awayRuns(rows).map((r) => ({ ...r, grade: grade(r) })).filter((r) => r.grade && !afterSleep(r, { date, rows, sessions, sleeps }));
    const best = runs.sort((a, b) => rank[a.grade] - rank[b.grade] || (b.end - b.start) - (a.end - a.start))[0];
    const homeCore = rows.filter((r) => r.home && r.m >= CORE.from && r.m < CORE.to).map((r) => r.m);
    const atMac = sessions.some((s) => { const a = nightMinute(s.start, date), b = nightMinute(s.end, date); return a < CORE.to && b > CORE.from; });
    const awayCore = rows.some((r) => !r.home && r.m >= CORE.from && r.m < CORE.to);
    // home: seen at home across the core of the night, or home before 23:00 and again after 01:00 with nothing away between
    const homes = rows.filter((r) => r.home);
    const bracket = homes.some((a) => a.m <= 23 * 60 && homes.some((b) => b.m >= 25 * 60 && !rows.some((x) => !x.home && x.m > a.m && x.m < b.m)));
    const seenHome = (homeCore.length >= 2 && Math.max(...homeCore) - Math.min(...homeCore) >= HOME_SPREAD) || bracket || (atMac && !awayCore);
    if (best && best.grade !== "weak") { out[date] = { date, status: "out", ...best }; continue; }
    out[date] = { date, status: seenHome ? "home" : "unknown", fixes: rows.length, ...(best ? { weak: best } : {}) };
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

/**
 * Cells (3 decimals) where the phone sits in the core of the night on most evenings: where he lives, even when no home
 * place is known. A cell seen on at least `minEvenings` evenings, on `minWeekdays` different weekdays (a club every Friday and
 * Saturday is not home) and on half of the evenings with core fixes is home-like.
 */
export function habitualCells(fixes, { minEvenings = 4, minWeekdays = 4, share = 0.5 } = {}) {
  const seen = new Map(), evenings = new Set();
  for (const f of fixes) {
    const date = eveningOf(f.at), m = nightMinute(f.at, date);
    if (m < CORE.from || m >= CORE.to) continue;
    evenings.add(date);
    const key = `${f.lat.toFixed(3)},${f.lon.toFixed(3)}`;
    seen.set(key, (seen.get(key) ?? new Set()).add(date));
  }
  const weekdays = (dates) => new Set([...dates].map((d) => new Date(`${d}T12:00:00`).getDay())).size;
  return [...seen.entries()].filter(([, d]) => d.size >= minEvenings && weekdays(d) >= minWeekdays && d.size >= share * evenings.size).map(([k]) => k);
}
