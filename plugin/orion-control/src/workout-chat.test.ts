// w17 g-workout: workout turns carried out through orion-workout-log (a fake runner, then the real script against a fake Ollama), the follow-up read
// from the state dir, and the routing: described, asked once, answered, skipped, undone, and a question about something else never bound.
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { WorkoutMemory, readWorkoutPending, runWorkoutTurn, type WorkoutRun } from "./workout-chat.js";
import { registerLocalRouting, instructionsFor } from "./local-routing.js";
import { FOOD_TOOL, GENERAL_INSTRUCTIONS, WORKOUT_TOOL } from "./job-instructions.js";
import type { Decision } from "./front-desk.js";

const NOW = new Date(2026, 10, 3, 18, 0);
const QUESTION = "Nice. Roughly how long was it, and what weight on the squats?";
const LOGGED_SAY = 'Logged: legs, 55 min, squats 4x6 at 185, RDL 3x8 at 135, leg press 3x12. Say "undo" to take it off.';
const dir = () => mkdtempSync(join(tmpdir(), "wk-chat-"));

function fakeRun(answers: Record<string, unknown>, calls: string[][] = []): WorkoutRun {
  return async (args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    const out = key ? answers[key] : { ok: false, error: "unexpected" };
    return { stdout: JSON.stringify(out), code: (out as { ok: boolean }).ok ? 0 : 1 };
  };
}

describe("runWorkoutTurn", () => {
  it("a description runs --chat and says the script's own sentence (a question)", async () => {
    const calls: string[][] = [];
    const out = await runWorkoutTurn({ kind: "describe", text: "just did legs" }, { run: fakeRun({ "--text": { ok: true, asking: true, say: QUESTION } }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["--text", "just did legs", "--chat", "--json"]);
    expect(out).toMatchObject({ text: QUESTION, asked: true });
    expect(out.logged).toBeUndefined();
  });
  it("a log returns the id for undo; answer, skip, cancel and undo map to their commands", async () => {
    const calls: string[][] = [];
    const run = fakeRun({ answer: { ok: true, say: LOGGED_SAY, logged: { id: "WKT-1" } }, discard: { ok: true, say: "Okay, not logged." }, undo: { ok: true, say: "Took legs off (2026-11-03)." } }, calls);
    const deps = { run, stateDir: dir(), now: NOW };
    expect(await runWorkoutTurn({ kind: "answer", text: "55 min" }, deps)).toMatchObject({ text: LOGGED_SAY, logged: { id: "WKT-1" } });
    await runWorkoutTurn({ kind: "skip" }, deps); await runWorkoutTurn({ kind: "cancel" }, deps);
    expect((await runWorkoutTurn({ kind: "undo", id: "WKT-1" }, deps)).text).toBe("Took legs off (2026-11-03).");
    expect(calls).toEqual([["answer", "55 min", "--json"], ["answer", "--skip", "--json"], ["discard", "--json"], ["undo", "WKT-1", "--json"]]);
  });
  it("a failure is one honest sentence and nothing is claimed logged", async () => {
    const d = { stateDir: dir(), now: NOW };
    const bad = await runWorkoutTurn({ kind: "describe", text: "x" }, { ...d, run: fakeRun({ "--text": { ok: false, error: "the local model took longer than 40 s" } }) });
    expect(bad.text).toBe("I couldn't log that workout just now (the local model took longer than 40 s), so nothing was logged. Tell me again in a bit.");
    expect(bad.logged).toBeUndefined();
    const undo = await runWorkoutTurn({ kind: "undo", id: "mine" }, { ...d, run: fakeRun({ undo: { ok: false, error: "mine isn't a workout I logged" } }) });
    expect(undo.text).toBe("I couldn't take it off: mine isn't a workout I logged.");
    expect((await runWorkoutTurn({ kind: "skip" }, { ...d, run: async () => { throw new Error("boom"); } })).text).toMatch(/nothing was logged/);
  });
});

describe("readWorkoutPending and WorkoutMemory", () => {
  it("reads a live follow-up and ignores an expired or broken one", () => {
    const d = dir();
    expect(readWorkoutPending(d, NOW)).toBeUndefined();
    const row = { at: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), asked: 2, question: QUESTION, draft: { exercises: [] } };
    writeFileSync(join(d, "workout-pending.json"), JSON.stringify(row));
    expect(readWorkoutPending(d, NOW)).toEqual({ at: NOW.getTime(), asked: 2, question: QUESTION });
    expect(readWorkoutPending(d, new Date(NOW.getTime() + 120_000))).toBeUndefined();
    writeFileSync(join(d, "workout-pending.json"), "{nope");
    expect(readWorkoutPending(d, NOW)).toBeUndefined();
  });
  it("a turn about something else after the question unbinds it, and a label naming another message does too", () => {
    const m = new WorkoutMemory();
    const pending = { at: NOW.getTime(), asked: 1, question: QUESTION };
    expect(m.bound("s", pending)).toBe(true);
    expect(m.bound("s", pending, QUESTION)).toBe(true);
    expect(m.bound("s", pending, "Gym, now? You have legs planned.")).toBe(false);
    m.otherTurn("s", NOW.getTime() + 1000);
    expect(m.bound("s", pending)).toBe(false);
  });
});

// ---- through the real routing ----
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(workoutRun: WorkoutRun | undefined, d = dir()) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
  const flows: string[] = [];
  let clock = NOW.getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(clock),
    decideImpl: async () => ({ move: "answer", answer: "DESK ANSWER" }) as Decision, brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
    readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [], ...(workoutRun ? { workoutRun } : {}),
  } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    clock += 30_000;
    const ctx = { runId: `w-${n += 1}`, sessionKey: "agent:main:orion-chat-workout" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    return direct?.reply?.text;
  };
  return { turn, dir: d, flows, now: () => clock };
}

