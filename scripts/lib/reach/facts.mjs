// Reading the Mac's state for orion-reach (2026-10-07). Parsers are pure and
// tested; gather() runs the system commands.
import { execFileSync } from "node:child_process";

export const parseIdleSeconds = (ioreg) => {
  const m = /"HIDIdleTime" = (\d+)/.exec(String(ioreg));
  return m ? Number(m[1]) / 1e9 : null;
};
export const parseLocked = (ioreg) => /"CGSSessionScreenIsLocked"=Yes/.test(String(ioreg));
export const parsePluggedIn = (pmset) => /'AC Power'/.test(String(pmset));
/** True when the default output device is Bluetooth or other external headphones. */
export function parseHeadphones(profilerJson) {
  try {
    const items = JSON.parse(profilerJson).SPAudioDataType?.[0]?._items ?? [];
    const out = items.find((i) => i.coreaudio_default_audio_output_device === "spaudio_yes");
    if (!out) return false;
    return /bluetooth|airplay/i.test(out.coreaudio_device_transport ?? "") || /headphone|airpods|buds|beats/i.test(out._name ?? "");
  } catch { return false; }
}
export const parseVolume = (osa) => {
  const m = /output volume:(\d+).*output muted:(true|false)/.exec(String(osa));
  return m ? { volume: Number(m[1]), muted: m[2] === "true" } : { volume: 50, muted: false };
};

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 4000 }); } catch { return ""; } };

export function gather() {
  return {
    idleSeconds: parseIdleSeconds(sh("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"])),
    locked: parseLocked(sh("/usr/sbin/ioreg", ["-n", "Root", "-d1"])),
    pluggedIn: parsePluggedIn(sh("/usr/bin/pmset", ["-g", "batt"])),
    headphones: parseHeadphones(sh("/usr/sbin/system_profiler", ["SPAudioDataType", "-json"])),
    ...parseVolume(sh("/usr/bin/osascript", ["-e", "get volume settings"])),
  };
}
