import { describe, expect, it } from "vitest";
import { answerPending, titleAnswer, type TitlePending } from "./schedule-pending.js";

// r8 review 4 HIGH-1 (2026-10-16): almost any reply to "What should I put before your 1:30 PM class?" was booked as a title.
const title: TitlePending = { kind: "title", ask: "What should I put before your 1:30 PM class?", minutes: 30, dateArgs: ["--date", "2026-10-16"], before: { minute: 810, label: "your 1:30 PM class" } };

const NOT_TITLES = ["turn off the lights", "what's the weather", "set a timer", "i don't know", "you pick", "up to you", "surprise me",
  "thanks", "hmm", "idk", "actually never mind", "not really", "hold on", "that's fine", "yeah that's fine", "absolutely", "perfect", "ok cool",
  "i'm going to the gym", "whatever", "you choose", "lol", "cool", "play some music", "text mom", "remind me to call", "can you check", "how long is it"];

describe("titleAnswer", () => {
  it("strips a leading acknowledgement", () => {
    expect(titleAnswer("yes, laundry")).toBe("Laundry");
    expect(titleAnswer("yeah reading")).toBe("Reading");
    expect(titleAnswer("sure, stretching")).toBe("Stretching");
    expect(titleAnswer("do laundry")).toBe("Laundry");
  });
  it.each(NOT_TITLES)("%s is not a title", (said) => {
    expect(titleAnswer(said)).toBeNull();
    const a = answerPending(title, said);
    expect(a === undefined || a.kind === "decline" || a.kind === "reask").toBe(true);
    expect(a?.kind === "run").toBe(false);
  });
});

describe("answerPending for a non-answer", () => {
  it.each(["idk", "i don't know", "you pick", "you choose", "up to you", "surprise me", "whatever"])("%s asks once more", (said) => {
    expect(answerPending(title, said)).toMatchObject({ kind: "reask", pending: { reasked: true } });
  });
  it("only once", () => {
    expect(answerPending({ ...title, reasked: true }, "idk")).toBeUndefined();
    expect(answerPending({ ...title, reasked: true }, "yes")).toBeUndefined();
  });
  it("thanks or a question just clears it so the turn routes normally", () => {
    expect(answerPending(title, "thanks")).toBeUndefined();
    expect(answerPending(title, "what's the weather")).toBeUndefined();
    expect(answerPending(title, "turn off the lights")).toBeUndefined();
  });
  it("actually never mind declines", () => {
    expect(answerPending(title, "actually never mind")).toEqual({ kind: "decline" });
  });
  it("a real title still runs", () => {
    expect(answerPending(title, "yes, laundry")).toMatchObject({ kind: "run", run: { title: "Laundry" } });
  });
});
