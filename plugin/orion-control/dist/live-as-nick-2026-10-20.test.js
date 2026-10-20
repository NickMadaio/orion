// 2026-10-20 live test as Nick (docs/audits/2026-10-20-live-as-nick.md): every phrase below is the one he typed. Fixtures only: stub scheduler, no model.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReplanRequest, parseReorder, planDayReplan, replanReply } from "./day-replan.js";
const parseReorderFor = parseReorder;
import { runScheduleFlow } from "./schedule-flow.js";
import { registerLocalRouting } from "./local-routing.js";
// 20:55: CS Lab 9:00-11:15 AM and "finish resume" 5:50-7:20 PM are over, Gym 8:15-9:45 PM is under way (90 min, a must).
const day = (now = "20:55") => ({ date: "2030-10-03", now, plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
        { title: "CS Lab", start: "09:00", end: "11:15", fixed: false, kind: "study" },
        { title: "ECON1115 Principles of Macroeconomics — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
        { title: "MKTG2201 Introduction to Marketing — Lecture", start: "15:30", end: "17:00", fixed: true, kind: "class" },
        { title: "finish resume", start: "17:50", end: "19:20", fixed: false, kind: "study" },
        { title: "Gym", start: "20:15", end: "21:45", fixed: false, kind: "gym" },
    ] });
