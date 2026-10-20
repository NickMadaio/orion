// 2026-10-20 reschedule incident (docs/audits/2026-10-20-reschedule-incident.md). Fixtures only: stub flows, a temp log, no real paths, no model.
//   15:15:59 "reschedule my day after my marketing class, but put gym as the first event after i get back home"
//   -> the 4B desk aborted at 8 s, the schedule flow's 9B form calls (22 s, then a 30 s abort) outlived the host's 15 s hook limit, the host dropped ORION's
//      slim prompt and ran the full 17.7k-token workspace prompt (3 min 1 s), the worker wrote a wrong plan, the guard refused it: 4 min 40 s, nothing changed.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLocalRouting, EXACT_REPLY_PROMPT, PRODUCTION_NOTES } from "./local-routing.js";
import { BRAIN_INSTRUCTIONS, GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS } from "./job-instructions.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";
import { DeskHealth, DESK_DEGRADED_TIMEOUT_MS, DESK_TIMEOUT_MS, FLOW_BUDGET_MS, HOOK_TIMEOUT_MS, MIN_FLOW_MS, SLOW_FLOW_LINE, SLOW_TURN_LINE, flowDeadline, formCallMs } from "./turn-budget.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Opts = { priority?: number; timeoutMs?: number };
const SENTENCE = "reschedule my day after my marketing class, but put gym as the first event after i get back home";
const DESK_DOWN: Decision = { move: "escalate", fallback: "timeout", ms: 8013 };
const REPLY = "Done, after your marketing class and the trip home: Gym 5:50–7:20 PM, then finish resume 7:25–8:25 PM.";
const done = (reply: string): FlowResult => ({ outcome: "done", reply, calls: ["exec orion-reschedule day --plan x"], outputs: ["ok"] });

function rig(extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler[]>(); const optsOf = new Map<string, Opts | undefined>();
  const api = { on: (name: string, fn: Handler, opts?: Opts) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); optsOf.set(name, opts); } };
  const logPath = join(mkdtempSync(join(tmpdir(), "lr-incident-")), "shadow.jsonl");
  registerLocalRouting(api, { warm: false, mode: "on", logPath, trace: true, brainSearch: async () => "", clock: () => "Tue 16:16", ...extra });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  const rows = () => (existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const stages = () => (existsSync(`${logPath}.trace`) ? readFileSync(`${logPath}.trace`, "utf8").trim().split("\n").map((l) => JSON.parse(l).stage as string) : []);
  return { fire, rows, optsOf, handlers, stages };
}
const ctx = { runId: "r-1020", sessionKey: "agent:main:orion-chat-1" };
type Built = { systemPrompt: string; appendContext?: string };
async function turn(r: ReturnType<typeof rig>, message: string, c = ctx) {
  const [resolved] = await r.fire("before_model_resolve", { prompt: message }, c);
  const [built] = (await r.fire("before_prompt_build", { prompt: message, messages: [] }, c)) as Array<Built>;
  return { resolved: resolved as { providerOverride?: string; modelOverride?: string } | undefined, built: built as Built };
}
afterEach(() => { vi.useRealTimers(); });

describe("the incident sentence runs as code, whatever the front desk is doing", () => {
  it("the 4B is not even asked, the day flow runs with a deadline, and the worker only repeats code's line", async () => {
    let desk = 0; let flowOpts: Record<string, unknown> | undefined;
    const r = rig({ decideImpl: async () => { desk += 1; return DESK_DOWN; },
      scheduleFlow: async (_m: string, _c: string, o: Record<string, unknown>) => { flowOpts = o; return done(REPLY); } });
    const { resolved, built } = await turn(r, SENTENCE);
    expect(desk).toBe(0);
    expect(resolved).toMatchObject({ providerOverride: "ollama", modelOverride: "qwen3.5:9b" });
    expect(typeof flowOpts?.deadlineAt).toBe("number");
    expect(built.systemPrompt).toContain(EXACT_REPLY_PROMPT);
    expect(built.systemPrompt).toContain(REPLY);
    expect(built.systemPrompt.length).toBeLessThan(400);   // one line, not 17.7k tokens
  });
  it.each([
    ["replan my evening, gym first"],
    ["after class do gym then resume"],
    ["move everything after lab, gym first"],
  ])("%s", async (message) => {
    let desk = 0; const seen: string[] = [];
    const r = rig({ decideImpl: async () => { desk += 1; return DESK_DOWN; }, scheduleFlow: async (m: string) => { seen.push(m); return done(REPLY); } });
    const { built } = await turn(r, message);
    expect(desk).toBe(0);
    expect(seen).toEqual([message]);
    expect(built.systemPrompt).toContain(REPLY);
  });
  it("a front desk that is only slow elsewhere (a question) is still asked", async () => {
    let desk = 0;
    const r = rig({ decideImpl: async () => { desk += 1; return { move: "answer", answer: "Gym is first." }; }, scheduleFlow: async () => done(REPLY) });
    await turn(r, "what is first after class?");
    expect(desk).toBe(1);
  });
});

