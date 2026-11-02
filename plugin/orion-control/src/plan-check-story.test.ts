// w16 a-reply (2026-11-02 23:04, live): ORION asked "You're out - is Go over Orion learning plan still happening, or did plans change?"
// and Nick answered in a run-on (at a friend's place, away right now, postpone that). Too long for the short-reply reader, so the reality
// reader took "i went to wales with" as a class attended and replied "Got it, you were at wales with. Noted as attended". Held-out
// phrasings in his style; fixtures only, no real paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { readPlanCheckStory, readPersonMention } from "./plan-check-story.js";
import { readReality, runReality } from "./reality.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.


User message:
`;
const TITLE = "Go over Orion learning plan";
const ASK = `You're out - is ${TITLE} still happening, or did plans change? I'll update the calendar.`;
/** The app's live label for this question (the shape it sent at 23:04). */
const LABEL = `[ORION context: 1 min ago you asked "${ASK}" (${TITLE}, planned 22:55-23:55, not started). If he says what he did or is doing, log it.]\n`;
const DAY: Day = { date: "2026-11-02", now: "23:04", blocks: [{ title: TITLE, start: "22:55", end: "23:55", fixed: false }] };
const LIVE = "yea im at Avery's place. shes a friend super cool firiend that i went to wales with. also really cute and i like her but thats besides the point. so yea away right now sorry. postpone that";

function route(nowHm = "23:04") {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "pcs-"));
  const reality: string[][] = []; const learned: string[][] = []; const flows: string[] = [];
  const [h, m] = nowHm.split(":").map(Number);
  registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => `Mon ${nowHm}`, now: () => new Date(2026, 10, 2, h!, m!),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate" }), brainSearch: async () => "",
    readDayJson: async (a: string[]) => (a.includes("tomorrow") ? { date: "2026-11-03", now: null, blocks: [] } : DAY),
    readDay: async () => JSON.stringify(DAY),
    scheduleFlow: async (msg: string): Promise<FlowResult> => { flows.push(msg); return { outcome: "fallback", reason: "test" }; },
    realityRun: async (script: string, args: string[]) => { reality.push([script, ...args]); return { stdout: script === "orion-declare" && args[0] === "list" ? "[]" : '{"id":"fact-abcd1234"}', code: 0 }; },
    knowledgeRun: async (script: string, args: string[]) => { learned.push([script, ...args]); return { stdout: `Added to "${args[2]}": - people: ${args[4]}`, code: 0 }; },
  } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `pcs-${n += 1}`, sessionKey: "agent:main:orion-chat-pcs" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string } | undefined>;
    return /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
  };
  return { turn, reality, learned, flows };
}

describe("his free-text answer to 'is X still happening, or did plans change?'", () => {
  it.each([
    "nah im out w friends rn so not happening",
    "im at jess's house lol not gonna happen tonight",
    "away rn sorry, do it later",
    "at my friends place for a bit so no",
    "postpone that",
    "yeah im at sams flat atm, push it",
    "ugh got dragged out to dinner w my flatmates, cant do it rn",
    "nah its off", "not happening", "nah thats off tonight",
  ])("plans changed: %s", (said) => {
    expect(readPlanCheckStory(said)?.kind).toBe("changed");
  });
  it.each([
    "ya still happening just running a bit late, heading home now",
    "yeah im out grabbing food but ill still do it when im back",
    "still on, omw home",
    "yep still doing it, be back in 20",
    "yea its still on", "ya still on", "yep happening", "still going", "ye its happening",
  ])("still happening: %s", (said) => {
    expect(readPlanCheckStory(said)?.kind).toBe("accept");
  });
  it.each(["im at the library with sam", "at a friends rn idk"])("unsure, one short question: %s", (said) => {
    expect(readPlanCheckStory(said)?.kind).toBe("unclear");
  });
  it.each(["whats the weather tmrw", "lol", "can u text mom i'll be late"])("not an answer to it: %s", (said) => {
    expect(readPlanCheckStory(said)).toBeUndefined();
  });
  it("the place he named comes back as said, never a sentence fragment", () => {
    expect(readPlanCheckStory("yea im at Avery's place. shes a friend i went to wales with. away rn, postpone that")).toEqual({ kind: "changed", away: "Avery's" });
  });
});

describe("routed: the place-check reply never logs nonsense", () => {
  it("the 23:04 message: not 'attended', the plan is offered a move, nothing logged as attended", async () => {
    const r = route();
    const reply = await r.turn(`${LABEL}${APP}${LIVE}`);
    expect(reply).toBeDefined();
    expect(reply).not.toMatch(/you were at|attended/i);
    expect(reply).toMatch(/^Got it, you're out at Avery's, so Go over Orion learning plan isn't happening now\./);
    expect(reply).toMatch(/tomorrow|moved to/);
    expect(r.reality.filter((c) => c[0] === "orion-declare" && c[1] === "add")).toEqual([]);
  });
  it("the friend is kept as a person fact; the romantic remark is not", async () => {
    const r = route();
    const reply = await r.turn(`${LABEL}${APP}${LIVE}`);
    expect(r.learned).toHaveLength(1);
    const [script, ...args] = r.learned[0]!;
    expect(script).toBe("orion-brain");
    expect(args.slice(0, 4)).toEqual(["learn", "--own", "Avery", "people"]);
    expect(args[4]).toMatch(/friend/i); expect(args[4]).toMatch(/Wales/);
    expect(args.join(" ")).not.toMatch(/cute|like her|crush/i);
    expect(reply).toMatch(/I'll remember Avery is a friend you went to Wales with\.$/);
  });
  it("still happening: the plan is left where it is, nothing moved", async () => {
    const r = route();
    const reply = await r.turn(`${LABEL}${APP}ya im out rn but still doing it when i get back in like 20`);
    expect(reply).toBe(`Good — leaving ${TITLE} where it is.`);
    expect(r.flows).toEqual([]);
  });
  it.each(["yea its still on", "yep happening"])("short still-on, routed: %s", async (said) => {
    const r = route();
    expect(await r.turn(`${LABEL}${APP}${said}`)).toBe(`Good — leaving ${TITLE} where it is.`);
  });
  it.each(["nah its off", "postpone that"])("short plans-changed, routed, never a place or attended line: %s", async (said) => {
    const r = route();
    const reply = await r.turn(`${LABEL}${APP}${said}`);
    expect(reply).toMatch(/Go over Orion learning plan|Give me a time/);
    expect(reply).not.toMatch(/you were at|attended|you're at/i);
  });
  it("unsure: one short question, no write", async () => {
    const r = route();
    const reply = await r.turn(`${LABEL}${APP}at a friends rn idk`);
    expect(reply).toBe(`Got it. Is ${TITLE} still on for later, or should I move it?`);
    expect(r.flows).toEqual([]); expect(r.reality.filter((c) => c[1] === "add")).toEqual([]);
  });
});

describe("routed: other questions while the move offer is pending get their own answer", () => {
  it.each(["whats the weather gonna be like tmrw", "how was my sleep", "ok whats next"])("%s", async (said) => {
    const r = route();
    expect(await r.turn(`${LABEL}${APP}${LIVE}`)).toMatch(/^Got it, you're out/);
    const reply = await r.turn(`${LABEL}${APP}${said}`);
    expect(reply ?? "").not.toMatch(/Give me a time|moved to|still on for later/);
    expect(r.flows).toEqual([]);
  });
});

describe("reality: 'i went to X with' is not a class attended", () => {
  it.each(["i went to wales with her last summer", "shes a friend i went to wales with. so yea"])("%s", (said) => {
    const read = readReality(said);
    expect(read?.reality.kind === "attended" && /with$/.test(read.reality.what)).toBe(false);
  });
  it("an attended claim that names nothing on today's plan and no missed mark is not logged", async () => {
    const calls: string[][] = [];
    const out = await runReality({ reality: { kind: "attended", what: "wales" }, rest: false }, {
      run: async (s, a) => { calls.push([s, ...a]); return { stdout: a[0] === "list" ? "[]" : '{"id":"fact-1"}', code: 0 }; },
      readDay: async () => DAY, now: new Date(2026, 10, 2, 23, 4), source: "chat", text: "i was in wales" });
    expect(out).toBeNull();
    expect(calls.filter((c) => c[1] === "add")).toEqual([]);
  });
});

describe("a person he mentions", () => {
  it("name, relation and a shared trip, nothing else", () => {
    expect(readPersonMention(LIVE)).toEqual({ name: "Avery", fact: "a friend; went to Wales together", echo: "Avery is a friend you went to Wales with" });
    expect(readPersonMention("im at Jordan's house, hes my roommate")).toEqual({ name: "Jordan", fact: "a roommate", echo: "Jordan is your roommate" });
  });
  it.each(["im at averys place", "im at the library", "she's really cute and i like her", "im at Avery's place"])("nothing durable: %s", (said) => {
    expect(readPersonMention(said)).toBeUndefined();
  });
});
