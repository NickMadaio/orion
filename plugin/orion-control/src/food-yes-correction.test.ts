// w20 xf-other (tube audit A6, A7): "yes actually, log three of them" is a yes WITH a correction: size it again and log it, once. The model's own
// note ("user corrected count to 3 bars") is never spoken, and a title the estimate doubled is said once.
import { describe, expect, it } from "vitest";
import { readFoodTurn } from "./food-read.js";
import { runFoodTurn, tidyTitle } from "./food-chat.js";

const NOW = new Date(2026, 10, 4, 14, 29);
const bound = { pending: { at: NOW.getTime() - 30_000, via: "chat" as const, offerText: "~190 kcal. Log it?" }, bound: true };
const read = (m: string) => readFoodTurn(m, { now: NOW, mealsOn: true, ...bound });

describe("a yes with a correction", () => {
  it.each(["yes actually. log three of them", "yeah but it was a small one", "yep, make it two", "ok actually it was half", "sure, just the one without cheese", "yeah actually it was 3 of them"])("%s", (m) =>
    expect(read(m)).toMatchObject({ kind: "revise", thenLog: true }));
  it("a plain yes, and a plain correction, are what they were", () => {
    expect(read("yes")).toEqual({ kind: "yes" });
    expect(read("it was a small one")).toEqual({ kind: "revise", correction: "it was a small one" });
    expect(read("yeah go on")).not.toMatchObject({ thenLog: true });
  });
});

describe("carried out in one turn", () => {
  const scripted = (log: string[]) => async (args: string[]) => {
    log.push(args.join(" "));
    if (args.includes("--revise")) return { code: 0, stdout: JSON.stringify({ ok: true, offer: { text: "~570 kcal · 18 g protein, 69 g carbs, 24 g fat (3× protein bar, ~120 g; user corrected count to 3 bars). Log it?" } }) };
    return { code: 0, stdout: JSON.stringify({ ok: true, say: "Logged 3 protein bars, about 570 kcal." }) };
  };
  it("revises, then logs, and says only the log", async () => {
    const log: string[] = [];
    const out = await runFoodTurn({ kind: "revise", correction: "yes actually. log three of them", thenLog: true }, { run: scripted(log), stateDir: "/nonexistent-dir", now: NOW });
    expect(log.map((l) => l.split(" ")[0])).toEqual(["--revise", "log-pending"]);
    expect(out.text).toMatch(/^Logged 3 protein bars/);
    expect(out.text).not.toMatch(/user corrected|Log it\?/);
  });
  it("a plain revise still offers, without the model's note", async () => {
    const out = await runFoodTurn({ kind: "revise", correction: "it was three" }, { run: scripted([]), stateDir: "/nonexistent-dir", now: NOW });
    expect(out.text).toMatch(/Log it\?$/);
    expect(out.text).not.toMatch(/user corrected/);
    expect(out.text).toContain("3× protein bar, ~120 g)");
  });
});

describe("a doubled title", () => {
  it.each([["protein bar, protein bar +1", "protein bar"], ["Egg, egg +2", "Egg"], ["egg and toast", "egg and toast"], ["egg, toast +2", "egg, toast +2"], ["protein bar", "protein bar"]])("%s", (a, b) => expect(tidyTitle(a)).toBe(b));
});
