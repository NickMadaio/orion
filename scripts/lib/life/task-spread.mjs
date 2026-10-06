// Spreading a to-do across his days before it is due (2026-10-06).
//
// Nick: to-dos don't need to be scheduled one by one; each has a due date and a
// description of how to spread it ("2 hours a day until it's due", "two 2-hour
// blocks, Tuesday and Thursday", "four 1-hour blocks this week"), and ORION
// plans from that, the due date and the priority. Pure: dates are YYYY-MM-DD.

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?s?\b/gi;
const number = (w) => (/^\d+(\.\d+)?$/.test(w) ? Number(w) : WORDS[w.toLowerCase()]);

/** "2 hours", "90 min", "1.5h", "an hour and a half", "2-hour" → minutes, or null. */
export function minutesIn(text) {
  const t = String(text).toLowerCase();
  let m = /(\d+(?:\.\d+)?|an?|one|two|three|four|five|half)[\s-]*(?:hours?|hrs?|h)\b(?:\s+and\s+(a\s+half|\d+\s*(?:min|minutes?)))?/.exec(t);
  if (m) return Math.round(number(m[1]) * 60 + (m[2] ? (/half/.test(m[2]) ? 30 : parseInt(m[2], 10)) : 0));
  m = /(\d+)[\s-]*(?:minutes?|mins?|m)\b/.exec(t);
  return m ? Number(m[1]) : null;
}

function weekdaysIn(text) {
  return [...String(text).matchAll(DAY_RE)].map((m) => {
    const k = m[1].toLowerCase().slice(0, 3);
    return WEEKDAYS.findIndex((d) => d.startsWith(k));
  }).filter((d) => d >= 0);
}

/**
 * How he wants it spread, or null when the description says nothing about it.
 * → { kind: "daily", minutes }
 * | { kind: "sessions", sessions: [{ minutes, weekday? }], thisWeek }
 * | { kind: "total", minutes }
 */
export function parseSpread(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.toLowerCase();
  const thisWeek = /\bthis week\b/.test(t);
  // "2 hours a day", "30 min every day", "1h daily"
  if (/\b(a|per|each|every)\s+day\b|\bdaily\b|\bevery\s*day\b/.test(t)) {
    const minutes = minutesIn(t);
    return minutes ? { kind: "daily", minutes } : null;
  }
  // "2 hours on tuesday, 2 hours on thursday" — a length next to each day
  const perDay = [...t.matchAll(/([\w.]+[\s-]*(?:hours?|hrs?|h|minutes?|mins?)\b(?:\s+and\s+a\s+half)?)\s+(?:on\s+)?((?:sun|mon|tue|wed|thu|fri|sat)\w*)/g)];
  if (perDay.length >= 1 && perDay.every((m) => minutesIn(m[1]))) {
    return { kind: "sessions", thisWeek, sessions: perDay.map((m) => ({ minutes: minutesIn(m[1]), weekday: weekdaysIn(m[2])[0] })) };
  }
  // "two 2-hour blocks", "four 1 hour sessions", "3x 45 min"
  const count = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x\s*)?([\w.]+[\s-]*(?:hours?|hrs?|h|minutes?|mins?))\s*(?:blocks?|sessions?|chunks?|times?)?/.exec(t)
    ?? /\b(\d+)\s*x\s*([\w.]+[\s-]*(?:hours?|hrs?|h|minutes?|mins?))/.exec(t);
  if (count && /blocks?|sessions?|chunks?|times?|\bx\b/.test(t)) {
    const n = number(count[1]); const minutes = minutesIn(count[2]);
    if (n && minutes) {
      const days = weekdaysIn(t);
      return { kind: "sessions", thisWeek, sessions: Array.from({ length: n }, (_, i) => ({ minutes, ...(days[i] !== undefined ? { weekday: days[i] } : {}) })) };
    }
  }
  // "5 hours total", "about 4 hours"
  if (/\btotal|in all|overall|about|roughly\b/.test(t)) {
    const minutes = minutesIn(t);
    if (minutes) return { kind: "total", minutes };
  }
  return null;
}

const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

/**
 * The sessions to book, by date, from today up to the due date.
 * The due date itself is included only when nothing else fits before it.
 * @returns [{ date, minutes }] (several on one date are merged into one block)
 */
export function planSessions(spread, { today, due, sessionCap = 120 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new TypeError("today must be YYYY-MM-DD");
  if (!spread) return [];
  const end = due && due >= today ? due : addDays(today, 6);
  const lastWorkDay = end > today ? addDays(end, -1) : today;
  const span = daysBetween(today, lastWorkDay) + 1;
  const weekEnd = addDays(today, (7 - weekdayOf(today)) % 7);   // through Sunday
  const out = [];
  if (spread.kind === "daily") {
    for (let i = 0; i < span; i += 1) out.push({ date: addDays(today, i), minutes: spread.minutes });
  } else if (spread.kind === "sessions") {
    const limit = spread.thisWeek && weekEnd < lastWorkDay ? weekEnd : lastWorkDay;
    const room = daysBetween(today, limit) + 1;
    const free = spread.sessions.filter((s) => s.weekday === undefined);
    for (const s of spread.sessions.filter((x) => x.weekday !== undefined)) {
      const date = addDays(today, (s.weekday - weekdayOf(today) + 7) % 7);
      if (date <= (due ?? limit)) out.push({ date, minutes: s.minutes });
    }
    free.forEach((s, i) => out.push({ date: addDays(today, Math.min(room - 1, Math.floor((i * room) / free.length))), minutes: s.minutes }));
  } else if (spread.kind === "total") {
    const pieces = Math.max(1, Math.ceil(spread.minutes / sessionCap));
    const per = Math.ceil(spread.minutes / pieces / 5) * 5;
    for (let i = 0; i < pieces; i += 1) out.push({ date: addDays(today, Math.min(span - 1, Math.floor((i * span) / pieces))), minutes: per });
  }
  const merged = new Map();
  for (const s of out) merged.set(s.date, (merged.get(s.date) ?? 0) + s.minutes);
  return [...merged].map(([date, minutes]) => ({ date, minutes })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * How it ranks when the day is full: his priority, then how close it is due.
 * → 0 must (high, or due today/tomorrow), 1 normal, 2 optional (low and not close).
 */
export function taskImportance({ priority, due }, today) {
  const close = due ? daysBetween(today, due) <= 1 : false;
  if (priority === "high" || close) return 0;
  if (priority === "low") return 2;
  return 1;
}

/**
 * Which still-open to-do this one waits for, from his notes (2026-10-06):
 * 'only schedule this once i have fully completed the "do cert courses" task',
 * 'Dont schedule unless "finish resume" is completed'. A to-do is named in
 * quotes or by its title, next to a condition (once/unless/until/after/only/
 * when … complete/done/finished). Returns the open title, or null.
 */
export function waitsFor(notes, openTitles) {
  const text = String(notes ?? "");
  if (!/\b(once|unless|until|after|only|when|before)\b/i.test(text) || !/\b(complete[ds]?|completed|done|finish(ed)?|over)\b/i.test(text)) return null;
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const said = [...text.matchAll(/["“”']([^"“”']{3,80})["“”']/g)].map((m) => norm(m[1]));
  const body = norm(text);
  return openTitles.find((title) => said.includes(norm(title)) || (norm(title).length >= 6 && body.includes(norm(title)))) ?? null;
}
