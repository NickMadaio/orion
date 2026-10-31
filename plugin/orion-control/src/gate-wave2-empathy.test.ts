// Gate run-1031133008, wave 2: health/empathy (cluster 4), tool leaks (5), focus phrases (6) and chatter (7).
// Every message below is the exact text from results.jsonl turns[].message, plus paraphrases in Nick's style.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { QUIET_REPLY, roomTalk, talksToSomeoneElse } from "./chatter.js";
import { CRISIS_REPLY } from "./distress.js";
import { readLighten } from "./day-lighten.js";
import { readFocusMove } from "./focus-moves.js";
import { isKnowledgeAsk } from "./knowledge-ask.js";
import { REPLY_FAILED, sanitizeReply } from "./reply-sanitize.js";
import { parseSessionRequest } from "./session-flow.js";
import { planReminder } from "./reminder-flow.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const SPOKEN = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";
// Monday 2 Nov 2026 (the scenarios' setup.now), local time.
const MON = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const DAY: Day = { date: "2026-11-02", now: null, blocks: [
  { title: "CS2100 Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "MKTG2201 Lecture", start: "13:30", end: "15:30", fixed: true, kind: "class" },
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
  { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
] };
const DEADLINES: DeadlineRead = { events: [
  { title: "CS Midterm", start: new Date(2026, 10, 5, 9, 0).toISOString(), isDeadline: true },
  { title: "Marketing brief", start: new Date(2026, 10, 6, 17, 0).toISOString(), isDeadline: true },
], tasks: [] };

function route(decide: (message: string) => Decision, opts: { now?: Date; session?: Record<string, unknown> | null; day?: Day } = {}) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "wave2-"));
  const writes: string[][] = []; const sessionCalls: string[][] = []; const flows: string[] = []; const sessionFlows: string[] = [];
  let session: Record<string, unknown> | null = opts.session ?? null;
  let clock = (opts.now ?? MON(13, 0)).getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => new Date(clock),
    decideImpl: async (i: { message: string }) => decide(i.message), brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
    readDayJson: async () => opts.day ?? DAY, readDeadlines: async () => DEADLINES,
    realityRun: async (_s: string, args: string[]) => { writes.push(args); return { stdout: args[0] === "add" ? `Booked ${args[1]} 21:00–22:00` : "ok", code: 0 }; },
    sessionExec: async (args: string[]) => {
      sessionCalls.push(args);
      if (args[0] === "status") return { stdout: JSON.stringify(session ?? { ok: true, status: "none" }), code: 0 };
      if (args[0] === "finish") { session = null; return { stdout: JSON.stringify({ ok: true, status: "finished" }), code: 0 }; }
      if (args[0] === "start") { session = { ok: true, status: "running", task: args[1], remainingSeconds: 600 }; return { stdout: JSON.stringify(session), code: 0 }; }
      return { stdout: "{}", code: 1 };
    },
    sessionFlow: async (m: string) => { sessionFlows.push(m); return { outcome: "done", calls: ["exec orion-session start x --json"], outputs: ["{}"], reply: "Your focus session is running: 25 minutes." } as FlowResult; },
    extractReminder: async (m: string) => ({ time: /\b6\b/.test(m) ? "18:00" : null, label: m.includes("alarm") ? "the army is coming" : "call my mom" }),
    listReminders: async () => [],
  } as never);
  let n = 0;
  const turn = async (prompt: string, opt: { reply?: string; command?: string } = {}) => {
    const ctx = { runId: `w-${n += 1}`, sessionKey: "agent:main:orion-chat-wave2" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string }>;
    const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    const tool = opt.command ? ((await fire("before_tool_call", { toolName: "exec", params: { command: opt.command } }, ctx)) as Array<{ block?: boolean } | undefined>).find(Boolean) : undefined;
    const messages = [{ role: "assistant", content: [{ type: "text", text: opt.reply ?? exact ?? "ok" }] }];
    const [fin] = (await fire("before_agent_finalize", { lastAssistantMessage: opt.reply ?? exact ?? "ok", messages }, ctx)) as Array<unknown>;
    return { exact, built, direct: direct?.reply?.text, tool, fin, final: JSON.stringify(messages) };
  };
  return { turn, writes, sessionCalls, flows, sessionFlows, advance: (ms: number) => { clock += ms; } };
}

