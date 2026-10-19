import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { resolveAlarmTime } from "./ambient.js";
import type { Decision } from "./front-desk.js";

// Built from the live sweep of 2026-10-15 (items q030, q033–q038, q058, q091): every reminder turn became a
// new alarm, at a time the extractor made up, on today's date.
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Stored = { id: string; label: string; dueAt: number };
function harness(opts: { now: Date; decision?: Decision; extract?: (m: string) => { time: string | null; label: string } | null; stored?: Stored[] }) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = [];
    for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };
  const extracted: string[] = [];
  let flowRan = false;
  const hh = `${String(opts.now.getHours()).padStart(2, "0")}:${String(opts.now.getMinutes()).padStart(2, "0")}`;
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "rf-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => `Thu ${hh}`, now: () => opts.now,
    decideImpl: async () => opts.decision ?? { move: "tool", tool: "alarm" },
    scheduleFlow: async () => { flowRan = true; return { outcome: "fallback", reason: "t" }; },
    extractReminder: async (m) => { extracted.push(m); return opts.extract ? opts.extract(m) : null; },
    listReminders: async () => opts.stored ?? [] });
  let n = 0;
  const turn = async (said: string, toolCall?: { args: string; result: string }, finalize: Record<string, unknown> = {}) => {
    const ctx = { runId: `rf${(n += 1)}`, sessionKey: "agent:main:orion-chat-sweep" };
    await fire("before_model_resolve", { prompt: said }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    if (toolCall) await fire("after_tool_call", { toolName: "orion_task_run", params: JSON.parse(toolCall.args), result: toolCall.result }, ctx);
    await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok", ...finalize }, ctx);
    return `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}`;
  };
  return { turn, extracted, flowRan: () => flowRan };
}
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

describe("reminders — what he asks for, not always a new alarm (sweep 2026-10-15)", () => {
  it("q035 'cancel the 3pm reminder' cancels the 3 PM one by id and sets nothing", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), decision: { move: "tool", tool: "alarm", args: { do: "delete" } },
      stored: [{ id: "a1x2y", label: "call mum", dueAt: at(2026, 10, 15, 15, 0).getTime() }, { id: "a9z8w", label: "drink water", dueAt: at(2026, 10, 15, 18, 0).getTime() }] });
    const prompt = await h.turn("cancel the 3pm reminder");
    expect(prompt).toMatch(/"action":"reminder_cancel","id":"a1x2y"/);
    expect(prompt).not.toMatch(/alarm_set/);
    expect(h.flowRan()).toBe(false);
  });

  it("cancelling a reminder that does not exist says so, with no tool", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), stored: [] });
    const prompt = await h.turn("cancel the 3pm reminder");
    expect(prompt).not.toMatch(/alarm_set|reminder_cancel/);
    expect(prompt).toMatch(/don't have a reminder at 3:00 PM/);
  });

  it("q034 'whats my reminders today' lists the stored reminders, not his to-dos", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), decision: { move: "escalate", tier: "standard" },
      stored: [{ id: "a1x2y", label: "call the dentist", dueAt: at(2026, 10, 15, 17, 0).getTime() }] });
    const prompt = await h.turn("whats my reminders today");
    expect(prompt).toMatch(/call the dentist at 5:00 PM/);
    expect(prompt).not.toMatch(/orion-tasks|alarm_set/);
    expect(h.flowRan()).toBe(false);
  });

  it("q030 'no wait make it 5:30' moves the 5 PM reminder: cancel the old one, set the new one", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), extract: (m) => ({ time: /5:30/.test(m) ? "17:30" : "17:00", label: /dentist/.test(m) ? "call the dentist" : "make it 5:30" }),
      stored: [{ id: "a5abc", label: "call the dentist", dueAt: at(2026, 10, 15, 17, 0).getTime() }] });
    const first = await h.turn("remind me to call the dentist at 5", { args: '{"steps":[{"action":"alarm_set","at":"2026-10-15T17:00","label":"call the dentist"}]}', result: "executed=true a5abc" });
    expect(first).toMatch(/"at":"2026-10-15T17:00","label":"call the dentist"/);
    const second = await h.turn("no wait make it 5:30");
    expect(second).toMatch(/"action":"reminder_cancel","id":"a5abc"\},\{"action":"alarm_set","at":"2026-10-15T17:30","label":"call the dentist"\}/);
  });

  it("q058 'dont let me forget that' with no time is not an alarm", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), decision: { move: "tool", tool: "supplements" }, extract: () => ({ time: "12:00", label: "peanut allergy reminder" }) });
    const prompt = await h.turn("im allergic to peanuts btw, dont let me forget that");
    expect(prompt).not.toMatch(/"action":"alarm_set"|Nick wants a reminder/);
    expect(h.extracted).toEqual([]);
  });

  it("q091 'remind me about the thing' asks; the answers are read together until there is a time", async () => {
    const h = harness({ now: at(2026, 10, 15, 14, 0), decision: { move: "ask", answer: "Which thing?" },
      extract: (m) => ({ time: /at 9/.test(m) ? "09:00" : null, label: /form/.test(m) ? "the form" : "the thing" }) });
    const t1 = await h.turn("remind me about the thing");
    expect(t1).not.toMatch(/alarm_set/);
    expect(t1).toMatch(/What should I remind you about/);
    const t2 = await h.turn("the one with the form");
    expect(t2).not.toMatch(/alarm_set/);
    expect(t2).toMatch(/What time/);
    const t3 = await h.turn("tomorrow at 9");
    expect(t3).toMatch(/"action":"alarm_set","at":"2026-10-16T09:00","label":"the form"/);
  });
});

