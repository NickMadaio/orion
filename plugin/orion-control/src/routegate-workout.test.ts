import { describe, expect, it } from "vitest";
import { readWorkoutTurn, type WorkoutContext } from "./workout-read.js";

const ctx = (extra: Partial<WorkoutContext> = {}): WorkoutContext => ({ now: new Date("2026-11-04T20:00:00Z"), ...extra });
const pending = { at: Date.parse("2026-11-04T19:50:00Z"), asked: 1, question: "What did you do?" };

describe("workout route needs a past-tense signal and never takes a calendar ask", () => {
  it("E4 / E17: putting gym on the calendar is not a workout", () => {
    for (const s of ["Put an hour gym session at 10-11 for me", "Add gym from 10pm to 11pm.", "add gym at ten tonight", "can you put gym at 10 to 11 thanks", "schedule a gym session for 7am"]) {
      expect(readWorkoutTurn(s, ctx())).toBeNull();
    }
  });
  it("E10: a scheduling add never binds to the pending workout question", () => {
    const c = ctx({ pending, bound: true });
    expect(readWorkoutTurn("Okay, now add marketing gallery from 7-9:30pm. Then gym from 10-11. Push sleep to 11:45", c)).toBeNull();
    expect(readWorkoutTurn("add gym at 10-11", c)).toBeNull();
  });
  it("a bare 'add gym' with no past signal is not a log either", () => {
    expect(readWorkoutTurn("add gym", ctx())).toBeNull();
    expect(readWorkoutTurn("add gym tomorrow", ctx())).toBeNull();
  });
  it("what he did still logs", () => {
    expect(readWorkoutTurn("just did legs, squats 4x6 at 185", ctx())?.kind).toBe("describe");
    expect(readWorkoutTurn("went to the gym at 10 this morning, did push", ctx())?.kind).toBe("describe");
    expect(readWorkoutTurn("log my workout: bench 3x8 at 135", ctx())?.kind).toBe("describe");
    expect(readWorkoutTurn("i did gym from 10 to 11 earlier, mostly back", ctx())?.kind).toBe("describe");
  });
  it("his answer to the follow-up still binds", () => {
    expect(readWorkoutTurn("55 min and 185 on squats", ctx({ pending, bound: true }))?.kind).toBe("answer");
  });
  it("spoken numbers in an answer", () => {
    expect(readWorkoutTurn("just did legs, three sets of ten on squats", ctx())?.kind).toBe("describe");
  });
});
