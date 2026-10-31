// REV2 finding 11 (2026-10-31): "thursday at 9" was booked silently at 9 PM, and "thursday" said on a Thursday went to next week unsaid.
import { describe, expect, it } from "vitest";
import { readDayRequest, runDayRequest } from "./day-requests.js";

const fake = () => { const calls: string[][] = []; return { calls, run: async (s: string, a: string[]) => { calls.push([s, ...a]); return { stdout: "Changed\n  added (fixed) X: 09:00–10:00\nWritten to his calendar.", code: 0 }; } }; };
const friday = new Date(2026, 9, 30, 14, 0);   // Friday 30 Oct 2026
const reply = async (m: string, now = friday) => {
  const f = fake();
  const out = await runDayRequest(readDayRequest(m, now)!, { run: f.run as never, readDay: async () => undefined, now });
  return { calls: f.calls, text: (out.flow as { reply?: string; text?: string }).reply ?? (out.flow as { text: string }).text };
};

describe("finding 11: an ambiguous deadline time follows the 7-11 morning rule and says the guess", () => {
  it.each([["add marketing quiz thursday at 9", "09:00", "9:00 AM"], ["i have an econ midterm monday at 10", "10:00", "10:00 AM"], ["got a quiz wednesday at 8", "08:00", "8:00 AM"]])("%s", async (m, hm, said) => {
    const r = await reply(m);
    expect(r.calls[0]).toEqual(expect.arrayContaining(["--at", hm]));
    expect(r.text).toContain(`(I took`);
    expect(r.text).toContain(said);
  });
  it.each(["add marketing quiz thursday at 2", "i have a midterm monday at 4"])("%s stays PM, no guess needed", async (m) => {
    expect((await reply(m)).text).not.toContain("I took");
  });
  it.each(["add marketing quiz friday at 2pm", "i have a quiz friday at 3pm", "got an exam fri at 1pm"])("%s said on a Friday names next Friday's date", async (m) => {
    const r = await reply(m);
    expect(r.text).toMatch(/next Friday \(6 November\)/);
    expect(r.calls[0]).toEqual(expect.arrayContaining(["--date", "2026-11-06"]));
  });
});
