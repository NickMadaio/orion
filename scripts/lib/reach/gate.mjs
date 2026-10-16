// One delivery gate for every script sender (awareness spec 3.2, contract C2): defer, don't drop.
// gate() is pure. loadAwareness() reads awareness.json (contract C1) with the staleness limits of
// spec 3.1, so a facet that is too old is `unknown`, and unknown never holds anything back.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { bypassesQuiet } from "./quiet.mjs";

/** Someone who paused is not focusing, but the first minutes of a pause still hold (Nick: 3 min). */
export const PAUSE_GRACE_MS = 3 * 60_000;

// Max age of a facet (spec 3.1 table) before it counts as unknown.
const LIMIT_MS = { session: 90_000, calendar: 10 * 60_000, sleep: 15 * 60_000, audioMac: 90_000, audioPhone: 20 * 60_000, locationSample: 20 * 60_000, locationRegion: 12 * 3600_000 };
const ms = (t) => (t instanceof Date ? t.getTime() : Number(t));
const age = (at, now) => { const t = Date.parse(at); return Number.isFinite(t) ? ms(now) - t : Infinity; };
const fresh = (facet, limit, now) => !!facet && age(facet.at, now) <= limit;

/**
 * Verdict for one message. Urgent kinds (a reminder he set, a class he is about to miss) always go.
 * A break (`rest`), `waiting`, `none` and `unknown` deliver: a break is when held things come out.
 * @returns {{ action: "deliver"|"hold", reason: string, heldFor?: "quiet"|"focus"|"class" }}
 */
export function gate(aw, { kind = null, urgentKind = null, now = Date.now() } = {}) {
  void kind;
  const t = ms(now);
  if (bypassesQuiet({ urgentKind })) return { action: "deliver", reason: "a reminder he set or a class he is about to miss always goes" };
  if (aw?.sleep?.state === "asleep") return { action: "hold", reason: "quiet hours - it waits until he is up", heldFor: "quiet" };
  const session = aw?.session;
  if (session?.state === "focus") return { action: "hold", reason: "a focus session is running - batched until a break", heldFor: "focus" };
  if (session?.state === "paused") {
    const since = Date.parse(session.since ?? session.pausedAt ?? session.at);
    if (!Number.isFinite(since) || t - since < PAUSE_GRACE_MS) return { action: "hold", reason: "a focus session is paused for under 3 min - batched", heldFor: "focus" };
  }
  const now_ = aw?.calendar?.state === "ok" ? aw.calendar.now : null;
  if (now_?.kind === "class" && now_.missed !== true) return { action: "hold", reason: "he is in class - batched until it ends", heldFor: "class" };
  return { action: "deliver", reason: session?.state === "rest" ? "he is on a break" : "nothing is in the way" };
}

const UNKNOWN = Object.freeze({ state: "unknown" });

/**
 * The lazy refresh (spec 3.1): when the file is older than 2 min, ask the one writer (`orion-awareness refresh`) for a
 * fresh one before deciding. A no-op where the writer is not installed or ORION_AWARENESS_NO_REFRESH=1 (tests).
 */
export function refreshIfOld({ dir, now = Date.now(), env = process.env, maxAgeMs = 120_000 }) {
  const bin = join(import.meta.dirname, "../../orion-awareness");
  if (env.ORION_AWARENESS_NO_REFRESH === "1" || !existsSync(bin)) return false;
  let at = NaN;
  try { at = Date.parse(JSON.parse(readFileSync(join(dir, "awareness.json"), "utf8")).at); } catch { /* no file: refresh */ }
  if (Number.isFinite(at) && ms(now) - at <= maxAgeMs) return false;
  return spawnSync(process.execPath, [bin, "refresh"], { env, timeout: 8000, stdio: "ignore" }).status === 0;
}

/** awareness.json with every facet that is past its limit turned into `unknown`. A missing or broken file is all unknown. */
export function loadAwareness({ dir, now = Date.now() }) {
  let raw = null;
  try { raw = JSON.parse(readFileSync(join(dir, "awareness.json"), "utf8")); } catch { /* none yet: everything is unknown */ }
  const keep = (name, limit) => (fresh(raw?.[name], limit, now) ? raw[name] : UNKNOWN);
  const location = raw?.location;
  const locLimit = location?.source === "region" ? LIMIT_MS.locationRegion : LIMIT_MS.locationSample;
  const audio = raw?.audio ?? {};
  return {
    schema: "orion.awareness.v1",
    session: keep("session", LIMIT_MS.session),
    calendar: keep("calendar", LIMIT_MS.calendar),
    sleep: keep("sleep", LIMIT_MS.sleep),
    location: fresh(location, locLimit, now) ? location : UNKNOWN,
    audio: {
      mac: fresh(audio.mac, LIMIT_MS.audioMac, now) ? audio.mac : { headphones: null },
      phone: fresh(audio.phone, LIMIT_MS.audioPhone, now) ? audio.phone : { headphones: null },
    },
  };
}

/** The old reader of the session (orion-session status) as a session facet. Unreachable is `unknown`: no session can be enforced. */
export function sessionFromStatus(s, now = Date.now()) {
  const at = new Date(ms(now)).toISOString();
  const state = s?.status === "running" ? (s.phase === "rest" ? "rest" : "focus")
    : s?.status === "paused" ? "paused"
    : s?.status === "waiting-for-return" ? "waiting"
    : s ? "none" : "unknown";
  return { state, at, source: "socket", ...(s?.pausedAt ? { pausedAt: s.pausedAt } : {}) };
}

function probeSession(env, now) {
  try {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../orion-session"), "status", "--json"], { encoding: "utf8", timeout: 4000, env });
    return sessionFromStatus(JSON.parse(r.stdout), now);
  } catch { return UNKNOWN; }
}

/**
 * What a sender gates on. The file wins where it is fresh; where it is not, the old sources fill in so nothing
 * regresses before the awareness writer runs: the session socket for the session, `legacy` ({ quiet, lateAwake },
 * what presence() knows about his sleep window) for sleep.
 * @param probe ask the session socket when the file has no fresh session (off for a dry run)
 */
export function resolveAwareness({ dir, now = Date.now(), env = process.env, legacy = null, probe = true }) {
  if (probe) refreshIfOld({ dir, now, env });   // a dry run changes nothing
  const aw = loadAwareness({ dir, now });
  const session = aw.session.state === "unknown" && probe ? probeSession(env, now) : aw.session;
  const sleep = aw.sleep.state !== "unknown" || !legacy ? aw.sleep
    : { state: legacy.quiet ? "asleep" : legacy.lateAwake ? "late-awake" : "awake", source: "window" };
  return { ...aw, session, sleep };
}

/** Where he is and what is in his ears, from awareness; null where unknown (null never allows speech on its own). */
export function audienceOf(aw) {
  const place = aw?.location;
  const atHome = place?.state === "home" ? true : ["known", "elsewhere", "moving"].includes(place?.state) ? (place.placeId === "home" ? true : false) : null;
  return { atHome, macHeadphones: aw?.audio?.mac?.headphones ?? null, phoneHeadphones: aw?.audio?.phone?.headphones ?? null };
}