describe("reminders — the time is worked out by code (sweep 2026-10-15)", () => {
  it("q033 'in like 10 min' at 23:32 is 23:42 today, whatever the extractor guessed", async () => {
    const h = harness({ now: at(2026, 10, 15, 23, 32), extract: () => ({ time: "11:10", label: "drink water" }) });
    const prompt = await h.turn("remind me in like 10 min to drink water");
    expect(prompt).toMatch(/"at":"2026-10-15T23:42","label":"drink water"/);
  });

  it("q036 'like 45 min' is now plus 45 minutes", async () => {
    const h = harness({ now: at(2026, 10, 15, 16, 10), extract: () => ({ time: "17:45", label: "laundry" }) });
    const prompt = await h.turn("ping me when the laundry should be done, like 45 min");
    expect(prompt).toMatch(/"at":"2026-10-15T16:55","label":"laundry"/);
  });

  it("a time already past today goes to tomorrow, and the reply names that day", async () => {
    const h = harness({ now: at(2026, 10, 15, 18, 0), extract: () => ({ time: "17:00", label: "call the dentist" }) });
    const prompt = await h.turn("remind me to call the dentist at 5");
    expect(prompt).toMatch(/"at":"2026-10-16T17:00"/);
    expect(prompt).toMatch(/Friday at 5:00 PM/);
  });

  it("no time at all asks for one instead of inventing noon", async () => {
    const h = harness({ now: at(2026, 10, 15, 14, 0), extract: () => ({ time: null, label: "pay rent" }) });
    const prompt = await h.turn("remind me to pay rent");
    expect(prompt).not.toMatch(/alarm_set/);
    expect(prompt).toMatch(/What time/);
  });

  it("q038 'alarm for 6:45 weekdays' says repeating alarms aren't supported and sets nothing", async () => {
    const h = harness({ now: at(2026, 10, 15, 12, 0), extract: () => ({ time: "06:45", label: "alarm for 6:45 weekdays" }) });
    const prompt = await h.turn("alarm for 6:45 weekdays pls");
    expect(prompt).not.toMatch(/alarm_set/);
    expect(prompt).toMatch(/repeating/i);
  });

  it("alarm_set refuses a timestamp that has already passed instead of storing it as due in 0 seconds", () => {
    const now = at(2026, 10, 15, 23, 32);
    expect(() => resolveAlarmTime("2026-10-15T11:10", now)).toThrow(/already passed/);
    expect(resolveAlarmTime("2026-10-15T23:42", now)).toBe(at(2026, 10, 15, 23, 42).getTime());
    expect(resolveAlarmTime("11:10", now)).toBe(at(2026, 10, 16, 11, 10).getTime());
  });
});

