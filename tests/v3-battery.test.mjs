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
