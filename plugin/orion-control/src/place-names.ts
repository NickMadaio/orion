// The names ORION knows places by (name, id, aliases), for "when i get to spit" reminders and place lookups. Reads known-places.json read-only; home is not one (that is "when i get home").
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function knownPlaceNames(stateDir: string | undefined): string[] {
  if (!stateDir) return [];
  try {
    const file = JSON.parse(readFileSync(join(stateDir, "known-places.json"), "utf8")) as { places?: Array<{ id?: string; name?: string; kind?: string; aliases?: unknown }> };
    return [...new Set((file.places ?? []).filter((p) => p.id !== "home" && p.kind !== "home").flatMap((p) => [p.name, p.id, ...(Array.isArray(p.aliases) ? p.aliases : [])]).filter((n): n is string => typeof n === "string" && n.trim().length > 0))];
  } catch { return []; }
}

const flat = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(?:the|my|our) /, "");
/** Whether a name is one a known place answers to (the live known-places.json): an arrival reminder is never set for a place ORION cannot resolve. */
export function isKnownPlaceName(name: string, stateDir: string = process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled")): boolean {
  const want = flat(name);
  return !!want && knownPlaceNames(stateDir).some((n) => flat(n) === want);
}
