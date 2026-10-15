import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceVerdict, registerLocalRouting, userText } from "./local-routing.js";
import { writeFileSync } from "node:fs";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";

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
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Sat 18:00", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "## Scheduling Rules  (20 Areas/Routine/Scheduling Rules.md)\n- [minimum] nap: at least 75 minutes" });
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
    expect(built?.systemPrompt).toMatch(/(tomorrow is|he means) \w+day \d{4}-\d{2}-\d{2}/);
    expect(built?.systemPrompt).toMatch(/orion-brain search/);
    expect(built?.systemPrompt).toMatch(/nap: at least 75 minutes/);
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

  it("with scheduleChangesToCloud, a calendar change keeps the configured model and its full prompt; other turns stay local", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", scheduleChangesToCloud: true, logPath, decideImpl: async () => ({ move: "escalate", tier: "standard" }), clock: () => "Mon 00:05" });
    const ctx = { runId: "c1", sessionKey: "agent:main:orion-app-v2" };
    expect(await f.fire("before_model_resolve", { prompt: "schedule me for cert courses between my two classes today" }, ctx)).toEqual([undefined]);
    expect(await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx)).toEqual([undefined]);
    const other = { runId: "c2", sessionKey: "agent:main:orion-app-v2" };
    expect(await f.fire("before_model_resolve", { prompt: "what did I write about my thesis" }, other)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
  });

  it("'on' is refused without a recent real-route acceptance pass — it runs shadow instead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lr-"));
    const acceptancePath = join(dir, "acceptance.json");
    const now = Date.parse("2026-10-12T10:00:00Z");
    expect(acceptanceVerdict(acceptancePath, now).ok).toBe(false);
    writeFileSync(acceptancePath, JSON.stringify({ at: "2026-10-10T15:30:00Z", n: 21, pass: 7, medianMs: 35297 }));
    expect(acceptanceVerdict(acceptancePath, now)).toMatchObject({ ok: false, why: expect.stringMatching(/7\/21/) });
    writeFileSync(acceptancePath, JSON.stringify({ at: "2026-10-11T15:30:00Z", n: 40, pass: 36, medianMs: 12000 }));
    expect(acceptanceVerdict(acceptancePath, now).ok).toBe(true);
    writeFileSync(acceptancePath, JSON.stringify({ at: "2026-09-01T15:30:00Z", n: 40, pass: 36, medianMs: 12000 }));
    expect(acceptanceVerdict(acceptancePath, now).ok).toBe(false);
    // Registered "on" with a failing record: never overrides the model.
    writeFileSync(acceptancePath, JSON.stringify({ at: new Date().toISOString(), n: 21, pass: 7, medianMs: 35297 }));
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", acceptancePath, logPath: join(dir, "r.jsonl"), decideImpl: async () => ({ move: "escalate" }) });
    expect(await f.fire("before_model_resolve", { prompt: "move gym to 7" }, { runId: "g1", sessionKey: "agent:main:x" })).toEqual([undefined]);
  });

  it("a testing window (max 48 h) lets 'on' run without acceptance; a window too far ahead or past does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lr-"));
    const acceptancePath = join(dir, "none.json");
    const reg = (testingUntil: string) => { const f = fakeApi(); registerLocalRouting(f.api, { warm: false, mode: "on", acceptancePath, testingUntil, logPath: join(dir, "r.jsonl"), brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }) }); return f; };
    const inHours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
    expect(await reg(inHours(5)).fire("before_model_resolve", { prompt: "move gym to 7" }, { runId: "t1", sessionKey: "agent:main:x" })).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
    expect(await reg(inHours(100)).fire("before_model_resolve", { prompt: "move gym to 7" }, { runId: "t2", sessionKey: "agent:main:x" })).toEqual([undefined]);
    expect(await reg(inHours(-1)).fire("before_model_resolve", { prompt: "move gym to 7" }, { runId: "t3", sessionKey: "agent:main:x" })).toEqual([undefined]);
  });

  it("a calendar change runs through the scheduling flow; the worker only phrases the scheduler's output", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }),
      scheduleFlow: async () => ({ outcome: "done", calls: ['exec orion-reschedule move "do cert courses" --to 12:35 --until 15:25'], outputs: ["Changed Monday:\n  do cert courses moved: 17:50 → 12:35–15:25\nWritten to his calendar."] }) });
    const ctx = { runId: "f1", sessionKey: "agent:main:x" };
    const msg = "schedule cert courses the entire time between DS and my lab";
    await f.fire("before_model_resolve", { prompt: msg }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/already made this change[\s\S]*do not call any tools[\s\S]*do cert courses now 12:35 PM–3:25 PM/);
    expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: do cert courses now 12:35 PM–3:25 PM." }, ctx)).toEqual([undefined]);
    expect(lines(logPath).at(-1)).toMatchObject({ flow: { outcome: "done" }, findings: [[]] });
  });

  it("delivers the scheduler's own reply (rewriting a paraphrase) and an honest line instead of a false claim", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }),
      scheduleFlow: async (m) => (/nuke/.test(m) ? { outcome: "done", calls: ["exec orion-reschedule drop --after lab"], outputs: ["Changed Monday:\n  cleared 2 prior schedule blocks: grind leetcode, deck"] } : { outcome: "fallback", reason: "t" }) });
    const ctx = { runId: "p1", sessionKey: "agent:main:x" };
    await f.fire("before_model_resolve", { prompt: "nuke everything after my lab" }, ctx);
    await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx);
    const [revise] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: grind leetcode 5:45 PM–7:20 PM" }, ctx)) as Array<Record<string, any>>;
    expect(revise).toMatchObject({ action: "revise" });
    expect(revise?.retry.instruction).toMatch(/exactly this text.*cleared grind leetcode, deck/);
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: grind leetcode 5:45 PM–7:20 PM" }, ctx);
    const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "Done: grind leetcode 5:45 PM–7:20 PM" }, runId: "p1", sessionKey: "agent:main:x" }, {})) as Array<Record<string, any>>;
    expect(sent?.payload.text).toBe("Done: cleared grind leetcode, deck.");
    // A false claim that survives the retries is replaced at delivery.
    const ctx2 = { runId: "p2", sessionKey: "agent:main:y" };
    await f.fire("before_model_resolve", { prompt: "stick 45 mins of macro after leetcode" }, ctx2);
    await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx2);
    for (let k = 0; k < 3; k++) await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I added 45 minutes of macro studying." }, ctx2);
    await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-agenda today" }, result: "today 5:15 PM — grind leetcode" }, ctx2);
    const [sent2] = (await f.fire("reply_payload_sending", { payload: { text: "I added 45 minutes of macro studying." }, runId: "p2", sessionKey: "agent:main:y" }, {})) as Array<Record<string, any>>;
    expect(sent2?.payload.text).toMatch(/didn't manage/);
  });

  it("a timed reminder goes to alarm_set (never orion-tasks), with the day worked out by code", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
    const f = fakeApi();
    let flowRan = false;
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "tool", tool: "alarm" }), scheduleFlow: async () => { flowRan = true; return { outcome: "fallback", reason: "t" }; },
      extractReminder: async () => ({ time: "11:00", label: "text the marketing group chat" }) });
    const ctx = { runId: "rm1", sessionKey: "agent:main:x" };
    const msg = "can you remind me tomorrow around 11 am to text the marketing group chat";
    await f.fire("before_model_resolve", { prompt: msg }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx)) as Array<{ systemPrompt: string; appendContext: string }>;
    expect(built?.systemPrompt).toMatch(/"action":"alarm_set","at":"\d{4}-\d{2}-\d{2}T11:00","label":"text the marketing group chat"/);
    expect(built?.appendContext).toMatch(/call orion_task_run now/);
    expect(flowRan).toBe(false);
    // Replied without calling the tool → told to call it; still not called → honest line at delivery.
    const [r1] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx)) as Array<Record<string, any>>;
    expect(r1?.retry.instruction).toMatch(/NOT set the reminder/);
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx);
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx);
    const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "I've set a reminder for 11." }, runId: "rm1", sessionKey: "agent:main:x" }, {})) as Array<Record<string, any>>;
    expect(sent?.payload.text).toMatch(/didn't manage to set that reminder/);
  });

  // 2026-10-15 12:12: one spoken request arrived as two turns. The first half ("…so if you can go ahead
  // and") resized a block on its own; the second ("put from 12:45 to 1:45 and push everything else") ran
  // without the first, so "meal prep" was never booked.
  describe("a request cut off mid-sentence", () => {
    const spoken = (text: string) => `[Orion app context]\nNick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n${text}`;
    const first = "I'm now, and I'm in a time block. But here's the thing. I don't really need to be in one right now. I'm gonna start meal prepping in about thirty minutes. So if you can go ahead and";
    const rest = "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) Put from twelve forty five to one forty five and then push everything else to kinda follow that, that would be lovely.";
    const mealPrep: FlowResult = { outcome: "done", calls: ['exec orion-reschedule add "meal prep" 60 --at 12:45'], outputs: ["Changed:\n  planned meal prep: 12:45–13:45"], marks: ["m2"] };
    const harness = (flowFor: (m: string) => FlowResult) => {
      const f = fakeApi(); const flows: Array<{ message: string; undo: string[] }> = []; const desk: string[] = [];
      registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 12:12",
        decideImpl: async ({ message }) => { desk.push(message); return { move: "escalate" }; },
        scheduleFlow: async (message, _clock, opts) => { flows.push({ message, undo: opts?.undo ?? [] }); return flowFor(message); } });
      const turn = async (runId: string, prompt: string) => {
        const ctx = { runId, sessionKey: "agent:main:orion-chat-1" };
        await f.fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, ctx);
        return built?.systemPrompt ?? "";
      };
      return { turn, flows, desk };
    };

    it("does not act on the half that trails off — it waits for the rest", async () => {
      const h = harness(() => ({ outcome: "fallback", reason: "t" }));
      expect(await h.turn("c1", spoken(first))).toMatch(/exactly this text[\s\S]*Go on\./);
      expect(h.flows).toEqual([]);
      expect(h.desk).toEqual([]); // no front-desk round trip for "go on"
    });

    it("reads the rest together with the first half, without the app's marker", async () => {
      const h = harness(() => mealPrep);
      await h.turn("c1", spoken(first));
      await h.turn("c2", spoken(rest));
      expect(h.flows).toHaveLength(1);
      expect(h.flows[0]!.message).toMatch(/^I'm now.*meal prepping.*go ahead and Put from twelve forty five.*follow that/);
      expect(h.flows[0]!.message).not.toMatch(/Continuing/);
      expect(h.desk.at(-1)).toMatch(/meal prepping.*twelve forty five/);
    });

    it("if the first half did change his day, the rest is told to undo exactly that first", async () => {
      const h = harness((m) => (/twelve forty five/.test(m) ? mealPrep
        : { outcome: "done", calls: ['exec orion-reschedule resize "finish resume" 30'], outputs: ["Changed:\n  finish resume is now 30 min: 11:20–11:50"], marks: ["m1"] }));
      await h.turn("c1", spoken("I'm in a time block but I don't need it. I'm gonna start meal prepping in about thirty minutes."));
      await h.turn("c2", spoken(rest));
      expect(h.flows.map((x) => x.undo)).toEqual([[], ["m1"]]);
      expect(h.flows[1]!.message).toMatch(/^I'm in a time block.*Put from twelve forty five/);
    });

    it("a typed message that trails off is not held", async () => {
      const h = harness(() => ({ outcome: "fallback", reason: "t" }));
      await h.turn("c1", "move gym to 6 and");
      expect(h.flows).toHaveLength(1);
    });
  });

  it("after midnight, 'tomorrow' means today's date", async () => {
    const { meansTomorrow } = await import("./schedule-flow.js");
    expect(meansTomorrow("remind me tomorrow at 11", new Date(2026, 9, 13, 0, 44))).toBe(false);
    expect(meansTomorrow("remind me tomorrow at 11", new Date(2026, 9, 13, 14, 0))).toBe(true);
    expect(meansTomorrow("remind me at 11", new Date(2026, 9, 13, 14, 0))).toBe(false);
  });
});

