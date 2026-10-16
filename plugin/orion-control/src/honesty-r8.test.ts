import { describe, expect, it } from "vitest";
import { checkWork, outcomeOf } from "./work-check.js";

// r8 (2026-10-16): q066 "I'm reading your last three texts now." and q069 "I'm searching your Gmail for the
// internship offer." were said with no tool run and the work check found nothing.
describe("work check: claimed lookups, r8 misses", () => {
  const claims = ["I'm reading your last three texts now.", "I'm searching your Gmail for the internship offer.", "I'm searching Gmail for the offer.", "I'm checking your iMessage now.", "I'm reading your last ten messages.", "I'm looking through your WhatsApp for it.", "I'm searching for the internship offer."];
  for (const reply of claims) it(`flags "${reply}" with no tool`, () => expect(checkWork({ reply, turnResults: [], finished: true }), reply).toContain("claims a lookup it did not do"));
  const warm = ["I'm reading you loud and clear.", "I'm looking out for you, get some sleep.", "I'm searching for you everywhere, where are you?", "I'm checking in on you."];
  for (const reply of warm) it(`does not flag "${reply}"`, () => expect(checkWork({ reply, turnResults: [], finished: true }), reply).not.toContain("claims a lookup it did not do"));
  it("code that ran the read is not a claimed lookup", () => {
    const turnResults = [{ canonical: "exec orion-messages recent 3", stdout: "2026-10-16 14:02  Gia: running late", exit: null }];
    expect(checkWork({ reply: "Gia texted you at 2:02 PM that she's running late.", turnResults, finished: true, provided: true })).toEqual([]);
  });
});

describe("outcomeOf: a read of his messages", () => {
  it("message words are not a verdict", () => {
    const stdout = "2026-10-16 14:02  Gia: Error 404 not found lol, i moved it and sent it";
    expect(outcomeOf({ canonical: "exec orion-messages recent 3", stdout, exit: null })).toBe("read");
    expect(outcomeOf({ canonical: "exec orion-gmail-search \"internship offer\"", stdout: "Offer — HR <hr@acme.com>: I added you, sent it", exit: null })).toBe("read");
  });
  it("a failed read is still a failure", () => {
    expect(outcomeOf({ canonical: "exec orion-messages recent 3", stdout: "orion-messages: Full Disk Access is required to read Messages", exit: null })).not.toBe("read");
    expect(outcomeOf({ canonical: "exec orion-messages recent 3", stdout: "x", exit: 4 })).toBe("failed");
  });
});
