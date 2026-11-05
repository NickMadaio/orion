// w20 xf-other (tube audit F3): the transport's raw "ORION refused or could not run that (exit 1)." never reaches him.
import { describe, expect, it } from "vitest";
import { finalizeReply, WRAPPER_FAILURE_LINE } from "./reply-sanitize.js";

describe("the wrapper's failure line", () => {
  it.each([
    "ORION refused or could not run that (exit 1).", "ORION refused or could not run that (exit code 2)", "ORION could not run that.", "ORION couldn't run that one (exit 1)!",
  ])("%s becomes a first-person line", (raw) => {
    const out = finalizeReply(raw, []);
    expect(out).toBe(WRAPPER_FAILURE_LINE);
    expect(out).not.toMatch(/ORION|exit/);
  });
  it("keeps what else was said", () => expect(finalizeReply("I added dinner at 7. ORION refused or could not run that (exit 1).", [])).toBe(`I added dinner at 7. ${WRAPPER_FAILURE_LINE}`));
  it("leaves ordinary replies alone", () => expect(finalizeReply("I moved dinner to 7 PM.", [])).toBe("I moved dinner to 7 PM."));
});
