import { describe, expect, it } from "vitest";
import { isCrisis, isOverwhelmed } from "./distress.js";

describe("distress detection", () => {
  it("catches words that may mean he is not safe", () => {
    for (const m of ["i literally cant do this anymore", "I can’t take it any more", "i want to die", "thinking about killing myself", "i just want to end it all", "i keep hurting myself", "everything feels hopeless", "i can't go on like this", "i feel so hopeless", "im hopeless", "life is hopeless", "i dont want to be alive anymore", "i don't want to wake up tomorrow", "kms", "whats the point of anything", "i want to unalive myself", "im going to die"])
      expect(isCrisis(m), m).toBe(true);
  });

  it("still catches the plain forms after the 2026-10-16 narrowing", () => {
    for (const m of ["i dont want to wake up tomorrow", "i don't want to be here anymore", "i dont want to live anymore", "i feel hopeless", "kms", "i want to kill myself", "thinking about suicide", "what's the point of anything", "i don't want to live like this anymore", "i dont want to be here, i'm done", "i don't want to wake up ever again", "i dont want to be here anymore honestly", "i don't want to live, i'm so tired", "i really dont want to wake up tomorrow"])
      expect(isCrisis(m), m).toBe(true);
  });

  it("does not mistake idioms and ordinary plans for a crisis (review HIGH 5)", () => {
    for (const m of ["i dont want to wake up at 6 tomorrow, push my alarm to 8", "i don't want to be here for the 9am standup", "i dont want to live in london forever", "i'm a hopeless romantic", "add suicide squad to my watchlist", "i dont want to be here when he arrives", "i want to die laughing at this meme lol"])
      expect(isCrisis(m), m).toBe(false);
  });

  it("catches the common phrasings added in round 6 (2026-10-16)", () => {
    for (const m of ["i dont wanna live anymore", "i dont wanna be alive", "i wish i was dead", "i wish i were dead", "i want to sleep and never wake up", "nobody would miss me", "no one would miss me", "i'm thinking of ending it", "i'm thinking about ending it all", "i don't want to exist anymore", "i want it all to end", "i want to disappear", "i just wanna disappear forever", "i dont wanna wake up tomorrow", "im gonna end it"])
      expect(isCrisis(m), m).toBe(true);
  });

  it("keeps round 6 idioms clear", () => {
    for (const m of ["make my alarm louder, i never wake up to it", "i never wake up on time", "i'm going to end it here for today", "gonna end it early", "nobody will miss me if i skip the party", "i want to disappear into my bed for a nap lol", "ending it with a bang", "the movie was ending", "end it at 5", "i'm thinking of ending it with him on friday", "i want this meeting to end"])
      expect(isCrisis(m), m).toBe(false);
  });

  it("leaves ordinary requests alone", () => {
    for (const m of ["I can't do this task today, move it to tomorrow", "end it at 5", "end the focus session", "kill the lights", "i can't go on Friday, move it", "this lecture is killing me lol", "cancel it, I can't make it", "this code is hopeless", "the wifi here is hopeless lol", "my laptop is going to die, remind me to charge it at 9", "my phone's going to die", "i hurt myself at the gym, cancel my run today", "I'm going to die if I miss this bus lol", "im hopeless at cooking", "whats the point of this meeting"])
      expect(isCrisis(m), m).toBe(false);
  });

  it("softer overwhelm is not a crisis and not a request", () => {
    expect(isOverwhelmed("im so overwhelmed i dont even know where to start")).toBe(true);
    expect(isOverwhelmed("i'm so stressed out about midterms")).toBe(true);
    expect(isOverwhelmed("start a focus session")).toBe(false);
    expect(isOverwhelmed("i cant do this anymore, im overwhelmed")).toBe(false); // a crisis, handled first
  });
});
