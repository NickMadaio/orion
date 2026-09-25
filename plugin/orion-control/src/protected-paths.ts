import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 Paths no file action may write, move, rename or delete, whatever its root.

 Independent review, 2026-09-26: the Desktop root contains the ORION repo, and
 desktop_file_write_explicit needs no approval, so ORION could rewrite
 scripts/orion-remote (on his exec allowlist) or scripts/orion-approve (what
 the app runs for Allow) and then run his own code as Nick. ~/.openclaw holds
 the gate, the plugin and the bridge. Reading stays allowed; changing does not.

 ORION_PROTECTED_PATHS (colon-separated) can ADD paths, for tests; it cannot
 remove the defaults.
*/
export function protectedPaths(home: string = os.homedir()): string[] {
  const extra = (process.env.ORION_PROTECTED_PATHS ?? "").split(":").filter(Boolean);
  const defaults = [path.join(home, "Desktop/ORION"), path.join(home, ".openclaw"), path.join(home, "Library/LaunchAgents")];
  return [...defaults, ...extra].flatMap((candidate) => {
    const resolved = path.resolve(candidate);
    try { return [resolved, realpathSync(resolved)]; } catch { return [resolved]; }
  });
}

const inside = (outer: string, inner: string): boolean => {
  const relative = path.relative(outer, inner);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/** The protected path `target` is inside, or would carry away if moved; else null. */
export function protectedConflict(target: string, paths: string[] = protectedPaths()): string | null {
  const resolved = path.resolve(target);
  return paths.find((guarded) => inside(guarded, resolved) || inside(resolved, guarded)) ?? null;
}
