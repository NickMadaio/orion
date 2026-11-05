// w20 xf-other (tube audit A3/A4): "button six ... mapped to f thirteen" names ONE physical button twice (the number he knew, the key it now sends).
// It used to be refused as "two buttons, which is meant?" and fell to the model, which dumped a status paragraph.
import { describe, expect, it } from "vitest";
import { readMouseTurn } from "./mouse-read.js";

const topButton = { kind: "set", button: "f13", action: "" };

describe("a button named by its number and by the key it sends is one button", () => {
  it("a request to map it: the F key is the button, the action is still to be asked", () => {
    for (const m of ["can you set the button six part of the mouse to be mapped to f thirteen", "set mouse button 6 to f13", "pls map button six on my mouse to f 13",
      "the button 6 on the mouse, i want it mapped to f thirteen"])
      expect(readMouseTurn(m), m).toMatchObject(topButton);
  });
  it("'connect the two' is the same ask", () => {
    for (const m of ["yea see we were looking for a mouse button six that didnt exist. i mapped that extra button to F13. can you connect the two for me?",
      "i set mouse button six to f thirteen in synapse, can you link them up", "button 6 on the mouse is f13 now, hook those up for me"])
      expect(readMouseTurn(m), m).toMatchObject(topButton);
  });
  it("an action named alongside keeps the action", () => {
    expect(readMouseTurn("make mouse button six, the f thirteen one, do mission control")).toEqual({ kind: "set", button: "f13", action: "mission control" });
  });
  it("two truly different buttons are still left to the model", () => {
    expect(readMouseTurn("swap the front side button and the back side button on my mouse")).toBeNull();
    expect(readMouseTurn("mouse button 6 and f13 and the front side button")).toBeNull();
  });
  it("a question about them is still a status read, not a bind", () => {
    expect(readMouseTurn("what is mouse button six mapped to, f thirteen?")).not.toMatchObject({ kind: "set" });
  });
});
