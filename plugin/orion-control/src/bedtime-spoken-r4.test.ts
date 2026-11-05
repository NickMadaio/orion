// w20 round 4 (live gate 2): every spoken way of saying a bedtime reads as the right clock, and "back to normal" in his words is a reset.
import { describe, expect, it } from "vitest";
import { readBedtimeChange as r } from "./bedtime-read.js";

const time = (s: string): string | undefined => { const c = r(s); return c && "time" in c ? c.time : undefined; };

describe("spoken bedtime clock table", () => {
  const table: Array<[string, string]> = [
    ["im heading to bed at ten to twelve", "23:50"],
    ["bed at ten to 12", "23:50"],
    ["bedtime is ten to midnight", "23:50"],
    ["going to bed at five to twelve", "23:55"],
    ["bedtime is twenty to twelve", "23:40"],
    ["bed at quarter to twelve", "23:45"],
    ["bedtime quarter to midnight", "23:45"],
    ["bed at quarter to 11", "22:45"],
    ["going to bed at twenty five to twelve", "23:35"],
    ["bedtime is ten to one", "00:50"],
    ["bed at quarter to 1", "00:45"],
    ["bed at twenty past 11", "23:20"],
    ["bedtime is twenty past eleven", "23:20"],
    ["bed at quarter past 11", "23:15"],
    ["bedtime five past midnight", "00:05"],
    ["bedtime at ten past midnight", "00:10"],
    ["bed at half past 11", "23:30"],
    ["bed at half 11", "23:30"],
    ["going to bed at half twelve", "00:30"],
    ["bedtime 11 45", "23:45"],
    ["bedtime 11.45", "23:45"],
    ["bed at 11 45 tonight", "23:45"],
    ["bedtime eleven forty five", "23:45"],
    ["bedtime is eleven fifteen", "23:15"],
    ["bedtime at midnight", "00:00"],
    ["bedtime tonight is midnight", "00:00"],
    ["make bedtime midnight", "00:00"],
    ["bedtime 12", "00:00"],
    ["going to bed at 12 tonight", "00:00"],
    ["bedtime at 12 at night", "00:00"],
    ["bedtime 12am", "00:00"],
    ["bed at ten to 12 am", "23:50"],
    ["bed at twenty to 11 pm", "22:40"],
  ];
  it.each(table)("%s", (said, expected) => { expect(time(said)).toBe(expected); });

  it("ten to X is never X minus two hours, and a lone minute count is not a clock", () => {
    expect(time("im heading to bed at ten to twelve")).not.toBe("22:00");
    expect(r("push bedtime back 10 min")).toEqual({ shift: 10, scope: "tonight" });
    expect(r("move my bedtime up twenty minutes")).toEqual({ shift: -20, scope: "tonight" });
  });
  it("scope words still apply to the new forms", () => {
    expect(r("bedtime every night is quarter past 11 from now on")).toEqual({ time: "23:15", scope: "always" });
    expect(r("actually make my bedtime half 11 every night")).toEqual({ time: "23:30", scope: "always" });
    expect(r("bedtime tonight is midnight")).toEqual({ time: "00:00", scope: "tonight" });
  });
});

describe("back to normal in his words is a reset, never a time", () => {
  const phrases = [
    "clear my bedtime back to normal", "clear bedtime", "clear my bedtime", "reset my bedtime please", "reset bedtime", "reset my bed time",
    "stop using a fixed bedtime, go back to working it out from my alarm", "go back to working out my bedtime from my alarm",
    "stop using a fixed bedtime", "unfix my bedtime", "bedtime back to automatic", "work my bedtime out from my alarm again",
    "drop the fixed bedtime", "go back to the computed bedtime", "just work out bedtime from my wake up again pls",
  ];
  it.each(phrases)("%s", (said) => { expect(r(said)).toEqual({ reset: true, scope: "always" }); });
  it("a wake question or an alarm set is not a reset", () => {
    expect(r("whats my bedtime")).toBeUndefined();
    expect(r("set my alarm for 7")).toBeUndefined();
    expect(r("clear my alarm")).toBeUndefined();
    expect(r("cancel the 7am alarm")).toBeUndefined();
  });
});
