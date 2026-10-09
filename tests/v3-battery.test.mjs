// The V3 battery reader and energy maths (handoff §10.4): ioreg prints negative
// currents as unsigned 64-bit numbers; power is only valid on battery; energy
// per task is power above the idle median, integrated over the task window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBattery, energyJoules, percentPerHour } from "../scripts/lib/eval/v3/battery.mjs";

const ioreg = (amp, external = "No") => `
    | |   "ExternalConnected" = ${external}
    | |   "InstantAmperage" = ${amp}
    | |   "Voltage" = 12500
    | |   "AppleRawMaxCapacity" = 7910
    | |   "DesignCapacity" = 8579
    | |   "MaxCapacity" = 100
    | |   "CurrentCapacity" = 88`;

test("a discharge current printed as unsigned 64-bit reads as negative milliamps", () => {
  const b = parseBattery(ioreg("18446744073709549616"));
  assert.equal(b.amperageMa, -2000);
  assert.equal(b.onBattery, true);
  assert.equal(b.watts, 25);
  assert.equal(b.rawMaxCapacityMah, 7910);
});

test("plugged in: no power reading is offered", () => {
  const b = parseBattery(ioreg("1076", "Yes"));
  assert.equal(b.onBattery, false);
  assert.equal(b.watts, null);
});

test("energy above idle over a window, and battery % per hour", () => {
  const samples = [0, 1, 2, 3, 4, 5].map((s) => ({ t: s * 1000, watts: s >= 1 && s <= 3 ? 20 : 8 }));
  assert.equal(energyJoules(samples, 1000, 3000, 8), 36);
  const pct = percentPerHour({ joulesPerTask: 50, tasksPerHour: 12, rawMaxCapacityMah: 7910, voltageMv: 12500 });
  assert.ok(Math.abs(pct - (600 / (7.91 * 12.5 * 3600)) * 100) < 1e-9);
});

import { parseTelemetry, averageWatts, batchJoulesPerTask } from "../scripts/lib/eval/v3/battery.mjs";

test("PowerTelemetryData accumulators give the true average load between two published snapshots", () => {
  const t = parseTelemetry(`"PowerTelemetryData" = {"AccumulatedSystemLoad"=6974789215,"SystemLoadAccumulatorCount"=510118,"SystemLoad"=1981}`);
  assert.deepEqual(t, { loadSum: 6974789215, loadCount: 510118, loadMw: 1981 });
  assert.equal(averageWatts({ loadSum: 6974789215, loadCount: 510118 }, { loadSum: 6974932114, loadCount: 510238 }), 142899 / 120 / 1000);
  assert.equal(averageWatts({ loadSum: 5, loadCount: 1 }, { loadSum: 5, loadCount: 1 }), null);
});

test("batch energy per task: (task watts − idle watts) × seconds ÷ tasks", () => {
  assert.equal(batchJoulesPerTask({ idleW: 2, taskW: 22, seconds: 300, tasks: 60 }), 100);
});

test("thermal state names follow ProcessInfo.ThermalState; anything else is unknown", async () => {
  const { thermalName } = await import("../scripts/lib/eval/v3/battery.mjs");
  assert.deepEqual(["0", "1", "2", "3", "x", ""].map(thermalName), ["nominal", "fair", "serious", "critical", "unknown", "unknown"]);
});
