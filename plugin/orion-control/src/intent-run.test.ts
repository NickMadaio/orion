// The calendar intent layer carried out (intent-run.ts through runScheduleFlow and the routing hooks), for every failure of the 2026-10-20
// re-run (docs/audits/2026-10-20-live-as-nick.md, "Re-run"): today at 22:40 and tomorrow. Fixtures only: a stub scheduler, no model.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, TOOK_BACK, type Day, type FlowResult } from "./schedule-flow.js";
import type { ReplanAsk } from "./day-replan.js";

const plan = { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] };
// Tomorrow (10-21): two classes, nothing else.
const tomorrow = (extra: Day["blocks"] = []): Day => ({ date: "2030-10-04", now: null, plan, blocks: [
  { title: "CS1802 Seminar — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "CS2100 Program Design — Lecture", start: "11:00", end: "12:30", fixed: true, kind: "class" }, ...extra] });
// Today at 22:42: everything is over; his kept Gym ran 21:05-22:35.
const today = (now = "22:42"): Day => ({ date: "2030-10-03", now, plan, blocks: [
  { title: "CS Lab", start: "09:00", end: "11:15", fixed: false, kind: "study" },
  { title: "ECON1115 Principles of Macroeconomics — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
  { title: "finish resume", start: "17:50", end: "19:20", fixed: false, kind: "study" },
  { title: "Gym", start: "21:05", end: "22:35", fixed: false, kind: "gym" }] });
const NOW = new Date(2030, 9, 3, 22, 42);

/** The flow with a scheduler stub: `show` gives the day for the --date asked, a write prints `out`. Records every call; the form must never be asked. */
async function flow(message: string, opts: { days?: { today?: Day; tomorrow?: Day; after?: Day }; out?: string; now?: Date; context?: ReplanAsk } = {}) {
  const calls: string[][] = []; let wrote = false;
  const result = await runScheduleFlow({ message, clock: "Tue 22:42", now: opts.now ?? NOW, ...(opts.context ? { replanContext: opts.context } : {}),
    exec: async (args) => {
      calls.push(args);
      if (args[0] !== "show") { wrote = true; return { stdout: opts.out ?? "Changed:\n  planned walk: 17:00–17:45\nWritten to his calendar.", code: 0 }; }
      const other = args.includes("tomorrow") || args.includes("2030-10-04");
      const d = wrote && opts.days?.after ? opts.days.after : other ? opts.days?.tomorrow ?? tomorrow() : opts.days?.today ?? today();
      return { stdout: JSON.stringify(d), code: 0 };
    },
    ask: async () => { throw new Error("the form must not be asked"); } });
  return { result, calls, writes: calls.filter((c) => c[0] !== "show") };
}

describe("re-run #2a/#2b: gym first then resume, tomorrow, with no resume on tomorrow", () => {
  it("#2a says resume is not on tomorrow, writes nothing, and remembers the request", async () => {
    const { result, writes, calls } = await flow("can u redo tomorrow after my first class, gym first then resume");
    expect(writes).toEqual([]);
    expect(calls[0]).toEqual(["show", "--json", "--date", "tomorrow"]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: expect.stringMatching(/^Resume isn't on your day tomorrow, so I haven't changed anything\. How many minutes/),
      replan: { order: ["gym", "resume"], anchor: "first class", day: "tomorrow", date: "2030-10-04" } });
  });
  it("#2b on that memory is a reorder of the same request, on the same date: still honest about resume", async () => {
    const context: ReplanAsk = { order: ["gym", "resume"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" };
    const { result, writes, calls } = await flow("actually do resume before gym", { context });
    expect(writes).toEqual([]);
    expect(calls[0]).toEqual(["show", "--json", "--date", "2030-10-04"]);
    expect(result).toMatchObject({ outcome: "say", text: expect.stringMatching(/^Resume isn't on your day tomorrow/) });
  });
  it("with a length for resume it is booked: gym first after the classes and the trip home, resume right behind it", async () => {
    const after = tomorrow([{ title: "Gym", start: "13:20", end: "14:50", fixed: false, kind: "gym" }, { title: "resume", start: "14:55", end: "15:55", fixed: false }]);
    const { result, writes } = await flow("can u redo tomorrow after my first class, gym first then resume for an hour", { days: { after }, out: "Changed:\n  planned Gym: 13:20–14:50\n  planned resume: 14:55–15:55" });
    expect(writes).toEqual([["day", "--plan", "Gym, 90, 13:20", "--plan", "resume, 60, 14:55", "--date", "tomorrow"]]);
    expect(result).toMatchObject({ outcome: "done", reply: expect.stringMatching(/^Done for tomorrow, but not as asked, after your first class: Gym 1:20–2:50 PM, then resume 2:55–3:55 PM\. Gym couldn't go first at 10:35 AM because CS2100 Program Design is in the way/) });
  });
});

describe("re-run #5: 'put cs lab from now until ten thirty' at 22:42", () => {
  it("says 10:30 PM has already passed, in words that are true; nothing is booked and no Gym is squeezed", async () => {
    const { result, writes } = await flow("put cs lab from now until ten thirty");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: "10:30 PM has already passed (it's 10:42 PM), so I haven't booked CS Lab. Tell me a later end time." });
  });
  it("at 21:55 it is booked from now to 22:30, as a second CS Lab", async () => {
    const { writes, result } = await flow("put cs lab from now until ten thirty", { days: { today: today("21:55") }, now: new Date(2030, 9, 3, 21, 55), out: "Changed:\n  planned CS Lab: 21:55–22:30" });
    expect(writes).toEqual([["add", "CS Lab", "35", "--at", "21:55", "--again"]]);
    expect(result).toMatchObject({ outcome: "done", reply: expect.stringContaining("Your earlier CS Lab (9:00 AM–11:15 AM) is already over, so this is a second one.") });
  });
  it("a run the scheduler refused is never 'Done', even when it lists the plan it tried (NOTHING WAS CHANGED … planned CS Lab …)", async () => {
    const refused = "NOTHING WAS CHANGED: must-haves could not fit: Gym.\n  rebuilt the remaining day from fixed commitments and must-haves first\n  cleared 1 prior schedule block: Gym\n  planned CS Lab: 21:55–22:30\n  MUST-HAVE NOT BOOKED: Gym (90 min) did not fit on Thursday\n";
    const { result } = await flow("put cs lab from now until ten thirty", { days: { today: today("21:55") }, now: new Date(2030, 9, 3, 21, 55), out: refused });
    expect(result).toMatchObject({ outcome: "say", text: "Not done: Gym didn't fit. I won't cut it short to fit, so nothing was changed. Tell me if CS Lab should end earlier, or whether it should wait." });
  });
  it("'from now' tomorrow is refused with the reason", async () => {
    const { result, writes } = await flow("put cs lab from now until ten thirty tomorrow");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: expect.stringMatching(/^"From now" only works for today/) });
  });
});

describe("re-run #7: 'reschedule tomorrow, put piano practice first'", () => {
  it("names piano practice as missing from tomorrow", async () => {
    const { result, writes } = await flow("reschedule tomorrow, put piano practice first");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: expect.stringMatching(/^Piano practice isn't on your day tomorrow, so I haven't changed anything/) });
  });
});

describe("re-run #9: 'dinner then gym' right after 'reschedule tomorrow after my first class, gym first'", () => {
  const booked = tomorrow([{ title: "Gym", start: "13:20", end: "14:50", fixed: false, kind: "gym" }]);
  const context: ReplanAsk = { order: ["gym"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" };
  it("reorders nothing, says what stands, and how to ask for it", async () => {
    const { result, writes } = await flow("dinner then gym", { days: { tomorrow: booked }, context });
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", kind: "plain",
      text: "Dinner wasn't in the plan I just made and isn't on your day tomorrow, so I haven't changed anything: Gym is still 1:20–2:50 PM tomorrow. To change the order, say \"reschedule tomorrow after my first class, do dinner for 30 min then gym\"." });
  });
  it("the sentence it suggests is one code carries out", async () => {
    const { writes } = await flow("reschedule tomorrow after my first class, do dinner for 30 min then gym", { days: { tomorrow: booked } });
    // dinner (30) would end inside CS2100 at 11:00, so both go after it and the trip home: dinner 1:20 PM, then the Gym at its 90 minutes
    expect(writes).toEqual([["day", "--plan", "dinner, 30, 13:20", "--plan", "Gym, 90, 13:55", "--date", "tomorrow"]]);
  });
});

describe("re-run #10 (the wrong write): 'can u put a 45 min walk tomorrow at 5'", () => {
  it("books the walk at 5 PM tomorrow, 45 minutes, and says so", async () => {
    const { result, writes } = await flow("can u put a 45 min walk tomorrow at 5");
    expect(writes).toEqual([["add", "walk", "45", "--at", "17:00", "--date", "tomorrow"]]);
    expect(result).toMatchObject({ outcome: "done", reply: "Done for tomorrow: walk 5:00 PM–5:45 PM." });
  });
  it("at 11 tomorrow morning it would sit on CS2100: said, not booked", async () => {
    const { result, writes } = await flow("can u put a 45 min walk tomorrow at 11am");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: "CS2100 Program Design is 11:00 AM–12:30 PM tomorrow, so walk can't go at 11:00 AM. I haven't booked it. Tell me another time." });
  });
  it("at 9 tomorrow is asked about, never guessed", async () => {
    const { result, writes } = await flow("put a walk at 9 tomorrow");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: "Do you mean 9:00 AM or 9:00 PM tomorrow? I haven't booked walk yet." });
  });
  it("today at 5 when it is 22:42 has passed", async () => {
    const { result, writes } = await flow("put a walk at 5");
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: "5:00 PM has already passed (it's 10:42 PM), so I haven't booked walk. Tell me a later time, or say tomorrow." });
  });
  it("a gym added at a time keeps its anchor's 90 minutes", async () => {
    const { writes } = await flow("put gym at 2 tomorrow");
    expect(writes).toEqual([["add", "Gym", "90", "--at", "14:00", "--date", "tomorrow"]]);
  });
});

