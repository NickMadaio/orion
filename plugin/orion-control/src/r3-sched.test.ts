// w20 round 3 (live gate 2026-11-05 01:00-02:00): held-out phrasings in his style for each failed class.
import { beforeEach, describe, expect, it } from "vitest";
import { readDayEdit, type EditPart } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { forgetEdit } from "./day-edit-memory.js";
import { pickClock, pickRange } from "./day-edit-time.js";
import { eveningTime, trulyAmbiguous } from "./direct-add.js";
import { resolveStart } from "./intent-time.js";
import { collision, writeOrder } from "./move-order.js";
import { runScheduleFlow, type Day, type Intent } from "./schedule-flow.js";
import { spokenFailure } from "./schedule-reply.js";
import { afterReply, replayOf } from "./retry-slot.js";
import { OVERFLOW, OVERFLOW_LINE, estimateTokens, trimHistory } from "./history-trim.js";
import { finalizeReply } from "./reply-sanitize.js";
import { parseAgenda, pastDayReply, readPastDayAsk } from "./agenda-day.js";
import { isLateTomorrow, lateTomorrowAnswer } from "./late-tomorrow.js";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
import { toolDirective } from "./tool-moves.js";

const AT = (h: number, m = 0) => new Date(2026, 10, 5, h, m);   // Thu 5 Nov 2026
const NIGHT = AT(1, 30);
const parts = (m: string, now = NIGHT): EditPart[] => readDayEdit(m, now)?.parts ?? [];
const B = (title: string, start: string, end: string, kind = "other", fixed = false) => ({ title, start, end, kind, fixed });
const day = (blocks: Day["blocks"], now = "01:30"): Day => ({ date: "2026-11-05", now, blocks });
beforeEach(() => forgetEdit());

function fake(d: Day, agenda?: Array<{ title: string; start: string }>, now = NIGHT) {
  const calls: string[][] = [];
  const run = async (script: string, args: string[]) => {
    calls.push([script, ...args]);
    if (script === "orion-declare") return { stdout: JSON.stringify({ id: "fact-abcd1234" }), code: 0 };
    return { stdout: "Changed Thursday 2026-11-05:\n  moved it\nWritten to his calendar.", code: 0 };
  };
  return { calls, deps: { run, readDay: async () => d, readDayOn: async () => d, now, source: "chat", text: "", stateDir: undefined, ...(agenda ? { agendaDay: async (date: string) => ({ date, events: agenda }) } : {}) } as never };
}

describe("am/pm: a bare clock is a time he is awake for", () => {
  it("half 5 at 1 AM is 17:30, never 05:30", () => {
    expect(pickClock({ h: 5, m: 30, exact: false }, 90, "future")).toBe(17 * 60 + 30);
    expect(resolveStart({ h: 5, m: 30, exact: false }, { day: "today", now: 90 })).toEqual({ at: 17 * 60 + 30 });
    expect(eveningTime("05:30", 90, "add gym at half 5")).toBe("17:30");
  });
  it("his words can say early morning", () => {
    expect(eveningTime("05:30", 90, "add gym at 5:30 in the morning")).toBe("05:30");
    expect(eveningTime("05:30", 90, "put a run at 5:30 am")).toBe("05:30");
    expect(parts("put a run at 5 in the morning")[0]).toMatchObject({ op: "add", at: { h: 5, ap: "a", exact: true } });
  });
  it("a small hour only a few hours off is asked about, not guessed", () => {
    expect(trulyAmbiguous("05:00", 180, "put a walk at 5")).toEqual(["05:00", "17:00"]);
    expect(trulyAmbiguous("05:00", 90, "put a walk at 5")).toBeUndefined();
    expect(trulyAmbiguous("05:00", 180, "put a walk at 5 am")).toBeUndefined();
  });
  it("a range with no am/pm is the waking-hours reading: 2-4 is 14:00-16:00, 6-8 is 18:00-20:00", () => {
    expect(pickRange({ h: 2, m: 0, exact: false }, { h: 4, m: 0, exact: false }, 90, "past")).toEqual({ from: 840, to: 960 });
    expect(pickRange({ h: 6, m: 0, exact: false }, { h: 8, m: 0, exact: false }, 1440, "past")).toEqual({ from: 1080, to: 1200 });
  });
  it("gym at half 5 at 1 AM goes on the calendar at 17:30", async () => {
    const f = fake(day([B("CS1800 Lecture", "09:00", "10:30", "class", true)]));
    await runDayEdit(readDayEdit("add gym at half 5", NIGHT)!, f.deps);
    expect(f.calls.find((c) => c[1] === "add")).toEqual(expect.arrayContaining(["Gym", "--at", "17:30"]));
  });
});

