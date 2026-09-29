import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { dailyNeeds } from "../scripts/lib/life/daily-needs.mjs";

describe("dailyNeeds", () => {
  it("a full day meets everything", () => {
    const blocks = [
      { id: "sp1", title: "Side project", kind: "side_project", date: "2026-09-28", start: 540, end: 630, fixed: false, source: "template" },
      { id: "gym1", title: "Gym", kind: "gym", date: "2026-09-28", start: 720, end: 810, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
      { id: "meal2", title: "Dinner", kind: "meal", date: "2026-09-28", start: 1200, end: 1250, fixed: false, source: "template" },
    ];
    const config = { weekday: 1 };
    const result = dailyNeeds(blocks, config);
    assert.deepStrictEqual(result.met, ["side_project", "gym", "rest", "meals"]);
    assert.deepStrictEqual(result.missing, []);
  });

  it("no side project is 60 minutes short", () => {
    const blocks = [
      { id: "gym1", title: "Gym", kind: "gym", date: "2026-09-28", start: 720, end: 810, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
      { id: "meal2", title: "Dinner", kind: "meal", date: "2026-09-28", start: 1200, end: 1250, fixed: false, source: "template" },
    ];
    const config = { weekday: 1 };
    const result = dailyNeeds(blocks, config);
    assert.deepStrictEqual(result.met, ["gym", "rest", "meals"]);
    assert.deepStrictEqual(result.missing, [{ need: "side_project", minutes: 60 }]);
  });

  it("gym only counts on gym days", () => {
    const blocks = [
      { id: "sp1", title: "Side project", kind: "side_project", date: "2026-09-28", start: 540, end: 630, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
      { id: "meal2", title: "Dinner", kind: "meal", date: "2026-09-28", start: 1200, end: 1250, fixed: false, source: "template" },
    ];
    const config = { weekday: 2 };
    const result = dailyNeeds(blocks, config);
    assert.deepStrictEqual(result.met, ["side_project", "rest", "meals"]);
    assert.deepStrictEqual(result.missing, []);
  });

  it("partial side project reports the shortfall", () => {
    const blocks = [
      { id: "sp1", title: "Side project", kind: "side_project", date: "2026-09-28", start: 540, end: 580, fixed: false, source: "template" },
      { id: "gym1", title: "Gym", kind: "gym", date: "2026-09-28", start: 720, end: 810, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
      { id: "meal2", title: "Dinner", kind: "meal", date: "2026-09-28", start: 1200, end: 1250, fixed: false, source: "template" },
    ];
    const config = { weekday: 1 };
    const result = dailyNeeds(blocks, config);
    assert.deepStrictEqual(result.met, ["gym", "rest", "meals"]);
    assert.deepStrictEqual(result.missing, [{ need: "side_project", minutes: 20 }]);
  });

  it("one meal is one meal short", () => {
    const blocks = [
      { id: "sp1", title: "Side project", kind: "side_project", date: "2026-09-28", start: 540, end: 630, fixed: false, source: "template" },
      { id: "gym1", title: "Gym", kind: "gym", date: "2026-09-28", start: 720, end: 810, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
    ];
    const config = { weekday: 1 };
    const result = dailyNeeds(blocks, config);
    assert.deepStrictEqual(result.met, ["side_project", "gym", "rest"]);
    assert.deepStrictEqual(result.missing, [{ need: "meals", minutes: 30 }]);
  });

  it("defaults apply when config is empty", () => {
    const blocks = [
      { id: "sp1", title: "Side project", kind: "side_project", date: "2026-09-28", start: 540, end: 630, fixed: false, source: "template" },
      { id: "gym1", title: "Gym", kind: "gym", date: "2026-09-28", start: 720, end: 810, fixed: false, source: "template" },
      { id: "rest1", title: "Rest", kind: "rest", date: "2026-09-28", start: 900, end: 960, fixed: false, source: "template" },
      { id: "meal1", title: "Lunch", kind: "meal", date: "2026-09-28", start: 750, end: 800, fixed: false, source: "template" },
      { id: "meal2", title: "Dinner", kind: "meal", date: "2026-09-28", start: 1200, end: 1250, fixed: false, source: "template" },
    ];
    const result = dailyNeeds(blocks, {});
    assert.deepStrictEqual(result.met, ["side_project", "gym", "rest", "meals"]);
    assert.deepStrictEqual(result.missing, []);
  });
});
