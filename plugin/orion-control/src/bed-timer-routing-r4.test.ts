// w20 round 4 (live gate 2): bedtime phrasings, timers and "another one" reminders through the real routing hooks, in his words.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { StoredReminder } from "./reminder-flow.js";
import type { SleepRun } from "./sleep-plan-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const NOW = new Date(2026, 10, 5, 2, 30);

function setup(decision: Decision = { move: "escalate", tier: "quick" }, extra: Record<string, unknown> = {}) {
  const sleepCalls: string[][] = []; const wakeCalls: string[][] = []; const timers: Array<{ seconds: number; label: string }> = [];
  const store: StoredReminder[] = [];
  const sleepPlanRun: SleepRun = async (args) => {
    sleepCalls.push(args);
    const time = args[1] ?? "00:00";
    return { code: 0, stdout: JSON.stringify({ ok: true, readback: { evening: "2026-11-04", sleepBy: args[1] === "reset" ? "22:30" : time, nudgeAt: "22:00", wake: "06:30", wakeDate: "2026-11-05", alarmAsked: true, hours: 7, lockdownBelowHours: 6, tonightOnly: args.includes("--tonight"), standing: "00:00" } }) };
  };
  const handlers = new Map<string, Handler[]>();
  const dir = mkdtempSync(join(tmpdir(), "bt4-"));
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(dir, "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 02:30", now: () => NOW, stateDir: dir,
    decideImpl: async () => decision, sleepPlanRun, ...extra,
    wakeExec: async (args: string[]) => { wakeCalls.push(args); return { stdout: "Cleared.", code: 0 }; },
    extractReminder: async (m: string) => (/vitamins/.test(m) ? { time: "08:00", label: "take my vitamins" } : /water/.test(m) ? { time: null, label: "drink water" } : { time: "15:00", label: "ring the dentist" }),
    listReminders: async () => [...store],
    removeReminders: async (ids: string[]) => { for (const id of ids) { const i = store.findIndex((r) => r.id === id); if (i >= 0) store.splice(i, 1); } },
    ledgerRun: async () => ({ stdout: "", code: 0 }),
    addTimer: async (seconds: number, label: string) => { timers.push({ seconds, label }); const r = { id: `t${timers.length}`, kind: "timer" as const, label, dueAt: NOW.getTime() + seconds * 1000, createdAt: NOW.getTime() }; store.push(r); return r; },
  } as never);
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `r${(n += 1)}`, sessionKey: "agent:main:orion-chat-bt4" };
    for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt }, ctx);
    for (const fn of handlers.get("before_agent_reply") ?? []) { const o = (await fn({ prompt }, ctx)) as { reply?: { text?: string } } | undefined; if (o?.reply?.text) return o.reply.text; }
    let out = "";
    for (const fn of handlers.get("before_prompt_build") ?? []) { const o = (await fn({ prompt, messages: [] }, ctx)) as { systemPrompt?: string; appendContext?: string } | undefined; out += `${o?.systemPrompt ?? ""}\n${o?.appendContext ?? ""}`; }
    return out;
  };
  // The worker's one orion_task_run call, as the host reports it, then the turn finishing: that is what makes a reminder "the one just set".
  const workerCalled = async (runId: string, args: Record<string, unknown>) => {
    const ctx = { runId, sessionKey: "agent:main:orion-chat-bt4" };
    for (const fn of handlers.get("after_tool_call") ?? []) await fn({ toolName: "tool_call", params: { id: "openclaw:orion-control:orion_task_run", args }, result: "scheduled" }, ctx);
    for (const fn of handlers.get("before_agent_finalize") ?? []) await fn({ sessionId: "s", lastAssistantMessage: "ok" }, ctx);
  };
  const delivered = async (runId: string): Promise<string> => {
    for (const fn of handlers.get("reply_payload_sending") ?? []) { const o = (await fn({ payload: { text: "I'll remind you at 8:00 AM to take my vitamins." }, runId, sessionKey: "agent:main:orion-chat-bt4" }, {})) as { payload?: { text?: string } } | undefined; if (o?.payload?.text) return o.payload.text; }
    return "";
  };
  return { turn, sleepCalls, wakeCalls, timers, store, workerCalled, delivered, handlers };
}

