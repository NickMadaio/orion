// REV4 (2026-10-31) findings 1, 2, 8, 9 and 11a on the pending-reply path: a short reply bound to ORION's last proactive nudge.
// Fixtures only: temp state dirs, a fake calendar the fake scheduler writes to, no real paths.
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { CRISIS_REPLY } from "./distress.js";
import { PendingMemory, readPendingTurn } from "./pending-reply.js";
import type { Decision } from "./front-desk.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const label = (text: string, minutes = 5) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const b = (title: string, start: string, end: string, fixed = false, kind?: string): DayBlock => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const at = (d: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y!, mo! - 1, da!, h!, m!); };
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** "8:35pm" / "8am" (the scheduler words pending-reply-day.ts writes) to minutes. */
const cmdMin = (t: string) => { const [, h, m, mer] = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) ?? []; return ((Number(h) % 12) + (mer === "pm" ? 12 : 0)) * 60 + Number(m ?? 0); };

const GAVE_UP = "I'll stop pinging about Gym. Tell me when you want to pick it back up.";
const DINNER_MISSED = "Looks like dinner with Sam didn't happen - want it tonight or tomorrow instead?";
const OFF_PLAN = "You're out - is Study for CS Midterm still happening, or did plans change? I'll update the calendar.";
const DINNER_CHECK = "You're out - is Dinner with Sam still happening, or did plans change? I'll update the calendar.";

const MON = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("MKTG2201 Marketing", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30"), b("Side project", "19:30", "20:30")] });
const FREE_TUE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("Gym", "17:00", "18:30")] });
const TUE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "09:00", "10:40", true, "class"), b("Gym", "17:00", "18:30")] });

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Opts = { now: Date; today?: Day; tomorrow?: Day; stateDir?: string; shift?: number; session?: string };
/** The routing hooks over a calendar that the fake scheduler really writes to (so a reply can be checked against a read-back). */
function harness(o: Opts) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = [];
  const runs: string[][] = [];
  const days = { today: o.today ?? MON(), tomorrow: o.tomorrow ?? TUE() };
  const clock = { now: o.now };
  const write = (message: string) => {
    const add = message.match(/^add a (\d+) min (.+?)( tomorrow)? at (\S+)$/);
    const move = message.match(/^move (tomorrow's )?(.+?) to (\S+)$/);
    const which = (add?.[3] || move?.[1]) ? "tomorrow" : "today";
    const day = days[which];
    if (add) { const s = cmdMin(add[4]!) + (o.shift ?? 0); days[which] = { ...day, blocks: [...day.blocks, b(add[2]!, hhmm(s), hhmm(s + Number(add[1])))] }; }
    if (move) {
      const s = cmdMin(move[3]!) + (o.shift ?? 0);
      days[which] = { ...day, blocks: day.blocks.map((x) => (x.title.toLowerCase() === move[2]!.toLowerCase() ? { ...x, start: hhmm(s), end: hhmm(s + toMin(x.end) - toMin(x.start)) } : x)) };
    }
  };
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pr4-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 12:00", now: () => clock.now,
    ...(o.stateDir ? { stateDir: o.stateDir } : {}),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); write(message); return { outcome: "done", calls: [`exec orion-reschedule (${message})`], outputs: ["Done."], marks: [`m${flows.length}`], reply: "Done." }; },
    realityRun: async (_script: string, args: string[]) => { runs.push(args); return { stdout: "Written to his calendar.", code: 0 }; },
    readDayJson: async (args: string[]) => (args.includes("tomorrow") ? days.tomorrow : days.today),
    checkinRun: async (args: string[]) => (args[0] === "find" ? { stdout: '{"open":false}', code: 1 } : { stdout: "ok ci-abc123", code: 0 }),
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `q${n += 1}-${Math.random()}`, sessionKey: o.session ?? "agent:main:orion-chat-rev4" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, flows, days, clock, runs };
}
const stateWithPush = (text: string, sent: Date): string => {
  const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
  appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "o1", text, at: sent.toISOString(), channel: "phone" })}\n`);
  return dir;
};
const push = (dir: string, text: string, sent: Date) => appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: `o${sent.getTime()}`, text, at: sent.toISOString(), channel: "phone" })}\n`);

