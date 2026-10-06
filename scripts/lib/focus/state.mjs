import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// Its OWN file. It used focus-state.json, which is the Mac app's session file,
// overwrote it, and the app could no longer start or show a focus session (2026-10-06).
const DEFAULT_FILE = join(homedir(), ".openclaw/orion-controlled/ontask-state.json");

export function stateFile(env) {
  return env?.ORION_FOCUS_STATE ?? DEFAULT_FILE;
}

const EMPTY_STATE = { ladder: {}, allow: [], log: [] };

export function readState(file) {
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ...EMPTY_STATE };
    }
    return {
      ladder: typeof parsed.ladder === "object" && parsed.ladder !== null && !Array.isArray(parsed.ladder)
        ? parsed.ladder
        : {},
      allow: Array.isArray(parsed.allow) ? parsed.allow : [],
      log: Array.isArray(parsed.log) ? parsed.log.slice(-500) : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeState(file, state) {
  const dir = dirname(file);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpFile = join(dir || tmpdir(), `.orion-state-tmp-${randomUUID()}`);
  try {
    const out = {
      ladder: state.ladder ?? {},
      allow: Array.isArray(state.allow) ? state.allow : [],
      log: Array.isArray(state.log) ? state.log.slice(-500) : [],
    };
    writeFileSync(tmpFile, JSON.stringify(out, null, 2), "utf-8");
    renameSync(tmpFile, file);
  } catch {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}
