import { describe, expect, it } from "vitest";
import { STATEMENT_LINE, honestLine, isPlanStatement } from "./local-routing.js";

// 2026-11-03 phone audit: plans he told ORION got "I didn't actually do that … say it again?" as if a request had failed.
describe("the honest line for a statement of his own plans", () => {
  it("recognises plans said in his casual style", () => {
    expect(isPlanStatement("ill get home and see, i do need to meal prep thatll take like an hour")).toBe(true);
    expect(isPlanStatement("I’ll do a. Little but I’m gonna make some dinner and then prep instead")).toBe(true);
    expect(isPlanStatement("gonna nap then hit the library, we'll see")).toBe(true);
  });
  it("does not treat a request or a question as a plan statement", () => {
    expect(isPlanStatement("move gym to 7 pm i'll be late")).toBe(false);
    expect(isPlanStatement("remind me to call mum, i'll forget")).toBe(false);
    expect(isPlanStatement("what time do i need to leave?")).toBe(false);
    expect(isPlanStatement("add meal prep after class")).toBe(false);
  });
  it("answers a plan with a plain acknowledgement, not a failed-request line", () => {
    expect(honestLine(false, "ill get home and see, need to meal prep")).toBe(STATEMENT_LINE);
    expect(STATEMENT_LINE).not.toMatch(/say it again|didn't actually do/i);
  });
  it("keeps the original lines for real requests and when no message is given", () => {
    expect(honestLine(false)).toMatch(/couldn't (?:actually )?run that/);
    expect(honestLine(false)).not.toMatch(/say it again|rephrase/i);
    expect(honestLine(true, "move gym to 7")).toMatch(/couldn't (?:make|run|get) that change/);
    expect(honestLine(false, "start a focus session i'll need 40 min")).toMatch(/couldn't (?:actually )?run that/);
  });
});
