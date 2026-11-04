// The water goal through the real routing (2026-11-04): set, read, never the desk, never a model, never a log of water.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const SPOKEN = "";
const MON = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const DAY: Day = { date: "2026-11-02", now: null, blocks: [
  { title: "CS2100 Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
  { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
] };

function route(decide: (message: string) => Decision, opts: { now?: Date; day?: Day; files?: Record<string, string> } = {}) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "wave4h-"));
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(dir, name), text);
  const writes: string[][] = []; const sessionCalls: string[][] = []; const flows: string[] = []; const sessionFlows: string[] = [];
  let clock = (opts.now ?? MON(13, 0)).getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => new Date(clock),
    decideImpl: async (i: { message: string }) => decide(i.message), brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
    readDayJson: async () => opts.day ?? DAY, readDeadlines: async () => ({ events: [], tasks: [] }),
    realityRun: async (_s: string, args: string[]) => { writes.push(args); return { stdout: args[0] === "add" ? `Booked ${args[1]} 21:00–22:00` : "ok", code: 0 }; },
    extractReminder: async (m: string) => ({ time: /\b6\b/.test(m) ? "18:00" : null, label: m.includes("alarm") ? "the army is coming" : "call my mom" }),
    listReminders: async () => [],
  } as never);
  let n = 0;
  const turn = async (prompt: string, opt: { reply?: string; command?: string } = {}) => {
    const ctx = { runId: `w-${n += 1}`, sessionKey: "agent:main:orion-chat-wave2" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string }>;
    const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    const tool = opt.command ? ((await fire("before_tool_call", { toolName: "exec", params: { command: opt.command } }, ctx)) as Array<{ block?: boolean } | undefined>).find(Boolean) : undefined;
    const messages = [{ role: "assistant", content: [{ type: "text", text: opt.reply ?? exact ?? "ok" }] }];
    const [fin] = (await fire("before_agent_finalize", { lastAssistantMessage: opt.reply ?? exact ?? "ok", messages }, ctx)) as Array<unknown>;
    return { exact, built, direct: direct?.reply?.text, tool, fin, final: JSON.stringify(messages) };
  };
  return { turn, writes, dir, read: (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown> };
}

const HEALTH = (extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "orion.health.v3", updatedAt: "2026-11-01T00:00:00Z", supplements: [], supplementLog: {}, workouts: [],
  days: { "2026-11-02": { waterBottles: 3, calories: 0, supplementIDs: [], updatedAt: "" } }, ...extra });
const desk = () => ({ move: "answer", answer: "Sounds good. Did you finish your workout yet?" }) as Decision;

describe("the water goal through the routing", () => {
  it("sets it from a casual sentence, says so, and writes the shared setting", async () => {
    const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
    const v = await r.turn("ok so i wanna drink 11 bottles a day now");
    expect(v.exact).toBe("Water goal is now 11 bottles a day (was 9). You're at 3 today.");
    expect((r.read("health-log.json").nutritionGoals as Record<string, unknown>).water).toBe(11);
    expect(r.writes).toEqual([]);
    const c = await r.turn("set my water goal to 8");
    expect(c.exact).toBe("Water goal is now 8 bottles a day (was 11). You're at 3 today.");
  });
  it("answers the question from the file, not the desk", async () => {
    const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH({ nutritionGoals: { water: 12 } }) } });
    const v = await r.turn("whats my water goal");
    expect(v.exact).toBe("Your water goal is 12 bottles a day. You're at 3 today.");
  });
  it("logging water is not a goal change", async () => {
    const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
    await r.turn("i drank 2 bottles of water");
    expect(r.read("health-log.json").nutritionGoals).toBeUndefined();
  });
});