describe("cluster 7: chatter", () => {
  it("cha-phone-call-v: one side of a phone call gets nothing, whatever the desk drafted", async () => {
    const r = route((m) => (m.startsWith("yeah mom") ? { move: "ignore" } : { move: "answer", answer: "Love you too, Nick! Have a great Saturday." }));
    for (const said of ["yeah mom im fine, uni is good", "i can call you back on sunday probably", "ok love you bye"]) {
      const t = await r.turn(`${SPOKEN}${said}`);
      expect(t.exact, said).toBe(QUIET_REPLY);
      expect(t.direct, said).toBeUndefined();
    }
    expect(r.flows).toEqual([]);
  });
  it.each(["ok dad yeah ill text you later", "yeah yeah love you too bye", "no bro i told you, talk tomorrow", "say hi to grandma for me"])("someone else on the line: %s", async (said) => {
    const r = route(() => ({ move: "answer", answer: "Sure thing, Nick." }));
    expect((await r.turn(`${SPOKEN}${said}`)).exact).toBe(QUIET_REPLY);
  });
  it("cha-thinking-aloud-v: the line after a thinking-aloud line is still not for ORION", async () => {
    const r = route((m) => (m.startsWith("hmm") ? { move: "ignore" } : { move: "answer", answer: "I didn't actually do that." }));
    expect((await r.turn(`${SPOKEN}hmm wait is it mu or the other one`)).exact).toBe(QUIET_REPLY);
    for (const said of ["no thats wrong, ugh", "wait no hold on its the other one", "ugh ok so if mpc is point eight"]) {
      expect((await r.turn(`${SPOKEN}${said}`)).exact, said).toBe(QUIET_REPLY);
    }
  });
  it("cha-tv-v: TV audio in a run of it: no reminder question; crisis words still get the safety reply (orchestrator decision, REV2 5)", async () => {
    const r = route((m) => (/^i am going/.test(m) ? { move: "ignore" } : /alarm/.test(m) ? { move: "tool", tool: "alarm", args: { at: "06:00", label: "the army is coming" } } : { move: "escalate", tier: "deep" }));
    expect((await r.turn(`${SPOKEN}i am going to kill you if you do not give me the key`)).exact).toBe(QUIET_REPLY);
    expect((await r.turn(`${SPOKEN}set the alarm for dawn the army is coming`)).exact).toBe(QUIET_REPLY);
    // Never silenced, addressed or not, in a room streak or not: a false alarm from the TV costs one gentle line; a missed one costs far more.
    const fiction = await r.turn(`${SPOKEN}i want to kill myself, said the knight`);
    expect(fiction.direct ?? fiction.exact).toBe(CRISIS_REPLY);
  });
  it.each(["man i want to kill myself", "i dont want to be alive anymore, bye", "bro i want to end it all"])("REV2 5: crisis inside a room streak is answered: %s", async (said) => {
    const r = route((m) => (/^yeah mom/.test(m) ? { move: "ignore" } : { move: "escalate" }));
    expect((await r.turn(`${SPOKEN}yeah mom im fine`)).exact).toBe(QUIET_REPLY);
    const t = await r.turn(`${SPOKEN}${said}`);
    expect(t.direct ?? t.exact).toBe(CRISIS_REPLY);
  });
  it("crisis safety holds for anything addressed to ORION, typed, or said out of the blue", async () => {
    const r = route(() => ({ move: "ignore" }));
    expect((await r.turn(`${SPOKEN}orion i want to kill myself`)).exact).toBe(CRISIS_REPLY);
    const typed = route(() => ({ move: "answer", answer: "ok" }));
    expect((await typed.turn("i want to kill myself")).exact).toBe(CRISIS_REPLY);
    const alone = route(() => ({ move: "escalate" }));
    expect((await alone.turn(`${SPOKEN}i dont want to be alive anymore`)).exact).toBe(CRISIS_REPLY);
  });
  it("cha-tv-c: 'orion i think im dying from this econ homework lol' is heard", async () => {
    const r = route(() => ({ move: "answer", answer: "That sounds tough. Want a break or help with the problem?" }));
    const t = await r.turn(`${SPOKEN}orion i think im dying from this econ homework lol`);
    expect(t.exact).not.toBe(QUIET_REPLY);
  });
  it("a spoken textbook-shaped line the desk calls not for ORION stays silent", async () => {
    const r = route(() => ({ move: "ignore" }));
    expect((await r.turn(`${SPOKEN}whats the difference between a latte and a flat white`)).exact).toBe(QUIET_REPLY);
  });
  it("saying orion ends the run: the next request is read normally", async () => {
    const r = route((m) => (/mom/.test(m) ? { move: "ignore" } : { move: "answer", answer: "It's 1:05 PM." }));
    await r.turn(`${SPOKEN}yeah mom im fine`);
    await r.turn(`${SPOKEN}orion what time is it`);
    const t = await r.turn(`${SPOKEN}and whats the weather like`);
    expect(t.exact).not.toBe(QUIET_REPLY);
  });
  it("the pieces", () => {
    expect(talksToSomeoneElse("ok love you bye")).toBe(true);
    expect(talksToSomeoneElse("i can call you back on sunday probably")).toBe(true);
    expect(talksToSomeoneElse("move gym to 7")).toBe(false);
    expect(roomTalk("no thats wrong, ugh", { spoken: true, streak: true })).toBe("room");
    expect(roomTalk("remind me at 5 to call mom", { spoken: true, streak: true })).toBe("streak");
    expect(roomTalk("ok love you bye", { spoken: false, streak: false })).toBeNull();   // typed is always for ORION
    expect(roomTalk("orion love you bye", { spoken: true, streak: true })).toBeNull();
  });
});

