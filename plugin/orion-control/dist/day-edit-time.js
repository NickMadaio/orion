/*
 Clocks for day edits (w20 sched): the way Nick says a time out loud, turned into minutes since midnight, for a day that may already be
 partly over. Pure.

   half 5 / half past 5 / quarter past 6 / quarter to 7 / ten to 8      -> digits
   in an hour / in 20 min / in half an hour                              -> the clock that is from now
   10-11pm / 7 to 9:30pm / from 2 to 3 / 5-6                              -> a range, the am/pm of one side carried to the other
 A bare hour is read toward the direction of the sentence: for something he did (past) the latest time that is not ahead of now,
 for something he wants (future) the first time still to come, for a move of something that happened the one nearest its old slot.
*/
import { parseClock, spokenTimesToDigits } from "./intent-time.js";
import { EARLY_CUE, wakingOnly } from "./waking-hours.js";
const HOURS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const H = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MINS = { five: 5, ten: 10, twenty: 20, "twenty five": 25, "twenty-five": 25 };
const digit = (w) => (/^\d+$/.test(w) ? Number(w) : H[w] ?? NaN);
const pad = (n) => String(n).padStart(2, "0");
/** Clock words to digits, and "in an hour" to a clock. `now` is minutes since midnight. */
export function naturalToDigits(text, now) {
    let t = spokenTimesToDigits(text);
    const hr = `(\\d{1,2}|${HOURS})`;
    t = t.replace(new RegExp(`\\bhalf(?: past)? ${hr}\\b(?! (?:an? )?(?:hour|min))`, "gi"), (_m, h) => `${digit(h.toLowerCase())}:30`);
    t = t.replace(new RegExp(`\\bquarter past ${hr}\\b`, "gi"), (_m, h) => `${digit(h.toLowerCase())}:15`);
    t = t.replace(new RegExp(`\\bquarter to ${hr}\\b`, "gi"), (_m, h) => `${((digit(h.toLowerCase()) + 10) % 12) + 1}:45`);
    t = t.replace(new RegExp(`\\b(five|ten|twenty(?:[ -]five)?) (past|to) (\\d{1,2}|${HOURS})\\b(?! (?:min|hour))(?<!(?:five|ten) to (?:${HOURS}))`, "gi"), (m, n, dir, h) => {
        const mins = MINS[n.toLowerCase()] ?? Number(n);
        const hour = digit(h.toLowerCase());
        if (!Number.isFinite(mins) || !Number.isFinite(hour) || mins > 30)
            return m;
        return dir.toLowerCase() === "past" ? `${hour}:${pad(mins)}` : `${((hour + 10) % 12) + 1}:${pad(60 - mins)}`;
    });
    t = t.replace(/\bin (?:(an?|one) hours?|half an hour|(\d{1,3}) ?(min(?:ute)?s?|hours?|hrs?)|a couple of hours)\b/gi, (_m, a, n, unit) => {
        const mins = /half/i.test(_m) ? 30 : /couple/i.test(_m) ? 120 : a ? 60 : /^h/i.test(unit ?? "") ? Number(n) * 60 : Number(n);
        const at = Math.ceil((now + mins) / 5) * 5;
        return `at ${pad(Math.floor(at / 60) % 24)}:${pad(at % 60)}`;
    });
    return t;
}
export const CLK = String.raw `(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midday|midnight)`;
const RANGE = new RegExp(String.raw `(?:\b(?:from|between|at|around)\s+)?(?<![\d:])(?<a>${CLK})\s*(?:-|–|—|to|till|til|until|and)\s*(?<b>${CLK})(?![\d:]|\s*(?:x|reps|sets|kg|lbs|km|miles?))`, "i");
/** "from 2 to 3" / "10-11pm" in a phrase: both clocks and the phrase with the range taken out. */
export function takeRange(text) {
    const m = RANGE.exec(text);
    if (!m?.groups)
        return null;
    const a = parseClock(m.groups.a.replace(/\s+/g, ""));
    const b = parseClock(m.groups.b.replace(/\s+/g, ""));
    if (!a || !b)
        return null;
    return { a, b, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim() };
}
const SINGLE = new RegExp(String.raw `(?:\b(?:at|around|by|to|for|until|till|from)\s+)(?<![\d:])(?<t>${CLK})(?![\d:]|\s*(?:x|reps|sets|kg|lbs|km|miles?|min|mins|minutes|hours?|hrs?))`, "i");
/** "at 6" / "to 12" / "at 17:05": one clock after a time word, and the phrase without it. */
export function takeClock(text) {
    const m = SINGLE.exec(text);
    if (!m?.groups)
        return null;
    const s = parseClock(m.groups.t.replace(/\s+/g, ""));
    return s ? { s, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim() } : null;
}
const exact = (s) => (s.ap ? (s.h % 12) * 60 + (s.ap === "p" ? 720 : 0) + s.m : s.h * 60 + s.m);
// A bare clock is a time he is awake for (waking-hours.ts): "2-4" is 14:00-16:00, "at half 5" is 17:30, unless he made it exact or said early morning.
const options = (s) => (s.exact || s.h === 0 || s.h > 12 ? [exact(s)] : wakingOnly(s.h === 12 ? [s.m, 720 + s.m] : [s.h * 60 + s.m, s.h * 60 + s.m + 720]));
/** His words say early morning: a bare clock in them is the small hours, made exact. */
export function withEarlyCue(s, text) {
    return EARLY_CUE.test(text) && !s.exact && !s.ap && s.h >= 1 && s.h <= 11 ? { ...s, ap: "a", exact: true } : s;
}
/** One clock: exact as said, else toward the sentence's direction (`near`: the old slot of what is being moved). */
export function pickClock(s, now, mode, near) {
    const c = options(s);
    if (c.length === 1)
        return c[0];
    if (near !== undefined)
        return c.reduce((best, v) => (Math.abs(v - near) < Math.abs(best - near) ? v : best));
    if (mode === "past") {
        const behind = c.filter((v) => v <= now + 10);
        return behind.length ? Math.max(...behind) : c[0];
    }
    const ahead = c.filter((v) => v > now);
    return ahead.length ? ahead[0] : c[1];
}
/** A range: the am/pm of one side carries to the other ("10-11pm" is 22:00-23:00, "11-1pm" is 11:00-13:00, "5-6" after the fact is 17:00-18:00). */
export function pickRange(a, b, now, mode) {
    const starts = options(a);
    const ends = options(b);
    const pairs = starts.flatMap((from) => ends.map((to) => ({ from, to }))).filter((p) => p.to > p.from && p.to - p.from <= 14 * 60);
    if (!pairs.length)
        return null;
    const sameHalf = pairs.filter((p) => (p.from >= 720) === (p.to > 720 || p.to === 720));
    // a bare side takes the half-day of the side that said it; two bare sides take the direction of the sentence
    const pool = (!a.exact && !a.ap && (b.ap || b.exact) && sameHalf.length) || (!b.exact && !b.ap && (a.ap || a.exact) && sameHalf.length) ? sameHalf : pairs;
    const sorted = [...pool].sort((x, y) => x.from - y.from || x.to - y.to);
    if (mode === "past") {
        const behind = sorted.filter((p) => p.from <= now + 10);
        const best = behind.length ? behind[behind.length - 1] : sorted[0];
        return sorted.filter((p) => p.from === best.from)[0];
    }
    const ahead = sorted.filter((p) => p.from > now);
    return ahead.length ? ahead[0] : sorted[sorted.length - 1];
}
