// Review of 6fc2b13, plugin side: his own unmarked events come from `show --json` as fixed + nameable. Named by him (move, extend, remove, a
// re-plan item) they change; as a side effect (push everything, the re-plan's other blocks) they never do. Classes and plans with people never.
import { describe, expect, it } from "vitest";
import { runScheduleFlow } from "./schedule-flow.js";
const NOW = new Date(2030, 9, 22, 15, 0);
const day = { date: "2030-10-22", now: "15:00", plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
        { title: "CS1800 Discrete Structures — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "Fix car — Kwik Fit 10am", start: "16:00", end: "17:00", fixed: true, kind: "other", nameable: true },
        { title: "Gym", start: "18:00", end: "19:30", fixed: true, kind: "gym", nameable: true },
        { title: "Dinner with Sam", start: "19:45", end: "20:45", fixed: true, kind: "meal" },
        { title: "reading", start: "21:00", end: "21:30", fixed: false, kind: "study" },
    ] };
async function flow(message) {
    const writes = [];
    const result = await runScheduleFlow({ message, clock: "x", now: NOW, ask: async () => { throw new Error("no form"); },
        exec: async (a) => { if (a[0] !== "show")
            writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Changed:", code: 0 }; } });
    return { result, writes };
}
describe("explicit: what he names", () => {
    it.each([
        ["move gym to 5:15", ["move", "Gym", "--to", "17:15"]],
        ["move Fix car to 11pm", ["move", "Fix car — Kwik Fit 10am", "--to", "23:00"]],
        ["extend gym until 8", ["extend", "Gym", "--until", "20:00"]],
        ["drop the gym", ["drop", "Gym"]],
    ])("%j -> %j", async (m, argv) => {
        expect((await flow(m)).writes).toEqual([argv]);
    });
    it.each([
        ["move discrete to 6", "CS1800 Discrete Structures is a class or a plan with people, so it doesn't move. I haven't changed anything."],
        ["move dinner to 9", "Dinner with Sam is a class or a plan with people, so it doesn't move. I haven't changed anything."],
    ])("%j is refused (a class or a plan with people)", async (m, text) => {
        const { writes, result } = await flow(m);
        expect(writes).toEqual([]);
        if (text)
            expect(result).toMatchObject({ outcome: "say", text });
    });
    it("a re-plan item he names may be his own Gym: re-placed (not in its own way), after his Fix car, which is not named and stays", async () => {
        const { writes } = await flow("reschedule my day, gym first");
        expect(writes).toEqual([["day", "--plan", "Gym, 90, 17:05"]]);
    });
});
describe("automatic: never as a side effect", () => {
    it("push everything 30 min slides only ORION's reading, never his Gym, Fix car or the dinner", async () => {
        expect((await flow("push everything 30 min")).writes).toEqual([["day", "--plan", "reading, 30, 21:30"]]);
    });
});
