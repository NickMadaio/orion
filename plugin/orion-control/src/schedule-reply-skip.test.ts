import { describe, expect, it } from "vitest";
import { spokenReply } from "./schedule-reply.js";

// w20 r3 #64: "Done: CS1800 ... — removed from his calendar ... is off today." was third person and false.
describe("skip replies", () => {
  it("a class marked skipped is said in first person and as still on the calendar", () => {
    const out = "Changed Tuesday 2030-10-08:\n  skipped CS1800 Discrete Structures — Lecture 09:00–10:30 — marked skipped in ORION's day record (the event itself stays on the calendar, untouched). That time is free in my plan now.\nWritten. \"orion-reschedule undo\" puts it back. Nobody was emailed or told.";
    const text = spokenReply([out]);
    expect(text).toMatch(/I've marked CS1800 Discrete Structures — Lecture as skipped/);
    expect(text).not.toMatch(/\bhis\b|removed/);
  });
  it("a block I booked comes off in plain words", () => {
    const text = spokenReply(["Changed Tuesday 2030-10-08:\n  removed Call with mum 17:00–17:40 (a block I booked). That time is free now.\nWritten to his calendar. \"orion-reschedule undo\" puts it back."]);
    expect(text).toBe("Done: took Call with mum off your day.");
  });
});
