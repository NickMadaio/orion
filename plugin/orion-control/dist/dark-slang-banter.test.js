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
// w20 r6 (live gate 4 #33): "this uni is actually killing me" is a grumble: a tease, not "log some water or take a quick break?".
describe("killing-me slang with an everyday cause", () => {
    it.each(["lol this uni is actually killing me", "this lecture is killing me lol", "work is killing me lol", "uni is so killing me rn lol", "this class is killing me"])("%s is a tease only", (m) => {
        expect(isBanterOnly(m), m).toBe(true);
        expect(gentleCheckIn(m)).not.toMatch(/water|break|sorry|tough/i);
    });
    it.each(["this econ homework is killing me lol", "my coursework is killing me haha", "this is killing me, i cant cope", "my dad is in hospital and its killing me", "its killing me", "the pain is killing me lol", "i feel like im dying, this uni is killing me", "this uni is killing me, can you move my lecture to 3"])("%s keeps its normal path", (m) => expect(isBanterOnly(m), m).toBe(false));
});
