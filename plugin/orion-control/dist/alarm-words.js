/*
 A clock time said in words, as a voice transcript gives it (w18 audit2, 2026-11-03 22:30-22:40): "push my wake time to six thirty"
 reached no alarm route because the readers only knew digits, and the worker answered with a calendar failure line. Pure: turns
 "to six thirty", "at half past six", "for quarter to seven", "to six AM", "to eight o'clock" into "to 6:30", "at 6:30", ... so the
 digit readers see them. Only the word right after to/for/at/by/around/till/until is touched, never a duration ("six minutes").
*/
const HOURS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const H = Object.keys(HOURS).join("|");
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const MIN = String.raw `(?:(?:twenty|thirty|forty|fifty)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:oh|o)[ -]?(?:one|two|three|four|five|six|seven|eight|nine))`;
const PREP = String.raw `\b(to|for|at|by|around|till|until)\s+`;
const UNIT = String.raw `(?!\s*(?:min|mins|minutes?|hours?|hrs?|h|seconds?)\b)`;
const pad = (n) => String(n).padStart(2, "0");
const minutesOf = (w) => {
    const parts = w.split(/[ -]/);
    if (/^(?:oh|o)$/.test(parts[0]))
        return ONES[parts[1]] ?? 0;
    if (parts.length === 2)
        return (TENS[parts[0]] ?? 0) + (ONES[parts[1]] ?? 0);
    return TEENS[parts[0]] ?? TENS[parts[0]] ?? 0;
};
/** The message with each spoken clock time after a preposition rewritten as digits. Lowercase input. */
export function numeralizeTimes(m) {
    return m
        .replace(new RegExp(`${PREP}half past (${H})\\b`, "g"), (_a, p, h) => `${p} ${HOURS[h]}:30`)
        .replace(new RegExp(`${PREP}(?:a )?quarter past (${H})\\b`, "g"), (_a, p, h) => `${p} ${HOURS[h]}:15`)
        .replace(new RegExp(`${PREP}(?:a )?quarter to (${H})\\b`, "g"), (_a, p, h) => `${p} ${(HOURS[h] + 10) % 12 + 1}:45`)
        .replace(new RegExp(`${PREP}(${H})(?: o'?clock)?[ ,]+(${MIN})\\b${UNIT}`, "g"), (_a, p, h, mm) => `${p} ${HOURS[h]}:${pad(minutesOf(mm))}`)
        .replace(new RegExp(`${PREP}(${H}) o'?clock\\b`, "g"), (_a, p, h) => `${p} ${HOURS[h]}:00`)
        .replace(new RegExp(`${PREP}(${H})\\b(?=\\s*(?:a\\.?m\\.?|p\\.?m\\.?)(?![a-z])|[\\s.,!?]*$|\\s+(?:please|pls|instead|tomorrow|tmrw|tonight|then|thanks)\\b)${UNIT}`, "g"), (_a, p, h) => `${p} ${HOURS[h]}`);
}
