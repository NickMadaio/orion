// WP6 scenario 19 and config: the gym is a daily anchor (90 min, must), planned by `fill --anchors`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, anchorsFrom, validAnchors } from "../scripts/lib/life/config.mjs";
import { fillDay } from "../scripts/lib/life/fill-day.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-01";   // a Tuesday: the old default (Mon/Wed/Fri) would have skipped it
const at = (h, m = 0) => new Date(2030, 9, 1, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");

function world(t, events, config = {}, now = [8, 0]) {
  const home = mkdtempSync(join(tmpdir(), "orion-anchors-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(config));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: join(home, ".openclaw/orion-controlled"), ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
        ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 1, ...now).toISOString() } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { run, cal: () => JSON.parse(readFileSync(calendar, "utf8")), config: join(home, "life.json") };
}
const lecture = { title: "CS1800 Discrete Structures — Lecture", start: at(9), end: at(12) };

test("the default anchor is the gym, every day, 90 minutes, must; the legacy gymDays still work", (t) => {
  const w = world(t, []);
  const [gym, ...none] = loadConfig(w.config).anchors;
  assert.deepEqual([gym.title, gym.kind, gym.minutes, gym.days, gym.rank, none.length], ["Gym", "gym", 90, [1, 2, 3, 4, 5, 6, 7], "must", 0]);
  writeFileSync(w.config, JSON.stringify({ gymDays: [2], gymMinutes: 45 }));
  assert.deepEqual(loadConfig(w.config).anchors.map((a) => [a.days, a.minutes]), [[[2], 45]]);
  writeFileSync(w.config, JSON.stringify({ anchors: [{ title: "Read", kind: "study", minutes: 30, days: [1], rank: "must" }] }));
  assert.equal(loadConfig(w.config).anchors[0].title, "Read");
  assert.equal(validAnchors([{ title: "x", kind: "Bad Kind", minutes: 30, days: [1] }]), false);
  assert.deepEqual(anchorsFrom({ gymDays: [], gymMinutes: 60 }), []);
});

test("fillDay: anchors are exempt from freeMinutesKept", () => {
  const config = { gymDays: [], gymMinutes: 60, freeMinutesKept: 600, sideProjectMinutes: 0, windDownMinutes: 0, dinner: false,
    anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [2], rank: "must" }] };
  const asks = fillDay([], { now: 600, window: { start: 540, end: 800 }, weekday: 2, config });
  assert.deepEqual(asks.filter((a) => a.anchor).map((a) => [a.title, a.rank, a.tags]), [["Gym", "must", ["anchor"]]]);
  assert.equal(fillDay([], { now: 600, window: { start: 540, end: 800 }, weekday: 3, config }).some((a) => a.anchor), false);
});

test("scenario 19: fill --anchors on a Tuesday adds Gym with tags anchor and rank-must", (t) => {
  const w = world(t, [lecture]);
  const r = w.run("fill", "--anchors");
  assert.equal(r.code, 0, r.out);
  const gym = w.cal().find((e) => e.title === "Gym");
  assert.equal((new Date(gym.end) - new Date(gym.start)) / 60000, 90);
  assert.deepEqual(gym.orionTags.split(","), ["gym", "anchor", "rank-must"]);
  assert.match(w.run("fill", "--anchors").out, /Nothing to add/, "planned once, not again");
});

// Integration review 10: the automatic morning fill only ADDS; it never takes one of his blocks off the day.
test("review 10: on a full day fill --anchors writes nothing and asks once (skip the gym, or drop the lowest-ranked block)", (t) => {
  const events = [lecture, { title: "Dinner with Sam", start: at(18), end: at(19) },
    { title: "email prof", start: at(12, 30), end: at(14), orion: "other" },
    { title: "YouTube", start: at(14, 30), end: at(23, 30), orion: "side_project", orionTags: "side_project,rank-low" }];
  const w = world(t, events);
  const before = JSON.stringify(w.cal());
  const r = w.run("fill", "--anchors");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED: Gym does not fit/);
  assert.match(r.out, /ASK: skip Gym today, or drop YouTube \(/);
  assert.equal(JSON.stringify(w.cal()), before, "no block of his moved or vanished");
});

