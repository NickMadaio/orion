// How his to-dos are ranked for the day (2026-11-04). Nick: "the first thing he wants me to do is my resume? That is very clearly not
// the highest priority item". The planner used to read ONLY whether a to-do was overdue (importance 0 or 1) and then kept his list
// order, so an 11-day-old medium "finish resume" led every day over high-priority and coursework items, and the morning brief
// (lib/life/morning-brief.mjs) never even passed the priority in. One ranking, in code, with a reason that can be said aloud.
//
// score = his priority + how close the deadline is + a nudge for coursework. How LONG a to-do has been overdue is deliberately not
// a score: staleness is not urgency (an 11-day-old item is more likely abandoned than on fire). Pure; dates are YYYY-MM-DD.

const PRIORITY = { high: 6, medium: 3, low: 1 };
const NO_PRIORITY = 2;
// Work for a class or an assignment: it has a real deadline somebody else set.
const COURSEWORK = /\b(lab|labs|assignment|homework|coursework|essay|quiz|exam|midterm|problem set|pset|revise|revision|presentation|report|worksheet|ae\d)\b/i;
const SCHOOL_TAG = /^tags:.*\b(school|uni|class|course)\b/im;

const toUTC = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const daysAway = (due, today) => Math.round((toUTC(due) - toUTC(today)) / 86_400_000);
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clock12 = (minute) => `${Math.floor(minute / 60) % 12 || 12}${minute % 60 ? `:${String(minute % 60).padStart(2, "0")}` : ""} ${minute < 720 ? "AM" : "PM"}`;
const WEEKDAY = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const SHORT_DATE = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const isCoursework = (todo) => COURSEWORK.test(String(todo.title ?? "")) || SCHOOL_TAG.test(String(todo.notes ?? "")) || (todo.tags ?? []).includes("school");

/** The deadline he (or his class) set, earliest wins: the to-do's own due date, or a calendar deadline that names it. */
function dueOf(todo, deadlines) {
  const named = deadlines.filter((d) => d?.date && norm(d.title).length >= 4 && (norm(d.title).includes(norm(todo.title)) || norm(todo.title).includes(norm(d.title))));
  const all = [...(todo.dueDate ? [todo.dueDate] : []), ...named.map((d) => d.date)].sort();
  return all[0] ?? null;
}

/** 0 for no deadline up to 6 for due today (still savable, unlike overdue); overdue is flat (4): it was missed, and how long ago is not a reason to do it first. */
function dueFactor(away, dueMinute) {
  if (away === null) return 0;
  if (away < 0) return 4;
  if (away === 0) return dueMinute !== null && dueMinute !== undefined && dueMinute < 17 * 60 ? 6.5 : 6;
  if (away === 1) return 3.5;
  if (away <= 3) return 2.5;
  if (away <= 7) return 1;
  return 0;
}

/** The deadline in words: "due tonight", "due today at 3 PM", "overdue since 2 Nov", "due Friday". */
function dueWords(away, due, dueMinute) {
  if (away === null) return null;
  if (away < 0) return `overdue since ${SHORT_DATE(due)}`;
  if (away === 0) return dueMinute !== null && dueMinute !== undefined && dueMinute < 17 * 60 ? `due today at ${clock12(dueMinute)}` : "due tonight";
  if (away === 1) return "due tomorrow";
  if (away <= 6) return `due ${WEEKDAY(due)}`;
  return `due ${SHORT_DATE(due)}`;
}

/**
 * Rank today's to-dos, most urgent first.
 * @param todos [{ title, priority?: "high"|"medium"|"low", dueDate?: "YYYY-MM-DD", dueMinute?: number, notes?, tags?, minutes? }]
 * @param ctx   { today: "YYYY-MM-DD", deadlines?: [{ title, date }] } (deadlines: his classes' and assignments' calendar deadlines)
 * @returns the same to-dos, each with { score, reason, why: string[], rank } and never mutated.
 */
export function rankTodos(todos, { today, deadlines = [] }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new TypeError("today must be YYYY-MM-DD");
  const scored = todos.map((todo, index) => {
    const due = dueOf(todo, deadlines);
    const away = due ? daysAway(due, today) : null;
    const dueMinute = due === todo.dueDate ? todo.dueMinute ?? null : null;
    const priority = PRIORITY[todo.priority] ?? NO_PRIORITY;
    const course = isCoursework(todo);
    const bonus = course ? 1.5 : 0;
    const score = priority + dueFactor(away, dueMinute) + bonus;
    const why = [dueWords(away, due, dueMinute), todo.priority === "high" ? "high priority" : null,
      course && (away !== null && away <= 7) ? "coursework" : null].filter(Boolean);
    const reason = why.length ? why.join(" and ") : (todo.priority === "low" ? "low priority with no deadline" : "no deadline, so it sits behind what is due");
    return { ...todo, score, reason, why, index, away: away ?? 9999 };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.away - b.away || a.index - b.index)
    .map(({ index, away, ...rest }, i) => ({ ...rest, rank: i + 1 }));
}

/** "Finish resume is first because it's due tonight and high priority." */
export function firstBecause(ranked) {
  const top = ranked[0];
  if (!top) return null;
  const what = String(top.title).replace(/^./, (c) => c.toUpperCase());
  return top.why.length ? `${what} is first because it's ${top.why.join(" and ")}.` : `${what} is first because nothing on my list is more urgent: ${top.reason}.`;
}

/** Why `item` sits behind the one ahead of it, in a sentence. */
export function behindBecause(ranked, item) {
  const at = ranked.findIndex((r) => norm(r.title) === norm(item.title));
  if (at <= 0) return null;
  const ahead = ranked[at - 1];
  return `${item.title} is behind ${ahead.title} because ${item.why.length ? `it's only ${item.why.join(" and ")}` : item.reason}, and ${ahead.title} is ${ahead.why.join(" and ") || ahead.reason}.`;
}
