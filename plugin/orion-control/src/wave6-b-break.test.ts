// Wave 6 B, revised for gate run-1101020721 (foc-pomodoro-break-v): the worker-set return alarm was paraphrased as "10:10 AM tomorrow"
// and the block never resumed. A vague break is now code's timed break (orion-session start --sequence), said by code on pluginNow;
// the worker never sets an alarm for it. Wave 4 review finding 1: with nothing running (here, a just-ended session) a break starts nothing
// (that start was a 50-minute block with DND and app blocking); the return nudge is code's, on pluginNow, and never said as "tomorrow".
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function setup() {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = [];
    for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };
  const calls: string[][] = [];
  const idle = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", task: "econ" })}\n`;
  const sessionExec = async (args: string[]) => {
    calls.push(args);
    return args[0] === "start" ? { stdout: `${JSON.stringify({ ok: true, status: "running", phase: "rest", task: args[1], remainingSeconds: 600 })}\n`, code: 0 } : { stdout: idle, code: 0 };
  };
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6b-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => "Mon 10:00", now: () => new Date(2026, 10, 2, 10, 0), decideImpl: async () => ({ move: "escalate", tier: "standard" }) as never,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }), sessionExec });
  return { fire, calls };
}

describe("a vague break with nothing running starts nothing, and is said by code on the plugin clock", () => {
  it.each(["need a break", "ok i need a quick break", "gonna take a break real quick"])("%s", async (said) => {
    const { fire, calls } = setup();
    const ctx = { runId: `w6b-${said.length}`, sessionKey: "agent:main:orion-chat-w6b" };
    await fire("before_model_resolve", { prompt: said }, ctx);
    const built = await fire("before_prompt_build", { prompt: said, messages: [] }, ctx) as Array<{ systemPrompt?: string } | undefined>;
    expect(built.map((b) => b?.systemPrompt ?? "").join("")).toMatch(/alarm_set[\s\S]*2026-11-02T10:10/);
    expect(calls.map((c) => c[0])).toEqual(["status"]);
    const [out] = await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done. I've set an alarm for 10:10 AM tomorrow." }, ctx) as Array<{ retry?: { instruction: string } } | undefined>;
    const said2 = JSON.stringify(out ?? {});
    // The worker claimed an alarm it never set: it is sent back to set exactly today's 10:10, never "tomorrow".
    expect(said2).toMatch(/alarm_set[^}]*2026-11-02T10:10/);
    expect(said2).toMatch(/back from break: econ/);
    expect(said2).not.toMatch(/tomorrow/);
  });
});
