import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting, userText } from "./local-routing.js";
import type { Decision } from "./front-desk.js";

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
    names: () => [...handlers.keys()],
  };
}
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("local routing — shadow mode", () => {
  it("off registers nothing", () => {
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "off", logPath: "/dev/null" });
    expect(f.names()).toEqual([]);
  });

  it("logs the front desk's decision and the check's findings for a real turn without changing anything", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
    const f = fakeApi();
    const decideImpl = async (): Promise<Decision> => ({ move: "escalate", tier: "standard", say: "One moment.", ms: 900 });
    registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath, decideImpl, clock: () => "Sat 18:00" });
    const ctx = { runId: "r1", sessionKey: "agent:main:orion-chat-1" };
    const resolved = await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
    expect(resolved).toEqual([undefined]); // shadow never overrides the model
    await f.fire("after_tool_call", { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: { content: [{ type: "text", text: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" }] } }, ctx);
    const finalized = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7.", model: "claude-haiku" }, ctx);
    expect(finalized).toEqual([undefined]); // shadow never revises
    const [entry] = lines(logPath);
    expect(entry).toMatchObject({ mode: "shadow", message: "move gym to 7", decision: { move: "escalate" }, model: "claude-haiku", tools: 1 });
    expect(entry.findings.flat()).toEqual(expect.arrayContaining(["claims what the tools don't show", "last change incomplete"]));
  });

  it("skips internal sessions (cron, heartbeat, eval, test, subagent)", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
    const f = fakeApi();
    let calls = 0;
    registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath, decideImpl: async () => { calls += 1; return { move: "answer", answer: "hi" }; } });
    await f.fire("before_model_resolve", { prompt: "status" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
    expect(calls).toBe(0);
  });

  it("a failing front desk or log write never breaks the turn", async () => {
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath: "/nonexistent-dir/x/shadow.jsonl", decideImpl: async () => { throw new Error("boom"); } });
    await expect(f.fire("before_model_resolve", { prompt: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
    await expect(f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
  });
});

describe("local routing — on mode", () => {
  const setup = (decision: Decision) => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Sat 18:00" });
    return { f, logPath, ctx: { runId: "r9", sessionKey: "agent:main:orion-app-v2" } };
  };

  it("reads only Nick's words from a phone message wrapped in the channel brief", () => {
    expect(userText("You are answering over the phone…\n--- Nick's message follows ---\nmove gym to 7")).toBe("move gym to 7");
    expect(userText("plain message")).toBe("plain message");
  });

  it("never falls through to the cloud model: answers go to the worker with the front desk's draft, or straight out when the reply hook fires", async () => {
    const { f, ctx } = setup({ move: "answer", answer: "You're welcome, Nick." });
    expect(await f.fire("before_model_resolve", { prompt: "thanks" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
    const [built] = (await f.fire("before_prompt_build", { prompt: "thanks", messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/drafted this reply: "You're welcome, Nick\."/);
    expect(built?.systemPrompt.length).toBeLessThan(1200);
    expect(await f.fire("before_agent_reply", { cleanedBody: "thanks" }, ctx)).toEqual([{ handled: true, reply: { text: "You're welcome, Nick." }, reason: "front desk answered" }]);
  });

  it("never silences a message the front desk thinks is not for ORION — the worker answers instead", async () => {
    const { f, ctx } = setup({ move: "ignore" });
    expect(await f.fire("before_model_resolve", { prompt: "and the winner is" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
    expect(await f.fire("before_agent_reply", { cleanedBody: "and the winner is" }, ctx)).toEqual([undefined]);
  });

  it("routes tools and escalations to the worker with the instructions for that job", async () => {
    const { f, ctx } = setup({ move: "escalate", tier: "standard", say: "One moment." });
    expect(await f.fire("before_model_resolve", { prompt: "move gym to 7 and push dinner back" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
    const [built] = (await f.fire("before_prompt_build", { prompt: "move gym to 7 and push dinner back", messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/orion-reschedule/);
    expect(built?.systemPrompt).toMatch(/Now: Sat 18:00/);
    expect(built?.systemPrompt).toMatch(/full path of a script: \/Users\/nickmadaio\/Desktop\/ORION\/scripts\/orion-agenda/);
    expect(built?.systemPrompt).toMatch(/tomorrow is \w+day \d{4}-\d{2}-\d{2}/);
    const brain = setup({ move: "tool", tool: "brain", args: { do: "search" } });
    await brain.f.fire("before_model_resolve", { prompt: "what did I write about my thesis" }, brain.ctx);
    const [b] = (await brain.f.fire("before_prompt_build", { prompt: "what did I write about my thesis", messages: [] }, brain.ctx)) as Array<{ systemPrompt: string }>;
    expect(b?.systemPrompt).toMatch(/orion-brain/);
  });

  it("check → one retry with what to fix → then undo and say plainly, never a false 'done'", async () => {
    const { f, ctx, logPath } = setup({ move: "escalate", tier: "standard" });
    await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
    const failed = { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" };
    await f.fire("after_tool_call", failed, ctx);
    const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx)) as Array<Record<string, any>>;
    expect(first).toMatchObject({ action: "revise", retry: { maxAttempts: 1 } });
    expect(first?.retry.instruction).toMatch(/did not happen|NOT BOOKED/);
    await f.fire("after_tool_call", failed, ctx);
    const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx)) as Array<Record<string, any>>;
    expect(second).toMatchObject({ action: "revise" });
    expect(second?.retry.instruction).toMatch(/undo/i);
    const [third] = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I couldn't move gym — 7 PM doesn't fit, so nothing changed." }, ctx);
    expect(third).toBeUndefined();
    expect(lines(logPath).at(-1)).toMatchObject({ mode: "on", escalationNeeded: true });
  });

  it("finalizes untouched when the check finds nothing", async () => {
    const { f, ctx } = setup({ move: "tool", tool: "lights", args: { do: "off" } });
    await f.fire("before_model_resolve", { prompt: "lights off" }, ctx);
    await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-lights off" }, result: "Lights: sent off" }, ctx);
    expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Lights are off." }, ctx)).toEqual([undefined]);
  });

  it("a request to change his day is always work: an 'ask' or even an 'answer' from the front desk gets the scheduling instructions", async () => {
    const msg = "today, change of plans. please schedule me for cert courses the entire time between the two classes";
    for (const decision of [{ move: "ask", answer: "What time do you want it?" }, { move: "answer", answer: "Sounds good!" }] as Decision[]) {
      const { f, ctx } = setup(decision);
      await f.fire("before_model_resolve", { prompt: msg }, ctx);
      const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
      expect(built?.systemPrompt).toMatch(/orion-reschedule/);
      expect(await f.fire("before_agent_reply", { cleanedBody: msg }, ctx)).toEqual([undefined]);
    }
  });
});
