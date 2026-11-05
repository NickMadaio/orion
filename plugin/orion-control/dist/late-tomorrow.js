/*
 "whats tomorrow looking like" at 1 AM (w20 round 3, gate #66): the answer said "Tomorrow is Thursday" with Thursday's events, and Thursday
 was today. After midnight and before he has slept, "tomorrow" is the day coming up: today's date. Code words it, with the weekday and
 date said out loud, and says how to ask for the day after instead. The model is never asked what day it is. Pure.
*/
import { rows, spokenTime } from "./day-read-answers.js";
import { LATE_NIGHT_UNTIL, TOMORROW } from "./schedule-flow.js";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dateLabel = (d) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const list = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`);
/** He said "tomorrow" while it is still the small hours of the night. */
export const isLateTomorrow = (message, now) => TOMORROW.test(message) && now.getHours() < LATE_NIGHT_UNTIL;
/** Today's day read, said as the day ahead of him. `dayText` is the numbered day list (day-read-answers.ts). */
export function lateTomorrowAnswer(dayText, now) {
    const today = dateLabel(now);
    const next = dateLabel(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12));
    const timed = rows(dayText);
    const lead = `It's past midnight, so I'm reading "tomorrow" as the day you haven't had yet, ${today}.`;
    const tail = `If you meant ${next}, say "${next.split(" ")[0]}" and I'll read that one.`;
    if (!timed.length)
        return `${lead} Nothing is on your calendar for it. ${tail}`;
    const items = timed.map((r) => `${r.title.replace(/\s+—\s+Lecture$/i, "")} at ${spokenTime(r.hour, r.minute)}`);
    return `${lead} You have ${list(items)}. ${tail}`;
}
