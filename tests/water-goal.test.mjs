import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The water goal is nutritionGoals.water in health-log.json, default 9, clamped to 1..30 (2026-11-04).
const home = mkdtempSync(join(tmpdir(), "water-goal-"));
const file = join(home, ".openclaw/orion-controlled/health-log.json");
mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
const seed = (extra = {}) => writeFileSync(file, JSON.stringify({ schema: "orion.health.v3", updatedAt: "", supplements: [], supplementLog: {}, workouts: [], days: {}, ...extra }));
const run = (script, ...args) => spawnSync(process.execPath, [new URL(`../scripts/${script}`, import.meta.url).pathname, ...args],
  { env: { ...process.env, HOME: home, ORION_HEALTH_LOG: file }, encoding: "utf8" });
const stored = () => JSON.parse(readFileSync(file, "utf8"));
test.after(() => rmSync(home, { recursive: true, force: true }));

test("orion-log water says 'of N' with the stored goal, and 9 when none is set", () => {
  seed();
  assert.match(run("orion-log", "water").stdout, /1 of 9 today/);
  seed({ nutritionGoals: { calories: 2200, water: 12 } });
  assert.match(run("orion-log", "water", "2").stdout, /2 of 12 today/);
});

test("orion-health reports the stored goal, clamped, and a bad one as 9", () => {
  seed({ nutritionGoals: { water: 10 } });
  assert.equal(JSON.parse(run("orion-health", "--json").stdout).water.goal, 10);
  seed({ nutritionGoals: { water: 400 } });
  assert.equal(JSON.parse(run("orion-health", "--json").stdout).water.goal, 30);
  seed({ nutritionGoals: { water: "lots" } });
  assert.equal(JSON.parse(run("orion-health", "--json").stdout).water.goal, 9);
  seed();
  assert.equal(JSON.parse(run("orion-health", "--json").stdout).water.goal, 9);
});

test("orion-log water-goal sets, clamps, reads, and keeps the other goals and unknown keys", () => {
  seed({ nutritionGoals: { calories: 2600, protein: 180, carbohydrates: 250, fat: 70, fiber: 30 }, phoneScreen: { locked: true } });
  assert.match(run("orion-log", "water-goal", "10").stdout, /10 bottles/);
  assert.equal(stored().nutritionGoals.water, 10);
  assert.equal(stored().nutritionGoals.calories, 2600);
  assert.equal(stored().phoneScreen.locked, true);
  assert.match(run("orion-log", "water-goal").stdout, /10 bottles/);
  assert.equal(stored().nutritionGoals.water, 10, "reading changes nothing");
  assert.equal(run("orion-log", "water-goal", "99").status, 2, "out of range is refused, not clamped");
  assert.equal(run("orion-log", "water-goal", "0").status, 2);
  assert.equal(stored().nutritionGoals.water, 10);
});

test("a goal set on a log with no goals object writes a whole one the app can decode", () => {
  seed();
  run("orion-log", "water-goal", "8");
  const goals = stored().nutritionGoals;
  for (const key of ["calories", "protein", "carbohydrates", "fat", "fiber"]) assert.equal(typeof goals[key], "number", key);
  assert.equal(goals.water, 8);
});
