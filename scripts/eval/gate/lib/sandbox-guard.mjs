// Keeps the evaluation sandbox from leaking into Nick's real use (REV4 items 5 and 6).
//   leftoverSandboxFiles / cleanSandbox: a run never starts beside sandbox files, whatever their age, and one flag removes them.
//   recentInbound: while an item runs, Nick's own turns see the sandbox clock and calendar; warn when he was just active.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SANDBOX_FILES } from "./setup.mjs";

export const INBOUND_WARN_MS = 10 * 60_000;

/** Sandbox files that exist right now, whatever their age. */
export const leftoverSandboxFiles = (p) => SANDBOX_FILES.map((f) => join(p.ctrl, f)).filter((f) => existsSync(f));

/** The refusal text: what is there, and the ways to clear it. */
export const leftoverMessage = (files) => `sandbox files already exist (${files.map((f) => f.split("/").pop()).join(", ")}): another evaluation, or an unrecovered crash. `
  + "Recovery: run `launch.sh --clean-sandbox` (or `run.mjs --clean-sandbox`) once no run is active, or `run.mjs --recover <out dir>` to undo an interrupted item.";

/** Remove every sandbox file (and only those). Returns the paths removed. */
export function cleanSandbox(p) {
  const files = leftoverSandboxFiles(p);
  for (const f of files) rmSync(f, { force: true });
  return files;
}

/** The newest inbound turn within the window, as { minutesAgo }, else null. Rows are {"at": ISO}; bad lines are skipped. */
export function recentInbound(p, { now = Date.now(), windowMs = INBOUND_WARN_MS } = {}) {
  let raw;
  try { raw = readFileSync(join(p.ctrl, "inbound-turns.jsonl"), "utf8"); } catch { return null; }
  let newest = null;
  for (const line of raw.split("\n")) {
    try {
      const t = Date.parse(JSON.parse(line).at);
      if (Number.isFinite(t) && t <= now + 60_000 && now - t <= windowMs && (newest === null || t > newest)) newest = t;
    } catch { /* not a row */ }
  }
  return newest === null ? null : { minutesAgo: Math.max(0, Math.round((now - newest) / 60_000)) };
}