describe("workouts through the routing (fake runner)", () => {
  it("describe → one question → his answer logs it → undo takes it off; the desk answers none of them", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const run: WorkoutRun = async (args) => {
      calls.push(args);
      if (args[0] === "--text") {
        writeFileSync(join(r.dir, "workout-pending.json"), JSON.stringify({ at: new Date(r.now()).toISOString(), expiresAt: new Date(r.now() + 1800_000).toISOString(), asked: 1, question: QUESTION, draft: {} }));
        return { stdout: JSON.stringify({ ok: true, asking: true, say: QUESTION }), code: 0 };
      }
      if (args[0] === "answer") return { stdout: JSON.stringify({ ok: true, say: LOGGED_SAY, logged: { id: "WKT-AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" } }), code: 0 };
      return { stdout: JSON.stringify({ ok: true, say: "Took legs off (2026-11-03)." }), code: 0 };
    };
    r = route(run);
    expect(await r.turn("just did legs, squats 4x6 and rdl 3x8 at 135 and leg press 3x12")).toBe(QUESTION);
    expect(await r.turn("like 55 min and 185 on the squats")).toBe(LOGGED_SAY);
    expect(await r.turn("undo")).toBe("Took legs off (2026-11-03).");
    expect(calls.map((c) => c[0])).toEqual(["--text", "answer", "undo"]);
    expect(calls[2]).toEqual(["undo", "WKT-AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", "--json"]);
  });
  it("a skip logs it as it stands", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const run: WorkoutRun = async (args) => {
      calls.push(args);
      if (args[0] === "--text") writeFileSync(join(r.dir, "workout-pending.json"), JSON.stringify({ at: new Date(r.now()).toISOString(), expiresAt: new Date(r.now() + 1800_000).toISOString(), asked: 1, question: "Nice. Roughly how long was it?", draft: {} }));
      return { stdout: JSON.stringify(args[0] === "--text" ? { ok: true, asking: true, say: "Nice. Roughly how long was it?" } : { ok: true, say: 'Logged: 3 mi run. Skipped: how long. Say "undo" to take it off.', logged: { id: "WKT-1" } }), code: 0 };
    };
    r = route(run);
    expect(await r.turn("went for a 3 mile run")).toBe("Nice. Roughly how long was it?");
    expect(await r.turn("idk")).toMatch(/^Logged: 3 mi run\. Skipped: how long\./);
    expect(calls[1]).toEqual(["answer", "--skip", "--json"]);
  });
  it("a question about something else after the follow-up is not its answer, and neither is the next reply", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const run: WorkoutRun = async (args) => {
      calls.push(args);
      writeFileSync(join(r.dir, "workout-pending.json"), JSON.stringify({ at: new Date(r.now()).toISOString(), expiresAt: new Date(r.now() + 1800_000).toISOString(), asked: 1, question: QUESTION, draft: {} }));
      return { stdout: JSON.stringify({ ok: true, asking: true, say: QUESTION }), code: 0 };
    };
    r = route(run);
    await r.turn("just did legs");
    expect(await r.turn("what time is my class tomorrow")).not.toBe(QUESTION);
    await r.turn("skip");
    await r.turn("45 mins");
    expect(calls.map((c) => c[0])).toEqual(["--text"]);
  });
  it("questions and plans about the gym are not logged; without a runner nothing is taken", async () => {
    const calls: string[][] = [];
    const r = route(async (args) => { calls.push(args); return { stdout: "{}", code: 1 }; });
    for (const m of ["did i go to the gym this week?", "gonna do legs later", "i skipped the gym today"]) await r.turn(m);
    expect(calls).toEqual([]);
    const none = route(undefined);
    expect(await none.turn("just did legs, squats 4x6 at 185")).not.toBe(QUESTION);
  });
  it("a workout never reaches the food estimate: 'ran 5k' and 'log my workout' stay workouts", async () => {
    const calls: string[][] = [];
    const r = route(async (args) => { calls.push(args); return { stdout: JSON.stringify({ ok: true, asking: true, say: "Nice. Roughly how long was it?" }), code: 0 }; });
    expect(await r.turn("ran 5k before breakfast")).toBe("Nice. Roughly how long was it?");
    expect(await r.turn("log my workout: bench 3x8 at 135")).toBe("Nice. Roughly how long was it?");
    expect(calls.map((c) => c[0])).toEqual(["--text", "--text"]);
  });
});

