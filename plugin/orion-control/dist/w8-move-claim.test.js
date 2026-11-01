// Wave 8 review fixes 2 and 3: the "X is moved to T" truth check fires only on a turn where Nick asked for a change and no calendar
// write for that block happened; the hedge is read inside the claim's own clause; a task add is not a calendar write.
import { describe, expect, it } from "vitest";
import { NOTHING_MOVED, finalizeReply } from "./reply-sanitize.js";
const none = [];
const cal = (title) => [{ canonical: `exec orion-reschedule move ${title} --to 17:00`, stdout: `Changed Monday:\n  ${title} moved: 18:00 → 17:00–18:30`, exit: 0 }];
const taskAdd = [{ canonical: 'exec orion-tasks add "buy milk"', stdout: "Added task: buy milk", exit: 0 }];
describe("read-only turn: a true claim is never replaced", () => {
    it.each(["Yes, gym is moved to 5 PM.", "Gym got moved to 5 PM earlier.", "Yep, I moved gym to 5."])("%s", (r) => {
        expect(finalizeReply(r, none, { askedChange: false })).toBe(r);
        expect(finalizeReply(r, none, {})).toBe(r);
    });
});
describe("a change was asked, nothing was written", () => {
    it.each([
        "Gym is moved to 5 PM, no problem.",
        "No worries, gym is moved to 5 PM.",
        "I moved gym to 5.",
        "Gym moved to 5 PM.",
        "Gym is moved to noon.",
        "Done, I've pushed the nap to 3.",
        "All set, gym is bumped to midnight!",
    ])("%s", (r) => expect(finalizeReply(r, none, { askedChange: true })).toBe(NOTHING_MOVED));
    it("a task add is not a calendar write", () => {
        expect(finalizeReply("Gym is moved to 5 PM.", taskAdd, { askedChange: true })).toBe(NOTHING_MOVED);
    });
    it("a calendar write for another block does not back the claim", () => {
        expect(finalizeReply("Gym is moved to 5 PM.", cal("Nap"), { askedChange: true })).toBe(NOTHING_MOVED);
    });
    it("the matching calendar write backs it", () => {
        expect(finalizeReply("Gym is moved to 5 PM.", cal("Gym"), { askedChange: true })).toBe("Gym is moved to 5 PM.");
    });
});
describe("hedges inside the claim's own clause still hold", () => {
    it.each(["Should gym be moved to 5?", "If gym is moved to 5 you'll miss lunch.", "Gym isn't moved to 5 PM yet.", "Want gym moved to 5 PM?",
        "Gym can't be moved to 5 PM, there's a class.", "I haven't moved gym to 5.", "Gym is moved to 5 PM if that works for you."])("%s", (r) => {
        expect(finalizeReply(r, none, { askedChange: true })).toBe(r);
    });
});
