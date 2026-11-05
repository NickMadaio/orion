import { describe, expect, it } from "vitest";
import { decide } from "./front-desk.js";
import { guardIntake } from "./desk-intake-guard.js";
const water = { move: "tool", tool: "log_intake", args: { what: "water", amount: "1" }, ms: 5 };
const food = { move: "tool", tool: "log_intake", args: { what: "food", amount: "big mac" }, ms: 5 };
describe("a desk log_intake move must be named in the message (gate #24)", () => {
    it.each(["yeah log it", "yep do it", "sure go ahead and save that", "ok add it pls", "log it"])("%s does not become a bottle of water", (m) => {
        expect(guardIntake({ ...water }, m)).toMatchObject({ move: "escalate" });
        expect(guardIntake({ ...food }, m)).toMatchObject({ move: "escalate" });
    });
    it.each(["had a bottle of water", "drank a big bottle", "log 2 bottles pls"])("keeps %s", (m) => {
        expect(guardIntake({ ...water }, m).move).toBe("tool");
    });
    it("keeps a food log that names food", () => {
        expect(guardIntake({ ...food }, "i had a big mac for lunch").move).toBe("tool");
    });
    it("is applied to the real desk output", async () => {
        const fetchImpl = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ move: "tool", tool: "log_intake", args: { what: "water", amount: "1" }, tier: "quick", think: "off", say: "", answer: "" }) } })));
        const d = await decide({ message: "yeah log it", clock: "Mon 13:00" }, { fetchImpl });
        expect(d.move).toBe("escalate");
    });
});
