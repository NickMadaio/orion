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
  const reach = join(home, "reach"); writeFileSync(reach, `#!/bin/sh\necho "$@" >> "${home}/reach.log"\n`); chmodSync(reach, 0o755);
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_REACH_BIN: reach, ORION_CONTROLLED_DIR: join(home, ".openclaw/orion-controlled"), ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
        ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 1, ...now).toISOString() } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const said = () => { try { return readFileSync(join(home, "reach.log"), "utf8").trim().split("\n"); } catch { return []; } };
  const slips = () => { try { return readFileSync(join(home, ".openclaw/orion-controlled/slips.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
  const journal = () => JSON.parse(readFileSync(join(home, "undo.json"), "utf8"));
  return { run, cal: () => JSON.parse(readFileSync(calendar, "utf8")), config: join(home, "life.json"), said, slips, journal };
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

// Auto-bump (2026-10-19): when the gym does not fit, strictly lower-ranked blocks move later, or failing that come off.
const shape = (cal) => cal.map((e) => [e.title, e.start, e.end, e.orion ?? "", e.orionTags ?? ""].join("|")).sort();
const byTitle = (cal, title) => cal.find((e) => e.title === title);
const minutesOf = (e) => (new Date(e.end) - new Date(e.start)) / 60000;
const dinner = { title: "Dinner with Sam", start: at(18), end: at(23, 40) };
const study = { title: "Study for quiz", start: at(12, 40), end: at(13, 40), orion: "study" };
const email = { title: "email prof", start: at(13, 50), end: at(15, 20), orion: "other" };
const youtube = { title: "YouTube", start: at(15, 30), end: at(17), orion: "side_project", orionTags: "side_project,rank-low" };

test("auto-bump: on a full day the lowest rank comes off first, he is told once, and the slip is kept", (t) => {
  const w = world(t, [lecture, dinner, study, email, youtube]);
  const before = w.cal();
  const r = w.run("fill", "--anchors", "--auto");
  assert.equal(r.code, 0, r.out);
  const after = w.cal();
  const gym = byTitle(after, "Gym");
  assert.equal(minutesOf(gym), 90);
  assert.equal(byTitle(after, "YouTube"), undefined, "the low-ranked block is the one removed");
  for (const kept of ["email prof", "Study for quiz"]) assert.deepEqual(shape([byTitle(after, kept)]), shape([byTitle(before, kept)]), `${kept} is higher ranked and stays where it was`);
  const said = w.said();
  assert.equal(said.length, 1, "exactly one message");
  assert.match(said[0], /^Fitted Gym \d\d:\d\d–\d\d:\d\d\. Dropped: YouTube \d\d:\d\d\./);
  assert.deepEqual(w.slips().map((s) => [s.planned.title, s.reason]), [["YouTube", "no-room"]]);
});

test("auto-bump: a block that can move later moves instead of being removed, and the message says so", (t) => {
  const w = world(t, [lecture, { ...dinner, start: at(19) }, study, { ...email, start: at(14, 40), end: at(15, 40) }, { ...youtube, start: at(16, 40), end: at(17, 40) }]);
  const r = w.run("fill", "--anchors", "--auto");
  assert.equal(r.code, 0, r.out);
  const moved = byTitle(w.cal(), "email prof");
  assert.equal(minutesOf(moved), 60, "same length");
  assert.ok(new Date(moved.start) > new Date(at(14, 40)), "moved later today");
  assert.ok(byTitle(w.cal(), "YouTube"), "nothing was removed");
  assert.equal(w.said().length, 1);
  assert.match(w.said()[0], /^Fitted Gym \d\d:\d\d–\d\d:\d\d\. Moved: email prof to \d\d:\d\d\. --kind update/);
  assert.deepEqual(w.slips(), []);
});

test("auto-bump: fixed plans and other musts are never touched, even when lower ranks are all gone", (t) => {
  const must = { title: "Resume push", start: at(12, 40), end: at(14), orion: "other", orionTags: "other,rank-must" };
  const equalHigh = { title: "Study for quiz", start: at(14, 10), end: at(15, 10), orion: "study", orionTags: "study,rank-must" };
  const low = { title: "YouTube", start: at(15, 20), end: at(17, 30), orion: "side_project", orionTags: "side_project,rank-low" };
  const w = world(t, [lecture, dinner, must, equalHigh, low]);
  const before = w.cal();
  const r = w.run("fill", "--anchors", "--auto");
  assert.equal(r.code, 0, r.out);
  const after = w.cal();
  for (const title of [lecture.title, "Dinner with Sam", "Resume push", "Study for quiz"]) assert.deepEqual(shape([byTitle(after, title)]), shape([byTitle(before, title)]), `${title} untouched`);
  assert.equal(byTitle(after, "YouTube"), undefined);
  assert.ok(byTitle(after, "Gym"));
});

test("auto-bump: saved minimums are respected (a nap stays 75, the side project 60: nothing is shortened)", (t) => {
  const nap = { title: "Nap", start: at(12, 40), end: at(13, 55), orion: "rest" };
  const side = { title: "YouTube", start: at(14, 5), end: at(15, 5), orion: "side_project", orionTags: "side_project,rank-low" };
  const work = { title: "email prof", start: at(15, 15), end: at(16, 45), orion: "other" };
  const w = world(t, [lecture, { ...dinner, start: at(18, 30) }, nap, side, work], { minimums: { nap: 75, youtube: 60 } });
  const before = w.cal();
  const r = w.run("fill", "--anchors", "--auto");
  assert.equal(r.code, 0, r.out);
  const after = w.cal();
  assert.ok(byTitle(after, "Gym"), r.out);
  for (const e of before.filter((x) => x.orion)) { const kept = byTitle(after, e.title); if (kept) assert.equal(minutesOf(kept), minutesOf(e), `${e.title} keeps its length`); }
  assert.ok(minutesOf(byTitle(after, "Nap") ?? nap) >= 75 && minutesOf(byTitle(after, "YouTube") ?? side) >= 60);
});

test("scenario 19 (auto-bump): when even bumping everything lower cannot fit 90 minutes, nothing is written and he gets one message saying why", (t) => {
  const w = world(t, [{ title: "Trip with friends", start: at(7), end: at(23, 59) }]);
  const before = JSON.stringify(w.cal());
  const r = w.run("fill", "--anchors", "--auto");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED: Gym does not fit/);
  assert.match(r.out, /NO ROOM: /);
  assert.equal(JSON.stringify(w.cal()), before);
  assert.equal(w.said().length, 1);
  assert.match(w.said()[0], /^No room for Gym today: it needs 90 min and no open time is left, with Trip with friends 07:00–23:59 in the way\. --kind update/);
  assert.throws(() => w.journal(), /ENOENT/, "no undo step for a change that did not happen");
  assert.deepEqual(w.slips(), []);
});

test("auto-bump: no room because of fixed classes names them, and a fill he asked for himself sends no message", (t) => {
  const w = world(t, [{ title: "CS1800 Lecture", start: at(7), end: at(21) }, { title: "Lab", start: at(21), end: at(23, 59) }]);
  const r = w.run("fill", "--anchors");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /CS1800 Lecture 07:00–21:00/);
  assert.deepEqual(w.said(), []);
});

test("auto-bump: one change id, so a single undo restores every block exactly", (t) => {
  const w = world(t, [lecture, dinner, study, email, youtube]);
  const before = shape(w.cal());
  assert.equal(w.run("fill", "--anchors", "--auto").code, 0);
  assert.notDeepEqual(shape(w.cal()), before);
  assert.equal(w.journal().length, 1, "one journal entry for the whole fill");
  const u = w.run("undo");
  assert.equal(u.code, 0, u.out);
  assert.deepEqual(shape(w.cal()), before);
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