describe("a past correction: 'X at A not B' moves the block it was, keeping its length", () => {
  it("dinner at 7 not 6 earlier, at 1 AM, is last evening's dinner", async () => {
    const p = parts("i actually did dinner at 7 not 6 earlier");
    expect(p[0]).toMatchObject({ op: "correct", name: "dinner", at: { h: 7 }, was: { h: 6 }, evening: true });
    const f = fake(day([B("CS1800 Lecture", "09:00", "10:30", "class", true)]), [{ title: "Dinner", start: "18:00" }]);
    await runDayEdit(readDayEdit("i actually did dinner at 7 not 6 earlier", NIGHT)!, f.deps);
    const log = f.calls.find((c) => c[1] === "log")!;
    expect(log).toEqual(expect.arrayContaining(["Dinner", "--from", "19:00", "--date", "yesterday"]));
    expect(log[log.indexOf("--to") + 1]).toBe("19:45");
    expect(log).toEqual(expect.arrayContaining(["--instead", "Dinner"]));
  });
  it("with no such block on record it is logged where he says, not 'from 19:00 to now'", async () => {
    const f = fake(day([]), []);
    const out = await runDayEdit(readDayEdit("i had lunch at 2 not 1 earlier", AT(15, 0))!, { ...(f.deps as object), now: AT(15, 0) } as never);
    expect(f.calls.find((c) => c[1] === "log")).toEqual(expect.arrayContaining(["--from", "14:00"]));
    expect(JSON.stringify(out.flow)).not.toMatch(/shorter than 5/);
  });
  it("siblings read as corrections", () => {
    for (const m of ["i went to the gym at 5 not 4 earlier", "ate at 8 not 7 tonight", "i actually met sam at 3 not 2 earlier", "called mum at 4 not 5"]) {
      expect(parts(m)[0]?.op, m).toBe("correct");
    }
  });
  it("called mum at 4 not 5, so shift it: the block is moved to 4 (it is a plan still ahead at 1 AM)", async () => {
    expect(parts("i actually called mum at 4 not 5 so shift it")[0]).toMatchObject({ op: "correct", name: "mum" });
    const f = fake(day([B("Call with mum", "17:40", "18:20", "other", true)]));
    await runDayEdit(readDayEdit("i actually called mum at 4 not 5 so shift it", NIGHT)!, f.deps);
    expect(f.calls.find((c) => c[1] === "move")).toEqual(expect.arrayContaining(["Call with mum", "--to", "16:00", "--named"]));
  });
});

describe("i didnt go to the lecture yesterday, i was at the library 2-4", () => {
  const msg = "i didnt go to the lecture yesterday, i was at the library 2-4 instead";
  it("reads yesterday, a clean name, and the range", () => {
    expect(parts(msg)[0]).toMatchObject({ op: "didnt", name: "lecture", day: "yesterday", did: "library" });
  });
  it("marks the lecture missed (dated yesterday) and logs the library 14:00-16:00 yesterday", async () => {
    const f = fake(day([]), [{ title: "CS1800 Discrete Structures — Lecture", start: "09:00" }]);
    const out = await runDayEdit(readDayEdit(msg, NIGHT)!, f.deps);
    expect(f.calls.find((c) => c[0] === "orion-declare")).toEqual(expect.arrayContaining(["--kind", "skip", "--date", "2026-11-04"]));
    const log = f.calls.find((c) => c[1] === "log")!;
    expect(log).toEqual(expect.arrayContaining(["Library", "--from", "14:00", "--to", "16:00", "--date", "yesterday"]));
    expect(JSON.stringify(out.flow)).toMatch(/missed yesterday/);
  });
  it("siblings: a range with no am/pm in the small hours is the afternoon of the day before", () => {
    expect(parts("didnt do gym yesterday, was at the pub 6-8")[0]).toMatchObject({ op: "didnt", day: "yesterday", did: "pub" });
    expect(parts("i skipped the seminar yesterday cos i was at the library 1-3")).toBeDefined();
  });
  it("with no 'yesterday', a time that cannot be today's at 1 AM is still the day before", async () => {
    const f = fake(day([]), []);
    await runDayEdit(readDayEdit("i was at the library 2-4", NIGHT)!, f.deps);
    expect(f.calls.find((c) => c[1] === "log")).toEqual(expect.arrayContaining(["--from", "14:00", "--date", "yesterday"]));
  });
});

