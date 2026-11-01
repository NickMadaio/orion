// W5 (2026-10-31, gate run-1031224700): Nick's replies to ORION's nudges must do something. Through the routing hooks, over a fake
// calendar the fake scheduler writes to. Phrasings marked "held out" do not appear in the gate scenarios. No real paths.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { PendingMemory, readPendingTurn } from "./pending-reply.js";
import { offerOf, readReply } from "./pending-reply-read.js";
import type { Decision } from "./front-desk.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const label = (text: string, minutes = 0) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const b = (title: string, start: string, end: string, fixed = false, kind?: string): DayBlock => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const at = (d: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y!, mo! - 1, da!, h!, m!); };
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const cmdMin = (t: string) => { const [, h, m, mer] = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) ?? []; return ((Number(h) % 12) + (mer === "pm" ? 12 : 0)) * 60 + Number(m ?? 0); };

const MON = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("MKTG2201", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30"), b("CS lab", "18:00", "19:00"), b("Side project", "19:30", "20:30")] });
const TUE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "09:00", "10:30", true, "class"), b("ECON1115", "11:00", "12:30", true, "class"), b("Gym", "17:00", "18:30")] });

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Opts = { now: Date; today?: Day; tomorrow?: Day; stateDir?: string; napMin?: number; remember?: { stdout: string; code: number } };
function harness(o: Opts) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = []; const flowMeta: Array<boolean | undefined> = []; const checkins: string[][] = []; const sessions: string[] = []; const wakes: string[][] = []; const remembered: string[][] = [];
  const days = { today: o.today ?? MON(), tomorrow: o.tomorrow ?? TUE() };
  const clock = { now: o.now };
  const write = (message: string) => {
    const add = message.match(/^add a (\d+) min (.+?)( tomorrow)? at (\S+)$/);
    if (!add) return;
    const which = add[3] ? "tomorrow" : "today";
    // Before 5 AM "tomorrow" is today's date: the harness keeps the wake day in `tomorrow` either way.
    const key = which === "tomorrow" || clock.now.getHours() < 5 ? (clock.now.getHours() < 5 ? "tomorrow" : which) : which;
    const s = cmdMin(add[4]!);
    const len = /^nap$/i.test(add[2]!) && o.napMin ? Math.max(o.napMin, Number(add[1])) : Number(add[1]);
    days[key] = { ...days[key], blocks: [...days[key].blocks, b(add[2]!, hhmm(s), hhmm(s + len))] };
  };
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w5-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 12:00", now: () => clock.now,
    ...(o.stateDir ? { stateDir: o.stateDir } : {}),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    scheduleFlow: async (message: string, _clock?: string, opts?: { lengthDefaulted?: boolean }): Promise<FlowResult> => { flows.push(message); flowMeta.push(opts?.lengthDefaulted); write(message); return { outcome: "done", calls: [`exec orion-reschedule (${message})`], outputs: ["Done."], marks: [`m${flows.length}`], reply: "Done." }; },
    sessionFlow: async (message: string): Promise<FlowResult> => { sessions.push(message); return { outcome: "done", calls: ["exec orion-session start"], outputs: ["{}"], reply: "Focus session on CS lab started: 50 min." }; },
    readDayJson: async (args: string[]) => (args.includes("tomorrow") || clock.now.getHours() < 5 ? days.tomorrow : days.today),
    checkinRun: async (args: string[]) => { checkins.push(args); return args[0] === "find" ? { stdout: '{"open":false}', code: 1 } : { stdout: "ok ci-abc123", code: 0 }; },
    wakeExec: async (args: string[]) => { wakes.push(args); return { stdout: "Sent to Nick's iPhone: alarm for Tuesday 08:00.", code: 0 }; },
    rememberRun: async (args: string[]) => { remembered.push(args); return o.remember ?? { stdout: "remembered -> ~/.openclaw/workspace/USER.md", code: 0 }; },
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string, session = "w5"): Promise<string> => {
    const ctx = { runId: `w${n += 1}-${Math.random()}`, sessionKey: `agent:main:orion-chat-${session}` };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, flows, flowMeta, checkins, sessions, wakes, remembered, days, clock };
}
const stateWith = (rows: Array<{ text: string; sent: Date }>): string => {
  const dir = mkdtempSync(join(tmpdir(), "w5-state-"));
  for (const r of rows) appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: `o${r.sent.getTime()}`, text: r.text, at: r.sent.toISOString(), channel: "mac-bubble" })}\n`);
  return dir;
};
const adds = (h: { checkins: string[][] }) => h.checkins.filter((a) => a[0] === "add" || a[0] === "defer");

describe("the answered record is the state file (gate: the second item of a pair bound to nothing)", () => {
  it("an outreach answered, then the state restored to before the answer, is answerable again", () => {
    const dir = mkdtempSync(join(tmpdir(), "w5-ans-"));
    const memory = new PendingMemory();
    memory.markAnswered("Bed now.", 1000, 2000, dir);
    expect(memory.wasAnswered("Bed now.", 1000, 2500, dir)).toBe(true);
    rmSync(join(dir, "pending-answered.json"));
    expect(memory.wasAnswered("Bed now.", 1000, 2500, dir)).toBe(false);
  });
  it("without a state dir it is still kept in memory", () => {
    const memory = new PendingMemory();
    memory.markAnswered("Bed now.", 1000, 2000);
    expect(memory.wasAnswered("Bed now.", 1000, 2500)).toBe(true);
  });
});

describe("a start rung's 'still not started' line, with any dash", () => {
  const LINE = "Econ problem set - still not started. Start now; just the first five minutes.";
  it("reads the title whichever dash the line carries", () => {
    expect(offerOf(LINE)).toEqual({ kind: "start", title: "Econ problem set" });
    expect(offerOf("Econ problem set – still not started.")).toEqual({ kind: "start", title: "Econ problem set" });
  });
  const ECON = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("Econ problem set", "18:00", "19:00")] });
  it.each(["ya in a sec", "yeah one sec", "ok hang on"])("'%s' is a stall: 5 min, stated, and a check-in on the loop", async (said) => {
    const h = harness({ now: at("2026-11-02", "18:15"), today: ECON() });
    const reply = await h.turn(`${label(LINE, 15)}${APP}${said}`);
    expect(reply).toBe("5 min, not more. I'll come back at 6:20 PM and we start Econ problem set.");
    expect(adds(h)).toEqual([["add", "5", "Econ problem set", "--because", said]]);
  });
  it.each([["starting in 10", 10, "6:25 PM"], ["gonna start in 15", 15, "6:30 PM"], ["ill get on it in 5", 5, "6:20 PM"]])("'%s' sets the start nudge at +N and says so", async (said, minutes, back) => {
    const h = harness({ now: at("2026-11-02", "18:15"), today: ECON() });
    const reply = await h.turn(`${label("Econ problem set - still not started.", 15)}${APP}${said}`);
    expect(reply).toBe(`Okay, ${minutes} min. I'll come back at ${back} and we start Econ problem set.`);
    expect(adds(h)[0]?.slice(0, 3)).toEqual(["add", String(minutes), "Econ problem set"]);
    expect(h.sessions).toEqual([]);
  });
});

