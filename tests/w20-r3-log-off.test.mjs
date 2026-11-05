// w20 round 3: what ORION logged can come off again (#25 "take the big mac back off, i didnt have it", water the same).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const home = mkdtempSync(join(tmpdir(), "log-off-"));
const file = join(home, ".openclaw/orion-controlled/health-log.json");
mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
const seed = () => writeFileSync(file, JSON.stringify({ schema: "orion.health.v3", updatedAt: "", supplements: [], supplementLog: {}, workouts: [], days: {}, nutritionLog: {} }));
const run = (...args) => spawnSync(process.execPath, [new URL("../scripts/orion-log", import.meta.url).pathname, ...args],
  { env: { ...process.env, HOME: home, ORION_HEALTH_LOG: file }, encoding: "utf8" });
const stored = () => JSON.parse(readFileSync(file, "utf8"));
const today = () => Object.values(stored().days)[0];
test.after(() => rmSync(home, { recursive: true, force: true }));

test("water-off takes bottles back off and never goes below zero", () => {
  seed();
  run("water", "3");
  const r = run("water-off", "2");
  assert.match(r.stdout, /Took 2 bottles off: 1 of 9 today/);
  assert.equal(today().waterBottles, 1);
  const again = run("water-off", "5");
  assert.match(again.stdout, /Took 1 bottle off: 0 of 9/);
  const none = run("water-off");
  assert.equal(none.status, 1);
  assert.match(none.stdout, /nothing to take off/);
});

test("food-off takes the newest matching entry off and re-totals the day", () => {
  seed();
  run("food", "Big Mac", "770", "36");
  run("food", "Apple", "80");
  const r = run("food-off", "big mac");
  assert.match(r.stdout, /Took Big Mac off \(770 kcal\): 80 kcal today/);
  assert.equal(today().calories, 80);
  assert.equal(run("food-off", "big mac").status, 1);
  assert.match(run("food-off", "--last").stdout, /Took Apple off/);
});
