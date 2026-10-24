// Routines from evidence (pure). A routine is a (weekday, time window, place or activity) that recurred: at least
// MIN_OCCURRENCES times on the same weekday within WINDOW_DAYS. Each weekday date is a hit, a miss (seen home, or he said
// no) or unknown (no evidence: never counted against it). Confidence weights recent weeks more and falls when a week breaks.
import { WEEKDAYS, addDays, clock, daysBetween, eveningOf, median, weekdayOf } from "./time.mjs";

export const WINDOW_DAYS = 42, MIN_OCCURRENCES = 3, CONFIDENT = 0.55, HALF_LIFE_WEEKS = 3, PRIOR_MISS = 0.5, STALE_DAYS = 28;

const weightOf = (date, today) => 0.5 ** (daysBetween(date, today) / 7 / HALF_LIFE_WEEKS);
const round2 = (x) => Math.round(x * 100) / 100;

/** Confidence from hit and miss dates: recency-weighted hits over hits + misses + a small prior. */
export function confidenceOf(hits, misses, today) {
  const h = hits.reduce((a, d) => a + weightOf(d, today), 0), m = misses.reduce((a, d) => a + weightOf(d, today), 0);
  return h + m === 0 ? 0 : round2(h / (h + m + PRIOR_MISS));
}

export function statusOf({ occurrences, confidence, lastHit, today }) {
  if (occurrences < 2) return null;
  if (occurrences < MIN_OCCURRENCES) return "tentative";
  if (confidence < CONFIDENT || daysBetween(lastHit, today) > STALE_DAYS) return "faded";
  return "confident";
}

