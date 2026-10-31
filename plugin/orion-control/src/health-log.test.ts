// Wave 4, health (gate run-1031202318 cluster 5): meals, gym history, bedtime, sleep line. Every reply from data in a temp state dir.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { earlierBedtime, readBedtime, readGym, readHealthIntent, readMeal, runBedtime, runGym, runMeal, sleepLine } from "./health-log.js";

const NOW = new Date(2026, 10, 2, 20, 0);   // Mon 2 Nov 2026, 20:00 local
const dir = () => mkdtempSync(join(tmpdir(), "w4health-"));
const text = (f: { outcome: string; text?: string; reply?: string }) => (f.outcome === "done" ? f.reply : f.text) ?? "";
const json = (d: string, name: string) => JSON.parse(readFileSync(join(d, name), "utf8")) as Record<string, unknown>;
const HEALTH = (extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "orion.health.v3", updatedAt: "2026-11-01T00:00:00Z", supplements: [], supplementLog: {}, workouts: [], ...extra });

describe("readMeal (held-out phrasings)", () => {
  const at = new Date(2026, 10, 2, 21, 0);
  it.each([
    ["had a big lunch, like pasta", "Lunch", "Pasta", "big portion"],
    ["just had breakfast", "Breakfast", "Breakfast", ""],
    ["ate a burger and fries at 7", "Dinner", "Burger and fries", ""],
    ["log dinner: chicken rice", "Dinner", "Chicken rice", ""],
    ["i ate at 1", "Lunch", "Lunch", ""],
    ["had lunch an hour ago", "Lunch", "Lunch", ""],
  ])("%s", (said, meal, title, notes) => {
    const r = readMeal(said, at);
    expect(r).toMatchObject({ meal, title, notes });
  });
  it("a past clock time is read as the past, never refused", () => {
    expect(readMeal("log lunch at 1pm: pasta, big portion", NOW)?.at.getHours()).toBe(13);
    expect(readMeal("ate at 1", NOW)?.at.getHours()).toBe(13);
    expect(readMeal("had lunch an hour ago", NOW)?.at.getHours()).toBe(19);
  });
  it.each(["what should i have for lunch", "add lunch at 1pm tomorrow", "i havent eaten today", "going to have dinner at 8", "lunch at 1 with sam?", "remind me to eat at 6"])("not a meal eaten: %s", (said) => {
    expect(readMeal(said, NOW)).toBeNull();
  });
});

