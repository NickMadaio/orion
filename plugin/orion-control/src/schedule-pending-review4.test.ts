import { describe, expect, it } from "vitest";
import { answerPending, titleAnswer, type TitlePending } from "./schedule-pending.js";

// review 5 M5 (2026-10-16): device commands ("turn off the lights", "set a timer", "play some music") left this list: the front desk's tool move (local-routing.ts addAnswer check) covers them.
// r8 review 4 HIGH-1 (2026-10-16): almost any reply to "What should I put before your 1:30 PM class?" was booked as a title.
const title: TitlePending = { kind: "title", ask: "What should I put before your 1:30 PM class?", minutes: 30, dateArgs: ["--date", "2026-10-16"], before: { minute: 810, label: "your 1:30 PM class" } };

const NOT_TITLES = ["what's the weather", "i don't know", "you pick", "up to you", "surprise me",
  "thanks", "hmm", "idk", "actually never mind", "not really", "hold on", "that's fine", "yeah that's fine", "absolutely", "perfect", "ok cool",
  "i'm going to the gym", "whatever", "you choose", "lol", "cool", "remind me to call", "can you check", "how long is it"];

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
  });
  it("actually never mind declines", () => {
    expect(answerPending(title, "actually never mind")).toEqual({ kind: "decline" });
  });
  it("a real title still runs", () => {
    expect(answerPending(title, "yes, laundry")).toMatchObject({ kind: "run", run: { title: "Laundry" } });
  });
});

// review 5 M5 (2026-10-16 r8b): ordinary to-do titles are titles; the device-verb list is gone.
import { titleAnswer as titleAnswerR5 } from "./schedule-pending.js";
describe("review 5 M5: common titles are accepted", () => {
  it.each([["great gatsby reading", "Great gatsby reading"], ["cool down stretch", "Cool down stretch"], ["call mom", "Call mom"], ["text Sam back", "Text Sam back"], ["start my essay", "Start my essay"], ["set up my desk", "Set up my desk"], ["log my expenses", "Log my expenses"]])("%s", (said, title) => {
    expect(titleAnswerR5(said)).toBe(title);
  });
  it.each(["great", "cool", "nice", "perfect, thanks", "ok cool", "awesome"])("still a non-answer: %s", (said) => {
    expect(titleAnswerR5(said)).toBeNull();
  });
});
