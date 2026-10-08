import { describe, expect, it } from "vitest";
import { rainPhrase } from "./ambient.js";

// Regression, 2026-10-08: asked "is it gonna rain?", ORION said "maybe light
// drizzle"; asked "what time?", the forecast it had carried no times at all.
describe("rainPhrase", () => {
  it("names the hours and the peak chance", () => {
    expect(rainPhrase([{ at: "2 PM", chance: 40 }, { at: "3 PM", chance: 70 }, { at: "4 PM", chance: 55 }])).toBe("rain likely 2 PM to 4 PM (up to 70%)");
    expect(rainPhrase([{ at: "3 PM", chance: 35 }])).toBe("rain possible around 3 PM (up to 35%)");
  });
  it("says when it's only a slight chance, and when there's none", () => {
    expect(rainPhrase([{ at: "3 PM", chance: 20 }])).toBe("only a slight chance of rain (up to 20%)");
    expect(rainPhrase([])).toBe("no rain expected");
  });
});
