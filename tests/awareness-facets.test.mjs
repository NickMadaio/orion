import test from "node:test";
import assert from "node:assert/strict";
import { sessionFacet, calendarFacet, macFacet, phoneFacet, sleepFacet, locationFacet, audioFacet, derive, UNKNOWN, quietFacts } from "../scripts/lib/awareness/facets.mjs";
import { SEEDED_HOME } from "../scripts/lib/awareness/places.mjs";
import { sessionState, isSessionActive } from "../scripts/lib/reach/focus-hold.mjs";
import { parseHeadphones } from "../scripts/lib/reach/facts.mjs";

const now = new Date(2026, 9, 16, 14, 0, 0);
const ago = (sec) => new Date(now.getTime() - sec * 1000).toISOString();

test("session: a break is rest, focus is focus, the app being down is unknown", () => {
  assert.equal(sessionFacet({ status: "running", phase: "focus", remainingSeconds: 600, task: "essay" }, now).state, "focus");
  const rest = sessionFacet({ status: "running", phase: "rest", remainingSeconds: 120 }, now);
  assert.equal(rest.state, "rest");
  assert.equal(rest.phaseEndsAt, new Date(now.getTime() + 120_000).toISOString());
  assert.equal(sessionFacet({ status: "none" }, now).state, "none");
  assert.equal(sessionFacet({ status: "waiting-for-return" }, now).state, "waiting");
  assert.equal(sessionFacet(null, now).state, "unknown");
});

test("session: a pause remembers when it began", () => {
  const first = sessionFacet({ status: "paused", sessionId: "s1" }, new Date(now.getTime() - 200_000));
  const later = sessionFacet({ status: "paused", sessionId: "s1" }, now, { previous: first });
  assert.equal(later.since, first.since);
});

test("focus-hold: only focus (and a young pause) is active; a break is not", () => {
  assert.equal(sessionState({ status: "running", phase: "rest" }), "rest");
  assert.equal(isSessionActive({ status: "running", phase: "rest" }), false);
  assert.equal(isSessionActive({ status: "running", phase: "focus" }), true);
  assert.equal(isSessionActive({ status: "running" }), true, "no phase reported: treated as focus");
  assert.equal(isSessionActive({ status: "paused", pausedForMs: 60_000 }), true);
  assert.equal(isSessionActive({ status: "paused", pausedForMs: 200_000 }), false);
  assert.equal(isSessionActive({ status: "waiting-for-return" }), false);
  assert.equal(sessionState(null), "unknown");
  assert.equal(isSessionActive(null), false);
});

test("calendar: now, next and freeUntil; an unreadable day is unknown, never free", () => {
  const day = [{ title: "Gym", start: 600, end: 690, kind: "gym", fixed: false, source: "orion" }, { title: "CS", start: 960, end: 1050, kind: "class", fixed: true, source: "calendar" }];
  const f = calendarFacet(day, [], now);
  assert.equal(f.state, "ok");
  assert.equal(f.now, null);
  assert.equal(f.next.title, "CS");
  assert.equal(f.freeUntil, 960);
  assert.equal(calendarFacet(day, [{ start: 800, end: 900, title: "commute to class" }], now).travelNow, "commute to class");
  assert.equal(calendarFacet(null, [], now).state, "unknown");
  assert.equal(calendarFacet(null, [], now).freeUntil, null);
});

test("mac: fresh activity is active or idle; a stale file is unknown", () => {
  assert.equal(macFacet({ at: ago(20), idleSeconds: 3, idleValid: true, app: "Claude" }, null, now).state, "active");
  assert.equal(macFacet({ at: ago(20), idleSeconds: 900, idleValid: true }, null, now).state, "idle");
  assert.equal(macFacet({ at: ago(20), idleSeconds: 3, locked: true }, null, now).state, "locked");
  assert.equal(macFacet({ at: ago(20), idleSeconds: 0, idleValid: false }, null, now).state, "unknown");
  const stale = macFacet({ at: ago(200), idleSeconds: 3, idleValid: true }, null, now);
  assert.equal(stale.state, "unknown");
  assert.equal(stale.idleSeconds, null);
  assert.equal(macFacet(null, null, now).state, "unknown");
});

