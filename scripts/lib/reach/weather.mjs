// Hourly forecast for where Nick is (open-meteo, no key). Shared by
// orion-watches (weather watches) and orion-morning (the morning briefing).
// The place comes from orion-controlled/location.json ({ "place": "London" }).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** Today's remaining hours and all of tomorrow's, or null when nothing could be read. */
export async function weather(dir, now = new Date()) {
  const place = readJson(join(dir, "location.json"))?.place ?? "London";
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`, { signal: AbortSignal.timeout(10000) })).json();
  const g = geo.results?.[0]; if (!g) return null;
  const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&hourly=temperature_2m,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m&forecast_days=2&timezone=auto`, { signal: AbortSignal.timeout(10000) })).json();
  const h = f.hourly; const todayKey = h.time[0].slice(0, 10);
  const nowHour = now.getHours();
  return { hours: h.time.map((t, i) => ({ time: t, day: t.slice(0, 10) === todayKey ? "today" : "tomorrow", tempC: h.temperature_2m[i], rainChance: h.precipitation_probability[i] ?? 0,
    rainMm: h.precipitation[i] ?? 0, snowCm: h.snowfall[i] ?? 0, code: h.weather_code[i] ?? 0, windKph: h.wind_speed_10m[i] ?? 0 }))
    .filter((x) => x.day === "tomorrow" || Number(x.time.slice(11, 13)) >= nowHour) };
}
