/*
 Owner re-authentication for sensitive operations (Phase 43).

 Releasing the lock, or relaxing ORION's mode, lowers the guard. Before either,
 the Mac's owner confirms in person: Touch ID or the account password, in a
 prompt macOS draws itself (orion-mac-bridge authenticate). Nothing ORION can
 type is an answer to it, and a remote caller -- Discord, the phone -- cannot
 see it, so these stay things done at the Mac.

 THE TEST SEAM, AND WHY IT IS NOT A BYPASS. Checks run the real scripts in a
 scratch HOME and must not raise a real prompt, so ORION_REAUTH_BIN may name a
 stand-in -- but only when HOME is not the account's real home, read from the
 system account record rather than from HOME. A HOME that points elsewhere also
 moves every state file the script reads, so the stand-in can only ever approve
 an operation on a sandbox, never on the live lock or mode.
*/
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "../../native/OrionMacBridge/.build/release/orion-mac-bridge");

export function authenticator() {
  const sandboxed = homedir() !== userInfo().homedir;
  return sandboxed && process.env.ORION_REAUTH_BIN ? process.env.ORION_REAUTH_BIN : BRIDGE;
}

/** Resolves { confirmed, reason }. Never throws: a failure to ask is a refusal. */
export function reauthenticate(reason, { timeoutMs = 120_000 } = {}) {
  return new Promise(resolve => {
    execFile(authenticator(), ["authenticate", "--reason", reason], { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (!error) return resolve({ confirmed: true, reason: null });
      const why = error.code === 2 ? "owner authentication is not available here"
        : error.code === "ENOENT" ? "the authenticator is not built (swift build -c release in native/OrionMacBridge)"
          : error.killed ? "no answer before the prompt timed out"
            : String(stderr || "not confirmed").trim().slice(0, 200);
      resolve({ confirmed: false, reason: why });
    });
  });
}