test("phone: a 3-hour-old sample is not now", () => {
  assert.equal(phoneFacet({ phoneSignals: [{ at: ago(60), charging: true, motion: "still" }] }, now).state, "charging");
  assert.equal(phoneFacet({ phoneSignals: [{ at: ago(60), charging: false, motion: "walking" }] }, now).state, "moving");
  const old = phoneFacet({ phoneSignals: [{ at: ago(10800), charging: true, motion: "walking" }] }, now);
  assert.equal(old.state, "unknown");
  assert.equal(old.charging, null);
  assert.equal(phoneFacet({ phoneSignals: [{ at: ago(10800), charging: true }], phoneScreen: { at: ago(30), locked: false } }, now).state, "in-use");
});

test("audio.mac comes from focus-activity.json and goes unknown after 90 s", () => {
  const fresh = audioFacet({ at: ago(30), audio: { route: "bluetooth", device: "AirPods Pro", headphones: true } }, [], now);
  assert.deepEqual([fresh.mac.route, fresh.mac.headphones, fresh.mac.device], ["bluetooth", true, "AirPods Pro"]);
  const stale = audioFacet({ at: ago(100), audio: { route: "bluetooth", headphones: true } }, [], now);
  assert.equal(stale.mac.route, "unknown");
  assert.equal(stale.mac.headphones, null);
  assert.equal(audioFacet({ at: ago(5), audio: { route: "speakers" } }, [], now).mac.headphones, false);
  assert.equal(audioFacet({ at: ago(5), audio: { route: "airplay", headphones: true } }, [], now).mac.headphones, false, "AirPlay is a speaker");
  assert.equal(audioFacet({ at: ago(5) }, [], now).mac.headphones, null, "no audio field");
});

test("audio.phone comes from the newest phone row with audio, and goes unknown after 20 min", () => {
  const rows = [{ at: ago(300), audio: { route: "bluetooth" } }, { at: ago(60), charging: false }];
  const a = audioFacet(null, rows, now).phone;
  assert.deepEqual([a.route, a.headphones, a.at], ["bluetooth", true, ago(300)]);
  assert.equal(audioFacet(null, [{ at: ago(1500), audio: { route: "bluetooth" } }], now).phone.headphones, null);
  assert.equal(audioFacet(null, [], now).phone.route, "unknown");
});

test("parseHeadphones: Bluetooth counts, AirPlay does not", () => {
  const out = (transport, name) => JSON.stringify({ SPAudioDataType: [{ _items: [{ _name: name, coreaudio_default_audio_output_device: "spaudio_yes", coreaudio_device_transport: transport }] }] });
  assert.equal(parseHeadphones(out("coreaudio_device_type_bluetooth", "Buds")), true);
  assert.equal(parseHeadphones(out("coreaudio_device_type_airplay", "Kitchen")), false);
  assert.equal(parseHeadphones(out("coreaudio_device_type_builtin", "MacBook Speakers")), false);
});

test("location: a fix at home, away, moving; stale is unknown; no home means atHome null", () => {
  const places = [SEEDED_HOME];
  const fix = (sec, lat, lon, extra = {}) => ({ at: ago(sec), latitude: lat, longitude: lon, ...extra });
  assert.equal(locationFacet([fix(60, 51.528, -0.087)], [], places, now).state, "home");
  const away = locationFacet([fix(900, 51.6, -0.2), fix(60, 51.6, -0.2)], [], places, now);
  assert.equal(away.state, "elsewhere");
  assert.equal(away.since, ago(900));
  assert.equal(locationFacet([fix(60, 51.6, -0.2, { motion: "walking" })], [], places, now).state, "moving");
  assert.equal(locationFacet([fix(1500, 51.6, -0.2)], [], places, now).state, "unknown", "away goes stale after 20 min");
  const none = locationFacet([fix(60, 51.6, -0.2)], [], [], now);
  assert.equal(derive({ ...base(), location: none }).atHome, null);
});

