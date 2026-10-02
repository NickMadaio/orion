// One change, one undo step (2026-09-29): "two study sessions" was two journal
// entries, so undo removed one and ORION said both were gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "undo-"));
const calls = join(dir, "calls.log");
const fake = join(dir, "bridge.sh");
writeFileSync(fake, `#!/bin/sh\nread line\necho "$line" >> "${calls}"\nid=$(date +%s%N)\necho '{"ok":true,"id":"x","result":{"identifier":"EV-'$id'"}}'\n`);
chmodSync(fake, 0o755);
process.env.ORION_BRIDGE_BIN = fake;
process.env.ORION_RESCHEDULE_UNDO = join(dir, "undo.json");
process.env.ORION_RESCHEDULE_PINS = join(dir, "pins.json");
const { applyPlan, undoLast } = await import("../scripts/lib/life/calendar-write.mjs");
const journal = () => JSON.parse(readFileSync(process.env.ORION_RESCHEDULE_UNDO, "utf8"));

test("sessions booked by one command are one undo step, and undo removes them all", async () => {
  const session = (date, start) => ({ date, moves: [], blocksById: new Map(), group: "study-1",
    created: [{ title: "Study macro", kind: "study", start, end: start + 60, fixed: false }] });
  await applyPlan(session("2026-09-30", 880));
  await applyPlan(session("2026-10-01", 640));
  assert.equal(journal().length, 1);
  assert.equal(journal()[0].steps.length, 2);
  const done = await undoLast();
  assert.deepEqual(done, ["removed Study macro", "removed Study macro"]);
  assert.equal(journal().length, 0);
});

test("a change that did nothing leaves no step, and undo skips old empty ones", async () => {
  await applyPlan({ date: "2026-09-30", moves: [], created: [{ title: "Gym", kind: "gym", start: 600, end: 660, fixed: false }], blocksById: new Map() });
  await applyPlan({ date: "2026-09-30", moves: [], created: [], blocksById: new Map() });
  assert.equal(journal().length, 1, "the empty change was not recorded");
  writeFileSync(process.env.ORION_RESCHEDULE_UNDO, JSON.stringify([...journal(), { at: "old", steps: [] }]));
  assert.deepEqual(await undoLast(), ["removed Gym"], "undo reaches past the old empty entry");
  assert.ok(existsSync(calls));
});
