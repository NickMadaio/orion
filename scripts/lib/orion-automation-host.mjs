// Read-only host checks for the candidate dispatcher. This module grants no
// installation authority and provides neither execution nor delivery. A future
// executor must recheck authority at its own effect boundary.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const executeFile = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modes = ["contained", "guarded", "open", "sovereign"];

function nativeFocus(reply) {
  if (reply?.ok !== true || reply.unreadable) return null;
  if (["none", "not-started", "finished"].includes(reply.status)) return false;
  // Keep breaks and pauses protected too: the focus session is still in use.
  if (["running", "paused", "waiting-for-return", "finishing"].includes(reply.status)) return true;
  return null;
}

export function createAutomationHostChecks({ repoRoot = repo, homeRoot = homedir(),
  run = executeFile, read = readFile, now = Date.now } = {}) {
  const scripts = join(repoRoot, "scripts");
  const installedDist = join(homeRoot, ".openclaw/extensions/orion-control/dist");
  async function json(command, args) {
    const { stdout } = await run(join(scripts, command), args, {
      timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
      // The session probe must use this host's socket, not an inherited override.
      env: { ...process.env, ORION_SESSION_SOCKET: join(homeRoot, ".openclaw/orion-session.sock") },
    });
    return JSON.parse(stdout);
  }
  async function authority() {
    const map = await json("orion-authority", ["show", "--json"]);
    if (map?.dist !== installedDist || !modes.includes(map.mode) ||
        map.profileSource !== "permission-state.json" ||
        typeof map.modeSource !== "string" || map.modeSource.includes("override") ||
        !Array.isArray(map.capabilities) || !Array.isArray(map.availability) ||
        map.exec?.security !== "allowlist" || map.exec.ask !== "off" || map.exec.askFallback !== "deny") {
      throw new Error("Automation host authority is unavailable or unsupported");
    }
    return map;
  }
  async function legacyFocus(at) {
    try {
      const state = JSON.parse(await read(join(homeRoot, ".openclaw/orion-controlled/focus.json"), "utf8"));
      if (state?.session === null) return false;
      const until = state?.session?.until;
      return Number.isSafeInteger(until) && until > 0 ? at <= until : null;
    } catch (error) { return error.code === "ENOENT" ? false : null; }
  }
  return Object.freeze({
    async readContext() {
      const [map, session] = await Promise.all([
        authority(), json("orion-session", ["status", "--json"]).catch(() => null),
      ]);
      const at = now();
      const native = nativeFocus(session), legacy = await legacyFocus(at);
      return { now: at, effectiveMode: map.mode,
        focusActive: native === true || legacy === true ? true
          : native === false && legacy === false ? false : null };
    },
    async authorize(action) {
      // Start with the one reviewed read-only action. An AUTO source diagnostic
      // must never silently expand this supported set to routines that mutate.
      if (action?.name !== "agenda_today" || !Array.isArray(action.argv) ||
          action.argv.length !== 2 || action.argv[0] !== "orion-agenda" || action.argv[1] !== "today" ||
          typeof action.installationId !== "string" || !action.installationId.trim()) return false;
      try {
        const map = await authority();
        const tiers = map.availability.filter(row => row?.tier === "automation");
        if (tiers.length !== 1 || tiers[0].available !== true || tiers[0].unresolved !== false ||
            tiers[0].configOn !== true || tiers[0].profileOn !== true) return false;
        const rows = map.capabilities.filter(row => row?.kind === "command" && row.name === "orion-agenda");
        if (rows.length !== 1) return false;
        const row = rows[0];
        return row.pattern === join(scripts, "orion-agenda") && row.level === "AUTO" &&
          !row.escapeHatch && Array.isArray(row.subs) && row.subs.length === 0;
      } catch { return false; }
    },
  });
}
