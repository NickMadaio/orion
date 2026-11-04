// Keeping the Mac shut down through the bedtime window (2026-11-04). Pure: no clock, no files, no processes.
// Nick: "when he asked if I wanted him to shut everything down and I said yes, make sure he actually can... if I'm on my computer he should
// be shutting that down." After a shutdown (his yes, or the lockdown rung) the guard watches the Mac: if it wakes and is used inside tonight's
// window it nudges ONCE, quietly, then locks again two minutes later. A pass ("i need 20 more minutes") holds it off for a while; the manual
// override ("leave my computer alone tonight") holds it off until the window ends. The phone is not touched here: it stays lenient.
const MIN = 60_000;
export const NUDGE_LEAD_MIN = 2;
export const PASS_MAX_MIN = 60;
/** Mac counts as in use when unlocked, display on, and touched within this many seconds. */
export const IN_USE_IDLE_SECONDS = 180;

export const emptyState = () => ({ night: null, armed: false, override: false, passUntil: null, nudgedAt: null, lockedAt: null });

/** Arm the guard for this window. A different night starts clean (override and pass never carry over). */
export function armNight(state, window, now) {
  const night = window.start.toISOString();
  const base = state?.night === night ? state : emptyState();
  return { ...base, night, armed: true, armedAt: now.toISOString() };
}

export function macInUse(mac) {
  const idle = mac?.idleSeconds == null ? NaN : Number(mac.idleSeconds);
  return mac?.locked === false && mac?.displayAsleep !== true && Number.isFinite(idle) && idle < IN_USE_IDLE_SECONDS;
}

export const passActive = (state, now) => !!state?.passUntil && now.getTime() < Date.parse(state.passUntil);

/** A time-limited pass: replaces any earlier one, capped, and cancels a nudge that is waiting to turn into a lock. */
export function grantPass(state, minutes, now) {
  const asked = Math.max(1, Math.round(Number(minutes) || 0));
  const given = Math.min(asked, PASS_MAX_MIN);
  const passUntil = new Date(now.getTime() + given * MIN).toISOString();
  return { state: { ...state, passUntil, nudgedAt: null }, minutes: given, capped: given < asked, until: passUntil };
}

export const setOverride = (state, on) => ({ ...state, override: !!on, nudgedAt: null });

/**
 * One tick. Returns { action: "none" | "nudge" | "lock", state, why }.
 * nudge: say it once, quietly. lock: the two minutes are up and he is still on it.
 */
export function guardStep({ now, window, state, mac }) {
  const st = state ?? emptyState();
  const idle = (why, next = st) => ({ action: "none", state: next, why });
  if (!window || window.reason || now >= window.end) return idle("outside the window");
  if (!st.armed || st.night !== window.start.toISOString()) return idle("not armed tonight");
  if (st.override) return idle("override");
  if (passActive(st, now)) return idle("pass");
  if (!macInUse(mac)) return idle("not in use", st.nudgedAt ? { ...st, nudgedAt: null } : st);
  if (!st.nudgedAt) return { action: "nudge", state: { ...st, nudgedAt: now.toISOString() }, why: "woke and in use" };
  if (now.getTime() - Date.parse(st.nudgedAt) >= NUDGE_LEAD_MIN * MIN) return { action: "lock", state: { ...st, nudgedAt: null, lockedAt: now.toISOString() }, why: "still in use after the nudge" };
  return idle("waiting out the two minutes");
}
