import { test } from "node:test";
import assert from "node:assert/strict";
import { fahrenheitWords, toF } from "../scripts/lib/reach/fahrenheit.mjs";
import { weatherHit, parseWeatherWatch } from "../scripts/lib/reach/triage.mjs";

test("fahrenheitWords: pairs, Celsius-only, bare F, ranges", () => {
  assert.equal(fahrenheitWords("high of 13°C (55°F) and low of 8°C (46°F)"), "high of 55 degrees Fahrenheit and low of 46 degrees Fahrenheit");
  assert.equal(fahrenheitWords("high 13°C"), "high of 55 degrees Fahrenheit");
  assert.equal(fahrenheitWords("it is 55 F out"), "it is 55 degrees Fahrenheit out");
  assert.equal(fahrenheitWords("46–55°F"), "46 to 55 degrees Fahrenheit");
});

test("fahrenheitWords: times and percentages are untouched", () => {
  for (const t of ["at 5 PM", "50% chance", "9:30 F1", "leave by 8:30"]) assert.equal(fahrenheitWords(t), t);
  assert.equal(toF(13), 55);
});

test("weather watches are Fahrenheit; an old Celsius watch is converted, not reread", () => {
  const forecast = { hours: [{ day: "today", time: "2026-11-03T16:00", rainChance: 0, rainMm: 0, tempC: 5, code: 3, windKph: 5, snowCm: 0 }] };
  const w = parseWeatherWatch("below 45");
  assert.equal(w.unit, "F");
  assert.equal(weatherHit(w, forecast), "It drops below 45 degrees Fahrenheit today around 4 PM.");
  assert.equal(weatherHit({ condition: "below", value: 13, day: "today" }, forecast), "It drops below 55 degrees Fahrenheit today around 4 PM.");
});

test("fahrenheitWords: a food macro triple is never a temperature (2026-11-04: '8F' became '8 degrees Fahrenheit')", () => {
  for (const t of ["~190 kcal · 6P 23C 8F (nature valley protein bar). Log it?", "Logged ~570 kcal: 18P 69C 24F. Fix anything?", "Today is 8F"]) assert.equal(fahrenheitWords(t), t);
  assert.equal(fahrenheitWords("6P 23C 8F, and it is 55°F"), "6P 23C 8F, and it is 55 degrees Fahrenheit");
  assert.equal(fahrenheitWords("feels like 50 F, high 55F"), "feels like 50 degrees Fahrenheit, high of 55 degrees Fahrenheit");
});
