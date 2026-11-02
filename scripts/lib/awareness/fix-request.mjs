// Noticing the phone's location is stale, and asking the phone for a fresh fix (2026-11-02).
//
// On 2026-11-02 at 08:02 the newest phone fix was from 10-30 16:27, so location was "unknown", home was unknown and a
// "Leave in 13 min" class reminder stayed a silent bubble. The speak rule (home known or headphones in) was right and is
// not touched here. What was missing: nothing noticed the fix was 2.5 days old, and nothing asked the phone for a new one.
//
// The ask is a file, `location-request.json`, that the ORION Link carries in its CloudKit snapshot (LinkSnapshot
// .locationRequest). A snapshot change pushes to the phone, which answers each request id once with a fix and a sample
// (PhoneSignals.answer). The file is the whole contract: { id, at, reason, lastFixAt }; the Link reads id/at/reason.
// Rejected: a new CloudKit record type (a second channel the Link would have to subscribe to, for one field) and asking
// on every awareness tick (each ask is a push and a GPS fix on his phone, so it is rate-limited here).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./io.mjs";
import { LIMITS } from "./facets.mjs";

const MIN = 60_000;
export const FILE = "location-request.json";
/** A fix older than this is stale: the same 20 min after which an away/unknown fix stops counting (facets.LIMITS). */
export const FIX_STALE_MS = LIMITS.locationSample;
/** At most one ask per this long. The Link carries a request for 15 min (LocationRequest.lifetime), so asks overlap. */
export const ASK_EVERY_MS = 10 * MIN;
/** A fixed block or a class starting this soon is a reason to know where he is (the leave reminder comes before it). */
export const LEAD_MS = 90 * MIN;

const ms = (at) => { const t = Date.parse(at); return Number.isNaN(t) ? null : t; };
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();

/** The newest phone row that carries a location. `{ lastFixAt, ageMin, stale }`; no fix at all is stale with nulls. */
export function fixStatus(phoneSignals, now) {
  const fix = (Array.isArray(phoneSignals) ? phoneSignals : [])
    .filter((s) => Number.isFinite(Number(s?.latitude)) && Number.isFinite(Number(s?.longitude)) && ms(s?.at) !== null)
    .reduce((best, s) => (!best || ms(s.at) > ms(best.at) ? s : best), null);
  if (!fix) return { lastFixAt: null, ageMin: null, stale: true };
  const age = now.getTime() - ms(fix.at);
  return { lastFixAt: fix.at, ageMin: Math.max(0, Math.round(age / MIN)), stale: age > FIX_STALE_MS };
}

/**
 * Why ORION needs a location right now, or null. Only when the location reading has lapsed ("unknown"): a known reading,
 * even one held from an older fix, needs nothing. Then: a commute wall now, or a class / fixed block within LEAD_MS.
 * `calendar`: the awareness calendar facet (minutes of the day).
 */
export function fixNeed({ calendar, location, now }) {
  if (location?.state !== "unknown") return null;
  if (calendar?.state !== "ok") return null;
  if (calendar.travelNow) return "commute now";
  const minute = minuteOf(now);
  const soon = (b) => b && (b.kind === "class" || b.fixed) && b.start - minute <= LEAD_MS / MIN;
  if (soon(calendar.now)) return calendar.now.kind === "class" ? "class now" : "fixed plan now";
  if (soon(calendar.next)) return calendar.next.kind === "class" ? "class soon" : "fixed plan soon";
  return null;
}

/**
 * Write a request unless one was made in the last ASK_EVERY_MS. Never throws: a failed ask must not stop a refresh.
 * @returns {{ asked: boolean, request: object|null }} the request now standing (new or previous)
 */
export function requestFix(dir, { now, reason, lastFixAt = null }) {
  const previous = readJson(join(dir, FILE));
  const prevAt = ms(previous?.at);
  if (prevAt !== null && now.getTime() - prevAt >= 0 && now.getTime() - prevAt < ASK_EVERY_MS) return { asked: false, request: previous };
  const request = { id: `fix-${now.getTime()}-${randomUUID().slice(0, 6)}`, at: now.toISOString(), reason: String(reason ?? "needed").slice(0, 80), lastFixAt };
  try { writeJsonAtomic(dir, FILE, request); } catch { return { asked: false, request: previous }; }
  return { asked: true, request };
}

/** The line awareness keeps in `meta.phoneFix`, so the staleness and the last ask are visible to anything reading it. */
export function phoneFixMeta(status, request) {
  return { lastAt: status.lastFixAt, ageMin: status.ageMin, stale: status.stale, askedAt: request?.at ?? null, askReason: request?.reason ?? null };
}
