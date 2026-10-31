export declare const CRISIS_FILE = "pending-crisis.json";
/** When the latest crisis turn was, on the plugin's clock, or undefined when none is recorded. */
export declare function readCrisisAt(dir: string): number | undefined;
/** Writes the time atomically (temp file, then rename). Best effort: a failed write leaves the memory copy in charge. */
export declare function writeCrisisAt(dir: string, at: number): boolean;
