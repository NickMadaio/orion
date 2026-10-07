// 2026-10-07: orion-tasks was committed 644, so ORION's exec got "permission
// denied" every time he asked for a new to-do. Every script with a shebang must
// be executable in git, not just on whichever disk happened to chmod it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("every scripts/ program with a shebang is committed executable", () => {
  const rows = execFileSync("git", ["ls-files", "-s", "scripts"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  const notExecutable = rows.map((row) => row.split(/\s+/)).filter(([mode, , , path]) => {
    if (!/^scripts\/[^/.]+$/.test(path) || mode === "100755") return false;
    try { return readFileSync(`${ROOT}/${path}`, "utf8").startsWith("#!"); } catch { return false; }
  }).map(([, , , path]) => path);
  assert.deepEqual(notExecutable, [], `chmod +x and git update-index --chmod=+x: ${notExecutable.join(", ")}`);
});
