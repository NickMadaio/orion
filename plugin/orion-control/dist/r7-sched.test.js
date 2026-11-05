// w20 r7 sched: live audit 2026-11-05 (T1 the wrong block, T2 "Nothing on your day changed" over a swap, T5 a rename asked "Since when"), in his words.
import { describe, expect, it } from "vitest";
import { reconcileNamed } from "./block-choice.js";
import { readDayEdit } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { runScheduleFlow } from "./schedule-flow.js";
import { spokenReply } from "./schedule-reply.js";
const B = (title, start, end, extra = {}) => ({ title, start, end, kind: "study", fixed: false, ...extra });
const NOW = new Date(2026, 10, 5, 12, 14);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const AUDIT_DAY = { date: "2026-11-05", now: "12:14", blocks: [B("GET A GP", "11:20", "12:05"), B("New CS Lab", "13:00", "13:45", { made: true }), B("DS Lab 05", "12:10", "13:00"), B("practice leetcode", "13:50", "14:50"), B("Gym", "16:20", "17:50", { kind: "gym" })] };
const id = (d, title) => `B${d.blocks.findIndex((b) => b.title === title) + 1}`;
describe("T1 the block a step picked is the block his words name", () => {
    const picked = (d, title, extra = {}) => [{ do: "move", what: id(d, title), to: "12:30", ...extra }];
    it("lets reschedule my day, starting with CS Lab at 12:30: DS Lab 05 is not CS Lab", () => {
        const r = reconcileNamed("lets reschedule my day, starting with CS Lab at 12:30", picked(AUDIT_DAY, "DS Lab 05"), AUDIT_DAY);
        expect(r).toHaveProperty("ask");
        expect(r.ask).toMatch(/New CS Lab/);
        expect(r.ask).toMatch(/haven't changed anything/);
    });
    it.each([
        ["move cs lab to 3", { do: "move", to: "15:00" }],
        ["put cs lab at 4pm", { do: "move", to: "16:00" }],
        ["resize cs lab to an hour", { do: "resize", minutes: 60 }],
        ["drop the cs lab", { do: "drop" }],
        ["can you push cs lab back half an hour", { do: "move", by: 30 }],
        ["swap cs lab with leetcode", { do: "swap", with: "B4" }],
    ])("%s", (say, extra) => {
        const r = reconcileNamed(say, [{ what: id(AUDIT_DAY, "DS Lab 05"), ...extra }], AUDIT_DAY);
        expect(r).toHaveProperty("ask");
    });
    it("a block titled exactly what he said wins over a fuzzy one", () => {
        const day = { ...AUDIT_DAY, blocks: [...AUDIT_DAY.blocks, B("CS Lab", "15:00", "15:45")] };
        const r = reconcileNamed("move cs lab to 3", picked(day, "New CS Lab"), day);
        expect(r.steps[0].what).toBe(id(day, "CS Lab"));
        const r2 = reconcileNamed("move cs lab to 3", picked(day, "DS Lab 05"), day);
        expect(r2.steps[0].what).toBe(id(day, "CS Lab"));
    });
    it("the title said whole is never guessed away", () => {
        const r = reconcileNamed("move new cs lab to 3", picked(AUDIT_DAY, "New CS Lab", { to: "15:00" }), AUDIT_DAY);
        expect(r.steps[0].what).toBe(id(AUDIT_DAY, "New CS Lab"));
    });
    it.each([
        ["move lab to 5", "DS Lab 05"], ["push gym to 6", "Gym"], ["move gym after the cs lab session", "Gym"], ["push everything back 30", "Gym"],
        ["move leetcode to 4 and gym to 6", "practice leetcode"], ["move whatever is after lab to 5", "practice leetcode"],
    ])("no false alarm: %s", (say, title) => expect(reconcileNamed(say, picked(AUDIT_DAY, title), AUDIT_DAY)).toHaveProperty("steps"));
    it("the flow asks and writes nothing when the form picked the wrong block", async () => {
        const calls = [];
        const out = await runScheduleFlow({ message: "lets reschedule my day, starting with CS Lab at 12:30", clock: "Thu 12:14", now: NOW,
            exec: async (a) => { calls.push(a); return a[0] === "show" ? { stdout: JSON.stringify(AUDIT_DAY), code: 0 } : { stdout: "Changed", code: 0 }; },
            ask: async () => ({ steps: [{ do: "move", what: id(AUDIT_DAY, "DS Lab 05"), to: "12:30" }] }) });
        expect(out.outcome).toBe("say");
        expect(calls.filter((c) => c[0] !== "show")).toEqual([]);
    });
});
describe("T2 a swap that ran is never 'Nothing on your day changed'", () => {
    it("the swap script's own lines", () => {
        const text = spokenReply(["Changed Thursday 2026-11-05:\n  New CS Lab now 12:30–13:15\n  DS Lab 05 now 13:25–14:10\nWritten to his calendar. \"orion-reschedule undo\" puts it back."]);
        expect(text).toBe("Done: New CS Lab now 12:30 PM–1:15 PM; DS Lab 05 now 1:25 PM–2:10 PM.");
    });
    it("the rename script's line", () => {
        expect(spokenReply(["Changed Thursday 2026-11-05:\n  New CS Lab 12:30–13:15 is now \"CS Lab\" (same time)\nWritten to his calendar."])).toBe("Done: renamed New CS Lab to CS Lab.");
    });
    it("a line nothing knows is still reported, from the day read back", async () => {
        let step = 0;
        const days = [AUDIT_DAY, { ...AUDIT_DAY, blocks: AUDIT_DAY.blocks.map((b) => (b.title === "New CS Lab" ? { ...b, start: "12:30", end: "13:15" } : b)) }];
        const out = await runScheduleFlow({ message: "move new cs lab to 12:30", clock: "Thu 12:14", now: NOW,
            exec: async (a) => (a[0] === "show" ? { stdout: JSON.stringify(days[Math.min(step, 1)]), code: 0 } : (step = 1, { stdout: "Changed Thursday 2026-11-05:\n  a brand new kind of line nobody mapped\nWritten to his calendar.", code: 0 })),
            ask: async () => ({ steps: [{ do: "move", what: id(AUDIT_DAY, "New CS Lab"), to: "12:30" }] }) });
        const reply = out.outcome === "done" ? out.reply ?? spokenReply(out.outputs) : "";
        expect(reply).not.toMatch(/Nothing on your day changed/);
        expect(reply).toMatch(/New CS Lab moved from 1:00 PM–1:45 PM to 12:30 PM–1:15 PM/);
    });
});
describe("T5 replace X with Y is a rename in place", () => {
    const parts = (m) => readDayEdit(m, NOW)?.parts ?? [];
    it.each([
        ['Replace "New CS Lab" with "CS Lab" on the schedule', "new cs lab", "cs lab"],
        ["rename new cs lab to cs lab", "new cs lab", "cs lab"],
        ["replace the gym with yoga", "gym", "yoga"],
        ["rename my leetcode block to algorithms", "leetcode", "algorithms"],
        ["replace study block with reading please", "study", "reading"],
        ["can you rename gym to workout", "gym", "workout"],
    ])("%s", (say, name, to) => expect(parts(say)).toEqual([expect.objectContaining({ op: "rename", name, to })]));
    it("not a rename: a bedtime, an alarm, a time", () => {
        expect(parts("replace my alarm with 7")).not.toEqual([expect.objectContaining({ op: "rename" })]);
        expect(parts("change gym to 5")[0]).not.toMatchObject({ op: "rename" });
    });
    const world = (blocks) => {
        let day = { date: "2026-11-05", now: "12:14", blocks };
        const calls = [];
        const run = async (s, a) => {
            calls.push([s, ...a]);
            if (a[0] === "rename")
                day = { ...day, blocks: day.blocks.map((b) => (b.title === a[1] ? { ...b, title: a[2] } : b)) };
            return { stdout: "Changed Thursday:\n  done\nWritten to his calendar.", code: 0 };
        };
        return { calls, deps: { run, readDay: async () => day, readDayOn: async () => day, now: NOW, source: "chat", text: "", stateDir: undefined } };
    };
    it('Replace "New CS Lab" with "CS Lab" on the schedule: renamed, same time, said from the read-back', async () => {
        const w = world([B("New CS Lab", "12:30", "13:15", { made: true }), B("DS Lab 05", "13:20", "14:05")]);
        const out = await runDayEdit(readDayEdit('Replace "New CS Lab" with "CS Lab" on the schedule', NOW), w.deps);
        expect(w.calls).toEqual([["orion-reschedule", "rename", "New CS Lab", "CS Lab"]]);
        expect("reply" in out.flow && out.flow.reply).toBe("I renamed New CS Lab to CS Lab (it keeps 12:30–1:15 PM).");
    });
    it("Y already a block on the day: a swap", async () => {
        const w = world([B("New CS Lab", "12:30", "13:15"), B("DS Lab 05", "13:20", "14:05")]);
        await runDayEdit(readDayEdit("replace new cs lab with ds lab 05", NOW), w.deps);
        expect(w.calls[0].slice(0, 4)).toEqual(["orion-reschedule", "swap", "New CS Lab", "DS Lab 05"]);
    });
    it("replace DS Lab 05 with CS Lab when only New CS Lab resembles it: asked, nothing written", async () => {
        const w = world([B("DS Lab 05", "12:30", "13:15"), B("New CS Lab", "13:20", "14:05")]);
        const out = await runDayEdit(readDayEdit("replace DS Lab 05 with CS Lab", NOW), w.deps);
        expect(w.calls).toEqual([]);
        expect("text" in out.flow && out.flow.text).toMatch(/swapped with it, or renamed "CS Lab"/);
    });
    it("the form's rename step compiles, and a log that is a whole sentence is refused", async () => {
        const day = { date: "2026-11-05", now: "12:14", blocks: [B("New CS Lab", "12:30", "13:15", { made: true })] };
        const calls = [];
        const ok = await runScheduleFlow({ message: "call new cs lab just cs lab", clock: "Thu 12:14", now: NOW, exec: async (a) => { calls.push(a); return a[0] === "show" ? { stdout: JSON.stringify(day), code: 0 } : { stdout: "Changed", code: 0 }; }, ask: async () => ({ steps: [{ do: "rename", what: "B1", newTitle: "CS Lab" }] }) });
        expect(calls.find((c) => c[0] === "rename")).toEqual(["rename", "New CS Lab", "CS Lab"]);
        expect(ok.outcome).toBe("done");
        const log = await runScheduleFlow({ message: "replace new cs lab with cs lab", clock: "Thu 12:14", now: NOW, exec: async (a) => (a[0] === "show" ? { stdout: JSON.stringify(day), code: 0 } : { stdout: "Changed", code: 0 }), ask: async () => ({ steps: [{ do: "log", what: "Replace New CS Lab with CS Lab" }] }) });
        expect(JSON.stringify(log)).not.toMatch(/Since when/);
    });
});
void toMin;