test("location: a region event stands for up to 12 h; the newer of event and sample wins", () => {
  const places = [SEEDED_HOME];
  const enter = { at: ago(3 * 3600), event: "enter", placeId: "home" };
  assert.equal(locationFacet([], [enter], places, now).state, "home");
  assert.equal(locationFacet([], [{ ...enter, at: ago(13 * 3600) }], places, now).state, "unknown");
  assert.equal(locationFacet([], [{ at: ago(60), event: "exit", placeId: "home" }], places, now).state, "elsewhere");
  const sample = { at: ago(30), latitude: 51.6, longitude: -0.2 };
  assert.equal(locationFacet([sample], [enter], places, now).state, "elsewhere");
});

function base() {
  return { session: UNKNOWN.session(), calendar: UNKNOWN.calendar(), location: UNKNOWN.location(), mac: UNKNOWN.mac(), phone: UNKNOWN.phone(),
    audio: { mac: UNKNOWN.audio(), phone: UNKNOWN.audio() }, sleep: UNKNOWN.sleep() };
}

test("derive: speakOnMac needs the Mac, no late-awake, and home or headphones", () => {
  const at = (extra) => derive({ ...base(), mac: { ...UNKNOWN.mac(), state: "active" }, ...extra });
  const home = { ...UNKNOWN.location(), state: "home", homeKnown: true };
  const cases = [
    [{ location: home }, true], [{}, false],
    [{ audio: { mac: { ...UNKNOWN.audio(), headphones: true }, phone: UNKNOWN.audio() } }, true],
    [{ audio: { mac: UNKNOWN.audio(), phone: { ...UNKNOWN.audio(), headphones: true } } }, false],
    [{ location: home, sleep: { ...UNKNOWN.sleep(), state: "late-awake" } }, false],
  ];
  for (const [extra, want] of cases) assert.equal(at(extra).speakOnMac, want, JSON.stringify(extra));
  assert.equal(derive({ ...base(), location: home }).speakOnMac, false, "Mac not active");
});

test("derive: activity", () => {
  const cal = (n, travel = null) => ({ state: "ok", now: n, next: null, freeUntil: null, travelNow: travel, at: "x" });
  const a = (extra) => derive({ ...base(), ...extra }).activity;
  assert.equal(a({}), "unknown");
  assert.equal(a({ calendar: cal(null) }), "free");
  assert.equal(a({ calendar: cal({ kind: "class" }) }), "class");
  assert.equal(a({ calendar: cal(null, "commute home") }), "commute");
  assert.equal(a({ calendar: cal({ kind: "class" }), session: { ...UNKNOWN.session(), state: "focus" } }), "focus");
  assert.equal(a({ sleep: { ...UNKNOWN.sleep(), state: "asleep" } }), "sleeping");
});

test("sleep: inside the window with no sign of life is asleep; Mac input makes him late-awake", () => {
  const config = { bedtime: "00:00", usualWake: "09:00" };
  const night = new Date(2026, 9, 16, 3, 0);
  const s = (mac, signal = null) => sleepFacet({ now: night, config, mac, signal }).state;
  assert.equal(s({ idleSeconds: 9999, locked: true }), "asleep");
  assert.equal(s({ idleSeconds: 5, locked: false }), "late-awake");
  assert.equal(sleepFacet({ now: new Date(2026, 9, 16, 14, 0), config, mac: { idleSeconds: 9999 } }).state, "awake");
});

