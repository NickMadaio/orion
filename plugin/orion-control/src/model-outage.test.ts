// When the local model is down (2026-10-30): on 10-30 "i dont have classes today" (twice) ended in "Connection error." and was lost.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelHealth, OUTAGE_LINE, REPLAY_MARK, ReplayQueue, drainQueue, probeOllama, replayText } from "./model-outage.js";
import { registerLocalRouting } from "./local-routing.js";

describe("the pieces", () => {
  it("probe: ok is up; a refused connection or an HTTP error is down, never a throw", async () => {
    expect(await probeOllama({ fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch })).toBe(true);
    expect(await probeOllama({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch })).toBe(false);
    expect(await probeOllama({ fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch })).toBe(false);
  });

  it("down: warm once, ask again; up is remembered briefly", async () => {
    const answers = [false, true]; let warmed = 0; let probes = 0;
    const h = new ModelHealth(async () => { probes += 1; return answers.shift() ?? true; }, async () => { warmed += 1; }, 1);
    expect(await h.check()).toBe(true);
    expect(warmed).toBe(1);
    expect(await h.check()).toBe(true);
    expect(probes).toBe(2);   // the second check used the cached "up"
    const dead = new ModelHealth(async () => false, async () => undefined, 1);
    expect(await dead.check()).toBe(false);
  });

  it("the queue keeps one row per message, replays when up, and gives up after three failed replays", async () => {
    const q = new ReplayQueue(mkdtempSync(join(tmpdir(), "q-")));
    const a = q.add({ sessionKey: "s", message: "what should i do now", spoken: false });
    expect(q.add({ sessionKey: "s", message: "what should i do now", spoken: false }).id).toBe(a.id);
    q.add({ sessionKey: "s", message: "remind me at 9 to call mom", spoken: true });
    expect(await drainQueue(q, { check: async () => false }, async () => true)).toBe(0);
    expect(q.pending()).toHaveLength(2);
    const replayed: string[] = [];
    expect(await drainQueue(q, { check: async () => true }, async (row) => { replayed.push(row.message); return row.message.startsWith("what"); })).toBe(1);
    expect(replayed).toEqual(["what should i do now", "remind me at 9 to call mom"]);
    await drainQueue(q, { check: async () => true }, async () => false);
    await drainQueue(q, { check: async () => true }, async () => false);
    expect(q.pending()).toHaveLength(0);
    expect(q.all().map((r) => r.state).sort()).toEqual(["failed", "replayed"]);
  });

  it("a replayed message carries a marker the route strips", () => {
    const text = replayText({ id: "q", at: "", sessionKey: "s", message: "i dont have classes today", spoken: false, state: "queued", tries: 0 }, "10:32 AM");
    expect(text.replace(REPLAY_MARK, "")).toBe("i dont have classes today");
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(up: () => boolean, extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "outage-"));
  let warmed = 0; const replays: string[] = []; const decided: string[] = [];
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Fri 10:32", now: () => new Date(2026, 9, 30, 10, 32),
    decideImpl: async (i: { message: string }) => { decided.push(i.message); if (!up()) throw new Error("fetch failed"); return { move: "escalate" }; }, brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
    modelProbe: async () => up(), modelWarm: async () => { warmed += 1; }, warmWaitMs: 1, replay: async (row: { message: string }) => { replays.push(row.message); return true; }, ...extra } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `o-${n += 1}`, sessionKey: "agent:main:orion-chat-out" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string }>;
    const [gate] = (await fire("before_agent_run", { prompt }, ctx)) as Array<{ outcome: string; message?: string; reason?: string }>;
    if (gate?.outcome === "pass") await fire("before_agent_finalize", { lastAssistantMessage: "ok", messages: [] }, ctx);
    else await fire("agent_end", { success: false }, ctx);
    return { gate, built };
  };
  return { turn, dir, warmed: () => warmed, replays, decided };
}

describe("the outage gate on the live route", () => {
  it("up: the gate passes with exactly {outcome: pass} (the host reads anything else as a block)", async () => {
    const r = route(() => true);
    expect((await r.turn("whats the weather")).gate).toEqual({ outcome: "pass" });
    expect(r.warmed()).toBe(0);
  });

  it("down after a warm-and-retry: the honest line by code, the message queued; back up: it is replayed", async () => {
    let up = false;
    const r = route(() => up);
    const { gate } = await r.turn("what should i do now");
    expect(gate).toEqual({ outcome: "block", reason: "the local model (Ollama) is not answering", message: OUTAGE_LINE });
    expect(r.warmed()).toBe(1);
    const q = new ReplayQueue(r.dir);
    expect(q.pending().map((p) => p.message)).toEqual(["what should i do now"]);
    up = true;
    expect((await r.turn("hey are you there? just checking you're working")).gate).toEqual({ outcome: "pass" });
    await new Promise((res) => setTimeout(res, 20));
    expect(r.replays).toEqual(["what should i do now"]);
    expect(q.pending()).toEqual([]);
  });

  it("the 10-30 message in an outage: the fact and the classes are done by code anyway, told as done, and not replayed", async () => {
    const calls: string[][] = [];
    const r = route(() => false, {
      readDayJson: async () => ({ date: "2026-10-30", now: "10:32", blocks: [{ title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" }] }),
      realityRun: async (_s: string, args: string[]) => { calls.push(args); return args[0] === "add" ? { stdout: JSON.stringify({ id: "fact-aaaaaaaa" }), code: 0 } : { stdout: "Changed Friday 2026-10-30:\n  cancelled MKTG2201 Introduction to Marketing — Lecture 13:30–15:00 — marked off", code: 0 }; },
    });
    const { gate } = await r.turn("Nick SAID this out loud and your answer will be SPOKEN.\n\nUser message:\nNo. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.");
    expect(r.decided).toEqual([]);   // the desk (and its fetch failure) was never in the way
    expect(calls.map((c) => c[0])).toEqual(["add", "classes-off"]);
    expect(gate?.outcome).toBe("block");
    expect(gate?.message).toMatch(/^Got it, no classes today\. I've marked MKTG2201 \(1:30 PM\) cancelled.*\(My local model is down, so that's all I can say for now\.\)$/);
    expect(new ReplayQueue(r.dir).pending()).toEqual([]);
  });
});
