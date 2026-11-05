// Wave 20 round 3 (live gate 2026-11-05): the scheduler side of undo and removal.
//  #64 "skip the lecture today, im ill" DELETED the real lecture: a class or event ORION did not create is only ever marked skipped.
//  #60-62 "take the call with mum off my day": a plan with people ORION booked itself comes off when he says so.
//  #65 a restore keeps the event's place and notes: the journal holds the whole event before any destructive change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const at = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const day = [
  { identifier: "lec", title: "CS1800 Discrete Structures — Lecture", start: at(16), end: at(17, 30), location: "Portsoken 528", notes: "bring the slides", calendar: "School" },
  { identifier: "dent", title: "Pick up parcel", start: at(19), end: at(19, 30), location: "High St 4", notes: "ask about the crown" },
  { identifier: "s", title: "Study", start: at(21), end: at(22), orion: "study" },
];

function world(t, extra = {}, cal = day) {
  const home = mkdtempSync(join(tmpdir(), "orion-r3-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "cal.json"), JSON.stringify(cal));
  writeFileSync(join(home, "life.json"), "{}");
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "cal.json"), ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_SKIPS_FILE: join(home, "skips.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 8, 15).toISOString(), ...extra };
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8", env }); return { code: r.status, out: r.stdout + r.stderr }; };
  const events = () => JSON.parse(readFileSync(join(home, "cal.json"), "utf8"));
  const titles = () => events().map((e) => e.title);
  const skips = () => { try { return JSON.parse(readFileSync(join(home, "skips.json"), "utf8")); } catch { return []; } };
  return { run, events, titles, skips };
}

test("#64 skip never deletes his class: it is marked skipped, the event stays, and undo unmarks it", (t) => {
  const w = world(t);
  const r = w.run("skip", "discrete structures");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.titles().some((x) => /CS1800/.test(x)), "the lecture is still on the calendar");
  assert.equal(w.skips().length, 1);
  assert.match(r.out, /marked skipped/i);
  assert.doesNotMatch(r.out, /removed from his calendar|his calendar/i);
  assert.equal(w.run("undo").code, 0);
  assert.equal(w.skips().length, 0);
  assert.equal(w.events().find((e) => e.identifier === "lec")?.location, "Portsoken 528");
});

test("#60-62 a plan with people ORION booked comes off by name, and undo brings it back", (t) => {
  const w = world(t);
  const ok = w.run("add", "Call with mum", "40", "--at", "17:40");
  assert.equal(ok.code, 0, ok.out);
  assert.ok(w.titles().includes("Call with mum"));
  const drop = w.run("drop", "call with mum");
  assert.equal(drop.code, 0, drop.out);
  assert.ok(!w.titles().includes("Call with mum"));
  assert.equal(w.run("undo").code, 0);
  assert.ok(w.titles().includes("Call with mum"));
});

test("#60-62 skip on a plan ORION booked removes that block (it is not 'a class or plan with people')", (t) => {
  const w = world(t);
  assert.equal(w.run("add", "Call with mum", "40", "--at", "17:40").code, 0);
  const r = w.run("skip", "the mum call");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.titles().includes("Call with mum"));
  assert.doesNotMatch(r.out, /class or a plan with people/);
});

test("drop never removes his own plan with people that ORION did not create", (t) => {
  const w = world(t, {}, [...day, { identifier: "mumcal", title: "Call with mum", start: at(22, 30), end: at(23) }]);
  const r = w.run("drop", "call with mum");
  assert.equal(r.code, 1, r.out);
  assert.ok(w.titles().includes("Call with mum"));
});

test("#65 a removed event of his goes back with its location and notes", (t) => {
  const w = world(t);
  const r = w.run("drop", "pick up parcel");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.titles().includes("Pick up parcel"));
  assert.equal(w.run("undo").code, 0);
  const back = w.events().find((e) => e.title === "Pick up parcel");
  assert.equal(back?.location, "High St 4");
  assert.equal(back?.notes, "ask about the crown");
});

test("review HIGH 1: drop --id removes exactly that block, never his same-titled event", (t) => {
  const w = world(t, {}, [...day, { identifier: "hisgym", title: "Study group", start: at(17), end: at(18), location: "Library" }]);
  assert.equal(w.run("add", "Study", "30", "--at", "19:00").code, 0);
  const show = JSON.parse(w.run("show", "--json").out);
  const mine = show.blocks.filter((b) => b.title === "Study" && b.made);
  assert.equal(mine.length, 1, JSON.stringify(show.blocks));
  assert.ok(mine[0].id, "show --json carries the calendar id");
  const r = w.run("drop", "--id", mine[0].id);
  assert.equal(r.code, 0, r.out);
  const left = w.events().filter((e) => /^Study/.test(e.title));
  assert.ok(left.some((e) => e.identifier === "hisgym") && !left.some((e) => e.title === "Study"), JSON.stringify(left));
  assert.equal(w.run("drop", "--id", "nope").code, 1);
});
