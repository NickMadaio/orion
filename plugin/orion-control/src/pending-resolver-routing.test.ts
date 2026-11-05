// w20 r6: the resolver through the real routing hooks, and the web-offer yes in his wording (#25).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answersWebOffer } from "./chat-asks.js";
import { registerLocalRouting } from "./local-routing.js";

type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function chat() {
  const handlers = new Map<string, H[]>(); let t = new Date(2026, 10, 5, 6, 0).getTime(); let n = 0;
  registerLocalRouting({ on: (nm: string, fn: H) => handlers.set(nm, [...(handlers.get(nm) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pr-")), "r.jsonl"), clock: () => "Thu 06:00", now: () => new Date(t), brainSearch: async () => "",
    decideImpl: async (i: { message: string }) => (/^(?:go|that one|yeah go on then|ok do it)$/.test(i.message) ? { move: "answer", answer: "Go. You're good to start your day." } : { move: "escalate", tier: "standard" }) as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }) } as never);
  const fire = async (nm: string, e: Record<string, unknown>, ctx: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(nm) ?? []) out.push(await fn(e, ctx)); return out; };
  return async (said: string, replyAfter: string) => {
    t += 15_000; const ctx = { runId: `pr-${n++}`, sessionKey: "agent:main:orion-chat-pr" };
    await fire("before_model_resolve", { prompt: said }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: said }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    const heard = direct?.reply?.text ?? "";
    await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: heard || replyAfter, messages: [{ role: "assistant", content: [{ type: "text", text: heard || replyAfter }] }] }, ctx);
    return { heard, appended: built?.appendContext ?? "" };
  };
}

describe("a bare go-ahead", () => {
  it.each(["that one", "go", "yeah go on then", "ok do it"])("with nothing pending says so: %s", async (w) => {
    const say = chat();
    await say("bedtime tonight is half 11", "Set bedtime to 11:30 PM tonight.");
    const r = await say(w, "x");
    expect(r.heard, w).toMatch(/\?$/);
    expect(r.heard).not.toMatch(/start your day|bedtime/i);
  });
  it("after a question it goes to the worker with what it refers to", async () => {
    const say = chat();
    await say("im feeling a bit flat today", "Okay. Want to log some water or take a quick break?");
    const r = await say("that one", "x");
    expect(r.heard).toBe("");
    expect(r.appended).toContain("Want to log some water or take a quick break?");
  });
  it("a why-question between does not become the thing he answers", async () => {
    const say = chat();
    await say("log a mcdouble", "About 540 kcal. Want me to log it?");
    const r = await say("go", "x");
    expect(r.appended).toContain("Want me to log it?");
  });
});

describe("the web-player yes in his words (#25)", () => {
  it.each(["yeah go on then", "yeah go on", "go on then", "yes please mate", "ok go ahead then", "sure then"])("%s", (m) => expect(answersWebOffer(m), m).toBe(true));
  it.each(["go on then tell me the weather", "yeah but what about the time", "no thanks"])("%s is not a yes", (m) => expect(answersWebOffer(m), m).toBe(false));
});
