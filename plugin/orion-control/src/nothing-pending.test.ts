// w20 r5 (live gate 3 #97 #98): "that one" / "go" with nothing open is answered plainly and with a question, never "I got ahead of myself".
import { describe, expect, it } from "vitest";
import { honestReply, isBareGoAhead, NOTHING_PENDING_LINES } from "./honest-reply.js";

describe("a go-ahead with nothing pending", () => {
  it.each(["that one", "go", "yeah go on", "this one", "ok do it", "that", "yes that one"])("%s", (m) => {
    expect(isBareGoAhead(m), m).toBe(true);
    const line = honestReply({ calendar: false, message: m, tools: [] });
    expect(NOTHING_PENDING_LINES).toContain(line);
    expect(line).not.toMatch(/ahead of myself|couldn't (?:actually )?run|nothing happened/i);
    expect(line).toMatch(/\?$/);
  });
  it("a real request keeps the honest failure line", () => {
    expect(isBareGoAhead("move the gym to 5")).toBe(false);
    expect(honestReply({ calendar: false, message: "open the pod bay doors", tools: [] })).toMatch(/I couldn't/);
  });
});
