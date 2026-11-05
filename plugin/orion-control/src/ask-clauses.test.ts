import { describe, expect, it } from "vitest";
import { clausesOf, takeClause, REMINDER_START } from "./ask-clauses.js";
import { timerSeconds } from "./tool-moves.js";

const texts = (m: string) => clausesOf(m).map((c) => c.text);
describe("clausesOf", () => {
  it("splits four asks", () => {
    expect(texts("open the mouse mapper and whats the weather tomorrow then set a 10 min timer and remind me at 5 to eat")).toEqual(["open the mouse mapper", "whats the weather tomorrow", "set a 10 min timer", "remind me at 5 to eat"]);
  });
  it("keeps a reminder's own words together", () => {
    expect(texts("remind me at 5 to ring the vet and cancel the old appointment")).toEqual(["remind me at 5 to ring the vet and cancel the old appointment"]);
    expect(texts("remind me at 5 to call mum, send her the report")).toHaveLength(1);
    expect(texts("remind me at 5 to buy pasta and put pasta prep in at 6pm")).toHaveLength(1);
  });
  it("ends a reminder at a sentence break, also or then, or a question", () => {
    expect(texts("remind me at 5 to buy pasta. put pasta prep in at 6pm")).toEqual(["remind me at 5 to buy pasta", "put pasta prep in at 6pm"]);
    expect(texts("remind me at 5 to eat, then open notes")).toEqual(["remind me at 5 to eat", "open notes"]);
    expect(texts("remind me at 5 to eat and whats the weather")).toEqual(["remind me at 5 to eat", "whats the weather"]);
  });
  it("food names with and stay whole", () => {
    expect(texts("set a 10 min timer for mac and cheese")).toEqual(["set a 10 min timer for mac and cheese"]);
  });
  it("takeClause removes it from the front, middle and end", () => {
    const isTimer = (c: string) => timerSeconds(c) !== undefined;
    expect(takeClause("set a 10 min timer and open notes", isTimer)).toEqual({ clause: "set a 10 min timer", rest: "open notes" });
    expect(takeClause("open notes and set a 10 min timer", isTimer)).toEqual({ clause: "set a 10 min timer", rest: "open notes" });
    expect(takeClause("open notes, set a 10 min timer, then tell me the time", isTimer)).toEqual({ clause: "set a 10 min timer", rest: "open notes, then tell me the time" });
    expect(takeClause("set a 10 min timer", isTimer)).toBeUndefined();
    expect(REMINDER_START.test("and remind me at 5")).toBe(true);
  });
});
