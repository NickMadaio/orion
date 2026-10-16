// Is a focus session running right now? (2026-10-16 audit: check-ins, the morning
// brief, Discord heads-ups and watchers all ignored it.) Reads awareness.json when its
// session facet is fresh (90 s, kept current by the app's phase hook), else asks the app
// through orion-session, the one reader of the session socket. Unknown means "no".
// A break is not focus: messages held during a session come out when it starts (2026-10-16).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readAwareness, controlledDir } from "../awareness/state.mjs";

/** A pause this young still counts as focus; Nick confirmed 3 minutes. */
export const PAUSE_GRACE_MS = 3 * 60_000;

/** focus | rest | paused | waiting | none | unknown, from an `orion-session status --json` reply. */
export function sessionState(s) {
  if (!s || typeof s !== "object" || s.unreadable) return "unknown";
  if (s.status === "running") return s.phase === "rest" ? "rest" : "focus";
  if (s.status === "paused") return "paused";
  if (s.status === "waiting-for-return") return "waiting";
  return "none";
}

/** Focus, or paused for under 3 minutes. `pausedForMs` is unknown from the socket alone: then a pause counts as active. */
export function isSessionActive(s) {
  const state = sessionState(s);
  if (state === "focus") return true;
  if (state !== "paused") return false;
  return !(Number.isFinite(s.pausedForMs) && s.pausedForMs >= PAUSE_GRACE_MS);
}

function fromAwareness(env) {
  const dir = env.ORION_CONTROLLED_DIR || controlledDir();
  const now = env.ORION_REACH_NOW ? new Date(env.ORION_REACH_NOW) : new Date();
  const { session } = readAwareness({ dir, now });
  if (session.state === "unknown") return undefined;
  const status = { focus: { status: "running", phase: "focus" }, rest: { status: "running", phase: "rest" },
    paused: { status: "paused", pausedForMs: now - Date.parse(session.since ?? session.at) }, waiting: { status: "waiting-for-return" }, none: { status: "none" } }[session.state];
  const s = { ...status, task: session.task, sessionId: session.sessionId };
  return isSessionActive(s) ? s : null;
}

export function activeSession(env = process.env) {
  try {
    const known = fromAwareness(env);
    if (known !== undefined) return known;
  } catch {}
  try {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../orion-session"), "status", "--json"], { encoding: "utf8", timeout: 4000, env });
    const s = JSON.parse(r.stdout);
    return isSessionActive(s) ? s : null;
  } catch { return null; }
}
