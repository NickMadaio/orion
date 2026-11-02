// w14 g-food: which chat turns are food estimates, and what a short reply to "Log it?" means. Pure.
import { describe, expect, it } from "vitest";
import { readFoodTurn } from "./food-read.js";

const NOW = new Date(2026, 10, 2, 13, 0);
const read = (m: string, o: Partial<Parameters<typeof readFoodTurn>[1]> = {}) => readFoodTurn(m, { now: NOW, mealsOn: true, ...o });
const offered = { pending: { at: NOW.getTime() - 60_000, via: "chat" as const, offerText: "~670 kcal · 27P 99C 18F (chicken burrito and coke). Log it?" }, bound: true };

describe("asking for an estimate", () => {
  it.each([
    ["how many calories in a chicken burrito", "chicken burrito"],
    ["how many calories are in 2 slices of pepperoni pizza?", "2 slices of pepperoni pizza"],
    ["macros for 200g chicken breast and rice", "200g chicken breast and rice"],
    ["estimate the calories in my lunch: a big caesar salad and a coke", "big caesar salad and a coke"],
    ["how much protein is in greek yogurt with granola", "greek yogurt with granola"],
    ["i had a chicken burrito and a coke for lunch, how many calories is that", "i had a chicken burrito and a coke for lunch"],
  ])("%s", (m, text) => expect(read(m)).toEqual({ kind: "ask", text }));
  it("'how many calories was that' asks about the last meal", () => {
    expect(read("how many calories was that")).toEqual({ kind: "that" });
    expect(read("whats the macros on that?")).toEqual({ kind: "that" });
  });
  it("leaves his day totals and goals to the rest of ORION", () => {
    expect(read("how many calories have i had today")).toBeNull();
    expect(read("how much protein do i have left")).toBeNull();
    expect(read("whats my calorie goal")).toBeNull();
  });
});

describe("logging by description", () => {
  it.each([["log this: two eggs and toast", "two eggs and toast"], ["log a chicken caesar wrap", "a chicken caesar wrap"], ["track 2 bananas and a protein shake", "2 bananas and a protein shake"]])("%s", (m, text) =>
    expect(read(m)).toEqual({ kind: "log", text }));
  it("never claims a workout, water, sleep or calendar log", () => {
    for (const m of ["log my workout", "log 2 bottles of water", "log my sleep", "log 3 hours of study", "track my weight"]) expect(read(m)).toBeNull();
  });
});

describe("a meal he says he ate", () => {
  it("with a real food in it", () => expect(read("had a chicken burrito and a coke for lunch")?.kind).toBe("meal"));
  it("not without a food, and not when meals are off", () => {
    expect(read("had lunch")).toBeNull();
    expect(read("had a chicken burrito and a coke for lunch", { mealsOn: false })).toBeNull();
  });
});

describe("a reply to the offer", () => {
  it.each(["yes", "yeah log it", "log it", "sure", "yep!", "ok", "please do", "add it"])("%s is yes", (m) => expect(read(m, offered)).toEqual({ kind: "yes" }));
  it.each(["no", "nah", "don't log it", "no thanks", "skip it"])("%s is no", (m) => expect(read(m, offered)).toEqual({ kind: "no" }));
  it.each(["it was a small one", "no, it was a diet coke", "actually it was a large burrito", "there was no rice", "only half of it", "it was about 300g"])("%s re-estimates", (m) =>
    expect(read(m, offered)).toEqual({ kind: "revise", correction: m }));
  it("'how many calories was that' repeats the offer", () => expect(read("how many calories was that", offered)).toEqual({ kind: "that" }));
  it("is not bound when another conversation came in between", () => {
    expect(read("yes", { ...offered, bound: false })).toBeNull();
    expect(read("it was a small one", { ...offered, bound: false })).toBeNull();
  });
  it("is not read into a calendar or unrelated request", () => {
    expect(read("move gym to 6", offered)).toBeNull();
    expect(read("remind me to call mom at 5", offered)).toBeNull();
  });
});

describe("a photo attached in chat", () => {
  it("is a photo turn when the words are about it", () => {
    for (const m of ["", "log this", "how many calories is this", "lunch"]) expect(read(m, { attachments: [{ kind: "image" }] })).toEqual({ kind: "photo" });
  });
  it("other attachments are not", () => expect(read("log this", { attachments: [{ kind: "document" }] })).toBeNull());
});

describe("undo right after a food log", () => {
  const lastLogged = { id: "FOOD-0E0C7C2A-6B8B-4E0B-9C1A-3F7E3C0D8A11", at: NOW.getTime() - 2 * 60_000 };
  it("takes it off", () => expect(read("undo", { lastLogged })).toEqual({ kind: "undo", id: lastLogged.id }));
  it("not after ten minutes, and never without a food log", () => {
    expect(read("undo", { lastLogged: { ...lastLogged, at: NOW.getTime() - 11 * 60_000 } })).toBeNull();
    expect(read("undo")).toBeNull();
  });
});

describe("several offers waiting (wave 14 review): naming one is a pick", () => {
  const several = { pending: { at: NOW.getTime() - 60_000, via: "inbox" as const, offerText: "Food photo: ~540 kcal. Log it?", count: 3, names: ["cheeseburger and fries", "caesar salad", "pasta bolognese"] }, bound: true };
  it.each([
    "the burger",
    "log the burger",
    // held out
    "yeah the salad",
    "just the pasta one",
    "the caesar salad pls",
    "both",
    "all of them",
    "log all 3",
    "the first one",
    "last one",
  ])("%s", (m) => expect(read(m, several)).toEqual({ kind: "pick", which: m }));
  it.each(["yes", "yeah log it"])("a bare yes is still a yes (the script asks which): %s", (m) => expect(read(m, several)).toEqual({ kind: "yes" }));
  it.each(["it was a small one", "the gym", "nah"])("not a pick: %s", (m) => expect(read(m, several)?.kind).not.toBe("pick"));
  it("with one offer waiting, a name is not a pick", () => expect(read("the burger", { ...several, pending: { ...several.pending, count: 1 } })?.kind).not.toBe("pick"));
});
