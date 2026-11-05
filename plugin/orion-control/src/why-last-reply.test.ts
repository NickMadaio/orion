// w20 r5 (live gate 3 #44 #94): "why did you say that" is about this chat's previous reply, and says so plainly when there is none.
import { describe, expect, it } from "vitest";
import { isBareWhy, runSelffixMove, type SelffixRun } from "./selffix-flow.js";

describe("a why with no subject", () => {
  it.each(["why did you say that", "why did you reply like that", "whyd you say that lol", "why would you answer that way", "wait why did you say it like that", "why did you word it like that mate"])("%s is bare", (m) => expect(isBareWhy(m), m).toBe(true));
  it.each(["why didnt you open safari", "why did you move the gym", "why did you put leetcode first", "why did you log water"])("%s names a subject", (m) => expect(isBareWhy(m), m).toBe(false));
});

describe("carried out", () => {
  const recorder = () => { const calls: string[][] = []; const run: SelffixRun = async (_s, args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ ok: true, diagnosis: { says: "I can't see a clear fault.", fixable: false } }) }; }; return { calls, run }; };
  it("passes the previous exchange to the script", async () => {
    const { calls, run } = recorder();
    const out = await runSelffixMove({ kind: "why", about: "why did you say that", last: { message: "haha wifi is dead again", reply: "Dramatic.", at: "2026-11-05T05:30:00Z" } }, run);
    expect(calls[0]).toEqual(expect.arrayContaining(["--last-message", "haha wifi is dead again", "--last-reply", "Dramatic."]));
    expect(out.text).toBe("I can't see a clear fault.");
  });
  it("with no previous reply here it says so and reads nothing from disk", async () => {
    const { calls, run } = recorder();
    const out = await runSelffixMove({ kind: "why", about: "why did you say that", last: null }, run);
    expect(calls).toEqual([]);
    expect(out.text).toMatch(/haven't said anything in this chat/);
  });
  it("a named subject still searches the record", async () => {
    const { calls, run } = recorder();
    await runSelffixMove({ kind: "why", about: "why didnt you open safari" }, run);
    expect(calls[0]).not.toContain("--last-message");
  });
});