describe("several moves in one message are planned together", () => {
  const d = day([B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "12:25", "13:25", "other", true)], "09:00");
  const at9 = AT(9, 0);
  it("reads a move and a push-back", () => {
    const p = parts("move practice leetcode to 2pm and push the orion learning plan back an hour", at9);
    expect(p.map((x) => x.op)).toEqual(["move", "shift"]);
    expect(p[1]).toMatchObject({ op: "shift", minutes: 60 });
  });
  it("shift siblings", () => {
    expect(parts("push gym back 30 min and move study to 5pm", at9).map((x) => x.op)).toEqual(["shift", "move"]);
    expect(parts("move study to 4 then bump the call earlier by 20 mins", at9).map((x) => x.op)).toEqual(["move", "shift"]);
  });
  it("destinations that land on each other write nothing and say both", async () => {
    const f = fake(d, undefined, at9);
    const out = await runDayEdit(readDayEdit("move practice leetcode to 2pm and push the orion learning plan back an hour", at9)!, f.deps);
    expect(f.calls.filter((c) => c[1] === "move")).toHaveLength(0);
    const text = out.flow.outcome === "say" ? out.flow.text : "";
    expect(text).toMatch(/practice leetcode to 2–3 PM/);
    expect(text).toMatch(/learning plan to 1:25–2:25 PM/);
    expect(text).toMatch(/overlap/);
  });
  it("a move into the slot the other block is leaving waits for it: the push goes first", async () => {
    const dd = day([B("gym", "10:00", "11:00"), B("study", "15:00", "16:00")], "09:00");
    const f = fake(dd, undefined, at9);
    await runDayEdit(readDayEdit("move gym to 3pm and push study back an hour", at9)!, f.deps);
    const moves = f.calls.filter((c) => c[1] === "move");
    expect(moves.map((m) => m[2])).toEqual(["study", "gym"]);
    expect(moves[0]).toEqual(expect.arrayContaining(["--to", "16:00"]));
    expect(moves[1]).toEqual(expect.arrayContaining(["--to", "15:00"]));
  });
  it("move-order: pure planning", () => {
    expect(collision([{ current: [0, 10], next: [20, 30] }, { current: [40, 50], next: [25, 35] }])?.minutes).toBe(5);
    expect(writeOrder([{ current: [10, 20], next: [30, 40] }, { current: [30, 40], next: [50, 60] }])).toEqual([1, 0]);
  });
});

