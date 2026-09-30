// One to-do list (2026-09-30). Nick: "the orion one is different from one i had
// on my phone so when i asked orion to plan out my day based off my todo list it
// was also looking at my groceries." ORION's apps show the "Orion" Reminders
// list; Siri and the phone drop new reminders on the default "Reminders" list;
// and ORION's planner read every list at once (Groceries, a Family packing list).
// Now the to-do list is one list (config.todoList), ORION plans from it alone,
// and anything that lands on a sweep list (config.sweepLists) is moved onto it.

const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Decide what a sweep does, without doing it.
 * @param reminders open reminders: [{ identifier, title, list, due? }]
 * @returns [{ op: "move" | "complete-duplicate", identifier, title, from }]
 */
export function planSweep(reminders, { todoList = "Orion", sweepLists = ["Reminders"] } = {}) {
  const target = norm(todoList);
  const from = new Set(sweepLists.map(norm));
  const onTarget = new Set(reminders.filter((r) => norm(r.list) === target).map((r) => norm(r.title)));
  const steps = [];
  for (const r of reminders) {
    if (!from.has(norm(r.list)) || norm(r.list) === target) continue;
    if (onTarget.has(norm(r.title))) {
      // Already on the to-do list: tick the stray copy off (reopenable) rather than keep two.
      steps.push({ op: "complete-duplicate", identifier: r.identifier, title: r.title, from: r.list });
    } else {
      steps.push({ op: "move", identifier: r.identifier, title: r.title, from: r.list });
      onTarget.add(norm(r.title));
    }
  }
  return steps;
}

/** Carry out a sweep through the bridge; returns one line per change. */
export async function sweep(bridge, config) {
  const all = JSON.parse((await bridge("list_incomplete_reminders", {})).reminders_json ?? "[]");
  const done = [];
  for (const step of planSweep(all, config)) {
    if (step.op === "move") await bridge("move_reminder", { identifier: step.identifier, list: config.todoList });
    else await bridge("complete_reminder", { identifier: step.identifier });
    done.push(step.op === "move" ? `moved "${step.title}" from ${step.from} to ${config.todoList}`
      : `ticked off a duplicate "${step.title}" on ${step.from} (it is already on ${config.todoList})`);
  }
  return done;
}
