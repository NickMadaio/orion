// Known places and the overnight-charging home guess (spec 3.3, contract C6).
// `places.json` (commute minutes for schedule-flow) is a different file and is never touched here.
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./io.mjs";

const FILE = "known-places.json";

/**
 * Home, as Nick confirmed it (2026-10-16: Scape Shoreditch; Apple's geocoder gave these coordinates).
 * It is the default when known-places.json does not exist yet, so it is never written to disk by this code.
 * `orion-awareness place set home --lat 51.5273608 --lon -0.0865265 ...` installs it explicitly.
 */
export const SEEDED_HOME = Object.freeze({
  id: "home", name: "home", label: "Scape Shoreditch, 45 Brunswick Place, London N1 6DX",
  lat: 51.5273608, lon: -0.0865265, radiusM: 150, kind: "home",
  source: "nick-confirmed address", confirmedAt: "2026-10-16",
});

/** A place Nick himself gave or confirmed: nothing learned may override it without asking. */
export const isNickConfirmed = (place) => /^nick/.test(String(place?.source ?? ""));

export function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest known place whose radius holds the point, or null. */
export function matchPlace(point, places) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  const hits = (places ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((place) => ({ place, d: distanceM(point, place) }))
    .filter(({ place, d }) => d <= (place.radiusM ?? 120));
  return hits.sort((a, b) => a.d - b.d)[0]?.place ?? null;
}

/** known-places.json, or the seeded home when the file does not exist (or is not a places file). */
export function readKnownPlaces(dir) {
  const file = readJson(join(dir, FILE));
  return Array.isArray(file?.places) ? file.places : [SEEDED_HOME];
}

export function writeKnownPlaces(dir, places) {
  writeJsonAtomic(dir, FILE, { schema: "orion.known-places.v1", places });
}

const sampleOf = (s) => {
  const lat = Number(s?.latitude ?? s?.lat), lon = Number(s?.longitude ?? s?.lon);
  const at = new Date(s?.at);
  return Number.isFinite(lat) && Number.isFinite(lon) && !Number.isNaN(at.getTime()) ? { lat, lon, at } : null;
};
const cellKey = ({ lat, lon }) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

/**
 * Where his phone sleeps: the coordinate cell with the most distinct nights of charging samples
 * between 01:00 and 06:00 local, over the last `days` days. Needs `minNights` nights, else it
 * refuses (a proposal from a few nights would be a guess). Pure; the caller decides what to do with it.
 * @returns { lat, lon, cell, nights, samples } | { refused, nights }
 */
export function learnHome(samples, { now = new Date(), days = 14, minNights = 5 } = {}) {
  const since = now.getTime() - days * 86_400_000;
  const cells = new Map();
  for (const raw of samples ?? []) {
    const s = sampleOf(raw);
    if (!s || raw.charging !== true || s.at.getTime() < since || s.at.getTime() > now.getTime()) continue;
    const hour = s.at.getHours();
    if (hour < 1 || hour >= 6) continue;
    const key = cellKey(s);
    const cell = cells.get(key) ?? { key, nights: new Set(), points: [] };
    cell.nights.add(s.at.toLocaleDateString("en-CA"));
    cell.points.push(s);
    cells.set(key, cell);
  }
  const best = [...cells.values()].sort((a, b) => b.nights.size - a.nights.size || b.points.length - a.points.length)[0];
  if (!best) return { refused: "no overnight charging samples with a location", nights: 0 };
  if (best.nights.size < minNights) return { refused: `only ${best.nights.size} night(s) of evidence, need ${minNights}`, nights: best.nights.size };
  const mean = (f) => best.points.reduce((sum, p) => sum + f(p), 0) / best.points.length;
  return { lat: mean((p) => p.lat), lon: mean((p) => p.lon), cell: best.key, nights: best.nights.size, samples: best.points.length };
}

/**
 * What a learned home means for the places he already has. It confirms or refines a Nick-confirmed home
 * but never replaces it: a different spot is reported for Nick to decide.
 * @returns { action: "propose"|"confirms"|"refines"|"conflict", distanceM? }
 */
export function reconcileHome(learned, places) {
  const home = (places ?? []).find((p) => p.id === "home");
  if (!home) return { action: "propose" };
  const d = distanceM(learned, home);
  if (!isNickConfirmed(home)) return { action: d <= (home.radiusM ?? 120) ? "confirms" : "propose", distanceM: d };
  if (d <= 25) return { action: "confirms", distanceM: d };
  return { action: d <= (home.radiusM ?? 120) ? "refines" : "conflict", distanceM: d };
}
