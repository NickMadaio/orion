// One delivery gate for every script sender (awareness spec 3.2, contract C2): defer, don't drop.
// gate() is pure. The facts come from the one reader (awareness/state.mjs readAwareness, contract C1): a facet
// past its limit (spec 3.1) is `unknown`, and unknown never holds anything back.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { bypassesQuiet } from "./quiet.mjs";
import { readAwareness, refreshIfOld } from "../awareness/state.mjs";

/** Someone who paused is not focusing, but the first minutes of a pause still hold (Nick: 3 min). */
export const PAUSE_GRACE_MS = 3 * 60_000;

const ms = (t) => (t instanceof Date ? t.getTime() : Number(t));

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
  const at = new Date(ms(now));
  if (probe) refreshIfOld({ dir, now: at, env });   // a dry run changes nothing
  const aw = readAwareness({ dir, now: at });
  // A session that holds things is asked again live (cheap) so a session that just ended releases at once, not up to
  // 90 s later; where the socket is unreachable the file's answer stands.
  const holding = ["focus", "paused"].includes(aw.session.state);
  const live = probe && (aw.session.state === "unknown" || holding) ? probeSession(env, now) : null;
  const session = live && (live.state !== "unknown" || aw.session.state === "unknown") ? live : aw.session;
  // The file's `asleep` can be minutes old; presence() (live Mac facts, orion-reach only) sees him at the Mac inside his
  // window sooner, and that wins. It only ever loosens, and only on live evidence of him being up.
  const upNow = aw.sleep.state === "asleep" && legacy?.inWindow === true && legacy.lateAwake === true;
  const sleep = upNow ? { ...aw.sleep, state: "late-awake", source: "live" }
    : aw.sleep.state !== "unknown" || !legacy ? aw.sleep
    : { state: legacy.quiet ? "asleep" : legacy.lateAwake ? "late-awake" : "awake", source: "window" };
  return { ...aw, session, sleep };
}

/** Where he is and what is in his ears, from awareness; null where unknown (null never allows speech on its own). */
export function audienceOf(aw) {
  const place = aw?.location;
  const atHome = place?.state === "home" ? true : ["known", "elsewhere", "moving"].includes(place?.state) ? (place.placeId === "home" ? true : false) : null;
  return { atHome, macHeadphones: aw?.audio?.mac?.headphones ?? null, phoneHeadphones: aw?.audio?.phone?.headphones ?? null };
}
