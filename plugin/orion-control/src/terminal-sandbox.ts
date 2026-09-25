import { realpathSync } from "node:fs";
import os from "node:os";
import { protectedPaths } from "./protected-paths.js";

/*
 What a raw terminal command runs inside (Phase 52; independent review
 2026-09-26, C3 and M5).

 A command Nick allowed runs as Nick, so without a fence one approved command
 could write ORION a chat grant, relax his strictness, re-record the integrity
 manifests or rewrite the scripts he is allowed to run -- and every later
 command would need no one. The fence is a sandbox-exec profile that denies
 writes under every protected path (protected-paths.ts); children inherit it,
 including anything sent to the background.

 The environment is a short allowlist, not the gateway's: the gateway's
 environment can hold credentials, and a command's output goes into the ledger
 and back to the model. Output is also redacted before it is recorded.
*/
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function sandboxProfile(paths: string[] = protectedPaths()): string {
  // The sandbox matches real paths only (/var is /private/var), so a symlinked
  // spelling would silently guard nothing; list both.
  const real = paths.flatMap((guarded) => {
    try { return [guarded, realpathSync(guarded)]; } catch { return [guarded]; }
  });
  const denied = [...new Set(real)].map((guarded) => `(subpath ${quote(guarded)})`).join(" ");
  return `(version 1)\n(allow default)\n(deny file-write* ${denied})\n`;
}

const PASSED = ["HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"];

export function terminalEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: os.homedir(),
    TERM: "dumb",
  };
  for (const name of PASSED) {
    const value = source[name];
    if (typeof value === "string" && !(name in environment)) environment[name] = value;
  }
  return environment;
}

const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/([\w-]*(?:api[_-]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [redacted]"],
  [/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "[redacted]"],
];

export function redactOutput(text: string): string {
  return SECRET_SHAPES.reduce((current, [shape, replacement]) => current.replace(shape, replacement), text);
}
