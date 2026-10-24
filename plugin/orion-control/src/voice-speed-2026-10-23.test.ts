// 2026-10-23 voice audit (docs/audits/2026-10-23-voice-latency.md): a spoken turn spent ~5 s of an 18 s silence in three
// finalize passes. A spoken turn now gets one revise round; after it, code says the honest line itself.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOKUP_HONEST, MESSAGES_UNSURE, SPOKEN_STOP, SPOKEN_STOP_WROTE, honestLine, registerLocalRouting, spokenFinalLine } from "./local-routing.js";
import { checkWork } from "./work-check.js";
import { REVISE_PASSES, SPOKEN_REVISE_PASSES, revisePasses } from "./turn-budget.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

async function finalizeRounds(prompt: string, runId: string): Promise<number> {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "voice-speed-"));
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), decideImpl: async () => ({ move: "escalate" }),
    clock: () => "Thu 20:45", brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) } as never);
  const ctx = { runId, sessionKey: "agent:main:orion-chat-voice" };
  await fire("before_model_resolve", { prompt }, ctx);
  await fire("before_prompt_build", { prompt, messages: [] }, ctx);
  let revises = 0;
  for (let i = 0; i < 4; i += 1) {
    const out = (await fire("before_agent_finalize", { lastAssistantMessage: "Done, I've moved Gym to 6 PM and booked it.", hadDeterministicSideEffect: false }, ctx)) as Array<{ action?: string } | undefined>;
    if (!out.some((o) => o?.action === "revise")) break;
    revises += 1;
  }
  return revises;
}

const SPOKEN_PREFIX = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";

describe("spoken turns get one revise round", () => {
  it("the budget", () => {
    expect(revisePasses(true)).toBe(SPOKEN_REVISE_PASSES);
    expect(revisePasses(false)).toBe(REVISE_PASSES);
    expect(SPOKEN_REVISE_PASSES).toBeLessThan(REVISE_PASSES);
  });

  it("a typed turn with a false claim is revised twice, a spoken one once", async () => {
    const typed = await finalizeRounds("move gym to 6 pm", "typed-1");
    const spoken = await finalizeRounds(`${SPOKEN_PREFIX}move gym to 6 pm`, "spoken-1");
    expect(typed).toBe(REVISE_PASSES);
    expect(spoken).toBe(SPOKEN_REVISE_PASSES);
  });
});

// Review of feat/voice-fluid, HIGH 3: after the spoken turn's single retry, any open finding ends in code's honest line.
type Tool = { command: string; result: string };
async function spokenFinal(message: string, replies: [string, string], tools: Tool[] = [], toolName = "exec", hostDrops = false): Promise<{ text: string; revises: number }> {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "voice-honest-"));
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), decideImpl: async () => ({ move: "escalate" }),
    clock: () => "Thu 20:45", brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) } as never);
  const prompt = `${SPOKEN_PREFIX}${message}`;
  const ctx = { runId: `h-${message.length}-${replies[0].length}`, sessionKey: "agent:main:orion-chat-voice" };
  await fire("before_model_resolve", { prompt }, ctx);
  await fire("before_prompt_build", { prompt, messages: [] }, ctx);
  for (const t of tools) await fire("after_tool_call", { toolName, params: { command: t.command }, result: t.result }, ctx);
  let revises = 0;
  let text = "";
  for (const reply of replies) {
    const messages = [{ role: "user", content: prompt }, { role: "assistant", content: reply }];
    const out = (await fire("before_agent_finalize", { lastAssistantMessage: reply, messages, hadDeterministicSideEffect: hostDrops }, ctx)) as Array<{ action?: string } | undefined>;
    text = String(messages[1]!.content);
    if (!out.some((o) => o?.action === "revise")) break;
    revises += 1;
  }
  return { text, revises };
}

