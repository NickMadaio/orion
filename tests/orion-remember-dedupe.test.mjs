// REV5 SHOULD 8 (2026-10-31): orion-remember --user wrote a new USER.md line every time the same preference was said again.
// A fact already in USER.md (same words, ignoring case, punctuation and the date) is reported as remembered and not appended.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-remember");

function home(userMd) {
  const dir = mkdtempSync(join(tmpdir(), "remember-"));
  mkdirSync(join(dir, ".openclaw/workspace"), { recursive: true });
  writeFileSync(join(dir, ".openclaw/workspace/USER.md"), userMd);
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, HOME: dir }, encoding: "utf8" });
const userMd = (dir) => readFileSync(join(dir, ".openclaw/workspace/USER.md"), "utf8");

test("the same preference twice is one line", () => {
  const dir = home("# USER\n\n## Learned\n\n");
  try {
    assert.equal(run(dir, "--user", "Preference: Nick likes gym in the evening.").status, 0);
    const again = run(dir, "--user", "preference: nick likes gym in the evening");
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already remembered/);
    assert.equal(userMd(dir).split("\n").filter((l) => /gym in the evening/i.test(l)).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a line written on an earlier day still counts", () => {
  const dir = home("# USER\n\n## Learned\n\n- 2026-09-01 — Preference: Nick doesn't like early mornings.\n");
  try {
    const out = run(dir, "--user", "Preference: Nick doesn't like early mornings.");
    assert.equal(out.status, 0);
    assert.match(out.stdout, /already remembered/);
    assert.equal(userMd(dir).split("\n").filter((l) => /early mornings/.test(l)).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a different preference is still appended", () => {
  const dir = home("# USER\n\n## Learned\n\n- 2026-09-01 — Preference: Nick doesn't like early mornings.\n");
  try {
    const out = run(dir, "--user", "Preference: Nick likes late nights.");
    assert.equal(out.status, 0);
    assert.doesNotMatch(out.stdout, /already/);
    assert.match(userMd(dir), /Nick likes late nights\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
