import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixStatus, fixNeed, requestFix, phoneFixMeta, FILE, FIX_STALE_MS, ASK_EVERY_MS } from "../scripts/lib/awareness/fix-request.mjs";
import { calendarFacet, locationFacet } from "../scripts/lib/awareness/facets.mjs";
import { SEEDED_HOME } from "../scripts/lib/awareness/places.mjs";

// 2026-11-02 08:02 local: the morning the leave-for-class reminder stayed silent.
const NOW = new Date(2026, 10, 2, 8, 2, 0);
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const fix = (min, extra = {}) => ({ at: ago(min), charging: true, latitude: 51.518, longitude: -0.077, motion: "still", ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), "fix-req-"));
const cls = (startMin) => ({ title: "Lecture", start: startMin, end: startMin + 60, kind: "class", fixed: true, source: "calendar" });
const minute = NOW.getHours() * 60 + NOW.getMinutes();

test("fixStatus: the newest row WITH a location decides, and its age is reported", () => {
  const rows = [fix(3600), { at: ago(5), charging: false, motion: "walking" }];   // the newer row has no fix
  assert.deepEqual(fixStatus(rows, NOW), { lastFixAt: ago(3600), ageMin: 3600, stale: true });
  assert.equal(fixStatus([fix(5)], NOW).stale, false);
  assert.equal(fixStatus([fix(FIX_STALE_MS / 60_000 + 1)], NOW).stale, true);
  assert.deepEqual(fixStatus([], NOW), { lastFixAt: null, ageMin: null, stale: true }, "no fix ever is stale, not fresh");
  assert.deepEqual(fixStatus(undefined, NOW), { lastFixAt: null, ageMin: null, stale: true });
});

test("fixNeed: only when location has lapsed and a class or fixed plan is close", () => {
  // Built from the real producers, not hand-made facets (the consumer runs over what they emit).
  const unknown = locationFacet([fix(3600)], [], [SEEDED_HOME], NOW);
  assert.equal(unknown.state, "unknown", "a 2.5-day-old fix is no location");
  const soon = calendarFacet([cls(minute + 43)], [], NOW);
  assert.equal(fixNeed({ calendar: soon, location: unknown, now: NOW }), "class soon");
  assert.equal(fixNeed({ calendar: calendarFacet([cls(minute - 10)], [], NOW), location: unknown, now: NOW }), "class now");
  assert.equal(fixNeed({ calendar: calendarFacet([cls(minute + 200)], [], NOW), location: unknown, now: NOW }), null, "a class hours away needs nothing yet");
  assert.equal(fixNeed({ calendar: calendarFacet([{ ...cls(minute + 30), kind: "free", fixed: false }], [], NOW), location: unknown, now: NOW }), null, "a movable block is no reason");
  assert.equal(fixNeed({ calendar: calendarFacet(null, [], NOW), location: unknown, now: NOW }), null, "an unreadable calendar is no reason");
  const known = locationFacet([fix(5, { latitude: SEEDED_HOME.lat, longitude: SEEDED_HOME.lon })], [], [SEEDED_HOME], NOW);
  assert.equal(known.state, "home");
  assert.equal(fixNeed({ calendar: soon, location: known, now: NOW }), null, "a known location needs no fix");
});

test("requestFix: writes the Link's shape, and asks at most once per 10 minutes", () => {
  const dir = tmp();
  const first = requestFix(dir, { now: NOW, reason: "class soon", lastFixAt: ago(3600) });
  assert.equal(first.asked, true);
  const onDisk = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
  assert.deepEqual(onDisk, first.request);
  assert.match(onDisk.id, /^[A-Za-z0-9_-]{1,64}$/, "the id passes LocationRequest.isValidID");
  assert.equal(onDisk.at, NOW.toISOString());
  assert.equal(onDisk.reason, "class soon");
  const again = requestFix(dir, { now: new Date(NOW.getTime() + ASK_EVERY_MS - 1000), reason: "class soon" });
  assert.equal(again.asked, false);
  assert.equal(again.request.id, first.request.id);
  const later = requestFix(dir, { now: new Date(NOW.getTime() + ASK_EVERY_MS), reason: "class soon" });
  assert.equal(later.asked, true);
  assert.notEqual(later.request.id, first.request.id, "a new ask has a new id, so the phone answers it");
});

test("requestFix: a request stamped in the future (clock moved back) does not block asks", () => {
  const dir = tmp();
  writeFileSync(join(dir, FILE), JSON.stringify({ id: "fix-x", at: new Date(NOW.getTime() + 3600_000).toISOString() }));
  assert.equal(requestFix(dir, { now: NOW, reason: "class soon" }).asked, true);
});

