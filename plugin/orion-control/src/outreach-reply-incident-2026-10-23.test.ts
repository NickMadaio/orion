// 2026-10-23: replies to ORION's own proactive messages, as the Mac app and the phone sent them (gateway transcripts
// 97949e09, 5aa4563a, e2c10733; docs/audits/2026-10-23-proactive-reply-and-bedtime.md). Fixtures only: no real paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { parseOutreach, planOutreachReply, readShortReply, outreachNote } from "./outreach-reply.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.

User message:
`;
// 10-20 19:45:32Z, word for word (the Mac's label for a mismatch rung).
const GYM = '[ORION context: 0 min ago you asked "It\'s been 30 min. Gym, now. Phone down." (Gym, planned 20:15-21:45, not started). If he says what he did or is doing, log it.]';
// 10-19 23:03:13Z, word for word (a bedtime line).
const BED = '[ORION context: you messaged him first, 0 min ago: "It\'s 12:02 AM, bedtime. Sleep now and you get 8h 58m before your alarm.". This message MAY be his answer.]';
// The new label orion-reach rows carry from the shared rule.
const BED_NEW = '[ORION context: you messaged him first, 2 min ago (bedtime): "Still up at 12:43 AM — 8h 17m left before your alarm.". His message below is most likely his reply to it.]';
// The phone's context line (orion-remote, 2026-10-23 form) and the 10-16 form.
const PHONE = '[orion-remote] Live facts for this message (read just now, not from Nick):\n- Today\'s calendar: nothing planned.\n- 1 min ago you messaged him first (start): "Time to start: Gym." — his message is most likely his reply to it.\n--- Nick\'s message follows ---\n';
const PHONE_OLD = '- You messaged him first (most recent last): 2:44 AM "Session done. It\'s 2:44 AM — past bedtime; sleep now and you get 6h 16m." — this message may be his answer.';

describe("what ORION said first, read from either prefix", () => {
  it("the Mac's mismatch label: a start line about Gym", () => {
    expect(parseOutreach(`${GYM}\n${APP}I'm meal prepping. That's why. Sorry.`)).toEqual({ text: "It's been 30 min. Gym, now. Phone down.", minutes: 0, kind: "start", title: "Gym" });
  });
  it("the Mac's plain label and the new label: bedtime", () => {
    expect(parseOutreach(`${BED}\n${APP}im doing work shush up`)?.kind).toBe("bedtime");
    expect(parseOutreach(BED_NEW)).toMatchObject({ kind: "bedtime", minutes: 2 });
  });
  it("the phone's lines, new and old", () => {
    expect(parseOutreach(`${PHONE}not yet`)).toEqual({ text: "Time to start: Gym.", minutes: 1, kind: "start", title: "Gym" });
    expect(parseOutreach(PHONE_OLD)?.kind).toBe("bedtime");
  });
  it("no prefix, no outreach", () => expect(parseOutreach(`${APP}whats the weather`)).toBeUndefined());
});

describe("short answers", () => {
  it.each([
    ["yeah", "yes"], ["ok", "yes"], ["on it", "yes"], ["not yet", "not-yet"], ["in 10", "later"], ["10 more min", "later"], ["give me 20 minutes", "later"],
    ["already did", "done"], ["already in bed", "done"], ["done", "done"], ["shush", "stop"], ["im doing work shush up", "stop"],
    ["I'm meal prepping. That's why. Sorry.", "other"], ["nah", "no"],
  ])("%s → %s", (said, kind) => expect(readShortReply(said)?.kind).toBe(kind));
  it("'in 10' is ten minutes", () => expect(readShortReply("in 10")).toEqual({ kind: "later", minutes: 10 }));
  it("a question or a long message is not a short answer", () => {
    expect(readShortReply("what time is gym?")).toBeUndefined();
    expect(readShortReply("can you move gym to tomorrow morning and put the resume block after my lecture please, thanks orion")).toBeUndefined();
  });
});

describe("code's answer to a reply to a start line", () => {
  const gym = parseOutreach(GYM)!;
  it("10-20 'I'm meal prepping. That's why. Sorry.': meal prep first, Gym check-in in 25 min, no calendar change, no 'what time'", () => {
    expect(planOutreachReply(gym, "I'm meal prepping. That's why. Sorry.")).toEqual({ text: "Okay, meal prepping first. I'll check back about Gym in 25 min.",
      checkin: ["add", "25", "Gym", "--because", "I'm meal prepping. That's why. Sorry."] });
  });
  it("'in 10' / 'not yet' / 'already did' / 'yeah'", () => {
    expect(planOutreachReply(gym, "in 10")?.checkin).toEqual(["add", "10", "Gym", "--because", "in 10"]);
    expect(planOutreachReply(gym, "not yet")?.checkin?.slice(0, 2)).toEqual(["add", "15"]);
    expect(planOutreachReply(gym, "already did")?.checkin).toEqual(["close", "Gym"]);
    expect(planOutreachReply(gym, "yeah")?.checkin).toEqual(["started", "Gym"]);
  });
  it("a real question goes to the worker with the context", () => {
    expect(planOutreachReply(gym, "can i do gym tomorrow instead?")).toBeUndefined();
    expect(outreachNote(gym)).toMatch(/YOU \(ORION\) messaged him first: "It's been 30 min\. Gym, now\. Phone down\."/);
  });
});

describe("code's answer to a reply to a bedtime line: never 'since when', never another reminder", () => {
  const bed = parseOutreach(BED)!;
  it("10-19 'im doing work shush up'", () => expect(planOutreachReply(bed, "im doing work shush up")?.text).toMatch(/No more bedtime reminders tonight/));
  it("'yeah' / 'going to bed' / 'in 10' / 'already in bed'", () => {
    expect(planOutreachReply(bed, "yeah")?.text).toBe("Night, Nick.");
    expect(planOutreachReply(bed, "in 10")?.text).toMatch(/10 more minutes, then sleep/);
    expect(planOutreachReply(bed, "already in bed")?.text).toBe("Good. Night, Nick.");
  });
  it("10-16 'Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12' is a request too: the worker gets it, with the context", () => {
    expect(planOutreachReply(parseOutreach(PHONE_OLD)!, "Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12")).toBeUndefined();
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness() {
  const handlers = new Map<string, Handler[]>();
  const desk: Array<{ message: string; history?: unknown }> = [];
  const checkins: string[][] = [];
  const flows: string[] = [];
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Tue 20:45", now: () => new Date(2026, 9, 20, 20, 45),
    decideImpl: async (input: { message: string; history?: unknown }): Promise<Decision> => { desk.push({ message: input.message, history: input.history }); return { move: "escalate", tier: "standard" }; },
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); return { outcome: "say", kind: "ask", text: "What time or how long do you mean? I haven't changed anything." }; },
    checkinRun: async (args: string[]) => { checkins.push(args); return { stdout: "ok", code: 0 }; } });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out;
  };
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `o${n += 1}`, sessionKey: "agent:main:orion-chat-9311fb49" };
    await fire("before_model_resolve", { prompt }, ctx);
    await fire("before_agent_reply", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string; prependContext?: string } | undefined>;
    return { all: `${built?.prependContext ?? ""}\n${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
  };
  return { turn, desk, checkins, flows };
}

