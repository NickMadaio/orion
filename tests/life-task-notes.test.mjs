// Same format as MobileCore/TaskNotes.swift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskNotes, formatTaskNotes, progressOf } from "../scripts/lib/life/task-notes.mjs";

const sample = "2.5 hours a day until it's due\n- [ ] Google Data Analytics · 40%\n- [ ] AWS Cloud Practitioner · 10%\n- [x] CompTIA ITF+ · 100%\nask Sam about vouchers";

test("spread, subtasks with percent, and other lines", () => {
  const n = parseTaskNotes(sample);
  assert.equal(n.spread, "2.5 hours a day until it's due");
  assert.deepEqual(n.subtasks.map((s) => [s.title, s.percent]), [["Google Data Analytics", 40], ["AWS Cloud Practitioner", 10], ["CompTIA ITF+", 100]]);
  assert.deepEqual(n.other, ["ask Sam about vouchers"]);
  assert.equal(progressOf(n.subtasks), 50);
});

test("formatting round-trips", () => assert.equal(formatTaskNotes(parseTaskNotes(sample)), sample));
test("a checked subtask is 100%", () => assert.equal(parseTaskNotes("- [x] Done thing").subtasks[0].percent, 100));

// 2026-10-13: details typed in the app with no spread came back as the spread; "Tags:" lines too.
test("details and tags are never read as the spread", () => {
  const n = parseTaskNotes("Tags: school\nNotes: bring calculator");
  assert.equal(n.spread, "");
  assert.deepEqual(n.other, ["Tags: school", "bring calculator"]);
  assert.equal(formatTaskNotes(n), "Tags: school\nNotes: bring calculator");
  assert.equal(parseTaskNotes("2 hours a day\nTags: gym").spread, "2 hours a day");
});