describe("bedtime phrasings reach the one bedtime writer, never the wake tool or the scheduler", () => {
  it.each([
    ["clear my bedtime back to normal", ["bedtime", "reset", "--json"]],
    ["clear bedtime", ["bedtime", "reset", "--json"]],
    ["stop using a fixed bedtime, go back to working it out from my alarm", ["bedtime", "reset", "--json"]],
    ["go back to working it out from my alarm", ["bedtime", "reset", "--json"]],
    ["bedtime tonight is midnight", ["bedtime", "00:00", "--tonight", "--json"]],
    ["im heading to bed at ten to twelve", ["bedtime", "23:50", "--tonight", "--json"]],
    ["can we make bedtime twenty past 11 tonight only", ["bedtime", "23:20", "--tonight", "--json"]],
  ])("%s", async (said, args) => {
    const h = setup();
    const reply = await h.turn(said);
    expect(h.sleepCalls[0]).toEqual(args);
    expect(h.wakeCalls).toEqual([]);
    expect(reply).not.toMatch(/alarm is back to automatic|calendar is exactly|can't see it on today's plan/);
  }, 30000);
  it("the reply is only the read-back", async () => {
    const h = setup();
    const reply = await h.turn("im heading to bed at ten to twelve");
    expect(reply).toContain("Bedtime 11:50pm tonight");
  }, 30000);
});

describe("a timer is set by code and read back", () => {
  it.each([
    ["set a 10 min timer", 600, /Timer set: 10 minutes, it rings at 2:40 AM/],
    ["start a 10 min timer for the pasta", 600, /Timer set: 10 minutes for the pasta, it rings at 2:40 AM/],
    ["put a 25 minute timer on for my laundry pls", 1500, /25 minutes for my laundry|25 minutes for the laundry/],
  ])("%s", async (said, seconds, re) => {
    const h = setup();
    const reply = await h.turn(said);
    expect(h.timers[0]?.seconds).toBe(seconds);
    expect(reply).toMatch(re);
  }, 30000);
});

describe("another reminder, and cancelling by description", () => {
  it("'and another in 15 mins to drink water' after a reminder is a second reminder, not a calendar block", async () => {
    const h = setup();
    const first = await h.turn("remind me to ring the dentist at 3pm");
    expect(first).toMatch(/"action":"alarm_set"/);
    await h.workerCalled("r1", { steps: [{ action: "alarm_set", at: "2026-11-05T15:00", label: "ring the dentist" }] });
    const second = await h.turn("and another in 15 mins to drink water");
    expect(second).toMatch(/"action":"alarm_set"/);
    expect(second).toMatch(/drink water/);
    expect(second).not.toMatch(/orion-reschedule/);
  }, 30000);
  it("'ditch the water reminder as well' cancels the one called water", async () => {
    const h = setup();
    h.store.push({ id: "a1", label: "drink water", dueAt: NOW.getTime() + 900_000 }, { id: "a2", label: "ring the dentist", dueAt: NOW.getTime() + 3_600_000 });
    const reply = await h.turn("ditch the water reminder as well");
    expect(reply).toMatch(/Cancelled the reminder: drink water/);
    expect(h.store.map((r) => r.id)).toEqual(["a2"]);
  }, 30000);
  it("asks which when two match", async () => {
    const h = setup();
    h.store.push({ id: "a1", label: "drink water", dueAt: NOW.getTime() + 900_000 }, { id: "a2", label: "water the plants", dueAt: NOW.getTime() + 3_600_000 });
    const reply = await h.turn("ditch the water reminder");
    expect(reply).toMatch(/Which one\?/);
    expect(h.store).toHaveLength(2);
  }, 30000);
});

