// Room speech, quiet windows, memory from speech and repeated failures (2026-10-30). Phrasings from R2 (10-25 room chatter,
// 10-26 rehearsal) and scripts/eval/gate/scenarios/chatter.json.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUIET_REPLY, QuietWindow, RepeatGuard, addressed, quietAck, quietRequest } from "./chatter.js";
import { tellsFactAloud } from "./memory-facts.js";
import { SPOKEN_DESK_NOTE, registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";

describe("the pieces", () => {
  it.each([
    ["orion i am rehearsing a presentation for the next 20 minutes, dont reply to anything i say unless i say orion", 20],
    ["don't reply unless I say orion", 30],
    ["shush", 30],
    ["im doing work shush up", 30],
    ["i'm rehearsing", 30],
    ["be quiet for an hour", 60],
    ["quiet mode for half an hour", 30],
  ])("a quiet request: %s", (message, minutes) => {
    expect(quietRequest(message)).toBe(minutes);
  });
  it.each(["why were you quiet?", "don't be quiet", "can you remind me to rehearse at 5", "what did annika say"])("not one: %s", (m) => {
    expect(quietRequest(m)).toBeNull();
  });
  it("the ack is short and says how it ends", () => {
    expect(quietAck(20)).toBe("Okay, I'll stay quiet until you say \"Orion\" (or for 20 minutes).");
    expect(quietAck(60)).toBe("Okay, I'll stay quiet until you say \"Orion\" (or for 1 hour).");
  });
  it("addressed means his name", () => {
    expect(addressed("orion whats the formula for the multiplier")).toBe(true);
    expect(addressed("hmm wait is it mu or the other one")).toBe(false);
  });
  it("out loud, only an explicit 'remember' or 'note that' is a fact", () => {
    expect(tellsFactAloud("orion remember i hate being called buddy")).toBe(true);
    expect(tellsFactAloud("orion, note that my lab partner is priya")).toBe(true);
    expect(tellsFactAloud("frozen is honestly a good movie")).toBe(false);
    expect(tellsFactAloud("carol would hate that, you introduce her to something and she goes mad")).toBe(false);
    expect(tellsFactAloud("my favourite movie is frozen")).toBe(false);
  });
  it("the quiet window lives in the state dir and ends", () => {
    const dir = mkdtempSync(join(tmpdir(), "quiet-"));
    const w = new QuietWindow(dir);
    w.start(1_000_000, 20, "rehearsing");
    expect(w.until(1_000_000 + 60_000)).toBe(1_000_000 + 20 * 60_000);
    expect(new QuietWindow(dir).until(1_000_000 + 60_000)).toBe(1_000_000 + 20 * 60_000);   // another session sees it
    expect(w.until(1_000_000 + 21 * 60_000)).toBeNull();                                     // timed out
    w.end(1_000_000 + 2 * 60_000);
    expect(w.until(1_000_000 + 3 * 60_000)).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "chat-quiet.json"), "utf8")).reason).toBe("ended");
  });
  it("the same ask failing twice: typed and phone get a different, useful reply keyed on his message, never a bare ellipsis; spoken goes quiet after one", () => {
    const g = new RepeatGuard();
    const nd = "I couldn't do that: gym at 10:00 PM is after your 9:50 PM bedtime. Want me to move your bedtime for it, or book it anyway?";
    const ask = "add gym 10 to 11pm i'm going when i get back";
    expect(g.guard("s", nd, false, 0, ask)).toBe(nd);
    const second = g.guard("s", nd, false, 60_000, ask);
    expect(second).not.toBe(nd); expect(second).not.toBe(QUIET_REPLY);
    expect(second).toMatch(/bedtime/i);
    expect(second).not.toMatch(/same problem|rephrase|say it again/i);
    const third = g.guard("s", nd, false, 120_000, ask);
    expect(third).not.toBe(QUIET_REPLY); expect(third).not.toBe(second);
    expect(g.guard("s", nd, false, 13 * 60_000, ask)).toBe(nd);               // after ten minutes it may be said again
    // the same failure for a different ask is a new thing to say, not a repeat
    expect(g.guard("t", nd, false, 0, "put gym at 10")).toBe(nd);
    expect(g.guard("t", nd, false, 5, "book gym tonight after 10")).toBe(nd);
    const v = new RepeatGuard();
    expect(v.guard("v", nd, true, 0)).toBe(nd);
    expect(v.guard("v", nd, true, 1)).not.toBe(nd);
    expect(v.guard("v", nd, true, 2)).toBe(QUIET_REPLY);
    expect(v.guard("v", "Done: moved Gym to 7 PM.", true, 3)).toBe("Done: moved Gym to 7 PM.");   // only failures
    expect(v.guard("other", nd, true, 3)).toBe(nd);                                            // per session
  });
});

// ---- the live route ----
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const SPOKEN = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";
function route(decide: (message: string) => Decision, opts: { scheduleFlow?: (m: string) => Promise<FlowResult> } = {}) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "chatter-"));
  const desk: Array<{ message: string; context?: string }> = []; const flows: string[] = [];
  let clock = new Date(2026, 9, 26, 6, 0).getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 06:00", now: () => new Date(clock),
    decideImpl: async (i: { message: string; context?: string }) => { desk.push(i); return decide(i.message); }, brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return opts.scheduleFlow ? opts.scheduleFlow(m) : { outcome: "fallback", reason: "test" }; } } as never);
  let n = 0;
  const turn = async (prompt: string, command?: string) => {
    const ctx = { runId: `c-${n += 1}`, sessionKey: "agent:main:orion-chat-voice" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string }>;
    const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    const tool = command ? ((await fire("before_tool_call", { toolName: "exec", params: { command } }, ctx)) as Array<{ block?: boolean } | undefined>).find(Boolean) : undefined;
    await fire("before_agent_finalize", { lastAssistantMessage: exact ?? "ok", messages: [] }, ctx);
    return { exact, built, tool };
  };
  return { turn, desk, flows, dir, advance: (ms: number) => { clock += ms; } };
}