describe("1: after a crisis reply, a short reply is never bound to a nudge", () => {
  it("'nah' after the safety question, with a nudge sent after it, books nothing and gets no gym line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
    const h = harness({ now: at("2026-11-02", "19:30"), stateDir: dir, tomorrow: FREE_TUE() });
    expect(await h.turn(`${APP}i cant do this anymore`)).toContain(CRISIS_REPLY);
    push(dir, GAVE_UP, at("2026-11-02", "19:35"));
    h.clock.now = at("2026-11-02", "19:40");
    const reply = await h.turn(`${APP}nah`);
    expect(h.flows).toEqual([]);
    expect(reply).not.toMatch(/gym/i);
    const dots = await h.turn(`${label(GAVE_UP, 5)}${APP}...`);
    expect(h.flows).toEqual([]);
    expect(dots).not.toMatch(/still waiting|isn't optional/i);
  });
});

describe("1b: the crisis hold is shared by every chat and survives a restart", () => {
  const NUDGE = "Gym is at 5:00 PM. Still on?";
  it("a crisis on the phone holds a short reply on the Mac", async () => {
    const dir = stateWithPush(NUDGE, at("2026-11-02", "19:05"));
    const phone = harness({ now: at("2026-11-02", "19:10"), stateDir: dir, session: "agent:main:phone-thread" });
    expect(await phone.turn(`${APP}i cant do this anymore`)).toContain(CRISIS_REPLY);
    const mac = harness({ now: at("2026-11-02", "19:20"), stateDir: dir, session: "agent:main:orion-chat-mac" });
    await mac.turn(`${APP}nah`);
    expect(mac.flows).toEqual([]);
  });
  it("a restart (a new memory over the same state dir) still holds, and the hold ends after 30 minutes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
    const first = harness({ now: at("2026-11-02", "19:10"), stateDir: dir });
    await first.turn(`${APP}i cant do this anymore`);
    const held = new PendingMemory();
    expect(held.beginTurn("any-chat", at("2026-11-02", "19:25").getTime(), { crisis: false, replied: true }, dir).afterCrisis).toBe(true);
    const later = new PendingMemory();
    expect(later.beginTurn("any-chat", at("2026-11-02", "19:45").getTime(), { crisis: false, replied: true }, dir).afterCrisis).toBe(false);
  });
  it("a defaultable request inside the hold writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
    const h = harness({ now: at("2026-11-02", "17:00"), stateDir: dir });
    await h.turn(`${APP}i cant do this anymore`);
    h.clock.now = at("2026-11-02", "17:05");
    await h.turn(`${APP}tmrw needs to be chill`);
    expect(h.runs).toEqual([]);
  });
  it("the same request with no crisis before it does write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
    const h = harness({ now: at("2026-11-02", "17:05"), stateDir: dir });
    await h.turn(`${APP}tmrw needs to be chill`);
    expect(h.runs.length).toBeGreaterThan(0);
  });
});

describe("2: ORION's own later turn in the chat beats an older push", () => {
  it("a push older than ORION's last reply here is not what 'yeah' answers", async () => {
    const dir = stateWithPush(GAVE_UP, at("2026-11-02", "19:20"));
    const h = harness({ now: at("2026-11-02", "19:25"), stateDir: dir });
    await h.turn(`${APP}how was my day looking`);
    h.clock.now = at("2026-11-02", "19:27");
    await h.turn(`${APP}yeah`);
    expect(h.flows).toEqual([]);
  });
  it("the app's label for an outreach sent before ORION's last reply here is not bound either", async () => {
    const h = harness({ now: at("2026-11-02", "19:25") });
    await h.turn(`${APP}how was my day looking`);
    h.clock.now = at("2026-11-02", "19:28");
    await h.turn(`${label(GAVE_UP, 8)}${APP}ok fine`);
    expect(h.flows).toEqual([]);
  });
  it("a push sent after ORION's last reply is still answered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr4-state-"));
    const h = harness({ now: at("2026-11-02", "19:25"), stateDir: dir });
    await h.turn(`${APP}how was my day looking`);
    push(dir, GAVE_UP, at("2026-11-02", "19:26"));
    h.clock.now = at("2026-11-02", "19:30");
    await h.turn(`${APP}ok fine`);
    expect(h.flows).toEqual(["add a 30 min Gym at 8:35pm"]);
  });
  it("readPendingTurn refuses a source not newer than ORION's last reply", () => {
    const now = at("2026-11-02", "16:30");
    const lastPush = { text: OFF_PLAN, at: at("2026-11-02", "16:00").toISOString() };
    expect(readPendingTurn({ message: "changed", now, lastPush })?.offer?.kind).toBe("plan-check");
    expect(readPendingTurn({ message: "changed", now, lastPush, lastReplyAt: at("2026-11-02", "16:10").getTime() })).toBeUndefined();
    expect(readPendingTurn({ message: "changed", now, lastPush, lastReplyAt: at("2026-11-02", "15:50").getTime() })?.offer?.kind).toBe("plan-check");
  });
});

