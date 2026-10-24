// Review 2026-10-23 (HIGH 3, MEDIUM 9): a reply to "Time to start: Gym" acts on THAT plan loop by id, never "the newest check-in".
// orion-checkin find returns the one open plan loop for a title (or block), and refuses when there is none or more than one.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = join(import.meta.dirname, "../scripts/orion-checkin");
const loop = (id, what, block, phase = "active") => ({ id, what, block, createdAt: 0, dueAt: 0, loop: { phase } });
function run(checkins, args) {
  const home = mkdtempSync(join(tmpdir(), "orion-find-"));
  const file = join(home, "checkins.json");
  writeFileSync(file, JSON.stringify({ checkins }));
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, ORION_CHECKIN_FILE: file, ORION_CONTROLLED_DIR: home } });
  return { r, out: (() => { try { return JSON.parse(r.stdout.trim()); } catch { return null; } })(), state: JSON.parse(readFileSync(file, "utf8")) };
}

test("the Gym plan loop is found by its title, though a newer unrelated check-in exists", () => {
  const { r, out } = run([loop("ci-gym", "Gym", "cal-4-897c"), loop("ci-food", "dinner", undefined)], ["find", "--what", "Gym"]);
  assert.equal(r.status, 0);
  assert.equal(out.id, "ci-gym");
});

test("none, a closed one, or two open loops with the same title: { open: false }, exit 1, nothing changed", () => {
  assert.equal(run([loop("ci-food", "dinner", undefined)], ["find", "--what", "Gym"]).r.status, 1);
  assert.equal(run([loop("ci-gym", "Gym", "cal-1", "done")], ["find", "--what", "Gym"]).r.status, 1);
  const two = run([loop("a", "Gym", "cal-1"), loop("b", "Gym", "cal-2")], ["find", "--what", "Gym"]);
  assert.equal(two.r.status, 1);
  assert.equal(two.out.matches, 2);
});

test("by block id when it is known", () => {
  const { out } = run([loop("a", "Gym", "cal-1"), loop("b", "Gym", "cal-2")], ["find", "--block", "cal-2"]);
  assert.equal(out.id, "b");
});
