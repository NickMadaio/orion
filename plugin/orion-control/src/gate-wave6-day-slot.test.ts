// Wave 6 (gate run-1101003318, loop-calendar-question-reply-v): "changed" to "is Study for CS Midterm still happening?" at 2:30 PM got
// "There's no free 90 min left today" while 20:30-24:00 was free: the slot search stopped at a fixed 10 PM. It now stops at his bedtime
// less wind-down (life-config.json), and the slot it finds is offered. Through the routing hooks over a fake day. No real paths.
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { dayEndFor } from "./life-window.js";
import type { Decision } from "./front-desk.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const label = (text: string, minutes = 0) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const b = (title: string, start: string, end: string, fixed = false, kind?: string): DayBlock => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const at = (hh: number, mm: number) => new Date(2026, 10, 2, hh, mm);
const MON = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("MKTG2201", "13:30", "15:30", true, "class"), b("Study for CS Midterm", "14:00", "15:30", false, "study"), b("Gym", "17:00", "18:30", false, "gym"), b("Side project", "19:30", "20:30", false, "side_project")] });
const ASK = "is Study for CS Midterm still happening, or did plans change?";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness(now: Date, stateDir: string) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = [];
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6d-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 14:30", now: () => now, stateDir,
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "quick" }),
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); return { outcome: "done", calls: ["exec orion-reschedule"], outputs: ["Done."], marks: ["m"], reply: "Done." }; },
    readDayJson: async () => MON(),
    checkinRun: async () => ({ stdout: "ok ci-abc123", code: 0 }),
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `w6d${n += 1}-${Math.random()}`, sessionKey: "agent:main:orion-chat-w6d" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, flows };
}
const state = (config?: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "w6d-state-"));
  if (config) writeFileSync(join(dir, "life-config.json"), JSON.stringify(config));
  appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "o1", text: ASK, at: at(14, 10).toISOString(), channel: "mac-bubble" })}\n`);
  return dir;
};

describe("plans changed: the next free slot runs to his bedtime, not 10 PM", () => {
  it("'changed' at 2:30 PM, bedtime midnight: offers 8:35 PM (after Side project), nothing written yet", async () => {
    const h = harness(at(14, 30), state({ bedtime: "00:00", windDownMinutes: 30 }));
    expect(await h.turn(`${label(ASK, 20)}${APP}changed`)).toBe("Okay — want Study for CS Midterm moved to 8:35 PM, or somewhere else? Say yes, or a time.");
    expect(h.flows).toEqual([]);
  });
  it("then 'ya' books it there", async () => {
    const h = harness(at(14, 30), state({ bedtime: "00:00" }));
    await h.turn(`${label(ASK, 20)}${APP}changed`);
    await h.turn(`${APP}ya do that`);
    expect(h.flows).toEqual(["move Study for CS Midterm to 8:35pm"]);
  });
  it.each(["plans changed tbh", "nah changed"])("held out: '%s' finds the evening slot too", async (said) => {
    const h = harness(at(14, 30), state());
    expect(await h.turn(`${label(ASK, 20)}${APP}${said}`)).toMatch(/moved to 8:35 PM/);
  });
  it("an early bedtime still leaves no room, and says so", async () => {
    const h = harness(at(14, 30), state({ bedtime: "22:00", windDownMinutes: 30 }));
    expect(await h.turn(`${label(ASK, 20)}${APP}changed`)).toMatch(/^Okay\. There's no free 90 min left today/);
  });
});

describe("dayEndFor", () => {
  it("is bedtime less wind-down, never past midnight; midnight less 30 when unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "w6d-cfg-"));
    expect(dayEndFor(dir)).toBe(23 * 60 + 30);
    writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: "23:00", windDownMinutes: 45 }));
    expect(dayEndFor(dir)).toBe(22 * 60 + 15);
    writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: "01:00", windDownMinutes: 30 }));
    expect(dayEndFor(dir)).toBe(1440);
    expect(dayEndFor(undefined)).toBe(23 * 60 + 30);
  });
});
