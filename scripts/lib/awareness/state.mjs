// awareness.json: one file, one writer (`orion-awareness refresh`), one reader (this). Contract C1.
// A facet older than its limit reads as `unknown` whatever it says; nothing here guesses.
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { LIMITS, UNKNOWN, derive, isFresh } from "./facets.mjs";
import { readJson, writeJsonAtomic } from "./io.mjs";
import { activeDeclaration, clearDeclared, INPUT_MINUTES } from "./declared.mjs";

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
  if (!file || file.schema !== SCHEMA) return withDeclared(finish({ schema: SCHEMA, at: null, ...emptyFacets(), meta: {} }), dir, now);
  const ok = (name, facet, limit = limitFor(name, facet)) => facet && typeof facet === "object" && isFresh(facet.at, Math.min(limit, maxAgeMs), now);
  const pick = (name, facet, unknown) => (ok(name, facet) ? facet : { ...unknown(facet?.at ?? null) });
  const audio = file.audio ?? {};
  return withDeclared(finish({
    schema: SCHEMA, at: file.at ?? null,
    session: pick("session", file.session, UNKNOWN.session),
    calendar: pick("calendar", file.calendar, UNKNOWN.calendar),
    location: locationOk(file.location, ok, now) ? file.location : { ...UNKNOWN.location(file.location?.at ?? null), homeKnown: !!file.location?.homeKnown },
    mac: pick("mac", file.mac, UNKNOWN.mac),
    phone: pick("phone", file.phone, UNKNOWN.phone),
    audio: { mac: ok("audioMac", audio.mac) ? audio.mac : UNKNOWN.audio(audio.mac?.at ?? null),
             phone: ok("audioPhone", audio.phone) ? audio.phone : UNKNOWN.audio(audio.phone?.at ?? null) },
    sleep: pick("sleep", file.sleep, UNKNOWN.sleep),
    meta: file.meta ?? {},
  }), dir, now);
}

/** A location facet that carries `expiresAt` lapses then; an older one falls back to its source's age limit. */
const locationOk = (facet, ok, now) => {
  const until = Date.parse(facet?.expiresAt);
  return !Number.isNaN(until) && facet?.state !== "unknown" ? now.getTime() <= until && ok("location", facet, LIMITS.locationRegion) : ok("location", facet);
};

const finish = (aw) => ({ ...aw, derived: derive(aw) });

/** He said he is going to sleep (orion-inbound-turn): asleep until he wakes, whatever the window or the Mac says. */
const withDeclared = (aw, dir, now) => {
  const declared = activeDeclaration({ dir, now });
  // real Mac input 15+ minutes after "going to bed" (the facet is only fresh for 90 s, and "active" is input in the last 5 min): he is up
  if (declared && aw.mac?.state === "active" && now.getTime() - Date.parse(declared.at) >= INPUT_MINUTES * 60_000) { try { clearDeclared(dir); } catch {} return aw; }
  return declared ? finish({ ...aw, sleep: { ...aw.sleep, state: "asleep", source: "declared", declaredAt: declared.at, at: now.toISOString() } }) : aw;
};

export function writeAwareness(dir, aw) {
  const { derived: _drop, ...facets } = aw;
  writeJsonAtomic(dir, FILE, { ...facets, derived: derive(facets) });
}

/** Seconds since the file was composed, or Infinity when there is none. */
export function fileAgeMs(dir, now = new Date()) {
  const at = Date.parse(readJson(join(dir, FILE))?.at);
  return Number.isNaN(at) ? Infinity : now.getTime() - at;
}

/**
 * The lazy refresh (spec 3.1, 4): run `orion-awareness refresh` when the file is older than `maxAgeMs` (2 min).
 * A no-op where the writer is not installed or ORION_AWARENESS_NO_REFRESH=1 (tests). The writer itself honours the
 * ORION_REACH_FACTS / ORION_REACH_NOW / ORION_SESSION_SOCKET seams, so a test never reads the real Mac through it.
 */
export function refreshIfOld({ dir = controlledDir(), now = new Date(), maxAgeMs = 120_000, env = process.env } = {}) {
  const bin = join(import.meta.dirname, "../../orion-awareness");
  if (env.ORION_AWARENESS_NO_REFRESH === "1" || !existsSync(bin)) return false;
  if (fileAgeMs(dir, now) <= maxAgeMs) return false;
  // the writer composes at the caller's clock, so a fixed test clock (--now, ORION_REACH_NOW) is the writer's clock too
  return spawnSync(process.execPath, [bin, "refresh"], { env: { ...env, ORION_REACH_NOW: now.toISOString() }, timeout: 8000, stdio: "ignore" }).status === 0;
}