test("scenario 19: with no room it reports a must-have that could not fit and writes nothing", (t) => {
  const w = world(t, [{ title: "Trip with friends", start: at(7), end: at(23, 59) }]);
  const before = JSON.stringify(w.cal());
  const r = w.run("fill", "--anchors");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Gym does not fit/);
  assert.equal(JSON.stringify(w.cal()), before);
});

test("an anchor only on other days adds nothing today", (t) => {
  const w = world(t, [lecture], { anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1], rank: "must" }] });
  assert.match(w.run("fill", "--anchors").out, /Nothing to add/);
});

test("day --fill puts the anchor through the rebuild: it bumps a lower-ranked block instead of being frozen out", (t) => {
  const events = [lecture, { title: "YouTube", start: at(12, 30), end: at(23, 30), orion: "side_project", orionTags: "side_project,rank-low" }];
  const w = world(t, events, { freeMinutesKept: 0, windDownMinutes: 0, dinner: false, sideProjectMinutes: 0 });
  const r = w.run("day", "--fill");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.cal().some((e) => e.title === "Gym"), r.out);
});

test("review 10: when `day --fill` does take one of his blocks off the day, he is told once and the slip is kept for the review", (t) => {
  const events = [lecture, { title: "Dinner with Sam", start: at(18), end: at(19) },
    { title: "YouTube", start: at(14, 30), end: at(23, 30), orion: "side_project", orionTags: "side_project,rank-low" }];
  const w = world(t, events);
  const home = join(w.config, "..");
  const reach = join(home, "reach"); writeFileSync(reach, `#!/bin/sh\necho "$@" >> "${home}/reach.log"\necho "Sent - fake"\n`); chmodSync(reach, 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, "day", "--fill", ...(process.env.AUTO_NOTIFY === "0" ? [] : ["--auto"]), "--date", DATE], { encoding: "utf8",
    env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: join(home, ".openclaw/orion-controlled"), ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "calendar.json"), ORION_LIFE_CONFIG: w.config,
      ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 1, 8, 0).toISOString(), ORION_REACH_BIN: reach } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const said = readFileSync(join(home, "reach.log"), "utf8").trim().split("\n");
  assert.equal(said.length, 1);
  assert.match(said[0], /took YouTube \(2:30 PM-11:30 PM\) off today|took YouTube \(14:30-23:30\) off today/);
  const slips = readFileSync(join(home, ".openclaw/orion-controlled/slips.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([slips[0].planned.title, slips[0].reason, slips[0].missedMinutes], ["YouTube", "no-room", 540]);
});

test("review follow-up: without --auto (he asked for the fill himself) no second message is sent, but the slip is still kept", (t) => {
  const events = [lecture, { title: "Dinner with Sam", start: at(18), end: at(19) },
    { title: "YouTube", start: at(14, 30), end: at(23, 30), orion: "side_project", orionTags: "side_project,rank-low" }];
  const w = world(t, events);
  const home = join(w.config, "..");
  const reach = join(home, "reach"); writeFileSync(reach, `#!/bin/sh\necho "$@" >> "${home}/reach.log"\n`); chmodSync(reach, 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, "day", "--fill", "--date", DATE], { encoding: "utf8",
    env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: join(home, ".openclaw/orion-controlled"), ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "calendar.json"), ORION_LIFE_CONFIG: w.config,
      ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 1, 8, 0).toISOString(), ORION_REACH_BIN: reach } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.throws(() => readFileSync(join(home, "reach.log")), /ENOENT/);
  assert.match(readFileSync(join(home, ".openclaw/orion-controlled/slips.jsonl"), "utf8"), /YouTube/);
});
