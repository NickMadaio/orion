// Battery power for the V3 energy measurements (handoff §10.4). No sudo: the
// AppleSmartBattery registry gives the instant current and voltage, which mean
// power only while discharging. ioreg prints a negative current as an unsigned
// 64-bit number, so it is read through BigInt. MaxCapacity is a percent on this
// Mac (day zero, 2026-10-08); the capacity in mAh is AppleRawMaxCapacity.
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
