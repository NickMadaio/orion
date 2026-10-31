const asObject = (text) => {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
};
/** The JSON object in `stdout`: the whole output, or from the first line that opens an object, or the last line alone. Null when none parses. */
export function parseSessionJson(stdout) {
    const text = stdout.trim();
    if (!text)
        return null;
    const whole = asObject(text);
    if (whole)
        return whole;
    const lines = text.split("\n");
    const open = lines.findIndex((line) => line.trimStart().startsWith("{"));
    if (open >= 0) {
        const tail = asObject(lines.slice(open).join("\n"));
        if (tail)
            return tail;
    }
    return asObject(lines.at(-1) ?? "");
}