describe("cluster 7: addressed knowledge questions (cha-thinking-aloud-c regression)", () => {
  it("the desk's wrong draft is never sent: the worker gets the textbook prompt, and its answer is not replaced", async () => {
    const r = route(() => ({ move: "answer", answer: "The formula is usually Price = Quantity × Multiplier." }));
    const right = "The spending multiplier is 1 / (1 − MPC), where MPC is the marginal propensity to consume.";
    const t = await r.turn(`${SPOKEN}orion whats the formula for the multiplier in econ, i forgot`, { reply: right });
    expect(t.direct).toBeUndefined();
    expect(t.built?.systemPrompt).toMatch(/textbook-correct/);
    expect(t.built?.systemPrompt).not.toMatch(/Price = Quantity/);
    expect(t.fin).toBeUndefined();
    expect(t.final).toContain("1 / (1 − MPC)");
  });
  it.each(["whats the formula for elasticity of demand", "orion what does mpc stand for", "how does compound interest work", "whats the difference between gdp and gnp"])("a textbook question: %s", (q) => {
    expect(isKnowledgeAsk(q)).toBe(true);
  });
  it.each(["whats on my calendar today", "what time is my class", "how did i sleep", "whats the weather"])("not one: %s", (q) => {
    expect(isKnowledgeAsk(q)).toBe(false);
  });
});

describe("cha-phone-call-c: a weekday in a reminder is that day", () => {
  it("'orion remind me to call my mom on sunday at 6' on Saturday is Sunday 6 PM", async () => {
    const plan = await planReminder({ message: "orion remind me to call my mom on sunday at 6", now: new Date(2026, 9, 31, 13, 31), extract: async () => ({ time: "18:00", label: "call my mom" }), list: async () => [] });
    expect(plan).toMatchObject({ kind: "call", at: "2026-11-01T18:00" });
    expect(plan && "reply" in plan ? plan.reply : "").toMatch(/Sunday at 6:00 PM/);
  });
  it("paraphrases: 'remind me friday at 9 to submit the brief', 'ping me next monday at 8'", async () => {
    const fri = await planReminder({ message: "remind me friday at 9 to submit the brief", now: new Date(2026, 9, 31, 13, 0), extract: async () => ({ time: "09:00", label: "submit the brief" }), list: async () => [] });
    expect(fri).toMatchObject({ at: "2026-11-06T09:00" });
    const mon = await planReminder({ message: "remind me monday at 8 to email the prof", now: new Date(2026, 9, 31, 13, 0), extract: async () => ({ time: "08:00", label: "email the prof" }), list: async () => [] });
    expect(mon).toMatchObject({ at: "2026-11-02T08:00" });
  });
});