describe("review fixes: a timer is only an order, and the rest of the message is not dropped", () => {
  it.each(["dont set a 10 min timer", "should i set a 10 min timer?", "can you set a 5 min timer? or is that too short lol"])("%s sets nothing", async (said) => {
    const h = setup();
    await h.turn(said);
    expect(h.timers).toEqual([]);
  }, 30000);
  it("'make it a 10 min timer instead' with no timer before it sets nothing", async () => {
    const h = setup();
    await h.turn("make it a 10 min timer instead");
    expect(h.timers).toEqual([]);
  }, 30000);
  it("'make it a 15 min timer instead' after a timer replaces it", async () => {
    const h = setup();
    await h.turn("set a 10 min timer for the pasta");
    const reply = await h.turn("make it a 15 min timer instead");
    expect(h.timers.map((t) => t.seconds)).toEqual([600, 900]);
    expect(h.store.filter((r) => r.kind === "timer")).toHaveLength(1);
    expect(reply).toMatch(/Swapped the old timer\. Timer set: 15 minutes/);
  }, 30000);
  it.each([
    "set a 10 min timer and move my gym to 6",
    "move my gym to 6 and set a 10 min timer",
    "move gym to 6 then start a 10 min timer",
    "put my gym at 6, and set a 10 min timer pls",
  ])("%s: code sets the timer, the scheduler gets only the gym clause, one reply says both", async (said) => {
    const seen: string[] = [];
    const h = setup(undefined, { scheduleFlow: async (m: string) => { seen.push(m); return { outcome: "done", calls: ['exec orion-reschedule move "gym" --to 18:00'], outputs: ["Changed: moved gym"], reply: "Moved gym to 6:00 PM." }; } });
    const reply = await h.turn(said);
    expect(h.timers.map((t) => t.seconds)).toEqual([600]);
    expect(seen.length).toBeGreaterThan(0);
    for (const m of seen) { expect(m).toMatch(/gym/); expect(m).not.toMatch(/timer/); }
    expect(reply).toContain("Timer set: 10 minutes, it rings at 2:40 AM. Moved gym to 6:00 PM.");
  }, 30000);
  it("with no scheduler flow the worker is told what code did and the other clause", async () => {
    const h = setup();
    const prompt = await h.turn("set a 10 min timer and add a 30 min walk to my calendar");
    expect(h.timers.map((t) => t.seconds)).toEqual([600]);
    expect(prompt).toMatch(/Timer set: 10 minutes/);
    expect(prompt).toMatch(/add a 30 min walk to my calendar/);
  }, 30000);
});

