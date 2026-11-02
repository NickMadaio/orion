// Wave 8: a computer claim needs a tool result in the turn; the loop's steps are that result; "distracting stuff" is a default, not a question.
import { describe, expect, it } from "vitest";
import { stepsAsToolResults } from "./computer-evidence.js";
import { checkReply } from "./work-check.js";
import { readPhoneBlock, DISTRACTION_GROUPS } from "./phone-block-read.js";
import { detectComputerIntent } from "./computer-intent.js";

describe("computer claims need evidence", () => {
  const claims = [
    "Done: opened Notes and made a note.",
    "I opened notes and typed your list in.",
    "I've clicked the submit button for you.",
    "ok i closed the tabs that weren't econ",
    "Done, made a new note called budget.",
  ];
  for (const reply of claims) {
    it(`flags "${reply}" with no tool result`, () => {
      expect(checkReply({ reply, turnResults: [] }).falseClaim).toBe(true);
    });
  }
  it("flags a claim when the only result is a failed step", () => {
    const turnResults = stepsAsToolResults([{ n: 1, action: "open", target: "Notes", via: "open", ok: true, verified: false }]);
    expect(checkReply({ reply: "Done: opened Notes.", turnResults }).falseClaim).toBe(true);
  });
  it("accepts the claim when the loop's verified steps are the evidence", () => {
    const turnResults = stepsAsToolResults([
      { n: 1, action: "open", target: "Notes", via: "open", ok: true, verified: true },
      { n: 2, action: "menu", target: "File > New Note", via: "menu", ok: true, verified: true },
    ]);
    expect(checkReply({ reply: "Done: opened Notes and made a new note called \"econ ideas\".", turnResults }).falseClaim).toBe(false);
  });
  it("does not treat questions or plans as claims", () => {
    expect(checkReply({ reply: "Want me to open Notes?", turnResults: [] }).falseClaim).toBe(false);
    expect(checkReply({ reply: "I could open Notes and type that if you like.", turnResults: [] }).falseClaim).toBe(false);
  });
});

describe("the notes request is a computer task (held-out phrasings)", () => {
  for (const msg of ["pull up notes and start a new one called book list", "open notes, make a new note titled trip plan", "launch the notes app then create a note called trip ideas"]) {
    it(msg, () => {
      const intent = detectComputerIntent(msg);
      expect(intent?.kind).toBe("act");
    });
  }
});

describe("distracting stuff while studying", () => {
  for (const msg of ["lock my distracting apps while im studying", "kill the distracting stuff for the next 2 hours", "block distractions while i cram"]) {
    it(`acts: ${msg}`, () => {
      const read = readPhoneBlock(msg);
      expect(read?.kind).toBe("block");
      if (read?.kind === "block") expect(read.groups).toEqual(DISTRACTION_GROUPS);
    });
  }
  it("still asks about a bare 'block it'", () => {
    expect(readPhoneBlock("block it")?.kind).toBe("ask");
  });
});