describe("local routing — focus sessions and false claims (2026-10-15)", () => {
  const SAID = "Can you go ahead and, uh, start a focus session? I wanna do some work.";
  const setup = (decision: Decision, sessionFlow?: (m: string) => Promise<FlowResult>) => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
    const f = fakeApi();
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Thu 22:40",
      scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "", readDay: async () => "1. Gym 18:00",
      ...(sessionFlow ? { sessionFlow } : {}) });
    return { f, logPath, ctx: { runId: "fs1", sessionKey: "agent:main:orion-chat-1" } };
  };
  const started: FlowResult = { outcome: "done", calls: ["exec orion-session start Focus --json"], outputs: ['{"ok":true,"status":"running"}'], reply: "Your focus session is running: block 1 of 3, 50 minutes." };

  it("code starts the session; the worker is told the exact reply and to call nothing", async () => {
    const asked: string[] = [];
    const { f, ctx, logPath } = setup({ move: "tool", tool: "session", args: { do: "start" } }, async (m) => { asked.push(m); return started; });
    await f.fire("before_model_resolve", { prompt: SAID }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: SAID, messages: [] }, ctx)) as Array<{ systemPrompt: string; appendContext: string }>;
    expect(asked).toEqual([SAID]);
    expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*Your focus session is running: block 1 of 3, 50 minutes\./);
    expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Your focus session is running: block 1 of 3, 50 minutes." }, ctx)).toEqual([undefined]);
    expect(lines(logPath).at(-1)).toMatchObject({ tools: 1, flow: { outcome: "done", calls: ["exec orion-session start Focus --json"] } });
  });

  it("a session start phrased as a question is still started, not answered from his calendar", async () => {
    const { f, ctx } = setup({ move: "tool", tool: "session", args: { do: "start" } }, async () => started);
    await f.fire("before_model_resolve", { prompt: "can you start a focus block?" }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: "can you start a focus block?", messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/Your focus session is running/);
    expect(built?.systemPrompt).not.toMatch(/read just now from his calendar/);
  });

  it("the front desk's draft never answers a session start in place of starting it", async () => {
    const { f, ctx } = setup({ move: "answer", answer: "Starting your focus session now." }, async () => started);
    await f.fire("before_model_resolve", { prompt: "start a focus session" }, ctx);
    expect(await f.fire("before_agent_reply", {}, ctx)).toEqual([undefined]);
  });

  it("a failed start is said plainly, exactly as the flow wrote it", async () => {
    const { f, ctx } = setup({ move: "tool", tool: "session", args: { do: "start" } },
      async () => ({ outcome: "say", kind: "plain", text: "I couldn't start the focus session: Orion is not running. Nothing is running." }));
    await f.fire("before_model_resolve", { prompt: SAID }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: SAID, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*I couldn't start the focus session: Orion is not running\./);
    expect(built?.systemPrompt).not.toMatch(/That doesn't fit/);
  });

  it("tonight's replay: a claimed action with no tool call ends with the honest line DICTATED, not left to delivery", async () => {
    // No session flow wired, so nothing runs — exactly the shape of the turn that lied.
    const { f, ctx } = setup({ move: "answer", answer: "Right here, Nick. What's on your mind?" });
    await f.fire("before_model_resolve", { prompt: "Right now." }, ctx);
    const lie = "I've started the focus session right now with those apps allowed.";
    const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx)) as Array<Record<string, any>>;
    expect(first).toMatchObject({ action: "revise" });
    const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx)) as Array<Record<string, any>>;
    expect(second).toMatchObject({ action: "revise" });
    expect(second?.retry.instruction).toMatch(/whole reply must be exactly this text.*I didn't actually do that — nothing was started or changed\./);
    expect(second?.retry.instruction).not.toMatch(/calendar changed/);
  });

  it("a calendar false claim keeps the calendar wording", async () => {
    const { f, ctx } = setup({ move: "escalate", tier: "standard" });
    await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
    for (let k = 0; k < 1; k++) await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx);
    const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx)) as Array<Record<string, any>>;
    expect(second?.retry.instruction).toMatch(/nothing on your calendar changed/);
  });
});

