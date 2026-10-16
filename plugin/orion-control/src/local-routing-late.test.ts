import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instructionsFor, registerLocalRouting } from "./local-routing.js";
import { SCHEDULING_INSTRUCTIONS } from "./job-instructions.js";
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
  };
}

// Live sweep 2026-10-15, q029: "im running late" got the front desk's "Got it. Hope you make it safely."
// and nothing on his day moved; the scheduler has a `late` command for exactly this.
describe("running late reaches the calendar flow", () => {
  const harness = (decision: Decision) => {
    const f = fakeApi(); const flows: string[] = [];
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 09:10",
      decideImpl: async () => decision, scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "t" }; } });
    const turn = async (prompt: string) => {
      const ctx = { runId: `late${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
      await f.fire("before_model_resolve", { prompt }, ctx);
      const replied = await f.fire("before_agent_reply", { cleanedBody: prompt }, ctx);
      await f.fire("before_prompt_build", { prompt, messages: [] }, ctx);
      return replied;
    };
    return { turn, flows };
  };

  for (const msg of ["im running late", "running 15 min behind", "the lecture ran over by 20 min"]) {
    it(`"${msg}" is a change to his day, not a drafted reply`, async () => {
      const h = harness({ move: "answer", answer: "Got it. Hope you make it safely." });
      expect(await h.turn(msg)).toEqual([undefined]);
      expect(h.flows).toEqual([msg]);
    });
  }

  it("if the flow falls back, the worker gets the scheduler's instructions (it has late and overrun)", () => {
    expect(instructionsFor(undefined, "im running late")).toBe(SCHEDULING_INSTRUCTIONS);
  });

  // (review, 2026-10-16) "over"/"behind" matched plain talk and wrote blocks.
  for (const msg of ["i'm going over my notes for the exam", "just going over the slides", "the talk went over well", "i almost got run over by a bike", "i'm behind on my reading"]) {
    it(`"${msg}" is not running late`, async () => {
      const h = harness({ move: "answer", answer: "Sounds good." });
      await h.turn(msg);
      expect(h.flows).toEqual([]);
    });
  }
  for (const msg of ["the lecture ran over", "my meeting ran 20 over", "i'm behind schedule", "i'm 15 min behind", "class ran over"]) {
    it(`"${msg}" still is`, async () => {
      const h = harness({ move: "answer", answer: "Got it." });
      await h.turn(msg);
      expect(h.flows).toEqual([msg]);
    });
  }

  it("'I stayed up late' is not running late", async () => {
    const h = harness({ move: "answer", answer: "Get some rest." });
    expect(await h.turn("i stayed up late")).toEqual([{ handled: true, reply: { text: "Get some rest." }, reason: "front desk answered" }]);
    expect(h.flows).toEqual([]);
  });
});
