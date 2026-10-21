import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { weatherWithRetry } from "../scripts/lib/reach/weather.mjs";
import { composeBriefing } from "../scripts/lib/reach/morning.mjs";

const dir = mkdtempSync(join(tmpdir(), "weather-"));
const json = (body) => ({ json: async () => body });
const hours = Array.from({ length: 48 }, (_, i) => `2026-10-21T${String(i % 24).padStart(2, "0")}:00`);
const GEO = { results: [{ latitude: 51.5, longitude: -0.1 }] };
const FORECAST = { hourly: { time: hours, temperature_2m: hours.map(() => 12), precipitation_probability: [], precipitation: [], snowfall: [], weather_code: [], wind_speed_10m: [] } };
const ok = (url) => json(String(url).includes("geocoding") ? GEO : FORECAST);
const noSleep = async () => {};
const quiet = () => {};

test("fails twice (network not up), then succeeds; each error is logged", async () => {
  let calls = 0; const logs = []; const waits = [];
  const fetchImpl = async (url) => { if (++calls <= 2) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }); return ok(url); };
  const r = await weatherWithRetry(dir, new Date(2026, 9, 21, 8), { fetchImpl, log: (m) => logs.push(m), sleepImpl: async (ms) => { waits.push(ms); } });
  assert.ok(r.data); assert.equal(r.data.dayHigh, 12); assert.equal(r.errors.length, 2);
  assert.equal(logs.length, 2); assert.match(logs[0], /attempt 1\/4 failed: TypeError: fetch failed \(ENOTFOUND\)/);
  assert.deepEqual(waits, [5000, 10000]);
});

test("always fails: 4 attempts, null data, every error kept, and the brief says weather wasn't available", async () => {
  let calls = 0; const logs = [];
  const r = await weatherWithRetry(dir, new Date(2026, 9, 21, 8), { fetchImpl: async () => { calls++; throw new Error("offline"); }, log: (m) => logs.push(m), sleepImpl: noSleep });
  assert.equal(r.data, null); assert.equal(calls, 4); assert.equal(r.errors.length, 4); assert.equal(logs.length, 4);
  const text = composeBriefing({ now: new Date(2026, 9, 21, 8), today: "2026-10-21", day: [], travel: [], todos: [], weather: r.data });
  assert.match(text, /Weather wasn't available yet/);
});

test("a hanging network is cut off at the time cap", async () => {
  const started = Date.now(); const logs = [];
  const fetchImpl = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const r = await weatherWithRetry(dir, new Date(2026, 9, 21, 8), { fetchImpl, attempts: 4, delaysMs: [10, 10, 10], timeoutMs: 1000, capMs: 120, log: (m) => logs.push(m) });
  assert.equal(r.data, null);
  assert.ok(Date.now() - started < 600, "returned near the cap, not after attempts x timeout");
  assert.ok(r.errors.length >= 1 && logs.length >= 1);
});