describe("the turns, through the routing hooks", () => {
  it("10-20: the front desk sees ORION's Gym line as its last turn; code sets the check-in and answers; the schedule flow never runs", async () => {
    const h = harness();
    const t = await h.turn(`${GYM}\n${APP}I'm meal prepping. That's why. Sorry.`);
    expect(h.desk[0]).toEqual({ message: "I'm meal prepping. That's why. Sorry.", history: [{ role: "assistant", content: "It's been 30 min. Gym, now. Phone down." }] });
    expect(h.checkins).toEqual([["add", "25", "Gym", "--because", "I'm meal prepping. That's why. Sorry."]]);
    expect(h.flows).toEqual([]);
    expect(t.all).toMatch(/meal prepping first\. I'll check back about Gym in 25 min/);
    expect(t.all).not.toMatch(/What time or how long/);
  });
  it("10-19: 'im doing work shush up' after the bedtime line is answered as a reply to it", async () => {
    const h = harness();
    const t = await h.turn(`${BED}\n${APP}im doing work shush up`);
    expect(t.all).toMatch(/No more bedtime reminders tonight/);
    expect(t.all).not.toMatch(/Since when/);
    expect(h.flows).toEqual([]);
  });
  it("a longer reply reaches the worker with ORION's message as the conversation so far", async () => {
    const h = harness();
    const t = await h.turn(`${BED}\n${APP}honestly i think i need to finish this essay, how much sleep do i get if i stop at 1`);
    expect(t.all).toMatch(/YOU \(ORION\) messaged him first: "It's 12:02 AM, bedtime/);
  });
});