describe("local routing — distress (2026-10-16 live sweep)", () => {
  const setup = (decision: Decision) => {
    const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
    const f = fakeApi();
    const flows: string[] = [];
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Thu 23:46", brainSearch: async () => "",
      scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; }, readDay: async () => "1. Macro quiz 00:00" });
    return { f, logPath, flows, ctx: { runId: "d1", sessionKey: "agent:main:orion-chat-1" } };
  };

  it("q103: 'i literally cant do this anymore' gets the fixed safety reply (asks if he is safe, UK numbers), not the front desk's draft", async () => {
    const said = "i literally cant do this anymore";
    const { f, ctx, flows, logPath } = setup({ move: "answer", answer: "I hear you. Want to take a break or talk about what's going on?" });
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    const [direct] = (await f.fire("before_agent_reply", { cleanedBody: said }, ctx)) as Array<{ reply: { text: string } }>;
    expect(direct?.reply.text).toMatch(/Are you safe right now\?/);
    expect(direct?.reply.text).toMatch(/Samaritans[^.]*116 123/);
    expect(direct?.reply.text).toMatch(/\b999\b/);
    const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*do not call any tools[\s\S]*Are you safe right now\?/);
    expect(built?.systemPrompt).not.toMatch(/drafted this reply/);
    expect(flows).toEqual([]);
    const [revise] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I hear you. Want to take a break?" }, ctx)) as Array<Record<string, any>>;
    expect(revise?.retry.instruction).toMatch(/exactly this text[\s\S]*Samaritans/);
    await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I hear you. Want to take a break?" }, ctx);
    const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "I hear you. Want to take a break?" }, runId: "d1", sessionKey: "agent:main:orion-chat-1" }, {})) as Array<Record<string, any>>;
    expect(sent?.payload.text).toMatch(/Samaritans/);
    expect(lines(logPath).at(-1)).toMatchObject({ flow: { outcome: "say" }, tools: 0 });
  });

  it("q102: 'im so overwhelmed i dont even know where to start' gets empathy and one small step, with no lookups", async () => {
    const said = "im so overwhelmed i dont even know where to start";
    const { f, ctx, flows } = setup({ move: "escalate", tier: "standard" });
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    expect(await f.fire("before_agent_reply", { cleanedBody: said }, ctx)).toEqual([undefined]);
    const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(built?.systemPrompt).toMatch(/overwhelmed[\s\S]*ONE small first step[\s\S]*Do not call any tools/);
    expect(built?.systemPrompt).not.toMatch(/orion-agenda|orion-brain/);
    expect(flows).toEqual([]);
  });

  it("an ordinary 'I can't do this' about a task is still a calendar change", async () => {
    const said = "I can't do this task today, move it to tomorrow";
    const { f, ctx, flows } = setup({ move: "escalate", tier: "quick" });
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(flows).toEqual([said]);
    expect(built?.systemPrompt).not.toMatch(/Samaritans|overwhelmed/);
  });
});
