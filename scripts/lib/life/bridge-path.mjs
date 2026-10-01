// Which calendar the planner talks to, and what time it is (2026-10-01).
//
// Normally the Mac bridge and the real clock. During a schedule evaluation
// (eval mode on AND a sandbox day written by orion-eval-schedule) the sandbox
// bridge and the sandbox's own "now", so ORION can be asked to move, resize and
// swap things for real without touching Nick's calendar.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { evalMode } from "../eval-mode.mjs";

const run = promisify(execFile);
export const SANDBOX_CALENDAR = process.env.ORION_SANDBOX_CALENDAR || join(homedir(), ".openclaw/orion-controlled/eval-calendar.json");
const SANDBOX_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "../eval/sandbox-bridge.mjs");
const REAL_BRIDGE = [join(homedir(), ".openclaw/orion-remote/bin/orion-mac-bridge"),
  join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge")].find((p) => existsSync(p))
  ?? join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge");

/** The sandbox day while an evaluation runs, else null. ORION_BRIDGE_BIN (tests) always wins. */
export function sandbox() {
  if (process.env.ORION_BRIDGE_BIN || !evalMode() || !existsSync(SANDBOX_CALENDAR)) return null;
  try { return JSON.parse(readFileSync(SANDBOX_CALENDAR, "utf8")); } catch { return null; }
}

/** The time the planner should believe it is. */
export function clockNow() {
  if (process.env.ORION_RESCHEDULE_NOW) return new Date(process.env.ORION_RESCHEDULE_NOW);
  const day = sandbox();
  return day?.now ? new Date(day.now) : new Date();
}

/** One bridge request → its parsed result (throws on failure). */
export async function bridgeRequest(action, payload, { timeout = 30000 } = {}) {
  const request = JSON.stringify({ id: "life", action, payload }).replace(/'/g, "'\\''");
  const inSandbox = sandbox() !== null;
  const bin = process.env.ORION_BRIDGE_BIN || (inSandbox ? `${process.execPath}" "${SANDBOX_BRIDGE}` : REAL_BRIDGE);
  const env = inSandbox ? { ...process.env, ORION_SANDBOX_CALENDAR: SANDBOX_CALENDAR } : process.env;
  const { stdout } = await run("/bin/sh", ["-c", `printf '%s\\n' '${request}' | "${bin}"`], { timeout, maxBuffer: 8 << 20, env });
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const parsed = line ? JSON.parse(line) : null;
  if (!parsed?.ok) throw new Error(parsed?.error ?? "the calendar bridge did not answer");
  return parsed.result;
}
