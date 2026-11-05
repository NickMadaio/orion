// w20 r6 (live gate 4 #98): a mouse clause and a question in one message: both are answered.
import { describe, expect, it } from "vitest";
import { splitLeadMouse } from "./mouse-lead.js";

describe("a mouse ask followed by a question", () => {
  it.each([
    ["open the mouse mapper and whats the weather tomorrow", "whats the weather tomorrow"],
    ["bring up the mouse button mapper then tell me the time", "tell me the time"],
    ["pull up the mouse mapper and what do i have on tomorrow", "what do i have on tomorrow"],
    ["make the back button do mission control and tell me whats on today", "tell me whats on today"],
    ["open the mouse button mapper, and then how long til my first thing", "how long til my first thing"],
    ["show me the mouse mapper and also check the weather", "check the weather"],
  ])("%s", (m, rest) => { const s = splitLeadMouse(m); expect(s?.rest, m).toBe(rest); expect(s?.turn).toBeTruthy(); });
  it("leaves single asks and half-asks alone", () => {
    for (const m of ["open the mouse mapper", "whats the weather and open the mouse mapper", "make the back button do something and tell me the time", "open the mouse mapper and open safari"]) expect(splitLeadMouse(m), m).toBeNull();
  });
});