describe("re-run #8: 'resched my day, gim frist, nvrmind'", () => {
  it("is said back as taken back: no form, no write", async () => {
    const { result, writes } = await flow("resched my day, gim frist, nvrmind");
    expect(writes).toEqual([]);
    expect(result).toEqual({ outcome: "say", kind: "plain", text: TOOK_BACK });
  });
});

describe("moves, extends and removes say exactly why when they cannot", () => {
  const day = (): Day => ({ ...today("15:00"), blocks: [...today("15:00").blocks.slice(0, 3), { title: "Gym", start: "20:15", end: "21:45", fixed: false, kind: "gym" }] });
  const go = (m: string, out = "Changed:\n  Gym moved: 20:15 → 19:00–20:30") => flow(m, { days: { today: day() }, now: new Date(2030, 9, 3, 15, 0), out });
  it("move gym to 7 -> 19:00", async () => { expect((await go("move gym to 7")).writes).toEqual([["move", "Gym", "--to", "19:00"]]); });
  it("push gym back 30 min -> 20:45", async () => { expect((await go("push gym back 30 min")).writes).toEqual([["move", "Gym", "--to", "20:45"]]); });
  it("a class does not move", async () => {
    expect((await go("move econ to 6")).result).toMatchObject({ outcome: "say", text: "ECON1115 Principles of Macroeconomics is a class or a plan with people, so it doesn't move. I haven't changed anything." });
  });
  it("a block that is not there is named", async () => {
    expect((await go("move piano to 6")).result).toMatchObject({ outcome: "say", text: "There's no piano on your day, so I haven't moved anything." });
  });
  it("a block already over says so", async () => {
    const late = await flow("move resume to 9", { days: { today: { ...day(), now: "20:00" } }, now: new Date(2030, 9, 3, 20, 0) });
    expect(late.writes).toEqual([]);
    expect(late.result).toMatchObject({ outcome: "say", text: "Finish resume already ended at 7:20 PM, so I haven't moved it. Say \"add resume\" and when, if you want another one." });
  });
  it("a move onto a class is said, not written", async () => {
    const { result, writes } = await flow("move gym to 2", { days: { today: { ...day(), now: "12:00" } }, now: new Date(2030, 9, 3, 12, 0) });
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", text: "ECON1115 Principles of Macroeconomics is 1:30–3:00 PM, so Gym can't go at 2:00 PM. I haven't moved it. Tell me another time." });
  });
  it("two different blocks by one name is the normal path, never a guess", async () => {
    const two: Day = { ...day(), blocks: [...day().blocks, { title: "CS Lab review", start: "16:00", end: "17:00", fixed: false }] };
    await expect(flow("move lab to 6", { days: { today: two }, now: new Date(2030, 9, 3, 15, 0) })).rejects.toThrow(/form must not be asked/);
  });
  it("extend gym until 10 -> 22:00", async () => { expect((await go("extend gym until 10")).writes).toEqual([["extend", "Gym", "--until", "22:00"]]); });
  it("drop the gym -> drop", async () => { expect((await go("drop the gym")).writes).toEqual([["drop", "Gym"]]); });
  it("cancel econ is a class: the normal path (skip), not this layer", async () => {
    await expect(flow("cancel econ", { days: { today: day() }, now: new Date(2030, 9, 3, 15, 0) })).rejects.toThrow(/form must not be asked/);
  });
});

