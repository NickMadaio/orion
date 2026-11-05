import { updateReminders } from "./reminder-store.js";
export async function addTimerEntry(file, seconds, label, now = Date.now()) {
    let made;
    await updateReminders(file, (list) => {
        let stamp = now;
        while (list.some((entry) => entry.id === `t${stamp.toString(36).slice(-5)}`))
            stamp += 1;
        made = { id: `t${stamp.toString(36).slice(-5)}`, kind: "timer", label, dueAt: now + seconds * 1000, createdAt: now };
        const keep = list.filter((entry) => entry.repeat || entry.place || entry.firedAt || entry.dueAt > now);
        return [...keep, made];
    });
    return made;
}
