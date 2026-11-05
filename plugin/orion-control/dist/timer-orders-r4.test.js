// w20 round 4 review: a timer is written only for an order; questions, refusals and "instead" are not orders; a second clause is handed on.
import { describe, expect, it } from "vitest";
import { readTimer, splitTimerAsk } from "./timer-flow.js";
import { isTimerRequest } from "./tool-moves.js";
import { normalizeSpoken } from "./spoken-numbers.js";
describe("not an order", () => {
    it.each([
        "dont set a 10 min timer", "do not start a 5 min timer", "never mind the 10 min timer, dont set it", "should i set a 10 min timer?", "shall i start a 20 min timer",
        "can you set a 5 min timer? or is that too short lol", "do you think i should set a 25 min timer", "how about a 10 min timer", "what if i set a 10 min timer",
    ])("%s", (said) => { expect(readTimer(said)).toBeUndefined(); expect(isTimerRequest(said)).toBe(false); });
    it("polite orders still are", () => {
        expect(readTimer("can you set a 10 min timer")?.seconds).toBe(600);
        expect(readTimer("could you start a 3 min timer for the tea pls")).toEqual({ seconds: 180, label: "tea" });
    });
});
describe("instead replaces the timer just set, and is nothing without one", () => {
    it("needs a previous timer", () => { expect(readTimer("make it a 10 min timer instead")).toBeUndefined(); });
    it("with one, says replace", () => {
        expect(readTimer("make it a 10 min timer instead", { hasLast: true })).toEqual({ seconds: 600, label: "Timer", replace: true });
        expect(readTimer("actually set a 15 min timer instead", { hasLast: true })?.replace).toBe(true);
    });
});
describe("a second clause is handed on", () => {
    it.each([
        ["set a 10 min timer and move my gym to 6", "set a 10 min timer", "move my gym to 6"],
        ["set a 10 min timer then add a 30 min walk to my calendar", "set a 10 min timer", "add a 30 min walk to my calendar"],
        ["start a 5 min timer for tea, then open safari", "start a 5 min timer for tea", "open safari"],
        ["move my gym to 6 and set a 10 min timer", "set a 10 min timer", "move my gym to 6"],
        ["add a walk to my calendar, then start a 5 min timer for tea", "start a 5 min timer for tea", "add a walk to my calendar"],
        ["i need a 20 min timer to study then a 5 min break", null, null],
    ])("%s", (said, timer, rest) => {
        const s = splitTimerAsk(said);
        if (timer === null)
            expect(s === undefined || !!s.rest).toBe(true);
        else
            expect(s).toEqual({ timer, rest });
    });
    it("a one-clause timer or a food name with 'and' is whole", () => {
        expect(splitTimerAsk("set a 10 min timer for mac and cheese")).toBeUndefined();
        expect(splitTimerAsk("set a 10 min timer")).toBeUndefined();
    });
});
describe("five to six minutes is a length, never a clock", () => {
    it.each([
        ["gym for five to six hours", "gym for 5 to 6 hours"], ["set a timer for five to six minutes", "set a timer for 5 to 6 minutes"],
        ["i need about ten to twelve people", "i need about ten to twelve people"], ["from ten to twelve", "from 10 to 12"],
    ])("%s", (said, out) => { expect(normalizeSpoken(said)).toBe(out); });
    it("a real clock position still reads", () => {
        expect(normalizeSpoken("wake me at ten to seven")).toBe("wake me at 6:50");
        expect(normalizeSpoken("meet me by quarter to five")).toContain("4:45");
        expect(normalizeSpoken("alarm for twenty past six")).toContain("6:20");
        expect(normalizeSpoken("bed at ten to twelve please")).toContain("11:50");
        expect(normalizeSpoken("wake me at quarter to eight thanks")).toContain("7:45");
    });
});
