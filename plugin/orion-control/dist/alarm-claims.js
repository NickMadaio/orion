/*
 A drafted reply may state his wake-up only as wake-state.ts reads it (w20 xf-other, live gate 2 #47 #97). Small talk said "all set until your
 7:45 AM wake-up" with the alarm at 6:30: the model invented the time. Any sentence in a draft that gives a wake or alarm time is kept only when
 that time is the next real alarm (wake-plan.json via nextWake); otherwise the sentence is dropped, not corrected from memory.
*/
import { nextWake } from "./wake-state.js";
const ALARM_WORD = /\b(?:wake[- ]?(?:up|alarm|time)?|alarms?|wake me|get up|up at)\b/i;
const CLOCK = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/gi;
/** The h:mm times a sentence states, as minutes after midnight (am/pm applied; a bare h:mm is read as written, 24-hour). */
function statedMinutes(sentence) {
    const out = [];
    for (const m of sentence.matchAll(CLOCK)) {
        const h = Number(m[1] ?? m[4]), min = Number(m[2] ?? 0), ap = (m[3] ?? m[5])?.toLowerCase();
        if (h > 24 || min > 59)
            continue;
        out.push((ap ? (h % 12) + (ap === "pm" ? 12 : 0) : h) * 60 + min);
    }
    return out;
}
export function withoutUnverifiedAlarmClaims(draft, stateDir, now) {
    const parts = String(draft ?? "").split(/(?<=[.!?])\s+/);
    const next = nextWake(stateDir, now);
    const real = next ? next.at.getHours() * 60 + next.at.getMinutes() : undefined;
    return parts.filter((s) => {
        if (!ALARM_WORD.test(s))
            return true;
        const times = statedMinutes(s);
        if (!times.length)
            return true;
        return real !== undefined && times.every((t) => t === real);
    }).join(" ").trim();
}
