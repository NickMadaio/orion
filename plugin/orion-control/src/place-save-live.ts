// The real orion-awareness behind place-save-run.ts (index.ts wires it; tests use a stub). Writes known-places.json through the one script that owns it.
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
import type { PlaceRun } from "./place-save-run.js";

export const livePlaceRun = (stateDir?: string): PlaceRun => (args) => new Promise((resolve) =>
  execFile(scriptPath("orion-awareness"), args, { timeout: 20_000, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } },
    (e, stdout, stderr) => resolve({ stdout: String(e ? (stderr || stdout || e.message) : stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
