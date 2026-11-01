// Gate run-1101020721 foc-doomscroll-v: with no session running, "on <app> instead of studying" offered 25 minutes and asked "say yes".
// The message already says he should be studying, so a typed or addressed turn starts 25 minutes on the most relevant study item (the
// current or just-ended study block, else the top deadline) and says so in one line with how to stop it. Room speech never starts one.
// Phrasings are held out of scripts/eval/gate/scenarios.
import { describe, expect, it } from "vitest";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
import type { Day } from "./schedule-flow.js";

const NOW = new Date(2026, 10, 2, 10, 0);
const IDLE = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", dayKey: "2026-10-30", task: "old thing" })}\n`;
function session(initial: string) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "status") return { stdout: initial, code: 0 };
    if (args[0] === "start") return { stdout: `${JSON.stringify({ ok: true, status: "running", phase: "focus", task: args[1], remainingSeconds: 1500 })}\n`, code: 0 };
    return { stdout: `${JSON.stringify({ ok: true, status: "finished" })}\n`, code: 0 };
  };
  return { exec, calls };
}
const day = (blocks: Day["blocks"]): Day => ({ date: "2026-11-02", now: "10:00", blocks } as Day);
const CLASS = { title: "MKTG9", start: "13:30", end: "15:30", fixed: true, kind: "class" };
const DUE = async () => ({ events: [{ title: "ECON9 problem set", start: "2026-11-04T23:59" }, { title: "CS9 essay", start: "2026-11-03T12:00" }], tasks: [] });
const HELD_OUT = ["been on insta for ages when i should be studying", "ugh been on youtube again instead of doing my work", "im on reels and im supposed to be revising"];

describe("doomscroll, nothing running, typed: 25 minutes start on the most relevant study item", () => {
  it.each(HELD_OUT)("top deadline: %s", async (said) => {
    const move = readFocusMove(said);
    expect(move?.kind).toBe("doomscroll");
    const s = session(IDLE);
    const out = await runFocusMove(move!, { exec: s.exec, now: NOW, mayStart: true, readDay: async () => day([CLASS]), readDeadlines: DUE });
    expect(s.calls.find((c) => c[0] === "start")).toEqual(["start", "CS9 essay", "--minutes", "25", "--json"]);
    expect(out.flow?.outcome).toBe("done");
    const reply = (out.flow as { reply: string }).reply;
    expect(reply).toMatch(/CS9 essay/);
    expect(reply).toMatch(/25/);
    expect(reply).toMatch(/10:25 AM/);
    expect(reply).toMatch(/stop the session/);
    expect(reply).not.toMatch(/say yes|want/i);
    expect(reply.split(/(?<=[.!?])\s+(?=[A-Z])/).length).toBe(1);
    expect(out.pendingSession).toBeUndefined();
  });
  it("a study block that just ended comes before the deadlines", async () => {
    const s = session(IDLE);
    await runFocusMove(readFocusMove(HELD_OUT[0]!)!, { exec: s.exec, now: NOW, mayStart: true, readDay: async () => day([{ title: "Econ revision", start: "08:30", end: "09:50", fixed: false, kind: "study" }, CLASS]), readDeadlines: DUE });
    expect(s.calls.find((c) => c[0] === "start")?.[1]).toBe("Econ revision");
  });
  it("today's ended session counts as the just-ended block", async () => {
    const s = session(`${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", dayKey: "2026-11-02", task: "econ" })}\n`);
    await runFocusMove(readFocusMove(HELD_OUT[1]!)!, { exec: s.exec, now: NOW, mayStart: true, readDay: async () => day([CLASS]), readDeadlines: DUE });
    expect(s.calls.find((c) => c[0] === "start")?.[1]).toBe("econ");
  });
  it("spoken and not addressed: never starts; the nudge only", async () => {
    const s = session(IDLE);
    const out = await runFocusMove(readFocusMove(HELD_OUT[2]!)!, { exec: s.exec, now: NOW, mayStart: false, readDay: async () => day([CLASS]), readDeadlines: DUE });
    expect(s.calls.some((c) => c[0] === "start")).toBe(false);
    expect(out.flow?.outcome).toBe("say");
  });
  it("no study duty in what he said ('on tiktok again'): nothing starts", async () => {
    const s = session(IDLE);
    await runFocusMove(readFocusMove("im on tiktok again lol")!, { exec: s.exec, now: NOW, mayStart: true, readDay: async () => day([CLASS]), readDeadlines: DUE });
    expect(s.calls.some((c) => c[0] === "start")).toBe(false);
  });
});

// The same, through the router: typed starts it; heard in the room (not addressed) never does.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function router() {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = [];
    for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };
  const s = session(IDLE);
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w7d-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => "Mon 10:00", now: () => NOW, decideImpl: async () => ({ move: "escalate", tier: "standard" }) as never,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }), sessionExec: s.exec, readDayJson: async () => day([CLASS]), readDeadlines: DUE });
  return { fire, calls: s.calls };
}
const SPOKEN = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";

describe("doomscroll through the router", () => {
  it("typed: the session starts on the top deadline", async () => {
    const { fire, calls } = router();
    const ctx = { runId: "w7d-typed", sessionKey: "agent:main:orion-chat-w7d" };
    await fire("before_model_resolve", { prompt: HELD_OUT[0] }, ctx);
    await fire("before_prompt_build", { prompt: HELD_OUT[0], messages: [] }, ctx);
    expect(calls.find((c) => c[0] === "start")).toEqual(["start", "CS9 essay", "--minutes", "25", "--json"]);
  });
  it("spoken, not addressed: nothing starts", async () => {
    const { fire, calls } = router();
    const ctx = { runId: "w7d-room", sessionKey: "agent:main:orion-chat-w7d2" };
    const prompt = `${SPOKEN}${HELD_OUT[2]}`;
    await fire("before_model_resolve", { prompt }, ctx);
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    expect(calls.some((c) => c[0] === "start")).toBe(false);
  });
});
