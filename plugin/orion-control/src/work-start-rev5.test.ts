// REV5 MUST 4 (2026-10-31): a casual "let's …" starts a focus session only for work, and only when it was typed or said to ORION.
// "i'll hit you up" was a session on "you up"; a "let's do karaoke" from the TV turned on app blocking.
import { describe, expect, it } from "vitest";
import { workStartTask } from "./work-start.js";
import { isSessionStart, startsSession } from "./session-flow.js";

const ECON = { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" };

describe("REV5: casual lines that are not work never start a session", () => {
  it.each(["i'll hit you up", "let's do a movie", "im gonna do my best", "lets hit the road", "let me do you a favor", "i'll do the talking", "okay let's do karaoke",
    // held out
    "lets get into it", "gonna hit the shower", "im gonna focus on myself", "lets knock out a quick round of fifa", "time to tackle the dishes"])("%s", (m) => {
    expect(workStartTask(m, [ECON])).toBeUndefined();
    expect(isSessionStart(m)).toBe(false);
  });
});

describe("REV5: work, named or resolved", () => {
  it.each([["starting the problem set now", "the problem set"], ["lemme get on the essay", "the essay"], ["ok time to study for the midterm", "the midterm"], ["right lets crack on with the lab report", "the lab report"]])("work noun: %s", (m, task) => {
    expect(workStartTask(m)).toBe(task);
  });
  it("'ok lets work on econ' resolves to a block on his day", () => {
    expect(workStartTask("ok lets work on econ", [ECON])).toBe("econ");
    expect(workStartTask("ok lets work on econ", [])).toBeUndefined();
  });
  it("a deadline title counts as known", () => {
    expect(workStartTask("gonna knock out the zim brief", [{ title: "Zim brief" }])).toBe("the zim brief");
  });
});

describe("REV5: a spoken line not addressed to ORION never starts a casual session", () => {
  it("typed or addressed: yes; spoken unaddressed: no", () => {
    expect(startsSession("starting the problem set now", {}, { casual: true })).toBe(true);
    expect(startsSession("starting the problem set now", {}, { casual: false })).toBe(false);
    // An explicit focus start is still his words, spoken or typed.
    expect(startsSession("start a focus session", {}, { casual: false })).toBe(true);
    // A desk guess of a start does not stand in for a casual line he never said to ORION.
    expect(startsSession("okay let's do karaoke", { start: true }, { casual: false })).toBe(false);
  });
});
