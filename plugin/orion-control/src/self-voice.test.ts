// w18 voiceself (2026-11-03 live: "he keeps referring to himself in the third person"): ORION speaks as "I".
// The guard rewrites only self-reference with ORION as the subject; product and window names stay. Held-out lines, Nick's style.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { firstPerson, SPEAK_AS_I } from "./self-voice.js";
import { finalizeReply } from "./reply-sanitize.js";
import { toolDirective } from "./tool-moves.js";
import { alertText } from "./account-health.js";

describe("firstPerson", () => {
  it("rewrites ORION as the subject of its own sentence", () => {
    const cases: Array<[string, string]> = [
      ["I can't pull up apps on your Mac—that's not something ORION can do.", "I can't pull up apps on your Mac—that's not something I can do."],
      ["ORION can't do that yet.", "I can't do that yet."],
      ["Orion will remind you at 6.", "I will remind you at 6."],
      ["Sure, but ORION doesn't have your texts.", "Sure, but I don't have your texts."],
      ["ORION is not able to read that file.", "I am not able to read that file."],
      ["ORION has already moved gym.", "I have already moved gym."],
      ["ORION only tracks water and food.", "I only track water and food."],
      ["Nothing ORION cannot see is guessed.", "Nothing I cannot see is guessed."],
      ["ORION won't touch it without a yes.", "I won't touch it without a yes."],
    ];
    for (const [from, to] of cases) expect(firstPerson(from), from).toBe(to);
  });
  it("leaves product names, windows and other uses alone", () => {
    for (const s of ["Open ORION Link on your phone.", "Say it in the ORION app.", "ORION Link is paired.", "Quit ORION first, then reopen it.",
      "The ORION window is on your second screen.", "orion-mouse status ran.", "ORION is open on the phone.", "Ask ORION Support about it.", "Opened Orion.app."])
      expect(firstPerson(s), s).toBe(s);
  });
  it("has the one short rule", () => expect(SPEAK_AS_I).toBe("Speak as I. Never call yourself ORION or refer to yourself in the third person."));
});

describe("at finalize", () => {
  it("the 11-03 reply comes out in the first person", () => {
    const out = finalizeReply("I can't pull up apps on your Mac—that's not something ORION can do. But I can help.", []);
    expect(out).toContain("not something I can do");
    expect(out).not.toMatch(/ORION/);
  });
  it("code-authored lines are fixed too, and product names stay", () => {
    expect(finalizeReply("ORION will do it. Open ORION Link to check.", [], { codeAuthored: true })).toBe("I will do it. Open ORION Link to check.");
  });
});

describe("canned lines say I", () => {
  it("account health alerts", () => {
    for (const kind of ["credit", "usage_limit", "auth"] as const)
      for (const provider of ["anthropic", "openai"]) expect(alertText({ provider, kind, detail: "x" }), `${provider} ${kind}`).toMatch(/^I can't use /);
  });
  it("the sleep and Full Disk lines", () => {
    expect(toolDirective({ move: "tool", tool: "log_intake" } as never, "log my sleep 8 hours")).toEqual({ kind: "say", text: expect.not.stringMatching(/ORION/) });
  });
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "workspace");
const read = (f: string) => readFileSync(join(root, f), "utf8");
describe("the workspace prompts", () => {
  it("describe Orion as you, never as he or it", () => {
    for (const f of ["SOUL.md", "SELF.md", "USER.md", "PLAYBOOK.md", "MEMORY.md"])
      expect(read(f), f).not.toMatch(/\bOrion(?:'s| is| complements| will| can| cannot| reads?| never| must)\b|what Orion is/);
  });
  it("carry the rule", () => {
    for (const f of ["SOUL.md", "AGENTS.md"]) expect(read(f), f).toContain(SPEAK_AS_I);
  });
});
