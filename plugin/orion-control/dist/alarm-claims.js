/*
 A drafted reply may state his wake-up only as wake-state.ts reads it (w20 xf-other, live gate 2 #47 #97). Small talk said "all set until your
 7:45 AM wake-up" with the alarm at 6:30: the model invented the time. Any sentence in a draft that gives a wake or alarm time is kept only when
 that time is the next real alarm (wake-plan.json via nextWake); otherwise the sentence is dropped, not corrected from memory.
*/
import { nextWake } from "./wake-state.js";
// A claim about HIS alarm: the clause's subject is his alarm or wake-up ("your alarm is", "sleep well until", "I'll wake you at"). Reminders "to wake dad", a lecture
// at 9:00 and the rest of a compound sentence are not claims about it and are kept.
const HIS_ALARM = /\byour (?:\w+ )?(?:wake[- ]?(?:up|alarm|time)|alarm|alarms)\b|\b(?:sleep(?:ing)? (?:well |tight |in )?|rest |lie in |you can sleep |you're good to sleep |you are good to sleep )(?:until|till)\b|\bsleep\b[^.?!]*\b(?:until|till)\b|\b(?:until|till) (?:your |the )?(?:wake|alarm|morning)|\bwake you(?: up)?\b|\bwake me(?: up)?\b|\bget you up\b|\byou(?:'re| are) up at\b|\byour alarm\b/i;
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
const CLAUSE = /(\s*;\s*|\s*,\s*(?:and |but |so )?|\s+(?:and|but|so)\s+)/i;
/** The time the claim names: the first one after the claim's own words, else the first in the clause. */
function claimedMinutes(clause) {
    const at = HIS_ALARM.exec(clause);
    const after = statedMinutes(clause.slice(at ? at.index : 0));
    return after[0] ?? statedMinutes(clause)[0];
}
/** The draft without any clause that states HIS alarm at a time that is not the real one; the rest of every sentence stays. */
export function withoutUnverifiedAlarmClaims(draft, stateDir, now) {
    const next = nextWake(stateDir, now);
    const real = next ? next.at.getHours() * 60 + next.at.getMinutes() : undefined;
    const wrong = (clause) => {
        if (!HIS_ALARM.test(clause))
            return false;
        const t = claimedMinutes(clause);
        return t !== undefined && t !== real;
    };
    const sentences = String(draft ?? "").split(/(?<=[.!?])\s+/).map((sentence) => {
        const end = /[.!?]+$/.exec(sentence)?.[0] ?? "";
        const body = end ? sentence.slice(0, -end.length) : sentence;
        const bits = body.split(CLAUSE); // clause, separator, clause, ...
        const keep = [];
        for (let n = 0; n < bits.length; n += 2) {
            const clause = bits[n] ?? "";
            if (wrong(clause)) {
                if (keep.length === 0 && bits[n + 2] !== undefined)
                    bits[n + 1] = "";
                continue;
            }
            if (keep.length)
                keep.push(bits[n - 1] ?? " ");
            keep.push(clause);
        }
        const text = keep.join("").trim();
        if (!text)
            return "";
        return text === body.trim() ? sentence : `${text.charAt(0).toUpperCase()}${text.slice(1)}${end || "."}`;
    });
    return sentences.filter(Boolean).join(" ").trim();
}
