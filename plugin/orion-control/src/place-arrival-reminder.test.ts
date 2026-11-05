// "when i get to spit": a place he gave an alias for is an arrival reminder, matched by alias or name; an unknown place is not.
import { describe, expect, it } from "vitest";
import { planReminder } from "./reminder-flow.js";
import { placeArrivalOf } from "./reminder-phrases.js";

const NAMES = ["Chapter Spitalfields", "chapter-spitalfields", "spit", "The Library"];
const now = new Date(2026, 10, 5, 13, 30);

describe("which place a 'when i get to X' means", () => {
  it.each([
    ["remind me to ring avery when i get to spit", "spit"], ["when i get to chapter spitalfields remind me to email sam", "chapter spitalfields"], ["remind me when i arrive at the library to return the book", "library"],
    ["remind me to pay the printer when i get to spit please", "spit"], ["remind me to text mum when i reach spit", "spit"],
  ])("%s", (m, place) => expect(placeArrivalOf(m, NAMES)).toBe(place));
  it.each(["remind me to ring avery when i get home", "remind me to ring avery when i get to narnia", "remind me at 5 to ring avery", "when i get there remind me to relax", "when i get to work remind me to clock in"])("%s is not a known-place arrival", (m) => expect(placeArrivalOf(m, NAMES), m).toBeUndefined());
});

describe("the reminder", () => {
  const plan = (message: string, places = NAMES) => planReminder({ message, now, extract: async () => ({ label: "ring avery", time: null }) as never, list: async () => [], places });
  it("is set to fire on arrival at that place, and says so", async () => {
    const r = await plan("remind me to ring avery when i get to spit");
    expect(r).toMatchObject({ kind: "call", action: "alarm_set" });
    expect(JSON.parse((r as { args: string }).args).steps[0]).toMatchObject({ action: "alarm_set", place: "spit", label: "ring avery" });
    expect((r as { reply: string }).reply).toMatch(/when you get to spit/);
  });
  it("home is still home", async () => {
    const r = await plan("remind me to ring avery when i get home");
    expect(JSON.parse((r as { args: string }).args).steps[0].place).toBe("home");
  });
  it("an unknown place is not an arrival reminder", async () => {
    const r = await plan("remind me to ring avery when i get to narnia");
    expect(JSON.stringify(r)).not.toMatch(/"place":"narnia"/);
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTION_CATALOG } from "./catalog.js";
describe("the alarm_set tool takes a place only when it is one ORION knows", () => {
  it("home, a known place, a known alias; never an unknown name", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    writeFileSync(join(dir, "known-places.json"), JSON.stringify({ places: [{ id: "home", name: "home", kind: "home" }, { id: "chapter-spitalfields", name: "Chapter Spitalfields", aliases: ["spit"] }] }));
    const was = process.env.ORION_CONTROLLED_DIR; process.env.ORION_CONTROLLED_DIR = dir;
    try {
      const check = ACTION_CATALOG.alarm_set!.validateArguments!;
      for (const place of ["home", "spit", "Spit", "chapter spitalfields"]) expect(check({ at: "2030-01-01T09:00", place }), place).toEqual([]);
      for (const place of ["the moon", "narnia", "", "x".repeat(60)]) expect(check({ at: "2030-01-01T09:00", place }), place).not.toEqual([]);
    } finally { if (was === undefined) delete process.env.ORION_CONTROLLED_DIR; else process.env.ORION_CONTROLLED_DIR = was; }
  });
});
