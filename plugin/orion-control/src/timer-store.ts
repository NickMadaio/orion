/* Writes one timer into the reminder store, the same entry orion_task_run's timer_set writes (executors.ts), so the app's clock fires it. */
import type { Reminder } from "./ambient.js";
import { updateReminders } from "./reminder-store.js";

export async function addTimerEntry(file: string, seconds: number, label: string, now = Date.now()): Promise<Reminder> {
  let made!: Reminder;
  await updateReminders(file, (list) => {
    let stamp = now;
    while (list.some((entry) => entry.id === `t${stamp.toString(36).slice(-5)}`)) stamp += 1;
    made = { id: `t${stamp.toString(36).slice(-5)}`, kind: "timer", label, dueAt: now + seconds * 1000, createdAt: now };
    const keep = list.filter((entry) => entry.repeat || entry.place || entry.firedAt || entry.dueAt > now);
    return [...keep, made];
  });
  return made;
}