// ---- the real script, a fake Ollama, the real routing ----
const script = fileURLToPath(new URL("../../../scripts/orion-workout-log", import.meta.url));
const fakeModel = (body: unknown): Promise<{ server: Server; url: string }> => new Promise((resolve) => {
  const server = createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify(body) } })); }); });
  server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
});
const servers: Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

describe("end to end: routing, the real orion-workout-log, a fake model", () => {
  it("asks once, takes his answer, logs to health-log.json, and undo removes it", async () => {
    const model = await fakeModel({ type: "strength", title: "legs", day: "", startTime: "", durationMin: 0, sport: "", effort: 0, notes: "", cardio: [],
      exercises: [{ name: "squats", sets: 4, reps: 6, weight: 185, unit: "lb" }, { name: "rdl", sets: 3, reps: 8, weight: 0, unit: "" }] });
    servers.push(model.server);
    const d = dir();
    const run: WorkoutRun = (args) => new Promise((resolve) => execFile(process.execPath, [script, ...args], { env: { ...process.env, ORION_CONTROLLED_DIR: d, ORION_OLLAMA_URL: model.url, ORION_NOW: new Date(NOW).toISOString() } },
      (e, stdout) => resolve({ stdout: String(stdout), code: e ? 1 : 0 })));
    const r = route(run, d);
    const first = await r.turn("jus did legs, squats 4x6 at 185 and rdl 3x8");
    expect(first).toBe("Nice. Roughly how long was it, and what weight on the rdl?");
    const done = await r.turn("55 min, rdl was 135");
    expect(done).toBe('Logged: legs, 55 min, squats 4x6 at 185, rdl 3x8 at 135. Say "undo" to take it off.');
    const rows = (JSON.parse(readFileSync(join(d, "health-log.json"), "utf8")) as { workouts: Array<{ id: string; source: string }> }).workouts;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ source: "chat" });
    expect(await r.turn("undo")).toMatch(/^Took legs off/);
    expect((JSON.parse(readFileSync(join(d, "health-log.json"), "utf8")) as { workouts: unknown[] }).workouts).toHaveLength(0);
  });
});

describe("the worker's toolbelt", () => {
  it("carries orion-workout-log only on a workout turn, and never grows the general prompt", () => {
    expect(instructionsFor(undefined, "log my workout bench 3x8")).toContain("orion-workout-log --text");
    expect(instructionsFor(undefined, "squats 4x6 then the treadmill")).toBe(`${GENERAL_INSTRUCTIONS}\n\n${WORKOUT_TOOL}`);
    expect(instructionsFor(undefined, "turn the lights on")).toBe(GENERAL_INSTRUCTIONS);
    expect(instructionsFor(undefined, "ate a burrito and did squats")).toBe(`${GENERAL_INSTRUCTIONS}\n\n${FOOD_TOOL}\n${WORKOUT_TOOL}`);
    expect(WORKOUT_TOOL).toMatch(/never guess a number/);
  });
});
