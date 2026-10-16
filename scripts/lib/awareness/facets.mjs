// Pure composers for each awareness facet (spec 3.1, contract C1). Every facet keeps the time of its SOURCE in `at`,
// so a reader can tell a two-hour-old phone sample from a fresh one. Staleness limits live here; unknown is never a guess.
import { isQuietNow, sleepWindowFor } from "../reach/quiet.mjs";
import { matchPlace } from "./places.mjs";

const MIN = 60_000;
export const LIMITS = Object.freeze({
  session: 90_000, calendar: 10 * MIN, locationSample: 20 * MIN, locationRegion: 12 * 3600_000,
  mac: 90_000, phone: 20 * MIN, audioMac: 90_000, audioPhone: 20 * MIN, sleep: 10 * MIN,
});
const MOVING = ["walking", "running", "cycling", "vehicle", "automotive"];

const ms = (at) => { const t = Date.parse(at); return Number.isNaN(t) ? null : t; };
/** True when `at` is a valid time no older than `limit` (a slightly future stamp is fine: clock skew). */
export const isFresh = (at, limit, now) => { const t = ms(at); return t !== null && now.getTime() - t <= limit; };
const localDate = (at) => at.toLocaleDateString("en-CA");
const iso = (d) => new Date(d).toISOString();
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();

export const UNKNOWN = Object.freeze({
  session: (at = null) => ({ state: "unknown", sessionId: null, phaseIndex: null, phaseEndsAt: null, task: null, at, source: null }),
  calendar: (at = null) => ({ state: "unknown", now: null, next: null, freeUntil: null, travelNow: null, at }),
  location: (at = null) => ({ state: "unknown", placeId: null, cell: null, since: null, at, source: null, homeKnown: false }),
  mac: (at = null) => ({ state: "unknown", idleSeconds: null, frontApp: null, workApp: null, at }),
  phone: (at = null) => ({ state: "unknown", charging: null, motion: null, lastSampleAt: null, at }),
  audio: (at = null) => ({ route: "unknown", headphones: null, device: null, at }),
  sleep: (at = null) => ({ state: "unknown", inWindow: null, wokeAt: null, bed: null, source: null, at }),
});

/** The reply of `orion-session status --json` (or the phase hook's session json); null when the app is unreachable. */
export function sessionFacet(status, now, { source = "socket", previous = null } = {}) {
  if (!status || typeof status !== "object" || status.unreadable) return UNKNOWN.session(iso(now));
  const state = { running: status.phase === "rest" ? "rest" : "focus", paused: "paused", "waiting-for-return": "waiting" }[status.status] ?? "none";
  const remaining = Number(status.remainingSeconds);
  const sameSession = previous?.state === state && previous?.sessionId === (status.sessionId ?? null);
  return {
    state, sessionId: status.sessionId ?? null, phaseIndex: Number.isFinite(status.phaseIndex) ? status.phaseIndex : null,
    phaseEndsAt: state === "focus" || state === "rest" ? (Number.isFinite(remaining) ? iso(now.getTime() + remaining * 1000) : null) : null,
    task: status.task ?? null, at: iso(now), source,
    // when a pause began: the gate holds the first 3 minutes of one
    ...(state === "paused" ? { since: sameSession && previous.since ? previous.since : iso(now) } : {}),
  };
}

const HOOK_STATES = ["focus", "rest", "paused", "waiting", "none"];
/**
 * The phase hook's `--session` (contract C3): the app sends the session FACET itself ({ state, sessionId, phaseIndex, phaseEndsAt,
 * task, at, source }, see PhaseCommands.sessionJSON), not the socket's status reply. The socket shape is still read, for callers
 * that pass `orion-session status --json`. Anything else is unknown.
 */
export function sessionFromHook(given, now, { previous = null } = {}) {
  if (!given || typeof given !== "object") return UNKNOWN.session(iso(now));
  if (!HOOK_STATES.includes(given.state)) return given.status ? sessionFacet(given, now, { source: "phase-hook", previous }) : UNKNOWN.session(iso(now));
  const sameSession = previous?.state === given.state && previous?.sessionId === (given.sessionId ?? null);
  const ends = ms(given.phaseEndsAt);
  return {
    state: given.state, sessionId: given.sessionId ?? null, phaseIndex: Number.isFinite(given.phaseIndex) ? given.phaseIndex : null,
    phaseEndsAt: (given.state === "focus" || given.state === "rest") && ends !== null ? iso(ends) : null,
    task: given.task ?? null, at: iso(now), source: "phase-hook",
    ...(given.state === "paused" ? { since: sameSession && previous.since ? previous.since : iso(now) } : {}),
  };
}

const blockOut = (b) => b && { title: b.title, start: b.start, end: b.end, kind: b.kind, fixed: !!b.fixed, source: b.source };

