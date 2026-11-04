// The one order every to-do list is read in, on the JS side (2026-11-04). The Swift twin is
// MobileCore.TodoOrdering; tests/fixtures/todo-order.json holds the order both must give.
//
//   open before done; overdue first; then high, medium, low, none; inside the same priority the
//   earlier due first (undated last); then his manual order (the notes' "Order:" line); then title.
//
// Priority arrives in more than one spelling (the bridge says "high", EventKit says 1...9 with 1
// highest and 0 unset, the composer says "!!!" or "p1"). A missing or unreadable one is NONE, the
// lowest: it was never the top.

const WORDS = new Map([["high", 3], ["h", 3], ["urgent", 3], ["p1", 3], ["!!!", 3], ["!!!!", 3],
  ["medium", 2], ["med", 2], ["m", 2], ["p2", 2], ["!!", 2],
  ["low", 1], ["l", 1], ["p3", 1], ["!", 1]]);

/** 3 high, 2 medium, 1 low, 0 none. */
export function priorityLevel(value) {
  if (typeof value === "number") return value >= 1 && value <= 4 ? 3 : value === 5 ? 2 : value >= 6 && value <= 9 ? 1 : 0;
  return WORDS.get(String(value ?? "").trim().toLowerCase()) ?? 0;
}

/** When it is due, as a time. A date-only due (local midnight or 23:59) is due at the END of that day. */
export function dueTime(todo) {
  const raw = todo.due ?? todo.dueDate;
  if (!raw) return null;
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) d.setHours(23, 59, 0, 0);
  return d.getTime();
}

export const isOverdue = (todo, now = new Date()) => {
  const due = dueTime(todo);
  return !todo.done && due !== null && due < new Date(now).getTime();
};

const manual = (todo) => {
  const m = /^\s*order:\s*(-?\d+(?:\.\d+)?)\s*$/im.exec(String(todo.notes ?? ""));
  return m ? Number(m[1]) : null;
};

/** Open to-dos in display order, then done ones. Returns a new array. */
export function orderTodos(todos, now = new Date()) {
  const key = (t) => ({ t, done: !!t.done, late: isOverdue(t, now), level: priorityLevel(t.priority), due: dueTime(t), order: manual(t) });
  const nullsLast = (a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b);
  return todos.map(key).sort((a, b) =>
    Number(a.done) - Number(b.done) || Number(b.late) - Number(a.late) || b.level - a.level
    || nullsLast(a.due, b.due) || nullsLast(a.order, b.order)
    || String(a.t.title ?? "").localeCompare(String(b.t.title ?? ""), undefined, { sensitivity: "base" })
    || String(a.t.identifier ?? a.t.id ?? "").localeCompare(String(b.t.identifier ?? b.t.id ?? ""))).map((k) => k.t);
}
