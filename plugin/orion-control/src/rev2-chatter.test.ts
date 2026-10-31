// REV2 finding 5 (2026-10-31): requests in his casual register were silenced as room talk ("dude remind me to call mom at 5"), a request
// with a goodbye in it was silenced ("turn off the lights, bye"), and inside a room streak his status lines were silenced too.
import { describe, expect, it } from "vitest";
import { roomTalk } from "./chatter.js";

const spoken = (m: string, streak = false) => roomTalk(m, { spoken: true, streak });
describe("finding 5: a request in his casual register is still a request", () => {
  it.each(["dude remind me to call mom at 5", "bro whats the weather", "move gym to 7, man", "man im so tired, fix my day",
    "remind me to call you back tomorrow", "set a timer for 10, see you then", "turn off the lights, bye", "yo dude can you start a focus session",
    "mate whats on my calendar"])("no streak: %s is heard", (m) => {
    expect(spoken(m)).toBeNull();
  });
  it.each(["im running late", "gym done", "im sick", "i slept badly, fix my day", "i have a quiz thursday at 2", "fix my schedule",
    "i need to leave at 5", "running 15 late", "dude im so tired"])("inside a streak: %s goes through as a request", (m) => {
    expect(spoken(m, true)).toBe("streak");
  });
  it.each(["ok love you bye", "i can call you back on sunday probably", "yeah mom im fine, uni is good", "ok dad yeah ill text you later",
    "say hi to grandma for me"])("someone else on the line stays silent: %s", (m) => {
    expect(spoken(m)).toBe("room");
  });
  it.each(["no thats wrong, ugh", "wait no hold on its the other one"])("thinking aloud inside a streak stays silent: %s", (m) => {
    expect(spoken(m, true)).toBe("room");
  });
  it.each(["man i want to kill myself", "i cant do this anymore, bye", "i want to kill myself, said the knight"])("a crisis signal is never room talk: %s", (m) => {
    expect(spoken(m)).toBeNull();
    expect(spoken(m, true)).toBeNull();
  });
});
