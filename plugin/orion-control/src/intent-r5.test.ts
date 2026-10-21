// Live run 5 (docs/audits/2026-10-20-live-as-nick.md, "Run 5", main 7358a39, 10-21 22:42-22:52, tests for 10-22). All failures were safe;
// these make them right. Fixtures only: stub scheduler, no model, no session.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readIntent } from "./calendar-intent.js";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, spokenReply, type Day, type FlowResult } from "./schedule-flow.js";
import { timeMismatch } from "./time-backstop.js";

const NOW = new Date(2030, 9, 21, 22, 45);
const today: Day = { date: "2030-10-21", now: "22:45", blocks: [{ title: "CS1802 Seminar — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" }] };
// 10-22: CS1800 9:00-10:30 and "finish resume" 2:00-3:00 PM; the Gym and reading ORION just added.
const tomorrow = (extra: Day["blocks"] = [], resumeFixed = false): Day => ({ date: "2030-10-22", now: null, plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
  { title: "CS1800 Discrete Structures — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "finish resume", start: "14:00", end: "15:00", fixed: resumeFixed, kind: resumeFixed ? "other" : "study" }, ...extra] });
const GYM = { title: "Gym", start: "19:00", end: "20:30", fixed: false, kind: "gym" };
const READING = { title: "reading", start: "20:00", end: "20:30", fixed: false, kind: "study" };

async function flow(message: string, opts: { t?: Day; lastTarget?: { title: string; start?: string; dateArgs: string[] }; out?: string } = {}) {
  const writes: string[][] = [];
  const result = await runScheduleFlow({ message, clock: "Tue 22:45", now: NOW, ask: async () => { throw new Error("the form must not be asked"); }, ...(opts.lastTarget ? { lastTarget: opts.lastTarget } : {}),
    exec: async (a) => { if (a[0] !== "show") writes.push(a); const other = a.includes("tomorrow") || a.includes("2030-10-22"); return { stdout: a[0] === "show" ? JSON.stringify(other ? opts.t ?? tomorrow([GYM]) : today) : opts.out ?? "Changed:", code: 0 }; } });
  return { result, writes };
}

describe("1. 'move gym from 7 to 8' right after creating tomorrow's gym moves THAT gym (not a search of today)", () => {
  const lastTarget = { title: "Gym", start: "19:00", dateArgs: ["--date", "tomorrow"] };
  it("table: the intent is a move of gym, 7 and 8 kept as said for the block to read", () => {
    expect(readIntent("move gym from 7 to 8", { now: NOW })).toMatchObject({ intent: { verb: "move", day: "today", items: [{ name: "gym", fromSaid: "7", toSaid: "8" }] } });
  });
  it("execution: today has no gym, so the one just made tomorrow moves 19:00 -> 20:00", async () => {
    const { writes, result } = await flow("move gym from 7 to 8", { lastTarget, out: "Changed Wednesday 2030-10-22:\n  Gym moved: 19:00 → 20:00–21:30" });
    expect(writes).toEqual([["move", "Gym", "--to", "20:00", "--date", "tomorrow"]]);
    expect(result).toMatchObject({ outcome: "done", reply: "Done for tomorrow: Gym now 8:00 PM–9:30 PM." });
  });
  it("a Gym today that is already over is not the one: the one just made tomorrow moves", async () => {
    const t2: Day = { ...today, blocks: [...today.blocks, { title: "Gym", start: "21:05", end: "22:35", fixed: false, kind: "gym" }] };
    const writes: string[][] = [];
    await runScheduleFlow({ message: "move gym from 7 to 8", clock: "x", now: NOW, ask: async () => { throw new Error("no form"); }, lastTarget,
      exec: async (a) => { if (a[0] !== "show") writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(a.includes("tomorrow") ? tomorrow([GYM]) : t2) : "Changed:", code: 0 }; } });
    expect(writes).toEqual([["move", "Gym", "--to", "20:00", "--date", "tomorrow"]]);
  });
  it("without a record it is still today's search, said plainly", async () => {
    const { result, writes } = await flow("move gym from 7 to 8");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: "There's no gym on your day, so I haven't moved anything." });
  });
});

describe("2. 'move tomorrow's gym from 7 to 8' reads 7/8 against the Gym's own 19:00, and never quotes a block that does not exist", () => {
  it("table", () => {
    expect(readIntent("move tomorrow's gym from 7 to 8", { now: NOW })).toMatchObject({ intent: { verb: "move", day: "tomorrow", items: [{ name: "gym", fromSaid: "7", toSaid: "8" }] } });
  });
  it("execution: 20:00, the Gym that is there", async () => {
    const { writes, result } = await flow("move tomorrow's gym from 7 to 8", { out: "Changed Wednesday 2030-10-22:\n  Gym moved: 19:00 → 20:00–21:30" });
    expect(writes).toEqual([["move", "Gym", "--to", "20:00", "--date", "tomorrow"]]);
    expect(spokenReply((result as { outputs: string[] }).outputs, "tomorrow")).toBe("Done for tomorrow: Gym now 8:00 PM–9:30 PM.");
    expect(JSON.stringify(result)).not.toMatch(/8:00 AM/);
  });
});

