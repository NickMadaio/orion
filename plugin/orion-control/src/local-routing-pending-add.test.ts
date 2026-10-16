import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";
import { ADD_DECLINED, type PendingRun } from "./schedule-pending.js";

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

// r8 review 3 H1 (2026-10-16): the answer to "That would push Gym later — go ahead?" or "What should I put
// before your 1:30 PM class?" is the add flow's, never the worker's.
const PUSH_ASK: FlowResult = { outcome: "say", kind: "ask", text: "That would push Gym later — go ahead?",
  pending: { kind: "push", argvs: [["add", "Focus", "60"]], displaced: ["Gym"] } };
const TITLE_ASK: FlowResult = { outcome: "say", kind: "ask", text: "What should I put before your 1:30 PM class?",
  pending: { kind: "title", ask: "What should I put before your 1:30 PM class?", minutes: 30, dateArgs: [], before: { minute: 810, label: "your 1:30 PM class" } } };
const DONE: FlowResult = { outcome: "done", calls: ["exec orion-reschedule add Focus 60"], outputs: ["Changed Friday:\n  planned Focus: 16:00–17:00\nWritten to his calendar."], marks: ["m9"] };

function harness(first: FlowResult) {
  const f = fakeApi();
  const seen: Array<{ message: string; pending?: PendingRun }> = [];
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 10:05",
    decideImpl: async (): Promise<Decision> => ({ move: "answer", answer: "Sure." }),
    scheduleFlow: async (message, _clock, opts) => {
      seen.push({ message, pending: (opts as { pending?: PendingRun } | undefined)?.pending });
      if ((opts as { pending?: PendingRun } | undefined)?.pending) return DONE;
      return /focus|throw something/.test(message) ? first : { outcome: "fallback", reason: "t" };
    } });
  let n = 0;
  const turn = async (prompt: string, sessionKey = "agent:main:orion-chat-1") => {
    const ctx = { runId: `p${n += 1}`, sessionKey };
    await f.fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    return built?.systemPrompt ?? "";
  };
  return { turn, seen };
}

describe("pending add follow-up", () => {
  it("a bare yes after the push question runs the stored add, replied from the scheduler's lines", async () => {
    const h = harness(PUSH_ASK);
    expect(await h.turn("add a 60 min focus block")).toContain("That would push Gym later");
    const prompt = await h.turn("yes go ahead");
    expect(h.seen[1]!.pending).toMatchObject({ kind: "push", argvs: [["add", "Focus", "60"]] });
    expect(prompt).toContain("planned Focus".replace("planned ", "")); // the reply is built from the scheduler output
    expect(prompt).toMatch(/already made this change/);
  });

  it("a short title after the unnamed ask goes back to the flow with the stored anchor", async () => {
    const h = harness(TITLE_ASK);
    expect(await h.turn("throw something in before my class")).toContain("What should I put before your 1:30 PM class?");
    await h.turn("laundry");
    expect(h.seen[1]!.pending).toMatchObject({ kind: "title", title: "Laundry", before: { minute: 810 } });
  });

  it("no declines, with nothing run", async () => {
    const h = harness(PUSH_ASK);
    await h.turn("add a 60 min focus block");
    const prompt = await h.turn("nah");
    expect(prompt).toContain(ADD_DECLINED);
    expect(h.seen).toHaveLength(1);
  });

  it("any other turn clears it: a later yes never runs the stored add", async () => {
    const h = harness(PUSH_ASK);
    await h.turn("add a 60 min focus block");
    await h.turn("what's the weather like");
    await h.turn("yes go ahead");
    expect(h.seen.filter((s) => s.pending)).toEqual([]);
  });

  it("a pending add is one session's: another session's yes does not run it", async () => {
    const h = harness(PUSH_ASK);
    await h.turn("add a 60 min focus block");
    await h.turn("yes", "agent:main:orion-chat-2");
    expect(h.seen.filter((s) => s.pending)).toEqual([]);
  });

  it("the answer is used once", async () => {
    const h = harness(PUSH_ASK);
    await h.turn("add a 60 min focus block");
    await h.turn("yes");
    await h.turn("yes");
    expect(h.seen.filter((s) => s.pending)).toHaveLength(1);
  });
});