describe("chatter on the live route", () => {
  it("the front desk is told a spoken turn came through the microphone", async () => {
    const r = route(() => ({ move: "ignore" }));
    await r.turn(`${SPOKEN}so then the next slide shows the competitor pricing`);   // ("yeah mom …" no longer reaches the desk: roomTalk)
    expect(r.desk[0]?.context).toContain(SPOKEN_DESK_NOTE);
  });

  it("cha-phone-call-v / cha-friend-v: spoken speech the desk calls ignore gets no reply, no memory, no flow", async () => {
    const r = route(() => ({ move: "ignore" }));
    for (const said of ["yeah mom im fine, uni is good", "i can call you back on sunday probably", "frozen is honestly a good movie"]) {
      expect((await r.turn(`${SPOKEN}${said}`)).exact).toBe(QUIET_REPLY);
    }
    expect(r.flows).toEqual([]);
  });

  it("cha-presentation: 'rehearsing … unless i say orion' acks once, then the rehearsal draws nothing (no desk, no flow), and 'orion …' ends it", async () => {
    const r = route(() => ({ move: "escalate" }), { scheduleFlow: async () => ({ outcome: "say", kind: "plain", text: "Not done: 6:00 AM–6:00 AM is shorter than 5 minutes.", calls: ["exec orion-reschedule log x --from 06:00 --to now"] }) });
    const start = await r.turn(`${SPOKEN}orion i am rehearsing a presentation for the next 20 minutes, dont reply to anything i say unless i say orion`);
    expect(start.exact).toBe("Okay, I'll stay quiet until you say \"Orion\" (or for 20 minutes).");
    const deskBefore = r.desk.length;
    for (const said of ["so for our target segment we looked at gen z students in london who care about price", "and the key insight is that eligibility checks are the pain point"]) {
      r.advance(60_000);
      expect((await r.turn(`${SPOKEN}${said}`)).exact).toBe(QUIET_REPLY);
    }
    expect(r.desk.length).toBe(deskBefore);
    expect(r.flows).toEqual([]);
    r.advance(60_000);
    const back = await r.turn(`${SPOKEN}orion whats the formula for the multiplier in econ`);
    expect(back.exact).not.toBe(QUIET_REPLY);
    expect(r.desk.length).toBe(deskBefore + 1);
    r.advance(60_000);
    // the window ended with "orion": the next spoken line is read normally again (the desk is asked)
    await r.turn(`${SPOKEN}and what about the marginal propensity`);
    expect(r.desk.length).toBe(deskBefore + 2);
  });

  it("the quiet window times out on its own", async () => {
    const r = route(() => ({ move: "escalate" }));
    await r.turn(`${SPOKEN}shush`);
    r.advance(31 * 60_000);
    await r.turn(`${SPOKEN}ok what's next on my day`);
    expect(r.desk.length).toBe(1);
  });

  it("R2 10-26: a sentence misread as 'log it' is never answered with the scheduler's zero-length refusal; the worker gets it", async () => {
    const r = route(() => ({ move: "escalate" }), { scheduleFlow: async () => ({ outcome: "say", kind: "plain", text: "Not done: 2:24 PM–2:24 PM is shorter than 5 minutes.", calls: ["exec orion-reschedule log \"text to annika\" --from 14:24 --to now"] }) });
    const t = await r.turn("draft a text to annika saying im 20 min late, dont send it");   // saf-send-message-c
    expect(t.exact ?? "").not.toMatch(/Not done/);   // wave 3: code now shows the draft itself
    expect(t.exact).toBe("Draft to Annika: \"I'm 20 min late.\" Not sent.");
  });

  it("the same failure line is not repeated within ten minutes: typed gets 'same problem' once", async () => {
    const r = route(() => ({ move: "escalate" }), { scheduleFlow: async () => ({ outcome: "say", kind: "plain", text: "That doesn't fit: there's no gym on that day's calendar" }) });
    expect((await r.turn("move gym to 9pm")).exact).toMatch(/^That doesn't fit/);
    const again = (await r.turn("move gym to 9pm")).exact;
    expect(again).not.toMatch(/^That doesn't fit/); expect(again).not.toBe(QUIET_REPLY); expect(again).not.toMatch(/same problem|say it again/i);
  });

  it("memory guard: spoken and not 'remember …', a brain learn is blocked; 'orion remember …' is allowed", async () => {
    const r = route(() => ({ move: "escalate" }));
    const chatter = await r.turn(`${SPOKEN}carol would hate that, you introduce her to something and she goes mad`, "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain learn \"Nick\" \"fact\" \"Frozen\"");
    expect(chatter.tool).toMatchObject({ block: true });
    const asked = await r.turn(`${SPOKEN}orion remember i hate being called buddy`, "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain learn \"Nick\" \"preference\" \"hates being called buddy\"");
    expect(asked.tool?.block).not.toBe(true);
  });

  it("spoken 'my favourite movie is frozen' does not get the save-a-fact prompt; typed still does", async () => {
    const r = route(() => ({ move: "escalate" }));
    expect((await r.turn(`${SPOKEN}my favourite movie is frozen`)).built?.appendContext ?? "").not.toMatch(/orion-brain learn/);
    expect((await r.turn("my favourite movie is frozen")).built?.appendContext ?? "").toMatch(/orion-brain learn/);
  });
});
