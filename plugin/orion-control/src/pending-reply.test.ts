// 2026-10-31 gate run-1031202318, clusters 1 and 8: his short replies to ORION's own nudges, read against what the nudge offered and
// carried out through the explicit command's paths; and a cut-off voice request read whole. Fixtures only: no real paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting, NOT_CAUGHT, REFUSED_NOTHING_CHANGED, honestLine } from "./local-routing.js";
import { continuationOf, offerOf, readPendingTurn, readReply } from "./pending-reply.js";
import { pauseThenStart } from "./pending-reply-read.js";
import { freeSlot } from "./pending-reply-day.js";
import { readIntent } from "./calendar-intent.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.

User message:
`;
const SPOKEN_LINE = 'Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as "8:15 PM". Offer detail only if he asks.';
const SPOKEN_APP = APP.replace("\n\nUser message:", `\n${SPOKEN_LINE}\n\nUser message:`);
const label = (text: string, minutes = 5) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const b = (title: string, start: string, end: string, fixed = false, kind?: string) => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });

// The texts ORION's own senders write (plan-ladder.mjs, class-ladder.mjs, proactive.mjs, curiosity words.mjs, the brief head).
const START = "Time to start: CS Lab.";
const LEAVE = "Leave in 13 min for MKTG2201 at 1:30 PM.";
const BRIEF = "Top of your list: finish resume and Student oyster card.";
const MISSED = "Looks like MKTG2201 didn't happen today - it happens. Want me to fit in time to catch up on it (the recording or notes), or leave it?";
const GAVE_UP = "I'll stop pinging about Gym. Tell me when you want to pick it back up.";
const SESSION_DONE = "Session done. Next: CS2100 at 9:00 AM.";
const BED = "Its 3 AM. CS2100 is at 9. Bed now.";
const OFF_PLAN = "You're out - is Study for CS Midterm still happening, or did plans change? I'll update the calendar.";

const MON: Day = { date: "2026-11-02", now: null, blocks: [b("MKTG2201 Marketing", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30"), b("Side project", "19:30", "20:30")] };
const TUE: Day = { date: "2026-11-03", now: null, blocks: [b("CS2100", "09:00", "10:40", true, "class"), b("ECON1115", "11:00", "12:15", true, "class"), b("Gym", "17:00", "18:30")] };
const STUDY_DAY: Day = { date: "2026-11-02", now: null, blocks: [b("Study for CS Midterm", "14:00", "15:30"), b("Gym", "17:00", "18:30")] };

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** "8:35pm" / "8am" (the scheduler words pending-reply-day.ts writes) to minutes. */
const cmdMin = (t: string) => { const [, h, m, mer] = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) ?? []; return ((Number(h) % 12) + (mer === "pm" ? 12 : 0)) * 60 + Number(m ?? 0); };

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness({ now, today = MON, tomorrow = TUE, found = false, desk = {} as Record<string, Decision> }: { now: Date; today?: Day; tomorrow?: Day; found?: boolean; desk?: Record<string, Decision> }) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = []; const checkins: string[][] = []; const sessions: string[] = []; const deskSaw: string[] = [];
  // REV4 8: replies read times back from the calendar, so the fake scheduler writes to a calendar the reads see.
  const days = { today, tomorrow };
  const write = (message: string) => {
    const add = message.match(/^add a (\d+) min (.+?)( tomorrow)? at (\S+)$/);
    const mv = message.match(/^move (tomorrow's )?(.+?) to (\S+)$/);
    const which = add?.[3] || mv?.[1] ? "tomorrow" : "today";
    const day = days[which];
    if (add) { const s = cmdMin(add[4]!); days[which] = { ...day, blocks: [...day.blocks, b(add[2]!, hhmm(s), hhmm(s + Number(add[1])))] }; }
    if (mv) { const s = cmdMin(mv[3]!); days[which] = { ...day, blocks: day.blocks.map((x) => (x.title.toLowerCase() === mv[2]!.toLowerCase() ? { ...x, start: hhmm(s), end: hhmm(s + toMin(x.end) - toMin(x.start)) } : x)) }; }
  };
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 12:00", now: () => now,
    decideImpl: async (input: { message: string }): Promise<Decision> => { deskSaw.push(input.message); return desk[input.message] ?? { move: "escalate", tier: "standard" }; },
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); write(message); return { outcome: "done", calls: [`exec orion-reschedule (${message})`], outputs: ["Done."], marks: [`m${flows.length}`], reply: "Done." }; },
    sessionFlow: async (message: string): Promise<FlowResult> => { sessions.push(message); return { outcome: "done", calls: ["exec orion-session start"], outputs: ["started"], reply: "Focus session started: CS Lab, 50 min." }; },
    readDayJson: async (args: string[]) => (args.includes("tomorrow") ? days.tomorrow : days.today),
    checkinRun: async (args: string[]) => {
      checkins.push(args);
      if (args[0] === "find") return found ? { stdout: '{"open":true,"id":"ci-loop1"}', code: 0 } : { stdout: '{"open":false}', code: 1 };
      if (args[0] === "add") return { stdout: `Check-in ci-abc123: I'll come back at x (${args[1]} min) about "${args[2]}" on Nick's iPhone, and keep at it until he starts.`, code: 0 };
      if (args[0] === "defer") return { stdout: `Fair — back in ${args[1]} min about it.`, code: 0 };
      return { stdout: "ok", code: 0 };
    } });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `p${n += 1}`, sessionKey: "agent:main:orion-chat-pending" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, flows, checkins, sessions, deskSaw };
}
const at = (d: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y!, mo! - 1, da!, h!, m!); };
const TEMPLATES = [NOT_CAUGHT, REFUSED_NOTHING_CHANGED, honestLine(true), honestLine(false)];

describe("offers, read from ORION's own texts", () => {
  it.each([
    [START, "start"], [LEAVE, "leave"], [BRIEF, "brief"], [MISSED, "catchup"], [GAVE_UP, "slipped"], [SESSION_DONE, "session-done"], [BED, "bedtime"], [OFF_PLAN, "plan-check"],
    ["Gym didn't happen at 5:00 PM, and there's no room left today for all of it. Want 30 min tonight, or first thing tomorrow?", "slipped"],
    ["Gym — still not started. Just 30 min then; get going and see how you feel.", "start"],
  ])("%s → %s", (text, kind) => expect(offerOf(text)?.kind).toBe(kind));
  it("a speaker tag and quotes around the line are read through", () => {
    expect(offerOf('ORION morning brief: "Top of your list: finish resume and Student oyster card."')?.kind).toBe("brief");
    expect(offerOf('ORION: "Want me to fit in time to catch up on it?"')).toEqual({ kind: "catchup" });
    expect(offerOf("ORION: \"I'll stop pinging about Gym - I've moved what I could.\"")).toEqual({ kind: "slipped", title: "Gym" });
  });
  it("names what the offer is about", () => {
    expect(offerOf(LEAVE)).toEqual({ kind: "leave", title: "MKTG2201", leaveIn: 13, classAt: 13 * 60 + 30 });
    expect(offerOf(BRIEF)).toEqual({ kind: "brief", items: ["finish resume", "Student oyster card"] });
    expect(offerOf(MISSED)).toEqual({ kind: "catchup", subject: "MKTG2201" });
    expect(offerOf(OFF_PLAN)).toEqual({ kind: "plan-check", title: "Study for CS Midterm" });
  });
});

describe("replies, read by shape", () => {
  it.each([
    ["sure whenever", "accept"], ["whenevs is fine", "accept"], ["you pick", "accept"], ["anytime works", "accept"],
    ["yeah", "accept"], ["ok fine", "accept"], ["...", "indifferent"], ["whatever", "indifferent"], ["meh", "indifferent"],
    ["im starving gonna eat first", "defer"], ["lemme grab food real quick", "defer"], ["hungry af gonna eat", "defer"], ["gotta shower first", "defer"],
    ["hold on 5 more mins", "defer"], ["gimme 5", "defer"], ["10 more min", "defer"],
    ["ok im done eating", "resume"], ["ok im back", "resume"], ["finished my dinner", "resume"],
    ["changed", "changed"], ["nah plans changed", "changed"], ["got cancelled", "changed"],
    ["cant sleep", "awake"], ["wide awake rn", "awake"], ["im up working on econ", "awake"], ["still doing my essay, 20 more min", "awake"],
    ["i have a lot to do tho", "workload"], ["so much stuff due ugh", "workload"],
    ["wait what is next actually", "next"], ["thanks, what do i do now", "next"], ["ok whats next", "next"],
    ["yes book 1 hour tomorrow after gym", "counter"], ["ill do gym tmrw morning", "counter"], ["moved to 8pm tonight", "counter"], ["first thing tomorrow", "counter"],
  ])("%s → %s", (said, kind) => expect(readReply(said)?.kind).toBe(kind));
  it("a question, a long request, or a preface is not a reply", () => {
    expect(readReply("can i do gym tomorrow instead?")).toBeUndefined();
    expect(readReply("ok one more thing")).toBeUndefined();
    expect(readReply("can you move gym to tomorrow morning and put the resume block after my lecture please and thanks orion")).toBeUndefined();
  });
  it("a pause with what starts after it, said with no outreach", () => {
    expect(pauseThenStart("im gonna eat for 25 min then start cs lab, hold me to it")).toEqual({ activity: "eating", minutes: 25, typical: 25, title: "cs lab" });
    expect(pauseThenStart("gonna shower first then start my essay")).toEqual({ activity: "a shower", typical: 20, title: "essay" });
    expect(pauseThenStart("lemme cook for 30 min then get on econ")).toEqual({ activity: "cooking", minutes: 30, typical: 25, title: "econ" });
  });
});

describe("the scheduler gets words it reads in code", () => {
  const now = at("2026-11-02", "15:50");
  it.each([
    ["add a 60 min MKTG catch-up at 8:35pm", "MKTG catch-up", "20:35", "today"],
    ["add a 60 min MKTG catch-up tomorrow at 6:35pm", "MKTG catch-up", "18:35", "tomorrow"],
    ["add a 30 min Gym at 8:35pm", "Gym", "20:35", "today"],
    ["move tomorrow's Gym to 8am", "Gym", "08:00", "tomorrow"],
    ["add a 30 min nap tomorrow at 12:20pm", "nap", "12:20", "tomorrow"],
    ["move Study for CS Midterm to 8pm", "Study for CS Midterm", "20:00", "today"],
    ["add a 45 min finish resume at 4pm", "finish resume", "16:00", "today"],
    ["add a 45 min Student oyster card at 9pm", "Student oyster card", "21:00", "today"],
    ["add a 60 min catch-up at 8:35pm", "catch-up", "20:35", "today"],
    ["add a 60 min catch-up work tomorrow at 12:20pm", "catch-up work", "12:20", "tomorrow"],
  ])("%s", (command, name, start, day) => {
    const r = readIntent(command, { now });
    expect("intent" in r && r.intent.items[0]).toMatchObject({ name: expect.stringMatching(new RegExp(name, "i")), start });
    expect("intent" in r && r.intent.day).toBe(day);
  });
  it("free slots keep his five-minute buffer", () => {
    expect(freeSlot(MON, 60, 16 * 60 + 5, 22 * 60)).toBe(20 * 60 + 35);
    expect(freeSlot(MON, 30, 19 * 60 + 45, 22 * 60)).toBe(20 * 60 + 35);
    expect(freeSlot(TUE, 90, 8 * 60, 12 * 60, TUE.blocks[2])).toBeUndefined();
  });
});

describe("the loop closes, through the routing hooks", () => {
  it("loop-eat-first-v: a 25 min grace with a comeback time, then the session starts when he's back", async () => {
    const h = harness({ now: at("2026-11-02", "18:05") });
    expect(await h.turn(`${label(START)}${APP}im starving gonna eat first`)).toBe("Okay, eating first — 25 min (my guess; say if it's longer). I'll come back at 6:30 PM and we start CS Lab.");
    expect(h.checkins).toEqual([["find", "--what", "CS Lab"], ["add", "25", "CS Lab", "--because", "im starving gonna eat first"]]);
    const back = await h.turn(`${APP}ok im done eating`);
    expect(h.sessions).toEqual(["start a focus session on CS Lab"]);
    expect(back).toBe("Okay, you ate — now we start. Focus session started: CS Lab, 50 min.");
  });
  it("an open ladder is deferred by its id, never a second check-in", async () => {
    const h = harness({ now: at("2026-11-02", "18:05"), found: true });
    await h.turn(`${label(START)}${APP}lemme grab food real quick`);
    expect(h.checkins).toEqual([["find", "--what", "CS Lab"], ["defer", "25", "ci-loop1", "--because", "lemme grab food real quick"]]);
  });
  it("loop-eat-first-c: 'eat for 25 min then start cs lab' with no outreach sets the comeback; 'done eating' starts it", async () => {
    const h = harness({ now: at("2026-11-02", "18:05") });
    expect(await h.turn(`${APP}im gonna eat for 25 min then start cs lab, hold me to it`)).toMatch(/^Okay, eating first — 25 min\. I'll come back at 6:30 PM and we start cs lab\.$/);
    await h.turn(`${APP}done eating`);
    expect(h.sessions).toEqual(["start a focus session on cs lab"]);
  });
  it("loop-leave-nudge-v: a hard cutoff and a re-ping", async () => {
    const h = harness({ now: at("2026-11-02", "12:47") });
    expect(await h.turn(`${label(LEAVE, 0)}${APP}hold on 5 more mins`)).toBe("Okay — 12:52 PM, hard stop. That still gets you to MKTG2201 at 1:30 PM. I'll ping you then.");
    expect(h.checkins.at(-1)).toEqual(["add", "5", "leave for MKTG2201", "--because", "hold on"]);
  });
  it("loop-skipped-class-followup-v: 'sure whenever' books the first free hour and says when", async () => {
    const h = harness({ now: at("2026-11-02", "15:50") });
    const said = await h.turn(`${label(MISSED, 10)}${APP}sure whenever`);
    expect(h.flows).toEqual(["add a 60 min MKTG catch-up at 8:35pm"]);
    expect(said).toBe("Booked MKTG catch-up: 8:35 PM today, 60 min — I picked the first free hour; say a time if you want it elsewhere.");
  });
  it("loop-skipped-class-followup-c: 'yes book 1 hour tomorrow after gym' books right after tomorrow's gym", async () => {
    const h = harness({ now: at("2026-11-02", "15:50") });
    await h.turn(`${label(MISSED, 10)}${APP}yes book 1 hour tomorrow after gym`);
    expect(h.flows).toEqual(["add a 60 min MKTG catch-up tomorrow at 6:35pm"]);
  });
  it("loop-gym-ladder-ignored-v: '...' books a short gym tonight (gym is not dropped); 'whatever' keeps it", async () => {
    const h = harness({ now: at("2026-11-02", "19:30") });
    const first = await h.turn(`${label(GAVE_UP, 10)}${APP}...`);
    expect(h.flows).toEqual(["add a 30 min Gym at 8:35pm"]);
    expect(first).toMatch(/^Gym isn't optional — I put a 30 min Gym at 8:35 PM tonight\./);
    expect(first).not.toMatch(/stop pinging/);
    expect(await h.turn(`${APP}whatever`)).toBe("Then it stays: Gym at 8:35 PM tonight. I'll check in when it starts.");
    expect(h.flows).toHaveLength(1);
  });
  it("loop-gym-ladder-ignored-c: 'ill do gym tmrw morning' moves tomorrow's gym into the morning", async () => {
    const free: Day = { ...TUE, blocks: [b("ECON1115", "11:00", "12:15", true, "class"), b("Gym", "17:00", "18:30")] };
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: free });
    expect(await h.turn(`${label(GAVE_UP, 10)}${APP}ill do gym tmrw morning`)).toMatch(/^Booked: Gym tomorrow at 8:00 AM/);
    expect(h.flows).toEqual(["move tomorrow's Gym to 8am"]);
  });
  it("loop-morning-brief-v: 'yeah' makes the two items concrete and changes nothing", async () => {
    const h = harness({ now: at("2026-11-02", "08:05") });
    expect(await h.turn(`${label(BRIEF)}${APP}yeah`)).toBe('Which first, finish resume or Student oyster card? Give me a time for each, or say "you pick" and I\'ll put them in today.');
    expect(h.flows).toEqual([]);
    await h.turn(`${APP}you pick`);
    expect(h.flows).toHaveLength(2);
  });
  it("loop-morning-brief-c: each item at the time said next to it", async () => {
    const h = harness({ now: at("2026-11-02", "08:05") });
    const said = await h.turn(`${label(BRIEF)}${APP}do the oyster card first thing, 9am, resume at 4`);
    expect(h.flows).toEqual(["add a 45 min finish resume at 4pm", "add a 45 min Student oyster card at 9am"]);
    expect(said).toMatch(/Booked today: finish resume at 4:00 PM, Student oyster card at 9:00 AM/);
  });
  it("loop-focus-done: 'ok' corrects the stale next from the real day, and 'what is next' after it reads it again", async () => {
    const h = harness({ now: at("2026-11-02", "17:00") });
    const first = await h.turn(`${label(SESSION_DONE, 0)}${APP}ok`);
    expect(first).toBe("Correction — not CS2100 yet. Right now it's Gym, until 6:30 PM. Then Side project at 7:30 PM.");
    expect(h.sessions).toEqual([]);
    expect(await h.turn(`${APP}wait what is next actually`)).toMatch(/Right now it's Gym, until 6:30 PM/);
    expect(await harness({ now: at("2026-11-02", "17:00") }).turn(`${label(SESSION_DONE, 0)}${APP}thanks, what do i do now`)).toMatch(/Gym, until 6:30 PM/);
  });
  it("loop-bedtime-reschedule-v: 'cant sleep' books a nap on the day he wakes into; the work goes after class", async () => {
    const h = harness({ now: at("2026-11-03", "03:00"), today: TUE });
    const first = await h.turn(`${label(BED, 1)}${APP}cant sleep`);
    expect(h.flows).toEqual(["add a 30 min nap at 12:20pm"]);
    expect(first).toMatch(/lie down.*nap at 12:20 PM.*CS2100 at 9:00 AM stays\./);
    const second = await h.turn(`${APP}i have a lot to do tho`);
    expect(h.flows[1]).toBe("add a 60 min catch-up work at 12:55pm");   // CS2100, ECON1115 at 11, then the nap just booked at 12:20: the first free hour after them
    expect(second).toMatch(/^It'll keep — I put 60 min of catch-up work at 12:55 PM\. Sleep now\. CS2100 at 9:00 AM stays\.$/);
  });
  it("loop-bedtime-reschedule-c: a 30 min cap with a check-back; '30 more min then bed' keeps the same one", async () => {
    const h = harness({ now: at("2026-11-03", "03:00"), today: TUE });
    expect(await h.turn(`${label(BED, 1)}${APP}im up working on econ`)).toMatch(/^Okay — 30 min on econ \(that's the cap\), then bed\. I'll check at 3:30 AM\. I put a 30 min nap at 12:20 PM/);
    expect(h.checkins).toEqual([["add", "30", "bed", "--because", "econ"]]);
    expect(await h.turn(`${APP}i need to finish this econ set first, 30 more min then bed`)).toMatch(/^Deal — 3:30 AM, then bed\./);
    expect(h.checkins).toHaveLength(1);
  });
  it("loop-calendar-question-reply: 'changed' offers the next free slot; 'moved to 8pm tonight' moves the block asked about", async () => {
    const h = harness({ now: at("2026-11-02", "14:30"), today: STUDY_DAY });
    expect(await h.turn(`${label(OFF_PLAN, 20)}${APP}changed`)).toBe("Okay — want Study for CS Midterm moved to 3:00 PM, or somewhere else? Say yes, or a time.");
    expect(await h.turn(`${APP}yes`)).toBe("Moved Study for CS Midterm to 3:00 PM.");   // REV4 8: the time read back from the calendar
    expect(h.flows).toEqual(["move Study for CS Midterm to 3pm"]);
    const c = harness({ now: at("2026-11-02", "14:30"), today: STUDY_DAY });
    await c.turn(`${label(OFF_PLAN, 20)}${APP}moved to 8pm tonight`);
    expect(c.flows).toEqual(["move Study for CS Midterm to 8pm"]);
  });
});

describe("a short reply while an outreach is pending never gets a canned template", () => {
  const cases: Array<[string, string, string[], Day?]> = [
    [START, "18:05", ["yeah", "...", "whatever", "nah", "im starving gonna eat first", "gimme 10", "done", "ok im back"]],
    [LEAVE, "12:47", ["one sec", "10 more min", "omw"]],
    [BRIEF, "08:05", ["yeah", "sure", "...", "resume at 2 and oyster card at 5"]],
    [MISSED, "15:50", ["sure whenever", "yeah", "...", "nah", "ya put it tmrw evening"]],
    [GAVE_UP, "19:30", ["...", "whatever", "ok fine", "meh", "first thing tomorrow", "nah"]],
    [SESSION_DONE, "17:00", ["ok", "thanks", "ok whats next", "..."]],
    [OFF_PLAN, "14:30", ["changed", "nah plans changed", "yeah", "got cancelled"], STUDY_DAY],
  ];
  for (const [text, time, replies, today] of cases) {
    it.each(replies)(`${offerOf(text)?.kind}: %s`, async (said) => {
      const h = harness({ now: at("2026-11-02", time), ...(today ? { today } : {}), desk: { [said]: { move: "ignore" } } });
      const reply = await h.turn(`${label(text, 5)}${APP}${said}`);
      expect(reply).not.toMatch(/^(?:WORKER|DRAFT):/);
      for (const t of TEMPLATES) expect(reply).not.toBe(t);
      expect(reply).not.toBe("…");
    });
  }
  it.each(["cant sleep", "not tired", "wide awake rn", "still doing my essay, 20 more min", "i have a lot to do tho"])("bedtime: %s", async (said) => {
    const h = harness({ now: at("2026-11-03", "03:00"), today: TUE, desk: { [said]: { move: "ignore" } } });
    const reply = await h.turn(`${label(BED, 1)}${APP}${said}`);
    expect(reply).not.toMatch(/^(?:WORKER|DRAFT):/);
    for (const t of TEMPLATES) expect(reply).not.toBe(t);
  });
  it("with no outreach pending, the same short replies go on unchanged (no code write, no check-in)", async () => {
    const h = harness({ now: at("2026-11-02", "15:50") });
    for (const said of ["sure whenever", "yeah", "changed", "whatever"]) await h.turn(`${APP}${said}`);
    expect(h.flows).toEqual([]); expect(h.checkins).toEqual([]);
  });
  it("a request of his own after a nudge is not taken as the answer", async () => {
    const h = harness({ now: at("2026-11-02", "08:05") });
    await h.turn(`${label(BRIEF)}${APP}add gym tomorrow at 7`);
    expect(h.flows).toEqual(["add gym tomorrow at 7"]);   // the schedule flow got HIS words, not a booked brief item
    const s = harness({ now: at("2026-11-02", "18:05") });
    await s.turn(`${label(START)}${APP}move it to 8pm`);
    expect(s.checkins).toEqual([]);
  });
  it("a bare yes to an offer that starts or changes something binds only within 30 minutes; a notice keeps 120", () => {
    const push = (text: string, from: string) => ({ text, at: at("2026-11-02", from).toISOString() });
    expect(readPendingTurn({ message: "ok", now: at("2026-11-02", "16:20"), lastPush: push(MISSED, "15:40") })).toBeUndefined();   // 40 min: context only
    expect(readPendingTurn({ message: "ok", now: at("2026-11-02", "16:05"), lastPush: push(MISSED, "15:40") })?.offer?.kind).toBe("catchup");
    expect(readPendingTurn({ message: "sure whenever", now: at("2026-11-02", "18:50"), lastPush: push(START, "18:00") })).toBeUndefined();
    expect(readPendingTurn({ message: "ok", now: at("2026-11-02", "18:20"), lastPush: push(START, "18:00") })?.offer?.kind).toBe("start");
  });
  it("a card push older than its window is not answered", () => {
    expect(readPendingTurn({ message: "sure whenever", now: at("2026-11-02", "18:00"), lastPush: { text: MISSED, at: at("2026-11-02", "15:40").toISOString() } })).toBeUndefined();
    expect(readPendingTurn({ message: "sure whenever", now: at("2026-11-02", "16:05"), lastPush: { text: MISSED, at: at("2026-11-02", "15:40").toISOString() } })?.offer?.kind).toBe("catchup");
    expect(readPendingTurn({ message: "sure whenever", now: at("2026-11-02", "16:05"), lastPush: { text: MISSED, at: at("2026-11-02", "15:40").toISOString() }, answered: () => true })).toBeUndefined();
  });
});

describe("voice cut-off: the continuation is the whole request, never silenced", () => {
  it("reads the marker's two forms", () => {
    expect(continuationOf('(Continuing — my last message was cut off, my full message was: "can you move gym to after my marketing class")')).toEqual({ full: "can you move gym to after my marketing class", rest: "" });
    expect(continuationOf("(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) marketing class")).toEqual({ rest: "marketing class" });
    expect(continuationOf("can you move gym")).toBeUndefined();
  });
  it("loop-voice-cutoff-v: the fragment gets 'Go on.', the continuation reaches the desk as the whole sentence and is not silenced", async () => {
    const full = "can you move gym to after my marketing class";
    const h = harness({ now: at("2026-11-02", "10:00"), desk: { [full]: { move: "ignore" } } });
    expect(await h.turn(`${SPOKEN_APP}can you move gym to after my`)).toBe("Go on.");
    const reply = await h.turn(`${SPOKEN_APP}(Continuing — my last message was cut off, my full message was: "${full}")`);
    expect(h.deskSaw).toEqual([full]);
    expect(reply).not.toBe("…");
    expect(reply).not.toBe(NOT_CAUGHT);
  });
  it("the app's form: the rest is joined to the first half", async () => {
    const h = harness({ now: at("2026-11-02", "10:00") });
    await h.turn(`${SPOKEN_APP}put side project right after the`);
    await h.turn(`${SPOKEN_APP}(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) gym tonight`);
    expect(h.deskSaw).toEqual(["put side project right after the gym tonight"]);   // the fragment itself never reached the desk
  });
});
