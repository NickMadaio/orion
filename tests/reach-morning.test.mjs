import test from "node:test";
import assert from "node:assert/strict";
import { shouldBrief, composeBriefing, weatherLine, spokenClock } from "../scripts/lib/reach/morning.mjs";

const at = (h, m = 0) => new Date(2026, 9, 8, h, m);
const m = (h, mm = 0) => h * 60 + mm;

test("unplugging or using the phone after the alarm counts as up (2026-10-08)", () => {
  assert.equal(shouldBrief({ signal: "unplugged", signalAt: at(7, 50), now: at(7, 51), wake: "07:45" }).ok, true);
  assert.equal(shouldBrief({ signal: "used", signalAt: at(7, 40), now: at(7, 41), wake: "07:45" }).ok, true);
});

test("a 3 AM unplug, or one long before the alarm, is not getting up", () => {
  assert.match(shouldBrief({ signal: "unplugged", signalAt: at(3, 10), now: at(3, 10), wake: "07:45" }).reason, /not the morning/);
  assert.match(shouldBrief({ signal: "unplugged", signalAt: at(6, 30), now: at(6, 30), wake: "07:45" }).reason, /before his 07:45 alarm/);
  // Without a known alarm, 4 AM onwards counts.
  assert.equal(shouldBrief({ signal: "unplugged", signalAt: at(6, 30), now: at(6, 30) }).ok, true);
});

test("once a morning, never from a late signal, never in the afternoon", () => {
  assert.match(shouldBrief({ signal: "used", signalAt: at(8), now: at(8, 1), wake: "07:45", briefedToday: true }).reason, /already/);
  assert.match(shouldBrief({ signal: "used", signalAt: at(8), now: at(8, 30), wake: "07:45" }).reason, /20 minutes old/);
  assert.match(shouldBrief({ signal: "used", signalAt: at(14), now: at(14) }).reason, /not the morning/);
  assert.match(shouldBrief({ signal: "used", signalAt: at(8), now: at(1) }).reason, /future/);
  assert.equal(shouldBrief({ signal: "rebooted", signalAt: at(8), now: at(8) }).ok, false);
});

test("the briefing says the day, when to leave, what's due, and the weather", () => {
  const text = composeBriefing({
    now: at(7, 50), today: "2026-10-08",
    day: [
      { title: "CS2100 Lecture", start: m(9), end: m(10), fixed: true },
      { title: "Study macro", start: m(12), end: m(13), fixed: false },
      { title: "DS Assessment — group", start: m(15, 30), end: m(16, 30), fixed: true },
    ],
    travel: [{ title: "commute to class", start: m(8, 30), end: m(9) }, { title: "commute home", start: m(16, 30), end: m(17) }],
    todos: [{ title: "Macro quiz prep", dueDate: "2026-10-08", booked: false }, { title: "Cert course", dueDate: null }],
    weather: { hours: [
      { time: "2026-10-08T07:00", day: "today", tempC: 9.2, rainChance: 10, rainMm: 0, snowCm: 0 },
      { time: "2026-10-08T12:00", day: "today", tempC: 14.1, rainChance: 20, rainMm: 0, snowCm: 0 },
      { time: "2026-10-08T14:00", day: "today", tempC: 13, rainChance: 70, rainMm: 1.2, snowCm: 0 },
    ] },
  });
  assert.equal(text, "Morning, Nick. Today you've got CS2100 Lecture at 9 and DS Assessment at 3:30. Leave by 8:30. Due today: Macro quiz prep. It's 9 degrees now, up to 14, with rain from about 2 — take a jacket. Anything you want to change?");
});

test("an empty day still gets a briefing, with the top of the list", () => {
  const text = composeBriefing({ now: at(9), today: "2026-10-08", day: [], todos: [{ title: "Cert course" }, { title: "Laundry" }, { title: "Waits", waiting: true }] });
  assert.equal(text, "Morning, Nick. Nothing on the calendar today. Top of your list: Cert course and Laundry. Anything you want to change?");
});

test("weather and clock wording", () => {
  assert.equal(weatherLine({ hours: [{ time: "2026-10-08T08:00", day: "today", tempC: 11, rainChance: 0, rainMm: 0, snowCm: 0 }] }, m(8)), "It's 11 degrees and dry today.");
  assert.equal(weatherLine(null, m(8)), null);
  assert.equal(spokenClock(m(13, 15)), "1:15");
  assert.equal(spokenClock(m(0)), "12");
});

test("the morning screen: the day on one side, the weather on the other", async () => {
  const { buildView, weatherSymbol } = await import("../scripts/lib/reach/morning.mjs");
  const view = buildView({
    now: at(7, 50), today: "2026-10-08",
    day: [{ title: "CS2100 Lecture", start: m(9), end: m(10), fixed: true, kind: "class" }, { title: "commute to class", start: m(8, 30), end: m(9), fixed: true }],
    travel: [{ title: "commute to class", start: m(8, 30), end: m(9) }],
    todos: [{ title: "Macro quiz prep", dueDate: "2026-10-08" }],
    weather: { hours: [7, 8, 9, 10].map((h) => ({ time: `2026-10-08T${String(h).padStart(2, "0")}:00`, day: "today", tempC: 8 + h - 7, rainChance: h === 10 ? 60 : 0, rainMm: 0, snowCm: 0, code: h === 10 ? 61 : 1 })) },
  });
  assert.deepEqual(view.events, [{ title: "CS2100 Lecture", start: "9:00", half: "AM", end: "10:00", kind: "class", fixed: true }]);
  assert.equal(view.leaveBy, "8:30 AM");
  assert.deepEqual(view.due, ["Macro quiz prep"]);
  assert.equal(view.weather.now, 8);
  assert.equal(view.weather.high, 11);
  assert.equal(view.weather.symbol, "cloud.sun");
  assert.equal(view.weather.hours.length, 2);
  assert.equal(weatherSymbol(0, 3), "moon.stars");
  assert.equal(weatherSymbol(95), "cloud.bolt.rain");
});
