// Wave 4 review, finding 1 (MUST): "i need a break" with nothing running started a 50-minute focus block (DND plus app blocking).
// A break moves a running or paused block only; it never finishes one; nothing starts unless he asked for a restart and the turn may
// start (typed, or addressed to ORION). A break from a person, a class or a relationship, an idiom, or "we" is not a break move.
// Phrasings are held out of scripts/eval/gate/scenarios.
import { describe, expect, it } from "vitest";
import { readBreak, runBreak } from "./break-intent.js";
const NOW = new Date(2026, 10, 2, 10, 0);
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
function session(initial) {
    const calls = [];
    const exec = async (args) => {
        calls.push(args);
        if (args[0] === "status")
            return { stdout: json(initial), code: 0 };
        if (args[0] === "start")
            return { stdout: json({ ok: true, status: "running", phase: "rest", task: args[1], remainingSeconds: 600 }), code: 0 };
        if (args[0] === "pause")
            return { stdout: json({ ok: true, status: "paused", task: initial.task }), code: 0 };
        return { stdout: json({ ok: true, status: "finished" }), code: 0 };
    };
    return { exec, calls };
}
const NOTHING = [{ ok: true, status: "none" }, { ok: true, status: "finished", phase: "abandoned", task: "econ" }, { ok: true, status: "idle" }];
describe("not a break move", () => {
    it.each([
        "i need a break from this class",
        "i need a break from him",
        "honestly i need a break from my roommate",
        "we need a break",
        "i think we should take a break",
        "maybe we should go on a break",
        "give me a break",
        "oh come on gimme a break",
        "can i get a break from you people",
        "i want a break from this relationship",
    ])("%s", (said) => {
        expect(readBreak(said)).toBeNull();
    });
    it.each(["i need a break from studying", "taking a break from this essay", "need a break from work for 15 min", "gimme a 10 min break", "can i take a break"])("still a break: %s", (said) => {
        expect(readBreak(said)?.kind).toBe("break");
    });
});
describe("nothing running: the alarm-only reply, nothing started", () => {
    it.each(NOTHING)("vague break, status %o", async (state) => {
        const s = session(state);
        const out = await runBreak(readBreak("i need a break"), { exec: s.exec, now: NOW, mayStart: true });
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
        expect(out.flow).toBeUndefined();
        expect(out.reminder?.at).toBe("2026-11-02T10:10");
        expect(out.reminder?.say).toMatch(/^Break till 10:10 AM/);
        expect(out.reminder?.say).not.toMatch(/couldn't read|focus block starts|starts again/i);
    });
    it("an explicit restart may start the break-then-block sequence only when the turn may start", async () => {
        const said = readBreak("take a 10 min break then restart the session");
        const room = session(NOTHING[1]);
        const heard = await runBreak(said, { exec: room.exec, now: NOW, mayStart: false });
        expect(room.calls.some((c) => c[0] === "start")).toBe(false);
        expect(heard.reminder).toBeDefined();
        const typed = session(NOTHING[1]);
        await runBreak(said, { exec: typed.exec, now: NOW, mayStart: true });
        expect(typed.calls.map((c) => c[0])).toEqual(["status", "start"]);
    });
    it("mayStart missing is not permission", async () => {
        const s = session(NOTHING[1]);
        await runBreak(readBreak("take a 10 min break then restart the session"), { exec: s.exec, now: NOW });
        expect(s.calls.some((c) => c[0] === "start")).toBe(false);
    });
});
describe("a running or paused block is paused, never finished", () => {
    it.each(["i need a break", "take a 10 min break then restart the session"])("running, no break planned after it: %s", async (said) => {
        const s = session({ ok: true, status: "running", phase: "focus", task: "econ", remainingSeconds: 1200 });
        const refuse = async (args) => (args[0] === "break" ? { stdout: "orion-session: No break is planned after this block.", code: 1 } : s.exec(args));
        const out = await runBreak(readBreak(said), { exec: refuse, now: NOW, mayStart: true });
        expect(s.calls.map((c) => c[0])).toEqual(["status", "pause"]);
        expect(s.calls.some((c) => c[0] === "finish" || c[0] === "abandon")).toBe(false);
        expect(out.reminder?.say).toMatch(/^Paused econ with 20 minutes left\. Break till 10:10 AM/);
        expect(out.reminder?.say).toMatch(/resume/);
    });
    it("paused: left as it is, the return nudge set", async () => {
        const s = session({ ok: true, status: "paused", task: "econ" });
        const out = await runBreak(readBreak("need a 15 min break"), { exec: s.exec, now: NOW, mayStart: true });
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
        expect(out.reminder?.say).toMatch(/^econ is already paused\. Break till 10:15 AM/);
    });
    it("a pause that fails says so and sets nothing", async () => {
        const s = session({ ok: true, status: "running", phase: "focus", task: "econ", remainingSeconds: 1200 });
        const exec = async (args) => (args[0] === "pause" || args[0] === "break" ? { stdout: "orion-session: Orion is not running", code: 3 } : s.exec(args));
        const out = await runBreak(readBreak("i need a break"), { exec, now: NOW, mayStart: true });
        expect(out.reminder).toBeUndefined();
        expect(JSON.stringify(out.flow)).toMatch(/couldn't pause econ/);
    });
});