describe("3. ORION's own older blocks are movable whatever calendar they are in (finish resume on School)", () => {
  it("execution: with finish resume ORION's (marked by the ledger backfill), the replan puts gym first after the first class (its only class, so + the trip home), then resume", async () => {
    const { writes } = await flow("reschedule tomorrow after my first class, gym first then resume", { t: tomorrow(), out: "Changed:\n  planned Gym: 10:35–12:05" });
    expect(writes).toEqual([["day", "--plan", "Gym, 90, 11:20", "--plan", "finish resume, 60, 12:55", "--date", "tomorrow"]]);
  });
  it("a fixed event that is not a class is said as an event ORION didn't book, not as a class", async () => {
    const { result } = await flow("reschedule tomorrow after my first class, gym first then resume", { t: tomorrow([], true) });
    expect(result).toMatchObject({ outcome: "say", text: "finish resume is an event on your calendar that I didn't book, so I don't move it. I haven't changed anything." });
  });
});

describe("4. 'push it 15 min' after 'add reading tomorrow at 8pm' moves that reading", () => {
  it.each([["push it 15 min", 15], ["push it back 15 min", 15], ["push that 30 minutes later", 30], ["bump this 10 min", 10], ["move it to 9", undefined]])("table %j", (m, by) => {
    const r = readIntent(m, { now: NOW });
    expect(r).toMatchObject({ intent: { verb: "move", items: [{ name: "it", ...(by ? { by } : {}) }] } });
  });
  it("execution: the reading on ITS day (tomorrow), 20:00 -> 20:15", async () => {
    const { writes, result } = await flow("push it 15 min", { t: tomorrow([READING]), lastTarget: { title: "reading", start: "20:00", dateArgs: ["--date", "tomorrow"] }, out: "Changed:\n  reading moved: 20:00 → 20:15–20:45" });
    expect(writes).toEqual([["move", "reading", "--to", "20:15", "--date", "tomorrow"]]);
    expect(result).toMatchObject({ outcome: "done", reply: "Done for tomorrow: reading now 8:15 PM–8:45 PM." });
  });
  it("with nothing made here, 'it' is asked, never guessed", async () => {
    expect((await flow("push it 15 min")).result).toMatchObject({ outcome: "say", text: "Which block should I move? I haven't changed anything." });
  });
  it("through the hooks: 'add reading tomorrow at 8pm' then 'push it 15 min' carries the reading as the target", async () => {
    const handlers = new Map<string, Array<(e: Record<string, unknown>, c: Record<string, unknown>) => unknown>>();
    const targets: unknown[] = []; let desk = 0;
    registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r5-")), "r.jsonl"),
      brainSearch: async () => "", clock: () => "Tue 22:45", now: () => NOW, decideImpl: async () => { desk += 1; return { move: "escalate" }; },
      scheduleFlow: async (m, _c, o): Promise<FlowResult> => { targets.push(o?.lastTarget);
        return /add reading/.test(m) ? { outcome: "done", calls: ["exec orion-reschedule add reading 30 --at 20:00 --date tomorrow"], outputs: ["Changed:\n  planned reading: 20:00–20:30"] }
          : { outcome: "done", calls: ["exec orion-reschedule move reading --to 20:15 --date tomorrow"], outputs: ["Changed:\n  reading moved: 20:00 → 20:15–20:45"] }; } });
    for (const [id, m] of [["a", "add reading tomorrow at 8pm"], ["b", "push it 15 min"]] as const) {
      const c = { runId: id, sessionKey: "agent:main:orion-chat-live-v8" };
      for (const f of handlers.get("before_model_resolve") ?? []) await f({ prompt: m }, c);
      for (const f of handlers.get("before_prompt_build") ?? []) await f({ prompt: m, messages: [] }, c);
      for (const f of handlers.get("before_agent_finalize") ?? []) await f({ sessionId: "s", lastAssistantMessage: "ok", model: "m", messages: [] }, c);
    }
    expect(targets).toEqual([undefined, { title: "reading", start: "20:00", dateArgs: ["--date", "tomorrow"] }]);
    expect(desk).toBe(0);
  });
});

describe("5. 'add stretching, call mom at 5' asks which item the 5 is for, plainly", () => {
  it.each([
    ["add stretching, call mom at 5", "Want stretching at 5 too, or just the call? What time for stretching?"],
    ["add stretching and lunch with sam at 1pm", "Want stretching at 1pm too, or just the lunch? What time for stretching?"],
  ])("%j", (m, text) => {
    expect(timeMismatch(m, [["add", "stretching", "30"]], { day: "today", now: 600 })).toBe(text);
  });
  it("its own time is still the plain mismatch", () => {
    expect(timeMismatch("add stretching at 5", [["add", "stretching", "30", "--at", "13:00"]], { day: "today", now: 600 })).toMatch(/^You said 5:00 PM/);
  });
});
