import { describe, expect, it } from "vitest";
import { isCrisis, isOverwhelmed } from "./distress.js";

describe("distress detection", () => {
  it("catches words that may mean he is not safe", () => {
    for (const m of ["i literally cant do this anymore", "I can’t take it any more", "i want to die", "thinking about killing myself", "i just want to end it all", "i keep hurting myself", "everything feels hopeless", "i can't go on like this", "i feel so hopeless", "im hopeless", "life is hopeless"])
      expect(isCrisis(m), m).toBe(true);
  });

  it("leaves ordinary requests alone", () => {
    for (const m of ["I can't do this task today, move it to tomorrow", "end it at 5", "end the focus session", "kill the lights", "i can't go on Friday, move it", "this lecture is killing me lol", "cancel it, I can't make it", "this code is hopeless", "the wifi here is hopeless lol"])
      expect(isCrisis(m), m).toBe(false);
  });

  it("softer overwhelm is not a crisis and not a request", () => {
    expect(isOverwhelmed("im so overwhelmed i dont even know where to start")).toBe(true);
    expect(isOverwhelmed("i'm so stressed out about midterms")).toBe(true);
    expect(isOverwhelmed("start a focus session")).toBe(false);
    expect(isOverwhelmed("i cant do this anymore, im overwhelmed")).toBe(false); // a crisis, handled first
  });
});
