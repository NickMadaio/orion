// Wave 9 B: through the real hooks, "are we free saturday evening" is answered from Saturday's calendar before any model is asked.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Day } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function harness(read: (dateArgs: string[]) => Promise<Day | undefined>) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  const logPath = join(mkdtempSync(join(tmpdir(), "w9b-")), "r.jsonl");
  registerLocalRouting(api, { warm: false, mode: "on", logPath, decideImpl: async () => ({ move: "escalate", tier: "standard" }), clock: () => "Mon 21:29", brainSearch: async () => "",
    now: () => new Date(2026, 10, 2, 21, 29), scheduleFlow: async () => ({ outcome: "fallback", reason: "not a change" }),
    readDay: async () => "B1 17:00–18:30 Gym", readDayJson: read });
  return async (prompt: string) => {
    const ctx = { runId: `w9b-${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    return `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}`;
  };
}

const saturday: Day = { date: "2026-11-07", now: null, blocks: [
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }, { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" }] };

describe("availability through the hooks", () => {
  it.each(["am i free sat night", "anything on saturday evening", "do i have stuff saturday evening?"])("%j reads Saturday and hands the exact answer on", async (text) => {
    const asked: string[][] = [];
    const turn = harness(async (a) => { asked.push(a); return saturday; });
    const prompt = await turn(text);
    expect(asked).toEqual([["--date", "saturday"]]);
    expect(prompt).toMatch(/Your whole reply must be exactly: Nothing fixed Saturday (?:evening|night)\. Just (?:Gym, 5:00 PM–6:30 PM|Side project, 7:30 PM–8:30 PM)/);
  });
  it("an unreadable calendar is said as a failed read, never as having no calendar", async () => {
    const prompt = await harness(async () => undefined)("are we free saturday evening");
    expect(prompt).toMatch(/I couldn't read your calendar for Saturday just now/);
    expect(prompt).not.toMatch(/don't have your calendar/i);
  });
});
