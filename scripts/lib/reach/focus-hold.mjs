// Is a focus session running right now? (2026-10-16 audit: check-ins, the morning
// brief, Discord heads-ups and watchers all ignored it.) Asks the app through
// orion-session, the one reader of the session socket. Unknown means "no".
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const isSessionActive = (s) => s?.status === "running" || s?.status === "paused";

export function activeSession(env = process.env) {
  try {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../orion-session"), "status", "--json"], { encoding: "utf8", timeout: 4000, env });
    const s = JSON.parse(r.stdout);
    return isSessionActive(s) ? s : null;
  } catch { return null; }
}
