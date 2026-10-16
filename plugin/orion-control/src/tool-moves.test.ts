import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runSessionStatus } from "./session-flow.js";
import { isTimerRequest, toolDirective } from "./tool-moves.js";
import type { Decision } from "./front-desk.js";

// Live sweep 2026-10-15 (front-desk-tools): a front-desk "tool" move was only a hint. Weather and
// session-status questions were answered with no tool call ("15 minutes remaining", "it's not expected
// to rain"), a timer went to a made-up tool id, creatine went to "orion-log water 1", and a workout
// was filed as 300 kcal of food. Every case below is the real sweep message and decision.

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
const RUNNING = JSON.stringify({ ok: true, status: "running", phase: "focus", blockNumber: 1, totalBlocks: 1, remainingSeconds: 1260, task: "cs1800 hw" });

function setup(decision: Decision, extra: { sessionStatus?: () => Promise<import("./schedule-flow.js").FlowResult> } = {}) {
  const logPath = join(mkdtempSync(join(tmpdir(), "tm-")), "r.jsonl");
  const f = fakeApi();
  let sessionStarts = 0;
  let calendarRuns = 0;
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Thu 22:25", brainSearch: async () => "",
    scheduleFlow: async () => { calendarRuns += 1; return { outcome: "fallback", reason: "test" }; },
    sessionFlow: async () => { sessionStarts += 1; return { outcome: "fallback", reason: "test" }; },
    sessionStatus: extra.sessionStatus ?? (() => runSessionStatus({ exec: async () => ({ stdout: RUNNING, code: 0 }) })) });
  const ctx = { runId: "tm1", sessionKey: "agent:main:orion-chat-sweep" };
  const build = async (said: string) => {
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Built[];
    return built;
  };
  return { f, ctx, build, counts: () => ({ sessionStarts, calendarRuns }) };
}

const callIn = (built: Built | undefined) => {
  const m = /exactly these arguments[^\n]*:\n(\{.*\})/.exec(built?.systemPrompt ?? "");
  return m ? (JSON.parse(m[1]!) as { steps: Array<Record<string, unknown>> }).steps : null;
};