/** `day`: today's blocks, or null when the calendar could not be read (never "free"). `travel`: commute walls. */
export function calendarFacet(day, travel, now) {
  if (!Array.isArray(day)) return UNKNOWN.calendar(iso(now));
  const minute = minuteOf(now);
  const covering = day.filter((b) => b.start <= minute && b.end > minute);
  const on = covering.find((b) => b.fixed) ?? covering[0] ?? null;
  const next = day.filter((b) => b.start > minute).sort((a, b) => a.start - b.start)[0] ?? null;
  const wall = (travel ?? []).find((w) => w.start <= minute && w.end > minute);
  return { state: "ok", now: blockOut(on), next: blockOut(next), freeUntil: on ? null : next?.start ?? null, travelNow: wall?.title ?? null, at: iso(now) };
}

/** `activity`: focus-activity.json (+ optional locked / displayAsleep from the app); `lock`: a fallback ioreg flag. */
export function macFacet(activity, lock, now) {
  const a = activity && typeof activity === "object" ? activity : null;
  if (!a || !isFresh(a.at, LIMITS.mac, now)) return UNKNOWN.mac(a?.at ?? null);
  const idle = a.idleValid === false ? null : Number.isFinite(Number(a.idleSeconds)) ? Number(a.idleSeconds) : null;
  const locked = typeof a.locked === "boolean" ? a.locked : lock;
  const state = a.displayAsleep === true ? "asleep" : locked === true ? "locked" : idle === null ? "unknown" : idle < 300 ? "active" : "idle";
  return { state, idleSeconds: idle, frontApp: a.app ?? null, workApp: a.workApp ?? null, at: a.at };
}

/** `log`: health-log.json (phoneSignals, phoneScreen). */
export function phoneFacet(log, now) {
  const signal = (log?.phoneSignals ?? []).at(-1) ?? null;
  const screen = log?.phoneScreen && !Array.isArray(log.phoneScreen) ? log.phoneScreen : (log?.phoneScreen ?? []).at?.(-1) ?? null;
  const sigFresh = signal && isFresh(signal.at, LIMITS.phone, now), scrFresh = screen && isFresh(screen.at, LIMITS.phone, now);
  const at = [signal?.at, screen?.at].filter((x) => ms(x) !== null).sort().at(-1) ?? null;
  if (!sigFresh && !scrFresh) return { ...UNKNOWN.phone(at), lastSampleAt: signal?.at ?? null };
  const inUse = scrFresh && screen.locked === false && isFresh(screen.at, 5 * MIN, now);
  const charging = sigFresh && typeof signal.charging === "boolean" ? signal.charging : null;
  const motion = sigFresh ? signal.motion ?? null : null;
  const state = inUse ? "in-use" : MOVING.includes(motion) ? "moving" : charging === true ? "charging" : motion === "still" || charging === false ? "still" : "unknown";
  return { state, charging, motion, lastSampleAt: signal?.at ?? null, at };
}

/** The signals behind quiet hours, as the old presence.quietFacts computed them (moved here). */
function sleepSignals({ now, config, night, nights, mac, signal }) {
  const window = sleepWindowFor({ date: localDate(now), config, night, nights });
  const minute = minuteOf(now);
  const inWindow = isQuietNow({ minute, ...window });
  // An idle time that is missing or invalid is unknown, not "0 s idle" (Number(null) is 0): it never marks him up.
  const idle = mac.idleSeconds === null || mac.idleSeconds === undefined || mac.idleSeconds === "" ? NaN : Number(mac.idleSeconds);
  const macUp = !mac.locked && !mac.displayAsleep && Number.isFinite(idle) && idle < 300;
  const age = signal ? now - Date.parse(signal.at) : NaN;
  // one stray sample ("still", charging) is not "up": it takes the phone off the charger or real motion
  const phoneUp = !!signal && age >= 0 && age <= 5 * MIN && (signal.charging === false || MOVING.includes(signal.motion));
  return { window, inWindow, macUp, phoneUp };
}

/** `mac`: { idleSeconds, locked, displayAsleep }. `signal`: the last phoneSignals row. */
export function sleepFacet({ now, config, night = null, nights = [], mac, signal = null }) {
  const { window, inWindow, macUp, phoneUp } = sleepSignals({ now, config, night, nights, mac, signal });
  const state = !inWindow ? "awake" : macUp || phoneUp ? "late-awake" : "asleep";
  const source = nights.some((n) => n?.wokeAt) ? "whoop" : night?.days?.some((d) => d?.woke) ? "phone" : "window";
  return { state, inWindow, wokeAt: window.wokeAt, bed: window.bed, source, at: iso(now) };
}

/** The old presence.quietFacts shape, kept for its callers and tests. */
export function quietFacts({ now, dir, config, facts, night, nights, signal }) {
  const s = sleepSignals({ now, config, night, nights, mac: facts, signal });
  return { quiet: s.inWindow && !(s.macUp || s.phoneUp), lateAwake: s.inWindow && s.macUp, inWindow: s.inWindow };
}

