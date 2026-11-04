// The water goal in chat (2026-11-04): "set my water goal to 10", "i want to drink 8 bottles a day", "whats my water goal". Held-out phrasings.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWaterGoal, runWaterGoal, WATER_GOAL_DEFAULT } from "./water-goal.js";
import { readHealthIntent } from "./health-log.js";

const NOW = new Date(2026, 10, 4, 13, 0);
const setTo = (bottles: number) => ({ kind: "water" as const, read: false, bottles });

describe("reading a goal change", () => {
  it.each([
    ["set my water goal to 10", 10],
    ["can u make my water goal 12", 12],
    ["change the water target to 8 bottles pls", 8],
    ["i wanna drink 10 bottles a day", 10],
    ["i want to drink 8 bottles of water a day", 8],
    ["id like to be drinking 11 bottles daily", 11],
    ["bump my water goal up to 11", 11],
    ["my water goal should be six", 6],
    ["water goal 7", 7],
    ["lets do twelve bottles a day from now on", 12],
    ["up my daily water to 10 bottles", 10],
  ])("%s", (m, bottles) => expect(readWaterGoal(m)).toEqual(setTo(bottles)));

  it("a change with no number asks which", () => {
    expect(readWaterGoal("change my water goal")).toEqual({ kind: "water", read: false });
    expect(readWaterGoal("i want a different water goal")).toEqual({ kind: "water", read: false });
  });
  it("an out-of-range number is carried so the reply can refuse it", () => {
    expect(readWaterGoal("set my water goal to 50")).toEqual(setTo(50));
    expect(readWaterGoal("set my water goal to 0")).toEqual(setTo(0));
  });
});

describe("reading a question about the goal", () => {
  it.each([
    "whats my water goal", "what's my water target?", "wats my water goal rn", "how many bottles is my goal",
    "how many bottles a day am i aiming for", "what is the out of number for my water",
  ])("%s", (m) => expect(readWaterGoal(m)).toEqual({ kind: "water", read: true }));
});

describe("leaving everything else alone", () => {
  it.each([
    "i drank 2 bottles of water", "log 2 bottles of water", "log water", "had a big bottle of water", "how much water have i had today",
    "remind me to drink water at 5", "how many bottles have i had", "i need to drink more water", "set my bedtime to 11",
    "set my calorie goal to 2500", "drink 8 glasses of water", "my goal is to finish my essay by 10",
    "i want to drink 3 liters a day", "whats my gym goal", "set an alarm for 8 bottles", "how many calories in a bottle of coke",
  ])("%s", (m) => expect(readWaterGoal(m)).toBeNull());

  it("is read by the health intent, ahead of the meal reader", () => {
    expect(readHealthIntent("i want to drink 8 bottles a day", NOW)).toEqual(setTo(8));
    expect(readHealthIntent("whats my water goal", NOW)).toEqual({ kind: "water", read: true });
  });
});

describe("carrying it out", () => {
  const log = (extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "orion.health.v3", updatedAt: "", supplements: [], supplementLog: {}, workouts: [],
    days: { "2026-11-04": { waterBottles: 4, calories: 0, supplementIDs: [], updatedAt: "" } }, phoneScreen: { locked: true }, ...extra });
  const dir = (extra?: Record<string, unknown>) => { const d = mkdtempSync(join(tmpdir(), "watergoal-")); writeFileSync(join(d, "health-log.json"), log(extra)); return d; };
  const stored = (d: string) => JSON.parse(readFileSync(join(d, "health-log.json"), "utf8")) as Record<string, any>;

  it("writes nutritionGoals.water, keeps other goals and unknown fields, and says what it did", async () => {
    const d = dir({ nutritionGoals: { calories: 2600, protein: 180 } });
    const r = await runWaterGoal(setTo(10), { stateDir: d, now: NOW });
    expect(r).toMatchObject({ outcome: "done", reply: "Water goal is now 10 bottles a day (was 9). You're at 4 today." });
    expect(stored(d).nutritionGoals).toMatchObject({ calories: 2600, protein: 180, carbohydrates: 250, fat: 70, fiber: 30, water: 10 });
    expect(stored(d).phoneScreen).toEqual({ locked: true });
  });
  it("reads the current goal", async () => {
    const d = dir({ nutritionGoals: { water: 12 } });
    expect(await runWaterGoal({ kind: "water", read: true }, { stateDir: d, now: NOW })).toMatchObject({ outcome: "say", text: "Your water goal is 12 bottles a day. You're at 4 today." });
    expect(await runWaterGoal({ kind: "water", read: true }, { stateDir: dir(), now: NOW })).toMatchObject({ text: `Your water goal is ${WATER_GOAL_DEFAULT} bottles a day. You're at 4 today.` });
  });
  it("refuses a number outside 1 to 30 and writes nothing", async () => {
    const d = dir();
    const r = await runWaterGoal(setTo(50), { stateDir: d, now: NOW });
    expect(r).toMatchObject({ outcome: "say", text: "I can set it anywhere from 1 to 30 bottles a day, so it's still 9." });
    expect(stored(d).nutritionGoals).toBeUndefined();
  });
  it("asks when no number was said, and notes when it is already that", async () => {
    const d = dir({ nutritionGoals: { water: 10 } });
    expect(await runWaterGoal({ kind: "water", read: false }, { stateDir: d, now: NOW })).toMatchObject({ outcome: "say", kind: "ask", text: "How many bottles a day? It's 10 now." });
    expect(await runWaterGoal(setTo(10), { stateDir: d, now: NOW })).toMatchObject({ outcome: "say", text: "Your water goal is already 10 bottles a day." });
  });
  it("one bottle is singular, and a log that does not exist yet still works", async () => {
    const d = mkdtempSync(join(tmpdir(), "watergoal-"));
    const r = await runWaterGoal(setTo(1), { stateDir: d, now: NOW });
    expect(r).toMatchObject({ outcome: "done", reply: "Water goal is now 1 bottle a day (was 9). You're at 0 today." });
    expect(stored(d).nutritionGoals.water).toBe(1);
  });
  it("before 4 am it is still yesterday's count", async () => {
    const d = dir();
    const late = new Date(2026, 10, 5, 2, 0);
    expect(await runWaterGoal({ kind: "water", read: true }, { stateDir: d, now: late })).toMatchObject({ text: "Your water goal is 9 bottles a day. You're at 4 today." });
  });
});
