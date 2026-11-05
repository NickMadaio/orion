import { describe, expect, it } from "vitest";
import { normalizeSpoken as n } from "./spoken-numbers.js";

describe("normalizeSpoken (one normaliser ahead of every parser)", () => {
  it("buttons and function keys", () => {
    expect(n("can you set the button six part of the mouse to f thirteen")).toBe("can you set the button 6 part of the mouse to f13");
    expect(n("map button number four to f-twelve")).toBe("map button 4 to f12");
    expect(n("put it on f 13")).toBe("put it on f13");
  });
  it("clock times, with and without am/pm", () => {
    expect(n("im going to bed at eleven forty five")).toBe("im going to bed at 11:45");
    expect(n("wake me up at six thirty am")).toBe("wake me up at 6:30am");
    expect(n("gym from ten to eleven pm")).toBe("gym from 10 to 11pm");
    expect(n("half past seven")).toBe("7:30");
    expect(n("quarter to eight pm")).toBe("7:45pm");
    expect(n("bed at quarter to 12")).toBe("bed at 11:45");
    expect(n("wake me at half 6 tomorrow")).toBe("wake me at 6:30 tomorrow");
    expect(n("at half six")).toBe("at 6:30");
    expect(n("meet at six oclock")).toBe("meet at 6");
    expect(n("alarm for seven oh five")).toBe("alarm for 7:05");
  });
  it("counts before a unit", () => {
    expect(n("set a timer for twenty five minutes")).toBe("set a timer for 25 minutes");
    expect(n("did three sets of ten reps")).toBe("did 3 sets of 10 reps");
  });
  it("leaves ordinary words alone", () => {
    for (const s of ["one more thing", "for one", "i have two of them", "at one point i was fine", "to three people", "for two hours", "thats one way to do it", "what is f", "ten out of ten", "i ate six"]) {
      expect(n(s)).toBe(s.replace("for two hours", "for 2 hours"));
    }
  });
  it("is a no-op on digits and empty text", () => {
    expect(n("button 6 to f13 at 11:45")).toBe("button 6 to f13 at 11:45");
    expect(n("")).toBe("");
  });
});
