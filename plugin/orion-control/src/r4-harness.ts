// Shared harness for the w20 round-4 food / note / list / fix tests: the real routing hooks, with every effect a stub.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { FoodRun } from "./food-chat.js";
import type { LedgerRun } from "./ledger-run.js";
import type { SelffixRun } from "./selffix-flow.js";
import type { FlowResult } from "./schedule-flow.js";
import type { ChatDeps } from "./chat-asks.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
export const NOW = new Date(2026, 10, 5, 13, 0);

export type Rig = {
  turn: (prompt: string) => Promise<string | undefined>;
  dir: string;
  flows: string[];
  fire: (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown[]>;
  setClock: (ms: number) => void;
};
export type RigOptions = {
  foodRun?: FoodRun; ledgerRun?: LedgerRun; selffixRun?: SelffixRun; noteFlow?: (m: string, b?: boolean) => Promise<FlowResult>;
  chatRun?: ChatDeps; todoDoneFlow?: (m: string) => Promise<FlowResult>; health?: object;
  decide?: Decision; extractReminder?: (m: string) => Promise<{ time: string | null; label: string } | null>; day?: import("./schedule-flow.js").Day; scheduleFlow?: (m: string) => Promise<FlowResult>;
};

/** A chat session; `turn` returns the direct reply when code owns it, else the drafted system prompt text (what the worker is told to say). */
export function rig(o: RigOptions): Rig {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, c)); return out; };
  const dir = mkdtempSync(join(tmpdir(), "r4-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify(o.health ?? { schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
  const flows: string[] = [];
  let clock = NOW.getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 13:00", now: () => new Date(clock),
    decideImpl: async () => (o.decide ?? { move: "escalate" }) as Decision, brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return o.scheduleFlow ? o.scheduleFlow(m) : { outcome: "fallback", reason: "test" }; },
    readDayJson: async () => o.day, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [],
    ...(o.foodRun ? { foodRun: o.foodRun } : {}), ...(o.ledgerRun ? { ledgerRun: o.ledgerRun } : {}), ...(o.selffixRun ? { selffixRun: o.selffixRun } : {}),
    ...(o.extractReminder ? { extractReminder: o.extractReminder } : {}),
    ...(o.noteFlow ? { noteFlow: o.noteFlow } : {}), ...(o.chatRun ? { chatRun: o.chatRun } : {}), ...(o.todoDoneFlow ? { todoDoneFlow: o.todoDoneFlow } : {}),
  } as never);
  let n = 0;
  const turn = async (prompt: string): Promise<string | undefined> => {
    clock += 30_000;
    const ctx = { runId: `r4-${n += 1}`, sessionKey: "agent:main:orion-chat-r4" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    await fire("before_agent_finalize", { messages: [{ role: "assistant", content: direct?.reply?.text ?? "ok" }] }, ctx);
    const drafted = built?.systemPrompt ?? "";
    const exact = /do not call any tools:\s*([\s\S]*)$/.exec(drafted)?.[1]?.trim();   // the fixed reply code hands the model to say
    return direct?.reply?.text ?? exact ?? drafted;
  };
  return { turn, dir, flows, fire, setClock: (ms) => { clock = ms; } };
}