describe("runMeal", () => {
  it("writes one entry in the app's shape, and says what was written", async () => {
    const d = dir(); writeFileSync(join(d, "health-log.json"), HEALTH());
    const out = await runMeal(readMeal("log lunch at 1pm: pasta, big portion", NOW)!, { stateDir: d, now: NOW });
    const rows = (json(d, "health-log.json").nutritionLog as Record<string, Array<Record<string, unknown>>>)["2026-11-02"]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Pasta", meal: "Lunch", notes: "big portion", calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0 });
    expect(new Date(String(rows[0]!.loggedAt)).getHours()).toBe(13);
    expect(text(out)).toBe("Logged lunch at 1:00 PM: Pasta, big portion. That's 1 meal logged for today; I didn't guess calories.");
  });
  it("keeps what the file already holds, and counts the day's meals", async () => {
    const d = dir(); writeFileSync(join(d, "health-log.json"), HEALTH({ nutritionLog: { "2026-11-02": [{ title: "Oats", meal: "Breakfast", calories: 300 }] }, phoneScreen: { keep: true } }));
    const out = await runMeal(readMeal("had a big lunch, like pasta", NOW)!, { stateDir: d, now: NOW });
    const file = json(d, "health-log.json");
    expect((file.nutritionLog as Record<string, unknown[]>)["2026-11-02"]).toHaveLength(2);
    expect(file.phoneScreen).toEqual({ keep: true });
    expect(text(out)).toMatch(/That's 2 meals logged for today/);
  });
  it("creates the log when none exists", async () => {
    const d = dir();
    await runMeal(readMeal("had dinner", NOW)!, { stateDir: d, now: NOW });
    expect(json(d, "health-log.json").schema).toBe("orion.health.v3");
  });
});

describe("gym", () => {
  it.each(["have i been going to the gym", "how many gym days this week", "whats my gym streak", "how often did i hit the gym lately", "what did i lift last"])("read: %s", (said) => {
    expect(readGym(said)).not.toBeNull();
  });
  it.each(["move gym to 6", "log bench 135 for 8", "skip gym today", "how many calories at the gym cafe"])("not a read: %s", (said) => {
    expect(readGym(said) && !/calories/.test(said)).toBeFalsy();
  });
  const seed = (d: string) => {
    const day = (n: number) => `2026-11-0${n}`;
    writeFileSync(join(d, "health-log.json"), HEALTH({ workouts: [
      { id: "a", day: "2026-10-30", startedAt: "2026-10-30T18:00:00Z", title: "Push", exercises: [{ id: "e", name: "Bench", sets: [] }], notes: "" },
      { id: "b", day: day(1), startedAt: "2026-11-01T18:00:00Z", title: "", exercises: [{ id: "f", name: "Squat", sets: [] }], notes: "" },
    ] }));
    writeFileSync(join(d, "life-history.jsonl"), [
      { at: "2026-10-28T17:00:00", what: "Gym", kind: "gym", actualStart: 1020 }, { at: "2026-10-29T17:00:00", what: "Gym", kind: "gym", actualStart: null },
      { at: "2026-10-31T17:00:00", what: "Gym", kind: "gym", actualStart: 1030 }, { at: "2026-11-02T17:00:00", what: "Gym", kind: "gym", actualStart: 1010 },
    ].map((r) => JSON.stringify(r)).join("\n"));
  };
  it("counts the union of workouts and plan history over the last 7 days and names the gaps", async () => {
    const d = dir(); seed(d);
    const out = await runGym({ kind: "gym", scope: "last7" }, { stateDir: d, now: NOW });
    expect(text(out)).toBe("Gym in the last 7 days: 5 of 7 days (Wed, Fri, Sat, Sun, Mon). Nothing logged for Tue, Thu. Current streak: 4 days.");
  });
  it("'this week' on a Monday is the last 7 days, and says so", async () => {
    const d = dir(); seed(d);
    expect(text(await runGym({ kind: "gym", scope: "week" }, { stateDir: d, now: NOW }))).toMatch(/^The week has only just started, so this is the last 7 days\. Gym in the last 7 days: 5 of 7/);
  });
  it("'this week' late in the week counts from Monday", async () => {
    const d = dir(); seed(d);
    expect(text(await runGym({ kind: "gym", scope: "week" }, { stateDir: d, now: new Date(2026, 10, 5, 20, 0) }))).toMatch(/^Gym so far this week: 1 of 4 days \(Mon\)/);
  });
  it("recent workouts come from the log", async () => {
    const d = dir(); seed(d);
    expect(text(await runGym({ kind: "gym", scope: "recent" }, { stateDir: d, now: NOW }))).toBe("Last 2 workouts: Sun 01/11 (Squat); Fri 30/10 (Bench).");
  });
  it("no history is said plainly, with no praise or invention", async () => {
    const out = await runGym({ kind: "gym", scope: "last7" }, { stateDir: dir(), now: NOW });
    expect(text(out)).toBe("I have no gym logged in the last 7 days, so I can't say you've been going. Tell me when you go and I'll log it.");
  });
  it("a planned-but-missed week is not called solid", async () => {
    const d = dir();
    writeFileSync(join(d, "life-history.jsonl"), JSON.stringify({ at: "2026-11-01T17:00:00", what: "Gym", kind: "gym", actualStart: null }));
    const t = text(await runGym({ kind: "gym", scope: "last7" }, { stateDir: d, now: NOW }));
    expect(t).toMatch(/0 of 7 days/);
    expect(t).not.toMatch(/solid/i);
  });
});

describe("bedtime", () => {
  it.each([
    ["set my bedtime to 11:30 for the rest of the week", "23:30", true],
    ["bed by 11", "23:00", false],
    ["i want to be asleep by 10:45pm", "22:45", false],
    ["make my bedtime 12:30 am", "00:30", false],
  ])("%s", (said, time, week) => {
    expect(readBedtime(said)).toMatchObject({ read: false, time, week });
  });
  it.each(["i wanna sleep earlier this week", "gotta go to bed earlier", "need an earlier bedtime"])("earlier, no time: %s", (said) => {
    const r = readBedtime(said);
    expect(r).toMatchObject({ kind: "bedtime", read: false });
    expect(r?.time).toBeUndefined();
  });
  it.each([
    ["set my bedtime to 11, I was wrecked", "23:00"],
    ["I got no sleep, change my bedtime to 10:30", "22:30"],
  ])("an explicit set with a time wins over a past-tense aside: %s", (said, time) => {
    expect(readBedtime(said)).toMatchObject({ read: false, time });
  });
  it.each([
    "I was wrecked, bed at 2 last night",
    "yesterday I set my bedtime to 11 and slept badly",
    "I got to bed at 2 and was wrecked",
    "set my bedtime to 11 tonight, I was wrecked",
  ])("a report or a one-off is still not a setting: %s", (said) => { expect(readBedtime(said)).toBeNull(); });
  it("a question about it is a read", () => { expect(readBedtime("what time is my bedtime")).toMatchObject({ read: true }); });
  it("sets the named time, keeps the other settings, states the old one and the scope", async () => {
    const d = dir(); writeFileSync(join(d, "life-config.json"), JSON.stringify({ gymMinutes: 90, windDownMinutes: 30 }));
    const out = await runBedtime(readBedtime("set my bedtime to 11:30 for the rest of the week")!, { stateDir: d });
    expect(json(d, "life-config.json")).toEqual({ gymMinutes: 90, windDownMinutes: 30, bedtime: "23:30" });
    expect(text(out)).toBe('Bedtime is now 11:30 PM (was 12:00 AM); wind-down starts 11:00 PM. I can\'t time-limit it, so it stays until you change it; say "bedtime back to 12:00 AM" to revert.');
  });
  it("'sleep earlier' with no time moves it 30 minutes and says that was my pick", async () => {
    const d = dir();
    const out = await runBedtime(readBedtime("i wanna sleep earlier this week")!, { stateDir: d });
    expect(json(d, "life-config.json").bedtime).toBe("23:30");
    expect(text(out)).toMatch(/^Bedtime is now 11:30 PM \(was 12:00 AM\); wind-down starts 11:00 PM\. I picked 30 minutes earlier since you didn't name a time/);
  });
  it("earlier never goes into the afternoon", () => { expect(earlierBedtime("22:10")).toBe("22:00"); expect(earlierBedtime("01:00")).toBe("00:30"); });
  it("the current bedtime is read from the config", async () => {
    const d = dir(); writeFileSync(join(d, "life-config.json"), JSON.stringify({ bedtime: "23:15" }));
    expect(text(await runBedtime({ kind: "bedtime", read: true, week: false }, { stateDir: d }))).toBe("Your bedtime is 11:15 PM; wind-down starts 10:45 PM.");
  });
});

describe("sleepLine", () => {
  it("states last night from the health log, and nothing when there is none", async () => {
    const d = dir();
    writeFileSync(join(d, "health-log.json"), HEALTH({ days: { "2026-11-02": { sleepHours: 4.5, recovery: 31 } } }));
    expect(await sleepLine(d, NOW)).toBe("Your health log has 4.5 h of sleep and 31% recovery for last night.");
    expect(await sleepLine(dir(), NOW)).toBe("");
  });
});

describe("bedtime statements that are not settings (REV4 item 4)", () => {
  it.each([
    "went to bed at 3 last night", "fell asleep at 1 lol", "got to sleep by 4 yesterday", "was asleep by 2 last night so im wrecked",
    "slept at 3 again", "early night for me", "gonna have an early night tonight", "i wanna sleep earlier tonight", "fix my sleep schedule",
  ])("writes nothing: %s", (said) => {
    expect(readBedtime(said)).toBeNull();
  });
  it("an early night does not touch life-config", async () => {
    const d = dir(); writeFileSync(join(d, "life-config.json"), JSON.stringify({ bedtime: "23:00" }));
    expect(readHealthIntent("early night for me", NOW)).toBeNull();
    expect(json(d, "life-config.json").bedtime).toBe("23:00");
  });
  it.each([["set my bedtime to 11", "23:00"], ["change bedtime to 10:30pm", "22:30"], ["make my bedtime 1am", "01:00"]])("a setting verb still sets: %s", (said, time) => {
    expect(readBedtime(said)).toMatchObject({ read: false, time });
  });
});

describe("meal logged twice (REV4 item 11c)", () => {
  it.each(["had lunch", "just had lunch", "ate lunch"])("%s twice logs once", async (said) => {
    const d = dir();
    await runMeal(readMeal(said, NOW)!, { stateDir: d, now: NOW });
    const again = await runMeal(readMeal(said, new Date(NOW.getTime() + 4 * 60_000))!, { stateDir: d, now: new Date(NOW.getTime() + 4 * 60_000) });
    const rows = (json(d, "health-log.json").nutritionLog as Record<string, unknown[]>)["2026-11-02"]!;
    expect(rows).toHaveLength(1);
    expect(text(again)).toMatch(/already logged/i);
  });
  it("a different meal, or the same meal hours apart, is a new entry", async () => {
    const d = dir();
    await runMeal(readMeal("had lunch", NOW)!, { stateDir: d, now: NOW });
    await runMeal(readMeal("had dinner", NOW)!, { stateDir: d, now: NOW });
    await runMeal(readMeal("had lunch an hour ago", NOW)!, { stateDir: d, now: NOW });
    expect((json(d, "health-log.json").nutritionLog as Record<string, unknown[]>)["2026-11-02"]).toHaveLength(3);
  });
});

describe("routing order", () => {
  it("bedtime, then gym, then meal; a plain statement reads none", () => {
    expect(readHealthIntent("i wanna sleep earlier", NOW)?.kind).toBe("bedtime");
    expect(readHealthIntent("how many gym days this week", NOW)?.kind).toBe("gym");
    expect(readHealthIntent("had lunch", NOW)?.kind).toBe("meal");
    expect(readHealthIntent("im so tired", NOW)).toBeNull();
  });
});
