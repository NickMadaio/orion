import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAwareness, writeAwareness } from "../scripts/lib/awareness/state.mjs";
import { presence } from "../scripts/lib/reach/presence.mjs";
import { activeSession } from "../scripts/lib/reach/focus-hold.mjs";

const now = new Date(2026, 9, 16, 14, 0, 0);
const ago = (sec) => new Date(now.getTime() - sec * 1000).toISOString();
const dirOf = () => mkdtempSync(join(tmpdir(), "aw-state-"));

function snapshot(age) {
  return {
    schema: "orion.awareness.v1", at: ago(age),
    session: { state: "focus", sessionId: "s", phaseIndex: 0, phaseEndsAt: null, task: "t", at: ago(age), source: "socket" },
    calendar: { state: "ok", now: { title: "CS1800 — lecture", start: 780, end: 900, kind: "class", fixed: true, source: "calendar" }, next: null, freeUntil: null, travelNow: null, at: ago(age) },
    location: { state: "home", placeId: "home", cell: null, since: ago(age), at: ago(age), source: "sample", homeKnown: true },
    mac: { state: "active", idleSeconds: 1, frontApp: "Claude", workApp: null, at: ago(age) },
    phone: { state: "charging", charging: true, motion: "still", lastSampleAt: ago(age), at: ago(age) },
    audio: { mac: { route: "bluetooth", headphones: true, device: "AirPods", at: ago(age) }, phone: { route: "unknown", headphones: null, device: null, at: ago(age) } },
    sleep: { state: "awake", inWindow: false, wokeAt: 500, bed: 1440, source: "window", at: ago(age) },
  };
}
const write = (dir, age) => writeFileSync(join(dir, "awareness.json"), JSON.stringify(snapshot(age)));

test("a fresh file reads as written, and derived is recomputed", () => {
  const dir = dirOf(); write(dir, 10);
  const aw = readAwareness({ dir, now });
  assert.equal(aw.session.state, "focus");
  assert.equal(aw.derived.activity, "focus");
  assert.equal(aw.derived.atHome, true);
  assert.equal(aw.derived.atMac, true);
  assert.equal(aw.derived.speakOnMac, true);
});

test("each facet goes unknown past its own limit, and derived follows", () => {
  const dir = dirOf(); write(dir, 100);   // over 90 s: session and mac and audio.mac; under the rest
  const aw = readAwareness({ dir, now });
  assert.equal(aw.session.state, "unknown");
  assert.equal(aw.mac.state, "unknown");
  assert.equal(aw.audio.mac.headphones, null);
  assert.equal(aw.calendar.state, "ok");
  assert.equal(aw.location.state, "home");
  assert.equal(aw.derived.atMac, false);
  assert.equal(aw.derived.speakOnMac, false);
  const old = (write(dir, 25 * 60), readAwareness({ dir, now }));
  assert.equal(old.calendar.state, "unknown");
  assert.equal(old.location.state, "unknown");
  assert.equal(old.derived.atHome, null);
  assert.equal(old.phone.state, "unknown");
  assert.equal(old.derived.activity, "unknown");
});

test("a region-sourced location lasts 12 h, a sample 20 min; maxAgeMs caps all", () => {
  const dir = dirOf(); const s = snapshot(3 * 3600);
  s.location = { ...s.location, source: "region" };
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(s));
  assert.equal(readAwareness({ dir, now }).location.state, "home");
  assert.equal(readAwareness({ dir, now, maxAgeMs: 60_000 }).location.state, "unknown");
});

test("no file, or a file of another schema, is all unknown", () => {
  const dir = dirOf();
  assert.equal(readAwareness({ dir, now }).derived.activity, "unknown");
  writeFileSync(join(dir, "awareness.json"), JSON.stringify({ schema: "other" }));
  assert.equal(readAwareness({ dir, now }).session.state, "unknown");
});

test("writeAwareness writes atomically and round-trips", () => {
  const dir = dirOf(); const { schema, at, ...facets } = snapshot(5);
  writeAwareness(dir, { schema, at, ...facets });
  assert.equal(JSON.parse(readFileSync(join(dir, "awareness.json"), "utf8")).derived.activity, "focus");
});

// Scenario 5: awareness older than its limits gives unknown facets and presence().where === "unknown".
test("scenario 5: stale awareness.json gives unknown facets and presence().where is unknown", async () => {
  const dir = dirOf(); write(dir, 3 * 3600);
  writeFileSync(join(dir, "life.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  process.env.ORION_LIFE_CONFIG = join(dir, "life.json");
  const p = await presence(now, { dir, facts: { idleSeconds: 1, locked: false } });
  assert.equal(p.where, "unknown");
  assert.equal(p.out, false);
  const aw = readAwareness({ dir, now });
  for (const f of ["session", "calendar", "location", "mac", "phone", "sleep"]) assert.equal(aw[f].state, "unknown", f);
});

test("presence: fresh awareness says where; being away from home is out", async () => {
  const dir = dirOf();
  writeFileSync(join(dir, "life.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  process.env.ORION_LIFE_CONFIG = join(dir, "life.json");
  const s = snapshot(10); s.calendar.now = null;
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(s));
  const facts = { idleSeconds: 1, locked: false };
  assert.equal((await presence(now, { dir, facts })).where, "home");
  s.location = { ...s.location, state: "elsewhere", placeId: null };
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(s));
  const away = await presence(now, { dir, facts });
  assert.equal(away.out, true);
  assert.equal(away.channel, "mac-bubble");
});

test("activeSession reads a fresh awareness session facet and releases on rest", () => {
  const dir = dirOf();
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_REACH_NOW: now.toISOString(), ORION_SESSION_SOCKET: join(dir, "none.sock") };
  write(dir, 10);
  assert.equal(activeSession(env)?.status, "running");
  const rest = snapshot(10); rest.session.state = "rest";
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(rest));
  assert.equal(activeSession(env), null, "a break is not focus");
  write(dir, 500);   // stale: falls back to the socket, which is not there
  assert.equal(activeSession(env), null);
});
