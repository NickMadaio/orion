// Wave 6 B (gate run-1101003318, foc-start-v): the worker's own words about tool availability reached Nick:
// 'I can't use the tool "orion-session" here because it isn't available. I need to stop retrying it and answer without that tool.'
import { describe, expect, it } from "vitest";
import { sanitizeReply } from "./reply-sanitize.js";

const LEAKED = "I can't use the tool \"orion-session\" here because it isn't available. I need to stop retrying it and answer without that tool.";

describe("tool-availability talk never reaches him", () => {
  it("the gate reply is cut whole", () => {
    const out = sanitizeReply(LEAKED);
    expect(out).not.toMatch(/tool|available|retry|orion-session/i);
  });
  it.each([
    "That tool isn't available right now, so I'll answer without it.",
    "I need to stop retrying the focus tool. Your econ block is next at 11.",
    "Looks like the session tool is unavailable here. Want me to try something else?",
  ])("%s", (said) => {
    expect(sanitizeReply(said)).not.toMatch(/\btools?\b|unavailable|retrying/i);
  });
  it("a reply that only mentions a tool in his own sense is kept", () => {
    expect(sanitizeReply("Your econ problem set is due Thursday.")).toBe("Your econ problem set is due Thursday.");
  });
});