describe("going to bed answers the bedtime line, even after ORION asked something in between", () => {
  const BED = "Still up at 12:43 AM. 8h to your alarm. Go now and I'll protect it.";
  // Wave 6 (gate run-1101003318): "ok one more thing" is no longer the worker's ("What is the one more thing?"): a 15 min limit and one
  // check-back, so "fine going to bed now" after it adds no second check.
  it("'ok one more thing' → a limit and a check; 'fine going to bed now' → goodnight, alarm checked against CS2100, no second check", async () => {
    const sent = at("2026-11-03", "00:43");
    const dir = stateWith([{ text: BED, sent }]);
    const h = harness({ now: sent, stateDir: dir });
    expect(await h.turn(`${label(BED)}${APP}ok one more thing`)).toMatch(/^Okay — one more thing, 15 min max .* I'll check at 12:58 AM\./);
    h.clock.now = at("2026-11-03", "00:44");
    const reply = await h.turn(`${APP}fine going to bed now`);
    expect(reply).toBe("Good — goodnight. Your alarm's on automatic, so it goes off before CS2100. CS2100 at 9:00 AM stays, nothing before it.");
    expect(adds(h)).toEqual([["add", "15", "bed", "--because", "ok one more thing"]]);
    expect(h.flows).toEqual([]);
  });
  it.each(["ok ok heading to bed", "gnight", "fine im off to sleep"])("held out: '%s'", async (said) => {
    const sent = at("2026-11-03", "00:43");
    const h = harness({ now: sent, stateDir: stateWith([{ text: BED, sent }]) });
    expect(await h.turn(`${label(BED)}${APP}${said}`)).toMatch(/^Good — goodnight\./);
  });
  it("a manual alarm too late for the first class is moved earlier, and the reply says so", async () => {
    const sent = at("2026-11-03", "00:43");
    const dir = stateWith([{ text: BED, sent }]);
    writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at: at("2026-11-03", "09:30").toISOString(), setAt: sent.toISOString() }));
    const h = harness({ now: sent, stateDir: dir });
    const reply = await h.turn(`${label(BED)}${APP}going to bed`);
    expect(h.wakes).toEqual([["08:00"]]);
    expect(reply).toContain("I moved your alarm to 8:00 AM — 9:30 AM was too late for CS2100.");
  });
  it("a manual alarm in good time is confirmed, not touched", async () => {
    const sent = at("2026-11-03", "00:43");
    const dir = stateWith([{ text: BED, sent }]);
    writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at: at("2026-11-03", "07:45").toISOString(), setAt: sent.toISOString() }));
    const h = harness({ now: sent, stateDir: dir });
    expect(await h.turn(`${label(BED)}${APP}going to bed`)).toContain("Your alarm's set for 7:45 AM.");
    expect(h.wakes).toEqual([]);
  });
  it("'going to bed, wake me at 8' is the wake alarm's, not this", () => {
    expect(readReply("ok im going to bed, wake me at 8")?.kind).not.toBe("bed");
    expect(readReply("not going to bed yet")?.kind).not.toBe("bed");
  });
});

