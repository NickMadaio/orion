import test from "node:test";
import { readFileSync as readFx } from "node:fs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { overnightCharging, daytime, HOME, CAMPUS } from "./fixtures/health-log.mjs";

const bin = join(import.meta.dirname, "../scripts/orion-awareness");
const NOW = new Date(2026, 9, 16, 14, 0, 0);
const ago = (sec) => new Date(NOW.getTime() - sec * 1000).toISOString();

function harness() {
  const home = mkdtempSync(join(tmpdir(), "aw-cli-"));
  const dir = join(home, "controlled"); spawnSync("mkdir", ["-p", dir]);
  writeFileSync(join(home, "cal.json"), "[]");
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  const recorder = (name) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\necho "$@" >> "${p}.log"\n`); chmodSync(p, 0o755); return p; };
  const reach = recorder("fake-reach"), proactive = recorder("fake-proactive");
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_SESSION_SOCKET: join(home, "none.sock"), ORION_REACH_NOW: NOW.toISOString(), ORION_REACH_BIN: reach, ORION_PROACTIVE_BIN: proactive,
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json") };
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env });
  const json = (f, v) => writeFileSync(join(dir, f), JSON.stringify(v));
  const calls = (name) => { const f = `${join(home, name)}.log`; return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n") : []; };
  const wait = async (name, n = 1) => { for (let i = 0; i < 60 && calls(name).length < n; i++) await new Promise((r) => setTimeout(r, 50)); return calls(name); };
  return { home, dir, env, run, json, calls, wait, aw: () => JSON.parse(readFileSync(join(dir, "awareness.json"), "utf8")) };
}

test("refresh composes every facet from the files, and audio comes from focus-activity.json and the phone rows", () => {
  const h = harness();
  h.json("focus-activity.json", { at: ago(10), app: "Claude", workApp: "Claude", idleSeconds: 2, idleValid: true, audio: { route: "bluetooth", device: "AirPods Pro", headphones: true } });
  h.json("health-log.json", { phoneSignals: [{ at: ago(120), charging: false, motion: "walking", latitude: 51.6, longitude: -0.2, audio: { route: "speaker" } }], phoneScreen: { at: ago(4000), locked: true } });
  const r = h.run("refresh");
  assert.equal(r.status, 0, r.stderr);
  const aw = h.aw();
  assert.equal(aw.mac.state, "active");
  assert.equal(aw.mac.frontApp, "Claude");
  assert.deepEqual([aw.audio.mac.route, aw.audio.mac.headphones, aw.audio.mac.device], ["bluetooth", true, "AirPods Pro"]);
  assert.deepEqual([aw.audio.phone.route, aw.audio.phone.headphones], ["speaker", false]);
  assert.equal(aw.phone.state, "moving");
  assert.equal(aw.location.state, "moving");
  assert.equal(aw.session.state, "unknown", "no app, no socket: unknown, not none");
  assert.equal(aw.calendar.state, "ok");
  assert.equal(aw.derived.speakOnMac, true);
});

test("audio facet goes stale: a focus-activity.json older than 90 s gives headphones null", () => {
  const h = harness();
  h.json("focus-activity.json", { at: ago(200), idleSeconds: 2, idleValid: true, audio: { route: "bluetooth", headphones: true } });
  h.run("refresh");
  assert.equal(h.aw().audio.mac.headphones, null);
  const shown = JSON.parse(h.run("show", "--json").stdout);
  assert.equal(shown.audio.mac.route, "unknown");
});

test("refresh runs in under 300 ms with a cached calendar and no system_profiler", () => {
  const h = harness();
  h.json("focus-activity.json", { at: ago(5), idleSeconds: 2, idleValid: true, locked: false, audio: { route: "speakers", headphones: false } });
  h.run("refresh");   // primes the calendar
  const env = { ...h.env, ORION_BRIDGE_BIN: "/nonexistent" };   // a calendar read would now fail: it must come from the cache
  const times = Array.from({ length: 3 }, () => { const t = Date.now(); const r = spawnSync(process.execPath, [bin, "refresh"], { encoding: "utf8", env }); assert.equal(r.status, 0, r.stderr); return Date.now() - t; });
  assert.ok(Math.min(...times) < 300, `refresh took ${times.join(", ")} ms`);
  assert.equal(h.aw().calendar.state, "ok");
});

test("a calendar write (awareness.dirty) invalidates the cached calendar", async () => {
  const h = harness();
  h.run("refresh");
  const env = { ...h.env, ORION_BRIDGE_BIN: "/nonexistent" };   // a re-read of the calendar would now fail
  const refresh = () => spawnSync(process.execPath, [bin, "refresh"], { encoding: "utf8", env });
  refresh();
  assert.equal(h.aw().calendar.state, "ok", "served from the cache");
  const dirty = join(h.dir, "awareness.dirty");
  writeFileSync(dirty, "");
  utimesSync(dirty, new Date(NOW.getTime() + 1000), new Date(NOW.getTime() + 1000));
  refresh();
  assert.equal(h.aw().calendar.state, "unknown", "re-read after the dirty flag");
});

test("a failed calendar read is unknown, never free", () => {
  const h = harness();
  const r = spawnSync(process.execPath, [bin, "refresh"], { encoding: "utf8", env: { ...h.env, ORION_BRIDGE_BIN: "/nonexistent" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.aw().calendar.state, "unknown");
});

// Scenario 2, hook side: a 2-minute break with no tick in it still triggers the release, from the phase edge.
test("scenario 2: the phase hook refreshes with the given session and asks orion-reach to drain", async () => {
  const h = harness();
  const session = JSON.stringify({ state: "rest", phaseIndex: 1, phaseEndsAt: "2026-10-16T14:02:00Z", task: "essay", sessionId: "s1", source: "phase-hook", at: "2026-10-16T14:00:00Z" });
  const r = h.run("phase", "--from", "focus", "--to", "rest", "--session", session);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.aw().session.state, "rest");
  assert.equal(h.aw().session.source, "phase-hook");
  assert.deepEqual(await h.wait("fake-reach"), ["--drain-held --reason break"]);
  assert.deepEqual(await h.wait("fake-proactive"), ["tick --reason phase"]);
});

test("phase to none says reason end; a second phase inside 60 s kicks no second tick", async () => {
  const h = harness();
  h.run("phase", "--from", "rest", "--to", "none", "--session", JSON.stringify({ status: "none" }));
  h.run("phase", "--from", "none", "--to", "none", "--session", JSON.stringify({ status: "none" }));
  const reach = await h.wait("fake-reach", 2);
  assert.equal(reach[0], "--drain-held --reason end");
  await h.wait("fake-proactive");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.calls("fake-proactive").length, 1);
  assert.equal(h.run("phase", "--to", "rest").status, 2, "usage error");
});

test("a new place event kicks the proactive tick with reason place", async () => {
  const h = harness();
  h.json("health-log.json", { phoneSignals: [], placeEvents: [] });
  h.run("refresh");
  h.json("health-log.json", { phoneSignals: [], placeEvents: [{ at: ago(30), event: "exit", placeId: "home" }] });
  h.run("refresh");
  assert.deepEqual(await h.wait("fake-proactive"), ["tick --reason place"]);
  assert.equal(h.aw().location.state, "elsewhere");
});

test("place set / list / forget; the seeded home shows until a file exists", () => {
  const h = harness();
  assert.match(h.run("place", "list").stdout, /^home\thome\thome\t150 m\tnick-confirmed address/m);
  const set = h.run("place", "set", "home", "--lat", "51.5273608", "--lon", "-0.0865265", "--label", "Scape Shoreditch", "--source", "nick-confirmed address");
  assert.equal(set.status, 0, set.stderr);
  h.run("place", "set", "gym", "--lat", "51.52", "--lon", "-0.08", "--kind", "gym");
  const list = h.run("place", "list").stdout;
  assert.match(list, /^gym\tgym\tgym\t120 m\tnick/m);
  assert.match(list, /^home\thome\thome\t150 m\tnick-confirmed address/m);
  assert.equal(h.run("place", "forget", "gym").status, 0);
  assert.equal(h.run("place", "forget", "gym").status, 1);
  assert.equal(h.run("place", "set", "x", "--lat", "999", "--lon", "0").status, 2);
});

test("place set --here needs a fresh fix", () => {
  const h = harness();
  h.json("health-log.json", { phoneSignals: [{ at: ago(7200), latitude: 51.6, longitude: -0.2 }] });
  assert.equal(h.run("place", "set", "lib", "--here").status, 1);
  h.json("health-log.json", { phoneSignals: [{ at: ago(60), latitude: 51.6, longitude: -0.2 }] });
  assert.equal(h.run("place", "set", "lib", "--here").status, 0);
  assert.match(h.run("place", "list").stdout, /^lib\t/m);
});

test("place learn: proposes with enough nights, refuses with fewer, and never overrides a confirmed home", () => {
  const h = harness();
  // no confirmed home on disk: the seeded home is the default, so write a file without one
  h.run("place", "set", "gym", "--lat", "51.52", "--lon", "-0.08");
  h.run("place", "forget", "gym"); h.run("place", "forget", "home");   // the file now exists with no places, so no home
  h.json("health-log.json", { phoneSignals: [...overnightCharging(10, HOME), ...daytime(40, CAMPUS)] });
  const proposal = h.run("place", "learn").stdout;
  assert.match(proposal, /proposed home: 10 nights/);
  assert.match(proposal, /place set home --lat 51\.50000 --lon -0\.10000/);
  assert.ok(!/home/.test(h.run("place", "list").stdout), "learn alone writes nothing");
  h.json("health-log.json", { phoneSignals: overnightCharging(4, HOME) });
  assert.match(h.run("place", "learn").stdout, /only 4 night/);
  // with the confirmed home installed, a far-away learned home is a conflict and changes nothing
  h.run("place", "set", "home", "--lat", "51.5273608", "--lon", "-0.0865265", "--source", "nick-confirmed address");
  h.json("health-log.json", { phoneSignals: overnightCharging(10, HOME) });
  assert.match(h.run("place", "learn", "--apply").stdout, /confirmed home; leaving home as it is/);
  assert.match(h.run("place", "list").stdout, /^home\thome\thome\t150 m\tnick-confirmed address/m);
});

test("curiosity pause writes only pausedUntil and keeps the rest of the ledger", () => {
  const h = harness();
  h.json("curiosity.json", { asks: [{ askId: "a1" }], blankGapMinutes: 120 });
  assert.equal(h.run("curiosity", "pause", "--days", "2").status, 0);
  const c = JSON.parse(readFileSync(join(h.dir, "curiosity.json"), "utf8"));
  assert.equal(c.blankGapMinutes, 120);
  assert.equal(c.asks.length, 1);
  assert.equal(c.pausedUntil, new Date(NOW.getTime() + 2 * 86_400_000).toISOString());
  assert.equal(h.run("curiosity", "pause", "--days", "0").status, 2);
});

// Review 1 (CRITICAL): the app sends the session FACET ({ state, ... }), not the socket's { status, phase }. Same file as the Swift test.
test("the phase hook's real payload (checked-in fixture, written by the Swift encoder) sets the session state", () => {
  const h = harness();
  const fixture = readFx(join(import.meta.dirname, "fixtures/phase-session.json"), "utf8");
  const r = h.run("phase", "--from", "rest", "--to", "focus", "--session", fixture);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.aw().session.state, "focus");
  assert.equal(h.aw().session.sessionId, "S1");
  assert.equal(h.aw().session.phaseEndsAt, "2027-01-15T08:20:00.000Z");
  assert.equal(h.aw().session.source, "phase-hook");
});
