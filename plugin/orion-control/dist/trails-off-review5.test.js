// review 5 H4 (2026-10-16 r8b): complete spoken questions ending on is/are/was/like are not cut-off fragments.
import { describe, expect, it } from "vitest";
import { trailsOff } from "./local-routing.js";
describe("trailsOff", () => {
    it("does not hold whole sentences", () => {
        for (const m of ["tell me what my next class is", "remind me what time the meeting is", "do you know where my keys are", "whatever you like", "that's how my day was", "i don't know what my plans are"]) {
            expect(trailsOff(m), m).toBe(false);
        }
    });
    it("still holds real fragments", () => {
        for (const m of ["can", "so if you can go ahead and", "what is", "move the"])
            expect(trailsOff(m), m).toBe(true);
    });
});