describe("a short delay at bedtime books no nap; a short night does, and says the length the calendar shows", () => {
  it("'5 more min' at 12:43 AM: a 5 min cap and a check, no nap", async () => {
    const h = harness({ now: at("2026-11-03", "00:43") });
    expect(await h.turn(`${label("Still up at 12:43 AM.")}${APP}5 more min`)).toBe("Okay — 5 min, then bed. I'll check at 12:48 AM. CS2100 at 9:00 AM stays.");
    expect(h.flows).toEqual([]);
  });
  it("'cant sleep' at 3 AM: the nap's real length is said (his minimum made it 75)", async () => {
    const h = harness({ now: at("2026-11-03", "03:00"), napMin: 75 });
    const reply = await h.turn(`${label("Its 3 AM. CS2100 is at 9. Bed now.")}${APP}cant sleep`);
    expect(reply).toContain("I put a 75 min nap at 12:35 PM");
  });
  it("'im up working on econ' at 3 AM → 30 min cap, check at 3:30, nap; '30 more min then bed' → deal", async () => {
    const h = harness({ now: at("2026-11-03", "03:00") });
    const first = await h.turn(`${label("Its 3 AM. CS2100 is at 9. Bed now.")}${APP}im up working on econ`);
    expect(first).toMatch(/^Okay — 30 min on econ \(that's the cap\), then bed\. I'll check at 3:30 AM\. I put a 30 min nap at 12:35 PM/);
    h.clock.now = at("2026-11-03", "03:01");
    expect(await h.turn(`${APP}i need to finish this econ set first, 30 more min then bed`)).toBe("Deal — 3:30 AM, then bed. I'll check then. CS2100 at 9:00 AM stays.");
  });
});

describe("no nudge on record: a pause for something named puts off the block that just started", () => {
  it("'im starving gonna eat first' at 6:05 → 25 min grace on CS lab; 'ok im done eating' → CS lab's focus session", async () => {
    const h = harness({ now: at("2026-11-02", "18:05") });
    expect(await h.turn(`${APP}im starving gonna eat first`)).toBe("Okay, eating first — 25 min (my guess; say if it's longer). I'll come back at 6:30 PM and we start CS lab.");
    expect(adds(h)[0]?.slice(0, 3)).toEqual(["add", "25", "CS lab"]);
    h.clock.now = at("2026-11-02", "18:31");
    const back = await h.turn(`${APP}ok im done eating`);
    expect(h.sessions).toEqual(["start a focus session on CS lab"]);
    expect(back).toContain("now we start");
  });
  it.each(["brb grabbing a bite first", "gonna shower real quick first", "lemme cook first"])("held out: '%s'", async (said) => {
    const h = harness({ now: at("2026-11-02", "18:10") });
    expect(await h.turn(`${APP}${said}`)).toMatch(/we start CS lab\.$/);
  });
  it("with nothing just started, it is the normal turn's", async () => {
    const h = harness({ now: at("2026-11-02", "10:00") });
    expect(await h.turn(`${APP}gonna eat first`)).toMatch(/^(?:WORKER|DRAFT)/);
    expect(h.checkins).toEqual([]);
  });
});

describe("the morning brief: its real wording, and a carried-over item is never booked on a plain yes", () => {
  const SLIP = "First thing: CS2100 at 9:00 AM. Student oyster card has been first on my list 11 days running and hasn't moved - this keeps slipping. Give it a time today, or drop it?";
  it("reads 'First on my list: X.' and the slipping line as brief offers", () => {
    expect(offerOf("Nothing fixed today. First on my list: Panopto presentation. Gym at 5:00 PM, 90 min.")).toEqual({ kind: "brief", items: ["Panopto presentation"] });
    expect(offerOf(SLIP)).toEqual({ kind: "brief", items: ["Student oyster card"], stale: true });
  });
  it("'yeah do it' to the slipping line books nothing and asks for a time; asked again, 'yeah' still books nothing", async () => {
    const h = harness({ now: at("2026-11-02", "08:05") });
    const first = await h.turn(`${label(SLIP, 5)}${APP}yeah do it`);
    expect(h.flows).toEqual([]);
    expect(first).toContain("When for Student oyster card?");
    h.clock.now = at("2026-11-02", "08:06");
    await h.turn(`${APP}yeah`);
    expect(h.flows).toEqual([]);
  });
  it("'you pick' books it; an item already on today is not booked twice", async () => {
    const today = { ...MON(), blocks: [...MON().blocks, b("Panopto presentation", "10:00", "11:00")] };
    const h = harness({ now: at("2026-11-02", "08:05"), today });
    const reply = await h.turn(`${label("Top of your list: Panopto presentation and finish resume.", 5)}${APP}you pick`);
    expect(h.flows).toEqual(["add a 45 min finish resume at 8:20am"]);
    expect(reply).toContain("finish resume at 8:20 AM");
  });
  it("the gate's pair: the same brief answered in one chat, state restored, then answered with times in another books both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w5-pair-"));
    const brief = "Top of your list: finish resume and Student oyster card.";
    const h = harness({ now: at("2026-11-02", "08:05"), stateDir: dir });   // ONE plugin, two chats: what the gate runs
    await h.turn(`${label(brief, 5)}${APP}yeah`, "first");
    rmSync(join(dir, "pending-answered.json"), { force: true });
    h.flows.length = 0;
    await h.turn(`${label(brief, 5)}${APP}do the oyster card first thing, 9am, resume at 4`, "second");
    expect([...h.flows].sort()).toEqual(["add a 45 min Student oyster card at 9am", "add a 45 min finish resume at 4pm"]);
  });
});

