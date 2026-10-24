// 2026-10-23 voice audit (docs/audits/2026-10-23-voice-latency.md): a spoken turn spent ~5 s of an 18 s silence in three
// finalize passes. A spoken turn now gets one revise round; after it, code says the honest line itself.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
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
