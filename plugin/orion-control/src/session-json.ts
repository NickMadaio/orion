/*
 The one JSON object an `orion-session ... --json` run prints (gate run-1031202318, clusters 2 and 5).

 The real script prints a plain line first for some commands ("Sequence: 10 min break, 50 min work") and then the reply as indented,
 multi-line JSON. Reading only the LAST line of stdout, as the focus moves did, read "}" and failed every time: the session had started
 (focus-state.json changed) while ORION said "I couldn't set the break timer, nothing is running". A reply about the session must come from
 what the session actually reports, so this reads the object wherever it sits in the output.
*/
export type SessionState = Record<string, unknown>;

const asObject = (text: string): SessionState | null => {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as SessionState) : null;
  } catch { return null; }
};

/** The JSON object in `stdout`: the whole output, or from the first line that opens an object, or the last line alone. Null when none parses. */
export function parseSessionJson(stdout: string): SessionState | null {
  const text = stdout.trim();
  if (!text) return null;
  const whole = asObject(text);
  if (whole) return whole;
  const lines = text.split("\n");
  const open = lines.findIndex((line) => line.trimStart().startsWith("{"));
  if (open >= 0) {
    const tail = asObject(lines.slice(open).join("\n"));
    if (tail) return tail;
  }
  return asObject(lines.at(-1) ?? "");
}
