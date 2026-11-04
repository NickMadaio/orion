// Temperatures are spoken aloud (TTS), and "°F" / "°C" get read badly: "F" is stumbled over. ORION gives Fahrenheit,
// and says the whole word. Nick, 2026-11-03: "give fahrenheit, and make it the full word, not just 'F'".
// Same rules as scripts/lib/reach/fahrenheit.mjs (used by the morning brief and the alerts); keep the two in step.
/** Celsius to Fahrenheit, rounded to a whole degree. */
export const toF = (celsius) => Math.round((Number(celsius) * 9) / 5 + 32);
const NUM = "-?\\d+(?:\\.\\d+)?";
// [high|low [of]] N [– N] then °C / °F / "degrees Celsius|Fahrenheit|F|C" / a bare " F" — optionally followed by "(N°F)".
// Case-sensitive on purpose: a lowercase "f" or "c" after a number is never a unit here.
const TEMP = new RegExp(`(?:\\b([Hh]igh|[Ll]ow)(?:\\s+of)?\\s+)?(?<![\\w:.])(${NUM})(?:\\s*[–-]\\s*(${NUM}))?\\s*` +
    `(?:°\\s*([CF])\\b|(?:degrees?|deg)\\s+([Cc]elsius|[Cc]entigrade|[Ff]ahrenheit|[CF])\\b|(F)(?![\\w°]))` +
    `(?:\\s*\\(\\s*(${NUM})\\s*°?\\s*([CF])\\s*\\))?`, "g");
// A bare "F" (no degree sign, no "degrees") is a temperature only with weather words around it, and never the F of a macro triple
// ("6P 23C 8F"): Nick, 2026-11-04, "8F" was spoken as "8 degrees Fahrenheit". "°F" and "degrees F" always convert.
const MACRO_TRIPLE = /\b\d+(?:\.\d+)?\s*P\s+\d+(?:\.\d+)?\s*C\s+\d+(?:\.\d+)?\s*F\b/g;
const WEATHER_CONTEXT = /\b(?:high|low|feels?|degrees?|temperature|temp|forecast|weather|out|outside|chilly|freezing)\b/i;
/** "13°C (55°F)", "55°F", "55 F", "high 13°C", "46–55°F" become "55 degrees Fahrenheit", "a high of 55 degrees Fahrenheit", "46 to 55 degrees Fahrenheit". */
export function fahrenheitWords(text) {
    if (typeof text !== "string" || !/[°\d]\s*(?:°|F\b|degrees?|deg)/.test(text))
        return text;
    const macros = [...text.matchAll(MACRO_TRIPLE)].map((m) => [m.index, m.index + m[0].length]);
    const weather = WEATHER_CONTEXT.test(text);
    return text.replace(TEMP, (...args) => {
        const [all, hl, a = "0", b, deg, word, bare, paren, parenUnit] = args;
        const at = args[args.length - 2];
        if (bare !== undefined && deg === undefined && word === undefined && (!weather || macros.some(([from, to]) => at < to && at + all.length > from)))
            return all;
        const unit = (deg ?? word ?? bare ?? "F").charAt(0).toUpperCase() === "C" ? "C" : "F";
        const conv = (n) => (unit === "C" ? toF(n) : Math.round(Number(n)));
        const parenF = paren !== undefined && parenUnit === "F";
        const first = parenF && b === undefined ? Math.round(Number(paren)) : conv(a);
        const span = b === undefined ? `${first}` : `${first} to ${conv(b)}`;
        return `${hl ? `${hl} of ` : ""}${span} degrees Fahrenheit`;
    });
}
