import { describe, expect, it } from "vitest";
import { readMouseTurn } from "./mouse-read.js";

describe("mouse route: spoken numbers, and never a status dump for a request it could not parse", () => {
  it("A3: a spoken button and key is a request, not a status question", () => {
    expect(readMouseTurn("Can you Can you set the button six part of the mouse, can you set that to be mapped to f thirteen?")).toBeNull();
  });
  it("A4: narration about the mapping is not a status question either", () => {
    expect(readMouseTurn("yea, see we were looking for a mouse button six that didnt exist. i mapped that extra button to F13. can you connect the two for me?")).toBeNull();
  });
  it("spoken button numbers parse like digits", () => {
    expect(readMouseTurn("make button six do stage manager")).toEqual({ kind: "set", button: "button 6", action: "stage manager" });
    expect(readMouseTurn("make mouse button seven do mission control")).toEqual({ kind: "set", button: "mouse button 7", action: "mission control" });
  });
  it("f thirteen is a button he named", () => {
    expect(readMouseTurn("make f thirteen do mission control")).toEqual({ kind: "set", button: "f13", action: "mission control" });
  });
  it("a real status question still gets the status", () => {
    expect(readMouseTurn("what are my mouse buttons set to")).toEqual({ kind: "status" });
    expect(readMouseTurn("whats my back button doing rn?")).toEqual({ kind: "status" });
  });
  it("a request with a button and no action still asks the one question", () => {
    expect(readMouseTurn("can you make the back button do something cool")?.kind).not.toBe("status");
  });
  it("talking about a mouse with no ask is not a mouse turn", () => {
    expect(readMouseTurn("my mouse buttons are so annoying lol")).toBeNull();
  });
});
