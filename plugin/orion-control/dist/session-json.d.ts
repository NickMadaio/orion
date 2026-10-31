export type SessionState = Record<string, unknown>;
/** The JSON object in `stdout`: the whole output, or from the first line that opens an object, or the last line alone. Null when none parses. */
export declare function parseSessionJson(stdout: string): SessionState | null;