describe("a stated preference is kept and said back (held-out phrasings)", () => {
  it.each([
    ["stop being so formal with me", "Preference: Nick wants ORION to stop being so formal with him.", "Got it — I'll remember you want me to stop being so formal with you."],
    ["i like gym in the evening", "Preference: Nick likes gym in the evening.", "Got it — I'll remember you like gym in the evening."],
    ["remember i hate early mornings", "Preference: Nick doesn't like early mornings.", "Got it — I'll remember you don't like early mornings."],
  ])("'%s'", async (said, fact, reply) => {
    const h = harness({ now: at("2026-11-02", "12:00") });
    expect(await h.turn(`${APP}${said}`)).toBe(reply);
    expect(h.remembered).toEqual([["--user", fact]]);
    expect(h.flows).toEqual([]);
  });
  it("a failed write says it isn't kept", async () => {
    const h = harness({ now: at("2026-11-02", "12:00"), remember: { stdout: "orion-remember: USER.md is missing", code: 2 } });
    expect(await h.turn(`${APP}dont call me bro`)).toMatch(/couldn't save that/);
  });
  it("a reaction or a request with a time is not kept", async () => {
    const h = harness({ now: at("2026-11-02", "12:00") });
    await h.turn(`${APP}i love that`);
    await h.turn(`${APP}id rather do gym at 6 today`);
    expect(h.remembered).toEqual([]);
  });
});

it("readPendingTurn: a bed reply binds to the card's bedtime push after ORION replied in between", () => {
  const sent = at("2026-11-03", "00:43");
  const t = readPendingTurn({ message: "fine going to bed now", now: at("2026-11-03", "00:44"), lastPush: { text: "Still up at 12:43 AM. Go now.", at: sent.toISOString() }, lastReplyAt: sent.getTime() + 30_000 });
  expect(t?.offer).toEqual({ kind: "bedtime" });
  const other = readPendingTurn({ message: "yeah", now: at("2026-11-03", "00:44"), lastPush: { text: "Still up at 12:43 AM. Go now.", at: sent.toISOString() }, lastReplyAt: sent.getTime() + 30_000 });
  expect(other).toBeUndefined();
});

// REV5 SHOULD 6: the alarm is checked against the first class he will actually go to. A class he said he is skipping (declared-facts.json,
// kind skip) or one that is online does not pull his alarm earlier; and a class just after midnight never gives a negative time.
describe("REV5: goodnight alarm ignores skipped and online classes, and never goes below 00:00", () => {
  const BED = "Still up at 12:43 AM. 8h to your alarm. Go now and I'll protect it.";
  const withAlarm = (sent: Date, alarmAt: Date) => { const dir = stateWith([{ text: BED, sent }]); writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at: alarmAt.toISOString(), setAt: sent.toISOString() })); return dir; };
  it("a skipped first class: the alarm is checked against the next one and left alone", async () => {
    const sent = at("2026-11-03", "00:43");
    const dir = withAlarm(sent, at("2026-11-03", "09:30"));
    writeFileSync(join(dir, "declared-facts.json"), JSON.stringify({ schemaVersion: 1, facts: [{ id: "fact-1", date: "2026-11-03", at: sent.toISOString(), kind: "skip", text: "skipping cs tomorrow", title: "CS2100" }] }));
    const h = harness({ now: sent, stateDir: dir });
    const reply = await h.turn(`${label(BED)}${APP}going to bed`);
    expect(h.wakes).toEqual([]);
    expect(reply).toContain("Your alarm's set for 9:30 AM.");
    expect(reply).not.toContain("CS2100");
  });
  it("an online first class does not move the alarm", async () => {
    const sent = at("2026-11-03", "00:43");
    const h = harness({ now: sent, stateDir: withAlarm(sent, at("2026-11-03", "09:30")), tomorrow: { date: "2026-11-03", now: null, blocks: [b("CS2100 (Online)", "09:00", "10:30", true, "class"), b("ECON1115", "11:00", "12:30", true, "class")] } });
    const reply = await h.turn(`${label(BED)}${APP}going to bed`);
    expect(h.wakes).toEqual([]);
    expect(reply).toContain("Your alarm's set for 9:30 AM.");
  });
  it("a class at 12:30 AM clamps the moved alarm to 00:00, never a negative time", async () => {
    const sent = at("2026-11-02", "23:50");
    const h = harness({ now: sent, stateDir: withAlarm(sent, at("2026-11-03", "00:50")), tomorrow: { date: "2026-11-03", now: null, blocks: [b("Late lab", "00:30", "01:30", true, "class")] } });
    await h.turn(`${label(BED)}${APP}going to bed`);
    expect(h.wakes).toEqual([["00:00"]]);
    expect(h.wakes.flat().join(" ")).not.toMatch(/-/);
  });
});