describe("a spoken turn's final reply after its one retry (HIGH 3)", () => {
  it("false claim: the calendar honest line, not the success line", async () => {
    const r = await spokenFinal("move gym to 6 pm", ["Done, I've moved Gym to 6 PM.", "All set, Gym is moved to 6 PM."]);
    expect(r.revises).toBe(1);
    expect(r.text).toBe(honestLine(true));
  });

  it("failure not mentioned: a failed write never ends in a clean success line", async () => {
    const tools = [{ command: "orion-reschedule add \"Gym\" 18:00", result: "error: the calendar refused the change" }];
    expect(checkWork({ reply: "See you at the gym at 6.", turnResults: [{ canonical: "exec orion-reschedule add Gym 18:00", stdout: "error: the calendar refused the change", exit: null }], finished: true })).toContain("failure not mentioned");
    const r = await spokenFinal("put gym at 6 pm", ["See you at the gym at 6.", "Enjoy the gym at 6!"], tools);
    expect(r.revises).toBe(1);
    expect(r.text).not.toMatch(/enjoy|see you/i);
    expect([honestLine(true), SPOKEN_STOP_WROTE]).toContain(r.text);
  });

  it("did not finish: an empty reply becomes the honest line", async () => {
    const r = await spokenFinal("tell me a fun fact", ["", ""]);
    expect(r.revises).toBe(1);
    expect(r.text).toBe(SPOKEN_STOP);
  });

  it("invented lookup: the lookup honest line", async () => {
    const r = await spokenFinal("any new emails from my professor", ["I checked your inbox and there's nothing new from your professor.", "I checked your inbox again and there is nothing new from him."]);
    expect(r.revises).toBe(1);
    expect(r.text).toBe(LOOKUP_HONEST);
  });

  it("a clean reply after the retry stands", async () => {
    const r = await spokenFinal("move gym to 6 pm", ["Done, I've moved Gym to 6 PM.", "I couldn't move Gym — nothing on your calendar changed."]);
    expect(r.revises).toBe(1);
    expect(r.text).toBe("I couldn't move Gym — nothing on your calendar changed.");
  });

  it("blocking findings map to an honest line; overlap and duplicate only with calendar data", () => {
    const cal = { calendar: true, wrote: true };
    for (const f of ["failure not mentioned", "did not finish"]) {
      expect(spokenFinalLine([f], cal), f).toBe(SPOKEN_STOP_WROTE);
      expect(spokenFinalLine([f], { calendar: true, wrote: false }), f).toBe(honestLine(true));
      expect(spokenFinalLine([f], { calendar: false, wrote: false }), f).toBe(SPOKEN_STOP);
    }
    for (const f of ["overlap left", "duplicate block"]) {
      expect(spokenFinalLine([f], cal), f).toBeUndefined();
      expect(spokenFinalLine([f], { ...cal, calendarChecked: true }), f).toBe(SPOKEN_STOP_WROTE);
    }
    for (const f of ["reply times don't match", "last change incomplete", "block lost", "asked instead of acting", "said it can't without checking"]) {
      expect(spokenFinalLine([f], cal), f).toBeUndefined();
    }
    expect(spokenFinalLine(["claims what the tools don't show", "overlap left"], cal)).toBe(honestLine(true));
    expect(spokenFinalLine(["promised but did not act"], { calendar: false, wrote: false })).toBe(honestLine(false));
    expect(spokenFinalLine(["claims a lookup it did not do"], cal)).toBe(LOOKUP_HONEST);
    expect(spokenFinalLine(["denies messages it shows"], cal)).toBe(MESSAGES_UNSURE);
    expect(spokenFinalLine([], cal)).toBeUndefined();
    for (const line of [SPOKEN_STOP, SPOKEN_STOP_WROTE]) expect(line).toMatch(/won't say it's done/);
  });
});

// Re-review HIGH: the code-written line must not replace a real success.
describe("a real success keeps its reply; a real failure still gets the honest line", () => {
  const moved = [{ command: 'orion-reschedule move "Gym" 18:00', result: "DONE — this really happened: Gym moved to 18:00-19:30 (was 20:15)" }];

  it("a real move with a mismatched time keeps the model's reply after its retry", async () => {
    const reply = "Done, Gym is now at 7 PM.";
    expect(checkWork({ reply, turnResults: [{ canonical: 'exec orion-reschedule move "Gym" 18:00', stdout: moved[0]!.result, exit: null }], finished: true })).toEqual(["reply times don't match"]);
    const r = await spokenFinal("move gym to 6 pm", [reply, "Done, Gym is now at 6 PM."], moved);
    expect(r.text).toBe("Done, Gym is now at 6 PM.");
    const stuck = await spokenFinal("move gym to 6 pm", [reply, reply], moved);
    expect(stuck.text).toBe(reply);
    expect(stuck.text).not.toMatch(/went wrong|couldn't/);
  });

  it("a real move when the host drops the retry keeps the model's reply", async () => {
    const r = await spokenFinal("move gym to 6 pm", ["Done, Gym is now at 7 PM.", ""], moved, "exec", true);
    expect(r.revises).toBe(0);
    expect(r.text).toBe("Done, Gym is now at 7 PM.");
  });

  it("a real failure the host gives no retry for still gets the honest line", async () => {
    const failed = [{ command: 'orion-reschedule add "Gym" 18:00', result: "error: the calendar refused the change" }];
    const r = await spokenFinal("put gym at 6 pm", ["See you at the gym at 6.", ""], failed, "exec", true);
    expect(r.revises).toBe(0);
    expect([honestLine(true), SPOKEN_STOP_WROTE]).toContain(r.text);
  });

  it("the scheduler's own honest line (honestNow) is kept, not replaced", async () => {
    const nothing = [{ command: 'orion-reschedule late 15', result: "NOTHING WAS BOOKED — nothing after now moved" }];
    const r = await spokenFinal("push everything 15 minutes", ["Done, I've pushed everything back 15 minutes.", ""], nothing, "exec", true);
    expect(r.text).not.toBe(SPOKEN_STOP_WROTE);
    expect(r.text).not.toBe(honestLine(true));
    expect(r.text).toMatch(/nothing|couldn't/i);
  });
});
