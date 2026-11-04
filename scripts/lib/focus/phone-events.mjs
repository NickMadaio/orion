/*
 What the phone says during a focus session, acted on by the Mac (2026-11-04).

 The phone sends LinkLog.focus reports; Link stores them as `phoneFocusEvents` in health-log.json: pickup, need-app, finish, pause, resume,
 break. Link itself already carried finish, pause, resume and break to the session engine, so those need nothing more here except the
 early-finish question after a finish. This reads the rest:
   pickup     he picked up the phone during focus: one quiet nudge ("Back to <task> — N min left"), at most once per 10 minutes
   need-app   which app? asked on the phone; the answer arrives as a chat turn (focus-ready.ts adds it to the session and the task profile)
   finish     the same question the Done early button asks: break now, or the next task? (focus-ready.ts answers it)
 Pure: the planner returns the actions; guard.mjs runs them. A report is handled once and never after it has gone stale; the first look at
 the log (no cursor) marks what is there as seen, so ORION never replays an hour-old pickup.
*/
export const PICKUP_EVERY_MS = 10 * 60_000;
export const STALE_EVENT_MS = 5 * 60_000;
const SEEN_KEEP = 40;

export const initialPhoneState = () => ({ cursorMs: null, seen: [], lastPickupMs: 0 });
const keyOf = (e) => `${e.action}|${e.at}|${e.session ?? ""}`;

/** {events, state, web, nowMs} -> {state, actions: [{kind:"notify",id,text} | {kind:"pending",pending}]}. Never mutates its input. */
export function planPhoneEvents({ events, state, web, nowMs }) {
  const list = (Array.isArray(events) ? events : []).map((e) => ({ e, ms: Date.parse(e?.at) })).filter((x) => x.e?.action && Number.isFinite(x.ms)).sort((a, b) => a.ms - b.ms);
  const seen = new Set(state.seen ?? []);
  const newest = list.at(-1)?.ms ?? state.cursorMs;
  if (state.cursorMs === null || state.cursorMs === undefined) {
    return { state: { ...state, cursorMs: newest ?? nowMs, seen: list.map((x) => keyOf(x.e)).slice(-SEEN_KEEP) }, actions: [] };
  }
  const actions = [];
  let lastPickupMs = state.lastPickupMs ?? 0;
  const focusing = !!web?.active && web.phase === "focus";
  for (const { e, ms } of list) {
    const key = keyOf(e);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ms < state.cursorMs || nowMs - ms > STALE_EVENT_MS || !web?.active) continue;
    if (e.action === "pickup" && focusing && nowMs - lastPickupMs >= PICKUP_EVERY_MS) {
      lastPickupMs = nowMs;
      const left = web.phaseEnd ? Math.max(1, Math.ceil((Date.parse(web.phaseEnd) - nowMs) / 60_000)) : null;
      actions.push({ kind: "notify", id: `focus-pickup-${nowMs}`, text: `Back to ${web.task}${left ? ` — ${left} min left` : ""}` });
    } else if (e.action === "need-app") {
      actions.push({ kind: "notify", id: `focus-needapp-${nowMs}`, text: `Which app do you need for ${web.task}?` });
      actions.push({ kind: "pending", pending: { kind: "apps", task: web.task, at: nowMs } });
    } else if (e.action === "finish") {
      actions.push({ kind: "notify", id: `focus-finish-${nowMs}`, text: "Nice. Start your break now, or move to your next task?" });
      actions.push({ kind: "pending", pending: { kind: "early", task: web.task, askNext: true, marked: false, at: nowMs } });
    }
  }
  return { state: { cursorMs: Math.max(state.cursorMs, newest ?? 0), seen: [...seen].slice(-SEEN_KEEP), lastPickupMs }, actions };
}