describe("a failed or timed-out front desk checks the code flows before the worker", () => {
  const down = [["timed out", async () => DESK_DOWN], ["threw", async () => { throw new Error("http 500"); }]] as const;
  for (const [how, decideImpl] of down) {
    it(`desk ${how}: schedule (direct add)`, async () => {
      const r = rig({ decideImpl, scheduleFlow: async () => done("Done: CS Lab 9:55–10:30 PM.") });
      const { built } = await turn(r, "put cs lab from now until 10:30");
      expect(built.systemPrompt).toContain("Done: CS Lab 9:55–10:30 PM.");
      expect(built.systemPrompt).not.toMatch(/You are ORION/);
    });
    it(`desk ${how}: focus session`, async () => {
      const r = rig({ decideImpl, scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }), sessionFlow: async () => ({ outcome: "done", reply: "Focus session started: leetcode, 25 minutes.", calls: ["exec orion-session start"], outputs: ["ok"] }) });
      const { built } = await turn(r, "start a focus session on leetcode for 25 minutes");
      expect(built.systemPrompt).toContain("Focus session started: leetcode, 25 minutes.");
    });
    it(`desk ${how}: wake alarm`, async () => {
      const r = rig({ decideImpl, scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }), wakeFlow: async () => ({ outcome: "done", reply: "Your wake alarm is now 12:00 PM.", calls: ["exec orion-wake"], outputs: ["ok"] }) });
      const { built } = await turn(r, "push my alarm to 12");
      expect(built.systemPrompt).toContain("Your wake alarm is now 12:00 PM.");
    });
    it(`desk ${how}: reminder`, async () => {
      const r = rig({ decideImpl, scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }), extractReminder: async () => ({ time: "17:00", label: "call mom" }), listReminders: async () => [], now: () => new Date(2030, 9, 3, 16, 16) });
      const { built } = await turn(r, "remind me at 5pm to call mom");
      expect(built.systemPrompt).toMatch(/alarm_set/);
      expect(built.systemPrompt).toMatch(/call mom/);
    });
  }
});

