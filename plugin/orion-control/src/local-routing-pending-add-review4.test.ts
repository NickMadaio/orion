import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";
import type { PendingRun } from "./schedule-pending.js";

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

// r8 review 4 (2026-10-16): HIGH-1 a device request is not the add question's answer; MEDIUM-1 a front-desk draft
// must not answer it either; LOW a tomorrow add reads "day-tomorrow".
const PUSH_ASK: FlowResult = { outcome: "say", kind: "ask", text: "That would push Gym later — go ahead?",
  pending: { kind: "push", argvs: [["add", "Focus", "60", "--date", "2026-10-17"]], displaced: ["Gym"], when: "tomorrow" } };
const TITLE_ASK: FlowResult = { outcome: "say", kind: "ask", text: "What should I put before your 1:30 PM class?",
  pending: { kind: "title", ask: "What should I put before your 1:30 PM class?", minutes: 30, dateArgs: [], before: { minute: 810, label: "your 1:30 PM class" } } };
const DONE: FlowResult = { outcome: "done", calls: ["exec orion-reschedule add Focus 60"], outputs: ["Changed Friday:\n  planned Focus: 16:00–17:00\nWritten to his calendar."], marks: ["m9"] };

function harness(first: FlowResult, desk: (message: string) => Decision) {
  const f = fakeApi();
  const seen: Array<{ message: string; pending?: PendingRun }> = [];
  const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", clock: () => "Fri 10:05",
    decideImpl: async ({ message }): Promise<Decision> => desk(message),
    scheduleFlow: async (message, _clock, opts) => {
      const pending = (opts as { pending?: PendingRun } | undefined)?.pending;
      seen.push({ message, pending });
      if (pending) return DONE;
      return /focus|throw something/.test(message) ? first : { outcome: "fallback", reason: "t" };
    } });
  let n = 0;
  const turn = async (prompt: string, sessionKey = "agent:main:orion-chat-1") => {
    const ctx = { runId: `p${n += 1}`, sessionKey };
    await f.fire("before_model_resolve", { prompt }, ctx);
    const [reply] = (await f.fire("before_agent_reply", { prompt }, ctx)) as Array<{ handled?: boolean; reply?: { text: string } } | undefined>;
    const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    return { reply, prompt: built?.systemPrompt ?? "", ctx };
  };
  return { turn, seen, f, logPath };
}

const answer = (message: string): Decision => ({ move: "answer", answer: "Sure, done!" });

describe("MEDIUM-1 a front-desk draft never answers the add question", () => {
  it("before_agent_reply lets a pending yes through", async () => {
    const h = harness(PUSH_ASK, answer);
    await h.turn("add a 60 min focus block");
    const second = await h.turn("yes go ahead");
    expect(second.reply).toBeUndefined();
    expect(h.seen[1]!.pending).toMatchObject({ kind: "push" });
    expect(second.prompt).toMatch(/already made this change/);
  });
});

describe("HIGH-1 the front desk's tool move means it was not a title", () => {
  it("'turn off the lights' after 'What should I put before …?' books nothing", async () => {
    const h = harness(TITLE_ASK, (m) => (/lights/.test(m) ? { move: "tool", tool: "lights", args: {} } : { move: "escalate" }));
    await h.turn("throw something in before my class");
    const second = await h.turn("turn off the lights");
    expect(h.seen.filter((s) => s.pending)).toEqual([]);
    expect(second.prompt).not.toMatch(/already made this change/);
  });
  it("a short phrase the front desk routes to a tool ('kitchen lights') is not booked as a title", async () => {
    const h = harness(TITLE_ASK, (m) => (/lights/.test(m) ? { move: "tool", tool: "lights", args: {} } : { move: "escalate" }));
    await h.turn("throw something in before my class");
    await h.turn("kitchen lights");
    expect(h.seen.filter((s) => s.pending)).toEqual([]);
  });
  it("non-answers 'idk' and 'thanks' book nothing", async () => {
    for (const said of ["idk", "thanks", "yes, laundry? no", "i'm going to the gym"]) {
      const h = harness(TITLE_ASK, () => ({ move: "escalate" }));
      await h.turn("throw something in before my class");
      await h.turn(said);
      expect(h.seen.filter((s) => s.pending)).toEqual([]);
    }
  });
  it("'idk' asks the question once more, and a title then books", async () => {
    const h = harness(TITLE_ASK, () => ({ move: "escalate" }));
    await h.turn("throw something in before my class");
    const again = await h.turn("you pick");
    expect(again.prompt).toContain("What should I put before your 1:30 PM class?");
    await h.turn("yes, laundry");
    expect(h.seen.filter((s) => s.pending)[0]!.pending).toMatchObject({ kind: "title", title: "Laundry", reasked: true });
  });
});

describe("LOW a tomorrow add reads tomorrow", () => {
  it("the pending yes logs day-tomorrow", async () => {
    const h = harness(PUSH_ASK, () => ({ move: "escalate" }));
    await h.turn("add a 60 min focus block");
    const second = await h.turn("yes");
    await h.f.fire("before_agent_finalize", { runId: "p2", messages: [{ role: "assistant", content: "ok" }], hadDeterministicSideEffect: false }, second.ctx);
    const lines = readFileSync(h.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = lines.filter((l) => l.message === "yes").pop();
    expect(last?.reads ?? []).toContain("day-tomorrow");
  });
});
