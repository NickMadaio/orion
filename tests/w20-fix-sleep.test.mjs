// w20 fix-sleep: the standing bedtime is exact and nap credit never moves a named one; reset clears it; orion-sleepplan writes under a lock;
// orion-wake honours ORION_NOW; the now readout shows a bedtime he named for tonight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bedOn } from "../scripts/lib/life/night.mjs";
import { effectiveBedtime, planBedtime } from "../scripts/lib/life/effective-bed.mjs";
import { buildNow } from "../scripts/lib/life/now-state.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SLEEPPLAN = join(ROOT, "scripts/orion-sleepplan");
const WAKE = join(ROOT, "scripts/orion-wake");
const tmp = (t, p) => { const d = mkdtempSync(join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const blocksOf = () => [];
const base = { usualWake: "09:00", bedtime: "23:45", sleepHours: 8, readyMinutes: 75, commuteMinutes: 30 };

test("nap credit does not move a standing bedtime he named exactly (bedFixed)", () => {
  const config = { ...base, sleepPlan: { bedFixed: true } };
  assert.equal(bedOn("2026-11-05", { blocksOf, config, napMinutes: 120 }), 1440 - 15);
  assert.equal(bedOn("2026-11-05", { blocksOf, config, napMinutes: 0 }), 1440 - 15);
});

test("nap credit does not move a tonight override either, and still slides the computed bedtime", () => {
  const forced = { ...base, sleepPlan: { bedOverrides: { "2026-11-05": "23:10" } } };
  assert.equal(bedOn("2026-11-05", { blocksOf, config: forced, napMinutes: 120 }), 1440 - 50);
  const computed = { ...base, bedtime: "23:00" };
  assert.equal(bedOn("2026-11-05", { blocksOf, config: computed, napMinutes: 120 }), 1380 + 60);
  assert.equal(bedOn("2026-11-05", { blocksOf, config: computed, napMinutes: 0 }), 1380);
});

test("planBedtime: a tonight override, then a fixed standing bedtime, else the computed one", () => {
  const over = { ...base, sleepPlan: { bedOverrides: { "2026-11-05": "01:15" } } };
  assert.equal(planBedtime(over, "2026-11-05", "22:00"), "01:15");
  assert.equal(planBedtime(over, "2026-11-06", "22:00"), "22:00");
  assert.equal(planBedtime({ ...base, sleepPlan: { bedFixed: true } }, "2026-11-05", "22:00"), "23:45");
  assert.equal(effectiveBedtime(over, "2026-11-05"), "01:15");
});

test("the orion-now readout shows a bedtime he named for tonight", async (t) => {
  const dir = tmp(t, "nowstate-");
  const config = { ...base, sleepPlan: { bedOverrides: { "2026-11-05": "23:15" } } };
  const r = await buildNow({ dir, now: new Date(2026, 10, 5, 20, 0), aw: {}, day: [], dayOk: true, tomorrowDay: [], config });
  assert.equal(r.sleepPlan.bedtime, "23:15");
  const none = await buildNow({ dir, now: new Date(2026, 10, 5, 20, 0), aw: {}, day: [], dayOk: true, tomorrowDay: [], config: base });
  assert.notEqual(none.sleepPlan.bedtime, "23:15");
});

function sandbox(t) {
  const dir = tmp(t, "sleepplan-fix-");
  writeFileSync(join(dir, "eval-mode"), "");
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: new Date(2026, 10, 2, 20, 0).toISOString(), events: [] }));
  const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run = (...args) => { const r = spawnSync(process.execPath, [SLEEPPLAN, ...args], { encoding: "utf8", env: { ...env, ...(args.at(-1)?.startsWith?.("ENV:") ? {} : {}) } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  return { dir, env, run };
}
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

test("bedtime reset clears the exact standing bedtime and any tonight override; the bedtime he had before comes back", (t) => {
  const { dir, run } = sandbox(t);
  assert.equal(run("bedtime", "23:45", "--json").code, 0);
  assert.equal(read(dir, "eval-life-config.json").sleepPlan.bedFixed, true);
  assert.equal(run("bedtime", "23:10", "--tonight", "--json").code, 0);
  const r = run("bedtime", "reset", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.readback.fixed, false);
  assert.equal(out.readback.tonightOnly, false);
  const saved = read(dir, "eval-life-config.json");
  assert.notEqual(saved.sleepPlan.bedFixed, true);
  assert.equal(saved.sleepPlan.bedOverrides, undefined);
  assert.equal(saved.bedtime, "00:00");   // w20 r4: the one before he fixed 23:45
});

test("orion-sleepplan waits for its lock and says so instead of writing over another change", (t) => {
  const { dir, env } = sandbox(t);
  mkdirSync(join(dir, "sleepplan.lock"));
  const r = spawnSync(process.execPath, [SLEEPPLAN, "bedtime", "23:45", "--json"], { encoding: "utf8", env: { ...env, ORION_SLEEPPLAN_LOCK_TRIES: "3" } });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /another change/i);
  assert.equal(existsSync(join(dir, "eval-life-config.json")), false, "nothing was written");
});

test("orion-sleepplan takes and releases its lock on a normal write", (t) => {
  const { dir, run } = sandbox(t);
  assert.equal(run("bedtime", "23:45", "--tonight", "--json").code, 0);
  assert.equal(existsSync(join(dir, "sleepplan.lock")), false);
  assert.equal(readdirTmp(dir), false, "no temp file is left behind");
});
const readdirTmp = (dir) => spawnSync("sh", ["-c", `ls ${dir} | grep -c '\\.tmp$'`], { encoding: "utf8" }).stdout.trim() !== "0";

test("orion-wake honours ORION_NOW: the next 07:30 from a pinned clock, and a rung one is not stated", (t) => {
  const home = tmp(t, "wake-");
  const env = (now) => ({ ...process.env, HOME: home, ORION_NOW: now, ORION_CONTROLLED_DIR: "" });
  const wake = (now, ...a) => spawnSync(process.execPath, [WAKE, ...a], { encoding: "utf8", env: env(now) });
  assert.equal(wake("2026-11-05T22:00:00", "07:30").status, 0);
  const file = join(home, ".openclaw/orion-controlled/wake-request.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(new Date(saved.at).toLocaleDateString("en-CA"), "2026-11-06");
  assert.equal(new Date(saved.setAt).getHours(), 22);
  assert.match(wake("2026-11-06T06:00:00").stdout, /Wake-up set/);
  assert.match(wake("2026-11-06T09:00:00").stdout, /No manual wake-up/);
  assert.equal(wake("2026-11-05T05:00:00", "07:30").status, 0);
  assert.equal(new Date(JSON.parse(readFileSync(file, "utf8")).at).toLocaleDateString("en-CA"), "2026-11-05", "still ahead on the pinned day: today");
});
