// A bare `orion-reschedule undo` only ever reaches changes from today's session: the live tester ran undo six times and it
// reached journal entries from earlier days, removing and restoring real blocks. Entries older than 24 h, or from a previous
// day and more than 6 h old, are never undone without an explicit stamp (`undo --id <at>`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { undoExpired, pickUndoIndex } from "../scripts/lib/life/undo-expiry.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = new Date(2026, 10, 5, 10, 0);
const at = (days, hours = 0) => new Date(NOW.getTime() - days * 86400_000 - hours * 3600_000).toISOString();
const step = { op: "move", title: "X", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" };

test("what is expired", () => {
  assert.equal(undoExpired(at(0, 1), NOW), false);          // an hour ago
  assert.equal(undoExpired(at(0, 9), NOW), false);          // this morning, same day
  assert.equal(undoExpired(at(0, 25), NOW), true);          // over 24 h
  assert.equal(undoExpired(at(3), NOW), true);              // days ago
  assert.equal(undoExpired(at(0, 11), NOW), true);          // last night, previous day, 11 h old
  assert.equal(undoExpired(new Date(2026, 10, 4, 23, 50).toISOString(), new Date(2026, 10, 5, 0, 30)), false);   // 40 minutes ago, across midnight
  assert.equal(undoExpired(undefined, NOW), true);          // no stamp: unknown age is never undone blind
});

test("the newest entry is the only one a bare undo may take, and only if it has not expired", () => {
  const fresh = [{ at: at(2), steps: [step] }, { at: at(0, 1), steps: [step] }];
  assert.equal(pickUndoIndex(fresh, NOW), 1);
  const stale = [{ at: at(3), steps: [step] }, { at: at(2), steps: [step] }];
  assert.equal(pickUndoIndex(stale, NOW), -1);
  assert.equal(pickUndoIndex([{ at: at(0, 1), steps: [] }, { at: at(2), steps: [step] }], NOW), -1);   // empty newest is skipped, then the old one is expired
  assert.equal(pickUndoIndex(stale, NOW, at(3)), 0);        // an explicit stamp reaches it
});

test("the CLI says nothing is left to undo when everything is stale, and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "undo-exp-"));
  try {
    const file = join(dir, "u.json");
    mkdirSync(dir, { recursive: true });
    const entries = [{ at: at(4), steps: [step] }, { at: at(3), steps: [step] }];
    writeFileSync(file, JSON.stringify(entries));
    const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir, ORION_RESCHEDULE_UNDO: file, ORION_NOW: NOW.toISOString() };
    const run = () => spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), "undo"], { env, encoding: "utf8" });
    for (let i = 0; i < 6; i += 1) {
      const r = run();
      assert.match(r.stdout, /Nothing to undo/);
      assert.equal(r.status, 0);
    }
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), entries);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
