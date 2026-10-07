import test from "node:test";
import assert from "node:assert/strict";
import { importantPerson, judge, parseVerdict, weatherHit, parseWeatherWatch } from "../scripts/lib/reach/triage.mjs";

const about = { channel: "texts", context: "test" };

test("his important people always get through, by name or number", async () => {
  assert.equal(importantPerson("Mom", ["Mom", "Dad"]), "Mom");
  assert.equal(importantPerson("+1 (201) 555-0134", ["2015550134"]), "2015550134");
  assert.equal(importantPerson("Jake", ["Mom"]), null);
  assert.equal((await judge({ from: "Dad", text: "hey" }, { people: ["Dad"], about })).verdict, "important");
});

test("on battery there is no guessing: only people and urgent words", async () => {
  assert.equal((await judge({ from: "Jake", text: "lol" }, { people: [], about })).verdict, "skip");
  assert.equal((await judge({ from: "Jake", text: "call me asap" }, { people: [], about })).verdict, "important");
});

test("plugged in, the local model decides; an unclear answer is a skip", async () => {
  assert.equal((await judge({ from: "Prof", text: "class moved" }, { about, model: async () => "Important." })).verdict, "important");
  assert.equal((await judge({ from: "Shop", text: "50% off" }, { about, model: async () => "skip" })).verdict, "skip");
  assert.equal((await judge({ from: "X", text: "y" }, { about, model: async () => "maybe" })).verdict, "skip");
  assert.equal(parseVerdict("IMPORTANT"), "important");
});

test("weather watches parse and fire", () => {
  assert.deepEqual(parseWeatherWatch("rain tomorrow"), { kind: "weather", condition: "rain", day: "tomorrow" });
  assert.equal(parseWeatherWatch("below 3").value, 3);
  assert.throws(() => parseWeatherWatch("nice day"), TypeError);
  const forecast = { hours: [
    { day: "today", time: "2026-10-07T13:00", rainChance: 20, rainMm: 0, tempC: 14, code: 3, windKph: 10, snowCm: 0 },
    { day: "today", time: "2026-10-07T16:00", rainChance: 80, rainMm: 1.2, tempC: 12, code: 61, windKph: 15, snowCm: 0 },
  ] };
  assert.equal(weatherHit({ condition: "rain", day: "today" }, forecast), "Rain likely today from about 4 PM (80% chance).");
  assert.equal(weatherHit({ condition: "snow", day: "today" }, forecast), null);
  assert.equal(weatherHit({ condition: "below", value: 13, day: "today" }, forecast), "It drops below 13°C today around 4 PM.");
});