// ---- through the routing hooks, finalize included: what reaches Nick ----
type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => unknown;
function rig(scheduleFlow: (m: string, c: string, o?: { replanContext?: ReplanAsk }) => Promise<FlowResult>) {
  const handlers = new Map<string, Handler[]>(); let desk = 0; const sessions: string[] = [];
  registerLocalRouting({ on: (n: string, f: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "intent-")), "r.jsonl"),
    brainSearch: async () => "", clock: () => "Tue 22:42", now: () => NOW,
    decideImpl: async () => { desk += 1; return { move: "tool", tool: "session", args: { do: "resume" } }; },
    sessionFlow: async (m) => { sessions.push(m); return { outcome: "done", reply: "Focus session resumed.", calls: ["exec orion-session resume"], outputs: ["ok"] }; },
    scheduleFlow });
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { let last: unknown; for (const f of handlers.get(n) ?? []) last = await f(e, c); return last; };
  const turn = async (message: string, workerSays: string, id: string) => {
    const c = { runId: id, sessionKey: "agent:main:orion-chat-live-r1" };
    await fire("before_model_resolve", { prompt: message }, c);
    await fire("before_prompt_build", { prompt: message, messages: [] }, c);
    const messages = [{ role: "user", content: message }, { role: "assistant", content: [{ type: "text", text: workerSays }] }];
    // The host retries a "revise" with the same worker; the 9B repeats itself (the re-run's pattern), so it is fired again.
    for (let i = 0; i < 3; i += 1) {
      const out = await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: workerSays, model: "m", messages }, c) as { action?: string } | undefined;
      if (out?.action !== "revise") break;
    }
    return (messages[1]!.content as Array<{ text: string }>)[0]!.text;
  };
  return { turn, desk: () => desk, sessions };
}
const real = (m: string, _c: string, o?: { replanContext?: ReplanAsk }) => flow(m, o?.replanContext ? { context: o.replanContext } : {}).then((r) => r.result);

