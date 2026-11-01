// Wave 6 B (gate run-1101003318, foc-doomscroll-v), orchestrator decision: "im on tiktok instead of studying" with a study or work
// block current on his calendar restarts a focus session for that block, said in one line; with none current, 25 minutes is offered.
import { describe, expect, it } from "vitest";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
const NOW = new Date(2026, 10, 2, 10, 0);
const IDLE = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned" })}\n`;
const RUNNING = `${JSON.stringify({ ok: true, status: "running", phase: "focus", task: "econ", remainingSeconds: 1500 })}\n`;
function session(initial) {
    const calls = [];
    const exec = async (args) => {
        calls.push(args);
        if (args[0] === "status")
            return { stdout: initial, code: 0 };
        if (args[0] === "start")
            return { stdout: `${JSON.stringify({ ok: true, status: "running", phase: "focus", task: args[1], remainingSeconds: 3600 })}\n`, code: 0 };
        return { stdout: `${JSON.stringify({ ok: true, status: "finished" })}\n`, code: 0 };
    };
    return { exec, calls };
}
const day = (blocks) => ({ date: "2026-11-02", now: "10:00", blocks });
const STUDY = { title: "Econ problem set", start: "09:30", end: "11:00", fixed: false, kind: "study" };
describe("doomscroll with a work block current: the session restarts for it", () => {
    it.each(["im on tiktok instead of studying", "been scrolling on insta for like 20 min instead of doing my pset", "ugh i keep watching youtube instead of working"])("%s", async (said) => {
        const move = readFocusMove(said);
        expect(move?.kind).toBe("doomscroll");
        const s = session(IDLE);
        const out = await runFocusMove(move, { exec: s.exec, now: NOW, readDay: async () => day([STUDY, { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }]) });
        expect(s.calls.find((c) => c[0] === "start")).toEqual(["start", "Econ problem set", "--until", "11:00", "--json"]);
        expect(out.flow?.outcome).toBe("done");
        const reply = out.flow.reply;
        expect(reply).toMatch(/Econ problem set/);
        expect(reply).toMatch(/11:00 AM/);
        expect(reply.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
        expect(out.pendingSession).toBeUndefined();
    });
});
describe("doomscroll with nothing current: 25 minutes is offered, nothing started", () => {
    it("only gym and a later class on the day", async () => {
        const s = session(IDLE);
        const out = await runFocusMove(readFocusMove("im on tiktok instead of studying"), { exec: s.exec, now: NOW, readDay: async () => day([{ title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" }, { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }]) });
        expect(s.calls.some((c) => c[0] === "start")).toBe(false);
        expect(out.pendingSession).toMatch(/25 min/);
    });
    it("a current gym or meal block is not work", async () => {
        const s = session(IDLE);
        await runFocusMove(readFocusMove("im on tiktok instead of studying"), { exec: s.exec, now: NOW, readDay: async () => day([{ title: "Lunch", start: "09:45", end: "10:30", fixed: false, kind: "meal" }]) });
        expect(s.calls.some((c) => c[0] === "start")).toBe(false);
    });
    it("a running session is not restarted", async () => {
        const s = session(RUNNING);
        const out = await runFocusMove(readFocusMove("im on tiktok instead of studying"), { exec: s.exec, now: NOW, readDay: async () => day([STUDY]) });
        expect(s.calls.some((c) => c[0] === "start")).toBe(false);
        expect(out.flow.text).toMatch(/still running/);
    });
});
