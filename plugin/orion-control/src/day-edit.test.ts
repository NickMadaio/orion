// w20 sched: day edits, held-out phrasings in his style. Reader (pure), runner (fake scripts over a fake day), and the chat route.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readDayEdit, touchesPast, type EditPart } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { forgetEdit, readOverride, rememberEdit } from "./day-edit-memory.js";
import { failureReason } from "./schedule-failure.js";
import { readReality, runReality } from "./reality.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Day } from "./schedule-flow.js";

const NOW = new Date(2026, 10, 4, 20, 2);   // Wed 4 Nov, 8:02 PM
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m);
const parts = (m: string, now = NOW): EditPart[] => readDayEdit(m, now)?.parts ?? [];
const day = (blocks: Day["blocks"]): Day => ({ date: "2026-11-04", now: "20:02", blocks });
const B = (title: string, start: string, end: string, kind = "study", fixed = false) => ({ title, start, end, kind, fixed });
const DAY = day([B("ABC101 Seminar", "09:00", "10:30", "class", true), B("Lunch", "12:30", "13:20", "meal"), B("Study block", "17:00", "18:00"), B("Gym", "20:00", "21:00", "gym")]);

function fakeRun(day: Day | undefined = DAY, reply?: (script: string, args: string[]) => { stdout: string; code: number } | undefined) {
  const calls: string[][] = [];
  const run = async (script: string, args: string[]) => { calls.push([script, ...args]); return reply?.(script, args) ?? { stdout: "Changed Wednesday 2026-11-04:\n  done\nWritten to his calendar.", code: 0 }; };
  return { calls, deps: { run, readDay: async () => day, readDayOn: async () => day, now: NOW, source: "phone", text: "", stateDir: undefined } as never };
}
beforeEach(() => forgetEdit());

describe("reading: several things in one message", () => {
  it("three parts with a ranges, 'then' and a bedtime", () => {
    const p = parts("ok add pottery from 7-9:30pm. then run from 10-11. push bed to 11:45");
    expect(p.map((x) => x.op)).toEqual(["add", "add", "bedtime"]);
    expect(p[0]).toMatchObject({ name: "pottery" });
  });
  it("'and' between two things after a time", () => {
    expect(parts("add reading after lunch and run at 6").map((x) => x.op === "add" && x.name)).toEqual(["reading", "run"]);
  });
  it("a reason is context, the asks are read: clear, then a bare 'gym at 10pm', sleep length planned from the alarm", () => {
    const p = parts("clear the gym im at a school thing. gym at 10pm. plan 6 hours of sleep tonight");
    expect(p.map((x) => x.op)).toEqual(["drop", "add", "sleephours"]);
  });
  it("a clause it cannot read whole makes the message not its own", () => {
    expect(readDayEdit("add gym at 10pm and move everything in my calendar around somehow", NOW)).toBeNull();
    expect(readDayEdit("what time is gym at 10pm?", NOW)).toBeNull();
    expect(readDayEdit("did legs, squats 4x6 at 185 from 5 to 6", NOW)).toBeNull();
  });
  it("a typo'd verb and a time said before it: the range is the add's, not the first clock in the sentence", () => {
    const p = parts("its only 8pm so i didnt go yet im telling you to put it in. ass 10 to 11pm add yoga");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ op: "add", name: "yoga" });
  });
});

describe("reading: natural times", () => {
  it("half 6, quarter to 7, in an hour", () => {
    expect(parts("put the gym in at half 6")[0]).toMatchObject({ op: "add", name: "gym", at: { h: 6, m: 30 } });
    expect(parts("book dentist at quarter to 4 tomorrow")[0]).toMatchObject({ op: "add", day: "tomorrow", at: { h: 3, m: 45 } });
    expect(parts("push study to in an hour")[0]).toMatchObject({ op: "move", name: "study", to: { h: 21, m: 5 } });
  });
  it("spoken bedtime with filler", () => {
    expect(parts("um can you push my bedtime to uh eleven thirty")[0]).toMatchObject({ op: "bedtime", to: { h: 11, m: 30 } });
  });
  it("10-11 is one hour (a range), 'an hour' alone is a length", () => {
    expect(parts("put an hour reading session at 3 tomorrow")[0]).toMatchObject({ op: "add", minutes: 60, at: { h: 3 } });
  });
});

describe("reading: what already happened", () => {
  it("log without a verb, correction with 'not N', didn't + was, a move of something past", () => {
    expect(parts("i was on the bus 3 to 4 lol")[0]).toMatchObject({ op: "log", name: "bus" });
    expect(parts("i did lunch from 1 to 2 not 12")[0]).toMatchObject({ op: "log", name: "lunch" });
    expect(parts("i didnt do the reading block, was at the pub 6-8")[0]).toMatchObject({ op: "didnt", name: "reading", did: "pub" });
    expect(parts("move my breakfast earlier to 9")[0]).toMatchObject({ op: "move", name: "breakfast" });
  });
  it("what is past is told from now", () => {
    expect(touchesPast(readDayEdit("i was on the bus 3 to 4", NOW)!, NOW)).toBe(true);
    expect(touchesPast(readDayEdit("add run at 10pm", NOW)!, NOW)).toBe(false);
    expect(touchesPast(readDayEdit("add run 7pm to 9pm", NOW)!, NOW)).toBe(true);   // started at 7, it is 8:02
  });
  it("yesterday", () => expect(parts("add that i was at the pub yesterday 5-6")[0]).toMatchObject({ op: "log", day: "yesterday" }));
});