describe("what reaches Nick: code's own line is final (the re-run's generic 'didn't manage')", () => {
  it("#7: the piano practice line is delivered as written, not replaced by the honest fallback", async () => {
    const r = rig(real);
    const said = await r.turn("reschedule tomorrow, put piano practice first", "Piano practice isn't on your day tomorrow, so I haven't changed anything. How many minutes should it be? Say it with the length, like \"piano practice for 30 min\", and I'll put it in.", "p1");
    expect(said).toMatch(/^Piano practice isn't on your day tomorrow/);
    expect(said).not.toMatch(/didn't manage/);
    expect(r.desk()).toBe(0);
  });
  it("#2a then #2b: the follow-up is code's (no desk, no focus-session resume) and names resume", async () => {
    const r = rig(real);
    await r.turn("can u redo tomorrow after my first class, gym first then resume", "Resume isn't on your day tomorrow…", "a1");
    const said = await r.turn("actually do resume before gym", "Focus session resumed.", "a2");
    expect(r.desk()).toBe(0);
    expect(r.sessions).toEqual([]);
    expect(said).toMatch(/^Resume isn't on your day tomorrow/);
  });
  it("#10: the walk reply is the scheduler's, at 5 PM", async () => {
    const r = rig(real);
    expect(await r.turn("can u put a 45 min walk tomorrow at 5", "Done for tomorrow: walk 5:00 PM–5:45 PM.", "w1")).toBe("Done for tomorrow: walk 5:00 PM–5:45 PM.");
    expect(r.desk()).toBe(0);
  });
});
