import { describe, expect, it } from "vitest";
import { allSlots, gateDecision, inHisWords, isDirectQuestion, schedulingAsk } from "./route-gate.js";
import type { Decision } from "./front-desk.js";

const tool = (t: string, args: Record<string, unknown> = {}): Decision => ({ move: "tool", tool: t, args });

describe("allSlots", () => {
  it("is all-or-nothing", () => {
    expect(allSlots({ button: "6", action: "f13" })).toEqual({ button: "6", action: "f13" });
    expect(allSlots({ button: "6", action: undefined })).toBeNull();
    expect(allSlots({ button: "", action: "f13" })).toBeNull();
  });
});

describe("inHisWords", () => {
  it("accepts what he said and refuses what the desk invented", () => {
    expect(inHisWords("open safari for me", "Safari")).toBe(true);
    expect(inHisWords("re-open it one more time please", "CS1802 Seminar")).toBe(false);
  });
});

describe("schedulingAsk", () => {
  it("catches calendar adds with a time, range or length", () => {
    for (const s of ["put an hour gym session at 10-11 for me", "add gym from 10pm to 11pm", "okay now add marketing myseum from 7-9:30pm", "push sleep to 11:45", "stick gym at 10 tonight"]) expect(schedulingAsk(s)).toBe(true);
  });
  it("lets what he did through", () => {
    for (const s of ["just did legs at 10 this morning", "i went to the gym at 10 today", "went for a run from 6 to 7 earlier"]) expect(schedulingAsk(s)).toBe(false);
  });
  it("ignores asks with no time", () => {
    expect(schedulingAsk("add milk to my list")).toBe(false);
  });
});

describe("isDirectQuestion", () => {
  it("reads questions", () => {
    expect(isDirectQuestion("Can you modify something in your own code?")).toBe(true);
    expect(isDirectQuestion("why was your response just three dots")).toBe(true);
    expect(isDirectQuestion("dont do anything in minecraft")).toBe(false);
  });
});

describe("gateDecision", () => {
  it("a focus session needs his verb aimed at a session, not narration", () => {
    const said = "Sweet. So let's go ahead and do that. Now that we have that set, I will ask Orion. Orion.";
    const out = gateDecision(tool("session", { do: "start" }), said, true);
    expect(out.move).toBe("escalate");
    expect(gateDecision(tool("session", { do: "start" }), "start a focus session for my essay", true).move).toBe("tool");
  });
  it("app_open needs the app in his words", () => {
    expect(gateDecision(tool("app_open", { application: "CS1802 Seminar" }), 're-open it one more time please, the "desktop ->" isnt working', false).move).toBe("escalate");
    expect(gateDecision(tool("app_open", { application: "Safari" }), "open safari", false).move).toBe("tool");
  });
  it("ignore on a typed question is answered; a typed non-question stays with the worker's ask-what-you-need note", () => {
    expect(gateDecision({ move: "ignore" }, "why was your response just three dots", false).move).toBe("escalate");
    expect(gateDecision({ move: "ignore" }, "hm", false).move).toBe("ignore");
  });
  it("ignore never silences a spoken question; room chatter stays ignored", () => {
    expect(gateDecision({ move: "ignore" }, "Can you modify something in your own code?", true).move).toBe("escalate");
    expect(gateDecision({ move: "ignore" }, "yeah i told him we would be there at eight", true).move).toBe("ignore");
    expect(gateDecision({ move: "ignore" }, "whats the difference between a latte and a flat white", true).move).toBe("ignore");
  });
});
