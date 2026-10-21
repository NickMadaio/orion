// Edit follow-ups (live run 4 #10b, docs/audits/2026-10-20-live-as-nick.md: "make it an hour" restarted a focus session). Fixtures only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockTarget, editLength, parseEdit, SESSION_EDIT } from "./edit-followup.js";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, spokenReply } from "./schedule-flow.js";
import { startsSession } from "./session-flow.js";
describe("parseEdit", () => {
    it.each([
        ["make it an hour", { minutes: 60 }], ["make it 30", { minutes: 30 }], ["make it 45 min", { minutes: 45 }], ["actually make it an hour and a half", { minutes: 90 }],
        ["longer", { direction: "longer" }], ["shorter", { direction: "shorter" }], ["make it a bit longer", { direction: "longer" }], ["make it 15 min longer", { delta: 15 }],
        ["make it 10 minutes shorter", { delta: -10 }], ["ok make it an hour actually", { minutes: 60 }], ["make it an hour instead", { minutes: 60 }],
        ["actually make it 30", { minutes: 30 }], ["can u make it longer", { direction: "longer" }], ["can you make it shorter?", { direction: "shorter" }], ["add 20 min more", { delta: 20 }], ["ok make that 2 hours", { minutes: 120 }], ["change it to 30 min", { minutes: 30 }],
    ])("%j -> %j", (m, want) => { expect(parseEdit(m)).toEqual(want); });
    it.each(["make it 5:30", "actually make it 6pm", "no wait, change it to 6", "make it 5", "make it rain", "longer than that?", "make gym an hour after class", "it was longer"])("%j is not an edit", (m) => {
        expect(parseEdit(m)).toBeUndefined();
    });
    it("a desk-read start is never a session for an edit", () => {
        for (const m of ["make it an hour", "make it 30", "longer", "shorter", "ok make it an hour actually", "actually make it 30", "can u make it longer", "make it an hour instead"])
            expect(startsSession(m, { start: true }), m).toBe(false);
    });
    it("blockTarget reads the block a change wrote, its date and its length", () => {
        expect(blockTarget(["exec orion-reschedule add lunch 45 --at 13:00"], ["Changed:\n  planned lunch: 13:00–13:45"], 1)).toEqual({ kind: "block", title: "lunch", dateArgs: [], minutes: 45, start: "13:00", at: 1 });
        expect(blockTarget(['exec orion-reschedule add "econ homework" 120 --at 19:00 --date tomorrow'], ["planned econ homework: 19:00–21:00"], 1)).toMatchObject({ title: "econ homework", dateArgs: ["--date", "tomorrow"], minutes: 120 });
        expect(blockTarget(['exec orion-reschedule day --plan "Gym, 90, 13:20"'], ["planned Gym: 13:20–14:50"], 1)).toMatchObject({ title: "Gym", minutes: 90 });
        expect(blockTarget(["exec orion-reschedule late 30"], ["x"], 1)).toBeUndefined();
    });
    it("editLength: absolute, relative, or ask how much", () => {
        expect(editLength({ minutes: 60 }, 45)).toEqual({ minutes: 60 });
        expect(editLength({ delta: -10 }, 45)).toEqual({ minutes: 35 });
        expect(editLength({ direction: "longer" }, 45)).toEqual({ ask: "How much longer? It's 45 minutes now. I haven't changed anything." });
    });
});
const DAY = { date: "2030-10-21", now: "03:52", blocks: [
        { title: "CS1802 Seminar — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "lunch", start: "13:00", end: "13:45", fixed: false }
    ] };
const target = { kind: "block", title: "lunch", dateArgs: [], minutes: 45, start: "13:00", at: 1 };
async function edit(req, d = DAY, out = "Changed:\n  lunch is now 60 min: 13:00–14:00") {
    const writes = [];
    const result = await runScheduleFlow({ message: "make it an hour", clock: "x", now: new Date(2030, 9, 21, 3, 52), ask: async () => { throw new Error("no form"); }, edit: { target, req },
        exec: async (a) => { if (a[0] !== "show")
            writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(d) : out, code: 0 }; } });
    return { result, writes };
}
describe("the block is resized, read back from the day first", () => {
    it("make it an hour: resize lunch 60, same start", async () => {
        const { result, writes } = await edit({ minutes: 60 });
        expect(writes).toEqual([["resize", "lunch", "60"]]);
        expect(spokenReply(result.outputs)).toBe("Done: lunch is now 60 minutes, 1:00 PM–2:00 PM.");
    });
    it.each([
        [{ minutes: 45 }, DAY, "lunch is already 45 minutes (1:00 PM–1:45 PM), so nothing changed."],
        [{ minutes: 60 }, { ...DAY, blocks: DAY.blocks.slice(0, 1) }, "I can't find lunch on your day any more, so I haven't changed anything."],
        [{ direction: "longer" }, DAY, "How much longer? lunch is 45 minutes now. I haven't changed anything."],
        // the lunch that was written at 13:00 has since moved (by something else): not the one he means any more
        [{ minutes: 60 }, { ...DAY, blocks: [DAY.blocks[0], { title: "lunch", start: "14:00", end: "14:45", fixed: false }] }, "I can't find lunch on your day any more, so I haven't changed anything."],
        // two of that name: resize could hit the wrong one
        [{ minutes: 60 }, { ...DAY, blocks: [...DAY.blocks, { title: "lunch", start: "18:00", end: "18:30", fixed: false }] }, "There are 2 lunch blocks on your day (1:00 PM–1:45 PM, 6:00 PM–6:30 PM), so I haven't changed either. Which one should change?"],
    ])("%j says so and writes nothing", async (req, d, text) => {
        const { result, writes } = await edit(req, d);
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", text });
    });
});
describe("through the hooks: run 4's two turns, and a session that was just started", () => {
    function rig() {
        const handlers = new Map();
        const sessions = [];
        const scheds = [];
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "edit-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Wed 03:52", now: () => new Date(2030, 9, 21, 3, 52),
            // the desk reads a session start for EVERY turn: the worst case
            decideImpl: async () => ({ move: "tool", tool: "session", args: { do: "start", task: "lunch", minutes: "45" } }),
            sessionFlow: async (m) => { sessions.push(m); return { outcome: "done", reply: "Your focus session is running: 25 minutes.", calls: ["exec orion-session start resume --minutes 25 --json"], outputs: ["ok"] }; },
            scheduleFlow: async (m, _c, o) => {
                scheds.push({ m, ...(o?.edit ? { edit: o.edit } : {}) });
                return o?.edit ? { outcome: "done", calls: ["exec orion-reschedule resize lunch 60"], outputs: ["Changed:\n  lunch is now 60 min: 13:00–14:00"] }
                    : { outcome: "done", calls: ["exec orion-reschedule add lunch 45 --at 13:00"], outputs: ["Changed:\n  planned lunch: 13:00–13:45"] };
            } });
        const turn = async (m, id) => {
            const c = { runId: id, sessionKey: "agent:main:orion-chat-edit" };
            for (const f of handlers.get("before_model_resolve") ?? [])
                await f({ prompt: m }, c);
            const built = await Promise.all((handlers.get("before_prompt_build") ?? []).map((f) => f({ prompt: m, messages: [] }, c)));
            for (const f of handlers.get("before_agent_finalize") ?? [])
                await f({ sessionId: "s", lastAssistantMessage: "ok", model: "m", messages: [] }, c);
            return built.find(Boolean)?.systemPrompt ?? "";
        };
        const fire = async (n, e, c) => { for (const f of handlers.get(n) ?? [])
            await f(e, c); };
        return { turn, sessions, scheds, fire };
    }
    it("'lunch 45 min today at 1pm' then 'make it an hour': the lunch block is resized; no session, ever", async () => {
        const r = rig();
        await r.turn("lunch 45 min today at 1pm", "a");
        await r.turn("make it an hour", "b");
        expect(r.sessions).toEqual([]);
        expect(r.scheds).toEqual([{ m: "lunch 45 min today at 1pm" }, { m: "make it an hour", edit: { target: expect.objectContaining({ kind: "block", title: "lunch", minutes: 45 }), req: { minutes: 60 } } }]);
    });
    it("with nothing made here, 'make it an hour' is asked in code: no worker, no schedule flow, no session", async () => {
        const r = rig();
        const said = await r.turn("make it an hour", "n1");
        expect(said).toContain("Which one should I make an hour? I haven't changed anything.");
        expect(r.scheds).toEqual([]);
        expect(r.sessions).toEqual([]);
    });
    it("control: a turn in between with no write leaves the lunch the target", async () => {
        const r = rig();
        await r.turn("lunch 45 min today at 1pm", "a");
        const c = { runId: "w0", sessionKey: "agent:main:orion-chat-edit" };
        await r.fire("before_model_resolve", { prompt: "thanks" }, c);
        await r.fire("after_tool_call", { toolName: "exec", params: { command: "/x/scripts/orion-agenda today" }, result: "today" }, c);
        await r.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok", model: "m", messages: [] }, c);
        await r.turn("make it an hour", "b");
        expect(r.scheds.filter((x) => "edit" in x)).toHaveLength(1);
    });
    it.each([
        ["a worker add", { toolName: "exec", params: { command: "bash -lc '/x/scripts/orion-reschedule add gym 60 --at 18:00'" }, result: "Changed:\n  planned gym: 18:00–19:00" }],
        ["a worker undo", { toolName: "exec", params: { command: "/x/scripts/orion-reschedule undo" }, result: "Undone: removed lunch." }],
        ["a worker late move", { toolName: "exec", params: { command: "/x/scripts/orion-reschedule late 20" }, result: "Changed:\n  moved lunch: 13:00 → 13:20" }],
        ["a session the worker started", { toolName: "exec", params: { command: "/x/scripts/orion-session start reading --minutes 25" }, result: "ok" }],
    ])("after %s, the lunch block is no longer the target: asked, not resized", async (_l, call) => {
        const r = rig();
        await r.turn("lunch 45 min today at 1pm", "a");
        // a turn in between where the worker ran the write itself
        const c = { runId: "w", sessionKey: "agent:main:orion-chat-edit" };
        await r.fire("before_model_resolve", { prompt: "do the other thing" }, c);
        await r.fire("after_tool_call", call, c);
        await r.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok", model: "m", messages: [] }, c);
        const said = await r.turn("make it an hour", "b");
        expect(said).toContain("Which one should I make an hour?");
        expect(r.scheds.filter((x) => "edit" in x)).toEqual([]);
    });
    it("a session ORION just started: 'make it an hour' leaves it running and says why; it is not restarted", async () => {
        const r = rig();
        await r.turn("lets get to work on the resume", "s1");
        const said = await r.turn("make it an hour", "s2");
        expect(r.sessions).toEqual(["lets get to work on the resume"]);
        expect(said).toContain(SESSION_EDIT("resume"));
    });
});
