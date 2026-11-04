const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GROUPS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };
export const daysOf = (group) => [...(GROUPS[group] ?? [])];
const parseTime = (time) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ""));
    if (!m)
        return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h <= 23 && mi <= 59 ? [h, mi] : null;
};
/** The first moment strictly after `after` on one of the days at the time; null when the repeat is not valid. */
export function nextOccurrence(repeat, after) {
    const t = parseTime(repeat?.time);
    const days = Array.isArray(repeat?.days) ? repeat.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    const from = after instanceof Date ? after.getTime() : Number(after);
    if (!t || !days.length || !Number.isFinite(from))
        return null;
    const base = new Date(from);
    for (let i = 0; i <= 8; i++) {
        const at = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, t[0], t[1], 0, 0);
        if (days.includes(at.getDay()) && at.getTime() > from)
            return at.getTime();
    }
    return null;
}
const same = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);
export const clock12 = (time) => { const [h, m] = parseTime(time) ?? [0, 0]; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** "every Monday at 9:00 AM", "every weekday at 8:00 AM", "every day at 9:30 PM". */
export function describeRepeat(repeat) {
    const days = [...new Set(repeat.days)].sort((a, b) => a - b);
    const when = clock12(repeat.time);
    if (same(days, GROUPS.daily))
        return `every day at ${when}`;
    if (same(days, GROUPS.weekdays))
        return `every weekday at ${when}`;
    if (same(days, GROUPS.weekends))
        return `every weekend at ${when}`;
    const names = days.map((d) => NAMES[d]);
    return `every ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]} at ${when}`;
}
