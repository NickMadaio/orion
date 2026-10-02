import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("a replacement transaction can restore removed calendar blocks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-calendar-write-"));
  const log = join(dir, "calls.jsonl");
  const undo = join(dir, "undo.json");
  const bridge = join(dir, "bridge.mjs");
  writeFileSync(bridge, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
appendFileSync(process.env.ORION_TEST_CALL_LOG, JSON.stringify(request) + "\\n");
console.log(JSON.stringify({ ok: true, result: { identifier: "created-" + request.payload.title } }));
`);
  chmodSync(bridge, 0o755);
  process.env.ORION_BRIDGE_BIN = bridge;
  process.env.ORION_RESCHEDULE_UNDO = undo;
  process.env.ORION_RESCHEDULE_PINS = join(dir, "pins.json");
  process.env.ORION_TEST_CALL_LOG = log;
  const { applyPlan, undoLast } = await import(`../scripts/lib/life/calendar-write.mjs?replacement=${Date.now()}`);

  const removed = [
    { title: "Study", kind: "study", source: "orion", start: 840, end: 900, calendarId: "old-study" },
    { title: "Gym", kind: "gym", source: "calendar", start: 900, end: 960, calendarId: "old-gym" },
  ];
  writeFileSync(process.env.ORION_RESCHEDULE_PINS, JSON.stringify({ "2026-09-30": ["old-study"] }));
  await applyPlan({ date: "2026-09-30", moves: [], created: [], removed, blocksById: new Map() });
  assert.deepEqual(readFileSync(undo, "utf8").includes('"op": "delete"'), true);

  assert.deepEqual(JSON.parse(readFileSync(process.env.ORION_RESCHEDULE_PINS, "utf8"))["2026-09-30"], []);
  const undone = await undoLast();
  assert.deepEqual(undone, ["restored Gym", "restored Study"]);
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map((call) => call.action), [
    "delete_calendar_event", "delete_calendar_event", "create_calendar_event", "create_calendar_event",
  ]);
  assert.equal(calls[2].payload.orionKind, undefined, "manual movable events stay manual when restored");
  assert.equal(calls[3].payload.orionKind, "study", "ORION planning metadata survives undo");
  assert.deepEqual(JSON.parse(readFileSync(process.env.ORION_RESCHEDULE_PINS, "utf8"))["2026-09-30"], ["created-Study"]);
});
