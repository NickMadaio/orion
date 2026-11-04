// Reminder scheduling maths: recurring next-occurrence, wall-clock and DST-safe (w19-reminders).
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, daysOf, describeRepeat } from "../scripts/lib/reminders/schedule.mjs";

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

test("daily at 9 is the next 9 AM, today if it has not passed", () => {
  const r = { days: daysOf("daily"), time: "09:00" };
  assert.deepEqual(new Date(nextOccurrence(r, at(2026, 11, 4, 8, 0))), at(2026, 11, 4, 9, 0));
  assert.deepEqual(new Date(nextOccurrence(r, at(2026, 11, 4, 9, 0))), at(2026, 11, 5, 9, 0));
});

test("weekdays skips the weekend, every monday lands on monday", () => {
  const wk = { days: daysOf("weekdays"), time: "08:30" };
  // 2026-11-06 is a Friday
  assert.deepEqual(new Date(nextOccurrence(wk, at(2026, 11, 6, 9, 0))), at(2026, 11, 9, 8, 30));
  const mon = { days: [1], time: "17:00" };
  assert.deepEqual(new Date(nextOccurrence(mon, at(2026, 11, 4, 12, 0))), at(2026, 11, 9, 17, 0));
  assert.deepEqual(new Date(nextOccurrence(mon, at(2026, 11, 9, 17, 0))), at(2026, 11, 16, 17, 0));
});

test("two days a week: monday and wednesday", () => {
  const r = { days: [1, 3], time: "07:15" };
  assert.deepEqual(new Date(nextOccurrence(r, at(2026, 11, 4, 8, 0))), at(2026, 11, 9, 7, 15));
  assert.deepEqual(new Date(nextOccurrence(r, at(2026, 11, 9, 8, 0))), at(2026, 11, 11, 7, 15));
});

test("DST: the day after the clocks go forward is still 9 AM on the wall, 23 hours later", () => {
  const r = { days: daysOf("daily"), time: "09:00" };
  const next = nextOccurrence(r, at(2026, 3, 28, 9, 0));   // UK clocks go forward on 2026-03-29
  assert.deepEqual(new Date(next), at(2026, 3, 29, 9, 0));
  assert.equal((next - at(2026, 3, 28, 9, 0).getTime()) / 3600000, 23);
});

test("DST: the day after the clocks go back is still 9 AM on the wall, 25 hours later", () => {
  const r = { days: daysOf("daily"), time: "09:00" };
  const next = nextOccurrence(r, at(2026, 10, 24, 9, 0));   // UK clocks go back on 2026-10-25
  assert.deepEqual(new Date(next), at(2026, 10, 25, 9, 0));
  assert.equal((next - at(2026, 10, 24, 9, 0).getTime()) / 3600000, 25);
});

test("DST: a 01:30 reminder never fires twice on the day the clocks go back", () => {
  const r = { days: daysOf("daily"), time: "01:30" };
  const first = nextOccurrence(r, at(2026, 10, 24, 12, 0));
  const second = nextOccurrence(r, first);
  assert.ok(second - first >= 23 * 3600000, "the second 01:30 is a day later, not an hour later");
});

test("a time that does not exist on the spring-forward day still fires that day", () => {
  const r = { days: daysOf("daily"), time: "01:30" };
  const next = new Date(nextOccurrence(r, at(2026, 3, 28, 12, 0)));
  assert.equal(next.getDate(), 29);
});

test("describeRepeat says it the way he would", () => {
  assert.equal(describeRepeat({ days: [1], time: "09:00" }), "every Monday at 9:00 AM");
  assert.equal(describeRepeat({ days: daysOf("daily"), time: "21:30" }), "every day at 9:30 PM");
  assert.equal(describeRepeat({ days: daysOf("weekdays"), time: "08:00" }), "every weekday at 8:00 AM");
  assert.equal(describeRepeat({ days: [1, 3], time: "07:15" }), "every Monday and Wednesday at 7:15 AM");
  assert.equal(describeRepeat({ days: daysOf("weekends"), time: "10:00" }), "every weekend at 10:00 AM");
});

test("bad input is refused, not guessed", () => {
  assert.equal(nextOccurrence({ days: [], time: "09:00" }, new Date()), null);
  assert.equal(nextOccurrence({ days: [1], time: "25:00" }, new Date()), null);
});
