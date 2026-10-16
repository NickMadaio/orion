// Reading the Mac's state for orion-reach (2026-10-07). Parsers are pure and
// tested; gather() runs the system commands.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const parseIdleSeconds = (ioreg) => {
  const m = /"HIDIdleTime" = (\d+)/.exec(String(ioreg));
  return m ? Number(m[1]) / 1e9 : null;
};
export const parseLocked = (ioreg) => /"CGSSessionScreenIsLocked"=Yes/.test(String(ioreg));
export const parsePluggedIn = (pmset) => /'AC Power'/.test(String(pmset));
/** True when the default output device is Bluetooth or other external headphones. AirPlay is a speaker, not headphones (spec 3.1). */
export function parseHeadphones(profilerJson) {
  try {
    const items = JSON.parse(profilerJson).SPAudioDataType?.[0]?._items ?? [];
    const out = items.find((i) => i.coreaudio_default_audio_output_device === "spaudio_yes");
    if (!out) return false;
    return /bluetooth/i.test(out.coreaudio_device_transport ?? "") || /headphone|airpods|buds|beats/i.test(out._name ?? "");
  } catch { return false; }
}
export const parseVolume = (osa) => {
  const m = /output volume:(\d+).*output muted:(true|false)/.exec(String(osa));
  return m ? { volume: Number(m[1]), muted: m[2] === "true" } : { volume: 50, muted: false };
};

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 4000 }); } catch { return ""; } };

const ACTIVITY_MAX_AGE_MS = 90_000;
const activityFile = (dir) => join(dir ?? process.env.ORION_CONTROLLED_DIR ?? join(homedir(), ".openclaw/orion-controlled"), "focus-activity.json");
const readActivity = (dir, now) => {
  try {
    const a = JSON.parse(readFileSync(activityFile(dir), "utf8"));
    return now.getTime() - Date.parse(a.at) <= ACTIVITY_MAX_AGE_MS ? a : null;
  } catch { return null; }
};

/**
 * Mac facts. focus-activity.json (written every 30 s by the app) answers idle, lock and headphones without a
 * subprocess; ioreg and system_profiler are only the fallback when it is stale or lacks the field.
 * @param audio read the output volume too (osascript); off by default, only a caller about to speak needs it
 * @param headphones allow the slow system_profiler fallback for headphones
 */
export function gather({ dir, now = new Date(), audio = false, headphones = true } = {}) {
  const fresh = readActivity(dir, now);
  const idleSeconds = fresh && fresh.idleValid !== false && Number.isFinite(Number(fresh.idleSeconds)) ? Number(fresh.idleSeconds)
    : parseIdleSeconds(sh("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"]));
  const locked = typeof fresh?.locked === "boolean" ? fresh.locked : parseLocked(sh("/usr/sbin/ioreg", ["-n", "Root", "-d1"]));
  const route = fresh?.audio;
  const hp = typeof route?.headphones === "boolean" ? route.headphones
    : headphones ? parseHeadphones(sh("/usr/sbin/system_profiler", ["SPAudioDataType", "-json"])) : false;
  return {
    idleSeconds, locked,
    ...(typeof fresh?.displayAsleep === "boolean" ? { displayAsleep: fresh.displayAsleep } : {}),
    pluggedIn: parsePluggedIn(sh("/usr/bin/pmset", ["-g", "batt"])),
    headphones: hp,
    ...(fresh?.app ? { frontApp: fresh.app } : {}),
    ...(audio ? parseVolume(sh("/usr/bin/osascript", ["-e", "get volume settings"])) : {}),
  };
}
