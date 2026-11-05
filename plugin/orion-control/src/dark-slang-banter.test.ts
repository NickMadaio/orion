// w20 R3 (gate #52): dark slang with an everyday cause is a light tease, nothing else (memory: orion-dark-slang-is-a-joke).
import { describe, expect, it } from "vitest";
import { gentleCheckIn, isBanterOnly } from "./distress.js";

describe("slang with an everyday cause", () => {
  it.each([
    "hate my life lol wifi is dead",
    "i hate my life rn the printer jammed again",
    "honestly id rather die lol this lecture is so slow",
    "so done with my life bruh the bus is late",
    "i hate my life haha laptop battery died",
  ])("%s is a tease only", (m) => {
    expect(isBanterOnly(m)).toBe(true);
    const t = gentleCheckIn(m);
    expect(t).not.toMatch(/sorry|try again|in a bit|want me|are you ok|how are you/i);
    expect(t.length).toBeLessThan(80);
  });
  it.each([
    "i hate my life lol can you move gym to 5",
    "hate my life lol the wifi is down, whats on today",
    "i hate my life",
    "i want to end my life",
  ])("%s keeps its normal path", (m) => {
    expect(isBanterOnly(m)).toBe(false);
  });
});
