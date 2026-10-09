// Battery power for the V3 energy measurements (handoff §10.4). Measured
// 2026-10-08: the AppleSmartBattery registry publishes once a minute, so 1 Hz
// per-task readings are not possible. PowerTelemetryData's accumulators
// (AccumulatedSystemLoad / SystemLoadAccumulatorCount, mW, sampled finely inside
// the gauge) give the exact average load between two published snapshots, so
// energy is measured in batches: an idle window, then tasks back to back.
// No sudo. The instant current × voltage (power while discharging) is kept for
// spot readings; ioreg prints a negative current as an unsigned 64-bit number,
// so it is read through BigInt. MaxCapacity is a percent on this Mac (day zero,
// 2026-10-08); the capacity in mAh is AppleRawMaxCapacity.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { execFileSync } from "node:child_process";

const field = (text, key) => (text.match(new RegExp(`"${key}" = ([^\\n]+)`)) ?? [])[1]?.trim();
const signed64 = (raw) => {
  if (raw === undefined) return null;
  const v = BigInt(raw);
  return Number(v > 2n ** 63n ? v - 2n ** 64n : v);
};

export function parseBattery(text) {
  const amperageMa = signed64(field(text, "InstantAmperage") ?? field(text, "Amperage"));
  const voltageMv = Number(field(text, "Voltage"));
  const onBattery = field(text, "ExternalConnected") === "No";
  return {
    onBattery, amperageMa, voltageMv,
    watts: onBattery && amperageMa !== null ? Math.round((-amperageMa * voltageMv) / 1e6 * 1000) / 1000 : null,
    rawMaxCapacityMah: Number(field(text, "AppleRawMaxCapacity")) || null,
    designCapacityMah: Number(field(text, "DesignCapacity")) || null,
    percent: Number(field(text, "CurrentCapacity")) || null,
  };
}

export const readBattery = () => parseBattery(execFileSync("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery"], { encoding: "utf8" }));

/** Σ (watts − idle) × Δt over [t0, t1] (ms timestamps, 1 Hz samples). */
export function energyJoules(samples, t0, t1, idleWatts) {
  const inside = samples.filter((s) => s.t >= t0 && s.t <= t1 && s.watts != null);
  return inside.reduce((sum, s, i) => sum + Math.max(0, s.watts - idleWatts) * (i === 0 ? 1 : (s.t - inside[i - 1].t) / 1000), 0);
}

/** % of the battery per hour of normal use. */
export function percentPerHour({ joulesPerTask, tasksPerHour, rawMaxCapacityMah, voltageMv }) {
  const capacityJ = (rawMaxCapacityMah / 1000) * (voltageMv / 1000) * 3600;
  return ((joulesPerTask * tasksPerHour) / capacityJ) * 100;
}

/** Sample at 1 Hz until stop() is called; returns { stop: () => samples }. */
export function startSampler(read = readBattery, intervalMs = 1000) {
  const samples = [];
  const tick = () => { try { const b = read(); samples.push({ t: Date.now(), watts: b.watts, percent: b.percent, onBattery: b.onBattery }); } catch { /* one missed sample */ } };
  tick();
  const timer = setInterval(tick, intervalMs);
  return { stop: () => { clearInterval(timer); return samples; }, samples };
}

const telemetryField = (text, key) => { const m = text.match(new RegExp(`"${key}"=(\\d+)`)); return m ? Number(m[1]) : null; };

/** { loadSum, loadCount, loadMw } from ioreg's PowerTelemetryData. */
export function parseTelemetry(text) {
  return { loadSum: telemetryField(text, "AccumulatedSystemLoad"), loadCount: telemetryField(text, "SystemLoadAccumulatorCount"), loadMw: telemetryField(text, "SystemLoad") };
}

export const readTelemetry = () => parseTelemetry(execFileSync("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery"], { encoding: "utf8" }));

/** Average system load in watts between two telemetry snapshots (null if the gauge has not published since). */
export function averageWatts(a, b) {
  const n = b.loadCount - a.loadCount;
  return n > 0 ? (b.loadSum - a.loadSum) / n / 1000 : null;
}

export const batchJoulesPerTask = ({ idleW, taskW, seconds, tasks }) => ((taskW - idleW) * seconds) / tasks;

/** Wait until the gauge publishes a new snapshot (it does about once a minute); returns it. */
export async function nextSnapshot(read = readTelemetry, timeoutMs = 120000) {
  const first = read();
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = read();
    if (now.loadCount !== first.loadCount) return { ...now, t: Date.now() };
    if (Date.now() - start > timeoutMs) return { ...now, t: Date.now() };
  }
}

// Thermal state (added 2026-10-09: a run in a closed backpack throttled the chip and slowed timings).
// ProcessInfo.thermalState via swift (~0.1 s, no sudo): 0 nominal, 1 fair, 2 serious, 3 critical.
const THERMAL = ["nominal", "fair", "serious", "critical"];
export const thermalName = (raw) => (/^[0-3]$/.test(String(raw).trim()) ? THERMAL[Number(raw)] : "unknown");
export function thermalNow() {
  try { return thermalName(execFileSync("swift", ["-e", "import Foundation; print(ProcessInfo.processInfo.thermalState.rawValue)"], { encoding: "utf8", timeout: 15000 })); }
  catch { return "unknown"; }
}
