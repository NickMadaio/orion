// Which calendar the planner talks to, and what time it is (2026-10-01).
//
// Normally the Mac bridge and the real clock. During a schedule evaluation
// (eval mode on AND a sandbox day written by orion-eval-schedule) the sandbox
// bridge and the sandbox's own "now", so ORION can be asked to move, resize and
// swap things for real without touching Nick's calendar.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { evalMode } from "../eval-mode.mjs";
import { clockNow as baseClock, outboxed, toOutbox } from "../clock.mjs";

const run = promisify(execFile);
export const SANDBOX_CALENDAR = process.env.ORION_SANDBOX_CALENDAR || join(process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw/orion-controlled"), "eval-calendar.json");
const SANDBOX_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "../eval/sandbox-bridge.mjs");
const REAL_BRIDGE = [join(homedir(), ".openclaw/orion-remote/bin/orion-mac-bridge"),
  join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge")].find((p) => existsSync(p))
  ?? join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge");

/** The one freshness rule, mirrored by plugin/orion-control/src/plugin-clock.ts: marker live AND calendar under 2 h old. */
export const SANDBOX_TTL_MS = 2 * 3600_000;
const calendarFresh = (now) => { try { return now - statSync(SANDBOX_CALENDAR).mtimeMs < SANDBOX_TTL_MS; } catch { return false; } };

/** The sandbox day while an evaluation runs, else null. ORION_BRIDGE_BIN (tests) always wins. */
export function sandbox(now = Date.now()) {
  if (process.env.ORION_BRIDGE_BIN || !evalMode(now) || !calendarFresh(now)) return null;
  try { return JSON.parse(readFileSync(SANDBOX_CALENDAR, "utf8")); } catch { return null; }
}

/** The time the planner should believe it is (ORION_RESCHEDULE_NOW, the sandbox's clock, then ORION_NOW, lib/clock.mjs). */
export function clockNow() {
  if (process.env.ORION_RESCHEDULE_NOW) return new Date(process.env.ORION_RESCHEDULE_NOW);
  const day = sandbox();
  return day?.now ? new Date(day.now) : baseClock();
}

/** Bridge actions that only read. Every other action changes his calendar or reminders. */
export const READ_ACTIONS = new Set(["list_upcoming_calendar_events", "list_deadlines", "list_incomplete_reminders", "list_reminder_lists", "get_calendar_event", "status"]);

/** One bridge request → its parsed result (throws on failure). */
export async function bridgeRequest(action, payload, { timeout = 30000 } = {}) {
  const inSandbox = sandbox() !== null;
  // A state copy (ORION_CONTROLLED_DIR not the live dir) never writes his real calendar or reminders: the write goes to
  // the outbox and fails, so the caller records nothing as done. A test's own fake bridge (ORION_BRIDGE_BIN) still runs.
  const write = !READ_ACTIONS.has(action);
  if (write && !inSandbox && outboxed(process.env, "ORION_BRIDGE_BIN")) {
    toOutbox(/reminder/.test(action) ? "reminders" : /calendar/.test(action) ? "calendar" : "mac-bridge", { action, payload }, { by: "bridge" });
    throw new Error(`isolated run: ${action} written to the outbox, not to the calendar`);
  }
  // ORION_BRIDGE_READ_BIN (tests): a stand-in for READS only, so a test can prove writes are still stopped.
  const readOnly = !write && !process.env.ORION_BRIDGE_BIN ? process.env.ORION_BRIDGE_READ_BIN : null;
  const request = JSON.stringify({ id: "life", action, payload }).replace(/'/g, "'\\''");
  const bin = readOnly || process.env.ORION_BRIDGE_BIN || (inSandbox ? `${process.execPath}" "${SANDBOX_BRIDGE}` : REAL_BRIDGE);
  const env = inSandbox ? { ...process.env, ORION_SANDBOX_CALENDAR: SANDBOX_CALENDAR } : process.env;
  const { stdout } = await run("/bin/sh", ["-c", `printf '%s\\n' '${request}' | "${bin}"`], { timeout, maxBuffer: 8 << 20, env });
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const parsed = line ? JSON.parse(line) : null;
  if (!parsed?.ok) throw new Error(parsed?.error ?? "the calendar bridge did not answer");
  return parsed.result;
}
