// Pure state machine. No I/O: (state, probes, now) -> { state, actions, alerts }.
// actions: { type: "relaunch", component } | { type: "warm" }
// alerts:  { type: "down" | "recovered", component, since }
import { ALERT_MIN_GAP_MS, BACKOFF_BASE_MS, BACKOFF_MAX_MS, COMPONENTS, RELAUNCH } from "./config.mjs";

export const emptyComponent = () => ({ status: "up", since: null, attempts: 0, lastAttemptAt: null, alertedDown: false });
export const emptyState = () => ({
  version: 1,
  components: Object.fromEntries(COMPONENTS.map((c) => [c, emptyComponent()])),
  lastAlertAt: null,
  pendingWarm: false,
});

/** Wait before relaunch attempt number attempts+1: 60s, 120s, 240s ... capped at 15 min. */
export const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

/** Normalise whatever was on disk; a corrupt file must degrade to "everything was up", not throw. */
export function normalise(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const components = Object.fromEntries(
    COMPONENTS.map((c) => [c, { ...emptyComponent(), ...(raw.components?.[c] ?? {}) }]),
  );
  return { ...base, components, lastAlertAt: raw.lastAlertAt ?? null, pendingWarm: raw.pendingWarm === true };
}

const relaunchDue = (comp, now) => !comp.lastAttemptAt || now - comp.lastAttemptAt >= backoffMs(comp.attempts);

/**
 * probes: { ollama, app, link, gateway } booleans.
 * The link is not kicked while the app is down: relaunching the app re-registers it.
 */
export function step(prev, probes, now) {
  const state = normalise(prev);
  const actions = [];
  const alerts = [];
  let lastAlertAt = state.lastAlertAt;
  let pendingWarm = state.pendingWarm;
  const components = {};

  for (const name of COMPONENTS) {
    const was = state.components[name];

    if (probes[name] === true) {
      if (was.status === "down") {
        if (was.alertedDown) alerts.push({ type: "recovered", component: name, since: was.since });
        if (name === "ollama") pendingWarm = true;
      }
      const since = was.status === "down" || !was.since ? now : was.since;
      components[name] = { ...emptyComponent(), since };
      continue;
    }

    const wasDown = was.status === "down";
    let comp = wasDown ? { ...was } : { ...emptyComponent(), status: "down", since: now };
    const canAct = name in RELAUNCH && !(name === "link" && probes.app !== true);
    if (canAct && relaunchDue(comp, now)) {
      actions.push({ type: "relaunch", component: name });
      comp = { ...comp, attempts: comp.attempts + 1, lastAttemptAt: now };
      if (name === "ollama") pendingWarm = true;
    }
    // Alert once a relaunch has had a full pass to work, or immediately-on-second-sight for things we never act on.
    const settled = wasDown && (was.attempts > 0 || !(name in RELAUNCH));
    if (!comp.alertedDown && settled) {
      const gapOk = lastAlertAt === null || now - lastAlertAt >= ALERT_MIN_GAP_MS;
      if (gapOk) {
        alerts.push({ type: "down", component: name, since: comp.since });
        comp = { ...comp, alertedDown: true };
        lastAlertAt = now;
      }
    }
    components[name] = comp;
  }

  if (probes.ollama === true && pendingWarm) actions.push({ type: "warm" });
  return { state: { ...state, components, lastAlertAt, pendingWarm }, actions, alerts };
}
