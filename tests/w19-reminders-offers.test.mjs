// ORION offers a reminder the day before a deadline: few, once each, never twice (w19-reminders).
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deadlineOffers, readOffers, recordOffer, takePending, MAX_PER_DAY } from "../scripts/lib/reminders/offers.mjs";

const now = new Date(2026, 10, 4, 18, 0);
const input = (over = {}) => ({ now, minute: 18 * 60, today: "2026-11-04", tomorrow: "2026-11-05", todos: [], tomorrowDay: [], reminders: [], state: { pending: [], offered: {}, perDay: {} }, ...over });

test("a booked to-do due tomorrow gets a reminder offer at 9 AM tomorrow", () => {
  const [o] = deadlineOffers(input({ todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: true }] }));
  assert.equal(o.text, "Finish resume is due tomorrow. Want a reminder tomorrow at 9 AM?");
  assert.equal(o.offer.at, "2026-11-05T09:00");
  assert.equal(o.offer.label, "Finish resume");
});

test("an unbooked to-do is left to the 'find an hour tonight' question, not offered twice", () => {
  assert.deepEqual(deadlineOffers(input({ todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: false }] })), []);
});

test("a deadline-ish calendar event tomorrow is offered an hour before it", () => {
  const [o] = deadlineOffers(input({ tomorrowDay: [{ title: "CS1802 midterm", start: 14 * 60, end: 15 * 60, kind: "other", fixed: true }] }));
  assert.equal(o.text, "CS1802 midterm is tomorrow at 2:00 PM. Want a reminder an hour before, at 1:00 PM?");
  assert.equal(o.offer.at, "2026-11-05T13:00");
});

test("classes are never offered (the class ladder has them), nor ordinary events", () => {
  assert.deepEqual(deadlineOffers(input({ tomorrowDay: [{ title: "CS1802 exam review", start: 600, end: 660, kind: "class", fixed: true }, { title: "Lunch", start: 720, end: 780, kind: "other", fixed: true }] })), []);
});

test("only in the evening before, not at noon", () => {
  assert.deepEqual(deadlineOffers(input({ minute: 12 * 60, todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: true }] })), []);
});

test("not when a reminder for it already exists", () => {
  assert.deepEqual(deadlineOffers(input({ reminders: [{ label: "finish resume", dueAt: 1 }], todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: true }] })), []);
});

test("at most a few a day, counting the ones already made", () => {
  const todos = ["a", "b", "c", "d", "e"].map((x) => ({ title: `Task ${x}`, dueDate: "2026-11-05", booked: true }));
  assert.equal(deadlineOffers(input({ todos })).length, MAX_PER_DAY);
  assert.equal(deadlineOffers(input({ todos, state: { pending: [], offered: {}, perDay: { "2026-11-04": MAX_PER_DAY - 1 } } })).length, 1);
  assert.equal(deadlineOffers(input({ todos, state: { pending: [], offered: {}, perDay: { "2026-11-04": MAX_PER_DAY } } })).length, 0);
});

test("never the same one twice, across days", () => {
  const dir = mkdtempSync(join(tmpdir(), "offers-"));
  const [o] = deadlineOffers(input({ todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: true }] }));
  recordOffer(dir, o.offer, now);
  const again = deadlineOffers(input({ state: readOffers(dir), todos: [{ title: "Finish resume", dueDate: "2026-11-05", booked: true }] }));
  assert.deepEqual(again, []);
  const nextDay = deadlineOffers(input({ now: new Date(2026, 10, 5, 18, 0), today: "2026-11-05", tomorrow: "2026-11-06", state: readOffers(dir), todos: [{ title: "Finish resume", dueDate: "2026-11-06", booked: true }] }));
  assert.deepEqual(nextDay, []);
});

test("a recorded offer waits as pending for his yes, newest first, and expires after three hours", () => {
  const dir = mkdtempSync(join(tmpdir(), "offers-"));
  recordOffer(dir, { key: "k1", label: "Finish resume", at: "2026-11-05T09:00", source: "deadline" }, now);
  recordOffer(dir, { key: "k2", label: "Email prof hale", at: "2026-11-05T10:00", source: "chat" }, new Date(now.getTime() + 60000));
  assert.equal(readOffers(dir).perDay["2026-11-04"], 2);
  assert.equal(takePending(dir, new Date(now.getTime() + 120000)).label, "Email prof hale");
  assert.equal(takePending(dir, new Date(now.getTime() + 4 * 3600000)), null);
});
