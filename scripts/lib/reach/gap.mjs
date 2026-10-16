// Ranking an open to-do for a gap. The "You're free until X" question itself moved to lib/curiosity/decide.mjs
// (2026-10-16 audit, finding 9: it ignored commutes and was priority-blind; the loop asks what he is up to instead).
import { classify } from "../life/live-day.mjs";
import { priorityOf } from "../life/priority.mjs";

const dayAfter = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

/** Classes > gym > deadlines/study > side project > rest (priority.mjs), a due date within 2 days first. */
export function rankTodo(todo, today) {
  const dueSoon = todo.dueDate && today && todo.dueDate <= dayAfter(today, 2) ? 0 : 1;
  return [dueSoon, priorityOf({ kind: classify(todo.title), title: todo.title }), String(todo.dueDate ?? "9999")];
}
