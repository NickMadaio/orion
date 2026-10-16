import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { guardTaskRun, madeTaskRunCall, TASK_RUN_ID } from "./task-run-wiring.js";
function fakeApi() {
    const handlers = new Map();
    return {
        api: { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
        fire: async (name, event, ctx = {}) => {
            const out = [];
            for (const fn of handlers.get(name) ?? [])
                out.push(await fn(event, ctx));
            return out;
        },
    };
}
function setup(decision, extract) {
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "tw-")), "r.jsonl"), brainSearch: async () => "",
        clock: () => "Fri 15:00", now: () => new Date(2026, 9, 16, 15, 0), decideImpl: async () => decision,
        scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
        ...(extract ? { extractReminder: async () => extract(), listReminders: async () => [] } : {}) });
    const ctx = { runId: "tw1", sessionKey: "agent:main:orion-chat-sweep" };
    const build = async (said) => {
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        const [b] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        return b;
    };
    return { f, ctx, build };
}
const WEATHER = { move: "tool", tool: "weather", args: { days: "1" } };
const NOT_FOUND = "Tool orion_task_run not found";
const wrap = (args, id = TASK_RUN_ID) => ({ id, args });
const R02 = "my laptop is going to die, remind me to charge it at 9";
const R02_EXTRACT = () => ({ time: "21:00", label: "charge laptop" });
describe("directives go through tool_call", () => {
    it("weather, timer and reminder directives name tool_call and the catalog id, never a bare orion_task_run call", async () => {
        const cases = [
            [WEATHER, "whats the temp outside, feels cold in here", undefined],
            [{ move: "tool", tool: "session", args: {} }, "set a timer for 25 min", undefined],
            [{ move: "tool", tool: "alarm" }, R02, R02_EXTRACT],
        ];
        for (const [decision, said, extract] of cases) {
            const built = await setup(decision, extract).build(said);
            const all = `${built?.systemPrompt}\n${built?.appendContext}`;
            expect(all, said).toContain("tool_call");
            expect(all, said).toContain(`"${TASK_RUN_ID}"`);
            expect(all, said).not.toMatch(/call orion_task_run/);
        }
    });
    it("the retry instruction after a missed call also uses tool_call", async () => {
        const { f, ctx, build } = setup(WEATHER);
        await build("whats the weather like rn");
        const [r] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "17C" }, ctx));
        expect(r?.retry.instruction).toContain(TASK_RUN_ID);
        expect(r?.retry.instruction).toMatch(/tool_call/);
    });
});
describe("a call counts only when it reached the tool", () => {
    const weather = { steps: [{ action: "weather_now", location: "London" }] };
    it("tool_call with the orion_task_run id counts; 'not found' and errors do not", () => {
        const real = { canonical: `tool_call ${JSON.stringify({ id: "orion_task_run", args: weather })}`, stdout: '{"executed":true}' };
        expect(madeTaskRunCall(real, "weather_now")).toBe(true);
        expect(madeTaskRunCall({ canonical: `orion_task_run ${JSON.stringify(weather)}`, stdout: NOT_FOUND }, "weather_now")).toBe(false);
        expect(madeTaskRunCall({ ...real, stdout: NOT_FOUND }, "weather_now")).toBe(false);
        expect(madeTaskRunCall({ ...real, stdout: "Error: unknown tool id" }, "weather_now")).toBe(false);
        expect(madeTaskRunCall({ canonical: `tool_call ${JSON.stringify({ id: "weather", args: weather })}`, stdout: "ok" }, "weather_now")).toBe(false);
    });
    it("finalize: a not-found direct call is still sent back; the tool_call form passes", async () => {
        const a = setup(WEATHER);
        await a.build("whats the weather like rn");
        await a.f.fire("after_tool_call", { toolName: "orion_task_run", params: { steps: weather.steps }, result: NOT_FOUND }, a.ctx);
        const [bad] = (await a.f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "17C and clear." }, a.ctx));
        expect(bad).toMatchObject({ action: "revise" });
        const b = setup(WEATHER);
        await b.build("whats the weather like rn");
        await b.f.fire("after_tool_call", { toolName: "tool_call", params: wrap(weather), result: "London: 17C clear" }, b.ctx);
        expect(await b.f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "17C and clear." }, b.ctx)).toEqual([undefined]);
    });
    it("reminder finalize counts the tool_call form", async () => {
        const { f, ctx, build } = setup({ move: "tool", tool: "alarm" }, R02_EXTRACT);
        await build(R02);
        const args = { steps: [{ action: "alarm_set", at: "2026-10-16T21:00", label: "charge laptop" }] };
        await f.fire("after_tool_call", { toolName: "tool_call", params: wrap(args, "orion_task_run"), result: "executed=true" }, ctx);
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Reminder set." }, ctx)).toEqual([undefined]);
    });
});
describe("argument drift (r02: 21:00 became 09:00)", () => {
    const expected = { action: "alarm_set", args: JSON.stringify({ steps: [{ action: "alarm_set", at: "2026-10-16T21:00", label: "charge laptop" }] }) };
    const drifted = { steps: [{ action: "alarm_set", at: "2026-10-16T09:00", label: "charge laptop" }] };
    it("rewrites a drifted tool_call to the code-built args", () => {
        const out = guardTaskRun("tool_call", wrap(drifted, "orion_task_run"), expected);
        expect(out.params.args.steps[0].at).toBe("2026-10-16T21:00");
        expect(out.params.id).toBe("orion_task_run");
    });
    it("rewrites a drifted direct call, and blocks with the exact args if it carries other keys", () => {
        expect(guardTaskRun("orion_task_run", drifted, expected).params.steps[0].at).toBe("2026-10-16T21:00");
        const blocked = guardTaskRun("orion_task_run", { ...drifted, graph: {} }, expected);
        expect(blocked.blockReason).toContain("2026-10-16T21:00");
    });
    it("reads string steps and nested arguments; leaves a matching call and other tools alone", () => {
        const stringy = { steps: JSON.stringify([{ action: "alarm_set", arguments: { at: "2026-10-16T09:00", label: "charge laptop" }, id: "s1" }]) };
        expect(guardTaskRun("tool_call", wrap(stringy), expected).params.args.steps[0].at).toBe("2026-10-16T21:00");
        expect(guardTaskRun("tool_call", wrap(JSON.parse(expected.args)), expected)).toBeUndefined();
        expect(guardTaskRun("tool_call", wrap({ steps: [{ action: "lights_set", on: true }] }), expected).block).toBe(true); // review, 2026-10-16: other actions are refused
        expect(guardTaskRun("tool_call", wrap(drifted, "weather"), expected)).toBeUndefined();
        expect(guardTaskRun("exec", { command: "ls" }, expected)).toBeUndefined();
    });
    it("the before_tool_call hook applies it to the live run's reminder and timer directives", async () => {
        const r = setup({ move: "tool", tool: "alarm" }, R02_EXTRACT);
        await r.build(R02);
        // Two before_tool_call hooks are registered (the undo guard first); take the one that answered.
        const fixed = (await r.f.fire("before_tool_call", { toolName: "tool_call", params: wrap(drifted, "orion_task_run") }, r.ctx)).find(Boolean);
        expect(fixed?.params.args.steps[0].at).toBe("2026-10-16T21:00");
        const t = setup({ move: "tool", tool: "session", args: {} });
        await t.build("set a timer for 25 min");
        const timer = (await t.f.fire("before_tool_call", { toolName: "tool_call", params: wrap({ steps: [{ action: "timer_set", seconds: 25 }] }) }, t.ctx)).find(Boolean);
        expect(timer?.params.args.steps[0].seconds).toBe(1500);
    });
});
// Review, 2026-10-16: reminder_cancel's `id` is the reminder's id, not a step label.
describe("guard keeps reminder ids and refuses other actions", () => {
    const cancel = { action: "reminder_cancel", args: JSON.stringify({ steps: [{ action: "reminder_cancel", id: "a1" }] }) };
    it("a cancel call with another reminder's id is rewritten to the expected id", () => {
        const out = guardTaskRun("tool_call", wrap({ steps: [{ action: "reminder_cancel", id: "a2" }] }), cancel);
        expect(out.params.args.steps[0].id).toBe("a1");
        expect(guardTaskRun("orion_task_run", { steps: [{ action: "reminder_cancel", id: "a2" }] }, cancel).params.steps[0].id).toBe("a1");
        expect(guardTaskRun("tool_call", wrap({ steps: [{ action: "reminder_cancel", id: "a1" }] }), cancel)).toBeUndefined();
    });
    it("a step label id on an action whose expected step has none is not drift", () => {
        const set = { action: "alarm_set", args: JSON.stringify({ steps: [{ action: "alarm_set", at: "2026-10-16T21:00", label: "x" }] }) };
        expect(guardTaskRun("tool_call", wrap({ steps: [{ id: "s1", action: "alarm_set", at: "2026-10-16T21:00", label: "x" }] }), set)).toBeUndefined();
    });
    it("a different action while a directive is active is blocked with the exact args", () => {
        const out = guardTaskRun("tool_call", wrap({ steps: [{ action: "alarm_set", at: "2026-10-16T09:00", label: "x" }] }), cancel);
        expect(out.block).toBe(true);
        expect(out.blockReason).toContain(cancel.args);
        const mixed = guardTaskRun("orion_task_run", { steps: [{ action: "reminder_cancel", id: "a1" }, { action: "lights_set" }] }, cancel);
        expect(mixed.block).toBe(true);
    });
    it("finalize does not count a cancel of another id as the directive's call", async () => {
        const { f, ctx, build } = setup({ move: "tool", tool: "alarm" }, R02_EXTRACT);
        await build(R02);
        const out = (await f.fire("before_tool_call", { toolName: "tool_call", params: wrap({ steps: [{ action: "lights_set", on: true }] }, "orion_task_run") }, ctx));
        expect(out.some((o) => o?.block)).toBe(true);
    });
});
