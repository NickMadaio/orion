import { describe, expect, it } from "vitest";
import { normalizeModelGraphShape } from "./index.js";
// Regression, 2026-10-07: `{ action: "reminder_cancel", id: "an2s34" }` lost
// its id to the step name, so cancelling a reminder never worked.
describe("flattened steps", () => {
    it("keeps an action's own id argument", () => {
        const graph = normalizeModelGraphShape({ goal: "g", steps: [{ action: "reminder_cancel", id: "an2s34" }] });
        expect(graph.steps[0].arguments).toEqual({ id: "an2s34" });
        expect(graph.steps[0].id).toBe("step-1");
    });
    it("still treats id as the step name for actions that take no id", () => {
        const graph = normalizeModelGraphShape({ goal: "g", steps: [{ action: "alarm_set", id: "wake", at: "07:30" }] });
        expect(graph.steps[0].id).toBe("wake");
        expect(graph.steps[0].arguments).toEqual({ at: "07:30" });
    });
    it("an explicit arguments object is left as it is", () => {
        const graph = normalizeModelGraphShape({ goal: "g", steps: [{ id: "s1", action: "reminder_cancel", arguments: { id: "an2s34" } }] });
        expect(graph.steps[0].id).toBe("s1");
        expect(graph.steps[0].arguments).toEqual({ id: "an2s34" });
    });
});
