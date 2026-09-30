// How much study each day before a deadline (tighten-orion/deadline-ramp).
// Qwen's run stalled on the capping spill (minutes lost when the first day
// overflowed); finished by Claude, 2026-09-30.
export const NEEDS = Object.freeze({ exam: 600, quiz: 240, presentation: 300, essay: 480, assignment: 300, other: 120 });
const WINDOW = { exam: 10, quiz: 5, presentation: 6, essay: 8, assignment: 6, other: 3 };
const KIND_WORDS = [
  ["exam", ["exam", "final", "midterm"]], ["quiz", ["quiz", "test"]],
  ["presentation", ["presentation", "panopto", "slides"]], ["essay", ["essay", "report"]],
  ["assignment", ["assignment", "coursework", "submission", "due"]],
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function deadlineKind(title) {
  const lower = String(title ?? "").toLowerCase();
  for (const [kind, words] of KIND_WORDS) if (words.some((w) => new RegExp(`\\b${w}`).test(lower))) return kind;
  return "other";
}

const toUTC = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date, n) => fromUTC(toUTC(date) + n * 86_400_000);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
const round15 = (m) => Math.round(m / 15) * 15;

function spread(remaining, days) {
  // Little left: fewer, later days rather than 30-minute minimums that overshoot.
  const target = round15(remaining);
  if (days.length > 1 && days.length * 30 > target) return spread(remaining, days.slice(1));
  return spreadAll(remaining, days);
}

function spreadAll(remaining, days) {
  const weights = days.map((_, i) => i + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const target = round15(remaining);
  const raw = weights.map((w) => round15((remaining * w) / sum));
  const minutes = raw.map((m) => (m > 0 ? Math.max(30, m) : 0));
  const others = minutes.slice(0, -1).reduce((a, b) => a + b, 0);
  minutes[minutes.length - 1] = Math.max(0, target - others);
  return days.map((date, i) => ({ date, minutes: minutes[i] })).filter((d) => d.minutes > 0);
}

export function ramp(deadlines, { today, done = {}, horizonDays = 14, maxPerDay = 180 } = {}) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new TypeError("today must be YYYY-MM-DD");
  if (!Array.isArray(deadlines)) throw new TypeError("deadlines must be an array");
  const lastDay = addDays(today, horizonDays - 1);
  const byDate = new Map();
  const sorted = [...deadlines].sort((a, b) => (a.date === b.date ? String(a.title).localeCompare(String(b.title)) : a.date < b.date ? -1 : 1));
  for (const d of sorted) {
    const away = daysBetween(today, d.date);
    if (away <= 0 || away > horizonDays + 10) continue;
    const kind = deadlineKind(d.title);
    const remaining = Math.max(0, NEEDS[kind] - (done[d.id] ?? 0));
    if (remaining === 0) continue;
    const window = Math.min(WINDOW[kind], away);
    const studyDays = Array.from({ length: window }, (_, i) => addDays(d.date, i - window));
    const weekday = DAYS[new Date(toUTC(d.date)).getUTCDay()];
    const [, mm, dd] = d.date.split("-").map(Number);
    const reason = `${kind} on ${weekday} ${dd} ${MONTHS[mm - 1]} — ${remaining} min left`;
    for (const { date, minutes } of spread(remaining, studyDays)) {
      const items = byDate.get(date) ?? [];
      byDate.set(date, [...items, { id: d.id, title: d.title, minutes, reason }]);
    }
  }
  // Cap each day; the cut goes to the nearest earlier day with room, never lost.
  const dates = [...byDate.keys()].sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const items = byDate.get(dates[i]);
    const total = items.reduce((a, b) => a + b.minutes, 0);
    if (total <= maxPerDay + 15) continue;
    const scaled = items.map((it) => ({ ...it, minutes: Math.max(30, round15((it.minutes * maxPerDay) / total)) }));
    let cut = total - scaled.reduce((a, b) => a + b.minutes, 0);
    byDate.set(dates[i], scaled);
    for (let j = i - 1; j >= 0 && cut > 0; j--) {
      const earlier = byDate.get(dates[j]);
      const room = maxPerDay - earlier.reduce((a, b) => a + b.minutes, 0);
      if (room < 15) continue;
      const move = Math.min(cut, Math.floor(room / 15) * 15);
      const first = scaled[0];
      byDate.set(dates[j], [...earlier, { id: first.id, title: first.title, minutes: move, reason: first.reason }]);
      cut -= move;
    }
    if (cut > 0) {
      // Nowhere earlier has room: the minutes stay on this day rather than vanish.
      const kept = byDate.get(dates[i]);
      byDate.set(dates[i], kept.map((it, k) => (k === 0 ? { ...it, minutes: it.minutes + cut } : it)));
    }
  }
  return [...byDate.keys()].sort().filter((date) => date >= today && date <= lastDay).map((date) => {
    const merged = [];
    for (const it of byDate.get(date)) {
      const same = merged.find((m) => m.id === it.id);
      if (same) same.minutes += it.minutes; else merged.push({ ...it });
    }
    return { date, items: merged, total: merged.reduce((a, b) => a + b.minutes, 0) };
  });
}
