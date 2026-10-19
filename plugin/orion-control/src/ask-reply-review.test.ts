import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answersAsk, registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { AskContext } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness() {
  const handlers = new Map<string, Handler[]>();
  const seen: Array<{ message: string; askContext?: AskContext }> = [];
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 14:30",
    decideImpl: async (): Promise<Decision> => ({ move: "answer", answer: "Sure." }),
    scheduleFlow: async (message, _clock, opts) => { seen.push({ message, askContext: opts?.askContext }); return { outcome: "fallback", reason: "t" }; } });
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `r${n += 1}`, sessionKey: "agent:main:orion-chat-1" };
    for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt }, ctx);
    for (const fn of handlers.get("before_prompt_build") ?? []) await fn({ prompt, messages: [] }, ctx);
  };
  return { turn, seen };
}
// The line the Mac app writes (OutreachContext.label), with the real wording and a block TITLE.
const BLANK = '[ORION context: 38 min ago you asked "Nothing planned till 4 - what are you up to?" (blank ask about 14:00-now, he is away). If he says what he did or is doing, log it.]\n';
const MISMATCH = '[ORION context: 5 min ago you asked "Time to start: finish resume." (finish resume, planned 14:00-16:00, not started). If he says what he did or is doing, log it.]\n';

describe("review 7: an open ask forces the schedule flow only for a reply that plausibly answers it", () => {
  it("answersAsk", () => {
    for (const yes of ["at the gym since 2", "nothing really", "i was reading", "gym 2-4", "did gym instead of resume"]) expect(answersAsk(yes), yes).toBe(true);
    for (const no of ["turn the lights off", "play some music", "remind me to call mom", "thanks", "x".repeat(300)]) expect(answersAsk(no), no).toBe(false);
  });
  it("an unrelated message within 90 minutes of an ask does not enter the flow; an answer does, with the ask's context", async () => {
    const h = harness();
    await h.turn(`${BLANK}turn the lights off`);
    expect(h.seen).toEqual([]);
    await h.turn(`${BLANK}at the gym since 2`);
    expect(h.seen.length).toBe(1);
    expect(h.seen[0]?.askContext).toMatchObject({ start: "14:00", end: "now" });
  });
  it("a not-started ask carries the block title through to the flow", async () => {
    const h = harness();
    await h.turn(`${MISMATCH}i was at the library`);
    expect(h.seen[0]?.askContext?.block).toEqual({ title: "finish resume", start: "14:00", end: "16:00" });
  });
});
