import { describe, expect, it } from "vitest";
import { readBedtimeChange as r } from "./bedtime-read.js";

describe("readBedtimeChange, in his phrasing", () => {
  it("L1: push my bedtime to, um, eleven forty five", () => {
    expect(r("push my bedtime to, um, eleven forty five")).toEqual({ time: "23:45", scope: "tonight" });
    expect(r("Push my bedtime to eleven forty five pm")).toEqual({ time: "23:45", scope: "tonight" });
  });
  it("a plain set is every night; tonight and from-now-on words override", () => {
    expect(r("make my bedtime 11:30 pm")).toEqual({ time: "23:30", scope: "always" });
    expect(r("change my bed time to 11")).toEqual({ time: "23:00", scope: "always" });
    expect(r("from now on bedtime 11")).toEqual({ time: "23:00", scope: "always" });
    expect(r("set my bedtime to 12 tonight")).toEqual({ time: "00:00", scope: "tonight" });
    expect(r("change my bedtim to 12:30 from now on")).toEqual({ time: "00:30", scope: "always" });
  });
  it("spoken forms", () => {
    expect(r("bed at quarter to 12")).toEqual({ time: "23:45", scope: "always" });
    expect(r("set bedtime for half eleven")).toEqual({ time: "23:30", scope: "always" });
    expect(r("i want to sleep at 11 tonight")).toEqual({ time: "23:00", scope: "tonight" });
    expect(r("i wanna go to bed at one tonight")).toBeUndefined();   // a lone "one" is a word; the model asks
    expect(r("i wanna go to bed at 1 tonight")).toEqual({ time: "01:00", scope: "tonight" });
  });
  it("shifts", () => {
    expect(r("push bedtime back 30 min")).toEqual({ shift: 30, scope: "tonight" });
    expect(r("move my bedtime up half an hour")).toEqual({ shift: -30, scope: "tonight" });
    expect(r("bedtime later pls")).toEqual({ shift: 30, scope: "tonight" });
    expect(r("push my bedtime back an hour from now on")).toEqual({ shift: 60, scope: "always" });
    expect(r("bump bedtime earlier by 20 mins")).toEqual({ shift: -20, scope: "tonight" });
  });
  it("is not a bedtime change", () => {
    for (const s of ["what's my bedtime", "when is bedtime", "im going to bed at 11", "wake me at half 6 tomorrow", "i dont want a bedtime", "push my alarm to 7", "bedtime earlier", "i wanna sleep earlier this week", "push my bedtime to 6"]) expect(r(s)).toBeUndefined();
  });
});