describe("gate 3 #72: the reminder reply states what was actually stored", () => {
  it("a worker that stored another time than the plan is told as stored, in 12-hour time", async () => {
    const h = setup();
    const h2 = h;
    await h2.turn("remind me at 8 to take my vitamins");
    await h2.workerCalled("r1", { steps: [{ action: "alarm_set", at: "2026-11-05T20:00", label: "take my vitamins" }] });
    expect(await h2.delivered("r1")).toMatch(/I set that reminder for 8:00 PM to take my vitamins, not 8:00 AM/);
  }, 30000);
  it("the plan's own sentence stands when the call matched", async () => {
    const h = setup();
    await h.turn("remind me at 8 to take my vitamins");
    await h.workerCalled("r1", { steps: [{ action: "alarm_set", at: "2026-11-05T08:00", label: "take my vitamins" }] });
    expect(await h.delivered("r1")).toMatch(/I'll remind you at 8:00 AM/);
  }, 30000);
});

describe("gate 3 #23: 'again in 15 mins' after a reminder is a reminder, not a 60 min block", () => {
  it.each(["and again in 15 mins to drink water", "again in 20 min to drink water", "once more in an hour to drink water"])("%s", async (said) => {
    const h = setup();
    await h.turn("remind me to ring the dentist at 3pm");
    await h.workerCalled("r1", { steps: [{ action: "alarm_set", at: "2026-11-05T15:00", label: "ring the dentist" }] });
    const prompt = await h.turn(said);
    expect(prompt).toMatch(/"action":"alarm_set"/);
    expect(prompt).not.toMatch(/orion-reschedule/);
  }, 30000);
});

describe("w20 r6: a bedtime claim with nothing written never goes out (gate 4 #13 #81)", () => {
  it.each(["Set bedtime to 11:30 PM tonight.", "Bedtime tonight only is 11:50 PM.", "Saved: your bedtime is half 11 every night now."])("%s", async (claim) => {
    const h = setup({ move: "tool", tool: "wake", args: { at: "23:30" } } as never);
    await h.turn("sleepy, gonna crash about eleven-ish i think");
    const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: claim }] }];
    // A flagged first draft is sent back for a revise round or two (the same claim comes back); the last pass is what goes out.
    for (let pass = 0; pass < 4; pass += 1) for (const fn of h.handlers.get("before_agent_finalize") ?? []) await fn({ sessionId: "s", lastAssistantMessage: claim, messages }, { runId: "r1", sessionKey: "agent:main:orion-chat-bt4" });
    const said = (messages[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(said).toMatch(/haven't changed/);   // the guard's line, or the honest statement line a flagged draft already gets
    expect(said).not.toMatch(/11:30 PM|11:50|half 11/);
  }, 30000);
});

describe("w20 r6 #17: 'scrap the water ping' cancels the water reminder", () => {
  it.each(["scrap the water ping", "ditch the water nudge", "kill the water buzz"])("%s", async (said) => {
    const h = setup();
    h.store.push({ id: "a1", label: "drink water", dueAt: NOW.getTime() + 900_000 }, { id: "a2", label: "ring the dentist", dueAt: NOW.getTime() + 3_600_000 });
    expect(await h.turn(said)).toMatch(/Cancelled the reminder: drink water/);
    expect(h.store.map((r) => r.id)).toEqual(["a2"]);
  }, 30000);
});

describe("w20 r6 #100: a reminder joined to another ask is a reminder, and the other ask still runs", () => {
  it.each([
    ["put pasta prep in at 6pm and remind me at 5 to buy pasta", "pasta prep"],
    ["remind me at 5 to buy pasta and put pasta prep in at 6pm", "pasta prep"],
    ["add gym at 7 and ping me at 6 to pack my bag", "gym"],
    ["move leetcode to 4, then remind me at 3 to charge my laptop", "leetcode"],
    ["book a call with dad at 6pm and nudge me at 5 to ring mum", "call with dad"],
  ])("%s", async (said, rest) => {
    const seen: string[] = [];
    const added: Array<{ at: string; label: string }> = [];
    const h = setup(undefined, {
      scheduleFlow: async (m: string) => { seen.push(m); return { outcome: "done", calls: ["exec orion-reschedule add"], outputs: ["ok"], reply: "Added it." }; },
      extractReminder: async (m: string) => ({ time: /remind|ping|nudge/.test(m) ? "17:00" : null, label: /pasta/.test(m) ? "buy pasta" : /bag/.test(m) ? "pack my bag" : /laptop/.test(m) ? "charge my laptop" : "ring mum" }),
      addReminder: async (dueAt: number, label: string) => { added.push({ at: new Date(dueAt).toISOString(), label }); const r = { id: `a${added.length}`, kind: "alarm" as const, label, dueAt, createdAt: NOW.getTime() }; h0.store.push(r); return r; },
    });
    const h0 = h;
    const reply = await h.turn(said);
    expect(added).toHaveLength(1);
    for (const m of seen) { expect(m).toContain(rest.split(" ")[0]!); expect(m).not.toMatch(/remind|ping me|nudge me/); }
    expect(reply).toMatch(/I'll remind you/);
    expect(reply).toContain("Added it.");
  }, 30000);
});
