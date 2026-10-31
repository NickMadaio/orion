/*
 The crisis hold, kept where every chat can see it (REV4 follow-up, 2026-10-31).

 The hold ("no cheerful follow-up within 30 minutes of the crisis reply") lived in memory per chat: a crisis on the phone did not hold on
 the Mac, and a restart forgot it. It is now one small file in the controlled state dir, written beside pending-answered.json. The file
 holds only when the latest crisis turn happened; the hold window itself stays in pending-reply.ts.
*/
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CRISIS_FILE = "pending-crisis.json";

/** When the latest crisis turn was, on the plugin's clock, or undefined when none is recorded. */
export function readCrisisAt(dir: string): number | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(dir, CRISIS_FILE), "utf8")) as { at?: unknown };
    return typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : undefined;
  } catch { return undefined; }
}

/** Writes the time atomically (temp file, then rename). Best effort: a failed write leaves the memory copy in charge. */
export function writeCrisisAt(dir: string, at: number): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${CRISIS_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, at })}\n`, { mode: 0o600 });
    renameSync(tmp, join(dir, CRISIS_FILE));
    return true;
  } catch { return false; }
}
