// Lock the Mac, with fallbacks (2026-11-04). On 2026-11-03 23:53 the bedtime lockdown's lock-screen failed ("Unknown native action: lock_screen":
// the deployed OrionMacBridge binary predated the action) while its message said "locked the Mac". Now the lock tries, in order:
//   1. the bridge's lock_screen (SACLockScreenImmediate), when this build has it
//   2. Ctrl+Cmd+Q through System Events (the real lock; needs Accessibility, which ORION has when it can click)
//   3. pmset displaysleepnow (no permission at all: the display sleeps and, with "require password immediately", the Mac is locked)
// and says which one worked. A method that fails falls through to the next; if all three fail it says so. Never throws.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BRIDGE = join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge");

/** Run a command, optionally with stdin; resolves { status, stdout }, never rejects. */
export const realExec = (cmd, args = [], { input, timeout = 10_000 } = {}) => new Promise((resolve) => {
  let out = "";
  let child;
  try { child = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"] }); } catch { return resolve({ status: 1, stdout: "" }); }
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  child.stdout.on("data", (c) => (out += String(c)));
  child.on("error", () => { clearTimeout(timer); resolve({ status: 1, stdout: out }); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ status: code ?? 1, stdout: out }); });
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
});

const KEYSTROKE = 'tell application "System Events" to keystroke "q" using {control down, command down}';

export async function lockMac({ exec = realExec, bridge = DEFAULT_BRIDGE, osascript = "/usr/bin/osascript", pmset = "/usr/bin/pmset" } = {}) {
  const tried = [];
  const steps = [
    ["bridge", () => exec(bridge, [], { input: `${JSON.stringify({ id: "lock", action: "lock_screen", payload: {} })}\n` }), (r) => !/"ok"\s*:\s*false/.test(r.stdout ?? "")],
    ["keystroke", () => exec(osascript, ["-e", KEYSTROKE]), () => true],
    ["display-sleep", () => exec(pmset, ["displaysleepnow"]), () => true],
  ];
  for (const [method, run, valid] of steps) {
    const r = await run().catch(() => ({ status: 1, stdout: "" }));
    if (r.status === 0 && valid(r)) return { ok: true, method, tried: [...tried, method] };
    tried.push(method);
  }
  return { ok: false, method: null, tried };
}