describe("W8-A: his day and length beat the brief's defaults (today, 45 min)", () => {
  const BRIEF = "Top of your list: finish resume and Student oyster card.";
  const ask = async (said: string) => {
    const h = harness({ now: at("2026-11-02", "21:00"), stateDir: stateWith([{ text: BRIEF, sent: at("2026-11-02", "20:55") }]) });
    const reply = await h.turn(`${label(BRIEF, 5)}${APP}${said}`);
    return { h, reply };
  };
  it.each([
    ["push the finish resume thing to tomorrow at 10am, 45 min", "add a 45 min finish resume tomorrow at 10am", "Booked tomorrow"],
    ["do finish resume tmrw 9am for an hour", "add a 60 min finish resume tomorrow at 9am", "Booked tomorrow"],
    ["finish resume at 10pm for 20 mins", "add a 20 min finish resume at 10pm", "Booked today"],
  ])("'%s'", async (said, cmd, lead) => {
    const { h, reply } = await ask(said);
    expect(h.flows).toEqual([cmd]);
    expect(reply).toContain(lead);
    expect(reply).not.toContain("each");
  });
  it("a single item never says '45 min each'", async () => {
    const { reply } = await ask("finish resume at 10pm");
    expect(reply).toContain("45 min — say if it needs longer");
    expect(reply).not.toContain("each");
  });
  it.each(["finish resume on friday at 10am", "do finish resume on the 4th at 10am", "finish resume next week at 10am"])("a day it cannot honour is not booked on today: '%s'", async (said) => {
    const { h } = await ask(said);
    expect(h.flows.every((f) => !/^add a 45 min finish resume at/.test(f))).toBe(true);
  });
});

