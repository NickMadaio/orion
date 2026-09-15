import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
/*
 The things an assistant is expected to just know: what it is like outside, what
 time it is, how the machine is doing, and what it was asked to remember.

 None of these touch the filesystem roots, none can mutate a user file, and only
 the weather leaves the machine — to one fixed, keyless, no-account endpoint that
 is given a place name and nothing else. They are grouped as their own capability
 tiers so that "Orion can tell me the weather" and "Orion can delete files" stay
 separate decisions.
*/
// ---------------------------------------------------------------- weather
/**
 * Open-Meteo: no API key, no account, and no request body beyond a place name
 * or a coordinate. That matters here — a weather provider that wanted a key
 * would mean another credential on disk, and one that wanted a precise location
 * would mean Orion reporting where its user is to a third party on a schedule.
 */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
/** Give up rather than hang a voice turn waiting on the network. */
const NETWORK_TIMEOUT_MS = 6000;
/** WMO weather codes, in the words a person would actually use. */
const WEATHER_CODES = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "foggy", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "heavy freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "heavy freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorms", 96: "thunderstorms with hail",
    99: "thunderstorms with heavy hail",
};
function describeCode(code) {
    return typeof code === "number" && WEATHER_CODES[code] !== undefined
        ? WEATHER_CODES[code]
        : "unsettled";
}
async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Weather service replied ${response.status}.`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timer);
    }
}
function round(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.round(value)
        : fallback;
}
async function resolvePlace(query) {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&format=json`;
    const body = (await fetchJson(url));
    const hit = body.results?.[0];
    if (!hit ||
        typeof hit.latitude !== "number" ||
        typeof hit.longitude !== "number") {
        throw new Error(`I could not find a place called “${query}”.`);
    }
    // Region included because place names repeat: "Springfield" alone would leave
    // the user unable to tell a wrong answer from a right one.
    const region = [hit.admin1, hit.country_code].filter(Boolean).join(", ");
    return {
        name: region ? `${hit.name}, ${region}` : (hit.name ?? query),
        latitude: hit.latitude,
        longitude: hit.longitude,
    };
}
export async function readWeather(options) {
    const place = await resolvePlace(options.location);
    const days = Math.min(7, Math.max(0, options.days ?? 0));
    const parameters = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        timezone: "auto",
    });
    if (days > 0) {
        parameters.set("daily", "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max");
        parameters.set("forecast_days", String(days + 1));
    }
    const body = (await fetchJson(`${FORECAST_URL}?${parameters}`));
    const current = body.current ?? {};
    const temperatureC = round(current.temperature_2m);
    const conditions = describeCode(current.weather_code);
    const daily = body.daily;
    const forecast = [];
    if (daily && Array.isArray(daily.time)) {
        for (let i = 0; i < daily.time.length && i <= days; i++) {
            forecast.push({
                date: String(daily.time[i]),
                highC: round(daily.temperature_2m_max?.[i]),
                lowC: round(daily.temperature_2m_min?.[i]),
                conditions: describeCode(daily.weather_code?.[i]),
                precipitationChance: round(daily.precipitation_probability_max?.[i]),
            });
        }
    }
    return {
        place: place.name,
        summary: `${conditions}, ${temperatureC} degrees in ${place.name}`,
        temperatureC,
        temperatureF: Math.round((temperatureC * 9) / 5 + 32),
        feelsLikeC: round(current.apparent_temperature, temperatureC),
        conditions,
        windKph: round(current.wind_speed_10m),
        days: forecast,
    };
}
// ------------------------------------------------------------------ clock
export function readClock(timezone) {
    const now = new Date();
    const zone = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let spoken;
    try {
        spoken = now.toLocaleString("en-US", {
            timeZone: zone,
            weekday: "long", hour: "numeric", minute: "2-digit",
            month: "long", day: "numeric",
        });
    }
    catch {
        throw new Error(`I do not know a time zone called “${zone}”.`);
    }
    return { iso: now.toISOString(), spoken, timezone: zone };
}
// ---------------------------------------------------------- system status
/**
 * How the machine itself is doing.
 *
 * Every one of these is a plain read of a system counter — nothing here can
 * change a setting. `pmset -g batt` rather than a settings API for exactly that
 * reason: there is no write form of it to get wrong.
 */
