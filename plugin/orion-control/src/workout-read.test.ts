// w17 g-workout: which turns are a workout he did, which reply answers the follow-up, and which things that sound close are not. Held-out
// phrasings in his style (lowercase, typos, run-ons); none copied from the gate scenarios.
import { describe, expect, it } from "vitest";
import { readWorkoutTurn, type WorkoutContext } from "./workout-read.js";

const NOW = new Date(2026, 10, 3, 18, 0);
const ctx = (extra: Partial<WorkoutContext> = {}): WorkoutContext => ({ now: NOW, ...extra });
const WAITING = { at: NOW.getTime() - 60_000, asked: 1, question: "Nice. Roughly how long was it, and what weight on the squats?" };
const bound = ctx({ pending: WAITING, bound: true });

describe("a workout he describes", () => {
  it.each([
    "just did legs. squats 4x6 at 185 rdl 3x8 135 and leg press 3x12",
    "did push day, bench 3x8 at 135, incline db 3x10 w 50s, then 20 min on the stairmaster",
    "log my workout: chest and tris, bench 4x8 at 155, pushdowns 3x12",
    "went for a 3 mile run",
    "worked out today",
    "just got back from the gym lol did back and biceps",
    "ran 5k this morning in like 28 mins",
    "hit the gym earlier, shoulders",
    "played basketball for an hour",
    "log workout",
    "went to the gym yesterday and did legs",
  ])("%s", (text) => {
    expect(readWorkoutTurn(text, ctx())).toMatchObject({ kind: "describe" });
  });
  it("'log my workout: …' sends only the description, and a bare 'log workout' still starts the flow", () => {
    expect(readWorkoutTurn("log my workout: chest and tris, bench 4x8 at 155", ctx())).toEqual({ kind: "describe", text: "chest and tris, bench 4x8 at 155" });
    expect(readWorkoutTurn("log workout", ctx())).toEqual({ kind: "describe", text: "workout" });
  });
});

describe("what is not a workout statement", () => {
  it.each([
    "did i go to the gym this week?",
    "how many gym days did i get this week",
    "im gonna do legs later",
    "going to the gym after class",
    "i skipped the gym today",
    "didnt work out today tbh",
    "move my gym session to 6pm",
    "remind me to go for a run tomorrow",
    "what should i lift today?",
    "how many calories in a protein shake",
    "i had a long run of bad luck lol",
    "can you cancel my workout block",
  ])("%s", (text) => {
    expect(readWorkoutTurn(text, ctx())).toBeNull();
  });
  it("a bare 'went to the gym' replying to ORION's own check-in is that check-in's answer, not a workout", () => {
    expect(readWorkoutTurn("yeah went to the gym", ctx({ outreach: true }))).toBeNull();
    expect(readWorkoutTurn("yeah went to the gym, did legs squats 4x6", ctx({ outreach: true }))).toMatchObject({ kind: "describe" });
  });
});

describe("his reply to the follow-up question", () => {
  it.each([
    "like 55 min and 185 on squats",
    "about an hour",
    "squats were 4x6 at 185",
    "45",
    "bodyweight",
    "60 mins, rdl was 135",
  ])("%s answers it", (text) => {
    expect(readWorkoutTurn(text, bound)).toEqual({ kind: "answer", text });
  });
  it.each(["skip", "idk", "i dont remember", "nah", "dunno lol", "just log it"])("%s logs it as it stands", (text) => {
    expect(readWorkoutTurn(text, bound)).toEqual({ kind: "skip" });
  });
  it.each(["never mind", "dont log it", "nvm", "forget it"])("%s drops it", (text) => {
    expect(readWorkoutTurn(text, bound)).toEqual({ kind: "cancel" });
  });
  it.each([
    "whats the weather like tomorrow",
    "how many calories in a bagel",
    "remind me to call mum at 5",
    "what time is my class",
    "did i go to the gym last week?",
    "can you move my 3pm to 4",
  ])("%s does not bind", (text) => {
    expect(readWorkoutTurn(text, bound)).toBeNull();
  });
  it("nothing binds once the question is no longer the last thing, or with no question waiting", () => {
    expect(readWorkoutTurn("55 min", ctx({ pending: WAITING, bound: false }))).toBeNull();
    expect(readWorkoutTurn("skip", ctx())).toBeNull();
    expect(readWorkoutTurn("about an hour", ctx())).toBeNull();
  });
  it("a new workout statement is a new workout, not an answer", () => {
    expect(readWorkoutTurn("just did chest, bench 3x8 at 135", bound)).toMatchObject({ kind: "describe" });
  });
});

describe("undo", () => {
  const last = { id: "WKT-1", at: NOW.getTime() - 5 * 60_000 };
  it("takes off the last log within half an hour", () => {
    expect(readWorkoutTurn("undo", ctx({ lastLogged: last }))).toEqual({ kind: "undo", id: "WKT-1" });
    expect(readWorkoutTurn("undo", ctx({ lastLogged: { ...last, at: NOW.getTime() - 45 * 60_000 } }))).toBeNull();
    expect(readWorkoutTurn("undo", ctx())).toBeNull();
  });
});
