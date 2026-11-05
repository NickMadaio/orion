// w20 sched: steps that name their own block each run even when an earlier one refused; the form prompt has no number to copy.
import { describe, expect, it } from "vitest";
import { FORM_PROMPT, runScheduleFlow, type Day, type Intent } from "./schedule-flow.js";

const day: Day = { date: "2030-10-03", now: "19:57", blocks: [{ title: "Seminar", start: "09:00", end: "10:30", fixed: true }] };

async function run(steps: Intent[]) {
  const calls: string[][] = [];
  const result = await runScheduleFlow({ message: "add pottery 7-9:30 then gym 10-11", clock: "Thu 19:57",
    exec: async (args) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify(day), code: 0 } : args[1] === "Pottery" ? { stdout: "NOTHING WAS CHANGED: Pottery at 19:00 has already started (it is 19:57).", code: 1 } : { stdout: "Changed Thursday 2030-10-03:\n  added Gym: 22:00–23:00\nWritten to his calendar.", code: 0 }; },
    ask: async () => ({ steps }) });
  return { result, adds: calls.filter((c) => c[0] === "add") };
}

describe("a refused step does not stop a separate one", () => {
  it("pottery refused, gym still added", async () => {
    const { adds } = await run([{ do: "add", what: "Pottery", to: "19:00", until: "21:30" }, { do: "add", what: "Gym", to: "22:00", until: "23:00" }]);
    expect(adds.map((a) => a[1])).toEqual(["Pottery", "Gym"]);
  });
});

describe("form prompt", () => {
  it("does not hand the model a number of minutes to copy for 'late'", () => {
    expect(FORM_PROMPT).not.toMatch(/"do":"late","minutes":15/);
    expect(FORM_PROMPT).toMatch(/"minutes":<N>/);
  });
});