describe("a plan with someone needs a time: 'after lunch' is the usual end of lunch", () => {
  const d = day([B("CS1800 Lecture", "09:00", "10:30", "class", true)], "11:00");
  async function run(message: string, steps: Intent[], day0: Day = d) {
    const calls: string[][] = [];
    const result = await runScheduleFlow({ message, clock: "Thu 11:00", now: AT(11, 0),
      exec: async (a) => { calls.push(a); return a[0] === "show" ? { stdout: JSON.stringify(day0), code: 0 } : { stdout: "Changed Thursday 2026-11-05:\n  added Call with mum: 13:30–14:10\nWritten to his calendar.", code: 0 }; },
      ask: async () => ({ steps }) });
    return { result, calls };
  }
  it("add a 40 min call with mum after lunch: written at 13:30, not stopped after a dry run", async () => {
    const { result, calls } = await run("add a 40 min call with mum after lunch", [{ do: "add", what: "call with mum", minutes: 40 }]);
    const writes = calls.filter((c) => c[0] === "add" && !c.includes("--dry-run"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(expect.arrayContaining(["call with mum", "40", "--at", "13:30"]));
    expect(result.outcome).toBe("done");
  });
  it("with no time and no anchor he is asked, in words", async () => {
    const { result } = await run("put a call with dad in my day for 20 min", [{ do: "add", what: "call with dad", minutes: 20 }]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: expect.stringMatching(/What time should I put call with dad at/) });
  });
  it("the scheduler's 'a fixed plan needs --at HH:MM' is never spoken truncated", () => {
    const said = spokenFailure("NOTHING WAS CHANGED: a fixed plan needs --at HH:MM");
    expect(said).toMatch(/exact time/);
    expect(said).not.toMatch(/needs\.?$/);
  });
});

describe("try again runs the message that failed", () => {
  it("a failed change is kept for a retry word, a question or a retry word itself is not", () => {
    const failed = "I couldn't add the call: the tool didn't show it booked. Want me to try it a different way?";
    const slot = afterReply(failed, "add a 40 min call with mum after lunch", 1000);
    expect(slot?.message).toBe("add a 40 min call with mum after lunch");
    expect(replayOf(slot, "try again", 2000)).toBe("add a 40 min call with mum after lunch");
    expect(afterReply(failed, "whats on today?", 1000)).toBeUndefined();
    expect(afterReply(failed, "try again", 1000)).toBeUndefined();
    expect(afterReply("Done: put gym at 5 PM.", "add gym at 5", 1000)).toBeUndefined();
    expect(replayOf(slot, "try again", 1000 + 11 * 60_000)).toBe("try again");
  });
  it.each(["retry", "do it again", "have another go", "yeah try it again"])("%s is a retry word", (w) => {
    const slot = afterReply("I couldn't move the call, so nothing is unchanged.", "move the call to 6", 5);
    expect(replayOf(slot, w, 6)).toBe("move the call to 6");
  });
});

describe("a long chat keeps working: no raw context error, history trimmed to fit", () => {
  const turn = (i: number) => [{ role: "user", content: `message ${i} ${"x".repeat(900)}` }, { role: "assistant", content: [{ type: "text", text: `reply ${i} ${"y".repeat(900)}` }] }];
  it("the host's overflow text is never shown", () => {
    const raw = "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";
    expect(OVERFLOW.test(raw)).toBe(true);
    expect(finalizeReply(raw, [])).toBe(OVERFLOW_LINE);
    expect(OVERFLOW_LINE).not.toMatch(/\/reset|overflow/i);
    expect(OVERFLOW_LINE).toMatch(/Say go and I'll retry it\./);
  });
  it("57 turns are trimmed from the oldest end, in place, to start on a user turn and keep the newest", () => {
    const messages: unknown[] = Array.from({ length: 57 }, (_, i) => turn(i)).flat();
    const last = messages.at(-1);
    const dropped = trimHistory(messages, 6000);
    expect(dropped).toBeGreaterThan(40);
    expect(estimateTokens(messages)).toBeLessThanOrEqual(6000);
    expect((messages[0] as { role: string }).role).toBe("user");
    expect(messages.at(-1)).toBe(last);
  });
  it("a history that already fits is left alone; a tool result is never left first", () => {
    const small: unknown[] = turn(1);
    expect(trimHistory(small, 6000)).toBe(0);
    const withTool: unknown[] = [...turn(1), { role: "toolResult", content: "z".repeat(2000) }, ...turn(2), ...turn(3)];
    trimHistory(withTool, 1200);
    expect((withTool[0] as { role: string }).role).toBe("user");
  });
});

describe("what was on yesterday evening, and what tomorrow means after midnight", () => {
  const text = "today is Thursday, November 5, 2026\nasked about Wednesday, November 4, 2026 — -1 days from today\n  9:00 AM — CS1800 Discrete Structures — Lecture\n      id: AAA\n  6:30 PM — Dinner with Sam\n      id: BBB\n  8:00 PM — Gym\n      id: CCC\n";
  it("parses the agenda and answers for the part of the day he asked about", () => {
    const a = parseAgenda("2026-11-04", text)!;
    expect(a.events.map((e) => e.start)).toEqual(["09:00", "18:30", "20:00"]);
    const ask = readPastDayAsk("what did i have on yesterday evening")!;
    expect(ask).toMatchObject({ day: "yesterday", part: "evening" });
    expect(pastDayReply(a, ask, "Wednesday 4 Nov")).toBe("On Wednesday 4 Nov evening you had Dinner with Sam at 6:30 PM and Gym at 8:00 PM.");
    expect(pastDayReply({ date: "d", events: [] }, ask, "Wednesday 4 Nov")).toMatch(/Nothing was on your calendar/);
    expect(pastDayReply(undefined, ask, "Wednesday 4 Nov")).toMatch(/couldn't read/);
  });
  it.each(["what was on my calendar last night", "whats on my schedule yesterday morning", "what did i have on yesterday afternoon"])("%s is a past-day question", (m) => {
    expect(readPastDayAsk(m)).toBeDefined();
  });
  it.each(["what did i eat yesterday", "how did i sleep last night", "whats on today"])("%s is not", (m) => {
    expect(readPastDayAsk(m)).toBeUndefined();
  });
  it("tomorrow at 1 AM is the day coming up, with its weekday and date said, and how to ask for the next", () => {
    expect(isLateTomorrow("whats tomorrow looking like", AT(1, 30))).toBe(true);
    expect(isLateTomorrow("whats tomorrow looking like", AT(9, 0))).toBe(false);
    const day = "B1 09:00–10:30 CS1800 Discrete Structures — Lecture (FIXED)\nB2 11:20–12:20 practice leetcode";
    const said = lateTomorrowAnswer(day, AT(1, 30));
    expect(said).toMatch(/Thursday 5 Nov/);
    expect(said).toMatch(/CS1800 Discrete Structures at 9:00 AM and practice leetcode at 11:20 AM/);
    expect(said).toMatch(/Friday 6 Nov/);
    expect(said).not.toMatch(/Tomorrow is Thursday/);
  });
});

describe("a timer is a timer, never a calendar block", () => {
  it("the schedule flow steps aside for it", async () => {
    let wrote = false;
    const r = await runScheduleFlow({ message: "set a 10 min timer for my pasta", clock: "Thu 01:50", now: AT(1, 50),
      exec: async (a) => { if (a[0] !== "show") wrote = true; return { stdout: JSON.stringify(day([])), code: 0 }; }, ask: async () => ({ steps: [{ do: "add", what: "bed", minutes: 10 }] }) });
    expect(r.outcome).toBe("fallback"); expect(wrote).toBe(false);
  });
  it("and the timer tool runs even when the desk escalated", () => {
    const d = toolDirective({ move: "escalate" } as never, "set a 25 min timer for my washing");
    expect(d).toMatchObject({ kind: "call", action: "timer_set", args: expect.stringContaining("1500") });
    expect(toolDirective({ move: "escalate" } as never, "whats on today")).toBeNull();
  });
});

describe("stop the focus session: really stopped, then read back", () => {
  it.each(["actually stop the focus session, im knackered", "end focus", "stop the session", "can you end my focus session please", "quit focus mode"])("%s", (m) => {
    expect(readFocusMove(m)).toMatchObject({ kind: "end" });
  });
  it("stop is a give-up, end is a finish; neither is a question or a start", () => {
    expect(readFocusMove("stop the focus session, im knackered")).toEqual({ kind: "end", how: "abandon" });
    expect(readFocusMove("end focus")).toEqual({ kind: "end", how: "finish" });
    expect(readFocusMove("is my focus session over?")).toBeNull();
    expect(readFocusMove("stop me from getting distracted")).toBeNull();
  });
  function session(afterStatus: string) {
    const calls: string[] = []; let stopped = false;
    const exec = async (args: string[]) => {
      calls.push(args[0]!);
      if (args[0] === "abandon" || args[0] === "finish") { stopped = true; return { stdout: JSON.stringify({ ok: true, status: afterStatus === "inactive" ? "inactive" : "running" }), code: 0 }; }
      const status = stopped ? afterStatus : "running";
      return { stdout: JSON.stringify({ ok: true, status, task: "resume", servedFocusSeconds: 1500 }), code: 0 };
    };
    return { calls, exec };
  }
  it("says it is stopped only when status reads back inactive", async () => {
    const s = session("inactive");
    const out = await runFocusMove({ kind: "end", how: "abandon" }, { exec: s.exec, now: AT(1, 40) });
    expect(s.calls).toEqual(["status", "abandon", "status"]);
    expect(out.flow).toMatchObject({ outcome: "done", reply: expect.stringMatching(/Stopped: your resume session is over and nothing is running now/) });
  });
  it("never claims it when the session still runs", async () => {
    const s = session("running");
    const out = await runFocusMove({ kind: "end", how: "abandon" }, { exec: s.exec, now: AT(1, 40) });
    expect(out.flow).toMatchObject({ outcome: "say", text: expect.stringMatching(/still shows as running, so it isn't stopped/) });
  });
  it("with none running it says so", async () => {
    const out = await runFocusMove({ kind: "end", how: "finish" }, { exec: async () => ({ stdout: JSON.stringify({ ok: true, status: "inactive" }), code: 0 }), now: AT(1, 40) });
    expect(out.flow).toMatchObject({ outcome: "say", text: expect.stringMatching(/No focus session is running/) });
  });
});

describe("held-out siblings", () => {
  it.each(["start a 15 min timer for the oven", "put on a 5 minute timer", "timer for 20 min for my laundry", "set a 45 min timer for the bread", "set me a 3 min timer for my tea"])("a timer: %s", async (m) => {
    expect(toolDirective({ move: "escalate" } as never, m), m).toMatchObject({ kind: "call", action: "timer_set" });
    const r = await runScheduleFlow({ message: m, clock: "Thu 01:50", now: AT(1, 50), exec: async () => ({ stdout: JSON.stringify(day([])), code: 0 }), ask: async () => ({ steps: [{ do: "add", what: "bed", minutes: 10 }] }) });
    expect(r.outcome).toBe("fallback");
  });
  it.each([
    ["book a 30 min call with dad after dinner", "call with dad", "19:30"],
    ["put a coffee with sam after lunch", "coffee with sam", "13:30"],
    ["add a 1 hr meeting with my prof after breakfast", "meeting with my prof", "09:00"],
    ["schedule a 20 min call with nan after lunch", "call with nan", "13:30"],
    ["add a 15 min call with the landlord after lunch", "call with the landlord", "13:30"],
  ])("a plan with someone after a meal: %s", async (m, what, at) => {
    const calls: string[][] = [];
    const d = day([B("CS1800 Lecture", "09:00", "10:30", "class", true)], "08:00");
    await runScheduleFlow({ message: m, clock: "Thu 08:00", now: AT(8, 0), exec: async (a) => { calls.push(a); return a[0] === "show" ? { stdout: JSON.stringify(d), code: 0 } : { stdout: "Changed\n  added it\nWritten to his calendar.", code: 0 }; },
      ask: async () => ({ steps: [{ do: "add", what, minutes: 30 }] }) });
    expect(calls.find((c) => c[0] === "add" && !c.includes("--dry-run")), m).toEqual(expect.arrayContaining(["--at", at]));
  });
  it.each(["i actually went for coffee at 3 not 2 earlier", "i did the gym at 6 not 5 earlier", "i had lunch at 2 not 1 earlier", "i actually ate at 9 not 8 tonight", "had a call with nan at 4 not 3 earlier"])("a correction: %s", (m) => {
    expect(parts(m, AT(1, 30))[0]).toMatchObject({ op: "correct", evening: true });
  });
  it.each(["didnt go to seminar yesterday, was at the pub 6-8", "i skipped the lecture yesterday and was at the library 1-3", "i didnt make it to class yesterday, i was at the gym 4-5"])("a missed class yesterday: %s", (m) => {
    const p = parts(m, AT(1, 30));
    expect(p[0]?.op, m).toBe("didnt");
    expect(p[0], m).toMatchObject({ day: "yesterday" });
  });
});
