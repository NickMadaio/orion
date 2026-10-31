// 2026-10-31 review, finding 3: replies to the escalation ladder's own texts (lib/reach/plan-ladder.mjs) must reach the plan
// loop they answer. The L0 now carries his record ("Time to start: Gym. Gym: 0 of the last 6 happened. Not today."), and the
// phone's context line says `(mismatch ask "Gym", planned 17:00-18:30, not started)`. Fixtures only: no real paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { parseOutreach, titleOf } from "./outreach-reply.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";

// The texts the ladder sends, word for word (the reviewer's chain simulation, 2026-10-30).
const L0 = "Time to start: Gym. Gym: 0 of the last 6 happened. Not today.";
const L0_HABIT = "Time to start: finish resume. You usually start these about 15 min late.";
const COMEBACK = "Time to start: Gym. Okay, meal prep's done. Now we're starting.";
const L1 = "Gym — still not started. Just 30 min then, and it starts now.";
const L2 = "It's been 25 min. Gym, now. Phone down, 30 min still counts.";
const L3 = "You've been avoiding Study for CS Midterm for 50 min. No. Get up.";
const END = "Gym didn't happen at 5:00 PM. I've moved it to 9:20 PM–10:50 PM; that's the plan now. If today's off, say skip.";

// The phone's line for an ask row (orion-remote recentOutreach + askDetail).
const phone = (text: string, title = "Gym") =>
  `[orion-remote] Live facts for this message (read just now, not from Nick):\n- 1 min ago you asked him "${text}" (mismatch ask "${title}", planned 17:00-18:30, not started). If he says what he did or is doing, log it.\n--- Nick's message follows ---\n`;

describe("the block a ladder text is about", () => {
  it.each([
    [L0, "Gym"], [L0_HABIT, "finish resume"], [COMEBACK, "Gym"], [L1, "Gym"], [L2, "Gym"], [L3, "Study for CS Midterm"], [END, "Gym"],
  ])("%s → %s", (text, title) => expect(titleOf(text)).toBe(title));
  it("the phone's ask label names the block, quoted", () => {
    expect(titleOf(L0, ` (mismatch ask "Gym", planned 17:00-18:30, not started)`)).toBe("Gym");
  });
  it("the Mac's label still works", () => {
    expect(titleOf("It's been 30 min. Gym, now.", "(Gym, planned 20:15-21:45, not started)")).toBe("Gym");
  });
  it("the phone's L0 line parses as a start line about Gym", () => {
    expect(parseOutreach(`${phone(L0)}I'm meal prepping`)).toMatchObject({ text: L0, kind: "start", title: "Gym" });
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness() {
  const handlers = new Map<string, Handler[]>();
  const checkins: string[][] = [];
  const flows: string[] = [];
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 17:06", now: () => new Date(2026, 9, 30, 17, 6),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); return { outcome: "say", kind: "ask", text: "What time or how long do you mean? I haven't changed anything." }; },
    checkinRun: async (args: string[]) => {
      checkins.push(args);
      // the real orion-checkin find matches the title exactly: only "Gym" finds the loop
      if (args[0] === "find") return args[2] === "Gym" ? { stdout: '{"open":true,"id":"ci-gym","what":"Gym","block":"cal-gym1"}', code: 0 } : { stdout: '{"open":false,"matches":0}', code: 1 };
      return { stdout: args[0] === "defer" ? "Fair — back in 25 min about Gym." : "ok", code: 0 };
    } });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out;
  };
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `l${n += 1}`, sessionKey: "agent:main:orion-chat-ladder" };
    await fire("before_model_resolve", { prompt }, ctx);
    await fire("before_agent_reply", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string; prependContext?: string } | undefined>;
    return { all: `${built?.prependContext ?? ""}\n${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
  };
  return { turn, checkins, flows };
}

describe("a reply to the real ladder texts acts on the Gym loop", () => {
  it("'I'm meal prepping' in reply to the L0 with his record: a grace on the Gym loop, no schedule flow", async () => {
    const h = harness();
    const t = await h.turn(`${phone(L0)}I'm meal prepping`);
    expect(h.checkins).toEqual([["find", "--what", "Gym"], ["defer", "25", "ci-gym", "--because", "I'm meal prepping"]]);
    expect(h.flows).toEqual([]);
    expect(t.all).toMatch(/meal prepping first — 25 min \(my guess; say if it's longer\)\. I'll come back at \d{1,2}:\d{2} [AP]M and we start Gym\./);   // pending-reply.ts: the comeback time is said
  });
  it("'in 10' to the comeback and 'yeah' to L1 reach the same loop", async () => {
    const h = harness();
    await h.turn(`${phone(COMEBACK)}in 10`);
    await h.turn(`${phone(L1)}yeah`);
    expect(h.checkins).toEqual([["find", "--what", "Gym"], ["defer", "10", "ci-gym", "--because", "in 10"], ["find", "--what", "Gym"], ["started", "ci-gym"]]);
  });
});