describe("W8 review: an 'after X' anchor that lives on a later day is still found; only a missing anchor falls back", () => {
  const MISSED = "Looks like MKTG2201 didn't happen today - it happens. Want me to fit in time to catch up on it (the recording or notes), or leave it?";
  const noGymToday: Day = { date: "2026-11-02", now: null, blocks: [b("MKTG2201", "13:30", "15:30", true, "class")] };
  it.each(["after gym", "put it after gym please", "sometime after gym"])("gym is on tomorrow only: '%s' books after it there", async (said) => {
    const h = harness({ now: at("2026-11-02", "15:50"), today: noGymToday });
    const reply = await h.turn(`${label(MISSED, 10)}${APP}${said}`);
    expect(h.flows).toEqual(["add a 60 min MKTG catch-up tomorrow at 6:35pm"]);
    expect(reply).not.toMatch(/isn't on/);
  });
  it("gym is still ahead today and absent tomorrow: it is found today, not replaced by a free slot tomorrow", async () => {
    const withGym: Day = { date: "2026-11-02", now: null, blocks: [b("MKTG2201", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30")] };
    const h = harness({ now: at("2026-11-02", "15:50"), today: withGym, tomorrow: { date: "2026-11-03", now: null, blocks: [] } });
    const reply = await h.turn(`${label(MISSED, 10)}${APP}after gym`);
    expect(h.flows).toEqual(["add a 60 min MKTG catch-up at 6:35pm"]);
    expect(reply).not.toMatch(/isn't on/);
  });
  it("the anchor is on neither day: the first free time in the part of day he named, said plainly", async () => {
    const empty: Day = { date: "2026-11-03", now: null, blocks: [] };
    const h = harness({ now: at("2026-11-02", "15:50"), today: noGymToday, tomorrow: empty });
    const reply = await h.turn(`${label(MISSED, 10)}${APP}after gym tonight`);
    const hour = /at (\d+)(?::\d+)?pm$/.exec(h.flows[0] ?? "")?.[1];
    expect(Number(hour)).toBeGreaterThanOrEqual(5);
    expect(h.flows[0]).not.toContain("tomorrow");
    expect(reply).toMatch(/Gym isn't on today yet, so that's the first free time/);
  });
  it("a length ORION defaulted is passed as defaulted; one he said is not", async () => {
    const d = harness({ now: at("2026-11-02", "15:50") });
    await d.turn(`${label(MISSED, 10)}${APP}sure whenever`);
    expect(d.flowMeta).toEqual([true]);
    const s = harness({ now: at("2026-11-02", "15:50") });
    await s.turn(`${label(MISSED, 10)}${APP}sure, 90 min at 8pm`);
    expect(s.flowMeta[0]).toBeUndefined();
  });
});