describe("running: every part is tried, the past is logged", () => {
  it("add 7-9:30 (already started) and run 10-11 and bedtime: log, add, sleepplan, one line", async () => {
    // orion-sleepplan answers with its read-back from wake-plan.json (w20 routegate): the line states that, not what was asked for.
    const readback = { evening: "2026-11-04", sleepBy: "23:45", nudgeAt: "23:15", wake: "09:00", wakeDate: "2026-11-05", alarmAsked: false, hours: 9.25, lockdownBelowHours: 6, tonightOnly: true, standing: "00:00" };
    const { calls, deps } = fakeRun(DAY, (s) => (s === "orion-sleepplan" ? { stdout: JSON.stringify({ ok: true, readback }), code: 0 } : undefined));
    const out = await runDayEdit(readDayEdit("add pottery from 7pm to 9:30pm. then run from 10pm to 11pm. push bed to 11:45", NOW)!, deps);
    expect(calls).toEqual([
      ["orion-reschedule", "log", "Pottery", "--from", "19:00", "--to", "21:30"],
      ["orion-reschedule", "add", "Run", "60", "--at", "22:00", "--length-explicit"],
      ["orion-sleepplan", "bedtime", "23:45", "--tonight", "--json"],
    ]);
    expect(out.writes).toBe(2);
    expect("reply" in out.flow && out.flow.reply).toBe("I logged pottery 7–9:30 PM (it already started at 7 PM, so it's on your day as under way), put run at 10–11 PM and set your bedtime to 11:45 PM tonight (wind-down 11:15 PM, 9.25h of sleep before your 9 AM alarm).");
  });
  it("a refusal in one part does not stop the next, and is said with its reason", async () => {
    const { calls, deps } = fakeRun(DAY, (_s, a) => (a[1] === "Pottery" ? { stdout: "NOTHING WAS CHANGED: Pottery has already started", code: 1 } : undefined));
    const out = await runDayEdit(readDayEdit("add pottery at 6pm. add run at 10pm", NOW)!, deps);
    expect(calls.map((c) => c[1])).toEqual(["log", "add"]);
    const f = out.flow as { reply?: string; failures?: unknown[] };
    expect(f.reply).toMatch(/^I put run at 10–11 PM\. I couldn't log Pottery/);
    expect(f.failures).toEqual([{ reason: "passed", what: "Pottery" }]);
  });
  it("i actually did gym from 2 to 3: logged over the planned Gym that already started or overlaps, not asked about", async () => {
    const { calls, deps } = fakeRun(day([B("Gym", "14:00", "16:00", "gym")]));
    await runDayEdit(readDayEdit("i actually did gym from 2 to 3 not 4", NOW)!, deps);
    expect(calls).toEqual([["orion-reschedule", "log", "Gym", "--from", "14:00", "--to", "15:00", "--instead", "Gym"]]);
  });
  it("add that i was on the tube 5-6: logged, 5 PM from the direction of the sentence", async () => {
    const { calls, deps } = fakeRun();
    await runDayEdit(readDayEdit("add that i was on the tube 5-6", NOW)!, deps);
    expect(calls[0]).toEqual(["orion-reschedule", "log", "Tube", "--from", "17:00", "--to", "18:00"]);
  });
  it("move my lunch earlier today to 12: the past block is rewritten at 12, same length, instead of Lunch", async () => {
    const { calls, deps } = fakeRun();
    const out = await runDayEdit(readDayEdit("move my lunch earlier today to 12", NOW)!, deps);
    expect(calls).toEqual([["orion-reschedule", "log", "Lunch", "--from", "12:00", "--to", "12:50", "--instead", "Lunch"]]);
    expect("reply" in out.flow && out.flow.reply).toBe("I moved Lunch to 12–12:50 PM.");
  });
  it("i didn't do the study block, i was at the pub: pub takes the study slot", async () => {
    const { calls, deps } = fakeRun();
    await runDayEdit(readDayEdit("i didnt do the study block, i was at the pub", NOW)!, deps);
    expect(calls).toEqual([["orion-reschedule", "log", "Pub", "--from", "17:00", "--to", "18:00", "--instead", "Study block"]]);
  });
  it("a move of something still ahead is a plain move; clearing a started block is displace", async () => {
    const { calls, deps } = fakeRun(day([B("Gym", "21:00", "22:00", "gym"), B("Walk", "19:30", "20:00", "walk")]));
    await runDayEdit(readDayEdit("push gym to 10pm. clear the walk", NOW)!, deps);
    expect(calls).toEqual([["orion-reschedule", "move", "Gym", "--to", "22:00"], ["orion-reschedule", "displace", "Walk", "--why", "skip"]]);
  });
  it("push everything back, back around 9:45/10: busy from now to 10", async () => {
    const { calls, deps } = fakeRun();
    await runDayEdit(readDayEdit("push everything back. i was meant to be at a thing at 7:15 and went the wrong way on the tube and am getting there at 8. ill be back around 9:45/10pm", NOW)!, deps);
    expect(calls).toEqual([["orion-reschedule", "busy", "20:05-22:00", "--why", "running late, back later"]]);
  });
  it("yesterday goes through log --date yesterday", async () => {
    const { calls, deps } = fakeRun();
    await runDayEdit(readDayEdit("add that i was at the pub yesterday 5-6", NOW)!, deps);
    expect(calls[0]).toEqual(["orion-reschedule", "log", "Pub", "--from", "17:00", "--to", "18:00", "--date", "yesterday"]);
  });
});

describe("override: 'add it anyway, dont worry if it passed'", () => {
  it("re-runs the part he names from the last edit", () => {
    rememberEdit(readDayEdit("add pottery from 7pm to 9:30pm. add run at 10pm", NOW)!, NOW);
    const o = readOverride("add pottery anyways dont worry if it already passed", at(20, 5))!;
    expect(o.parts).toHaveLength(1);
    expect(o.parts[0]).toMatchObject({ name: "pottery" });
    expect(readReality("add pottery anyways dont worry if it already passed", at(20, 5))?.reality.kind).toBe("edit");
  });
  it("nothing remembered, or too old: not an override", () => {
    expect(readOverride("add it anyway", NOW)).toBeNull();
    rememberEdit(readDayEdit("add run at 10pm", NOW)!, NOW);
    expect(readOverride("add it anyway", at(22, 0))).toBeNull();
  });
});

describe("why a step refused, as data", () => {
  it("bedtime, no room, passed, no such block", () => {
    expect(failureReason("NOTHING WAS CHANGED: must-haves could not fit: Gym.", { bedtime: "21:50", start: 22 * 60, what: "Gym" })).toEqual({ reason: "after_bedtime", bedtime: "21:50", what: "Gym" });
    expect(failureReason("MUST-HAVE NOT BOOKED: Gym (60 min) did not fit on Wednesday", { what: "Gym" })).toEqual({ reason: "no_room", what: "Gym" });
    expect(failureReason("NOTHING WAS CHANGED: Gym at 20:00 has already started (it is 20:02)")).toMatchObject({ reason: "passed", at: "20:00" });
    expect(failureReason('NOTHING WAS CHANGED: no block called "Yoga" on Wednesday')).toEqual({ reason: "no_such_block", name: "Yoga" });
    expect(failureReason("Changed Wednesday")).toBeUndefined();
  });
});

describe("through reality: the same reply from both surfaces", () => {
  it("readReality + runReality, no model", async () => {
    const read = readReality("i was at the pub 5-6 and then add run at 10pm", NOW);
    expect(read?.reality.kind).toBe("edit");
    const { calls, deps } = fakeRun();
    const out = await runReality(read!, deps);
    expect(calls.map((c) => c[1])).toEqual(["log", "add"]);
    expect(out?.writes).toBe(2);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
describe("chat route: scheduling words never reach the workout logger", () => {
  function route() {
    const handlers = new Map<string, Handler[]>();
    const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "w20ed-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const calls: string[][] = []; const workouts: string[][] = [];
    registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Wed 20:02", now: () => NOW,
      decideImpl: async () => ({ move: "escalate" }) as never, brainSearch: async () => "",
      scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => DAY, readDay: async () => JSON.stringify(DAY),
      realityRun: async (s: string, a: string[]) => { calls.push([s, ...a]); return { stdout: "Changed Wednesday\nWritten to his calendar.", code: 0 }; },
      workoutRun: async (a: string[]) => { workouts.push(a); return { stdout: "{}", code: 0 }; } } as never);
    let n = 0;
    const turn = async (prompt: string) => {
      const ctx = { runId: `w20-${n += 1}`, sessionKey: `agent:main:orion-chat-w20-${n % 3}` };   // a different session each turn, like the phone
      await fire("before_model_resolve", { prompt }, ctx);
      const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
      const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string }>;
      return direct?.reply?.text ?? /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    };
    return { turn, calls, workouts };
  }
  it("'put an hour gym session at 10-11 for me' is an add at 22:00 for 60 minutes, not 'what did you do'", async () => {
    const r = route();
    const text = await r.turn("put an hour gym session at 10-11 for me");
    expect(r.workouts).toEqual([]);
    expect(r.calls).toEqual([["orion-reschedule", "add", "Gym", "60", "--at", "22:00", "--length-explicit"]]);
    expect(text).toBe("I put gym at 10–11 PM.");
  });
  it("then, in another session, 'add it anyway' re-runs nothing new but 'i was at the pub 5-6' logs", async () => {
    const r = route();
    await r.turn("i was at the pub 5-6");
    expect(r.calls[0]).toEqual(["orion-reschedule", "log", "Pub", "--from", "17:00", "--to", "18:00"]);
  });
});
