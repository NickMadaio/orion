// Lock the Mac, with fallbacks (2026-11-04). On 2026-11-03 23:53 the bedtime lockdown's lock-screen failed ("Unknown native action: lock_screen":
// the deployed OrionMacBridge binary predated the action) while its message said "locked the Mac". Now the lock tries, in order:
//   1. the bridge's lock_screen (SACLockScreenImmediate), when this build has it
//   2. Ctrl+Cmd+Q through System Events (the real lock; needs Accessibility, which ORION has when it can click)
//   3. pmset displaysleepnow (no permission at all: the display sleeps and, with "require password immediately", the Mac is locked)
// and says which one worked. A method counts as a lock only once the session reports the screen locked; display sleep alone is said as such. A method that fails falls through to the next; if all three fail it says so. Never throws.
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

/** Is the screen really locked? CGSSessionScreenIsLocked in the root registry entry (no permission, no python). */
export async function screenLocked(exec = realExec) {
  for (let i = 0; i < 4; i += 1) {
    const r = await exec("/usr/sbin/ioreg", ["-n", "Root", "-d1", "-a"]);
    if (/CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(r.stdout ?? "")) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

/** { ok, method, locked, displayOnly }: locked is verified; display-sleep is ok but never claimed as a lock unless it verifies. */
export async function lockMac({ exec = realExec, verify = () => screenLocked(exec), bridge = DEFAULT_BRIDGE, osascript = "/usr/bin/osascript", pmset = "/usr/bin/pmset" } = {}) {
  const tried = [];
  const steps = [
    ["bridge", () => exec(bridge, [], { input: `${JSON.stringify({ id: "lock", action: "lock_screen", payload: {} })}\n` }), (r) => !/"ok"\s*:\s*false/.test(r.stdout ?? "")],
    ["keystroke", () => exec(osascript, ["-e", KEYSTROKE]), () => true],
    ["display-sleep", () => exec(pmset, ["displaysleepnow"]), () => true],
  ];
  for (const [method, run, valid] of steps) {
    const r = await run().catch(() => ({ status: 1, stdout: "" }));
    const sent = r.status === 0 && valid(r);
    // The first two must actually lock the screen; a keystroke can exit 0 and do nothing (no Accessibility), so it is checked.
    if (sent && method !== "display-sleep" && await verify()) return { ok: true, method, locked: true, displayOnly: false, tried: [...tried, method] };
    if (sent && method === "display-sleep") { const locked = await verify(); return { ok: true, method, locked, displayOnly: !locked, tried: [...tried, method] }; }
    tried.push(method);
  }
  return { ok: false, method: null, locked: false, displayOnly: false, tried };
}
