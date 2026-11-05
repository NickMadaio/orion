import { describe, expect, it } from "vitest";
import { afterReply, isRetryWord, replayOf, withoutRetryOffer, RETRY_WINDOW_MS } from "./retry-slot.js";

describe("retry words", () => {
  it.each(["go", "Go.", "yeah go", "ok go", "do it", "yeah do it", "try again", "try it again", "retry", "go again", "yes go ahead"])("%s is a retry", (m) => {
    expect(isRetryWord(m)).toBe(true);
  });
  it.each(["go to the gym at 6", "do it tomorrow", "retry the mail and also move gym", "yes", "no", "go away", "gonna do it later"])("%s is not", (m) => {
    expect(isRetryWord(m)).toBe(false);
  });
});

describe("the slot", () => {
  const OFFER = "I couldn't log that just now, so nothing was logged. Say go and I'll retry it.";
  it("stores the failed message when a reply offers a retry", () => {
    expect(afterReply(OFFER, "log two eggs and toast", 100)).toEqual({ message: "log two eggs and toast", at: 100 });
  });
  it("stores nothing for a reply without the offer, or when the message was itself a retry word", () => {
    expect(afterReply("Logged it.", "log two eggs", 1)).toBeUndefined();
    expect(afterReply(OFFER, "go", 1)).toBeUndefined();
  });
  it("replays within ten minutes and not after", () => {
    const slot = afterReply(OFFER, "log two eggs and toast", 1000);
    expect(replayOf(slot, "yeah go", 1000 + 60_000)).toBe("log two eggs and toast");
    expect(replayOf(slot, "yeah go", 1000 + RETRY_WINDOW_MS + 1)).toBe("yeah go");
  });
  it("anything that is not a retry word is left as typed", () => {
    expect(replayOf(afterReply(OFFER, "log two eggs", 0), "what is on today", 5)).toBe("what is on today");
    expect(replayOf(undefined, "go", 5)).toBe("go");
  });
  it("a reply with nothing to replay does not promise a retry", () => {
    expect(withoutRetryOffer(OFFER)).toBe("I couldn't log that just now, so nothing was logged. Ask me again and I'll retry.");
  });
});
