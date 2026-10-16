import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { guardTaskRun, madeTaskRunCall, TASK_RUN_ID } from "./task-run-wiring.js";

// 2026-10-16 rerun of the live sweep: 20 items called "orion_task_run" directly and got "Tool orion_task_run
// not found" (q001 q007 q010 q032 q036 q072 q074 r01 ...). The tool sits behind tool_call; r02 also drifted
// from 21:00 to 09:00. Inputs below are the real rerun calls.

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  return {
    api: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    fire: async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown> = {}) => {
      const out = [];
      for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
      return out;
    },
  };
}
type Built = { systemPrompt: string; appendContext?: string };
function setup(decision: Record<string, unknown>, extract?: () => { time: string; label: string }) {
  const f = fakeApi();
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "tw-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => "Fri 15:00", now: () => new Date(2026, 9, 16, 15, 0), decideImpl: async () => decision as never,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
    ...(extract ? { extractReminder: async () => extract(), listReminders: async () => [] } : {}) });
  const ctx = { runId: "tw1", sessionKey: "agent:main:orion-chat-sweep" };
  const build = async (said: string) => {
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    const [b] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Built[];
    return b;
  };
  return { f, ctx, build };
}
const WEATHER = { move: "tool", tool: "weather", args: { days: "1" } };
const NOT_FOUND = "Tool orion_task_run not found";
const wrap = (args: unknown, id = TASK_RUN_ID) => ({ id, args });
const R02 = "my laptop is going to die, remind me to charge it at 9";
const R02_EXTRACT = () => ({ time: "21:00", label: "charge laptop" });

describe("directives go through tool_call", () => {
  it("weather, timer and reminder directives name tool_call and the catalog id, never a bare orion_task_run call", async () => {
    const cases: Array<[Record<string, unknown>, string, (() => { time: string; label: string }) | undefined]> = [
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
    const [r] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "17C" }, ctx)) as Array<Record<string, any>>;
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
    const [bad] = (await a.f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "17C and clear." }, a.ctx)) as Array<Record<string, any>>;
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
    const out = guardTaskRun("tool_call", wrap(drifted, "orion_task_run"), expected) as { params: any };
    expect(out.params.args.steps[0].at).toBe("2026-10-16T21:00");
    expect(out.params.id).toBe("orion_task_run");
  });

  it("rewrites a drifted direct call, and blocks with the exact args if it carries other keys", () => {
    expect((guardTaskRun("orion_task_run", drifted, expected) as any).params.steps[0].at).toBe("2026-10-16T21:00");
    const blocked = guardTaskRun("orion_task_run", { ...drifted, graph: {} }, expected) as { blockReason: string };
    expect(blocked.blockReason).toContain("2026-10-16T21:00");
  });

  it("reads string steps and nested arguments; leaves a matching call, other actions and other tools alone", () => {
    const stringy = { steps: JSON.stringify([{ action: "alarm_set", arguments: { at: "2026-10-16T09:00", label: "charge laptop" }, id: "s1" }]) };
    expect((guardTaskRun("tool_call", wrap(stringy), expected) as any).params.args.steps[0].at).toBe("2026-10-16T21:00");
    expect(guardTaskRun("tool_call", wrap(JSON.parse(expected.args)), expected)).toBeUndefined();
    expect(guardTaskRun("tool_call", wrap({ steps: [{ action: "lights_set", on: true }] }), expected)).toBeUndefined();
    expect(guardTaskRun("tool_call", wrap(drifted, "weather"), expected)).toBeUndefined();
    expect(guardTaskRun("exec", { command: "ls" }, expected)).toBeUndefined();
  });

  it("the before_tool_call hook applies it to the live run's reminder and timer directives", async () => {
    const r = setup({ move: "tool", tool: "alarm" }, R02_EXTRACT);
    await r.build(R02);
    const [fixed] = (await r.f.fire("before_tool_call", { toolName: "tool_call", params: wrap(drifted, "orion_task_run") }, r.ctx)) as Array<{ params: any }>;
    expect(fixed?.params.args.steps[0].at).toBe("2026-10-16T21:00");
    const t = setup({ move: "tool", tool: "session", args: {} });
    await t.build("set a timer for 25 min");
    const [timer] = (await t.f.fire("before_tool_call", { toolName: "tool_call", params: wrap({ steps: [{ action: "timer_set", seconds: 25 }] }) }, t.ctx)) as Array<{ params: any }>;
    expect(timer?.params.args.steps[0].seconds).toBe(1500);
  });
});