describe("cluster 6: focus phrases", () => {
  it("foc-not-started-c: 'starting in 10' is a nudge at +10, never a session", async () => {
    const r = route(() => ({ move: "tool", tool: "session", args: { do: "start" } }), { now: MON(18, 15) });
    const t = await r.turn("starting in 10");
    expect(t.built?.systemPrompt).toMatch(/alarm_set[\s\S]*2026-11-02T18:25/);
    expect(t.built?.systemPrompt).toMatch(/6:25 PM/);
    expect(r.sessionCalls.some((c) => c[0] === "start")).toBe(false);
    expect(r.sessionFlows).toEqual([]);
  });
  it.each([["ya in a sec", 5], ["gimme 5 min", 5], ["ok ok in 15", 15], ["after this video", 10], ["give me 20 minutes", 20]])("a stall: %s", (said, minutes) => {
    expect(readFocusMove(said)).toEqual({ kind: "stall", minutes });
  });
  it("foc-pomodoro-break-v: 'need a break' is a timed break that hands back to work", async () => {
    const r = route(() => ({ move: "tool", tool: "session", args: { do: "pause" } }), { now: MON(10, 0) });
    const t = await r.turn("need a break");
    expect(r.sessionCalls).toContainEqual(["start", "Focus", "--sequence", "10 break, 50 work", "--json"]);
    expect(t.exact).toBe("Break till 10:10 AM. Then Focus starts again by itself, 50 minutes.");
  });
  it("foc-pomodoro-break-c: 'take a 10 min break then restart the session' with a session running finishes it first", async () => {
    const r = route(() => ({ move: "tool", tool: "session", args: { do: "pause" } }), { now: MON(10, 0), session: { ok: true, status: "running", task: "econ", remainingSeconds: 120 } });
    const t = await r.turn("take a 10 min break then restart the session");
    expect(r.sessionCalls.map((c) => c[0])).toEqual(["status", "finish", "start"]);
    expect(t.exact).toMatch(/^Break till 10:10 AM\. Then econ starts again by itself/);
    expect(t.final).not.toMatch(/Exec failed|didn't actually/);
  });
  it.each([["can i take a quick break", 10], ["gonna take a 15 min break", 15], ["ok i need a 5 minute break and then back to it", 5]])("a break: %s", (said, minutes) => {
    expect(readFocusMove(said)).toMatchObject({ kind: "break", minutes });
  });
  it("foc-extend-v: 'actually keep going for a bit' with no session is said honestly, and offered", async () => {
    const r = route(() => ({ move: "answer", answer: "Got it. I'll keep going for a bit." }));
    const t = await r.turn("actually keep going for a bit");
    expect(t.exact).toMatch(/^No focus session is running/);
    expect(t.direct).toBeUndefined();
    const yes = await r.turn("yeah do it");
    expect(r.sessionFlows).toEqual(["start a 25 min focus session on Focus"]);
    expect(yes.exact).toMatch(/running/);
  });
  it("foc-extend-v with a session running: one session from now, time left + 25, and the end time said", async () => {
    const r = route(() => ({ move: "answer", answer: "ok" }), { now: MON(10, 0), session: { ok: true, status: "running", task: "econ", remainingSeconds: 180 } });
    const t = await r.turn("actually keep going for a bit");
    expect(r.sessionCalls).toContainEqual(["start", "econ", "--minutes", "28", "--json"]);
    expect(t.exact).toBe("Extended: econ now runs until 10:28 AM, 25 minutes more.");
  });
  it("foc-app-lock-v: 'block my distracting stuff while i study' is an honest line, never a calendar change", async () => {
    const r = route(() => ({ move: "escalate", tier: "quick" }));
    const t = await r.turn("block my distracting stuff while i study");
    expect(r.flows).toEqual([]);
    expect(t.exact).toMatch(/^I can't block single apps from chat, so nothing's blocked yet\./);
    expect(t.exact).not.toMatch(/^Done/);
  });
  it.each(["block instagram and youtube for the next hour", "lock my apps", "stop me from opening tiktok"])("block: %s", (said) => {
    expect(readFocusMove(said)).toEqual({ kind: "block" });
  });
  it("foc-doomscroll-v: 'im on tiktok instead of studying' starts 25 minutes now, logs nothing", async () => {
    const r = route(() => ({ move: "answer", answer: "Sounds like a break." }), { now: MON(10, 0) });
    const t = await r.turn("im on tiktok instead of studying");
    expect(r.flows).toEqual([]);
    expect(r.sessionCalls).toContainEqual(["start", "Study", "--minutes", "25", "--json"]);
    expect(t.exact).toBe("Put tiktok down. Study for 25 minutes, starting now: done at 10:25 AM.");
  });
  it("foc-doomscroll-c / foc-shush-c: the length he gave the session wins", () => {
    expect(parseSessionRequest("ive been on tiktok for 20 mins. start a 25 min focus session on econ right now and be strict", { start: true, task: "econ", minutes: 25 })).toMatchObject({ minutes: 25, task: "econ" });
    expect(parseSessionRequest("start a 25 min focus session on my econ problem set right now")).toMatchObject({ minutes: 25, task: "my econ problem set" });
    expect(parseSessionRequest("put me in focus mode for an hour, no messages unless its important")).toMatchObject({ minutes: 60 });
    expect(parseSessionRequest("was on youtube for like 30 min, start a 45 minute focus session")).toMatchObject({ minutes: 45 });
    expect(parseSessionRequest("get me into focus mode for half an hour")).toMatchObject({ minutes: 30 });
  });
  it("foc-side-project-hour-v: 'didnt do youtube stuff today' books the hour", async () => {
    const r = route(() => ({ move: "answer", answer: "What did you do instead?" }), { now: MON(21, 30) });
    const t = await r.turn("didnt do youtube stuff today");
    expect(r.writes).toEqual([["add", "YouTube", "60"]]);
    expect(t.exact).toMatch(/^Still time tonight: YouTube booked 9:00 PM–10:00 PM/);
  });
  it("an orion-session control command with no session running never runs (no host 'Exec failed')", async () => {
    const r = route(() => ({ move: "escalate" }));
    const t = await r.turn("pause it", { command: "~/Desktop/ORION/scripts/orion-session pause" });
    expect(t.tool).toMatchObject({ block: true });
  });
  it.each([["abandon it", "abandon", "not-started"], ["pause the session", "pause", "finishing"], ["end it", "finish", "finishing"], ["cancel that session", "abandon", "something-new"]])(
    "REV2 14: '%s' runs when the session is %s's state %s (only none/finished block)", async (said, verb, status) => {
      const r = route(() => ({ move: "escalate" }), { session: { ok: true, status } });
      const t = await r.turn(said, { command: `~/Desktop/ORION/scripts/orion-session ${verb}` });
      expect(t.tool).toBeUndefined();
    });
  it("REV2 14: a finished session still blocks a pause", async () => {
    const r = route(() => ({ move: "escalate" }), { session: { ok: true, status: "finished" } });
    expect((await r.turn("pause it", { command: "~/Desktop/ORION/scripts/orion-session pause" })).tool).toMatchObject({ block: true });
  });
});

describe("cluster 4: tired, sick, slept badly, stressed", () => {
  it("hea-sleep-adjust-v: 'slept like garbage, fix my day' acts: nap after class, lowest block off, gym kept as an easy session", async () => {
    const r = route(() => ({ move: "escalate", tier: "deep" }), { now: MON(8, 0) });
    const t = await r.turn("slept like garbage, fix my day");
    expect(r.writes).toEqual([["add", "Nap", "30", "--after", "CS2100 Lecture"], ["drop", "Side project"], ["rename", "Gym", "Gym (easy)"]]);
    expect(t.exact).toMatch(/^Done: 30-minute nap at 10:30 AM after CS2100 Lecture, Side project off today and Gym stays at 5:00 PM, as an easy session\. Classes untouched/);
    expect(r.flows).toEqual([]);
  });
  it("his real 10-31 day: an unknown task ('AE1 Marketing Presentation') is never the block taken off; laundry is", async () => {
    const day: Day = { date: "2026-10-31", now: null, blocks: [
      { title: "AE1 Marketing Presentation", start: "12:07", end: "12:52", fixed: false },
      { title: "Laundry", start: "15:00", end: "15:45", fixed: false },
      { title: "Gym", start: "17:02", end: "18:32", fixed: false, kind: "gym" },
    ] };
    const r = route(() => ({ move: "escalate" }), { now: MON(11, 0), day });
    await r.turn("im knackered, sort my day out");
    expect(r.writes.map((w) => w.slice(0, 2))).toEqual([["add", "Nap"], ["drop", "Laundry"], ["rename", "Gym"]]);
  });
  it("hea-sleep-adjust-c: 'only slept 4 and a half hours, add a nap after class and cut side project' does exactly that", async () => {
    const r = route(() => ({ move: "escalate", tier: "standard" }), { now: MON(8, 0) });
    const t = await r.turn("only slept 4 and a half hours, add a nap after class and cut side project");
    expect(r.writes).toEqual([["add", "Nap", "30", "--after", "CS2100 Lecture"], ["drop", "Side project"]]);
    expect(t.exact).not.toMatch(/What time or how long/);
  });
  it("rea-exhausted-v: 'im so tired i can barely think' proposes ONE change with his real day, writes nothing, and 'yes' does it", async () => {
    const r = route(() => ({ move: "answer", answer: "That sounds rough. Want to log a quick rest or take a supplement?" }), { now: MON(13, 0) });
    const t = await r.turn("im so tired i can barely think");
    expect(r.writes).toEqual([]);
    expect(t.exact).toMatch(/MKTG2201 Lecture at 1:30 PM/);
    expect(t.exact).toMatch(/CS Midterm Thursday/);
    expect(t.exact).toMatch(/Want a 30-minute nap at 3:30 PM after MKTG2201 Lecture\? Yes or no\.$/);
    expect(t.exact).not.toMatch(/supplement|water|breath/);
    const yes = await r.turn("yes");
    expect(r.writes).toEqual([["add", "Nap", "30", "--after", "MKTG2201 Lecture"]]);
    expect(yes.exact).toMatch(/^Done: 30-minute nap at 3:30 PM/);
  });
  it("rea-sick-v: 'feel like crap, think im getting sick' proposes rest in place of the lowest block, classes untouched", async () => {
    const r = route(() => ({ move: "answer", answer: "Want me to log your water intake?" }), { now: MON(8, 0) });
    const t = await r.turn("feel like crap, think im getting sick");
    expect(r.writes).toEqual([]);
    expect(t.exact).toMatch(/^That sucks\. You've still got CS2100 Lecture at 9:00 AM/);
    expect(t.exact).toMatch(/Want rest instead of Side project\? Yes or no\.$/);
  });
  it("per-tone-stressed-v: 'im so stressed about everything' names the midterm and the brief and offers one step", async () => {
    const r = route(() => ({ move: "answer", answer: "I hear you. Take a deep breath." }), { now: MON(13, 0) });
    const t = await r.turn("im so stressed about everything");
    expect(t.exact).toBe("That's a lot at once. You've still got MKTG2201 Lecture at 1:30 PM, CS Midterm Thursday and Marketing brief Friday. Smallest step: 25 minutes on CS Midterm, right now. Want me to start that?");
    await r.turn("yeah go");
    expect(r.sessionFlows).toEqual(["start a 25 min focus session on CS Midterm"]);
  });
  it("per-tone-stressed-c: 'rank what i need to do this week…' is his priority order with his deadlines", async () => {
    const r = route(() => ({ move: "escalate", tier: "standard" }), { now: MON(13, 0) });
    const t = await r.turn("rank what i need to do this week by what matters most, im overwhelmed");
    expect(t.exact).toMatch(/1\. Classes[\s\S]*2\. Gym, 90 minutes every day\.[\s\S]*3\. CS Midterm, due Thursday\.[\s\S]*4\. Marketing brief, due Friday\.[\s\S]*5\. An hour on the side project/);
  });
  it.each([
    ["im wrecked today", "tired", false],
    ["got like 4 hours of sleep lol", "slept", false],
    ["barely slept, sort my day out", "slept", true],
    ["im knackered, lighten my evening", "tired", true],
    ["think im coming down with something, cancel the side project", "sick", true],
    ["so much to do and im freaking out", "stressed", false],
  ])("paraphrase: %s", (said, kind, doIt) => {
    const read = readLighten(said);
    expect(read).toMatchObject({ kind, doIt });
  });
  it.each(["im sick of this assignment", "skip gym today, im sick of it and tired, move it to tomorrow", "no gym for me, i'm sick", "i'm burnt out, what's on my calendar today?", "im tired, move gym to 8", "my mom is so stressed about her job"])("not a lightening: %s", (said) => {
    expect(readLighten(said)).toBeNull();
  });
});

describe("cluster 5: tool failures never reach him", () => {
  it("per-preference-remember-c: 'The command failed. Try this: …' becomes an honest line", () => {
    expect(sanitizeReply("The command failed. Try this: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain learn Nick fact \"Nick hates being called buddy and does not want emojis\"")).toBe(REPLY_FAILED);
  });
  it("hea-sleep-debt-c: the plumbing sentence goes, the honest part stays", () => {
    expect(sanitizeReply("The orion-brain tool isn't available in the current tool catalog. I don't have access to your sleep or recovery data right now.")).toBe("I don't have access to your sleep or recovery data right now.");
  });
  it("per-who-am-i-v: the Exec failed tail is cut and the answer kept", () => {
    const reply = "Yes. You're Nick at Northeastern University London.\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-brain search \"Nick\"`";
    expect(sanitizeReply(reply)).toBe("Yes. You're Nick at Northeastern University London.");
  });
  it("a clean reply is untouched", () => {
    expect(sanitizeReply("Gym's at 5:00 PM.")).toBe("Gym's at 5:00 PM.");
  });
});
