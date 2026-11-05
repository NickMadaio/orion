import { describe, expect, it } from "vitest";
import { ackImpliesChange } from "./ack-draft.js";
describe("acknowledgements that imply a change", () => {
    it.each(["Got it. Just the CS Lab reminder, not the new one.", "Done.", "Okay, moved it to 5.", "Updated your day.", "I've moved gym to 6.", "Sure, I changed the name.", "Noted, CS Lab it is.", "It is now called CS Lab."])("%s", (t) => expect(ackImpliesChange(t), t).toBe(true));
    it.each(["You're welcome, Nick.", "I haven't changed anything yet. Which block?", "Which one: CS Lab or New CS Lab?", "It's 6:23 AM.", "Your first thing is CS1800 at 9."])("%s is not one", (t) => expect(ackImpliesChange(t), t).toBe(false));
});
