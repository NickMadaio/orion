// REV5 MUST 3 (2026-10-31): the life / living / dying / not waking up / disappearing / no point space is distress, by category.
// "i hate being alive" was saved as a preference ("Nick doesn't like being alive"). The reviewer's lines first, then held-out
// phrasings in the same categories, then the hyperbole the module has always let through.
import { describe, expect, it } from "vitest";
import { isCrisis } from "./distress.js";
describe("REV5: the reviewer's lines are distress", () => {
    it.each(["i hate being alive", "i dont like living", "i dont mind dying", "i like the idea of not waking up", "remember i hate my life"])("%s", (m) => {
        expect(isCrisis(m)).toBe(true);
    });
});
describe("held out, by category", () => {
    it.each([
        // life / living / alive
        "honestly i'm so tired of living", "im sick of being alive", "i really cant stand my life anymore", "done with life tbh", "i dont enjoy being alive",
        // dying / death
        "i wouldnt mind if i died", "i keep thinking about death", "i'm kind of ok with dying", "i'd rather be dead", "ready to die honestly",
        // not waking up / sleep forever
        "hope i dont wake up tomorrow", "i just want to sleep forever", "i wish i could go to sleep and not wake up", "wouldnt mind not waking up",
        // disappear / not exist
        "i wish i could just disappear", "i wish i didnt exist", "i want to stop existing",
        // no point
        "there's no point in anything", "life feels pointless", "nothing to live for", "life isnt worth it", "what's the point of living anymore",
    ])("%s", (m) => { expect(isCrisis(m)).toBe(true); });
});
describe("hyperbole and ordinary uses stay ordinary", () => {
    it.each([
        "i'm dying to see that movie", "this class is killing me", "im dying lol this meme", "i don't like living in london", "i hate living with roommates",
        "i dont mind dying my hair blue", "hope i dont wake up late tomorrow", "i love my life", "i like living near campus", "no point in going to the lecture",
        "i could sleep for a week", "i'd rather die than do another group project lol", "the bug just disappeared", "thinking about death of a salesman for english",
    ])("%s", (m) => { expect(isCrisis(m)).toBe(false); });
});
