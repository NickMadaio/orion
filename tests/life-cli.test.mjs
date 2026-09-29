import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = join(root, "scripts/orion-next");
const STUDY = join(root, "scripts/orion-study");
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
function dayFile(t) {
  const dir = mkdtempSync(join(tmpdir(), "orion-life-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "day.json");
  writeFileSync(file, JSON.stringify({ date: "2026-09-29", done: [], blocks: [
    { id: "macro", title: "Macro", kind: "class", date: "2026-09-29", start: 810, end: 900, fixed: true, source: "calendar" }] }));
  return file;
}
test("orion-next prints the current block", (t) => {
  const r = run(NEXT, ["--day", dayFile(t), "--now", "13:40"]);
  assert.equal(r.status, 0); assert.match(r.stdout, /^do: Macro is on now/);
});
test("orion-next json output parses", (t) => {
  const r = run(NEXT, ["--day", dayFile(t), "--now", "13:40", "--json"]);
  assert.equal(JSON.parse(r.stdout).blockId, "macro");
});
test("orion-study places a session", (t) => {
  const r = run(STUDY, ["--day", dayFile(t), "--now", "09:00", "--window", "08:00-23:00", "--json", "--", "90 min on macro"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.placed.length, 1); assert.equal(out.placed[0].end - out.placed[0].start, 90); assert.equal(out.request.subject, "ECON1115");
});
test("bad arguments print usage and exit 2", () => {
  const r = run(NEXT, ["--now", "25:00"]); assert.equal(r.status, 2); assert.match(r.stderr, /usage/);
});
test("a missing file exits 1", () => assert.equal(run(NEXT, ["--day", "/nonexistent/day.json", "--now", "10:00"]).status, 1));