// Review 6: Number(null) < 300 made an unreadable idle time count as "at the Mac".
test("an invalid or missing idle time is unknown: it does not make him late-awake inside the sleep window", () => {
  const night = new Date(2026, 9, 16, 3, 0);
  const config = { bedtime: "00:00", usualWake: "09:00" };
  for (const idleSeconds of [null, undefined, "", "x", NaN]) {
    assert.equal(sleepFacet({ now: night, config, mac: { idleSeconds, locked: false, displayAsleep: false } }).state, "asleep", String(idleSeconds));
  }
  assert.equal(sleepFacet({ now: night, config, mac: { idleSeconds: 5, locked: false, displayAsleep: false } }).state, "late-awake");
  assert.equal(quietFacts({ now: night, dir: "x", config, facts: { idleSeconds: null, locked: false } }).quiet, true);
});

// Rows as the phone sent them on 2026-10-20 (each arrived twice); the refresh ran at 09:57Z.
const row = (at, extra = {}) => ({ at, charging: false, latitude: 51.528, longitude: -0.087, motion: "unknown", ...extra });
const live = [row("2026-10-20T07:35:00Z"), row("2026-10-20T07:35:00Z"), row("2026-10-20T08:21:26Z"), row("2026-10-20T08:21:26Z")];
const at0957 = new Date("2026-10-20T09:57:00Z");
const macActive = { state: "active" };

test("location: the 08:21Z home fix still means home at the 09:57Z refresh, source sample, duplicates ignored", () => {
  const loc = locationFacet(live, [], [SEEDED_HOME], at0957);
  assert.equal(loc.state, "home");
  assert.equal(loc.source, "sample");
  assert.equal(loc.since, "2026-10-20T07:35:00Z");
  assert.equal(derive({ ...base(), location: loc }).atHome, true);
});

test("location: an away sample, an exit event, or a 4 h gap ends 'home'", () => {
  const away = row("2026-10-20T09:45:00Z", { latitude: 51.6, longitude: -0.2 });
  assert.equal(locationFacet([...live, away], [], [SEEDED_HOME], at0957).state, "elsewhere");
  assert.equal(locationFacet([...live, away], [], [SEEDED_HOME], new Date("2026-10-20T10:10:00Z")).state, "unknown", "20 min limit for away");
  const exit = { at: "2026-10-20T09:00:00Z", event: "exit", placeId: "home" };
  assert.equal(locationFacet(live, [exit], [SEEDED_HOME], at0957).state, "elsewhere");
  assert.equal(locationFacet(live, [{ ...exit, at: "2026-10-20T08:00:00Z" }], [SEEDED_HOME], at0957).state, "home", "a later fix beats an older exit");
  const gap = new Date("2026-10-20T12:30:00Z"); // 4 h 9 min after the last fix
  assert.equal(locationFacet(live, [], [SEEDED_HOME], gap).state, "unknown", "no Mac activity: lapsed");
  assert.equal(locationFacet(live, [], [SEEDED_HOME], gap, { mac: macActive }).state, "home", "Mac activity holds it");
  const moved = [...live, row("2026-10-20T08:30:00Z", { motion: "walking" })];
  assert.equal(locationFacet(moved, [], [SEEDED_HOME], gap, { mac: macActive }).state, "unknown", "he was moving: Mac activity does not hold it");
  assert.equal(locationFacet(live, [], [SEEDED_HOME], new Date("2026-10-21T00:00:00Z"), { mac: macActive }).state, "unknown", "12 h ceiling");
});

test("phone: a 96-minute-old sample (45 min cadence) is still the phone's state", () => {
  const p = phoneFacet({ phoneSignals: live }, at0957);
  assert.equal(p.state, "still");
  assert.equal(p.lastSampleAt, "2026-10-20T08:21:26Z");
  assert.equal(phoneFacet({ phoneSignals: live }, new Date("2026-10-20T10:30:00Z")).state, "unknown");
});