// Review, 2026-10-16: reminder routing found by the combined-sweep review (HIGH 1-3, MEDIUM 8).
describe("reminders — create vs cancel, corrections, stitching (review, 2026-10-16)", () => {
  const stored = (): Stored[] => [{ id: "c1", label: "call mom", dueAt: at(2026, 10, 16, 17, 0).getTime() }, { id: "r2", label: "reset router", dueAt: at(2026, 10, 16, 19, 0).getTime() }];
  const base = () => at(2026, 10, 16, 12, 0);

  it("HIGH 1: asking to SET a reminder that mentions a cancel word never cancels one", async () => {
    for (const [said, label, time] of [
      ["set a reminder to cancel netflix at 5pm", "cancel netflix", "17:00"],
      ["set a reminder to cancel my gym membership at 5pm", "cancel my gym membership", "17:00"],
      ["set a reminder for 5pm to remove the laundry", "remove the laundry", "17:00"],
      ["set an alarm to stop the oven at 6pm", "stop the oven", "18:00"],
    ] as const) {
      const h = harness({ now: base(), stored: stored(), extract: () => ({ time, label }) });
      const prompt = await h.turn(said);
      expect(prompt, said).not.toMatch(/reminder_cancel/);
      expect(prompt, said).toMatch(/"action":"alarm_set"/);
    }
  });

  it("HIGH 1: the label match is whole words ('set' is not 'reset')", async () => {
    const h = harness({ now: base(), stored: stored() });
    const prompt = await h.turn("cancel the set reminder");
    expect(prompt).not.toMatch(/"id":"r2"/);
  });

  it("HIGH 1: a real cancel still cancels", async () => {
    const h = harness({ now: base(), stored: stored() });
    expect(await h.turn("cancel my call mom reminder")).toMatch(/"id":"c1"/);
  });

  it("HIGH 2: 'actually, move gym to 6pm' after a reminder is a new subject, not a move of call mom", async () => {
    const h = harness({ now: base(), stored: stored(), extract: (m) => (/gym/.test(m) ? { time: "18:00", label: "gym" } : { time: "17:00", label: "call mom" }) });
    await h.turn("remind me to call mom at 5pm", { args: '{"steps":[{"action":"alarm_set","at":"2026-10-16T17:00","label":"call mom"}]}', result: "executed=true c1" });
    const second = await h.turn("actually, move gym to 6pm");
    expect(second).not.toMatch(/call mom/);
    expect(second).not.toMatch(/reminder_cancel/);
  });

  it("HIGH 2: 'make it 5:30' and 'actually make it 6pm' still correct the last reminder", async () => {
    for (const said of ["make it 5:30", "actually make it 6pm", "no wait, change it to 6"]) {
      const h = harness({ now: base(), stored: stored(), extract: (m) => ({ time: "17:30", label: /call mom/.test(m) ? "call mom" : said }) });
      await h.turn("remind me to call mom at 5pm", { args: '{"steps":[{"action":"alarm_set","at":"2026-10-16T17:00","label":"call mom"}]}', result: "executed=true c1" });
      expect(await h.turn(said), said).toMatch(/"id":"c1"\},\{"action":"alarm_set"[^}]*"label":"call mom"/);
    }
  });

  it("HIGH 3: after 'What time?', an unrelated command is not stitched onto the reminder", async () => {
    const h = harness({ now: base(), decision: { move: "tool", tool: "lights" }, extract: (m) => ({ time: null, label: "call mom" }) });
    expect(await h.turn("remind me to call mom")).toMatch(/What time/);
    await h.turn("turn off the lights");
    expect(h.extracted).toEqual(["remind me to call mom"]);
  });

  it("HIGH 3: a bare time after 'What time?' is still stitched", async () => {
    const h = harness({ now: base(), extract: (m) => ({ time: /at 5/.test(m) ? "17:00" : null, label: "call mom" }) });
    await h.turn("remind me to call mom");
    expect(await h.turn("at 5pm")).toMatch(/"action":"alarm_set"/);
  });

  it("MEDIUM 8: when the plan gives nothing (extractor down) the fixed reply is used, with no second extractor pass", async () => {
    const h = harness({ now: base(), extract: () => null });
    const prompt = await h.turn("remind me to call mom at 5pm");
    expect(prompt).not.toMatch(/orion_task_run|Never use orion-tasks/);
    expect(h.extracted.length).toBe(1);
  });
});

