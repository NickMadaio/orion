// awareness.json: one file, one writer (`orion-awareness refresh`), one reader (this). Contract C1.
// A facet older than its limit reads as `unknown` whatever it says; nothing here guesses.
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { LIMITS, UNKNOWN, derive, isFresh } from "./facets.mjs";
import { readJson, writeJsonAtomic } from "./io.mjs";

export const SCHEMA = "orion.awareness.v1";
export const FILE = "awareness.json";
export const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw/orion-controlled");

/** The age limit that applies to each facet as stored (location depends on where the fix came from). */
export const limitFor = (name, facet) => name === "location" ? (facet?.source === "region" ? LIMITS.locationRegion : LIMITS.locationSample) : LIMITS[name];

const emptyFacets = (at = null) => ({
  session: UNKNOWN.session(at), calendar: UNKNOWN.calendar(at), location: UNKNOWN.location(at), mac: UNKNOWN.mac(at),
  phone: UNKNOWN.phone(at), audio: { mac: UNKNOWN.audio(at), phone: UNKNOWN.audio(at) }, sleep: UNKNOWN.sleep(at),
});

/**
 * @param maxAgeMs optional cap on every facet's age, on top of its own limit
 * @returns the snapshot with stale facets replaced by `unknown` and `derived` recomputed; all unknown when there is no file
 */
export function readAwareness({ dir = controlledDir(), now = new Date(), maxAgeMs = Infinity } = {}) {
  const file = readJson(join(dir, FILE));
  if (!file || file.schema !== SCHEMA) return finish({ schema: SCHEMA, at: null, ...emptyFacets(), meta: {} });
  const ok = (name, facet, limit = limitFor(name, facet)) => facet && typeof facet === "object" && isFresh(facet.at, Math.min(limit, maxAgeMs), now);
  const pick = (name, facet, unknown) => (ok(name, facet) ? facet : { ...unknown(facet?.at ?? null) });
  const audio = file.audio ?? {};
  return finish({
    schema: SCHEMA, at: file.at ?? null,
    session: pick("session", file.session, UNKNOWN.session),
    calendar: pick("calendar", file.calendar, UNKNOWN.calendar),
    location: ok("location", file.location) ? file.location : { ...UNKNOWN.location(file.location?.at ?? null), homeKnown: !!file.location?.homeKnown },
    mac: pick("mac", file.mac, UNKNOWN.mac),
    phone: pick("phone", file.phone, UNKNOWN.phone),
    audio: { mac: ok("audioMac", audio.mac) ? audio.mac : UNKNOWN.audio(audio.mac?.at ?? null),
             phone: ok("audioPhone", audio.phone) ? audio.phone : UNKNOWN.audio(audio.phone?.at ?? null) },
    sleep: pick("sleep", file.sleep, UNKNOWN.sleep),
    meta: file.meta ?? {},
  });
}

const finish = (aw) => ({ ...aw, derived: derive(aw) });

export function writeAwareness(dir, aw) {
  const { derived: _drop, ...facets } = aw;
  writeJsonAtomic(dir, FILE, { ...facets, derived: derive(facets) });
}

/** Seconds since the file was composed, or Infinity when there is none. */
export function fileAgeMs(dir, now = new Date()) {
  const at = Date.parse(readJson(join(dir, FILE))?.at);
  return Number.isNaN(at) ? Infinity : now.getTime() - at;
}

/** The lazy refresh (spec 3.1, 4): run `orion-awareness refresh` when the file is older than `maxAgeMs` (2 min). */
export function refreshIfOld({ dir = controlledDir(), now = new Date(), maxAgeMs = 120_000, env = process.env } = {}) {
  if (fileAgeMs(dir, now) <= maxAgeMs) return false;
  const bin = join(import.meta.dirname, "../../orion-awareness");
  return spawnSync(process.execPath, [bin, "refresh"], { env, timeout: 8000, stdio: "ignore" }).status === 0;
}
