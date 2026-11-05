// w20 r6 (live gate 4 #54 #93): deadlines are answered from the deadlines source, never "they're in your Canvas calendar", and the next one is the nearest.
import { describe, expect, it } from "vitest";
import { asksDeadlines, deadlineReply, type DeadlineRead } from "./deadline-read.js";

const now = new Date(2026, 10, 5, 6, 23);
const read: DeadlineRead = { tasks: [{ title: "New CS Lab", due: "2026-11-09" }], events: [
  { title: "Macro (ECON1115) — Quiz 2", start: new Date(2026, 10, 20).toISOString(), allDay: "true", isDeadline: true },
  { title: "DUE 13:30 — Marketing (MKTG2201) submission", start: new Date(2026, 11, 4, 13, 30).toISOString(), allDay: "false", isDeadline: true }] };

describe("asking what is due, in his words", () => {
  it.each(["what deadlines have i got coming up", "what coursework is due this week", "whats due this week", "which deadlines are coming up", "any deadlines coming up", "what assignments are due soon", "have i got any deadlines"])("%s", (m) => expect(asksDeadlines(m), m).toBe(true));
  it.each(["make the essay due friday", "my deadlines are killing me", "what time is it", "remind me what is due friday", "nothing is due"])("%s is not one", (m) => expect(asksDeadlines(m), m).toBe(false));
});

describe("the answer", () => {
  it("coming up: everything in the next month, nearest first, the quiz included", () => {
    const t = deadlineReply("what deadlines have i got coming up", read, now);
    expect(t).toContain("New CS Lab (to-do), Monday");
    expect(t.indexOf("Quiz 2")).toBeGreaterThan(-1);
    expect(t.indexOf("New CS Lab")).toBeLessThan(t.indexOf("Quiz 2"));
    expect(t).not.toMatch(/canvas/i);
  });
  it("this week with nothing in it: says so, and the NEXT one is the nearest (the 20 Nov quiz, not December)", () => {
    const t = deadlineReply("what coursework is due this week", { ...read, tasks: [] }, now);
    expect(t).toMatch(/^Nothing is due this week\. The next deadline is Macro \(ECON1115\) — Quiz 2, Friday Nov 20 \(all day\)\.$/);
  });
});
