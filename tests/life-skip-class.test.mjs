// "I'm skipping Marketing" (2026-10-06): a class comes off his day only when he
// says so — no approval, just that occurrence, and undo puts it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const at = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const day = [
  { identifier: "mk", title: "MKTG2201 Introduction to Marketing — Lecture", start: at(16), end: at(17, 30) },
  { identifier: "s", title: "Study", start: at(18), end: at(19), orion: "study" },
];

function world(t, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-skip-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "cal.json"), JSON.stringify(day));
  writeFileSync(join(home, "life.json"), "{}");
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "cal.json"), ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_SKIPS_FILE: join(home, "skips.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 8, 15).toISOString(), ...extra };
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8", env }); return { code: r.status, out: r.stdout + r.stderr }; };
  const titles = () => JSON.parse(readFileSync(join(home, "cal.json"), "utf8")).map((e) => e.title);
  const skips = () => { try { return JSON.parse(readFileSync(join(home, "skips.json"), "utf8")); } catch { return []; } };
  return { run, titles, skips };
}

test("skip removes that class occurrence without asking, and undo restores it", (t) => {
  const w = world(t);
  const r = w.run("skip", "marketing");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skipped MKTG2201/);
  assert.ok(!w.titles().some((x) => /MKTG/.test(x)));
  assert.equal(w.run("undo").code, 0);
  assert.ok(w.titles().some((x) => /MKTG/.test(x)));
});

test("a read-only class calendar is skipped in ORION's planning instead, and undo brings it back", (t) => {
  const w = world(t, { FAKE_READONLY: "MKTG" });
  const r = w.run("skip", "marketing");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /read-only/);
  assert.equal(w.skips().length, 1);
  // planning no longer sees it: dropping study then re-adding at 16:00 is not blocked by the class
  const add = w.run("add", "work on orion", "60", "--at", "16:00");
  assert.equal(add.code, 0, add.out);
  assert.equal(w.run("undo").code, 0);   // undoes the add
  assert.equal(w.run("undo").code, 0);   // undoes the skip
  assert.equal(w.skips().length, 0);
});

test("drop on a class points at skip; nothing changes", (t) => {
  const w = world(t);
  const r = w.run("drop", "marketing");
  assert.equal(r.code, 1);
  assert.match(r.out, /use skip/);
  assert.ok(w.titles().some((x) => /MKTG/.test(x)));
});
