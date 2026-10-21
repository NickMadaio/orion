// Hourly forecast for where Nick is (open-meteo, no key). Shared by
// orion-watches (weather watches) and orion-morning (the morning briefing).
// The place comes from orion-controlled/location.json ({ "place": "London" }).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const signalFor = (ms, outer) => (outer ? AbortSignal.any([AbortSignal.timeout(ms), outer]) : AbortSignal.timeout(ms));

/** Today's remaining hours and all of tomorrow's, or null when nothing could be read. */
export async function weather(dir, now = new Date(), { fetchImpl = fetch, timeoutMs = 10000, signal } = {}) {
  const place = readJson(join(dir, "location.json"))?.place ?? "London";
  const geo = await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`, { signal: signalFor(timeoutMs, signal) })).json();
  const g = geo.results?.[0]; if (!g) return null;
  const f = await (await fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&hourly=temperature_2m,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m&forecast_days=2&timezone=auto`, { signal: signalFor(timeoutMs, signal) })).json();
  const h = f.hourly; const todayKey = h.time[0].slice(0, 10);
  const nowHour = now.getHours();
  // The day's own low and high, from every hour: the "remaining hours" low read 17 at 10:45 for a day that began colder.
  const dayTemps = h.time.flatMap((t, i) => (t.slice(0, 10) === todayKey ? [h.temperature_2m[i]] : []));
  return { dayLow: dayTemps.length ? Math.round(Math.min(...dayTemps)) : null, dayHigh: dayTemps.length ? Math.round(Math.max(...dayTemps)) : null,
    hours: h.time.map((t, i) => ({ time: t, day: t.slice(0, 10) === todayKey ? "today" : "tomorrow", tempC: h.temperature_2m[i], rainChance: h.precipitation_probability[i] ?? 0,
    rainMm: h.precipitation[i] ?? 0, snowCm: h.snowfall[i] ?? 0, code: h.weather_code[i] ?? 0, windKph: h.wind_speed_10m[i] ?? 0 }))
    .filter((x) => x.day === "tomorrow" || Number(x.time.slice(11, 13)) >= nowHour) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * weather() for a Mac that has only just woken: the network may not be up yet (2026-10-14, 10-17 and 10-20 had no weather).
 * Up to `attempts` tries with growing waits, every error logged, and a hard `capMs` for the whole thing so the brief
 * is never held longer than that. Returns { data, errors }; data is null when every attempt failed or the cap hit.
 */
export async function weatherWithRetry(dir, now = new Date(), { fetchImpl = fetch, attempts = 4, delaysMs = [5000, 10000, 15000], timeoutMs = 10000, capMs = 60000,
  log = (m) => console.error(m), sleepImpl = sleep, clock = Date.now } = {}) {
  const started = clock();
  const errors = [];
  const cap = AbortSignal.timeout(capMs);
  for (let i = 0; i < attempts; i++) {
    const left = capMs - (clock() - started);
    if (left <= 0) { log("weather: time cap reached, giving up"); break; }
    try {
      const data = await weather(dir, now, { fetchImpl, timeoutMs: Math.min(timeoutMs, left), signal: cap });
      if (data) return { data, errors };
      errors.push("no forecast for that place"); log(`weather: attempt ${i + 1}/${attempts}: no forecast for that place`);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}` : String(e);
      errors.push(msg); log(`weather: attempt ${i + 1}/${attempts} failed: ${msg}`);
    }
    if (i === attempts - 1) break;
    const wait = Math.min(delaysMs[i] ?? delaysMs.at(-1) ?? 0, Math.max(0, capMs - (clock() - started)));
    if (wait <= 0) { log("weather: time cap reached, giving up"); break; }
    await sleepImpl(wait);
  }
  return { data: null, errors };
}
