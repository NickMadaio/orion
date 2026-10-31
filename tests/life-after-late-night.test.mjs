import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustForShortSleep } from "../scripts/lib/life/after-late-night.mjs";

const b = (id, kind, start, end, fixed = false) => ({ id, title: id, kind, date: "2026-09-30", start, end, fixed, source: "calendar" });
const day = [b("seminar", "class", 540, 630, true), b("study", "study", 480, 540), b("lab", "class", 660, 750, true), b("sp", "side_project", 1200, 1260)];
const opts = (slept) => ({ sleptMinutes: slept, wake: 450, window: { start: 450, end: 1380 } });

test("a full night changes nothing", () => assert.deepEqual(adjustForShortSleep(day, opts(480)).changes, []));
test("classes stay where they are", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.equal(r.blocks.find((x) => x.id === "seminar").start, 540);
  assert.equal(r.blocks.find((x) => x.id === "lab").start, 660);
});
test("a nap follows the first class after noon", () => {
  const r = adjustForShortSleep(day, opts(330));
  const nap = r.blocks.find((x) => x.title === "Nap");
  assert.equal(nap.start, 750); assert.equal(nap.end - nap.start, 30);
});
test("very short nights get a longer nap", () => {
  const nap = adjustForShortSleep(day, opts(250)).blocks.find((x) => x.title === "Nap");
  assert.equal(nap.end - nap.start, 45);
});
test("early heavy work moves later", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.ok(r.blocks.find((x) => x.id === "study").start >= 570);
});
test("every change is reported", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.ok(r.changes.some((c) => c.startsWith("Added a 45 min nap at 12:30")));
  assert.ok(r.changes.some((c) => c.startsWith("Moved study to ")));
});

import { tomorrowProposal, awakeLateFlag, goToBedMessage } from "../scripts/lib/life/after-late-night.mjs";
const night = [b("cs2100", "class", 540, 630, true), b("study", "study", 600, 720), b("gym", "gym", 1260, 1350), b("sp", "side_project", 1200, 1260)];
const popts = { sleptMinutes: 270, wake: 465, window: { start: 465, end: 1380 }, recovery: { level: "low" } };

test("proposal: the class stays, a nap follows it, heavy study moves later, gym keeps its 90 (2026-10-31 policy)", () => {
  const r = tomorrowProposal(night, popts);
  assert.equal(r.blocks.find((x) => x.id === "cs2100").start, 540);
  assert.equal(r.blocks.find((x) => x.title === "Nap").start, 630);
  assert.ok(r.blocks.find((x) => x.id === "study").start >= 900);
  const gym = r.blocks.find((x) => x.id === "gym"); assert.equal(gym.end - gym.start, 90);
  assert.deepEqual(r.protect, [{ title: "cs2100", start: 540 }]);
  assert.match(r.text, /cs2100 at 9:00 AM stays, alarm and leave time too/);
  assert.match(r.text, /keep it/);
});
test("proposal leaves the gym alone when recovery is fine and the night was long enough", () => {
  const r = tomorrowProposal(night, { ...popts, sleptMinutes: 400, recovery: { level: "normal" } });
  const gym = r.blocks.find((x) => x.id === "gym"); assert.equal(gym.end - gym.start, 90);
});
test("awake-late needs bedtime passed and the Mac or phone in use", () => {
  assert.equal(awakeLateFlag({ minute: 190, bedMinute: 0, macActive: true }).awake, true);
  assert.equal(awakeLateFlag({ minute: 190, bedMinute: 0 }).awake, false);
  assert.equal(awakeLateFlag({ minute: 10, bedMinute: 0, macActive: true }).awake, false);
  assert.equal(awakeLateFlag({ minute: 14 * 60, bedMinute: 0, macActive: true }).awake, false);
  assert.deepEqual(awakeLateFlag({ minute: 1400, bedMinute: 1380, phoneInUse: true }).evidence, ["phone unlocked"]);
});
test("go-to-bed words name the class and the hours left", () => {
  const m = goToBedMessage({ minute: 190, firstClass: { title: "CS2100", start: 540 }, wake: 465 });
  assert.match(m, /3:10 AM and CS2100 is at 9:00 AM/); assert.match(m, /about 4\.6h/); assert.match(m, /Go to bed\./);
});
