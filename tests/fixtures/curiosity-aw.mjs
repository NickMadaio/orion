// A literal awareness snapshot (contract C1) for the curiosity tests, fresh at `now`. Overrides merge per facet.
export function aw(now, over = {}) {
  const at = new Date(now).toISOString();
  const base = {
    schema: "orion.awareness.v1", at,
    session: { state: "none", sessionId: null, phaseIndex: null, phaseEndsAt: null, task: null, at, source: "socket" },
    calendar: { state: "ok", now: null, next: null, freeUntil: null, travelNow: null, at },
    location: { state: "home", placeId: "home", cell: null, since: at, at, source: "region", homeKnown: true },
    mac: { state: "active", idleSeconds: 5, frontApp: "Safari", workApp: null, at },
    phone: { state: "still", charging: false, motion: "still", lastSampleAt: at, at },
    audio: { mac: { route: "speakers", headphones: false, device: null, at }, phone: { route: "unknown", headphones: null, device: null, at } },
    sleep: { state: "awake", inWindow: false, wokeAt: 480, bed: 1425, source: "whoop", at },
  };
  const merged = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, over[k] && typeof v === "object" && !["schema", "at"].includes(k) ? { ...v, ...over[k] } : v]));
  const loc = merged.location;
  const atHome = !loc.homeKnown ? null : loc.state === "home" ? true : loc.state === "unknown" ? null : false;
  return { ...merged, derived: { activity: "free", atMac: merged.mac.state === "active", atHome, interruptible: "yes",
    speakOnMac: merged.mac.state === "active" && (atHome === true || merged.audio.mac.headphones === true), ...(over.derived ?? {}) } };
}
