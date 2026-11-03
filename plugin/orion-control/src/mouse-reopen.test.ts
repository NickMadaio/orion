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