export async function readSystemStatus() {
    const parts = [];
    const result = {
        uptime: "", summary: "",
    };
    try {
        const { stdout } = await run("pmset", ["-g", "batt"], { timeout: 4000 });
        const percent = /(\d+)%/.exec(stdout);
        const state = /;\s*([a-z ]+);/i.exec(stdout);
        if (percent) {
            result.batteryPercent = Number(percent[1]);
            result.batteryState = state?.[1]?.trim() ?? "unknown";
            parts.push(`battery ${result.batteryPercent}% (${result.batteryState})`);
        }
    }
    catch {
        // A desktop with no battery is not an error, it is a Mac mini.
    }
    try {
        const { stdout } = await run("df", ["-k", os.homedir()], { timeout: 4000 });
        const line = stdout.trim().split("\n").pop() ?? "";
        const columns = line.split(/\s+/);
        const totalKb = Number(columns[1]);
        const freeKb = Number(columns[3]);
        if (Number.isFinite(totalKb) && Number.isFinite(freeKb)) {
            result.diskTotalGb = Math.round(totalKb / 1024 / 1024);
            result.diskFreeGb = Math.round(freeKb / 1024 / 1024);
            parts.push(`${result.diskFreeGb} of ${result.diskTotalGb} GB free`);
        }
    }
    catch {
        /* reported by omission */
    }
    const seconds = os.uptime();
    const dayCount = Math.floor(seconds / 86400);
    const hourCount = Math.floor((seconds % 86400) / 3600);
    result.uptime = dayCount > 0 ? `${dayCount}d ${hourCount}h` : `${hourCount}h`;
    parts.push(`up ${result.uptime}`);
    result.summary = parts.join(", ");
    return result;
}
export function remindersPath(configured) {
    return configured
        ? path.resolve(configured)
        : path.join(os.homedir(), ".openclaw", "orion-controlled", "reminders.json");
}
export async function readReminders(file) {
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((entry) => typeof entry === "object" && entry !== null &&
            typeof entry.id === "string" &&
            typeof entry.dueAt === "number");
    }
    catch {
        // Missing or corrupt reads as empty. A timer store is not worth failing a
        // turn over, and the next write repairs it.
        return [];
    }
}
/**
 * Write via a temp file and rename.
 *
 * The Orion app polls this file continuously, so a plain write would let it
 * observe a half-written array and conclude every timer had been cancelled.
 * Rename is atomic within a filesystem, so the reader sees either the old file
 * or the new one and never a partial.
 */
export async function writeReminders(file, reminders) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(reminders, null, 2), "utf8");
    await rename(temporary, file);
}
/** Spoken durations, so "an hour and a half" does not come back as 5400 seconds. */
export function describeDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const parts = [];
    if (hours > 0)
        parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes > 0)
        parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (rest > 0 && hours === 0)
        parts.push(`${rest} second${rest === 1 ? "" : "s"}`);
    return parts.join(" ") || "0 seconds";
}
/**
 * Resolve "7:30", "7:30am", or an ISO timestamp to the next moment it names.
 *
 * A bare clock time that has already passed today means tomorrow — someone
 * setting an alarm for 7:30 at midnight means the morning that is coming, not
 * the one that is gone.
 */
// -------------------------------------------------- Apple Music control
/**
 * Pause Apple Music. Returns true if Music was running and responded.
 */
export async function pauseAppleMusic() {
    try {
        const script = `tell application "Music"
  pause
  return true
end tell`;
        const { stdout } = await run("osascript", ["-e", script], { timeout: 3000 });
        return stdout.toLowerCase().includes("true");
    }
    catch {
        // Music not running or no response is not an error; we tried.
        return false;
    }
}
export function resolveAlarmTime(at, now = new Date()) {
    const trimmed = at.trim();
    const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(trimmed);
    if (clock) {
        let hour = Number(clock[1]);
        const minute = Number(clock[2] ?? "0");
        const meridiem = clock[3]?.toLowerCase();
        if (meridiem === "pm" && hour < 12)
            hour += 12;
        if (meridiem === "am" && hour === 12)
            hour = 0;
        if (hour > 23 || minute > 59) {
            throw new Error(`“${at}” is not a time of day.`);
        }
        const target = new Date(now);
        target.setHours(hour, minute, 0, 0);
        if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return target.getTime();
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
        throw new Error(`I could not read “${at}” as a time.`);
    }
    return parsed;
}