test("phoneFixMeta: staleness and the standing ask in one line", () => {
  assert.deepEqual(phoneFixMeta({ lastFixAt: ago(60), ageMin: 60, stale: true }, { at: NOW.toISOString(), reason: "class soon" }),
    { lastAt: ago(60), ageMin: 60, stale: true, askedAt: NOW.toISOString(), askReason: "class soon" });
  assert.deepEqual(phoneFixMeta({ lastFixAt: null, ageMin: null, stale: true }, null), { lastAt: null, ageMin: null, stale: true, askedAt: null, askReason: null });
});

// The whole route: orion-awareness refresh, seams only (no real Mac, calendar or phone).
function harness(events) {
  const home = tmp();
  const dir = join(home, "controlled"); spawnSync("mkdir", ["-p", dir]);
  writeFileSync(join(home, "cal.json"), JSON.stringify(events));
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_SESSION_SOCKET: join(home, "none.sock"), ORION_REACH_NOW: NOW.toISOString(), ORION_REACH_BIN: "/usr/bin/true", ORION_PROACTIVE_BIN: "/usr/bin/true",
    ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false, displayAsleep: false }),
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json") };
  const bin = join(import.meta.dirname, "../scripts/orion-awareness");
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env });
  return { dir, run };
}
const calendarEvent = (startMin, title = "MKTG2201 Lecture") => {
  const start = new Date(NOW); start.setHours(0, startMin, 0, 0);
  return { identifier: "e1", title, start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString() };
};

test("refresh: a days-old fix with a class coming is logged in meta and asked for once", () => {
  const h = harness([calendarEvent(minute + 43)]);
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [fix(3934)] }));
  const r = h.run("refresh");
  assert.equal(r.status, 0, r.stderr);
  const aw = JSON.parse(readFileSync(join(h.dir, "awareness.json"), "utf8"));
  assert.equal(aw.location.state, "unknown");
  assert.equal(aw.meta.phoneFix.stale, true);
  assert.equal(aw.meta.phoneFix.ageMin, 3934);
  const shown = h.run("show").stdout;
  assert.match(shown, /phone fix 3934 min old/);
  // Whether the calendar export calls this a class decides the reason; either way a fixed block this close asks.
  assert.equal(aw.calendar.next?.kind, "class", "the fake calendar's lecture is read as a class");
  assert.ok(existsSync(join(h.dir, FILE)), "a fix was asked for");
  assert.equal(aw.meta.phoneFix.askedAt, NOW.toISOString());
  assert.equal(aw.meta.phoneFix.askReason, "class soon");
  assert.equal(JSON.parse(readFileSync(join(h.dir, FILE), "utf8")).lastFixAt, ago(3934));
});

test("refresh: a fresh fix asks for nothing and says nothing in show", () => {
  const h = harness([calendarEvent(minute + 43)]);
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [fix(2, { latitude: SEEDED_HOME.lat, longitude: SEEDED_HOME.lon })] }));
  assert.equal(h.run("refresh").status, 0);
  const aw = JSON.parse(readFileSync(join(h.dir, "awareness.json"), "utf8"));
  assert.equal(aw.meta.phoneFix.stale, false);
  assert.equal(existsSync(join(h.dir, FILE)), false);
  assert.doesNotMatch(h.run("show").stdout, /phone fix/);
});

// orion-reach: a message kept as a bubble only because home is unknown asks for a fix; one spoken or at home does not.
function reachWorld(phoneSignals, facts = { idleSeconds: 5, locked: false, displayAsleep: false, headphones: false }) {
  const home = tmp();
  const dir = join(home, "controlled"); spawnSync("mkdir", ["-p", dir]);
  writeFileSync(join(home, "cal.json"), "[]");
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals }));
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_REACH_NOW: NOW.toISOString(), ORION_REACH_FACTS: JSON.stringify(facts), ORION_REACH_OPEN_BIN: "/usr/bin/true", ORION_LIGHTS_BIN: "/usr/bin/true",
    ORION_SESSION_SOCKET: join(home, "no.sock"), ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json") };
  const reach = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-reach"), ...args], { encoding: "utf8", env, timeout: 60000 });
  return { dir, reach };
}

test("orion-reach: kept silent because home is unknown, with a stale fix: the phone is asked for a fresh one", () => {
  const w = reachWorld([fix(3934)]);
  const r = w.reach("Leave in 13 min for your lecture.", "--why", "test: stale fix");
  const row = readFileSync(join(w.dir, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.equal(row.channel, "mac-bubble", `${r.stdout}${r.stderr}`);
  const ask = JSON.parse(readFileSync(join(w.dir, FILE), "utf8"));
  assert.equal(ask.reason, "reminder held silent");
  assert.equal(ask.lastFixAt, ago(3934));
});

test("orion-reach: at home on a fresh fix it speaks and asks for nothing", () => {
  const w = reachWorld([fix(2, { latitude: SEEDED_HOME.lat, longitude: SEEDED_HOME.lon })]);
  w.reach("Leave in 13 min for your lecture.", "--why", "test: fresh fix");
  const row = readFileSync(join(w.dir, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.equal(row.channel, "mac-voice");
  assert.equal(existsSync(join(w.dir, FILE)), false);
});