describe("the shadow log has a row for every turn, however it ends", () => {
  it("a failed desk writes its row at once, before the turn is over", async () => {
    const r = rig({ decideImpl: async () => DESK_DOWN, scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
    await r.fire("before_model_resolve", { prompt: "what is the capital of France" }, ctx);
    expect(r.rows()).toEqual([expect.objectContaining({ stage: "decision", runId: ctx.runId, message: "what is the capital of France", decision: expect.objectContaining({ move: "escalate", fallback: "timeout", ms: 8013 }) })]);
  });
  it("a turn that errors out (finalize never runs) still leaves a row, with the error", async () => {
    const r = rig({ decideImpl: async () => ({ move: "escalate", ms: 900 }), scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
    await r.fire("before_model_resolve", { prompt: "hello there" }, ctx);
    await r.fire("agent_end", { runId: ctx.runId, success: false, error: "ollama: 500 Internal Server Error", durationMs: 31000, messages: [] }, ctx);
    expect(r.rows()).toEqual([expect.objectContaining({ stage: "agent_end", message: "hello there", success: false, error: "ollama: 500 Internal Server Error", turnMs: 31000, decision: expect.objectContaining({ move: "escalate" }) })]);
  });
  it("a turn that finalized is logged once, not twice", async () => {
    const r = rig({ decideImpl: async () => ({ move: "escalate" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
    await r.fire("before_model_resolve", { prompt: "hello there" }, ctx);
    await r.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Hi.", model: "qwen3.5:9b", messages: [] }, ctx);
    await r.fire("agent_end", { runId: ctx.runId, success: true, messages: [] }, ctx);
    expect(r.rows()).toHaveLength(1);
  });
  it("traces the prompt hook, so a gap between the hooks is visible", async () => {
    const r = rig({ decideImpl: async () => ({ move: "escalate" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
    await turn(r, "hello there");
    expect(r.stages()).toEqual(["before_model_resolve", "before_prompt_build"]);
  });
});

describe("the prompt hook is registered with room to finish, and always answers first", () => {
  it("asks the host for more than its 15 s default", () => {
    const r = rig({ decideImpl: async () => ({ move: "escalate" }) });
    expect(HOOK_TIMEOUT_MS).toBeGreaterThan(15_000);
    expect(r.optsOf.get("before_prompt_build")).toEqual({ timeoutMs: HOOK_TIMEOUT_MS });
  });
  it("a change request that is still unanswered after 40 s gets an honest line from one tiny call, not a minutes-long tool loop", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2030, 9, 3, 16, 16, 0));
    const r = rig({ decideImpl: async () => DESK_DOWN, scheduleFlow: async () => { vi.setSystemTime(new Date(2030, 9, 3, 16, 16, 45)); return { outcome: "fallback", reason: "too slow" }; } });
    const { built } = await turn(r, "move gym to 7 and push the resume back");
    expect(built.systemPrompt).toContain(SLOW_TURN_LINE);
    expect(built.systemPrompt).toContain(EXACT_REPLY_PROMPT);
    expect(built.systemPrompt.length).toBeLessThan(500);
  });
  it("a question that took as long is still answered by the worker", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2030, 9, 3, 16, 16, 0));
    const r = rig({ decideImpl: async () => { vi.setSystemTime(new Date(2030, 9, 3, 16, 16, 45)); return DESK_DOWN; }, scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
    const { built } = await turn(r, "what did I decide about my thesis topic");
    expect(built.systemPrompt).not.toContain(SLOW_TURN_LINE);
    expect(built.systemPrompt).toMatch(/You are ORION/);
  });
  it("a flow that never comes back is cut before the host's limit; the late result cannot change what Nick is told", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2030, 9, 3, 16, 16, 0));
    let late: ((f: FlowResult) => void) | undefined;
    const r = rig({ decideImpl: async () => DESK_DOWN, scheduleFlow: () => new Promise<FlowResult>((resolve) => { late = resolve; }) });
    await r.fire("before_model_resolve", { prompt: "move gym to 7 and push the resume back" }, ctx);
    const pending = r.fire("before_prompt_build", { prompt: "move gym to 7 and push the resume back", messages: [] }, ctx);
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS);
    const [built] = (await pending) as Array<Built>;
    expect(built.systemPrompt).toContain(SLOW_FLOW_LINE);
    late?.(done("Done: something else entirely."));
    await vi.advanceTimersByTimeAsync(10);
    await r.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok", model: "qwen3.5:9b", messages: [] }, ctx);
    expect(r.rows().at(-1)).toMatchObject({ flow: { outcome: "say" } });
  });
  it("a hook that throws still answers with the slim prompt, never the host's full one", async () => {
    const r = rig({ decideImpl: async () => ({ move: "escalate" }), scheduleFlow: async () => { throw new Error("boom"); },
      readDay: async () => { throw new Error("boom"); }, brainSearch: async () => { throw new Error("boom"); } });
    const { built } = await turn(r, "hello there");
    expect(built.systemPrompt).toMatch(/You are ORION/);
    expect(built.systemPrompt.length).toBeLessThan(20_000);
  });
});

describe("what a local turn carries (the incident's call was 17,715 tokens; the slim prompts measure 4,869 and 1,612 with the app prefix and 4 tools)", () => {
  // Measured 2026-10-20 with qwen3.5:9b's own tokenizer on the real prompt build: system 12.6k chars = 3,968 tokens with the app's 2.4k-char prefix, 4,869 with the 4 tool schemas.
  // A slim prompt that grows past this is a regression to catch in review, not by a 3-minute turn on battery.
  it("the worker's scheduling prompt stays inside its budget, with the absolute-path notes the guard needs", async () => {
    const r = rig({ decideImpl: async () => DESK_DOWN });   // no schedule flow wired: the worker-bound prompt
    const { built } = await turn(r, "move my gym to 7 and push the resume");
    expect(built.systemPrompt).toContain(SCHEDULING_INSTRUCTIONS);
    expect(built.systemPrompt).toContain(PRODUCTION_NOTES);
    expect(built.systemPrompt.length).toBeLessThan(13_500);
  });
  it("the other job prompts are smaller still", () => {
    expect(GENERAL_INSTRUCTIONS.length + PRODUCTION_NOTES.length).toBeLessThan(5_000);
    expect(BRAIN_INSTRUCTIONS.length + PRODUCTION_NOTES.length).toBeLessThan(5_000);
  });
  it("a turn code answers carries one line, never a manual", async () => {
    const r = rig({ decideImpl: async () => DESK_DOWN, scheduleFlow: async () => done(REPLY) });
    const { built } = await turn(r, SENTENCE);
    expect(built.systemPrompt.length + (built.appendContext?.length ?? 0)).toBeLessThan(700);
  });
});

describe("turn budgets", () => {
  it("the desk is given 8 s, then 2.5 s for 3 minutes after it failed, then 8 s again; a good answer resets it", () => {
    let t = 0; const health = new DeskHealth(() => t);
    expect(health.timeoutMs()).toBe(DESK_TIMEOUT_MS);
    health.record({ fallback: "timeout" });
    expect(health.timeoutMs()).toBe(DESK_DEGRADED_TIMEOUT_MS);
    t = 179_000; expect(health.timeoutMs()).toBe(DESK_DEGRADED_TIMEOUT_MS);
    t = 181_000; expect(health.timeoutMs()).toBe(DESK_TIMEOUT_MS);
    health.record({ error: "boom" }); expect(health.degraded()).toBe(true);
    health.record({}); expect(health.degraded()).toBe(false);
  });
  it("the flow's deadline is the turn's 40 s, but never less than 12 s from now", () => {
    expect(flowDeadline(1_000_000, 1_005_000)).toBe(1_000_000 + FLOW_BUDGET_MS);
    expect(flowDeadline(1_000_000, 1_060_000)).toBe(1_060_000 + MIN_FLOW_MS);
  });
  it("one form call is capped at 25 s, shrinks with the time left, and is not started with under 3 s", () => {
    expect(formCallMs(60_000)).toBe(25_000);
    expect(formCallMs(9_000)).toBe(9_000);
    expect(formCallMs(2_999)).toBe(0);
    expect(formCallMs(-5)).toBe(0);
  });
});
