// REV2 finding 17 (2026-10-31): dropping "The command failed..." left a false "Done".
import { describe, expect, it } from "vitest";
import { ONE_PART_FAILED, sanitizeReply } from "./reply-sanitize.js";
describe("finding 17: a dropped failure sentence leaves 'One part didn't work'", () => {
    it.each(["Done: moved gym and set reminder. The command failed for the reminder.", "Done, gym is at 7 and your reminder's set. The command didn't work for the reminder though.",
        "Moved gym to 7 and added the reminder. The orion-tasks command returned an error."])("%s", (reply) => {
        const out = sanitizeReply(reply);
        expect(out).toContain(ONE_PART_FAILED);
        expect(out).not.toMatch(/command|orion-|exec/i);
    });
    it("a plain leak that reports no failure is still just dropped", () => {
        expect(sanitizeReply("Gym is at 7 PM now. I used orion-reschedule for that.")).toBe("Gym is at 7 PM now.");
    });
});