const cellOf = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;
const toPlace = (places, id) => places.find((p) => p.id === id);
const fromPlace = (p, at, source, since) => ({
  state: p.kind === "home" || p.id === "home" ? "home" : "known", placeId: p.id, cell: null, since, at, source });

/**
 * Where he is: the newer of the last region event (up to 12 h) and the last sample with a fix (20 min).
 * `homeKnown` says whether any home place exists; without one `atHome` stays null.
 */
export function locationFacet(samples, placeEvents, knownPlaces, now) {
  const places = knownPlaces ?? [];
  const homeKnown = places.some((p) => p.id === "home");
  const fixes = (samples ?? []).filter((s) => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude)) && ms(s.at) !== null);
  const sample = fixes.at(-1);
  const event = (placeEvents ?? []).filter((e) => ms(e.at) !== null).sort((a, b) => ms(a.at) - ms(b.at)).at(-1);
  const sampleOk = sample && isFresh(sample.at, LIMITS.locationSample, now);
  const eventOk = event && isFresh(event.at, LIMITS.locationRegion, now);
  const newest = (a, b) => ms(a) >= ms(b);
  if (sampleOk && !(eventOk && newest(event.at, sample.at))) return fromSample(fixes, places, homeKnown, now);
  if (eventOk) {
    const p = toPlace(places, event.placeId);
    const base = event.event === "enter" && p ? fromPlace(p, event.at, "region", event.at)
      : { state: "elsewhere", placeId: null, cell: null, since: event.at, at: event.at, source: "region" };
    return { ...base, homeKnown };
  }
  return { ...UNKNOWN.location(sample?.at ?? event?.at ?? null), homeKnown };
}

function fromSample(fixes, places, homeKnown, now) {
  const sample = fixes.at(-1);
  const point = (s) => ({ lat: Number(s.latitude), lon: Number(s.longitude) });
  const here = matchPlace(point(sample), places);
  const cell = cellOf(point(sample).lat, point(sample).lon);
  // dwell: walk back through consecutive samples that were in the same place (or the same cell, away from every place)
  const same = (s) => { const m = matchPlace(point(s), places); return here ? m?.id === here.id : !m && cellOf(point(s).lat, point(s).lon) === cell; };
  let since = sample.at;
  for (let i = fixes.length - 1; i >= 0 && same(fixes[i]); i--) since = fixes[i].at;
  const moving = MOVING.includes(sample.motion);
  const state = moving ? "moving" : here ? (here.kind === "home" || here.id === "home" ? "home" : "known") : "elsewhere";
  return { state, placeId: here?.id ?? null, cell, since, at: sample.at, source: "sample", homeKnown };
}

/** `phoneSignals` rows with an optional `audio: { route, headphones }`. */
export function audioFacet(activity, phoneSignals, now) {
  const route = (r) => (["bluetooth", "wired", "speakers", "speaker", "airplay"].includes(r) ? r : "unknown");
  const hp = (r, given) => (r === "airplay" ? false : typeof given === "boolean" ? given : ["bluetooth", "wired"].includes(r) ? true : ["speakers", "speaker"].includes(r) ? false : null);
  const a = activity?.audio;
  let mac = UNKNOWN.audio(activity?.at ?? null);
  if (a && typeof a === "object" && isFresh(activity.at, LIMITS.audioMac, now)) {
    const r = route(a.route);
    mac = { route: r, headphones: hp(r, a.headphones), device: a.device ?? null, at: activity.at };
  }
  const row = [...(phoneSignals ?? [])].reverse().find((s) => s?.audio && typeof s.audio === "object");
  let phone = UNKNOWN.audio(row?.at ?? null);
  if (row && isFresh(row.at, LIMITS.audioPhone, now)) {
    const r = route(row.audio.route);
    phone = { route: r, headphones: hp(r, row.audio.headphones), device: row.audio.device ?? null, at: row.at };
  }
  return { mac, phone };
}

/** What the facets add up to. Unknown facets never produce a "yes". */
export function derive(aw) {
  const { session, calendar, location, mac, sleep, audio } = aw;
  const cls = calendar.now?.kind === "class";
  const activity = sleep.state === "asleep" ? "sleeping" : session.state === "focus" ? "focus" : session.state === "rest" ? "rest"
    : cls ? "class" : calendar.travelNow ? "commute" : calendar.now ? "busy" : calendar.state === "ok" ? "free" : "unknown";
  const atMac = mac.state === "active";
  const atHome = !location.homeKnown ? null : location.state === "home" ? true
    : location.state === "unknown" ? null : location.state === "moving" ? (location.placeId === "home" ? null : false) : false;
  const interruptible = ["sleeping", "focus", "class"].includes(activity) ? "urgent-only" : "yes";
  const speakOnMac = atMac && sleep.state !== "late-awake" && sleep.state !== "asleep" && (atHome === true || audio?.mac?.headphones === true);
  return { activity, atMac, atHome, interruptible, speakOnMac };
}
