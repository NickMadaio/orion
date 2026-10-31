// "I don't have classes today" (2026-10-30): said twice by voice and text, nothing happened, and three leave nudges for
// MKTG2201 went out. `orion-reschedule classes-off` marks the day's classes cancelled (never deletes them) in one undo;
// `orion-declare` writes the declared fact the now record and the class ladder read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const DECLARE = join(ROOT, "scripts/orion-declare");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const at = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const day = [
  { identifier: "mk", title: "MKTG2201 Introduction to Marketing — Lecture", start: at(13, 30), end: at(15) },
  { identifier: "ec", title: "ECON1115 Principles of Macroeconomics — Lecture", start: at(15, 30), end: at(17) },
  { identifier: "lab", title: "CS2101 Lab", start: at(18), end: at(19, 30) },
  { identifier: "g", title: "Gym", start: at(20), end: at(21, 30), orion: "gym" },
];

function world(t) {
  const home = mkdtempSync(join(tmpdir(), "orion-classes-off-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const state = join(home, "state");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(home, "cal.json"), JSON.stringify(day));
  writeFileSync(join(home, "life.json"), "{}");
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: state, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "cal.json"), ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_SKIPS_FILE: join(home, "skips.json"), ORION_NOW: new Date(2030, 9, 8, 12, 40).toISOString() };
  const run = (script, ...a) => { const r = spawnSync(process.execPath, [script, ...a], { encoding: "utf8", env }); return { code: r.status, out: r.stdout + r.stderr }; };
  const titles = () => JSON.parse(readFileSync(join(home, "cal.json"), "utf8")).map((e) => e.title);
  const skips = () => { try { return JSON.parse(readFileSync(join(home, "skips.json"), "utf8")); } catch { return []; } };
  const show = () => JSON.parse(run(RESCHEDULE, "show", "--json").out).blocks.map((b) => b.title);
  return { run, titles, skips, show, state };
}

test("classes-off marks every class today cancelled without deleting it, keeps the lab he still has, and one undo restores them", (t) => {
  const w = world(t);
  const r = w.run(RESCHEDULE, "classes-off", "--keep", "lab");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cancelled MKTG2201[^\n]*13:30–15:00[^\n]*not deleted/);
  assert.match(r.out, /cancelled ECON1115[^\n]*15:30–17:00/);
  assert.doesNotMatch(r.out, /cancelled CS2101/);
  assert.equal(w.titles().length, 4, "nothing is deleted from Apple Calendar");
  assert.equal(w.skips().length, 2);
  assert.deepEqual(w.show(), ["CS2101 Lab", "Gym"], "planning no longer sees the cancelled classes");
  const undo = w.run(RESCHEDULE, "undo");
  assert.equal(undo.code, 0, undo.out);
  assert.equal(w.skips().length, 0);
  assert.equal(w.show().length, 4);
});

test("classes-off with names cancels only those ('no marketing and no macro today')", (t) => {
  const w = world(t);
  const r = w.run(RESCHEDULE, "classes-off", "marketing");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cancelled MKTG2201/);
  assert.doesNotMatch(r.out, /ECON1115/);
});

test("classes-off on a day with no classes changes nothing and says so", (t) => {
  const w = world(t);
  assert.equal(w.run(RESCHEDULE, "classes-off").code, 0);
  const again = w.run(RESCHEDULE, "classes-off", "--keep", "lab");
  assert.match(again.out, /NOTHING WAS CHANGED: no classes on/);
});

test("orion-declare writes the fact (once a day), lists it, and takes it back by id", (t) => {
  const w = world(t);
  const added = w.run(DECLARE, "add", "--kind", "no-classes", "--text", "Just note that I don't have classes.", "--source", "voice");
  assert.equal(added.code, 0, added.out);
  const fact = JSON.parse(added.out);
  assert.equal(fact.kind, "no-classes");
  assert.equal(fact.date, "2030-10-08");
  const twice = JSON.parse(w.run(DECLARE, "add", "--kind", "no-classes", "--text", "no class today btw").out);
  assert.equal(twice.id, fact.id, "the same fact twice in a day is kept once");
  assert.equal(JSON.parse(w.run(DECLARE, "list").out).length, 1);
  assert.match(w.run(DECLARE, "remove", "--id", fact.id).out, /Removed no-classes/);
  assert.equal(JSON.parse(w.run(DECLARE, "list").out).length, 0);
  const file = JSON.parse(readFileSync(join(w.state, "declared-facts.json"), "utf8"));
  assert.equal(file.schemaVersion, 1);
});

test("orion-declare refuses what the contract refuses", (t) => {
  const w = world(t);
  assert.match(w.run(DECLARE, "add", "--kind", "holiday", "--text", "x").out, /NOTHING WAS CHANGED: declared fact kind/);
  assert.match(w.run(DECLARE, "add", "--kind", "skip", "--text", "didnt go").out, /names the block/);
  assert.match(w.run(DECLARE, "remove", "--id", "x; rm").out, /remove takes --id/);
});
