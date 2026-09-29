// Fold merged events into one state the Mac can write into ORION's files (life-sync-apply).
const NOTE_FILE = /^[a-z0-9-]+\.md$/;

export function applyEvents(state, events) {
  let next = { captures: [...(state.captures ?? [])], reminders: { ...(state.reminders ?? {}) },
               tracking: [...(state.tracking ?? [])], notes: { ...(state.notes ?? {}) },
               applied: [...(state.applied ?? [])], ...(state.lastPlanChange ? { lastPlanChange: state.lastPlanChange } : {}) };
  const done = new Set(next.applied);
  for (const e of events) {
    if (done.has(e.id)) continue;
    const p = e.payload ?? {};
    switch (e.kind) {
      case "capture.add": next = { ...next, captures: [...next.captures, p.text] }; break;
      case "reminder.add":
        if (p.id && !next.reminders[p.id]) next = { ...next, reminders: { ...next.reminders, [p.id]: { id: p.id, title: p.title, due: p.due ?? null, done: false } } };
        break;
      case "reminder.complete":
        if (next.reminders[p.id]) next = { ...next, reminders: { ...next.reminders, [p.id]: { ...next.reminders[p.id], done: true } } };
        break;
      case "reminder.update":
        if (next.reminders[p.id]) {
          const r = next.reminders[p.id];
          next = { ...next, reminders: { ...next.reminders, [p.id]: { ...r, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.due !== undefined ? { due: p.due } : {}) } } };
        }
        break;
      case "tracking.log": next = { ...next, tracking: [...next.tracking, p] }; break;
      case "note.append":
        if (typeof p.file === "string" && NOTE_FILE.test(p.file)) next = { ...next, notes: { ...next.notes, [p.file]: [...(next.notes[p.file] ?? []), p.line] } };
        break;
      case "plan.change": next = { ...next, lastPlanChange: p }; break;
      default: continue;
    }
    done.add(e.id);
    next = { ...next, applied: [...next.applied, e.id] };
  }
  return next;
}
