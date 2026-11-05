import { describe, expect, it } from "vitest";
import { newestOffer, slotAnswersGo } from "./offer-binding.js";
describe("which offer a go answers", () => {
    const now = 1_000_000_000;
    it("a newer offer in this chat beats an older slot", () => expect(slotAnswersGo(now - 240_000, now - 10_000, false, now)).toBe(false));
    it("an offer in the same instant wins", () => expect(slotAnswersGo(now, now, false, now)).toBe(false));
    it("the slot wins when it is the latest thing ORION said", () => {
        expect(slotAnswersGo(now - 10_000, now - 240_000, false, now)).toBe(true);
        expect(slotAnswersGo(now - 10_000, undefined, false, now)).toBe(true);
    });
    it("a slot from another chat key must be fresh", () => {
        expect(slotAnswersGo(now - 5 * 60_000, undefined, true, now)).toBe(false);
        expect(slotAnswersGo(now - 60_000, undefined, true, now)).toBe(true);
    });
    it("newestOffer", () => { expect(newestOffer([undefined, 5, 9, undefined])).toBe(9); expect(newestOffer([undefined])).toBeUndefined(); });
});
