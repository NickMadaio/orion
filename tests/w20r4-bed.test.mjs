// w20 round 4: a standing bedtime supersedes tonight's one-off for the same evening (the reply must be the read-back of what is in force),
// and "reset" gives the bedtime back to what it was before he fixed one, so the computed bedtime returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SLEEPPLAN = fileURLToPath(new URL("../scripts/orion-sleepplan", import.meta.url));

function sandbox(t, config) {
  const dir = mkdtempSync(join(tmpdir(), "sleepplan-r4-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "eval-mode"), "");
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: new Date(2026, 10, 2, 20, 0).toISOString(), events: [] }));
  if (config) writeFileSync(join(dir, "eval-life-config.json"), JSON.stringify(config));
  const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run = (...args) => { const r = spawnSync(process.execPath, [SLEEPPLAN, ...args], { encoding: "utf8", env }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const saved = () => JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8"));
  return { run, saved };
}

test("'every night' after 'tonight only' replaces tonight's override: the read-back is what is in force", (t) => {
  const { run, saved } = sandbox(t);
  assert.equal(run("bedtime", "00:00", "--tonight", "--json").code, 0);
  const r = run("bedtime", "23:15", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.readback.sleepBy, "23:15");
  assert.equal(out.readback.tonightOnly, false);
  assert.equal(saved().sleepPlan.bedOverrides, undefined);
  assert.equal(saved().sleepPlan.bedFixed, true);
});

test("'tonight' after 'every night' is still just tonight, and the standing one stays", (t) => {
  const { run, saved } = sandbox(t);
  run("bedtime", "23:30", "--json");
  const out = JSON.parse(run("bedtime", "00:00", "--tonight", "--json").out);
  assert.equal(out.readback.sleepBy, "00:00");
  assert.equal(saved().bedtime, "23:30");
});

test("reset puts the bedtime back to what it was before he fixed one, clears tonight, and reads back the computed one", (t) => {
  const { run, saved } = sandbox(t, { bedtime: "23:00" });
  run("bedtime", "23:15", "--json");
  run("bedtime", "00:00", "--tonight", "--json");
  const r = run("bedtime", "reset", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.readback.fixed, false);
  assert.equal(out.readback.tonightOnly, false);
  assert.notEqual(out.readback.sleepBy, "23:15");
  assert.notEqual(out.readback.sleepBy, "00:00");
  const s = saved();
  assert.equal(s.bedtime, "23:00");   // he had one before fixing: exactly that comes back
  assert.notEqual(s.sleepPlan.bedFixed, true);
  assert.equal(s.sleepPlan.bedOverrides, undefined);
  assert.equal(s.sleepPlan.bedWas, undefined);
});

test("reset on a config that never had a bedtime removes the key again (gate 3 #9/#10: the snapshot had none)", (t) => {
  const { run, saved } = sandbox(t, { commuteMinutes: 45 });
  run("bedtime", "23:15", "--json");
  assert.equal(saved().bedtime, "23:15");
  run("bedtime", "23:20", "--json");   // already fixed: nothing new is remembered
  run("bedtime", "reset", "--json");
  assert.equal("bedtime" in saved(), false);
  assert.equal(saved().commuteMinutes, 45, "the rest of the config is untouched");
  run("bedtime", "23:40", "--json");
  run("bedtime", "reset", "--json");
  assert.equal("bedtime" in saved(), false);
});

test("reset when no bedtime was ever fixed writes nothing", (t) => {
  const { run, saved } = sandbox(t, { commuteMinutes: 45 });
  assert.equal(run("bedtime", "reset", "--json").code, 0);
  assert.equal("bedtime" in saved(), false);
});

test("orion-wake clear sets each request aside under its own name instead of deleting alarm data", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wake-r4-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wake = (now) => spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/orion-wake", import.meta.url)), "clear"], { encoding: "utf8", env: { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir, ORION_NOW: now } });
  for (const [at, now] of [["2026-11-06T07:00:00", "2026-11-05T22:00:00"], ["2026-11-06T08:30:00", "2026-11-05T22:05:00"]]) {
    writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at, setAt: "x" }));
    assert.equal(wake(now).status, 0);
    assert.equal(existsSync(join(dir, "wake-request.json")), false);
  }
  const kept = readdirSync(dir).filter((f) => f.startsWith("wake-request.cleared-"));
  assert.equal(kept.length, 2, "the second clear did not overwrite the first");
  assert.deepEqual(kept.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).at).sort(), ["2026-11-06T07:00:00", "2026-11-06T08:30:00"]);
});
