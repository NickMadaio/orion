// w20 fix-sleep: a bedtime the health reader catches goes through orion-sleepplan (the one writer), so scope, bedFixed and read-back match the sleep-plan route.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { SleepRun } from "./sleep-plan-flow.js";

const EVENING = new Date(2026, 10, 3, 20, 0);
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function setup() {
  const calls: string[][] = [];
  const stateDir = mkdtempSync(join(tmpdir(), "hbr-"));
  const run: SleepRun = async (args) => {
    calls.push(args);
    return { code: 0, stdout: JSON.stringify({ ok: true, readback: { evening: "2026-11-03", sleepBy: "23:00", nudgeAt: "22:30", wake: "09:00", wakeDate: "2026-11-04", alarmAsked: false, hours: 10, lockdownBelowHours: 6, tonightOnly: args.includes("--tonight"), standing: "00:00" } }) };
  };
  const handlers = new Map<string, Handler[]>();
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "hbrl-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Tue 20:00", now: () => EVENING,
    stateDir, decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }), sleepPlanRun: run,
  });
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `h${n += 1}`, sessionKey: "agent:main:orion-chat-hbr" };
    for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt }, ctx);
    for (const fn of handlers.get("before_agent_reply") ?? []) { const o = (await fn({ prompt }, ctx)) as { reply?: { text?: string } } | undefined; if (o?.reply?.text) return o.reply.text; }
    let reply = "";
    for (const fn of handlers.get("before_prompt_build") ?? []) { const o = (await fn({ prompt, messages: [] }, ctx)) as { appendContext?: string } | undefined; reply = o?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? reply; }
    return reply;
  };
  return { calls, stateDir, turn };
}

describe("health-reader bedtimes use the one writer", () => {
  it("'bed by 11' is tonight, through orion-sleepplan, and never writes life-config itself", async () => {
    const { calls, stateDir, turn } = setup();
    const reply = await turn("bed by 11 lol");
    expect(calls[0]).toEqual(["bedtime", "23:00", "--tonight", "--json"]);
    expect(reply).toContain("tonight");
    expect(existsSync(join(stateDir, "life-config.json"))).toBe(false);
  }, 30000);
  it("'set my bedtime to 11:30 for the rest of the week' is the standing bedtime, through the writer", async () => {
    const { calls, stateDir, turn } = setup();
    await turn("set my bedtime to 11:30 for the rest of the week");
    expect(calls[0]).toEqual(["bedtime", "23:30", "--json"]);
    expect(existsSync(join(stateDir, "life-config.json"))).toBe(false);
  }, 30000);
});
