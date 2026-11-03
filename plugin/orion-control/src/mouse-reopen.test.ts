// w18 voiceself: "pull the mouse button mapper back up" is the mouse popup again, never a refusal.
import { describe, expect, it } from "vitest";
import { readMouseTurn } from "./mouse-read.js";
import { argsFor } from "./mouse-chat.js";

describe("reopening the mouse setup", () => {
  it("every way of asking for it again", () => {
    for (const m of ["pull up the mouse button mapper again", "open the mouse thing", "show me the mouse setup", "bring back the button mapper",
      "wait can you pull up the mouse button mapper again", "yo open the mouse settings popup", "bring up the button mapper pls", "pull the mouse mapper back up",
      "where did the mouse setup go, show it again"])
      expect(readMouseTurn(m), m).toEqual({ kind: "setup", again: true });
  });
  it("his live sentences from 2026-11-03 (the LLM answered both before the fix) and every other way of asking", () => {
    for (const m of ["wait, can you pull up the mouse button mapper again", "open the mouse mapper again", "summon the mouse button mapper", "open the mouse mapper",
      "bring up the button mapper", "mouse settings", "show me my mouse buttons", "can you open the mouse thing again", "summon the mouse button mapper again",
      "sumon the mouse buton mapper", "opn the mouse mappr", "pull up my mouse button mapper real quick", "can u bring up that mouse button mapper thing",
      "i asked u to summon the mouse button mapper again and u didnt", "launch the mouse button mapper", "mouse button settings", "open mouse settings",
      "show the mouse mapper", "bring the mouse mapper back", "open up the mouse buttons thing", "yo summon the mouse mapper pls", "mouse mapper", "button mapper",
      "can you open up the mouse button settings again"])
      expect(readMouseTurn(m), m).toEqual({ kind: "setup", again: true });
  });
  it("mouse settings questions stay questions", () => {
    expect(readMouseTurn("what are my mouse settings")).toMatchObject({ kind: "status" });
    expect(readMouseTurn("what are my mouse buttons set to")).toMatchObject({ kind: "status" });
  });
  it("is told apart from reading or changing the bindings", () => {
    expect(readMouseTurn("what are my mouse buttons set to")).toMatchObject({ kind: "status" });
    expect(readMouseTurn("make the back button open spotify")).toMatchObject({ kind: "set" });
    expect(readMouseTurn("help me set up my mouse")).toEqual({ kind: "setup" });
    for (const m of ["open my tasks", "pull up the calendar", "open spotify", "show me my day"]) expect(readMouseTurn(m), m).toBeNull();
  });
  it("runs setup with the short answer", () => {
    expect(argsFor({ kind: "setup", again: true })).toEqual(["setup", "--again", "--json"]);
    expect(argsFor({ kind: "setup" })).toEqual(["setup", "--json"]);
  });
});

describe("the type-to-orion mouse action", () => {
  it("make my back button open the text box is a set with that action", () => {
    for (const m of ["make my back button open the text box", "front button should type to orion", "set the back button to open the typing box"])
      expect(readMouseTurn(m), m).toMatchObject({ kind: "set", button: expect.stringMatching(/back|front/) });
    expect(readMouseTurn("make my back button open the text box")).toMatchObject({ action: expect.stringMatching(/text box|type to orion/) });
  });
});
