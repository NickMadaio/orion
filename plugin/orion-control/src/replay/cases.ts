/* Loads replay cases from JSON: the repo's anonymised set, and the private corpus when a directory names one. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReplayCase } from "./types.js";

export const REPO_CASES = new URL("../../../../scripts/eval/replay/cases.json", import.meta.url);

export function readCases(file: string | URL): ReplayCase[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${String(file)}: expected an array of cases`);
  const seen = new Set<string>();
  return raw.map((c: ReplayCase, i) => {
    if (typeof c?.id !== "string" || typeof c.say !== "string" || typeof c.expect !== "object") throw new Error(`${String(file)}[${i}]: a case needs id, say and expect`);
    if (seen.has(c.id)) throw new Error(`${String(file)}: duplicate case id ${c.id}`);
    seen.add(c.id);
    return c;
  });
}

/** Every *.cases.json under a directory (the private corpus lives outside the repo). */
export function readCaseDir(dir: string): ReplayCase[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".cases.json")).sort().flatMap((f) => readCases(join(dir, f)));
}
