import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXACT_REPLY_PROMPT, registerLocalRouting } from "./local-routing.js";

// 2026-10-16 speed audit (docs/audits/2026-10-16-local-speed.md): prompt tokens are the cost of a local turn.
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

async function build(message: string, clock: string, extra: Record<string, unknown> = {}): Promise<{ systemPrompt: string; appendContext?: string }> {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-speed-")), "r.jsonl"), decideImpl: async () => ({ move: "escalate" }), clock: () => clock, brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), ...extra } as never);
  const ctx = { runId: "speed", sessionKey: "agent:main:orion-app-v2" };
  for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt: message }, ctx);
  return (await (handlers.get("before_prompt_build") ?? [])[0]!({ prompt: message, messages: [] }, ctx)) as { systemPrompt: string; appendContext?: string };
}

describe("code-written replies get a one-line system prompt", () => {
  it("a done flow: the exact text, no identity, no clock, no manual", async () => {
    const reply = "Done: small task 5:50 PM–6:20 PM.";
    const done = { scheduleFlow: async () => ({ outcome: "done", reply, calls: ["exec orion-reschedule add x"], outputs: ["ok"] }) };
    const built = await build("throw something small in before my class", "Fri 10:45", done);
    expect(built.systemPrompt).toContain(reply);
    expect(built.systemPrompt).toContain(EXACT_REPLY_PROMPT);
    expect(built.systemPrompt).not.toMatch(/Now:/);
    expect(built.systemPrompt.length).toBeLessThan(260);
    expect(built.appendContext).toContain(reply); // the latest message carries it too: history alone made the 9B paraphrase old turns
  });

  it("a say flow is just as small", async () => {
    const say = { scheduleFlow: async () => ({ outcome: "say", kind: "plain", text: "That doesn't fit before class; want it after?" }) };
    const built = await build("throw something small in before my class", "Fri 10:45", say);
    expect(built.systemPrompt).toContain("That doesn't fit before class; want it after?");
    expect(built.systemPrompt.length).toBeLessThan(260);
  });
});

describe("the worker prompt keeps a stable prefix", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["general", "what did I decide about my thesis topic", { brainSearch: async () => "## Thesis (Thesis.md)\n- topic: local LLM routing" }],
    ["overwhelmed", "everything is too much today", {}],
  ];
  for (const [name, message, extra] of cases) {
    it(`${name}: two minutes apart differ only in the last lines, and the clock is last`, async () => {
      const a = (await build(message, "Fri 10:45", extra)).systemPrompt;
      const b = (await build(message, "Fri 10:46", extra)).systemPrompt;
      expect(a).not.toBe(b);
      const first = a.indexOf("Now: Fri 10:45");
      expect(first).toBeGreaterThan(a.length * 0.5);
      expect(a.slice(0, first)).toBe(b.slice(0, b.indexOf("Now: Fri 10:46")));
      expect(a.slice(first).split("\n\n").length).toBeLessThanOrEqual(1); // nothing after the clock block
    });
  }

  it("per-turn facts (brain snippets) come after the fixed instructions", async () => {
    const withSnippet = (await build("what did I decide about my thesis topic", "Fri 10:45", { brainSearch: async () => "## Thesis (Thesis.md)\n- topic: local LLM routing" })).systemPrompt;
    const without = (await build("what did I decide about my thesis topic", "Fri 10:45")).systemPrompt;
    const at = withSnippet.indexOf("From his brain, matched");
    if (at >= 0) expect(withSnippet.slice(0, at).trimEnd()).toBe(without.slice(0, without.indexOf("Now: Fri 10:45")).trimEnd());
  });
});
