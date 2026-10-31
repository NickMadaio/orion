// REV2 findings 1 and 4 (2026-10-31): orion-reschedule exits 0 with "Written to his calendar" even when a line says NOT BOOKED or
// SHRUNK. Those runs changed his calendar: they are reported as side effects, and the writes count is exactly the undo entries made.
import { describe, expect, it } from "vitest";
import { readDayRequest, runDayRequest } from "./day-requests.js";
import { runLighten } from "./day-lighten.js";
import { refused, sideNotes, wrote, writesIn } from "./scheduler-out.js";
const now = new Date(2026, 9, 30, 14, 0);
const day = { date: "2026-10-30", blocks: [
        { title: "MKTG2201 Introduction to Marketing", start: "09:50", end: "11:30", fixed: true, kind: "class" },
        { title: "Study for econ midterm", start: "14:30", end: "16:00", fixed: false, kind: "study" },
        { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
        { title: "YouTube editing", start: "18:30", end: "19:30", fixed: false, kind: "side_project" },
        { title: "Laundry", start: "20:00", end: "20:45", fixed: false },
    ] };
const WROTE_WITH_SIDE = "Changed Friday 2026-10-30:\n  took Laundry 20:00–20:45 off\n  SHRUNK to fit: YouTube editing 60 → 30 min (low priority; tell him)\n  moved Gym: 16:30 → 16:45\n  NOT BOOKED: Laundry (45 min) no longer fits on Friday (nothing low-priority could give up enough time) — ask him\nWritten to his calendar. \"orion-reschedule undo\" puts it back.";
const fake = (reply, code = 0) => {
    const calls = [];
    return { calls, run: async (script, args) => { calls.push({ script, args }); return { stdout: reply(args, script), code }; } };
};
describe("scheduler-out reads what a run did", () => {
    it("NOT BOOKED under 'Written to his calendar' is a write, not a refusal", () => {
        expect(refused({ stdout: WROTE_WITH_SIDE, code: 0 })).toBe(false);
        expect(wrote({ stdout: WROTE_WITH_SIDE, code: 0 })).toBe(true);
        expect(refused({ stdout: "NOTHING WAS BOOKED on Friday (2026-10-30). Do not tell him", code: 0 })).toBe(true);
    });
    it("names every collateral change, shrinks and removals included", () => {
        const notes = sideNotes("Done: took Study off", [WROTE_WITH_SIDE]);
        expect(notes).toEqual(expect.arrayContaining(["YouTube editing shortened to 30 minutes (was 60)", "Gym 4:30 PM → 4:45 PM", "Laundry came off (no room)"]));
    });
    it("counts one undo entry per day orion-tasks booked", () => {
        expect(writesIn("Added \"Study\".\nStudy: 2026-11-02 60 min, 2026-11-03 60 min\n2026-11-02:\n  Changed\n  Written to his calendar.\n2026-11-03:\n  Written to his calendar.")).toBe(2);
    });
});
describe("finding 1: a drop that wrote is reported with what else moved", () => {
    it.each(["im sick, cancel gym and laundry today", "im sick, drop the side project and laundry", "ugh im ill, cut laundry and gym"])("%s", async (m) => {
        const req = readDayRequest(m, now);
        expect(req).toBeTruthy();
        const f = fake(() => WROTE_WITH_SIDE);
        const out = await runDayRequest(req, { run: f.run, readDay: async () => day, now });
        expect(out.flow.outcome).toBe("done");
        const reply = out.flow.reply;
        expect(reply).not.toMatch(/Nothing changed|couldn't take/);
        expect(reply).toMatch(/shortened to 30 minutes/);
        expect(out.writes).toBe(f.calls.filter((c) => c.script === "orion-reschedule" && c.args[0] !== "undo").length);
    });
    it("an add whose own block did not fit is undone at once, so 'nothing changed' is true", async () => {
        const req = readDayRequest("add a 30 min nap at 4 today and cut laundry tonight", now);
        const f = fake((args) => args[0] === "add" ? "Changed Friday:\n  moved Gym: 16:30 → 16:45\n  NOT BOOKED: Nap (30 min) did not fit on Friday — ask\nWritten to his calendar." : args[0] === "undo" ? "put Gym back" : "Changed Friday:\n  took Laundry 20:00–20:45 off\nWritten to his calendar.");
        const out = await runDayRequest(req, { run: f.run, readDay: async () => day, now });
        expect(f.calls.map((c) => c.args[0])).toEqual(["add", "undo", "drop"]);
        const reply = out.flow.reply;
        expect(reply).toMatch(/nap didn't go in/i);
        expect(reply).not.toMatch(/Gym 4:30 PM → 4:45 PM/); // that move was undone
        expect(out.writes).toBe(1);
    });
    it("runLighten names collateral moves and counts writes per run", async () => {
        const f = fake(() => WROTE_WITH_SIDE);
        const out = await runLighten([{ args: ["drop", "Laundry"], said: "Laundry off today" }], f.run);
        expect(out.flow.outcome).toBe("done");
        expect(out.flow.reply).toMatch(/YouTube editing shortened to 30 minutes/);
        expect(out.writes).toBe(1);
    });
    it("runLighten: a NOT BOOKED drop result is not 'I couldn't'", async () => {
        const f = fake(() => WROTE_WITH_SIDE);
        const out = await runLighten([{ args: ["drop", "YouTube editing"], said: "YouTube editing off today" }, { args: ["rename", "Gym", "Gym (easy)"], said: "Gym stays, easy" }], f.run);
        expect(out.flow.reply).not.toMatch(/couldn't/);
        expect(out.writes).toBe(2);
    });
});
describe("finding 4: a deadline's study sessions count one undo per day booked", () => {
    it.each(["i have a marketing quiz thursday i should prob study for it", "got a econ midterm friday, need to study for it", "i have an essay due monday, book two 1 hour study blocks for it"])("%s", async (m) => {
        const req = readDayRequest(m, now);
        expect(req.kind).toBe("deadline");
        const tasks = "Added \"Study\".\nStudy for x: 2026-11-02 60 min, 2026-11-03 60 min\n2026-11-02:\n  Changed Monday:\n  planned Study 10:00–11:00\n  Written to his calendar.\n2026-11-03:\n  Changed\n  moved Gym: 16:30 → 17:00\n  Written to his calendar.";
        const f = fake((_a, script) => script === "orion-tasks" ? tasks : "Changed\nadded (fixed) X: 14:00–15:00\nWritten to his calendar.");
        const out = await runDayRequest(req, { run: f.run, readDay: async () => day, now });
        const eventAdds = f.calls.filter((c) => c.script === "orion-reschedule").length;
        expect(out.writes).toBe(eventAdds + 2);
        expect(out.flow.reply).toMatch(/Gym 4:30 PM → 5:00 PM/);
    });
});
