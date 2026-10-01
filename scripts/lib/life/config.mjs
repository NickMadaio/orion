// Nick's standing preferences for planning, one small file he can change in
// conversation ("make my side-project hour about the London vlog").
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import { sandbox } from "./bridge-path.mjs";
// During a schedule evaluation, a copy: a rule said in a test must not change his real settings.
export const CONFIG_FILE = process.env.ORION_LIFE_CONFIG
  || join(homedir(), `.openclaw/orion-controlled/${sandbox() ? "eval-" : ""}life-config.json`);
export const DEFAULTS = Object.freeze({
  sideProjectMinutes: 60, sideProjectLabel: "Side project (YouTube)",
  gymDays: [1, 3, 5], gymMinutes: 60,
  bedtime: "00:00", usualWake: "09:00", sleepHours: 8,
  studyMinutes: 60, dinner: true, windDownMinutes: 30, freeMinutesKept: 60,
  commuteMinutes: 30,
  readyMinutes: 105,
  bufferMinutes: 10,         // between planned blocks (2026-10-01: "things are smooshed")         // up before his first commitment: 7:15 for a 9:00 class (the phone uses the same)
  // Events he never goes to (2026-09-30: "get rid of that optional workshop, i
  // never go to them … all of them going forwards"). Case-insensitive substrings.
  ignoreTitles: ["(optional)"],
  // His one to-do list, and the lists whose reminders are moved onto it (Siri
  // and the phone put new reminders on "Reminders"). Other lists (Groceries,
  // Family) are never planned from.
  todoList: "Orion",
  sweepLists: ["Reminders"],
  // Least minutes for anything whose title contains the key (orion-life min nap 75).
  minimums: {},
  // When the day overflows, low-priority blocks give up time before any is dropped.
  autoShrink: true,
});

/** True when ORION should act as if this calendar event did not exist. */
export function ignoredEvent(title, config = loadConfig()) {
  const t = String(title ?? "").toLowerCase();
  return (config.ignoreTitles ?? []).some((pattern) => pattern && t.includes(String(pattern).toLowerCase()));
}

export function loadConfig(file = CONFIG_FILE) {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { return { ...DEFAULTS }; }
}

const VALIDATORS = {
  commuteMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 180,
  bufferMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 30,
  readyMinutes: (v) => Number.isInteger(v) && v >= 15 && v <= 180,
  todoList: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 60,
  sweepLists: (v) => Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === "string" && x.trim().length > 0 && x.length <= 60),
  ignoreTitles: (v) => Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string" && x.trim().length >= 3 && x.length <= 80),
  sideProjectMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 300,
  sideProjectLabel: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 60,
  gymDays: (v) => Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7),
  gymMinutes: (v) => Number.isInteger(v) && v >= 15 && v <= 180,
  bedtime: (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  usualWake: (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  sleepHours: (v) => typeof v === "number" && v >= 5 && v <= 11,
  studyMinutes: (v) => Number.isInteger(v) && v >= 15 && v <= 240,
  dinner: (v) => typeof v === "boolean",
  windDownMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 90,
  freeMinutesKept: (v) => Number.isInteger(v) && v >= 0 && v <= 240,
  autoShrink: (v) => typeof v === "boolean",
};

/** "Naps at least 75 minutes, always": orion-life min nap 75 (0 removes it). */
export function setMinimum(key, minutes, file = CONFIG_FILE) {
  const name = String(key ?? "").trim().toLowerCase();
  const n = Number(minutes);
  if (!/^[a-z0-9][a-z0-9 '-]{1,39}$/.test(name)) throw new TypeError(`"${key}" is not a usable name`);
  if (!Number.isInteger(n) || n < 0 || n > 600) throw new TypeError("minutes must be 0..600");
  const current = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } })();
  const minimums = { ...(current.minimums ?? {}) };
  if (n === 0) delete minimums[name]; else minimums[name] = n;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...current, minimums }, null, 2));
  renameSync(tmp, file);
  return minimums;
}

export function setConfig(key, raw, file = CONFIG_FILE) {
  if (!VALIDATORS[key]) throw new TypeError(`unknown setting ${key}`);
  let value = raw;
  if (typeof DEFAULTS[key] === "number") value = Number(raw);
  if (typeof DEFAULTS[key] === "boolean") value = raw === true || raw === "true";
  if (Array.isArray(DEFAULTS[key])) value = String(raw).split(",").map((x) => Number(x.trim()));
  if (!VALIDATORS[key](value)) throw new TypeError(`${key} cannot be ${raw}`);
  const current = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } })();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...current, [key]: value }, null, 2));
  renameSync(tmp, file);
  return value;
}

export const toMinute = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
