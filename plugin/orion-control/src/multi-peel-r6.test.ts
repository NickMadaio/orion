// w20 round 6 review: several code-run clauses in one message are peeled one after another, each run and reported; a reminder's own words stay in the reminder.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Reminder } from "./ambient.js";

type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const NOW = new Date(2026, 10, 5, 6, 23);

async function hear(said: string, over: { decide?: unknown; mouseFails?: boolean } = {}) {
  const handlers = new Map<string, H[]>();
  const opened: string[][] = []; const mouse: string[][] = []; const timers: Array<{ seconds: number; label: string }> = []; const added: Array<{ at: string; label: string }> = []; const scheduled: string[] = [];
  const store: Reminder[] = [];
  registerLocalRouting({ on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "mp-")), "r.jsonl"), clock: () => "Thu 06:23", now: () => NOW, brainSearch: async () => "",
    decideImpl: async () => (over.decide ?? { move: "escalate", tier: "standard" }) as never,
    scheduleFlow: async (m: string) => { scheduled.push(m); return { outcome: "fallback", reason: "t" }; },
    chatRun: { open: async (a: string[]) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }) },
    mouseRun: async (a: string[]) => { mouse.push(a); return over.mouseFails ? { stdout: "", code: 1 } : { stdout: JSON.stringify({ ok: true, popup: true, say: "Here it is." }), code: 0 }; },
    addTimer: async (seconds: number, label: string) => { timers.push({ seconds, label }); const r = { id: `t${timers.length}`, kind: "timer" as const, label, dueAt: NOW.getTime() + seconds * 1000, createdAt: NOW.getTime() }; store.push(r); return r; },
    addReminder: async (dueAt: number, label: string) => { added.push({ at: new Date(dueAt).toISOString(), label }); const r = { id: `a${added.length}`, kind: "alarm" as const, label, dueAt, createdAt: NOW.getTime() }; store.push(r); return r; },
    extractReminder: async (m: string) => ({ time: "17:00", label: /ring the vet/.test(m) ? "ring the vet and cancel the old appointment" : /call mum/.test(m) ? "call mum and send her the report" : /pasta/.test(m) ? "buy pasta" : "eat" }),
    listReminders: async () => [...store],
  } as never);
  const ctx = { runId: "mp-1", sessionKey: "agent:main:orion-chat-mp" };
  const fire = async (n: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, ctx)); return out; };
  await fire("before_model_resolve", { prompt: said });
  const [direct] = (await fire("before_agent_reply", { cleanedBody: said })) as Array<{ reply?: { text?: string } } | undefined>;
  const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] })) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
  return { opened, mouse, timers, added, scheduled, heard: `${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""} ${built?.appendContext ?? ""}` };
}

describe("three and four code-run clauses in one message: every one runs and is reported", () => {
  it.each([
    "open the mouse mapper and whats the weather tomorrow then set a 10 min timer and remind me at 5 to eat",
    "set a 10 min timer and remind me at 5 to eat, then open the mouse mapper and whats the weather tomorrow",
    "remind me at 5 to eat. also set a 10 min timer. then open the mouse mapper and whats the weather tomorrow",
    "set a 10 min timer, open the mouse mapper, remind me at 5 to eat and whats the weather tomorrow",
  ])("%s", async (said) => {
    const r = await hear(said);
    expect(r.mouse, "mouse").toEqual([["setup", "--again", "--json"]]);
    expect(r.timers.map((t) => t.seconds), "timer").toEqual([600]);
    expect(r.timers[0]!.label, "the timer's label is not the reminder").toBe("Timer");
    expect(r.added.map((a) => a.label), "reminder").toEqual(["eat"]);
    expect(r.heard).toMatch(/Here it is\./);
    expect(r.heard).toMatch(/Timer set: 10 minutes/);
    expect(r.heard).toMatch(/I'll remind you at 5:00 PM to eat/);
    expect(r.heard).toMatch(/weather/i);
  }, 30000);

  it.each([
    "set a 10 min timer and open notes and tell me the time",
    "open notes, set a 10 min timer, then tell me the time",
  ])("%s", async (said) => {
    const r = await hear(said, { decide: { move: "answer", answer: "It's 6:23 AM on Thursday." } });
    expect(r.opened).toEqual([["-a", "notes"]]);
    expect(r.timers.map((t) => t.seconds)).toEqual([600]);
    expect(r.heard).toMatch(/Opened Notes\./);
    expect(r.heard).toMatch(/Timer set: 10 minutes/);
    expect(r.heard).toMatch(/6:23 AM/);
  }, 30000);

  it("a clause that fails is said as not done, with why, and the others still run", async () => {
    const r = await hear("open the mouse mapper and set a 10 min timer and remind me at 5 to eat and whats the weather tomorrow", { mouseFails: true });
    expect(r.timers.map((t) => t.seconds)).toEqual([600]);
    expect(r.added.map((a) => a.label)).toEqual(["eat"]);
    expect(r.heard).toMatch(/Timer set: 10 minutes/);
    expect(r.heard).toMatch(/couldn't|did not|didn't|not done|isn't done/i);
  }, 30000);
});

describe("everything after 'remind me ... to' is the reminder's own text", () => {
  it.each([
    "remind me at 5 to ring the vet and cancel the old appointment",
    "remind me at 5 to call mum and send her the report",
    "remind me at 5 to ring the vet, cancel the old appointment",
    "remind me at 5 to call mum and text her the address",
  ])("%s", async (said) => {
    const r = await hear(said);
    expect(r.scheduled).toEqual([]);
    expect(r.added, "the whole thing is the reminder's, not peeled apart").toEqual([]);
  }, 30000);
  it("a sentence break or 'then' after the reminder starts a new ask", async () => {
    const r = await hear("remind me at 5 to buy pasta. then put pasta prep in at 6pm");
    expect(r.added.map((a) => a.label)).toEqual(["buy pasta"]);
    expect(r.scheduled.join(" ")).toMatch(/pasta prep/);
    expect(r.scheduled.join(" ")).not.toMatch(/remind/);
  }, 30000);
  it("'and' keeps the whole tail inside the reminder", async () => {
    const r = await hear("remind me at 5 to buy pasta and put pasta prep in at 6pm");
    expect(r.scheduled).toEqual([]);
  }, 30000);
});
