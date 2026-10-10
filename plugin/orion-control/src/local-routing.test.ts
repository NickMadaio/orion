import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
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
    registerLocalRouting(f.api, { mode: "off", logPath: "/dev/null" });
    expect(f.names()).toEqual([]);
  });

  it("logs the front desk's decision and the check's findings for a real turn without changing anything", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
    const f = fakeApi();
    const decideImpl = async (): Promise<Decision> => ({ move: "escalate", tier: "standard", say: "One moment.", ms: 900 });
    registerLocalRouting(f.api, { mode: "shadow", logPath, decideImpl, clock: () => "Sat 18:00" });
    const ctx = { runId: "r1", sessionKey: "agent:main:orion-chat-1" };
    const resolved = await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
    expect(resolved).toEqual([undefined]); // shadow never overrides the model
    await f.fire("after_tool_call", { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: { content: [{ type: "text", text: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" }] } }, ctx);
    const finalized = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7.", model: "claude-haiku" }, ctx);
    expect(finalized).toEqual([undefined]); // shadow never revises
    const [entry] = lines(logPath);
    expect(entry).toMatchObject({ mode: "shadow", message: "move gym to 7", decision: { move: "escalate" }, model: "claude-haiku", tools: 1 });
    expect(entry.findings).toEqual(expect.arrayContaining(["claims what the tools don't show", "last change incomplete"]));
  });

  it("skips internal sessions (cron, heartbeat, eval, test, subagent)", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
    const f = fakeApi();
    let calls = 0;
    registerLocalRouting(f.api, { mode: "shadow", logPath, decideImpl: async () => { calls += 1; return { move: "answer", answer: "hi" }; } });
    await f.fire("before_model_resolve", { prompt: "status" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
    expect(calls).toBe(0);
  });

  it("a failing front desk or log write never breaks the turn", async () => {
    const f = fakeApi();
    registerLocalRouting(f.api, { mode: "shadow", logPath: "/nonexistent-dir/x/shadow.jsonl", decideImpl: async () => { throw new Error("boom"); } });
    await expect(f.fire("before_model_resolve", { prompt: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
    await expect(f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
  });
});
