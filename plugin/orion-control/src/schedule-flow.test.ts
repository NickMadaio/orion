import { describe, expect, it } from "vitest";
import { blockList, compile, intentSchema, runScheduleFlow, setPlaces, spokenReply, summarize, type Day } from "./schedule-flow.js";

// His real Monday, 2026-10-12, at 13:06 (DS already happened).
const monday: Day = {
  date: "2026-10-12", now: "13:06",
  blocks: [
    { title: "CS2100 Program Design & Implementation 1 — Lecture", start: "09:00", end: "10:30", fixed: true },
    { title: "CS1800 Discrete Structures — Lecture", start: "11:00", end: "12:30", fixed: true },
    { title: "CS2101 Lab for Program Design & Implementation 1", start: "15:30", end: "17:10", fixed: true },
    { title: "do cert courses", start: "17:50", end: "21:50", fixed: false },
  ],
};

describe("schedule flow", () => {
  it("numbers the whole day, marking fixed and already-happened blocks", () => {
    const list = blockList(monday);
    expect(list).toMatch(/^B1 09:00–10:30 CS2100 .* \(FIXED\) \(already happened\)$/m);
    expect(list).toMatch(/^B3 15:30–17:10 CS2101 .* \(FIXED\)$/m);
  });

  it("block references can only be today's real ids", () => {
    const schema = intentSchema(monday) as any;
    expect(schema.properties.steps.items.properties.after.enum).toEqual(["B1", "B2", "B3", "B4"]);
  });

  it("'cert courses the entire time between DS and the lab' compiles to one exact move — start from now when DS is over, end 5 before the lab", () => {
    expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, monday)).toEqual({ args: ["move", "do cert courses", "--to", "13:10", "--until", "15:25"] });
    const morning = { ...monday, now: "08:00" };
    expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
    // "cert courses" names the block already there, so it moves rather than duplicating it.
    expect(compile({ do: "fill_between", what: "cert courses", after: "B2", before: "B3" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
    expect(compile({ do: "fill_between", what: "gym", after: "B2", before: "B3" }, morning)).toEqual({ args: ["add", "gym", "170", "--at", "12:35", "--before", "15:30"] });
  });

  it("refuses what it cannot compile instead of guessing, and says no when there is no room", () => {
    expect(compile({ do: "fill_between", what: "B4", after: "B9", before: "B3" }, monday)).toMatchObject({ error: expect.any(String) });
    expect(compile({ do: "drop", what: "B1" }, monday)).toMatchObject({ error: expect.stringMatching(/movable|does not move/) });
    const late = { ...monday, now: "15:20" };
    expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, late)).toMatchObject({ say: "cannot" });
  });

  it("titles with & are passed as one argv item (no shell), so they reach the scheduler intact", () => {
    expect(compile({ do: "swap", what: "B4", with: "B3" }, monday)).toEqual({ args: ["swap", "do cert courses", "CS2101 Lab for Program Design & Implementation 1"] });
  });

  it("the reply comes only from what the scheduler printed", () => {
    expect(summarize(["Changed Monday 2026-10-12:\n  do cert courses moved: 17:50 → 13:10–15:25\nWritten to his calendar."], []).reply).toBe("do cert courses moved: 17:50 → 13:10–15:25");
    expect(summarize(["NOTHING WAS CHANGED: do cert courses would run 12:35–08:55, which is not a real block"], []).changed).toBe(false);
  });

  it("a move from one block's end to another's start is treated as fill_between (buffers added)", () => {
    const morning = { ...monday, now: "08:00" };
    expect(compile({ do: "move", what: "B4", to: "12:30", until: "15:30" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
    expect(compile({ do: "move", what: "B4", to: "13:00", until: "14:00" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "13:00", "--until", "14:00"] });
  });

  it("adding something already on his day is refused (drop + add of the same block is a move)", () => {
    expect(compile({ do: "add", what: "cert courses", minutes: 240 }, monday)).toMatchObject({ error: expect.stringMatching(/move it/) });
  });

  it("runs the fixed sequence: read the day, one form, exact argv to the scheduler; falls back on anything it cannot compile", async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify({ ...monday, now: "08:00" }), code: 0 } : { stdout: "Changed Monday:\n  do cert courses moved: 17:50 → 12:35–15:25\nWritten to his calendar.", code: 0 }; };
    const done = await runScheduleFlow({ message: "cert courses between DS and the lab", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "fill_between", what: "B4", after: "B2", before: "B3" }] }) });
    expect(done).toMatchObject({ outcome: "done" });
    expect(calls[1]).toEqual(["move", "do cert courses", "--to", "12:35", "--until", "15:25"]);
    expect(await runScheduleFlow({ message: "x", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "fill_between", what: "B4", after: "B9", before: "B3" }] }) })).toMatchObject({ outcome: "fallback" });
    expect(await runScheduleFlow({ message: "x", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "cannot", text: "no room" }] }) })).toEqual({ outcome: "say", text: "no room", kind: "cannot" });
    expect(await runScheduleFlow({ message: "move it tomorrow", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "move", what: "B4", to: "18:00" }] }) })).toMatchObject({ outcome: "done" });
    expect(calls.at(-1)).toEqual(["move", "do cert courses", "--to", "18:00", "--date", "tomorrow"]);
  });

  it("rejects block ids that do not exist, anchors used as the thing to place, and moving a class", () => {
    const today = { ...monday, blocks: monday.blocks.slice(0, 3) }; // no cert courses block today
    expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, today)).toMatchObject({ error: expect.stringMatching(/not a block/) });
    expect(compile({ do: "fill_between", what: "B3", after: "B2", before: "B3" }, today)).toMatchObject({ error: expect.any(String) });
    expect(compile({ do: "move", what: "B3", to: "13:15", until: "15:25" }, today)).toMatchObject({ error: expect.stringMatching(/does not move/) });
    expect(compile({ do: "fill_between", what: "cert courses", after: "B2", before: "B3" }, { ...today, now: "13:14" })).toEqual({ args: ["add", "cert courses", "130", "--at", "13:15", "--before", "15:30"] });
  });

  it("a form that breaks a rule gets one correction round with the rule it broke", async () => {
    const exec = async (args: string[]) => (args[0] === "show" ? { stdout: JSON.stringify({ ...monday, now: "08:00" }), code: 0 } : { stdout: "Changed:\n  do cert courses moved: 17:50 → 12:35–15:25", code: 0 });
    const asked: string[] = [];
    const answers = [{ steps: [{ do: "move" as const, what: "B3", to: "13:00" }] }, { steps: [{ do: "fill_between" as const, what: "B4", after: "B2", before: "B3" }] }];
    const result = await runScheduleFlow({ message: "cert courses between DS and lab", clock: "Mon 08:00", exec, ask: async (_s, user) => { asked.push(user); return answers[asked.length - 1] ?? null; } });
    expect(asked[1]).toMatch(/broke a rule: .*does not move/);
    expect(result).toMatchObject({ outcome: "done" });
  });

  it("'after my lab I'm going to Spit, 15 min commute, then four things' — commute invisible, first thing at arrival", () => {
    const day = { ...monday, now: "13:30" };
    expect(compile({ do: "plan", after: "B3", where: "Spit", travel: 15, items: [{ title: "go over marketing presentation", minutes: 45 }, { title: "student oyster card", minutes: 15 }, { title: "research backpacking stuff" }, { title: "practice leetcode", minutes: 60 }] }, day))
      .toEqual({ args: ["day", "--plan", "go over marketing presentation, 45, 17:25", "--plan", "student oyster card, 15", "--plan", "research backpacking stuff, 45", "--plan", "practice leetcode, 60"] });
    // No commute stated: a known place's travel time is used; unknown → just his 5-minute buffer.
    setPlaces({ spitalfields: 15 });
    expect(compile({ do: "plan", after: "B3", where: "Chapter Spitalfields", items: [{ title: "leetcode", minutes: 60 }] }, day)).toEqual({ args: ["day", "--plan", "leetcode, 60, 17:25"] });
    expect(compile({ do: "plan", after: "B3", where: "somewhere new", items: [{ title: "leetcode", minutes: 60 }] }, day)).toEqual({ args: ["day", "--plan", "leetcode, 60, 17:15"] });
    expect(compile({ do: "plan", after: "B3", items: [] }, day)).toMatchObject({ error: expect.any(String) });
  });

  it("the spoken reply is built from the scheduler's lines, in order, with 12-hour times", () => {
    const out = "Changed Monday 2026-10-12:\n  rebuilt the remaining day\n  planned go over my marketing presentation: 17:15–18:00\n  planned practice leet code: 19:15–20:15";
    expect(spokenReply([out])).toBe("Done: go over my marketing presentation 5:15 PM–6:00 PM; practice leet code 7:15 PM–8:15 PM.");
    expect(spokenReply(["Changed:\n  do cert courses moved: 17:50 → 12:35–15:25"])).toBe("Done: do cert courses now 12:35 PM–3:25 PM.");
    expect(spokenReply(["NOTHING WAS CHANGED: moving it would break the day rules — overlaps Macro"])).toMatch(/^Not done: moving it would break/);
  });

  it("'clear my schedule after the lab' compiles to drop --after the lab", () => {
    expect(compile({ do: "clear_after", after: "B3" }, monday)).toEqual({ args: ["drop", "--after", "CS2101 Lab for Program Design & Implementation 1"] });
  });
});
