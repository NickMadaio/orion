// w18 bedtime (2026-11-04): a yes to ORION's "want me to shut things down" offer runs the shutdown instead of reaching the model, which on
// 11-03 22:09 answered "I'm shutting down your apps now so you can sleep." having called no tool at all. Held-out casual phrasings, the
// lookalikes that must not lock a Mac, and the routing end to end with a fake runner (nothing real is quit or locked).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readShutdownTurn, isShutdownOffer } from "./bedtime-shutdown-read.js";
import { argsFor, runShutdownTurn } from "./bedtime-shutdown-chat.js";
import { registerLocalRouting } from "./local-routing.js";
import { routeForDoomedExec } from "./exec-routing.js";
const OFFER = "It's 10:08 PM and you're still up, 7.7h of sleep left before 5:50 AM. Want me to shut things down so you actually go to bed?";
const offered = { offered: true, night: true, armed: false };
const night = { offered: false, night: true, armed: false };
const day = { offered: false, night: false, armed: false };
describe("isShutdownOffer", () => {
    it("knows the firm rung's offer in both wordings", () => {
        expect(isShutdownOffer(OFFER)).toBe(true);
        expect(isShutdownOffer("It's 12:01 AM and your lights are still on and you're on the Mac, so you're not winding down, with 6h of sleep left before 6:00 AM. Want me to shut things down so you actually go to bed?")).toBe(true);
        expect(isShutdownOffer("It's 12:16 AM and you're still up. Want me to shut it all down?")).toBe(true);
        expect(isShutdownOffer("Phone down and head to bed now and you still get 7.9h.")).toBe(false);
    });
});
describe("readShutdownTurn: yes to the offer", () => {
    it("any casual yes runs the shutdown", () => {
        for (const m of ["Fine. Yes.", "yeah do it", "ok sure", "yes pls", "ugh fine", "alright go ahead", "yup shut it down", "sure thing orion", "fr do it", "yes close everything", "yea ok lol"])
            expect(readShutdownTurn(m, offered), m).toEqual({ kind: "run" });
    });
    it("a no, a stall or a question of his own does not", () => {
        for (const m of ["no", "nah im good", "not yet", "wait 10 min", "dont", "yes but what time is my alarm", "later", "i need 20 more minutes", "what would you shut down?", "yeah my econ is due at 9"])
            expect(readShutdownTurn(m, offered), m).not.toEqual({ kind: "run" });
    });
    it("a bare yes with no offer behind it is never a shutdown", () => {
        for (const m of ["yes", "fine yes", "ok sure"])
            expect(readShutdownTurn(m, night), m).toBeNull();
    });
});
describe("readShutdownTurn: asking for it", () => {
    it("at night, shutting everything down runs it", () => {
        for (const m of ["shut it all down", "shut everything down pls", "yes close everything", "put my computer to bed", "put my mac to bed", "ok close everything and lock it", "lock it all down", "put the laptop to sleep for the night", "shut it all down orion"])
            expect(readShutdownTurn(m, night), m).toEqual({ kind: "run" });
    });
    it("in the middle of the day only the explicit bedtime phrasings count", () => {
        expect(readShutdownTurn("put my computer to bed", day)).toEqual({ kind: "run" });
        for (const m of ["shut it all down", "close everything", "yes close everything", "lock it all down"])
            expect(readShutdownTurn(m, day), m).toBeNull();
    });
    it("a bare 'shut it down' or 'close it' is too broad: it needs everything, all, the computer, or the offer behind it", () => {
        for (const m of ["shut it down", "close it", "lock it", "shut down", "quit it"])
            expect(readShutdownTurn(m, night), m).toBeNull();
        for (const m of ["shut my computer down", "close everything", "lock my mac", "shut the laptop down"])
            expect(readShutdownTurn(m, night), m).toEqual({ kind: "run" });
        expect(readShutdownTurn("shut it down", offered)).toEqual({ kind: "run" });
        expect(readShutdownTurn("close it", offered)).toEqual({ kind: "run" });
    });
    it("lookalikes never lock a Mac", () => {
        for (const m of ["put my kid to bed lol", "put the dog to bed", "i shut everything down at work", "close everything except chrome", "how do i put my mac to sleep", "shut the door", "dont shut it all down", "never close everything"])
            expect(readShutdownTurn(m, night), m).toBeNull();
    });
});
describe("readShutdownTurn: the pass and the override", () => {
    const armed = { offered: false, night: true, armed: true };
    it("a request for more time grants a pass, once the guard is armed", () => {
        expect(readShutdownTurn("i need 20 more minutes", armed)).toEqual({ kind: "pass", minutes: 20 });
        expect(readShutdownTurn("gimme 15 more min pls", armed)).toEqual({ kind: "pass", minutes: 15 });
        expect(readShutdownTurn("10 more mins", armed)).toEqual({ kind: "pass", minutes: 10 });
        expect(readShutdownTurn("give me half an hour", armed)).toEqual({ kind: "pass", minutes: 30 });
        expect(readShutdownTurn("can i get an hour more", armed)).toEqual({ kind: "pass", minutes: 60 });
        expect(readShutdownTurn("i need twenty more minutes to finish this", armed)).toEqual({ kind: "pass", minutes: 20 });
    });
    it("not armed, or daytime, it is not a pass", () => {
        expect(readShutdownTurn("i need 20 more minutes", night)).toBeNull();
        expect(readShutdownTurn("i need 20 more minutes", { ...armed, night: false })).toBeNull();
        expect(readShutdownTurn("i need 20 more minutes of sleep tbh", armed)).toBeNull();
    });
    it("the manual override and its undo", () => {
        for (const m of ["leave my computer alone tonight", "stop locking my mac", "dont lock my laptop again tonight", "let my mac be"])
            expect(readShutdownTurn(m, armed), m).toEqual({ kind: "override", on: true });
        for (const m of ["lock my mac again", "ok you can lock my computer again", "turn the bedtime lock back on"])
            expect(readShutdownTurn(m, armed), m).toEqual({ kind: "override", on: false });
    });
});
describe("runShutdownTurn", () => {
    const ok = (say, extra = {}) => ({ stdout: JSON.stringify({ ok: true, say, ...extra }), code: 0 });
    it("maps turns to commands", () => {
        expect(argsFor({ kind: "run" })).toEqual(["run", "--json"]);
        expect(argsFor({ kind: "pass", minutes: 20 })).toEqual(["pass", "20", "--json"]);
        expect(argsFor({ kind: "override", on: true })).toEqual(["override", "on", "--json"]);
        expect(argsFor({ kind: "override", on: false })).toEqual(["override", "off", "--json"]);
    });
    it("the reply is the script's own sentence", async () => {
        const out = await runShutdownTurn({ kind: "run" }, { run: async () => ok("Closed Safari. The Mac is locked.") });
        expect(out.text).toBe("Closed Safari. The Mac is locked.");
        expect(out.calls).toEqual(["orion-bedtime-shutdown run --json"]);
    });
    it("a failure never claims anything was shut down", async () => {
        const out = await runShutdownTurn({ kind: "run" }, { run: async () => { throw new Error("boom"); } });
        expect(out.text).toMatch(/couldn't shut.*nothing was closed or locked/i);
    });
});
function route(shutdownRun, { armed = false, push = false } = {}) {
    const d = mkdtempSync(join(tmpdir(), "shutdown-chat-"));
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const nudge = new Date(2026, 10, 3, 21, 30);
    writeFileSync(join(d, "wake-plan.json"), JSON.stringify({ source: "nick", bedtimes: [{ date: "2026-11-03", nudgeAtIso: nudge.toISOString() }] }));
    if (armed)
        writeFileSync(join(d, "bedtime-shutdown.json"), JSON.stringify({ armed: true, night: nudge.toISOString() }));
    if (push)
        writeFileSync(join(d, "outreach.jsonl"), `${JSON.stringify({ text: OFFER, at: new Date(2026, 10, 3, 22, 8).toISOString(), channel: "mac-voice" })}\n`);
    let clock = new Date(2026, 10, 3, 22, 9).getTime();
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 22:09", now: () => new Date(clock),
        decideImpl: async () => ({ move: "answer", answer: "DESK ANSWER" }), brainSearch: async () => "",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }),
        listReminders: async () => [], ...(shutdownRun ? { shutdownRun } : {}) });
    let n = 0;
    const sessionKey = `agent:main:orion-chat-shutdown-${d}`;
    return async (prompt) => {
        clock += 30_000;
        const ctx = { runId: `s-${n += 1}`, sessionKey };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        await fire("before_prompt_build", { prompt, messages: [] }, ctx);
        return direct?.reply?.text;
    };
}
const withOffer = (m) => `[ORION context: you messaged him first, 1 min ago: "${OFFER}". This message MAY be his answer.]\n${m}`;
describe("the routing", () => {
    it("the 11-03 22:09 exchange: Fine. Yes. runs the shutdown and says what it did, never reaching the model", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "Closed Safari and Discord. The Mac is locked." }), code: 0 }; });
        expect(await turn(withOffer("Fine. Yes."))).toBe("Closed Safari and Discord. The Mac is locked.");
        expect(calls).toEqual([["run", "--json"]]);
    });
    it("a no to the offer runs nothing", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: "{}", code: 1 }; });
        await turn(withOffer("nah not yet"));
        expect(calls).toEqual([]);
    });
    it("asking for it at night, and a pass once armed", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: `did ${a[0]}` }), code: 0 }; }, { armed: true });
        expect(await turn("put my computer to bed")).toBe("did run");
        expect(await turn("i need 20 more minutes")).toBe("did pass");
        expect(calls).toEqual([["run", "--json"], ["pass", "20", "--json"]]);
    });
    it("the offer is consumed once answered: a second ok does not shut down again", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "done" }), code: 0 }; });
        expect(await turn(withOffer("Fine. Yes."))).toBe("done");
        expect(await turn(withOffer("ok"))).not.toBe("done");
        expect(calls).toHaveLength(1);
    });
    it("a yes to an unrelated question later is not an answer to the offer, even inside 30 minutes", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "done" }), code: 0 }; }, { push: true });
        await turn("what time is my first class");
        expect(await turn("yeah ok")).not.toBe("done");
        expect(calls).toEqual([]);
    });
    it("a yes right after the offer, with no label, still answers it, once", async () => {
        const calls = [];
        const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "done" }), code: 0 }; }, { push: true });
        expect(await turn("yeah")).toBe("done");
        expect(await turn("ok")).not.toBe("done");
        expect(calls).toHaveLength(1);
    });
    it("with no runner wired the model path stays as it was", async () => {
        expect(await route(undefined)(withOffer("yes"))).not.toMatch(/locked/);
    });
});
describe("the exec route", () => {
    it("the shutdown wrapper is a known wrapper that wants its absolute path", () => {
        expect(routeForDoomedExec("orion-bedtime-shutdown run")?.reason).toMatch(/absolute path/);
    });
});
