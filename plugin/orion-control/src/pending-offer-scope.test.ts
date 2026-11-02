// w16 a-reply (2026-11-02 23:21, live repro): with "is Go over Orion learning plan still happening?" pending, "whats the weather gonna be
// like tmrw" from a fresh CLI session got "When tomorrow? Give me a time and I'll move Go over Orion learning plan there." The short-reply
// reader read a question with no "?" as a counter-offer ("tmrw"), and the last push bound in a session that was never a chat with him.
// Held-out phrasings in his style; fixtures only.
import { describe, expect, it } from "vitest";
import { readPendingTurn, readReply } from "./pending-reply.js";

const ASK = "You're out - is Go over Orion learning plan still happening, or did plans change? I'll update the calendar.";
const now = new Date(2026, 10, 2, 23, 20);
const push = { text: ASK, at: new Date(2026, 10, 2, 23, 3).toISOString() };
const memo = { kind: "move-offer" as const, title: "Go over Orion learning plan", to: 23 * 60 + 40, which: "today" as const, at: new Date(2026, 10, 2, 23, 15).getTime() };

describe("a different question while a move offer is pending is answered, never bound", () => {
  it.each([
    "whats the weather gonna be like tmrw",
    "what's the weather tomorrow",
    "hows the weather looking tmrw morning",
    "how was my sleep last night",
    "how did i sleep",
    "is it gonna rain tomorrow",
    "whats on tmrw",
    "when is my first class tomorrow",
    "will it be cold at 9",
  ])("%s", (said) => {
    expect(readPendingTurn({ message: said, now, lastPush: push, chatSurface: true })).toBeUndefined();
    expect(readPendingTurn({ message: said, now, memo, chatSurface: true })).toBeUndefined();
  });
  it("'whats next' is not taken as an answer to the plan question either", () => {
    expect(readPendingTurn({ message: "ok whats next", now, lastPush: push, chatSurface: true })).toBeUndefined();
  });
  it.each(["how about 9pm", "what about tmrw at 7", "can we do 10pm instead"])("a counter put as a question still answers it: %s", (said) => {
    expect(readReply(said)?.kind).toBe("counter");
  });
  it("a real answer still binds", () => {
    expect(readPendingTurn({ message: "nah plans changed", now, lastPush: push, chatSurface: true })?.reply.kind).toBe("changed");
    expect(readPendingTurn({ message: "ya do it tmrw at 6", now, memo, chatSurface: true })?.reply.kind).toBe("counter");
  });
});

describe("a pushed question binds only in a chat with him", () => {
  it("not in a session that is not his chat (a CLI check, a probe)", () => {
    expect(readPendingTurn({ message: "nah plans changed", now, lastPush: push, chatSurface: false })).toBeUndefined();
  });
  it("the app's label for it is the mirror: it binds wherever the app attached it", () => {
    expect(readPendingTurn({ message: "nah plans changed", now, outreach: { text: ASK, minutes: 17, kind: "question" } as never, chatSurface: false })?.reply.kind).toBe("changed");
  });
  it("and expires: half an hour after the push nothing binds", () => {
    expect(readPendingTurn({ message: "nah plans changed", now: new Date(2026, 10, 2, 23, 40), lastPush: push, chatSurface: true })).toBeUndefined();
  });
});