const plan = (message, context) => planDayReplan(message, day(), context);
describe("1. 'put cs lab from now until ten thirty' while the Gym is under way", () => {
    const run = async (stdout) => {
        const calls = [];
        const result = await runScheduleFlow({ message: "put cs lab from now until ten thirty", clock: "Wed 20:55", now: new Date(2030, 9, 3, 20, 55),
            exec: async (args) => { calls.push(args); return { stdout: args[0] === "show" ? JSON.stringify(day()) : stdout, code: 0 }; }, ask: async () => { throw new Error("no form"); } });
        return { result, calls };
    };
    it("starts at now and runs to 22:30, as a second session", async () => {
        const { calls } = await run("Changed Thursday 2030-10-03:\n  planned CS Lab: 20:55–22:30\n  moved Gym: 20:15 → 22:35");
        expect(calls.find((c) => c[0] === "add")).toEqual(["add", "CS Lab", "95", "--at", "20:55", "--again"]);
    });
    it("says the earlier CS Lab is already over", async () => {
        const { result } = await run("Changed Thursday 2030-10-03:\n  planned CS Lab: 20:55–22:30");
        expect(result).toMatchObject({ outcome: "done", reply: expect.stringContaining("Your earlier CS Lab (9:00 AM–11:15 AM) is already over, so this is a second one.") });
    });
    it("a Gym that cannot fit after it is never cut: refused, with the reason and a question", async () => {
        const { result } = await run("NOTHING WAS CHANGED: must-haves could not fit: Gym.\n  MUST-HAVE NOT BOOKED: Gym (90 min) did not fit on Thursday");
        expect(result).toMatchObject({ outcome: "say", text: expect.stringMatching(/Gym didn't fit.*won't cut it short.*nothing was changed/i) });
    });
});
describe("2. 'can u redo my evening, gym first then resume' when finish resume is already over", () => {
    const message = "can u redo my evening, gym first then resume";
    it("plans the rest (gym first), leaves the finished resume out", () => {
        const p = plan(message);
        expect(p.args).toEqual(["day", "--plan", "Gym, 90, 20:55"]);
    });
    it("says plainly that resume was 5:50-7:20 PM, already done, and offers another after gym; no 'extend'", () => {
        const p = plan(message);
        const after = { ...day(), blocks: [...day().blocks.slice(0, 4), { title: "Gym", start: "20:55", end: "22:25", fixed: false, kind: "gym" }] };
        const reply = replanReply(after, p, ["Changed:\n  moved Gym: 20:15 → 20:55"]);
        expect(reply).toContain("Finish resume was 5:50–7:20 PM, already done?");
        expect(reply).toContain('Say "add finish resume after Gym" if you want another one');
        expect(reply).not.toMatch(/extend/i);
    });
    it("with nothing else to plan it only says so and changes nothing", () => {
        expect(plan("redo my evening, resume first")).toMatchObject({ say: "ask", text: expect.stringMatching(/finish resume was 5:50–7:20 PM, already done\? I haven't changed anything/) });
    });
});
describe("3. 'actually do resume before gym' reorders the last request", () => {
    const last = { order: ["gym", "resume"], home: false, explicit: true };
    it("books resume (again) first, then the gym at its 90 minutes, from the same start", () => {
        const p = plan("actually do resume before gym", last);
        expect(p.args).toEqual(["day", "--plan", "finish resume, 90, 20:55", "--plan", "Gym, 90, 22:30", "--again"]);
    });
    it("--again only when a named item is really already over", () => {
        const upcoming = { ...day("16:00"), blocks: day("16:00").blocks.filter((b) => b.title !== "Gym").concat([{ title: "Gym", start: "20:15", end: "21:45", fixed: false, kind: "gym" }]) };
        const p = planDayReplan("actually do resume before gym", upcoming, last);
        expect(p.args).not.toContain("--again"); // finish resume ended at 19:20 but it is only 16:00: it is not over
    });
    it.each(["dinner then gym", "ok dinner then gym", "nah dinner before gym", "actually do dinner before gym", "put dinner first, then gym"])("%j names something the request did not: the normal path, never a rewrite", (m) => {
        expect(plan(m, last)).toBeUndefined();
        expect(parseReorderFor(m, last)).toBeUndefined();
    });
    it("without a request on record it is not read at all", () => {
        expect(plan("actually do resume before gym")).toBeUndefined();
    });
    it.each(["actually do resume before gym?", "actually nah, resume before gym maybe", "she said do resume before gym"])("%j is not a reorder", (m) => {
        expect(plan(m, last)).toBeUndefined();
    });
    it("an undo, or any other write, forgets the request: the follow-up is no longer code's", async () => {
        for (const forget of ["undo", "another change"]) {
            let desk = 0;
            const handlers = new Map();
            const api = { on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) };
            registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lan-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 20:55",
                decideImpl: async () => { desk += 1; return { move: "escalate" }; },
                scheduleFlow: async (m) => (/reschedule/.test(m) ? { outcome: "done", calls: ["x"], outputs: ["y"], reply: "Done.", replan: { order: ["gym", "resume"], home: false, explicit: true } } : /move gym/.test(m) ? { outcome: "done", calls: ["x"], outputs: ["y"], reply: "Moved.", marks: ["m1"] } : { outcome: "fallback", reason: "x" }),
                lateFlow: async () => ({ outcome: "done", calls: ["x"], outputs: ["y"], reply: "Moved." }) });
            const fire = async (n, e, c) => { for (const f of handlers.get(n) ?? [])
                await f(e, c); };
            const sk = `agent:main:orion-chat-${forget}`;
            const c1 = { runId: `a${forget}`, sessionKey: sk };
            await fire("before_model_resolve", { prompt: "reschedule the rest of my day, gym first then resume" }, c1);
            await fire("before_prompt_build", { prompt: "reschedule the rest of my day, gym first then resume", messages: [] }, c1);
            await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done.", model: "m", messages: [] }, c1);
            if (forget === "undo") { // a later turn of his: "undo that", which the worker runs as orion-reschedule undo
                const cu = { runId: "bundo", sessionKey: sk };
                await fire("before_model_resolve", { prompt: "undo that" }, cu);
                await fire("after_tool_call", { toolName: "exec", params: { command: "/scripts/orion-reschedule undo" }, result: "Undone: put Gym back." }, cu);
                await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Undone.", model: "m", messages: [] }, cu);
                desk = 0;
            }
            else {
                const c = { runId: "bmove", sessionKey: sk };
                await fire("before_model_resolve", { prompt: "move gym to 8" }, c);
                await fire("before_prompt_build", { prompt: "move gym to 8", messages: [] }, c);
                await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok", model: "m", messages: [] }, c);
                desk = 0;
            }
            const c2 = { runId: `b${forget}`, sessionKey: sk };
            await fire("before_model_resolve", { prompt: "actually do resume before gym" }, c2);
            expect(desk).toBe(1); // the desk is asked again: not code-first
        }
    });
    it("end to end: the first turn is remembered, the follow-up skips the desk and carries the context", async () => {
        const contexts = [];
        let desk = 0;
        const handlers = new Map();
        const api = { on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lan-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 20:55",
            decideImpl: async () => { desk += 1; return { move: "tool", tool: "session", args: { do: "resume" } }; },
            scheduleFlow: async (_m, _c, o) => { contexts.push(o?.replanContext); return { outcome: "done", calls: ["x"], outputs: ["y"], reply: "Done.", replan: { order: ["gym", "resume"], home: false, explicit: true } }; } });
        const fire = async (n, e, c) => { for (const f of handlers.get(n) ?? [])
            await f(e, c); };
        const c1 = { runId: "a", sessionKey: "agent:main:orion-chat-x" };
        const c2 = { runId: "b", sessionKey: "agent:main:orion-chat-x" };
        await fire("before_model_resolve", { prompt: "reschedule the rest of my day, gym first" }, c1);
        await fire("before_prompt_build", { prompt: "reschedule the rest of my day, gym first", messages: [] }, c1);
        await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done.", model: "m", messages: [] }, c1);
        expect(desk).toBe(0);
        await fire("before_model_resolve", { prompt: "actually do resume before gym" }, c2);
        await fire("before_prompt_build", { prompt: "actually do resume before gym", messages: [] }, c2);
        expect(desk).toBe(0); // the desk read "resume" as a focus-session resume last time: it is not asked
        expect(contexts).toEqual([undefined, { order: ["gym", "resume"], home: false, explicit: true }]);
    });
});
describe("4. typos and run-ons are still requests; the allow-list rules are unchanged", () => {
    it("his exact sentence", () => {
        expect(parseReplanRequest("ok so reschedule my day and put gym frist then whatevers left by priorty, im kinda tired tho")).toMatchObject({ order: ["gym"], home: false, explicit: true });
        expect(plan("ok so reschedule my day and put gym frist then whatevers left by priorty, im kinda tired tho").args).toEqual(["day", "--plan", "Gym, 90, 20:55"]);
    });
    it.each([
        ["resched my day gim first", ["gym"]],
        ["reschdule my evening, gim first", ["gym"]],
        ["can u rescheudle my evening gym first then resume", ["gym", "resume"]],
        ["replan my evening gym first", ["gym"]],
        ["pls reschedual my day gym frist", ["gym"]],
    ])("%j", (m, order) => { expect(parseReplanRequest(m)?.order).toEqual(order); });
    it.each([
        "resched my day gim first lol",
        "reschdule my day, gym first, nvm",
        "i resched my day gim first",
        "should i resched my day gim first",
        "resched my day? gym first",
        "she said resched my day, gym first",
        "resched my day, gim frist, nvrmind",
        "resched my day, gim frist lmaoo",
        "resched my day, gim frist, my coach sayd",
        "reschedule my day, gym first, i dunno",
        "reschedule my day, gym first or whatever, idc",
        "reschedule my day, gym first nevermnd",
        "reschedule my day, gym first, nvm",
        "reschedule my day, gym first lol",
        "reschedule my day, gym first, whatever",
    ])("%j still fires nothing", (m) => { expect(parseReplanRequest(m)).toBeUndefined(); });
});
describe("5. a block that is not on his day is said to be missing", () => {
    it("'reschedule the rest of my day, put piano practice first'", () => {
        expect(plan("reschedule the rest of my day, put piano practice first")).toMatchObject({ say: "ask", text: expect.stringMatching(/^Piano practice isn't on your day, so I haven't changed anything\. How many minutes/) });
    });
    it("through the whole hook, with the real flow: the prompt is the exact line, nothing is written", async () => {
        const writes = [];
        const flow = (m, c, o) => runScheduleFlow({ message: m, clock: c, now: new Date(2030, 9, 3, 20, 55), ...(o ?? {}),
            exec: async (args) => { if (args[0] !== "show")
                writes.push(args); return { stdout: JSON.stringify(day()), code: 0 }; }, ask: async () => null });
        const handlers = new Map();
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lan-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 20:55",
            decideImpl: async () => ({ move: "escalate" }), scheduleFlow: flow });
        const c = { runId: "p", sessionKey: "agent:main:orion-chat-p" };
        const message = "reschedule the rest of my day, put piano practice first";
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: message }, c);
        const [built] = await Promise.all((handlers.get("before_prompt_build") ?? []).map((f) => f({ prompt: message, messages: [] }, c)));
        expect(built.systemPrompt).toContain("Piano practice isn't on your day");
        expect(writes).toEqual([]);
    });
});
