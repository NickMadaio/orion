// The mouse files (orion-mouse). CONTRACT: <controlled dir>/mouse/devices.json is written ONLY by the Mac app; bindings.json is written by
// the Mac settings UI and by orion-mouse (tmp + rename, re-read under the lock before every write, last writer wins).
// Shapes are strict on the way out: a binding that does not validate is never written.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { controlledDir, clockNow } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";
import { updateJson } from "../awareness/io.mjs";

export const mouseDir = (env = process.env) => join(controlledDir(env), "mouse");

const SYSTEM_NAMES = ["missionControl", "appExpose", "stageManager", "showDesktop", "launchpad", "desktopLeft", "desktopRight", "notificationCenter"];
const ORION_COMMANDS = ["summon", "talk", "dashboard", "type"];
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const KEYS = /^(?:(?:cmd|ctrl|opt|shift|fn)\+)+[a-z0-9-=;',./`]$|^(?:(?:cmd|ctrl|opt|shift|fn)\+)+(?:space|tab|return|escape|delete|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1\d|20))$/;

export const WHEEL_MODES = ["games", "always", "never"];

export function validAction(a) {
  if (!a || typeof a !== "object") return false;
  switch (a.kind) {
    case "system": return SYSTEM_NAMES.includes(a.name);
    case "shortcut": return typeof a.keys === "string" && KEYS.test(a.keys);
    case "openApp": return typeof a.bundleId === "string" && BUNDLE.test(a.bundleId);
    case "orion": return ORION_COMMANDS.includes(a.command);
    case "passthrough": return true;
    default: return false;
  }
}

// Real extra buttons are CGEvent numbers 3..31; a button whose mouse sends F13..F20 is 113..120 (100 + the F number).
const validButtonKey = (k) => /^\d{1,3}$/.test(k) && ((Number(k) >= 3 && Number(k) <= 31) || (Number(k) >= 113 && Number(k) <= 120));
const validButtons = (map) => !!map && typeof map === "object" && Object.entries(map).every(([k, v]) => validButtonKey(k) && validAction(v));

/**
 * Asks the Mac app to open its mouse-setup popup: appends ONE line to <controlled dir>/outreach.jsonl,
 *   {"kind":"mouse","event":"setup-open","at":"<ISO>"}
 * It has no "text", so every outreach reader (reply context, the plugin's readLastOutreach) skips it. Not written during an evaluation.
 */
export function requestSetupPopup({ env = process.env, now = clockNow(env), event = "setup-open" } = {}) {
  if (evalMode()) return { written: false };
  mkdirSync(controlledDir(env), { recursive: true });
  const row = { kind: "mouse", event, at: now.toISOString() };
  appendFileSync(join(controlledDir(env), "outreach.jsonl"), `${JSON.stringify(row)}\n`);
  return { written: true, row };
}

/** Throws when a bindings object breaks the contract (it never reaches disk). */
export function assertBindings(b) {
  const bad = (why) => { throw new Error(`bindings would break the contract (${why})`); };
  if (!b || b.version !== 1) bad("version");
  if (typeof b.enabled !== "boolean") bad("enabled");
  if (!validButtons(b.default)) bad("default");
  if (!b.apps || typeof b.apps !== "object" || Object.entries(b.apps).some(([id, m]) => !BUNDLE.test(id) || !validButtons(m))) bad("apps");
  if (!Array.isArray(b.passthroughApps) || b.passthroughApps.some((id) => !BUNDLE.test(id))) bad("passthroughApps");
  if (typeof b.autoPassthroughGames !== "boolean") bad("autoPassthroughGames");
  if (b.autoPauseInGames !== undefined && typeof b.autoPauseInGames !== "boolean") bad("autoPauseInGames");
  if (b.toggleShortcut !== undefined && (typeof b.toggleShortcut !== "string" || !KEYS.test(b.toggleShortcut))) bad("toggleShortcut");
  if (b.reverseWheel !== undefined && !WHEEL_MODES.includes(b.reverseWheel)) bad("reverseWheel");
  return b;
}

export const emptyBindings = () => ({ version: 1, enabled: true, default: {}, apps: {}, passthroughApps: [], autoPassthroughGames: true, reverseWheel: "always", autoPauseInGames: true, toggleShortcut: "ctrl+opt+m" });

const readStrict = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`${path.split("/").pop()} is unreadable, so I left it alone`); }
};

export const readBindings = (env = process.env) => ({ ...emptyBindings(), ...readStrict(join(mouseDir(env), "bindings.json"), {}) });

/** The Mac app's device list (never written here). */
export function readDevices(env = process.env) {
  try { const j = readStrict(join(mouseDir(env), "devices.json"), { devices: [] }); return Array.isArray(j.devices) ? j.devices : []; } catch { return []; }
}

/**
 * Re-reads bindings under the lock, applies `change` (a pure function returning the next object), validates and writes tmp + rename.
 * Returns { before, after }. An unreadable file is refused rather than overwritten.
 */
export function changeBindings(change, env = process.env) {
  readStrict(join(mouseDir(env), "bindings.json"), {});   // refuse a corrupt file before taking the lock
  let result;
  updateJson(mouseDir(env), "bindings.json", (current) => {
    const before = { ...emptyBindings(), ...current };
    const after = assertBindings(change(before));
    result = { before, after };
    return after;
  }, emptyBindings());
  return result;
}