describe("front-desk tool moves are carried out, not left as hints (sweep 2026-10-15)", () => {
  it("weather (q001, q007, q010): the worker is told the exact weather_now call, with the days his words imply", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["whats the weather like rn", { days: "1" }, { action: "weather_now", location: "London" }],
      ["is it gonna rain later this week", { days: "1-7" }, { action: "weather_now", location: "London", days: 7 }],
      ["whats the temp outside, feels cold in here", { days: "1" }, { action: "weather_now", location: "London" }],
    ];
    for (const [said, args, step] of cases) {
      const { build } = setup({ move: "tool", tool: "weather", args });
      const built = await build(said);
      expect(callIn(built)).toEqual([step]);
      expect(built?.appendContext).toMatch(/call tool_call now with .*openclaw:orion-control:orion_task_run/);
    }
  });

  it("a tool move that ends with no tool call is sent back, then answered honestly (q007 'I checked the weather')", async () => {
    const { f, ctx, build } = setup({ move: "tool", tool: "weather", args: { days: "1-7" } });
    await build("is it gonna rain later this week");
    const claim = "I checked the weather for London and it's not expected to rain later this week.";
    const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: claim }, ctx)) as Array<Record<string, any>>;
    expect(first).toMatchObject({ action: "revise" });
    expect(first?.retry.instruction).toMatch(/weather_now/);
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: claim }, ctx);
    const messages = [{ role: "assistant", content: [{ type: "text", text: claim }] }];
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: claim, messages }, ctx);
    expect(JSON.stringify(messages)).toMatch(/couldn't check the weather/);
    expect(JSON.stringify(messages)).not.toMatch(/not expected to rain/);
  });

  it("a tool move whose call was made finishes normally", async () => {
    const { f, ctx, build } = setup({ move: "tool", tool: "weather", args: { days: "1" } });
    await build("whats the weather like rn");
    await f.fire("after_tool_call", { toolName: "orion_task_run", params: { steps: [{ action: "weather_now", location: "London" }] }, result: "London: 17°C, clear, wind 14 kph" }, ctx);
    expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "It's 17°C and clear in London right now." }, ctx)).toEqual([undefined]);
  });

  it("'set a timer for 25 min' (q032) is timer_set for 1500 seconds, never a focus session, whatever the front desk picked", async () => {
    const { build, counts } = setup({ move: "tool", tool: "session", args: { do: "start", minutes: "25" } });
    const built = await build("set a timer for 25 min");
    expect(callIn(built)).toEqual([{ action: "timer_set", seconds: 1500 }]);
    expect(counts().sessionStarts).toBe(0);
  });

  it("focus status (q049, q053) is read by code from orion-session, never guessed", async () => {
    for (const said of ["how much focus time is left", "is my focus session on"]) {
      const { build } = setup({ move: "tool", tool: "session", args: { do: "status" } });
      const built = await build(said);
      expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*Your focus session on cs1800 hw is running: 21 minutes left\./);
      expect(built?.systemPrompt).toMatch(/do not call any tools/);
    }
  });

  it("session status says plainly when nothing is running or Orion cannot be reached", async () => {
    expect(await runSessionStatus({ exec: async () => ({ stdout: JSON.stringify({ ok: true, status: "none" }), code: 0 }) })).toMatchObject({ outcome: "say", text: "No focus session is running right now." });
    expect(await runSessionStatus({ exec: async () => ({ stdout: JSON.stringify({ ok: true, status: "paused", task: "essay" }), code: 0 }) })).toMatchObject({ outcome: "say", text: "Your focus session on essay is paused." });
    expect(await runSessionStatus({ exec: async () => ({ stdout: "orion-session: Orion is not running", code: 1 }) })).toMatchObject({ outcome: "say", text: "I couldn't check your focus session: Orion is not running." });
  });

  it("supplements (q072, q076): taking one is supplement_take; asking whether he took one is supplement_status", async () => {
    const take = setup({ move: "tool", tool: "supplements", args: { do: "take", name: "creatine" } });
    expect(callIn(await take.build("took my creatine"))).toEqual([{ action: "supplement_take", name: "creatine" }]);
    const asked = setup({ move: "tool", tool: "supplements", args: { do: "search", query: "vitamin d" } });
    const built = await asked.build("did i already take my vitamin d today");
    expect(callIn(built)).toEqual([{ action: "supplement_status" }]);
    expect(built?.systemPrompt).toMatch(/do not log a dose/i);
    expect(asked.counts().calendarRuns).toBe(0);
  });

  it("a workout by time or a night's sleep (q073, q075) is never filed as food: ORION says it cannot log that yet", async () => {
    const cases: Array<[string, Decision, RegExp]> = [
      ["log a workout, did 45 min upper body", { move: "tool", tool: "log_intake", args: { what: "food", amount: "workout" } }, /can't log a workout by time yet/],
      ["log 8 hours sleep last night", { move: "tool", tool: "supplements", args: { do: "add", name: "sleep" } }, /can't log sleep yet/],
    ];
    for (const [said, decision, line] of cases) {
      const { build } = setup(decision);
      const built = await build(said);
      expect(built?.systemPrompt).toMatch(line);
      expect(built?.systemPrompt).toMatch(/Nothing was logged\./);
      expect(built?.systemPrompt).toMatch(/do not call any tools/);
    }
  });

  it("leaves other tool moves and escalations to the worker as before", async () => {
    const todo = setup({ move: "tool", tool: "supplements", args: { do: "done", name: "oats" } });
    expect(callIn(await todo.build("ok mark the oats one done"))).toBeNull();
    const two = setup({ move: "escalate", tier: "quick" });
    expect(callIn(await two.build("can u push my 4pm to 5 and also whats the weather tmrw"))).toBeNull();
  });
  // Review, 2026-10-16 (MEDIUM 9): a cancel or a question about a timer started a new one.
  it("cancelling or asking about a timer never sets one", async () => {
    for (const said of ["cancel the timer for 10 min", "stop the timer for 5 minutes", "is my timer for 20 min still running"]) {
      expect(toolDirective({ move: "tool", tool: "session", args: { do: "start" } }, said), said).toBeNull();
      expect(isTimerRequest(said), said).toBe(false);
    }
    expect(toolDirective({ move: "tool", tool: "session", args: {} }, "set a timer for 25 min")).toMatchObject({ kind: "call", action: "timer_set" });
  });

  // Review, 2026-10-16 (regression, held up): the host drops a revise once a tool has run.
  it("hostDrops on the tool-move retry puts the fail line in place", async () => {
    const { f, ctx, build } = setup({ move: "tool", tool: "weather", args: { days: "1" } });
    await build("whats the weather like rn");
    const messages = [{ role: "assistant", content: [{ type: "text", text: "It's sunny." }] }];
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "It's sunny.", hadDeterministicSideEffect: true, messages }, ctx);
    expect(JSON.stringify(messages)).toMatch(/couldn't check the weather/);
  });

  // Review, 2026-10-16 (MEDIUM 13): the check looked only at the action name and overwrote a success.
  it("another tool's success is delivered, not overwritten by the fail line ('took my creatine')", async () => {
    const { f, ctx, build } = setup({ move: "tool", tool: "supplements", args: { do: "take", name: "creatine" } });
    await build("took my creatine");
    await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-log supplement creatine" }, result: "Logged creatine: taken today." }, ctx);
    const reply = "Logged your creatine.";
    const messages = [{ role: "assistant", content: [{ type: "text", text: reply }] }];
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply, hadDeterministicSideEffect: true, messages }, ctx);
    expect(JSON.stringify(messages)).toContain(reply);
    expect(JSON.stringify(messages)).not.toMatch(/didn't manage/);
  });

  it("a nothing-changed or error result from another tool still gets the fail line", async () => {
    for (const result of ["NOTHING WAS CHANGED: no such thing", "Error: exec denied"]) {
      const { f, ctx, build } = setup({ move: "tool", tool: "supplements", args: { do: "take", name: "creatine" } });
      await build("took my creatine");
      await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-log water 1" }, result }, ctx);
      const messages = [{ role: "assistant", content: [{ type: "text", text: "Logged your creatine." }] }];
      await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Logged your creatine.", hadDeterministicSideEffect: true, messages }, ctx);
      expect(JSON.stringify(messages)).toMatch(/didn't manage to log your creatine/);
    }
  });

  // Review, 2026-10-16 (re-review): only a success from the directive's own tool family keeps the worker's reply.
  it("an unrelated tool's success does not keep the worker's reply", async () => {
    const cases: Array<[Decision, string, string, Record<string, unknown>, string, string]> = [
      [{ move: "tool", tool: "weather", args: { days: "1" } }, "is it gonna rain later", "exec", { command: "orion-lights off" }, "Lights: sent off", "No rain expected this afternoon."],
      [{ move: "tool", tool: "supplements", args: { do: "take", name: "creatine" } }, "took my creatine", "orion_task_run", { steps: [{ action: "supplement_add", name: "creatine" }] }, "Added creatine to your list. executed=true", "Logged your creatine for today."],
    ];
    for (const [decision, said, toolName, params, result, reply] of cases) {
      const { f, ctx, build } = setup(decision);
      await build(said);
      await f.fire("after_tool_call", { toolName, params, result }, ctx);
      const messages = [{ role: "assistant", content: [{ type: "text", text: reply }] }];
      await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply, hadDeterministicSideEffect: true, messages }, ctx);
      expect(JSON.stringify(messages), said).not.toContain(reply);
    }
  });
});
