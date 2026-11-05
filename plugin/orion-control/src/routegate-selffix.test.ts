import { describe, expect, it } from "vitest";
import { asksFix, asksWhy, readSelffixMove } from "./selffix-flow.js";

const NOW = new Date(2026, 10, 4, 20, 0, 0);
const ctx = { stateDir: "/x", now: NOW, items: [] };

describe("E7: any question about ORION's own last reply is a why", () => {
  it.each([
    "? Why was your response just three dots.", "why was ur response just dots", "why is your reply so short", "whys your answer blank",
    "why did your last message say that", "why were your replies the same twice", "what was that reply", "whats with the dots", "why just three dots lol",
    "what was with that response", "why did your answer come back empty",
  ])("%s", (m) => { expect(asksWhy(m)).toBe(true); expect(readSelffixMove(m, ctx)?.kind).toBe("why"); });
  it.each(["why is the sky blue", "why am i so tired", "what was the answer to question 4", "why is my reply to the email late", "whats with the weather"])("%s is not about ORION", (m) => {
    expect(readSelffixMove(m, ctx)).toBeUndefined();
  });
});

describe("A2: can you modify something in your own code reaches the fix offer", () => {
  it.each([
    "Can you modify something in your own code?", "can u change something in ur code", "can you edit your own code", "could you improve yourself",
    "can you modify yourself", "can you make changes to your own code", "are you able to rewrite your own code",
  ])("%s", (m) => { expect(asksFix(m)).toBe(true); expect(readSelffixMove(m, ctx)?.kind).toBe("fix"); });
  it.each(["can you fix my resume", "can you change my alarm", "update yourself on the weather", "can you edit this doc"])("%s is not a self-fix", (m) => {
    expect(asksFix(m)).toBe(false);
  });
});
