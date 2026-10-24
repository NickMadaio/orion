import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import {
  MAX_STAGES, STAGE_LABELS, TurnProgress, addStage, beginDoc, finishDoc, progressFileName, stageForTool, stagesForReads, writeTarget,
  type ProgressDoc,
} from "./turn-progress.js";

// 2026-10-23 voice latency (docs/audits/2026-10-23-voice-latency.md): the app speaks real stages while a voice turn runs.
const T0 = new Date("2026-10-23T15:00:00.000Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const tmp = () => mkdtempSync(join(tmpdir(), "turn-progress-"));
const read = (dir: string, key: string): ProgressDoc => JSON.parse(readFileSync(join(dir, progressFileName(key)), "utf8")) as ProgressDoc;

describe("progress doc (pure)", () => {
  it("begins with one real stage: understanding", () => {
    const doc = beginDoc("agent:main:orion-chat-abc", "run-1", T0);
    expect(doc.stages.map((s) => s.stage)).toEqual(["understanding"]);
    expect(doc.done).toBe(false);
    expect(doc.startedAt).toBe(T0.toISOString());
  });

  it("adding a stage returns a new doc and never mutates the old one", () => {
    const a = beginDoc("k", null, T0);
    const b = addStage(a, "reading-calendar", at(2));
    expect(a.stages).toHaveLength(1);
    expect(b.stages).toHaveLength(2);
    expect(b.stages[1]).toEqual({ stage: "reading-calendar", label: STAGE_LABELS["reading-calendar"], at: at(2).toISOString() });
    expect(b.updatedAt).toBe(at(2).toISOString());
  });

  it("the same stage twice in a row is one stage (a loop of reads is one update)", () => {
    const a = addStage(beginDoc("k", null, T0), "reading-calendar", at(1));
    expect(addStage(a, "reading-calendar", at(2))).toBe(a);
    const b = addStage(a, "changing-calendar", at(3), "Gym");
    expect(addStage(b, "changing-calendar", at(4), "Gym")).toBe(b);
    expect(addStage(b, "changing-calendar", at(4), "finish resume").stages).toHaveLength(4);
  });

  it("is capped, and a finished doc takes no more stages", () => {
    let doc = beginDoc("k", null, T0);
    for (let i = 0; i < 60; i += 1) doc = addStage(doc, i % 2 ? "reading-calendar" : "checking-todos", at(i));
    expect(doc.stages).toHaveLength(MAX_STAGES);
    const done = finishDoc(doc, at(70));
    expect(done.done).toBe(true);
    expect(addStage(done, "thinking", at(71))).toBe(done);
  });

  it("file names keep only safe characters", () => {
    expect(progressFileName("agent:main:orion-chat-9311FB49")).toBe("agent_main_orion-chat-9311FB49.json");
    expect(progressFileName("../../etc/passwd")).toBe(".._.._etc_passwd.json");
    expect(progressFileName("")).toBe("unknown.json");
  });
});

describe("stages from what really ran", () => {
  it("reads map to stages, in order, without repeats", () => {
    expect(stagesForReads(["day", "notes", "learned", "deadlines"])).toEqual(["reading-calendar", "checking-notes", "checking-deadlines"]);
    expect(stagesForReads(["day-tomorrow"])).toEqual(["reading-tomorrow"]);
    expect(stagesForReads(["focus"])).toEqual(["checking-focus"]);   // a focus read is not a calendar read (review LOW)
    expect(stagesForReads(["something-new"])).toEqual([]);
    expect(stagesForReads(undefined)).toEqual([]);
  });

  it("tool calls map to stages; a calendar write names its target", () => {
    expect(stageForTool("exec", "orion-agenda day --todos")).toEqual({ stage: "checking-todos" });
    expect(stageForTool("exec", "orion-agenda day")).toEqual({ stage: "reading-calendar" });
    expect(stageForTool("exec", "orion-reschedule show --json")).toEqual({ stage: "reading-calendar" });
    expect(stageForTool("exec", 'orion-reschedule day --plan "Gym, 90, 17:50"')).toEqual({ stage: "changing-calendar", detail: "Gym" });
    expect(stageForTool("exec", "orion-reschedule late 15")).toEqual({ stage: "changing-calendar" });
    expect(stageForTool("brain", "")).toEqual({ stage: "checking-notes" });
    expect(stageForTool("exec", "ls -la")).toEqual({ stage: "using-tool" });
    expect(writeTarget('orion-reschedule move "Gym" --to 18:00')).toBe("Gym");
  });
});

describe("TurnProgress writes the file atomically", () => {
  it("begin, stages, finish: one file per session, no temp files left", () => {
    const dir = tmp();
    let clock = T0;
    const p = new TurnProgress(dir, () => clock);
    p.begin("agent:main:orion-chat-x", "run-9");
    clock = at(3); p.stage("agent:main:orion-chat-x", "reading-calendar");
    clock = at(4); p.stage("agent:main:orion-chat-x", "reading-calendar");
    clock = at(9); p.stage("agent:main:orion-chat-x", "changing-calendar", "Gym");
    let doc = read(dir, "agent:main:orion-chat-x");
    expect(doc.runId).toBe("run-9");
    expect(doc.stages.map((s) => s.stage)).toEqual(["understanding", "reading-calendar", "changing-calendar"]);
    expect(doc.stages[2]!.detail).toBe("Gym");
    clock = at(12); p.finish("agent:main:orion-chat-x");
    doc = read(dir, "agent:main:orion-chat-x");
    expect(doc.done).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    // After finish, a late stage for the old run writes nothing.
    p.stage("agent:main:orion-chat-x", "thinking");
    expect(read(dir, "agent:main:orion-chat-x").stages).toHaveLength(3);
  });

  it("a new turn replaces the old file", () => {
    const dir = tmp();
    const p = new TurnProgress(dir, () => T0);
    p.begin("k", "a"); p.stage("k", "checking-todos"); p.finish("k");
    p.begin("k", "b");
    const doc = read(dir, "k");
    expect(doc.runId).toBe("b");
    expect(doc.stages.map((s) => s.stage)).toEqual(["understanding"]);
  });

  it("never throws when the directory cannot be written", () => {
    const p = new TurnProgress("/dev/null/not-a-dir");
    expect(() => { p.begin("k", null); p.stage("k", "thinking"); p.finish("k"); }).not.toThrow();
  });

  it("a new turn prunes files untouched for a day (review LOW)", () => {
    const dir = tmp();
    const old = join(dir, "agent_main_orion-chat-old.json");
    writeFileSync(old, "{}");
    const twoDaysAgo = new Date(T0.getTime() - 2 * 86_400_000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    const fresh = join(dir, "agent_main_orion-chat-fresh.json");
    writeFileSync(fresh, "{}");
    utimesSync(fresh, T0, T0);
    new TurnProgress(dir, () => T0).begin("k", "r");
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(join(dir, progressFileName("k")))).toBe(true);
  });

  it("stage before begin is ignored", () => {
    const dir = tmp();
    new TurnProgress(dir).stage("k", "thinking");
    expect(existsSync(join(dir, progressFileName("k")))).toBe(false);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

describe("local routing writes the stages a turn really went through", () => {
  async function turn(extra: Record<string, unknown>, message: string, tools: Array<string | [string, string]> = []) {
    const dir = tmp();
    const handlers = new Map<string, Handler[]>();
    const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
    registerLocalRouting(api, {
      warm: false, mode: "on", logPath: join(dir, "local-routing", "shadow.jsonl"), progressDir: join(dir, "turn-progress"),
      decideImpl: async () => ({ move: "escalate" }), clock: () => "Fri 10:45", brainSearch: async () => "",
      scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), ...extra,
    } as never);
    const ctx = { runId: "r1", sessionKey: "agent:main:orion-chat-abc" };
    const fire = async (name: string, event: Record<string, unknown>) => { for (const fn of handlers.get(name) ?? []) await fn(event, ctx); };
    await fire("before_model_resolve", { prompt: message });
    await fire("before_prompt_build", { prompt: message, messages: [] });
    for (const tool of tools) {
      const [command, result] = Array.isArray(tool) ? tool : [tool, "today: B1 09:00-10:30 CS1800 Lecture"];
      await fire("before_tool_call", { toolName: "exec", params: { command } });
      await fire("after_tool_call", { toolName: "exec", params: { command }, result });
    }
    const mid = JSON.parse(readFileSync(join(dir, "turn-progress", "agent_main_orion-chat-abc.json"), "utf8")) as ProgressDoc;
    await fire("agent_end", { success: true, durationMs: 1000 });
    const end = JSON.parse(readFileSync(join(dir, "turn-progress", "agent_main_orion-chat-abc.json"), "utf8")) as ProgressDoc;
    return { mid, end };
  }

  it("a day question: understanding, calendar read by code, thinking", async () => {
    const { mid, end } = await turn({ readDay: async () => "B1 09:00-10:30 CS1800 Lecture (FIXED)" }, "whats next on my schedule");
    expect(mid.stages.map((s) => s.stage)).toEqual(expect.arrayContaining(["understanding", "thinking"]));
    expect(mid.done).toBe(false);
    expect(end.done).toBe(true);
  });

  it("the worker's tool calls become stages, a write with its target", async () => {
    const { mid } = await turn({}, "what is on today and move gym to 6", ["orion-agenda day", ['orion-reschedule day --plan "Gym, 90, 18:00"', "DONE — this really happened: Gym 18:00-19:30 booked"]]);
    const stages = mid.stages.map((s) => s.stage);
    expect(stages).toContain("reading-calendar");
    expect(stages[stages.length - 1]).toBe("changing-calendar");
    expect(mid.stages[mid.stages.length - 1]!.detail).toBe("Gym");
  });

  it("a write is a stage only once it worked (review MEDIUM 5)", async () => {
    const failed = await turn({}, "move gym to 6", [["orion-agenda day", "today"], ['orion-reschedule day --plan "Gym, 90, 18:00"', "error: NOT BOOKED, the calendar refused it"]]);
    expect(failed.mid.stages.map((s) => s.stage)).not.toContain("changing-calendar");
    const worked = await turn({}, "move gym to 6", [['orion-reschedule day --plan "Gym, 90, 18:00"', "DONE — this really happened: Gym 18:00-19:30 booked"]]);
    expect(worked.mid.stages.map((s) => s.stage)).toContain("changing-calendar");
  });

  it("a session that is internal writes nothing", async () => {
    const dir = tmp();
    const handlers = new Map<string, Handler[]>();
    const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), decideImpl: async () => ({ move: "escalate" }), clock: () => "Fri 10:45", brainSearch: async () => "" } as never);
    for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt: "hi" }, { runId: "x", sessionKey: "agent:main:cron:nightly" });
    expect(existsSync(join(dir, "tp"))).toBe(false);
  });
});