const modeOf = (xs) => [...xs.filter(Boolean).reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const datesOn = (weekday, from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (weekdayOf(d) === weekday) out.push(d); return out; };

/** His words for it, the most frequent specific one ("club" over a bare "out"); null when he never named it. */
function hisLabel(labels) {
  const specific = modeOf(labels.filter((l) => l && l !== "out"));
  return specific ?? (labels.includes("out") ? "out" : null);
}

function describe({ weekday, start, end, cell, placeName }) {
  const where = cell ? ` ${placeName?.(cell) ?? `near ${cell}`}` : "";
  return `out ${WEEKDAYS[weekday].slice(0, 3)} ~${clock(start)}–${clock(end)},${where}`.replace(/,$/, "");
}

/** One weekday's evenings: the outcome of each date and why. */
function eveningOutcomes(dates, { evenings, said, corroborations, lateWake }) {
  return dates.map((date) => {
    const ep = evenings[date];
    const words = said.filter((s) => s.date === date);
    const no = words.some((s) => s.polarity < 0), yes = words.some((s) => s.polarity > 0);
    const event = corroborations.find((c) => c.date === date);
    const labels = [...words.filter((s) => s.polarity > 0).map((s) => s.label), ...(event ? [event.label] : [])];
    const phone = (e, extra) => ({ date, outcome: "hit", start: e.start, end: e.end, cell: e.cell, returnedHome: e.returnedHome, labels, ...(e.grade === "sparse" ? { sparse: true } : {}), ...extra });
    if (ep?.status === "out" && !no) return phone(ep, { via: [ep.grade === "sparse" ? "phone-sparse" : "phone", ...(yes ? ["said"] : [])] });
    // one away fix alone proves nothing; with his words, a night-out event or a late wake next morning it is a night out
    const backing = [yes && "said", event && "calendar", lateWake(date) && "late-wake"].filter(Boolean);
    if (ep?.weak && !no && backing.length) return phone(ep.weak, { via: ["phone-weak", ...backing], sparse: true });
    if (yes && !no) return { date, outcome: "hit", via: ["said"], labels };
    if (no) return { date, outcome: "miss", via: ["said-no"] };
    if (ep?.status === "home") return { date, outcome: "miss", via: [ep.via === "mac" ? "mac" : "phone-home"] };
    return { date, outcome: "unknown" };
  });
}

export const START_SPREAD = 120;

/** The largest group of starts within START_SPREAD minutes of each other. */
function bestCluster(list) {
  const s = [...list].sort((a, b) => a.start - b.start);
  let best = [];
  for (let i = 0; i < s.length; i++) { const g = s.filter((x) => x.start >= s[i].start && x.start - s[i].start <= START_SPREAD); if (g.length > best.length) best = g; }
  return best;
}

/**
 * Only evenings of the same shape are one routine: timed hits whose starts fall outside the main cluster (a 17:30 dinner and
 * a 23:00 club) become "unknown", never a median across both. A sparse hit (times are rough) only has to overlap the cluster.
 */
export function clusterHits(outcomes) {
  const timed = outcomes.filter((o) => o.outcome === "hit" && Number.isFinite(o.start));
  const firm = timed.filter((o) => !o.sparse);
  const core = bestCluster(firm.length ? firm : timed);
  if (!core.length) return outcomes;
  const from = Math.min(...core.map((o) => o.start)) - 60, to = Math.max(...core.map((o) => o.end)) + 60;
  const keep = (o) => core.includes(o) || (o.sparse && firm.length && o.start < to && o.end > from);
  return outcomes.map((o) => (timed.includes(o) && !keep(o) ? { date: o.date, outcome: "unknown", via: ["other-shape"] } : o));
}

function routineFrom({ id, kind, weekday, outcomes: raw, today, wakes, placeName, fixedLabel = null }) {
  const outcomes = clusterHits(raw);
  const timedFirm = outcomes.some((o) => o.outcome === "hit" && Number.isFinite(o.start) && !o.sparse);
  const hits = outcomes.filter((o) => o.outcome === "hit"), misses = outcomes.filter((o) => o.outcome === "miss");
  const occurrences = hits.length;
  const confidence = confidenceOf(hits.map((o) => o.date), misses.map((o) => o.date), today);
  const lastHit = hits.map((o) => o.date).sort().at(-1) ?? null;
  const status = statusOf({ occurrences, confidence, lastHit, today });
  if (!status) return null;
  const timed = hits.filter((o) => Number.isFinite(o.start) && (!timedFirm || !o.sparse));   // rough sparse times stay out of the medians
  const start = median(timed.map((o) => o.start)), end = median(timed.map((o) => o.end));
  const cells = timed.map((o) => o.cell).filter(Boolean);
  const cell = cells.length && cells.filter((c) => c === modeOf(cells)).length * 2 >= cells.length ? modeOf(cells) : null;
  const words = fixedLabel ?? hisLabel(hits.flatMap((o) => o.labels ?? []));
  const label = words ?? (start === null ? null : describe({ weekday, start, end, cell, placeName }));
  const nextWake = median(hits.map((o) => wakes[addDays(o.date, 1)]));
  const others = Object.entries(wakes).filter(([d]) => !hits.some((o) => addDays(o.date, 1) === d)).map(([, m]) => m);
  return {
    id, kind, weekday, weekdayName: WEEKDAYS[weekday], start, end, cell, label, labelSource: words ? "his words" : label ? "described" : null,
    confidence, status, occurrences, misses: misses.length, lastHit,
    ...(kind === "away-evening" ? { returnHome: median(timed.filter((o) => o.returnedHome).map((o) => o.end)), nextWake, usualWake: median(others) } : {}),
    evidence: outcomes.filter((o) => o.outcome !== "unknown").map(({ labels: _l, ...o }) => o),
  };
}

/**
 * @param evenings   eveningEpisodes() output, by evening date
 * @param statements statementEvidence() rows plus routine answers ({ date, polarity, label })
 * @param activities logged / calendar rows he did: [{ date, label, start, end, source }]
 * @param wakes      { date: wake minute }
 * @param placeName  (cell) => a known place's name, or null
 * @returns routines, most confident first
 */
export const LATE_WAKE = 90;   // minutes later than his usual wake

export function learnRoutines({ evenings = {}, statements = [], activities = [], corroborations = [], wakes = {}, now = new Date(), placeName = null }) {
  const today = eveningOf(now);
  const from = addDays(today, -WINDOW_DAYS + 1);
  // evenings learn only from statements about going out ("going out to the club"), never "I'm at the library"
  const usual = median(Object.values(wakes));
  const lateWake = (date) => usual !== null && Number.isFinite(wakes[addDays(date, 1)]) && wakes[addDays(date, 1)] >= usual + LATE_WAKE;
  const said = statements.filter((s) => s.date >= from && s.date <= today && s.goingOut === true);
  const routines = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const outcomes = eveningOutcomes(datesOn(weekday, from, today), { evenings, said, corroborations, lateWake });
    const r = routineFrom({ id: `evening-out-${weekday}`, kind: "away-evening", weekday, outcomes, today, wakes, placeName });
    if (r) routines.push(r);
  }
  // daytime things he logged or told an ask about ("was at the gym"), per label and weekday
  // only what he logged or said he did; a calendar row is a plan, never a completion
  const done = [...activities.filter((a) => a.source !== "calendar"), ...statements.filter((s) => s.source === "answer" && s.polarity > 0 && s.label !== "out" && Number.isFinite(s.start) && s.start < 17 * 60)]
    .filter((a) => a.date >= from && a.date <= today && a.label);
  const loggedDays = new Set(activities.filter((a) => a.source !== "calendar").map((a) => a.date));
  for (const label of new Set(done.map((a) => a.label))) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const outcomes = datesOn(weekday, from, today).map((date) => {
        const row = done.filter((a) => a.label === label && a.date === date);
        if (row.length) return { date, outcome: "hit", via: [...new Set(row.map((a) => a.source))], start: median(row.map((a) => a.start)), end: median(row.map((a) => a.end)) };
        return loggedDays.has(date) ? { date, outcome: "miss", via: ["logged-other"] } : { date, outcome: "unknown" };
      });
      const r = routineFrom({ id: `activity-${label.replace(/[^a-z0-9]+/g, "-")}-${weekday}`, kind: "activity", weekday, outcomes, today, wakes: {}, placeName, fixedLabel: label });
      if (r) routines.push(r);
    }
  }
  const rank = { confident: 0, faded: 1, tentative: 2 };
  return routines.sort((a, b) => rank[a.status] - rank[b.status] || b.confidence - a.confidence);
}
