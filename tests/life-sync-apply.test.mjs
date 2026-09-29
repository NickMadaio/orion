import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEvent } from "../scripts/lib/life/sync-event.mjs";
import { applyEvents } from "../scripts/lib/life/sync-apply.mjs";

const empty = { captures: [], reminders: {}, tracking: [], notes: {}, applied: [] };
let clock = 0;
const ev = (kind, payload) => makeEvent({ device: "iphone", clock: ++clock, kind, payload, at: 1000 + clock });
const add = ev("reminder.add", { id: "r1", title: "email Hale", due: null });
test("captures and reminders apply", () => {
  const s = applyEvents(empty, [ev("capture.add", { text: "video idea" }), add]);
  assert.deepEqual(s.captures, ["video idea"]); assert.equal(s.reminders.r1.title, "email Hale");
});
test("applying twice changes nothing", () => {
  const events = [ev("capture.add", { text: "x" }), add];
  const once = applyEvents(empty, events);
  assert.deepEqual(applyEvents(once, events), once);
});
test("completion after add", () => assert.equal(applyEvents(empty, [add, ev("reminder.complete", { id: "r1" })]).reminders.r1.done, true));
test("update only changes title and due", () => {
  const s = applyEvents(empty, [add, ev("reminder.update", { id: "r1", title: "email Prof Hale", done: true })]);
  assert.deepEqual(s.reminders.r1, { id: "r1", title: "email Prof Hale", due: null, done: false });
});
test("unsafe note paths are skipped", () => {
  const s = applyEvents(empty, [ev("note.append", { file: "../../etc/passwd", line: "x" }), ev("note.append", { file: "journal.md", line: "ok" })]);
  assert.deepEqual(s.notes, { "journal.md": ["ok"] });
});
test("input state is not mutated", () => {
  const copy = JSON.parse(JSON.stringify(empty)); applyEvents(empty, [add]); assert.deepEqual(empty, copy);
});
