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
/** "13°C (55°F)", "55°F", "55 F", "high 13°C", "46–55°F" become "55 degrees Fahrenheit", "a high of 55 degrees Fahrenheit", "46 to 55 degrees Fahrenheit". */
export function fahrenheitWords(text) {
    if (typeof text !== "string" || !/[°\d]\s*(?:°|F\b|degrees?|deg)/.test(text))
        return text;
    return text.replace(TEMP, (_all, hl, a = "0", b, deg, word, bare, paren, parenUnit) => {
        const unit = (deg ?? word ?? bare ?? "F").charAt(0).toUpperCase() === "C" ? "C" : "F";
        const conv = (n) => (unit === "C" ? toF(n) : Math.round(Number(n)));
        const parenF = paren !== undefined && parenUnit === "F";
        const first = parenF && b === undefined ? Math.round(Number(paren)) : conv(a);
        const span = b === undefined ? `${first}` : `${first} to ${conv(b)}`;
        return `${hl ? `${hl} of ` : ""}${span} degrees Fahrenheit`;
    });
}
