// Wave 4, focus (gate run-1031202318 cluster 2): replies come from the session's real output, a break starts nothing, a confession nudges.
import { describe, expect, it } from "vitest";
import { readBreak, runBreak } from "./break-intent.js";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
import { parseSessionJson } from "./session-json.js";
const NOW = new Date(2026, 10, 2, 10, 0);
/** What the real script prints: a plain line first for a sequence, then indented multi-line JSON. */
const pretty = (o, prefix = "") => `${prefix}${JSON.stringify(o, null, 2)}\n`;
const IDLE = pretty({ ok: true, status: "finished", phase: "abandoned" });
const FOCUS = pretty({ ok: true, status: "running", phase: "focus", task: "econ", remainingSeconds: 1200 });
function session(initial, over = {}) {
    const calls = [];
    const exec = async (args) => {
        calls.push(args);
        const cmd = args[0];
        if (over[cmd])
            return over[cmd];
        if (cmd === "status")
            return { stdout: initial, code: 0 };
        if (cmd === "start")
            return { stdout: pretty({ ok: true, status: "running", phase: "rest", task: args[1], remainingSeconds: 600 }, "Sequence: 10 min break, 50 min work\n"), code: 0 };
        return { stdout: pretty({ ok: true, status: cmd === "pause" ? "paused" : "finished" }), code: 0 };
    };
    return { exec, calls };
}
describe("parseSessionJson", () => {
    it("reads indented JSON behind a plain line, and plain JSON", () => {
        expect(parseSessionJson(pretty({ ok: true, status: "running" }, "Sequence: 10 min break\n"))).toMatchObject({ status: "running" });
        expect(parseSessionJson('{"ok":true,"status":"paused"}')).toMatchObject({ status: "paused" });
        expect(parseSessionJson("orion-session: Orion is not running")).toBeNull();
    });
});
describe("readBreak (held-out phrasings)", () => {
    it.each([["ugh i need a break", 10, true], ["gonna grab a 15 min break", 15, false], ["can i have a quick break pls", 10, true], ["need like a half hour break", 30, false], ["taking a 20 minute break", 20, false], ["brain is fried need a five minute break", 5, false]])("%s", (said, minutes, assumed) => {
        expect(readBreak(said)).toMatchObject({ minutes, assumed, restart: false });
    });
    it.each(["take a 10 min break then restart the session", "need a break and then back to it", "taking 15 then resume after"])("restart asked: %s", (said) => {
        expect(readBreak(said.replace("taking 15", "taking a 15 min break"))?.restart).toBe(true);
    });
    it.each(["when is my next break", "i dont need a break", "break down this problem set for me", "lunch break at 1", "whats the break between classes"])("not a break: %s", (said) => {
        expect(readBreak(said)).toBeNull();
    });
});
// Gate run-1101020721 foc-pomodoro-break-v: a vague break handed the return alarm to the worker, which said "tomorrow" and never
// resumed the block. Now code runs it all: a break timer that hands back to the block by itself, said from the session's result.
describe("a vague break is a timed break that hands back to the block", () => {
    it.each(["need a break", "ok i need a quick break lol", "lemme grab a break", "can i take a break"])("just-ended session: %s", async (said) => {
        const s = session(pretty({ ok: true, status: "finished", phase: "abandoned", task: "econ" }));
        const out = await runBreak(readBreak(said), { exec: s.exec, now: NOW });
        expect(s.calls.map((c) => c[0])).toEqual(["status", "start"]);
        expect(s.calls[1]).toEqual(["start", "econ", "--sequence", "10 break, 50 work", "--json"]);
        expect(out.reminder).toBeUndefined();
        expect(out.flow).toMatchObject({ outcome: "done" });
        const reply = out.flow.reply;
        expect(reply).toMatch(/^Break till 10:10 AM \(10 minutes is my default[^)]*\)\. Then econ starts again by itself, 50 minutes\./);
        expect(reply).toMatch(/stop the session/);
        expect(reply).not.toMatch(/tomorrow/);
    });
    it("a running block is ended (its focus time kept), then the break hands back to it", async () => {
        const s = session(FOCUS);
        const out = await runBreak(readBreak("taking a 15 min break"), { exec: s.exec, now: NOW });
        expect(s.calls.map((c) => c[0])).toEqual(["status", "finish", "start"]);
        expect(out.flow.reply).toMatch(/^Break till 10:15 AM\. Then econ starts again by itself, 50 minutes\./);
    });
    it("nothing known about the block: the break still hands back to a focus block, named honestly", async () => {
        const s = session(IDLE);
        const out = await runBreak(readBreak("need a break"), { exec: s.exec, now: NOW });
        expect(s.calls[1]).toEqual(["start", "Focus", "--sequence", "10 break, 50 work", "--json"]);
        expect(out.flow.reply).toMatch(/Then a 50-minute focus block starts by itself/);
    });
    it("already on a break: said from the status, nothing changed", async () => {
        const s = session(pretty({ ok: true, status: "running", phase: "rest", remainingSeconds: 300 }));
        const out = await runBreak(readBreak("need a break"), { exec: s.exec, now: NOW });
        expect(JSON.stringify(out.flow)).toMatch(/already on a break: 5 minutes left/);
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    });
    it("status unreadable: does not touch the session or claim its state; only the return nudge", async () => {
        const s = session("", { status: { stdout: "orion-session: Orion is not running", code: 3 } });
        const out = await runBreak(readBreak("need a break"), { exec: s.exec, now: NOW });
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
        expect(out.reminder?.say).toMatch(/^I couldn't read your focus session just now, so I haven't touched it\./);
        expect(out.reminder?.say).not.toMatch(/nothing is running/i);
    });
});
describe("a restart he asked for", () => {
    it("real (pretty) output with a plain first line is read: the reply is the success, not 'nothing is running'", async () => {
        const s = session(FOCUS);
        const out = await runFocusMove(readFocusMove("take a 10 min break then restart the session"), { exec: s.exec, now: NOW });
        expect(s.calls.map((c) => c[0])).toEqual(["status", "finish", "start"]);
        expect(out.flow).toMatchObject({ outcome: "done" });
        expect(out.flow.reply).toBe("Break till 10:10 AM. Then econ starts again by itself, 50 minutes. Say \"stop the session\" if you're done for now.");
    });
    it("a start that fails is checked against the session before anything is claimed", async () => {
        const s = session(IDLE, { start: { stdout: "orion-session: Orion is not running", code: 3 } });
        const out = await runFocusMove(readFocusMove("take a 10 min break then restart the session"), { exec: s.exec, now: NOW, task: "econ" });
        expect(s.calls.map((c) => c[0])).toEqual(["status", "start", "status"]);
        expect(JSON.stringify(out.flow)).toMatch(/The break timer didn't start\. No session is running now\./);
    });
});
describe("a distraction confession nudges, it does not start", () => {
    it.each(["been scrolling reels for an hour when i should be studying", "i keep going on youtube instead of working", "im on instagram again"])("running session: %s", async (said) => {
        const s = session(FOCUS);
        const move = readFocusMove(said);
        expect(move.kind).toBe("doomscroll");
        const out = await runFocusMove(move, { exec: s.exec, now: NOW });
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
        expect(JSON.stringify(out.flow)).toMatch(/Your econ session is still running, 20 minutes left\. Put \w+ down/);
    });
    it("nothing running: says so from the status, nudges to the block, offers (never starts)", async () => {
        const s = session(IDLE);
        const out = await runFocusMove(readFocusMove("im on tiktok instead of studying"), { exec: s.exec, now: NOW, task: "CS2100 problem set" });
        expect(s.calls.map((c) => c[0])).toEqual(["status"]);
        expect(out.pendingSession).toBe("start a 25 min focus session on CS2100 problem set");
        expect(JSON.stringify(out.flow)).toMatch(/Put tiktok down and get back to CS2100 problem set\. No focus session is running right now/);
    });
    it("status unreadable: only the nudge, no claim about the session", async () => {
        const s = session("", { status: { stdout: "orion-session: Orion is not running", code: 3 } });
        const out = await runFocusMove(readFocusMove("im on tiktok instead of studying"), { exec: s.exec, now: NOW });
        expect(out.flow).toMatchObject({ text: "Put tiktok down and get back to your block." });
    });
});
