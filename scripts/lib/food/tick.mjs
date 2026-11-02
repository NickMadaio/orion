// The food inbox's hook into orion-watch's ~5-minute tick (and the fast path the phone link can call after it writes).
// Cheap when there is nothing: one readdir. When a complete item is waiting it starts `orion-food-estimate inbox`
// DETACHED, so a photo that takes the vision model a minute never holds the tick; the inbox's own lock stops two runs.
import { readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";
import { INBOX_DIR, listNew } from "./inbox.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "orion-food-estimate");
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };

/** True when it started a run. Never throws: the tick goes on whatever happens here. */
export function kickFoodInbox({ env = process.env, spawnImpl = spawn } = {}) {
  try {
    if (evalMode()) return false;
    const dir = join(controlledDir(env), INBOX_DIR);
    try { if (!readdirSync(dir).some((n) => n.endsWith(".json") && !n.startsWith("."))) return false; } catch { return false; }
    if (!listNew(dir, readJson(join(dir, ".state.json")).done ?? {}).length) return false;
    const child = spawnImpl(process.execPath, [SCRIPT, "inbox"], { detached: true, stdio: "ignore", env });
    child.unref?.();
    return true;
  } catch { return false; }
}
