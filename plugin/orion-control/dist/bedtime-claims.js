/*
 A reply may say a bedtime was set or changed only when orion-sleepplan did it this turn (w20 round 6, live gate 4 #13 #81 #11: "Bedtime tonight only is
 11:50 PM", "Set bedtime to 11:30 PM tonight" and "Saved: your bedtime is half 11" were said with nothing written; the desk had sent them to the wake tool
 and the worker, or the brain, just agreed). Review r6 narrowed it: ONLY a sentence whose own claim is a change to the bedtime is dropped, and only when no
 sleep-plan write ran this turn AND the time it states is not the bedtime wake-plan.json already holds (then it is a true statement, kept).
 A statement of the current bedtime ("your bedtime is set for 11:30"), what he did before ("you set it yesterday") and every sentence about something else
 ("I changed your gym to 6, that leaves time before bedtime") are never touched.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const BED = String.raw `(?:bed\s?times?|sleep\s?times?)`;
const VERB = String.raw `(?:set|saved?|changed?|moved?|pushed?|updated?|made|put|adjusted|bumped)`;
const LEAD = String.raw `(?:(?:done|okay|ok|sure|got it|all set|alright|right|noted)[,.!:\s]+)*`;
// "Set bedtime to 11:30 PM tonight." / "Saved: your bedtime is half 11 every night now." / "Changed your bedtime to midnight."
const IMPERATIVE = new RegExp(String.raw `^${LEAD}${VERB}\b[:,]?\s+(?:(?:your|the|my)\s+)?${BED}\b`, "i");
// "I set your bedtime to 11:30." / "I've moved your bedtime to midnight." (the verb's own object is the bedtime)
const FIRST_PERSON = new RegExp(String.raw `\bI(?:'ve| have|'ll| will)?\s+(?:just\s+|now\s+)?${VERB}\s+(?:(?:your|the|my)\s+)?${BED}\b`, "i");
// "Bedtime tonight only is 11:50 PM." / "Your bedtime is now 11:45." / "Bedtime is 11 from now on." : the bedtime as subject with a marker that it just became so
const SUBJECT_NOW = new RegExp(String.raw `^${LEAD}(?:(?:your|the)\s+)?${BED}\b[^.?!]*\b(?:tonight only|only tonight|is now|now at|every night now|from now on|updated|changed)\b`, "i");
const TIME = /\d|\bmidnight\b|\bnoon\b|\bhalf\s+\w+|\bquarter\b|\b(?:ten|five|twenty)\s+(?:to|past)\b/i;
const WROTE = /orion-sleepplan\s+(?:bedtime|wake-on|shift|set|except)\b/;
/** The honest line when every sentence was a claim. */
export const BEDTIME_UNSAVED = "I haven't changed your bedtime, so nothing was saved. Say it again and I'll set it.";
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/** The clock minutes (after midnight; evening hours as 20:00-23:59, small hours as 0:00-4:59) a sentence states, or none. */
function statedBedMinutes(sentence) {
    const s = sentence.toLowerCase().replace(/\bhalf (\d{1,2}|[a-z]+)\b/g, (_a, h) => `${/^\d+$/.test(h) ? h : WORDS[h] ?? h}:30`);
    const out = [];
    if (/\bmidnight\b/.test(s))
        out.push(0);
    for (const m of s.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)) {
        let h = Number(m[1]);
        const min = Number(m[2] ?? 0);
        const ap = m[3];
        if (h > 24 || min > 59 || (!m[2] && !ap))
            continue;
        if (ap)
            h = (h % 12) + (ap === "pm" ? 12 : 0);
        else if (h >= 6 && h <= 11)
            h += 12;
        else if (h === 12)
            h = 0;
        out.push((h % 24) * 60 + min);
    }
    return out;
}
/** The bedtimes wake-plan.json holds for the coming nights, as minutes after midnight (small hours as 0-299). */
function plannedBedMinutes(stateDir) {
    if (!stateDir)
        return [];
    try {
        const file = join(stateDir, "wake-plan.json");
        if (!existsSync(file))
            return [];
        const doc = JSON.parse(readFileSync(file, "utf8"));
        return (doc.bedtimes ?? []).flatMap((b) => { const m = /^(\d{2}):(\d{2})$/.exec(b.sleepBy ?? ""); return m ? [Number(m[1]) * 60 + Number(m[2])] : []; });
    }
    catch {
        return [];
    }
}
export const claimsBedtimeChange = (sentence) => {
    const s = sentence.trim();
    if (/\?\s*$/.test(s) || !TIME.test(s))
        return false;
    return IMPERATIVE.test(s) || FIRST_PERSON.test(s) || SUBJECT_NOW.test(s);
};
/** The draft without sentences that claim a bedtime change no tool made; unchanged when a sleep-plan write ran this turn. */
export function withoutUnverifiedBedtimeClaims(draft, tools, stateDir) {
    if (tools.some((t) => WROTE.test(t.canonical)))
        return draft;
    const sentences = String(draft ?? "").split(/(?<=[.!?])\s+/);
    const planned = plannedBedMinutes(stateDir);
    const unverified = (s) => claimsBedtimeChange(s) && !statedBedMinutes(s).some((m) => planned.includes(m));
    if (!sentences.some(unverified))
        return draft;
    return [...sentences.filter((s) => !unverified(s)), BEDTIME_UNSAVED].join(" ").trim();
}
