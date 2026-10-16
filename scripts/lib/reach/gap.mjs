// "You're free until X" questions (2026-10-16 audit, finding 9): 14 of 46 messages, the most frequent
// and the least purposeful. They ignored commutes ("free until 1:30" 33 min before a 12:45 departure),
// were priority-blind (a side project over "finish resume") and "until 9:00 PM" was a hard-coded cap.
import { classify } from "../life/live-day.mjs";
import { priorityOf } from "../life/priority.mjs";

const MIN_FREE = 60;          // under an hour after the commute is not worth a question
const MAX_PER_DAY = 2;        // and he is not asked again about an ignored task
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const dayAfter = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

/** Classes > gym > deadlines/study > side project > rest (priority.mjs), a due date within 2 days first. */
export function rankTodo(todo, today) {
  const dueSoon = todo.dueDate && today && todo.dueDate <= dayAfter(today, 2) ? 0 : 1;
  return [dueSoon, priorityOf({ kind: classify(todo.title), title: todo.title }), String(todo.dueDate ?? "9999")];
}
const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

/**
 * @returns { key, text } | null
 */
export function gapQuestion(ctx, { hm, bed }) {
  // A task already asked about today is not asked again: the next best one is, or nothing.
  const open = (ctx.todos ?? []).filter((t) => !t.booked && !t.waiting && !ctx.sent?.[`gap-${slug(t.title)}`]);
  const blocks = ctx.day ?? [];
  if (!open.length || ctx.minute < 9 * 60 || ctx.minute > 20 * 60 + 30) return null;
  if (Object.keys(ctx.sent ?? {}).filter((k) => k.startsWith("gap-")).length >= MAX_PER_DAY) return null;
  const inBlock = blocks.some((b) => b.start <= ctx.minute && b.end > ctx.minute);
  const inTravel = (ctx.travel ?? []).some((w) => w.start <= ctx.minute && w.end > ctx.minute);
  if (inBlock || inTravel) return null;
  const nextBlock = blocks.filter((b) => b.start > ctx.minute).sort((a, b) => a.start - b.start)[0];
  // The free window ends at the next block OR the start of the next commute, whichever is first.
  const nextWall = (ctx.travel ?? []).filter((w) => w.start > ctx.minute).sort((a, b) => a.start - b.start)[0];
  const limit = Math.min(nextBlock?.start ?? Infinity, nextWall?.start ?? Infinity);
  const until = Number.isFinite(limit) ? limit : (bed > ctx.minute ? bed : 24 * 60);
  if (until - ctx.minute < MIN_FREE) return null;
  const pick = [...open].sort((a, b) => compare(rankTodo(a, ctx.today), rankTodo(b, ctx.today)))[0];
  const when = Number.isFinite(limit) ? `You're free until ${hm(limit)}.` : "Nothing else is planned today.";
  return { key: `gap-${slug(pick.title)}`, text: `${when} Want me to put ${pick.title} there?` };
}
