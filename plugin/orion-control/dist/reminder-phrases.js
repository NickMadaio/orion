/*
 How he types a reminder (w19-reminders). Pure helpers read by reminder-flow.ts:
   fixTypos     "remnd me tmrw at 9" -> "remind me tomorrow at 9" (only the words reminders hinge on)
   repeatOf     "every monday", "weekdays", "daily", "every mon and thu", "every morning"; or why a repeat is not supported
   periodTime   "tomorrow morning" -> 09:00 when he gave no clock time
   wantsHome    "when I get home"
   isImportantAsk  marked important: delivered even during a focus session
*/
import { daysOf } from "./reminder-schedule.js";
/** Optimal-string-alignment distance: a swap of two neighbouring letters is one typo. */
function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++)
        d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}
const ALIASES = {
    tmrw: "tomorrow", tmr: "tomorrow", tmrrw: "tomorrow", tmw: "tomorrow", "2moro": "tomorrow", "2morrow": "tomorrow", tomm: "tomorrow", tmrow: "tomorrow",
    tonite: "tonight", "2nite": "tonight", tonigt: "tonight", tongiht: "tonight", tnite: "tonight",
};
const ME = new Set(["me", "mw", "em", "m", "my", "us"]);
const FUZZY = [
    { word: "remind", max: 1, needsMe: true }, { word: "reminders", max: 2 }, { word: "reminder", max: 2 },
    { word: "tomorrow", max: 2 }, { word: "tonight", max: 1 }, { word: "morning", max: 1 }, { word: "afternoon", max: 2 }, { word: "evening", max: 1 },
];
/** Only the words a reminder hinges on are repaired: a sentence that is not about reminders is left exactly as it was. */
export function fixTypos(message) {
    const tokens = message.split(/(\s+)/);
    const fixed = tokens.map((token, i) => {
        const m = /^([a-z0-9]+)([^a-z0-9]*)$/i.exec(token);
        if (!m)
            return token;
        const word = m[1].toLowerCase();
        const tail = m[2] ?? "";
        if (ALIASES[word])
            return ALIASES[word] + tail;
        if (word.length < 4 || /^remind(?:ed|s|ing)?$/.test(word) || /^reminders?$/.test(word) || ["morning", "evening", "afternoon", "tomorrow", "tonight"].includes(word))
            return token;
        const next = (tokens[i + 2] ?? "").toLowerCase().replace(/[^a-z]/g, "");
        let best;
        for (const f of FUZZY) {
            if (word[0] !== f.word[0] || Math.abs(word.length - f.word.length) > f.max)
                continue;
            if (f.needsMe && !ME.has(next))
                continue;
            const dist = distance(word, f.word);
            if (dist <= f.max && !(f.word === "remind" && word.length < 5) && (!best || dist < best.dist))
                best = { f, dist };
        }
        if (best) {
            if (best.f.word === "remind" && ME.has(next) && next !== "me")
                tokens[i + 2] = "me";
            return best.f.word + tail;
        }
        return token;
    }).join("");
    return fixed.replace(/\bremind\s+(?:mw|em|m)\b/gi, "remind me");
}
const DAY_PATTERNS = [
    [0, /^(?:sun|sunday|sundays)$/], [1, /^(?:mon|monday|mondays)$/], [2, /^(?:tue|tues|tuesday|tuesdays)$/], [3, /^(?:wed|weds|wednesday|wednesdays)$/],
    [4, /^(?:thu|thur|thurs|thursday|thursdays)$/], [5, /^(?:fri|friday|fridays)$/], [6, /^(?:sat|saturday|saturdays)$/],
];
const dayWord = (w) => DAY_PATTERNS.find(([, re]) => re.test(w))?.[0];
const UNSUPPORTED = /\b(?:every\s+other|every\s+(?:\d+|two|three|four|five|six|a few)\s*(?:hours?|hrs?|mins?|minutes?|days?|weeks?|months?)|every\s+(?:hour|month|year|fortnight)|hourly|monthly|yearly|annually|fortnightly|biweekly|bi-weekly|twice a (?:day|week))\b/i;
/** The days a repeating request names, `unsupported` for a repeat he cannot do, undefined when it is not a repeat at all. */
export function repeatOf(message) {
    const m = message.toLowerCase().replace(/[‘’]/g, "'");
    const odd = UNSUPPORTED.exec(m);
    if (odd)
        return { unsupported: odd[0] };
    if (/\b(?:weekdays|every\s+weekday|each\s+weekday|monday\s+(?:to|through|-)\s+friday|mon\s*-\s*fri)\b/.test(m))
        return { days: daysOf("weekdays") };
    if (/\b(?:weekends|every\s+weekend|each\s+weekend)\b/.test(m))
        return { days: daysOf("weekends") };
    if (/\b(?:daily|every\s*day|each\s+day|every\s+(?:morning|night|evening|afternoon)|each\s+(?:morning|night|evening))\b/.test(m))
        return { days: daysOf("daily") };
    // "every monday", "every mon and thurs", "on mondays and wednesdays"
    const lead = /\b(?:every|each)\s+((?:[a-z]+(?:\s*(?:,|and|&)\s*|\s+)?){1,4})/.exec(m)?.[1] ?? /\bon\s+((?:[a-z]+s?(?:\s*(?:,|and|&)\s*)){0,3}[a-z]+s)\b/.exec(m)?.[1];
    if (lead) {
        const days = [];
        for (const w of lead.split(/\s*(?:,|and|&|\s)\s*/)) {
            const d = dayWord(w);
            if (d === undefined) {
                if (days.length)
                    break;
                continue;
            }
            if (!days.includes(d))
                days.push(d);
        }
        if (days.length)
            return { days: days.sort((a, b) => a - b) };
    }
    return undefined;
}
const PERIODS = [
    [/\b(?:tonight|tomorrow\s+night|this\s+night)\b/, "20:00"],
    [/\b(?:this\s+evening|tomorrow\s+evening|every\s+evening|in\s+the\s+evening)\b/, "18:00"],
    [/\b(?:this\s+afternoon|tomorrow\s+afternoon|every\s+afternoon|in\s+the\s+afternoon)\b/, "14:00"],
    [/\b(?:this\s+morning|tomorrow\s+morning|every\s+morning|in\s+the\s+morning|each\s+morning)\b/, "09:00"],
];
const HAS_CLOCK = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\b(?:at|by|around|@)\s*\d{1,2}\b|\bnoon\b|\bmidnight\b/i;
/** A part of the day, as a default time, when he named no clock time. */
export function periodTime(message) {
    const m = message.toLowerCase();
    if (HAS_CLOCK.test(m))
        return undefined;
    return PERIODS.find(([re]) => re.test(m))?.[1];
}
const HOME = /\b(?:when|once|as soon as|after|the (?:second|minute|moment) (?:i|we))\s*(?:i|we)?\s*(?:'m|am|im|get|got|come|came|walk|walked|arrive|arrived|step|stepped|reach|reached|am back|'m back|back)\s*(?:in|back|into)?\s*(?:the\s+)?(?:home|house|my place|my apartment|my room|the door|my flat|hom)\b|\bwhen\s+(?:i'?m|im|i am)\s+(?:back\s+)?home\b/i;
const HOME_WHEN = /\bwhen\s+(?:i|we)\s+(?:get|got|come|walk|arrive)\s+(?:back\s+)?(?:home|in\s+the\s+door|through\s+the\s+door)\b/i;
export const wantsHome = (message) => HOME.test(message) || HOME_WHEN.test(message) || /\bwhen\s+i\s+walk\s+in\b/i.test(message);
const IMPORTANT = /\b(?:important|urgent|critical|asap|don'?t miss|do not miss|can'?t miss|cannot miss|no matter what|even in (?:a )?focus|really need|must not forget|mustn'?t forget)\b/i;
export const isImportantAsk = (message) => IMPORTANT.test(message.replace(/[‘’]/g, "'"));