describe("8: times carry their meridiem, are never in the past, and are read back after the write", () => {
  it("'at 8' at 8 PM to a slipped nudge books nothing and says it is past", async () => {
    const h = harness({ now: at("2026-11-02", "20:00") });
    const reply = await h.turn(`${label(GAVE_UP, 5)}${APP}at 8`);
    expect(h.flows).toEqual([]);
    expect(reply).toMatch(/past|already gone/i);
    expect(reply).not.toMatch(/8:00 AM/);
  });
  it("'at 9' at 8 PM is 9 PM, and the reply says the time the calendar shows after the write", async () => {
    const h = harness({ now: at("2026-11-02", "20:00"), shift: 15 });
    const reply = await h.turn(`${label(GAVE_UP, 5)}${APP}at 9`);
    expect(h.flows).toEqual(["add a 30 min Gym at 9pm"]);
    expect(reply).toMatch(/9:15 PM/);
    expect(reply).not.toMatch(/9:00 PM/);
  });
  it("an explicit '9am' is never turned into 9 PM; past today, nothing moves", async () => {
    const study: Day = { date: "2026-11-02", now: null, blocks: [b("Study for CS Midterm", "14:00", "15:30")] };
    const h = harness({ now: at("2026-11-02", "14:30"), today: study });
    const reply = await h.turn(`${label(OFF_PLAN, 10)}${APP}moved to 9am`);
    expect(h.flows).toEqual([]);
    expect(reply).toMatch(/past|already gone/i);
  });
  it("a catch-up booked reads its time back", async () => {
    const missed = "Looks like MKTG2201 didn't happen today - it happens. Want me to fit in time to catch up on it (the recording or notes), or leave it?";
    const h = harness({ now: at("2026-11-02", "15:50"), shift: 5 });
    const reply = await h.turn(`${label(missed, 10)}${APP}sure whenever`);
    expect(h.flows).toEqual(["add a 60 min MKTG catch-up at 8:35pm"]);
    expect(reply).toMatch(/8:40 PM/);
  });
});

describe("9: a decline never writes; classes and plans with people are not moved or re-added unless he names them", () => {
  it.each(["nah", "no", "not really"])("slipped gym + %s: nothing is booked", async (said) => {
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: FREE_TUE() });
    const reply = await h.turn(`${label(GAVE_UP, 10)}${APP}${said}`);
    expect(h.flows).toEqual([]);
    expect(reply).not.toMatch(/booked|I put/i);
  });
  it.each(["no", "...", "ok fine"])("'dinner with Sam didn't happen' + %s: no dinner block is added", async (said) => {
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: FREE_TUE() });
    await h.turn(`${label(DINNER_MISSED, 10)}${APP}${said}`);
    expect(h.flows).toEqual([]);
  });
  it("plan-check on a plan with people: 'changed' then 'yes' moves nothing", async () => {
    const day: Day = { date: "2026-11-02", now: null, blocks: [b("Dinner with Sam", "19:00", "20:30", true)] };
    const h = harness({ now: at("2026-11-02", "18:30"), today: day });
    await h.turn(`${label(DINNER_CHECK, 10)}${APP}changed`);
    await h.turn(`${APP}yes`);
    expect(h.flows).toEqual([]);
  });
  it("plan-check on a plan with people: a time without its name moves nothing; naming it moves it", async () => {
    const day = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("Dinner with Sam", "19:00", "20:30", true)] });
    const h = harness({ now: at("2026-11-02", "18:30"), today: day() });
    await h.turn(`${label(DINNER_CHECK, 10)}${APP}moved to 9pm tonight`);
    expect(h.flows).toEqual([]);
    const named = harness({ now: at("2026-11-02", "18:30"), today: day() });
    await named.turn(`${label(DINNER_CHECK, 10)}${APP}dinner moved to 9pm`);
    expect(named.flows).toEqual(["move Dinner with Sam to 9pm"]);
  });
});

describe("11a: an answered outreach is remembered in the state dir, across chats and restarts", () => {
  it("answered on the Mac, a reply on the phone after a restart does not book it again", async () => {
    const dir = stateWithPush("Looks like MKTG2201 didn't happen today - it happens. Want me to fit in time to catch up on it (the recording or notes), or leave it?", at("2026-11-02", "15:40"));
    const mac = harness({ now: at("2026-11-02", "15:50"), stateDir: dir, session: "agent:main:orion-chat-mac" });
    await mac.turn(`${APP}sure whenever`);
    expect(mac.flows).toHaveLength(1);
    const phone = harness({ now: at("2026-11-02", "15:55"), stateDir: dir, session: "agent:main:phone-thread" });
    await phone.turn(`${APP}yeah`);
    expect(phone.flows).toEqual([]);
  });
});
