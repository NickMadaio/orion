// Live 2026-11-04 11:21: a failed open went out as "I couldn't run that lookup just now. I could not do that." Said twice, and "lookup" for an app.
import { describe, expect, it } from "vitest";
import { finalizeReply } from "./reply-sanitize.js";
import { acknowledgesFailure } from "./tool-failure.js";
const failedOpen = [{ canonical: "app_open", stdout: 'Application "amazon uk" was not found in /Applications.', exit: 1 }];
describe("a failed turn owns the failure once", () => {
    it.each(["I could not do that.", "Sorry, I couldn't do that.", "I can't do it."])("%s is not said after the acknowledgement", (worker) => {
        const out = finalizeReply(worker, failedOpen, { hostTools: 1 });
        expect(out.split(/[.!?]/).filter((x) => x.trim()).length).toBe(1);
        expect(acknowledgesFailure(out)).toBe(true);
    });
    it("a worker sentence with real content still follows the acknowledgement", () => {
        const out = finalizeReply("Try the Safari app instead.", failedOpen, { hostTools: 1 });
        expect(out).toMatch(/Try the Safari app instead\.$/);
    });
});
