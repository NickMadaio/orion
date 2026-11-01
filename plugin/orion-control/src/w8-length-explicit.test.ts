// Wave 8 review fix 1: `--length-explicit` is passed only when the length came from Nick's own words. A defaulted length keeps his
// saved minimums (orion-life min nap 75), so "move nap to 3pm" with no nap on the day is not booked at the 30 min default.
import { describe, expect, it } from "vitest";
import { unnamedAnchorWrite } from "./anchor-write-guard.js";
import { runScheduleFlow, type Day } from "./schedule-flow.js";
import { readDayRequest, runDayRequest } from "./day-requests.js";

const NOW = new Date(2030, 9, 21, 8, 0);
const sparse = (): Day => ({ date: "2030-10-21", now: "08:00", plan: { commuteMinutes: 0, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [] });

async function flow(message: string, extra: { lengthDefaulted?: boolean } = {}) {
  const writes: string[][] = [];
  await runScheduleFlow({ message, clock: "Mon 08:00", now: NOW, ...extra, ask: async () => { throw new Error("no ask"); },
    exec: async (a) => { if (a[0] !== "show") writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(sparse()) : "Changed Monday 2030-10-21:\n  added Nap 15:00–16:15", code: 0 }; } });
  return writes;
}

describe("--length-explicit only where the length is his words", () => {
  it.each(["add a 30 min nap at 3pm", "book a 20 min nap at 4pm", "put a 45 min walk at 5pm"])("stated: %s", async (m) => {
    const w = await flow(m);
    expect(w[0]?.[0]).toBe("add");
    expect(w[0]).toContain("--length-explicit");
  });
  it("owned move-add with no length keeps minimums (no flag)", async () => {
    const w = await flow("move nap to 3pm");
    expect(w[0]).toEqual(["add", "nap", "30", "--at", "15:00"]);
  });
  it("owned move-add of gym uses its default 90 with no flag", async () => {
    expect((await flow("move gym to 5pm"))[0]).toEqual(["add", "Gym", "90", "--at", "17:00"]);
  });
  it("a length ORION defaulted in the message (lengthDefaulted) carries no flag", async () => {
    const w = await flow("add a 30 min nap at 3pm", { lengthDefaulted: true });
    expect(w[0]).not.toContain("--length-explicit");
  });
  it("'put X from now until T' (his own end time) is explicit", async () => {
    const w = await flow("put a nap from now until 9am");
    expect(w[0]?.[0]).toBe("add");
    expect(w[0]).toContain("--length-explicit");
  });
  it("the worker write guard accepts the flag on add", () => {
    const blocks = [{ title: "Gym", start: "18:00", end: "19:30", fixed: false, kind: "gym" }];
    expect(unnamedAnchorWrite("add a 30 min nap at 3pm", ["add", "Nap", "30", "--at", "15:00", "--length-explicit"], blocks)).toBeNull();
  });
});

describe("day requests: the length he said is explicit, the defaulted one is not", () => {
  const b = (title: string, start: string, end: string) => ({ title, start, end, fixed: false });
  const at = new Date(2026, 10, 2, 21, 0);
  const ask = async (said: string) => {
    const r = readDayRequest(said, at)!;
    const calls: string[][] = [];
    await runDayRequest(r, { now: at, readDay: async () => ({ date: "2026-11-02", now: "21:00", blocks: [b("Gym", "17:00", "18:30")] }), readDayOn: async () => ({ date: "2026-11-03", now: null, blocks: [] }),
      run: async (_s, args) => { calls.push(args); return { stdout: "Changed Tuesday 2026-11-03:\n  added resume 10:00–10:45", code: 0 }; } });
    return calls[0];
  };
  it.each(["move finish resume to tomorrow at 10am, 45 min", "push reading to tomorrow morning for 20 min"])("said: %s", async (m) => expect(await ask(m)).toContain("--length-explicit"));
  it.each(["ill do the resume tomorrow", "gonna do my reading tmrw morning"])("defaulted: %s", async (m) => expect((await ask(m))).not.toContain("--length-explicit"));
});
