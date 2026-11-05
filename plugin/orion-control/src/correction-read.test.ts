// Tube audit T3 (11-05 12:17): "yes, but not the NEW CS Lab, just CS Lab" is a correction of the last action, not chit-chat.
import { describe, expect, it } from "vitest";
import { correctedAsk, readCorrection } from "./correction-read.js";

describe("corrections", () => {
  it.each([
    ["yes, but not the NEW CS Lab, just CS Lab", { wrong: "NEW CS Lab", right: "CS Lab" }],
    ["not the new cs lab, only the cs lab", { wrong: "new cs lab", right: "cs lab" }],
    ["no not the gym, i meant the walk", { wrong: "gym", right: "walk" }],
    ["actually not DS Lab, it's CS Lab", { wrong: "DS Lab", right: "CS Lab" }],
    ["nah i meant the DS lab", { right: "DS lab" }],
    ["no, i meant leetcode please", { right: "leetcode" }],
    ["not that one, the dentist one", { right: "dentist one" }],
    ["no, the other one", { other: true }],
    ["other one", { other: true }],
  ])("%s", (m, c) => expect(readCorrection(m)).toEqual(c));
  it.each(["not sure what to do today", "i meant to ask earlier whether the gym is open and what time it closes tonight lol ok", "not now", "yes please", "move the gym to 5", "what is not the new one"])("%s is not one", (m) => expect(readCorrection(m), m).toBeNull());
  it("the previous ask carries the correction", () => {
    expect(correctedAsk("replace DS Lab 05 with CS Lab", { wrong: "NEW CS Lab", right: "CS Lab" })).toBe("replace DS Lab 05 with CS Lab (correction of what you just did: not NEW CS Lab, CS Lab)");
    expect(correctedAsk("move the gym to 5.", { other: true })).toBe("move the gym to 5 (correction of what you just did: he means the other one)");
  });
});
