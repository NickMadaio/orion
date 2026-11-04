// Turns what the light helper saw into one state. No camera, ever: the Mac's own ambient light sensor, else the display's brightness.
// Thresholds are lux from the sensor's level field: a lit room reads in the hundreds, a lamp a few dozen, a dark room under 5.
// They have NOT been checked against a lit room on the M5 Pro (the lid was closed when this was built); see the note in AGENTS.md.
export const BRIGHT_LUX = 30;
export const DARK_LUX = 5;

const fromLux = (lux) => (lux >= BRIGHT_LUX ? "bright" : lux < DARK_LUX ? "dark" : "dim");

/** read: { als:{lux,event}, display:{brightness}, lidClosed } -> { state, source, lux?, note } */
export function classifyLight(read) {
  if (!read || typeof read !== "object") return { state: "unknown", source: null, note: "No light reading." };
  if (read.lidClosed) return { state: "unknown", source: null, note: "The lid is closed, so the light sensor is covered and says nothing about the room." };
  const lux = read.als?.lux;
  if (typeof lux === "number" && Number.isFinite(lux)) return { state: fromLux(lux), source: "als", lux, note: `Ambient light sensor: ${Math.round(lux * 10) / 10} lux.` };
  const b = read.display?.brightness;
  if (typeof b === "number" && Number.isFinite(b)) return { state: b >= 0.6 ? "bright" : b < 0.2 ? "dark" : "dim", source: "display", brightness: b, note: "No light sensor reading; this is the display's brightness, which is only a rough proxy." };
  return { state: "unknown", source: null, note: "No light sensor is readable on this Mac and the display brightness is not readable either." };
}