describe("reminders — re-review fixes (2026-10-16)", () => {
  const stored: Stored[] = [{ id: "c1", label: "call mom", dueAt: at(2026, 10, 16, 17, 0).getTime() }, { id: "r2", label: "alarm 7", dueAt: at(2026, 10, 16, 19, 0).getTime() }];
  it("HIGH 1: 'I set' / 'you set' / 'set up' do not turn a cancel into a create", async () => {
    for (const said of ["remove the reminder i set for 5pm", "delete the alarm you set for 7pm", "cancel my reminder to set up the router"]) {
      const h = harness({ now: at(2026, 10, 16, 12, 0), stored, extract: () => ({ time: "17:00", label: "x" }) });
      const prompt = await h.turn(said);
      expect(prompt, said).not.toMatch(/alarm_set/);
      expect(prompt, said).not.toMatch(/What time should I remind/);
    }
  });
  it("HIGH 3: a new request after 'What time?' is not stitched, whatever the front desk picked", async () => {
    const h = harness({ now: at(2026, 10, 16, 12, 0), decision: { move: "escalate", tier: "standard" }, extract: () => ({ time: null, label: "call mom" }) });
    await h.turn("remind me to call mom");
    await h.turn("add gym at 5 today");
    expect(h.extracted).toEqual(["remind me to call mom"]);
  });
  it("HIGH 3: bare times still stitch", async () => {
    for (const said of ["at 5", "5:30", "tomorrow at 9", "in 20 min"]) {
      const h = harness({ now: at(2026, 10, 16, 12, 0), decision: { move: "escalate", tier: "standard" }, extract: () => ({ time: null, label: "call mom" }) });
      await h.turn("remind me to call mom");
      await h.turn(said);
      expect(h.extracted[1], said).toBe(`remind me to call mom ${said}`);
    }
  });
});

describe("reminders — label answers (round 6, 2026-10-16)", () => {
  const ask = async (said: string, decision: Decision) => {
    const h = harness({ now: at(2026, 10, 16, 12, 0), decision, extract: (m) => ({ time: "17:00", label: /^remind me at 5 about the thing$/.test(m) ? "the thing" : "x" }) });
    await h.turn("remind me at 5 about the thing");
    await h.turn(said);
    return h;
  };
  it("a new request after 'What should I remind you about?' is not stitched", async () => {
    for (const said of ["add gym at 5 today", "turn the lights off", "move gym to 6", "what's the weather"]) {
      const h = await ask(said, { move: "ask", answer: "?" });
      expect(h.extracted, said).toEqual(["remind me at 5 about the thing"]);
    }
  });
  it("a plain label still stitches ('call mom', 'the one with the form')", async () => {
    for (const said of ["call mom", "the one with the form"]) {
      const h = await ask(said, { move: "ask", answer: "?" });
      expect(h.extracted[1], said).toBe(`remind me at 5 about the thing ${said}`);
    }
  });
  it("final round: with the front desk answering, a calendar word alone is still a label; real requests are new", async () => {
    for (const said of ["bring my laptop to class", "my lab report"]) {
      const h = await ask(said, { move: "answer", answer: "ok" });
      expect(h.extracted[1], said).toBe(`remind me at 5 about the thing ${said}`);
    }
    for (const said of ["add gym at 5 today", "move gym to 6", "turn the lights off", "what's the weather"]) {
      const h = await ask(said, { move: "answer", answer: "ok" });
      expect(h.extracted, said).toEqual(["remind me at 5 about the thing"]);
    }
  });
  it("last round: statements about his day are new requests, not labels", async () => {
    for (const said of ["lab got cancelled", "dinner with priya on thursday", "gym at 6 instead", "i'm going to the library after lunch"]) {
      const h = await ask(said, { move: "answer", answer: "ok" });
      expect(h.extracted, said).toEqual(["remind me at 5 about the thing"]);
    }
    for (const said of ["bring my laptop to class", "my lab report", "call mom", "the one with the form"]) {
      const h = await ask(said, { move: "answer", answer: "ok" });
      expect(h.extracted[1], said).toBe(`remind me at 5 about the thing ${said}`);
    }
  });
  it("'delete the alarm you set for 7' does not look for a reminder called 'set'", async () => {
    const h = harness({ now: at(2026, 10, 16, 12, 0), stored: [] });
    expect(await h.turn("delete the alarm you set for 7")).not.toMatch(/for set/);
  });
});

describe("reminders — the host drops a revise (review, 2026-10-16)", () => {
  it("hostDrops on reminder-cancel puts the honest cancel line in place", async () => {
    const h = harness({ now: at(2026, 10, 16, 12, 0), stored: [{ id: "c1", label: "call mom", dueAt: at(2026, 10, 16, 17, 0).getTime() }] });
    const messages = [{ role: "assistant", content: [{ type: "text", text: "ok" }] }];
    await h.turn("cancel the call mom reminder", undefined, { hadDeterministicSideEffect: true, messages });
    expect(JSON.stringify(messages)).toContain("I didn't manage to cancel that reminder — nothing was changed.");
  });
});
