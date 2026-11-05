// Live 11-05 13:05: "want me to save this spot? What is it?" -> his answer -> "Want me to save that spot for you?" -> "yes" -> lost.
import { describe, expect, it } from "vitest";
import { asksToSavePlace, nameInQuestion, placeId, readPlaceReply } from "./place-save.js";

describe("ORION's question about a place", () => {
  it.each(["You've been here a while - want me to save this spot? What is it?", "Got it, Chapter Spitalfields. Want me to save that spot for you?", "Want me to save this place?", "Should I remember this location?"])("%s", (t) => expect(asksToSavePlace(t), t).toBe(true));
  it.each(["You've been here a while.", "I saved the place.", "Want me to log it?", "Spot on, thanks."])("%s is not one", (t) => expect(asksToSavePlace(t), t).toBe(false));
});

describe("his answer", () => {
  it("his exact words: a name, with the alias he uses", () => {
    expect(readPlaceReply('this is Chapter Spitalfields (i call it "spit"). i go here to do work and to see avery')).toEqual({ kind: "name", name: "Chapter Spitalfields", alias: "spit" });
  });
  it.each([
    ["it's the library", "the library"], ["its called Barbican Centre", "Barbican Centre"], ["this is my gran's flat", "my gran's flat"], ["call it The Lab", "The Lab"],
    ["its Costa on the high street, i work here a lot", "Costa on the high street"],
  ])("%s", (m, name) => expect(readPlaceReply(m)).toMatchObject({ kind: "name", name }));
  it("a bare name answers a place question (the caller knows one was asked)", () => expect(readPlaceReply("Chapter Spitalfields", { stage: "name", at: 1 })).toMatchObject({ kind: "name", name: "Chapter Spitalfields" }));
  it.each([["yes", "yes"], ["yeah", "yes"], ["yes please", "yes"], ["go on then", "yes"], ["nah", "no"], ["no thanks", "no"], ["not now", "no"]])("%s", (m, k) => expect(readPlaceReply(m)).toEqual({ kind: k }));
  it("something else is not an answer", () => {
    for (const m of ["whats the weather tomorrow", "move gym to 5 and then tell me what i have on this afternoon please", "how long til my first thing?"]) expect(readPlaceReply(m), m).toBeNull();
  });
  it("even with a place question open, a question or a request is not a name", () => {
    for (const m of ["whats the weather tomorrow", "move gym to 5", "can you check my day", "how long til my first thing"]) expect(readPlaceReply(m, { stage: "name", at: 1 }), m).toBeNull();
  });
  it("with a name asked for, a short phrase is the name", () => expect(readPlaceReply("Spit", { stage: "name", at: 1 })).toEqual({ kind: "name", name: "Spit" }));
});

describe("aliases in his words", () => {
  it.each([
    ["it's chapter spitalfields, or spit for short", "chapter spitalfields", "spit"],
    ["chapter spitalfields (spit for short)", "chapter spitalfields", "spit"],
    ["this is Chapter Spitalfields, aka spit", "Chapter Spitalfields", "spit"],
    ["it's the library, also called the lib", "the library", "the lib"],
    ['this is Chapter Spitalfields (i call it "spit")', "Chapter Spitalfields", "spit"],
  ])("%s", (m, name, alias) => expect(readPlaceReply(m, { stage: "name", at: 1 })).toEqual({ kind: "name", name, alias }));
  it.each([["call it spit", "spit"], ["i call it spit", "spit"], ["or spit for short", "spit"], ["its also called spit", "spit"], ["and also known as the lab", "the lab"], ["actually call it spit", "spit"]])("after the save: %s", (m, alias) =>
    expect(readPlaceReply(m, { stage: "saved", name: "Chapter Spitalfields", id: "chapter-spitalfields", at: 1 })).toEqual({ kind: "alias", alias }));
  it("after the save, anything else is not an alias", () => {
    for (const m of ["whats the weather", "yes", "move gym to 5", "thanks"]) expect(readPlaceReply(m, { stage: "saved", at: 1 }), m).toBeNull();
  });
});

describe("helpers", () => {
  it("ids", () => { expect(placeId("Chapter Spitalfields")).toBe("chapter-spitalfields"); expect(placeId("  gran's flat!! ")).toBe("gran-s-flat"); });
  it("the name a drafted question carries", () => { expect(nameInQuestion("Got it, Chapter Spitalfields. Want me to save that spot for you?")).toBe("Chapter Spitalfields"); expect(nameInQuestion("Want me to save that spot?")).toBeUndefined(); });
});
